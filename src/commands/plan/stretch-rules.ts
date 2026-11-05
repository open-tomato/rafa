/**
 * The stretch's rules file a `plan create` run appends to its snapshot:
 * the environment value `RAFA_STRETCH_RULES` read once, and the file it
 * names read into the {@link StretchRules} the board routes take.
 *
 * `rafa stretch item` sets the value to the absolute path of
 * `.rafa/stretch/<n>/rules.md` when that file exists, and the board
 * modules under `packages/rafa-board/src/board/` take the text as a
 * parameter and never read the environment. This module is the one
 * place the value is read, so the reading of it — and its refusals —
 * live here.
 *
 * ## What the value may hold
 *
 * - Unset, or holding nothing but whitespace: no rules, and the snapshot
 *   is the one the body and the notes alone write.
 * - A path to a file: its text, named on every line by the path as the
 *   project root reads it — `.rafa/stretch/112/rules.md` for a file
 *   under the root, the absolute path for one outside it. A relative
 *   value is read against the project root.
 * - A path to nothing, or to anything that is not a file, a directory
 *   included: REFUSED, exit {@link STRETCH_RULES_REFUSAL_EXIT}, naming
 *   the value and what is there. The value is set only when the file
 *   exists, so one that names no file is a hand-over gone wrong, and a
 *   run that planned on without the rules would plan an item without
 *   the working rules its stretch approved, with nobody told.
 *
 * ## Read once
 *
 * `plan create` may resolve its spec twice — again with a refused claim
 * passed over (`./claim-route.ts`) — and {@link stretchRulesReader}
 * answers a reader that reads the value and the file on its first call
 * and answers that reading after it, the refusal included. A route that
 * never calls it, `--spec=<file>`, reads neither (`./spec-route.ts`).
 */
import type { StretchRules } from '@open-tomato/rafa-board';

import fs from 'fs';
import path from 'path';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { errorCode } from '@open-tomato/rafa/core/loop';

/** The environment value `rafa stretch item` hands the rules file over in. */
export const STRETCH_RULES_ENV = 'RAFA_STRETCH_RULES';

/** The exit code a value naming no file ends the run with. */
export const STRETCH_RULES_REFUSAL_EXIT = 1;

/** The environment as this module reads it: one value, by name. */
export type StretchRulesEnv = Readonly<Record<string, string | undefined>>;

/** The refusal for a value naming nothing at all. */
export function missingRulesMessage(value: string): string {
  return `${STRETCH_RULES_ENV}=${value} names no file; a stretch's rules are read from its rules.md,`
    + ` so write that file or unset ${STRETCH_RULES_ENV}`;
}

/** The refusal for a value naming something that is not a file, such as a directory. */
export function notRulesFileMessage(value: string, what: string): string {
  return `${STRETCH_RULES_ENV}=${value} names ${what}, not a file; point it at the stretch's rules.md`;
}

/** The refusal for a file that is there and could not be read. */
export function unreadableRulesMessage(value: string, reason: string): string {
  return `${STRETCH_RULES_ENV}=${value} could not be read: ${reason}`;
}

/** What `stat` found, as a refusal names it. */
function describeEntry(stat: fs.Stats): string {
  return stat.isDirectory()
    ? 'a directory'
    : 'something other than a file';
}

/** `absolute` as the lines name it: against the root when under it, absolute otherwise. */
function displayPath(repoRoot: string, absolute: string): string {
  const relative = path.relative(repoRoot, absolute);
  return relative === '' || relative.startsWith('..') || path.isAbsolute(relative)
    ? absolute
    : relative;
}

/**
 * The rules file `env` names, read against `repoRoot`, or null when the
 * value is unset or blank.
 *
 * Throws `CommandExit({@link STRETCH_RULES_REFUSAL_EXIT}, ...)` when the
 * value names nothing, names a directory or anything else that is not a
 * file, or names a file that could not be read. See the module note.
 */
export function readStretchRules(env: StretchRulesEnv, repoRoot: string): StretchRules | null {
  const value = env[STRETCH_RULES_ENV];
  if (value === undefined || value.trim() === '') return null;

  const absolute = path.resolve(repoRoot, value);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolute);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new CommandExit(STRETCH_RULES_REFUSAL_EXIT, missingRulesMessage(value));
    }
    throw new CommandExit(STRETCH_RULES_REFUSAL_EXIT, unreadableRulesMessage(value, messageOf(error)));
  }
  if (!stat.isFile()) {
    throw new CommandExit(STRETCH_RULES_REFUSAL_EXIT, notRulesFileMessage(value, describeEntry(stat)));
  }

  try {
    return Object.freeze({ path: displayPath(repoRoot, absolute), text: fs.readFileSync(absolute, 'utf8') });
  } catch (error) {
    throw new CommandExit(STRETCH_RULES_REFUSAL_EXIT, unreadableRulesMessage(value, messageOf(error)));
  }
}

/** A reading of {@link readStretchRules}: the rules, or the refusal it threw. */
type RulesReading =
  | { readonly ok: true; readonly rules: StretchRules | null }
  | { readonly ok: false; readonly error: unknown };

/**
 * A reader of the rules file `env` names, reading it on its first call
 * and answering that reading after it — the refusal thrown again, not
 * read again. See the module note.
 */
export function stretchRulesReader(env: StretchRulesEnv, repoRoot: string): () => StretchRules | null {
  let reading: RulesReading | null = null;
  return (): StretchRules | null => {
    if (reading === null) {
      try {
        reading = { ok: true, rules: readStretchRules(env, repoRoot) };
      } catch (error) {
        reading = { ok: false, error };
      }
    }
    if (reading.ok) return reading.rules;
    throw reading.error;
  };
}
