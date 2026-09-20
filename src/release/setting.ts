/**
 * One setting read out of a config file made of comments, and the text
 * that sets it written back into one: `release.enabled`, as `rafa init`
 * asks once whether this project bumps a version and writes a changelog
 * entry with every pull request. The question, the decision order and
 * the part it is reported as are `src/commands/init-release.ts`'s.
 *
 * `rafa init` writes a project config that is `version: 1` and every
 * other setting commented out at its default
 * (`src/project/scaffold.ts`), and that file is the point: an operator
 * reads it to see what can be set and what the default is. So the
 * setting is written INTO that text, the same rule and for the same
 * reason as `src/board/setup-config.ts`, which writes `roadmap.issue`.
 *
 * ## Why this is not that module
 *
 * The two edits look alike and are not the same edit. `roadmap` is a
 * section of ONE setting, so uncommenting its whole block sets the one
 * thing asked about. `release` is a section of FOUR, and the other
 * three — `versionFile`, `changelog` and `heading` — must stay
 * commented: uncommenting them would pin this build's defaults into the
 * project file and hide whatever the user scope names, the reason
 * `project/scaffold.ts` writes every line commented in the first place.
 * So the edit here uncomments the section line and ONE line under it,
 * and leaves the rest of the block as the comments they were.
 *
 * ## The three shapes the edit covers, and the fourth it refuses
 *
 * {@link withReleaseEnabled} is a line edit with three branches: an
 * uncommented `release:` on a line of its own gains the setting under
 * it — or has the `enabled:` it already carries REPLACED, since an
 * operator who runs `rafa init --no-release` over a project that said
 * yes is changing an answer and not adding a second one — the commented
 * block `rafa init` writes has its `release:` and its `enabled:` line
 * uncommented in place, and a file naming no `release` at all gains a
 * two-line block at its end.
 *
 * The fourth shape — a file that names `release` some other way, such
 * as the flow mapping `release: {enabled: true}` — is REFUSED with null
 * rather than appended to. `Bun.YAML.parse` answers the LAST of two
 * duplicate keys and says nothing about the first (measured on
 * bun 1.3.14 by `src/board/setup-config.ts`, 2026-09-19), so an
 * appended block would read back as the right answer and pass every
 * check while leaving the key in the file twice.
 *
 * ## The parse-back, and what it can and cannot catch
 *
 * {@link releaseEnabledIn} reads a candidate text through
 * `parseConfigText`, the same reader `loadConfig` uses, so the caller
 * writes nothing until the text it holds reads back as the answer it
 * means. That control catches a branch that put the line in the wrong
 * place: a second `  enabled:` left under a `release:` that already
 * carries one reads back as the LAST of the two, whichever that is, so
 * a scan that failed to find the line it should have replaced reddens
 * instead of writing a file with the key in it twice. It is what makes
 * a hand-written edit safe to ship.
 *
 * What it cannot catch is the duplicate top-level key above, which is
 * why that one is refused by shape instead.
 *
 * Nothing here writes: the file is READ under the root the caller
 * names, which every case in `./setting.test.ts` points at its own
 * temporary directory, and the text that would replace it is answered
 * rather than written.
 */
import type { ReleaseEnabled } from '../config-sections.js';

import { readFileSync } from 'node:fs';

import { isMapping, messageOf } from '../config-sections.js';
import { configFilePath, parseConfigText } from '../config.js';

/** The setting this module reads and writes, as a message names it. */
export const RELEASE_ENABLED_SETTING = 'release.enabled';

/** What the project config says `release.enabled` is, or why it could not be read. */
export interface ReleaseSettingReading {
  /** The value the file names, or null when it names none. */
  readonly enabled: ReleaseEnabled | null;
  /** The text of the file, kept for the write that may follow. */
  readonly text: string;
  /** Why the file could not be read, or null when it was. */
  readonly problem: string | null;
}

/**
 * What `text` says `release.enabled` is, read through
 * `parseConfigText`, the reader `loadConfig` uses, and null when the
 * file says nothing. `path` labels the refusals only.
 *
 * @throws ConfigError when the text is not a config this rafa reads.
 */
export function releaseEnabledIn(text: string, path: string): ReleaseEnabled | null {
  return parseConfigText(text, path).values.releaseEnabled ?? null;
}

/** Reads `release.enabled` out of the project config under `root`, through the schema. */
export function readReleaseSetting(root: string): ReleaseSettingReading {
  const path = configFilePath(root);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { enabled: null, text: '', problem: `${path} could not be read: ${messageOf(error)}` };
  }
  try {
    return { enabled: releaseEnabledIn(text, path), text, problem: null };
  } catch (error) {
    return { enabled: null, text, problem: `${path} could not be read: ${messageOf(error)}` };
  }
}

/** An uncommented `release:` at the top level of the document. */
const RELEASE_KEY = /^release:\s*$/u;

/** The same key commented out, as `rafa init` writes it. */
const COMMENTED_RELEASE_KEY = /^#\s*release:\s*$/u;

/** The commented `enabled:` line under it, whatever trailing comment it carries. */
const COMMENTED_ENABLED_KEY = /^#\s+enabled:/u;

/** An `enabled:` line inside an uncommented `release:` block. */
const ENABLED_KEY = /^\s+enabled\s*:/u;

/** A line that is blank or a comment, which neither sets a key nor ends a block. */
const SKIPPABLE = /^(\s*#|\s*$)/u;

/**
 * The index of the `enabled:` line of the block opened at `open`, or
 * null when the block sets no such key. The scan ends at the first line
 * that is neither indented, blank nor a comment, which is the next
 * top-level key.
 */
function enabledLineIn(lines: readonly string[], open: number): number | null {
  for (let index = open + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (SKIPPABLE.test(line)) continue;
    if (ENABLED_KEY.test(line)) return index;
    if (!line.startsWith(' ')) return null;
  }
  return null;
}

/** `lines` with `block` after the last line that holds anything. */
function appended(lines: readonly string[], block: readonly string[]): readonly string[] {
  const body = lines.at(-1) === ''
    ? lines.slice(0, -1)
    : [...lines];
  return [...body, ...block, ''];
}

/** True when `text` parses to a document that already names `release`. */
function namesRelease(text: string): boolean {
  let document: unknown;
  try {
    document = Bun.YAML.parse(text);
  } catch {
    return false;
  }
  return isMapping(document) && Object.hasOwn(document, 'release');
}

/**
 * `text` with `release.enabled` set to `enabled`, the comments around
 * it kept, or null when the file spells `release` in a shape none of
 * the three branches edits.
 *
 * The branches, in order: an uncommented `release:` on a line of its
 * own gains the setting under it, or has the `enabled:` line it
 * already carries replaced in place; the commented block `rafa init`
 * writes has those two lines uncommented in place; and a file naming
 * no `release` at all gains the block at its end. The rest of a
 * commented block is left commented; the module note holds why.
 *
 * The null is the fourth case and it is a REFUSAL, not an append: a
 * second `release:` appended to a file that spells the key some other
 * way would read back as this answer and pass every check while
 * leaving a file with two of the same key in it.
 *
 * Pure otherwise, and unchecked: the caller parses what comes back
 * before writing it.
 */
export function withReleaseEnabled(text: string, enabled: boolean): string | null {
  const setting = `  enabled: ${String(enabled)}`;
  const lines = text.split('\n');

  const open = lines.findIndex((line) => RELEASE_KEY.test(line));
  if (open >= 0) {
    const at = enabledLineIn(lines, open);
    if (at === null) {
      return [...lines.slice(0, open + 1), setting, ...lines.slice(open + 1)].join('\n');
    }
    return [...lines.slice(0, at), setting, ...lines.slice(at + 1)].join('\n');
  }

  const commented = lines.findIndex((line) => COMMENTED_RELEASE_KEY.test(line));
  if (commented >= 0) {
    const next = lines[commented + 1] ?? '';
    const after = COMMENTED_ENABLED_KEY.test(next)
      ? commented + 2
      : commented + 1;
    return [...lines.slice(0, commented), 'release:', setting, ...lines.slice(after)].join('\n');
  }

  if (namesRelease(text)) return null;
  return appended(lines, ['release:', setting]).join('\n');
}
