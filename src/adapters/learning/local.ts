/**
 * The `local` Learning adapter as phase 1 ships it: a file-backed stub
 * that keeps every instinct pushed to it under `.rafa/instincts/` and
 * hands the active ones back, merging nothing.
 *
 * The phase 1 table names `local` as the Learning port's core adapter:
 * "phase 5 fills it; phase 1 ships the interface and a file-backed stub
 * that stores and returns instincts unmerged". The adapter phase 5
 * fills (`distributed-learning-library.md`, "rafa's Learning port and
 * local adapter") runs that library's `merge` on every push and its
 * `bless` on every pull. The library does not exist yet, so this stub
 * runs neither. Outside the tests, only the adapter registry's
 * `learning/local` entry makes one, and no command resolves that entry
 * yet.
 *
 * ## Two append-only files
 *
 * Under the directory the adapter is made with, which
 * {@link localInstinctsDir} answers for a repository:
 *
 *   - `instincts.ndjson`: one line per pushed record, holding the
 *     payload's `source_id` and the record, in the order the payloads
 *     were pushed and each payload's records in its own order. The
 *     source is kept because phase 5's merge tells two tasks of one plan
 *     apart by it.
 *   - `flags.ndjson`: one line per `flag`, holding the `id`, the
 *     `reason` and the `flagged_at` read off `now`.
 *
 * Neither file is rewritten, and no line is removed. A record is written
 * with the port's fields alone, in the port's order, and `artifact` is
 * left out when the record has none; any other key is dropped, on the
 * write and on the read. The directory is made by a push that stores a
 * record, so a pull, a refused push or a push of no records leaves no
 * directory behind.
 *
 * ## What each call answers
 *
 *   - `push` checks the whole payload before a byte is written, so a
 *     payload holding one record the checks refuse writes nothing. It
 *     answers every record as a `new-trigger` decision, whatever is
 *     already held under its trigger or its id: `produced` is the record
 *     as stored, and `discarded` is empty. Two records sharing a trigger
 *     or an id are both kept, and both answered by a pull.
 *   - `pullBlessed` answers every held record whose `status` is `active`
 *     and whose id no flag names, oldest first. Its `version` is `now`
 *     when the bundle is made, as open-tomato's `BlessedBundle` spells
 *     it: "ISO 8601 timestamp of the bundle generation". Nothing is
 *     ordered by confidence; that is phase 5's `bless`.
 *   - `flag` appends a flag naming an id some held record carries, and
 *     rejects an id none does. The flag names the id, not one line, so
 *     every record held under that id stays out of each later bundle, a
 *     record pushed under it after the flag included.
 *
 * ## Checks
 *
 * A record carries a non-empty `id`; a string `trigger`, `action`,
 * `action_hash`, `created_at` and `updated_at`; a `confidence` from 0.3
 * to 0.9, the range the port documents; a `usage_count` that is a whole
 * number from 0; an `artifact` that is a string when present; and a
 * `signal` and a `status` from the port's unions. `action_hash` is not
 * recomputed from `action`. A payload carries a non-empty `source_id`
 * and a list of `instincts`, and a flag a non-empty `id` and a string
 * `reason` and `flagged_at`. A flag is checked before it is written, so
 * a flag no pull could read is refused rather than written.
 *
 * ## A line that cannot be read
 *
 * The two files fail differently, each toward keeping an instinct out:
 *
 *   - An instinct line that is not JSON, or is JSON the checks refuse, is
 *     skipped and reported through `warn`, which defaults to the active
 *     output's `warn` (`src/adapters/output/active.ts`), read when the
 *     report is made. The other lines are answered.
 *   - A flag line that cannot be read rejects the pull, naming the file
 *     and the line, because a bundle skipping it could hold an instinct
 *     it flags. The line has to be mended or removed by hand.
 *
 * A run killed mid-append leaves a last line with no newline. The next
 * append writes a newline ahead of its own lines, so the fragment stays
 * one unreadable line and the new lines are read.
 *
 * ## Left for phase 5
 *
 * The spec's directory contract, `personal/` and `inherited/` per scope;
 * the user scope's `~/.rafa/instincts/`; and the library's `merge`,
 * `bless` and `promote`.
 */
import type {
  BlessedBundle,
  InstinctRecord,
  Learning,
  MergeDecision,
  MergeResult,
  SyncPayload,
} from '../../ports/index.js';

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describeValue, isMapping, messageOf } from '../../config-sections.js';
import { activeOutput } from '../output/active.js';

/** What every refusal and report opens with. */
const PREFIX = 'local learning';

/** The file pushed records are appended to, under the directory. */
const INSTINCTS_FILE = 'instincts.ndjson';

/** The file flags are appended to, under the directory. */
const FLAGS_FILE = 'flags.ndjson';

/** The lowest confidence the port documents. */
const MIN_CONFIDENCE = 0.3;

/** The highest confidence the port documents. */
const MAX_CONFIDENCE = 0.9;

/** The signals a record can carry. */
const SIGNALS: readonly InstinctRecord['signal'][] = ['loud', 'silent'];

/** The statuses a record can carry. */
const STATUSES: readonly InstinctRecord['status'][] = ['active', 'flagged'];

/** One line of the instincts file. */
interface HeldInstinct {
  readonly source_id: string;
  readonly instinct: InstinctRecord;
}

/** One line of the flags file. */
interface HeldFlag {
  readonly id: string;
  readonly reason: string;
  /** When the flag was written, read off `now`. */
  readonly flagged_at: string;
}

/** What a local learning adapter is made with. */
export interface LocalLearningOptions {
  /** The directory the files live in, as {@link localInstinctsDir} answers it for a repository. */
  readonly instinctsDir: string;
  /** Stamps each bundle's `version` and each flag, as ISO 8601. The system clock when left out. */
  readonly now?: () => string;
  /** Reports an instinct line skipped. The active output's `warn` when left out. */
  readonly warn?: (message: string) => void;
}

/** Whether a field's value is acceptable, and what an acceptable one is. */
type FieldCheck = readonly [accepts: (value: unknown) => boolean, expected: string];

/** Each field's check, by field name. */
type FieldChecks = Readonly<Record<string, FieldCheck>>;

/** True for a string. */
function isString(value: unknown): boolean {
  return typeof value === 'string';
}

/** True for a string holding at least one character. */
function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value !== '';
}

/** Accepts one of `members`. */
function oneOf(members: readonly string[]): (value: unknown) => boolean {
  return (value) => typeof value === 'string' && members.includes(value);
}

/**
 * Each record field's check, in the port's order. `satisfies` closes the
 * set over the record's keys both ways.
 */
const INSTINCT_CHECKS = {
  id: [isNonEmptyString, 'a non-empty string'],
  trigger: [isString, 'a string'],
  action: [isString, 'a string'],
  action_hash: [isString, 'a string'],
  confidence: [
    (value) => typeof value === 'number' && value >= MIN_CONFIDENCE && value <= MAX_CONFIDENCE,
    `a number from ${MIN_CONFIDENCE} to ${MAX_CONFIDENCE}`,
  ],
  usage_count: [
    (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
    'a whole number from 0',
  ],
  artifact: [(value) => value === undefined || typeof value === 'string', 'a string when present'],
  signal: [oneOf(SIGNALS), `one of: ${SIGNALS.join(', ')}`],
  status: [oneOf(STATUSES), `one of: ${STATUSES.join(', ')}`],
  created_at: [isString, 'a string'],
  updated_at: [isString, 'a string'],
} satisfies Record<keyof InstinctRecord, FieldCheck>;

/** A payload's checks, before each record's. */
const PAYLOAD_CHECKS = {
  source_id: [isNonEmptyString, 'a non-empty string'],
  instincts: [Array.isArray, 'a list'],
} satisfies Record<keyof SyncPayload, FieldCheck>;

/** An instinct line's checks, before its record's. */
const HELD_INSTINCT_CHECKS = {
  source_id: [isNonEmptyString, 'a non-empty string'],
  instinct: [isMapping, 'a mapping'],
} satisfies Record<keyof HeldInstinct, FieldCheck>;

/** A flag line's checks. */
const FLAG_CHECKS = {
  id: [isNonEmptyString, 'a non-empty string'],
  reason: [isString, 'a string'],
  flagged_at: [isString, 'a string'],
} satisfies Record<keyof HeldFlag, FieldCheck>;

/** The first thing wrong with `value`, named as `at`, or null when nothing is. */
function fieldsProblem(value: unknown, checks: FieldChecks, at: string): string | null {
  if (!isMapping(value)) {
    return `${at} is ${describeValue(value)}, expected a mapping`;
  }
  for (const [key, [accepts, expected]] of Object.entries(checks)) {
    if (!accepts(value[key])) {
      return `${key} is ${describeValue(value[key])} in ${at}, expected ${expected}`;
    }
  }
  return null;
}

/** The first thing wrong with a payload, or null when nothing is. */
function payloadProblem(payload: unknown): string | null {
  const problem = fieldsProblem(payload, PAYLOAD_CHECKS, 'the payload');
  if (problem !== null) return problem;
  // Checked above: a mapping holding a list of instincts.
  const { instincts } = payload as { instincts: readonly unknown[] };
  return instincts
    .map((record, index) => fieldsProblem(record, INSTINCT_CHECKS, `instincts[${index}]`))
    .find((found) => found !== null) ?? null;
}

/** The first thing wrong with an instinct line's value, or null when nothing is. */
function heldInstinctProblem(value: unknown): string | null {
  return fieldsProblem(value, HELD_INSTINCT_CHECKS, 'the line')
    // Reached only when the line is a mapping holding a mapping as `instinct`.
    ?? fieldsProblem((value as HeldInstinct).instinct, INSTINCT_CHECKS, 'the instinct');
}

/** The first thing wrong with a flag line's value, or null when nothing is. */
function flagProblem(value: unknown): string | null {
  return fieldsProblem(value, FLAG_CHECKS, 'the flag');
}

/** A record with the port's fields alone, in the port's order. */
function copyInstinct(record: InstinctRecord): InstinctRecord {
  const { artifact } = record;
  return {
    id: record.id,
    trigger: record.trigger,
    action: record.action,
    action_hash: record.action_hash,
    confidence: record.confidence,
    usage_count: record.usage_count,
    ...(artifact === undefined
      ? {}
      : { artifact }),
    signal: record.signal,
    status: record.status,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

/** True when `error` carries the system error code `code`. */
function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** A file's contents, or nothing when it does not exist. Rejects for any other failure. */
async function readIfPresent(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return '';
    throw error;
  }
}

/**
 * Appends `lines` to a file, each ending in a newline, with one more
 * newline ahead of them when the file's last line has none.
 */
async function appendLines(path: string, lines: readonly string[]): Promise<void> {
  const held = await readIfPresent(path);
  const lead = held === '' || held.endsWith('\n')
    ? ''
    : '\n';
  await appendFile(path, `${lead}${lines.join('\n')}\n`, 'utf8');
}

/** One line read, or what is wrong with it. */
type LineReading<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: string };

/** Each line of a file's contents that holds anything, with its number from 1. */
function numberedLines(contents: string): (readonly [number: number, line: string])[] {
  return contents.split('\n').flatMap((line, index) => (line === ''
    ? []
    : [[index + 1, line] as const]));
}

/** Reads one line as JSON the check accepts. */
function readLine<T>(line: string, problemOf: (value: unknown) => string | null): LineReading<T> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    return { ok: false, problem: `it is not JSON (${messageOf(error)})` };
  }
  const problem = problemOf(value);
  return problem === null
    // Checked by `problemOf`.
    ? { ok: true, value: value as T }
    : { ok: false, problem };
}

/** Reports through the output active when the report is made. */
function warnThroughActiveOutput(message: string): void {
  activeOutput().warn(message);
}

/** Where `local` instincts live under a repository: `.rafa/instincts/`. */
export function localInstinctsDir(repoRoot: string): string {
  return join(repoRoot, '.rafa', 'instincts');
}

/** Makes a `local` learning stub over `options.instinctsDir`; see the module note. */
export function createLocalLearning(options: LocalLearningOptions): Learning {
  const { instinctsDir } = options;
  const now = options.now ?? ((): string => new Date().toISOString());
  const warn = options.warn ?? warnThroughActiveOutput;
  const instinctsPath = join(instinctsDir, INSTINCTS_FILE);
  const flagsPath = join(instinctsDir, FLAGS_FILE);

  /** Every record that can be read, oldest first, each unreadable line reported and left out. */
  async function heldInstincts(): Promise<InstinctRecord[]> {
    const lines = numberedLines(await readIfPresent(instinctsPath));
    return lines.flatMap(([number, line]) => {
      const reading = readLine<HeldInstinct>(line, heldInstinctProblem);
      if (reading.ok) return [copyInstinct(reading.value.instinct)];
      warn(`${PREFIX}: line ${number} of ${instinctsPath} is not a held instinct, so it was skipped: ${reading.problem}`);
      return [];
    });
  }

  /** Every id a flag names. Rejects on a flag line that cannot be read. */
  async function flaggedIds(): Promise<ReadonlySet<string>> {
    const lines = numberedLines(await readIfPresent(flagsPath));
    return new Set(lines.map(([number, line]) => {
      const reading = readLine<HeldFlag>(line, flagProblem);
      if (reading.ok) return reading.value.id;
      throw new Error(
        `${PREFIX}: line ${number} of ${flagsPath} is not a flag,`
          + ` and a bundle skipping it could hold an instinct it flags: ${reading.problem}`,
      );
    }));
  }

  const learning: Learning = {
    push: async (payload: SyncPayload): Promise<MergeResult> => {
      const problem = payloadProblem(payload);
      if (problem !== null) {
        throw new TypeError(`${PREFIX}: refused to store a push: ${problem}`);
      }
      const decisions = payload.instincts.map((incoming): MergeDecision => ({
        incoming,
        rule: 'new-trigger',
        produced: [copyInstinct(incoming)],
      }));
      const lines = decisions.flatMap(({ produced }) => produced.map((instinct) => JSON.stringify({
        source_id: payload.source_id,
        instinct,
      } satisfies HeldInstinct)));
      if (lines.length > 0) {
        await mkdir(instinctsDir, { recursive: true });
        await appendLines(instinctsPath, lines);
      }
      return { decisions, discarded: [] };
    },

    pullBlessed: async (): Promise<BlessedBundle> => {
      const flagged = await flaggedIds();
      const instincts = (await heldInstincts())
        .filter((instinct) => instinct.status === 'active' && !flagged.has(instinct.id));
      return { version: now(), instincts };
    },

    flag: async (id: string, reason: string): Promise<void> => {
      const flag: HeldFlag = { id, reason, flagged_at: now() };
      const problem = flagProblem(flag);
      if (problem !== null) {
        throw new TypeError(`${PREFIX}: refused to write an invalid flag: ${problem}`);
      }
      const held = await heldInstincts();
      if (!held.some((instinct) => instinct.id === id)) {
        throw new Error(`${PREFIX}: no instinct ${describeValue(id)} is held under ${instinctsDir}`);
      }
      await appendLines(flagsPath, [JSON.stringify(flag)]);
    },
  };
  return Object.freeze(learning);
}
