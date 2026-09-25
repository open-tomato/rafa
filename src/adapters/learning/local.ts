/**
 * The `local` Learning adapter: the `.md` instincts under
 * `.rafa/instincts/` are its held set, the learning library's `merge`
 * settles every push against them, each decision is logged, and its
 * `bless` answers every pull, with the user scope's lessons added on
 * the triggers the project holds nothing on.
 *
 * The adapter the distributed-learning spec describes
 * (`distributed-learning-library.md`, "rafa's Learning port and local
 * adapter") runs the library's `merge` on every push and its `bless` on
 * every pull, and this one does both as this note describes. Outside
 * the tests, only the adapter registry's `learning/local` entry makes
 * one.
 *
 * ## The files
 *
 * Under the directory the adapter is made with, which
 * {@link localInstinctsDir} answers for a repository:
 *
 *   - `<id>.md`, one per held instinct: the held set. They are the
 *     files `rafa instinct check|list|show` read, read here through the
 *     same `readScope`, so a record is a top-level `.md` file and
 *     nothing else in the directory is one. `./held.js` maps each to the
 *     library's record and back. A demoted record (source `demoted`) is
 *     one of them like any other.
 *   - `instincts.ndjson`, the push log: one {@link PushLogLine} per
 *     merge decision, in the payload's order, holding the payload's
 *     `source_id`, the rule, the incoming record as it was pushed, and
 *     the ids of the records its trigger is now held as (`produced`) and
 *     of those a higher-confidence action displaced on it (`discarded`).
 *     Nothing reads it back; it is the record of what each push did.
 *   - `flags.ndjson`: one line per `flag`, holding the `id`, the
 *     `reason` and the `flagged_at` read off `now`.
 *
 * Neither NDJSON file is rewritten, and no line is removed. The
 * directory is made by a push that logs a decision, so a pull, a
 * refused push or a push of no records leaves no directory behind.
 *
 * The user scope, `.rafa/instincts/` under the `home` the adapter is
 * made with ({@link userInstinctsDir}), is read by a pull through the
 * same `readScope` and `./held.js`, and is never written: no call makes,
 * changes or removes anything under it.
 *
 * ## What a push does
 *
 * The payload is checked, the held set read, and `merge` run over them
 * with `now` as its clock. Every trigger the payload touches is then
 * held as exactly the records its decisions produced: each is written
 * as `<id>.md`, a file already holding it as it would be written again
 * is left alone, and every other held file on that trigger is removed,
 * which is how a collapsed member and a discarded action leave the held
 * set. A discarded action stays in the push log: the line that pushed
 * it holds it whole as `incoming`, and the line that displaced it names
 * its id. A held file no push brought, such as a demoted one, is named
 * there by id alone.
 *
 * A written record takes `kind`, `domain`, `scope`, `source`,
 * `evidence`, `cause` and `project_id` from its earliest held member,
 * as `./held.js` describes. A record with none, as a `new-trigger`
 * record is, takes them from the `description` of the earliest payload
 * record on its trigger with its action that carries one
 * ({@link DescribedInstinctRecord}); the port's record has no such
 * fields, so a payload record that may land on a trigger nothing holds
 * has to carry them.
 *
 * `status` is not written: `./held.js` reads a trigger held with more
 * than one action as `flagged`, which is what the merge that left them
 * there decided. A record pushed as `flagged` alone on its trigger is
 * therefore held as `active`; an operator's flag is `flag`'s, by id.
 *
 * ## Nothing is written until everything is checked
 *
 * A push is refused, with nothing written and no directory made, when:
 *
 *   - the payload, a record in it, or a record's `description` fails
 *     the checks below;
 *   - a record's `action_hash` is not {@link actionHash} of its action,
 *     because the held set reads every hash off its action and a record
 *     grouped by any other hash would be merged against the wrong one;
 *   - a produced record has neither a held member nor a description;
 *   - two produced records would be written to one `<id>.md`, or one
 *     would overwrite a file that holds another trigger or that could
 *     not be read;
 *   - a file it would write does not read back through `parseInstinct`
 *     without an issue, such as an id that is no slug or a
 *     `task-report` record with no evidence.
 *
 * Once those pass, the log lines are appended first, then the files
 * are written and removed.
 *
 * ## What the other calls answer
 *
 *   - `pullBlessed` runs `bless` at the adapter's `minConfidence`,
 *     which is `learning.bless.minConfidence`, over the project's held
 *     set with every record whose id a flag names taken out, so it
 *     answers the `active`, unpromoted records at or above the floor,
 *     most trusted first. It then runs `bless` at the same floor over
 *     the user scope, and adds each record it answers, in its order,
 *     unless the project holds a record on its trigger (by
 *     `triggerKey`) or under its id, or a flag names its id. A trigger
 *     the project holds is the project's to settle, whether its records
 *     there are blessed, below the floor, flagged or named by a flag, so
 *     a user lesson never stands in for one the project refused. A
 *     project flag is read as naming an id wherever it is held, which
 *     keeps a lesson out rather than in. Its `version` is `now` when the
 *     bundle is made, not the library's hash, as open-tomato's
 *     `BlessedBundle` spells it: "ISO 8601 timestamp of the bundle
 *     generation".
 *   - `flag` appends a flag naming an id some held record of the
 *     project carries, and rejects an id none does, a user-scope id
 *     included. The flag names the id, not one file, so the record stays
 *     out of each later bundle whatever a later merge writes under that
 *     id.
 *
 * ## Checks
 *
 * A record carries a non-empty `id`; a string `trigger`, `action`,
 * `action_hash`, `created_at` and `updated_at`; a `confidence` from 0.3
 * to 0.9, the range the port documents; a `usage_count` that is a whole
 * number from 0; `sources` that is a list of non-empty strings when
 * present; an `artifact` and a `promoted_to` that are each a string when
 * present; and a `signal` and a `status` from the port's unions. Any
 * other key is dropped, `description` apart, which is a mapping of the
 * `.md` form's `kind`, `domain`, `scope` and `source` from their lists,
 * `evidence` as a list of mappings, `cause` as a string and `projectId`
 * as a string or null. A payload carries a non-empty `source_id` and a
 * list of `instincts`, and a flag a non-empty `id` and a string
 * `reason` and `flagged_at`. A flag is checked before it is written, so
 * a flag no pull could read is refused rather than written.
 *
 * ## A file or a line that cannot be read
 *
 * The held set and the flags fail differently, each toward keeping an
 * instinct out:
 *
 *   - A `.md` file the schema refuses, in either scope, is skipped and
 *     reported through `warn`, which defaults to the active output's
 *     `warn` (`src/adapters/output/active.ts`), read when the report is
 *     made. The other files are read, and a push never writes over it.
 *   - A flag line that cannot be read rejects the pull, naming the file
 *     and the line, because a bundle skipping it could hold an instinct
 *     it flags. The line has to be mended or removed by hand.
 *
 * A run killed mid-append leaves a last line with no newline. The next
 * append writes a newline ahead of its own lines, so the fragment stays
 * one unreadable line and the new lines are read.
 */
import type { HeldDescription } from './held.js';
import type {
  BlessedBundle,
  InstinctRecord,
  Learning,
  MergeResult,
  MergeRule,
  SyncPayload,
} from '../../ports/index.js';
import type { Instinct } from '../../schema/instinct.js';
import type { InstinctScope } from '../../schema/tiers.js';

import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { readScope } from '../../commands/instinct/instinct-records.js';
import { describeValue, isMapping, messageOf } from '../../config-sections.js';
import { actionHash, bless, merge, triggerKey } from '../../learning/index.js';
import {
  INSTINCT_DOMAINS,
  INSTINCT_KINDS,
  INSTINCT_SCOPES,
  INSTINCT_SOURCES,
  parseInstinct,
  writeInstinct,
} from '../../schema/instinct.js';
import { RAFA_INSTINCTS_PATH } from '../../schema/tiers.js';
import { activeOutput } from '../output/active.js';

import { toHeldInstinct, toHeldRecords } from './held.js';

/** What every refusal and report opens with. */
const PREFIX = 'local learning';

/** What every push refusal opens with. */
const PUSH_REFUSAL = `${PREFIX}: refused to store a push`;

/** The push log, under the directory. */
const INSTINCTS_FILE = 'instincts.ndjson';

/** The file flags are appended to, under the directory. */
const FLAGS_FILE = 'flags.ndjson';

/** A held instinct's file name after its id. */
const RECORD_EXTENSION = '.md';

/** The lowest confidence the port documents. */
const MIN_CONFIDENCE = 0.3;

/** The highest confidence the port documents. */
const MAX_CONFIDENCE = 0.9;

/** The signals a record can carry. */
const SIGNALS: readonly InstinctRecord['signal'][] = ['loud', 'silent'];

/** The statuses a record can carry. */
const STATUSES: readonly InstinctRecord['status'][] = ['active', 'flagged'];

/**
 * A payload record as this adapter reads it: the port's record, and the
 * fields of the `.md` form it does not carry, for a record written with
 * no held member to take them from. See the module note.
 */
export interface DescribedInstinctRecord extends InstinctRecord {
  description?: HeldDescription;
}

/** One line of the push log: one merge decision. */
export interface PushLogLine {
  readonly source_id: string;
  readonly rule: MergeRule;
  /** The record as it was pushed, its `description` included. */
  readonly incoming: DescribedInstinctRecord;
  /** The ids its trigger is held as once the rule has applied. */
  readonly produced: readonly string[];
  /** The ids a higher-confidence action displaced on its trigger. */
  readonly discarded: readonly string[];
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
  /**
   * The home whose `.rafa/instincts` is the user scope a pull reads and
   * never writes. There is no default, so a caller that leaves it out
   * cannot reach the real home by accident; the registry passes
   * `homedir()` when its context names none.
   */
  readonly home: string;
  /** The lowest confidence a pulled record may carry, inclusive: `learning.bless.minConfidence`. */
  readonly minConfidence: number;
  /** Stamps each merge, each bundle's `version` and each flag, as ISO 8601. The system clock when left out. */
  readonly now?: () => string;
  /** Reports a held file skipped. The active output's `warn` when left out. */
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
  sources: [
    (value) => value === undefined
      || (Array.isArray(value) && value.every(isNonEmptyString)),
    'a list of non-empty strings when present',
  ],
  artifact: [(value) => value === undefined || typeof value === 'string', 'a string when present'],
  signal: [oneOf(SIGNALS), `one of: ${SIGNALS.join(', ')}`],
  status: [oneOf(STATUSES), `one of: ${STATUSES.join(', ')}`],
  promoted_to: [(value) => value === undefined || typeof value === 'string', 'a string when present'],
  created_at: [isString, 'a string'],
  updated_at: [isString, 'a string'],
} satisfies Record<keyof InstinctRecord, FieldCheck>;

/** A record description's checks, closed over its keys both ways. */
const DESCRIPTION_CHECKS = {
  kind: [oneOf(INSTINCT_KINDS), `one of: ${INSTINCT_KINDS.join(', ')}`],
  domain: [oneOf(INSTINCT_DOMAINS), `one of: ${INSTINCT_DOMAINS.join(', ')}`],
  scope: [oneOf(INSTINCT_SCOPES), `one of: ${INSTINCT_SCOPES.join(', ')}`],
  source: [oneOf(INSTINCT_SOURCES), `one of: ${INSTINCT_SOURCES.join(', ')}`],
  evidence: [(value) => Array.isArray(value) && value.every(isMapping), 'a list of mappings'],
  cause: [isString, 'a string'],
  projectId: [(value) => value === null || typeof value === 'string', 'a string or null'],
} satisfies Record<keyof HeldDescription, FieldCheck>;

/** A payload's checks, before each record's. */
const PAYLOAD_CHECKS = {
  source_id: [isNonEmptyString, 'a non-empty string'],
  instincts: [Array.isArray, 'a list'],
} satisfies Record<keyof SyncPayload, FieldCheck>;

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

/** The first thing wrong with one payload record, or null when nothing is. */
function recordProblem(record: unknown, index: number): string | null {
  const at = `instincts[${index}]`;
  const problem = fieldsProblem(record, INSTINCT_CHECKS, at);
  if (problem !== null) return problem;
  // Checked above: a record the port's checks accept.
  const { action, action_hash: hash, description } = record as DescribedInstinctRecord;
  if (hash !== actionHash(action)) {
    return `action_hash is ${describeValue(hash)} in ${at}, expected the sha256 of its trimmed, lower-cased action`;
  }
  return description === undefined
    ? null
    : fieldsProblem(description, DESCRIPTION_CHECKS, `${at}.description`);
}

/** The first thing wrong with a payload, or null when nothing is. */
function payloadProblem(payload: unknown): string | null {
  const problem = fieldsProblem(payload, PAYLOAD_CHECKS, 'the payload');
  if (problem !== null) return problem;
  // Checked above: a mapping holding a list of instincts.
  const { instincts } = payload as { instincts: readonly unknown[] };
  return instincts.map(recordProblem).find((found) => found !== null) ?? null;
}

/** The first thing wrong with a flag line's value, or null when nothing is. */
function flagProblem(value: unknown): string | null {
  return fieldsProblem(value, FLAG_CHECKS, 'the flag');
}

/** A record with the port's fields alone, in the port's order. */
function copyInstinct(record: InstinctRecord): InstinctRecord {
  const { sources, artifact, promoted_to: promotedTo } = record;
  return {
    id: record.id,
    trigger: record.trigger,
    action: record.action,
    action_hash: record.action_hash,
    confidence: record.confidence,
    usage_count: record.usage_count,
    ...(sources === undefined
      ? {}
      : { sources: [...sources] }),
    ...(artifact === undefined
      ? {}
      : { artifact }),
    signal: record.signal,
    status: record.status,
    ...(promotedTo === undefined
      ? {}
      : { promoted_to: promotedTo }),
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

/** A description with its own fields alone, in a fixed order. */
function copyDescription(description: HeldDescription): HeldDescription {
  return {
    kind: description.kind,
    domain: description.domain,
    scope: description.scope,
    source: description.source,
    evidence: description.evidence.map((entry) => ({ ...entry })),
    cause: description.cause,
    projectId: description.projectId,
  };
}

/** A pushed record as its push-log line holds it. */
function loggedIncoming(record: DescribedInstinctRecord): DescribedInstinctRecord {
  return record.description === undefined
    ? copyInstinct(record)
    : { ...copyInstinct(record), description: copyDescription(record.description) };
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

/** One held `.md` file that read clean. */
interface HeldFile {
  readonly path: string;
  readonly instinct: Instinct;
}

/** Every record in `records`, as the library reads them, whose id no flag names. */
function unflagged(records: readonly InstinctRecord[], flagged: ReadonlySet<string>): InstinctRecord[] {
  return records.filter((record) => !flagged.has(record.id));
}

/**
 * The user scope's blessed records a project bundle takes: those on a
 * trigger the project holds no record on, whose id the project holds no
 * record under and no flag names. See the module note.
 */
function userAdditions(
  userBlessed: readonly InstinctRecord[],
  projectHeld: readonly InstinctRecord[],
  flagged: ReadonlySet<string>,
): InstinctRecord[] {
  const heldTriggers = new Set(projectHeld.map((record) => triggerKey(record.trigger)));
  const heldIds = new Set(projectHeld.map((record) => record.id));
  return unflagged(userBlessed, flagged)
    .filter((record) => !heldTriggers.has(triggerKey(record.trigger)) && !heldIds.has(record.id));
}

/** The held set as one read found it. */
interface HeldSet {
  /** Every file that read clean, in file-name order. */
  readonly files: readonly HeldFile[];
  /** Every `.md` file the schema refused or nothing could open. */
  readonly unreadable: ReadonlySet<string>;
}

/** One file a push writes. */
interface FileWrite {
  readonly path: string;
  readonly text: string;
}

/** What a push does to the held set once every check has passed. */
interface HeldChanges {
  readonly writes: readonly FileWrite[];
  readonly removals: readonly string[];
}

/** Oldest first: by `created_at`, then `id`, as `merge` ages members. */
function byAge(left: InstinctRecord, right: InstinctRecord): number {
  if (left.created_at !== right.created_at) {
    return left.created_at < right.created_at
      ? -1
      : 1;
  }
  if (left.id === right.id) return 0;
  return left.id < right.id
    ? -1
    : 1;
}

/**
 * The description of the earliest payload record on `record`'s trigger
 * with its action that carries one, or undefined when none does.
 */
function payloadDescription(
  record: InstinctRecord,
  described: readonly DescribedInstinctRecord[],
): HeldDescription | undefined {
  const key = triggerKey(record.trigger);
  const members = described.filter((candidate) => candidate.description !== undefined
    && candidate.action_hash === record.action_hash
    && triggerKey(candidate.trigger) === key);
  return [...members].sort(byAge)[0]?.description;
}

/** Every record the decisions produced, once each, refusing two under one id. */
function producedRecords(result: MergeResult): InstinctRecord[] {
  const byId = new Map<string, InstinctRecord>();
  for (const record of result.decisions.flatMap((decision) => decision.produced)) {
    const found = byId.get(record.id);
    if (found !== undefined && found !== record) {
      throw new Error(`${PUSH_REFUSAL}: two records would be written to ${record.id}${RECORD_EXTENSION}`);
    }
    byId.set(record.id, record);
  }
  return [...byId.values()];
}

/**
 * What a push does to the held set: each produced record written, and
 * every other held file on a trigger the payload touched removed.
 * Throws the refusal for anything the module note refuses.
 */
function heldChanges(
  dir: string,
  held: HeldSet,
  result: MergeResult,
  described: readonly DescribedInstinctRecord[],
): HeldChanges {
  const heldInstincts = held.files.map((file) => file.instinct);
  const heldAt = new Map(held.files.map((file) => [file.path, file.instinct]));
  const writes: FileWrite[] = [];
  const kept = new Set<string>();
  for (const record of producedRecords(result)) {
    const file = `${record.id}${RECORD_EXTENSION}`;
    const instinct = toHeldInstinct(record, heldInstincts, payloadDescription(record, described));
    if (instinct === null) {
      throw new Error(`${PUSH_REFUSAL}: ${file} has no held member and no payload description to be written with`);
    }
    const text = writeInstinct(instinct);
    const [issue] = parseInstinct(text).issues;
    if (issue !== undefined) {
      throw new Error(`${PUSH_REFUSAL}: ${file} would not read back: ${issue.field}: ${issue.message}`);
    }
    const path = join(dir, file);
    if (held.unreadable.has(path)) {
      throw new Error(`${PUSH_REFUSAL}: it would overwrite ${path}, which could not be read`);
    }
    const before = heldAt.get(path);
    if (before !== undefined && triggerKey(before.trigger) !== triggerKey(record.trigger)) {
      throw new Error(`${PUSH_REFUSAL}: it would overwrite ${path}, which holds another trigger`);
    }
    kept.add(path);
    if (before === undefined || writeInstinct(before) !== text) writes.push({ path, text });
  }
  const touched = new Set(result.decisions.map((decision) => triggerKey(decision.incoming.trigger)));
  const removals = held.files
    .filter((file) => touched.has(triggerKey(file.instinct.trigger)) && !kept.has(file.path))
    .map((file) => file.path);
  return { writes, removals };
}

/** One push-log line per decision, in the payload's order. */
function pushLogLines(
  sourceId: string,
  described: readonly DescribedInstinctRecord[],
  result: MergeResult,
): string[] {
  return result.decisions.map((decision, index) => {
    const key = triggerKey(decision.incoming.trigger);
    const line: PushLogLine = {
      source_id: sourceId,
      rule: decision.rule,
      incoming: loggedIncoming(described[index]!),
      produced: decision.produced.map((record) => record.id),
      discarded: result.discarded
        .filter((record) => triggerKey(record.trigger) === key)
        .map((record) => record.id),
    };
    return JSON.stringify(line);
  });
}

/** Where `local` instincts live under a repository: `.rafa/instincts/`. */
export function localInstinctsDir(repoRoot: string): string {
  return join(repoRoot, RAFA_INSTINCTS_PATH);
}

/** The user scope a pull reads under a home: `~/.rafa/instincts/`. */
export function userInstinctsDir(home: string): string {
  return join(home, RAFA_INSTINCTS_PATH);
}

/** Makes a `local` learning adapter over `options.instinctsDir`; see the module note. */
export function createLocalLearning(options: LocalLearningOptions): Learning {
  const { instinctsDir, minConfidence } = options;
  const userDir = userInstinctsDir(options.home);
  const now = options.now ?? ((): string => new Date().toISOString());
  const warn = options.warn ?? warnThroughActiveOutput;
  const instinctsPath = join(instinctsDir, INSTINCTS_FILE);
  const flagsPath = join(instinctsDir, FLAGS_FILE);

  /** One scope's `.md` records, each file that cannot be read reported and left out. */
  function readHeld(scope: InstinctScope, dir: string): HeldSet {
    const { records } = readScope(scope, dir);
    const unreadable = new Set<string>();
    const files: HeldFile[] = [];
    for (const entry of records) {
      if (entry.instinct === null) {
        unreadable.add(entry.path);
        const problems = entry.issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ');
        warn(`${PREFIX}: ${entry.path} is not a held instinct, so it was skipped: ${problems}`);
      } else {
        files.push({ path: entry.path, instinct: entry.instinct });
      }
    }
    return { files, unreadable };
  }

  /** The project's held set. */
  function heldSet(): HeldSet {
    return readHeld('project', instinctsDir);
  }

  /** One scope's records as the library reads them. */
  function heldRecords(held: HeldSet): InstinctRecord[] {
    return toHeldRecords(held.files.map((file) => file.instinct));
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
        throw new TypeError(`${PUSH_REFUSAL}: ${problem}`);
      }
      // Checked by `payloadProblem`, a `description` included.
      const described = payload.instincts as readonly DescribedInstinctRecord[];
      const held = heldSet();
      const result = merge(
        toHeldRecords(held.files.map((file) => file.instinct)),
        { source_id: payload.source_id, instincts: described.map(copyInstinct) },
        now(),
      );
      const changes = heldChanges(instinctsDir, held, result, described);
      const lines = pushLogLines(payload.source_id, described, result);
      if (lines.length > 0) {
        await mkdir(instinctsDir, { recursive: true });
        await appendLines(instinctsPath, lines);
      }
      for (const { path, text } of changes.writes) {
        await writeFile(path, text, 'utf8');
      }
      for (const path of changes.removals) {
        await rm(path, { force: true });
      }
      return result;
    },

    pullBlessed: async (): Promise<BlessedBundle> => {
      const flagged = await flaggedIds();
      const projectHeld = heldRecords(heldSet());
      const project = bless(unflagged(projectHeld, flagged), { minConfidence }).instincts;
      const user = bless(heldRecords(readHeld('user', userDir)), { minConfidence }).instincts;
      return { version: now(), instincts: [...project, ...userAdditions(user, projectHeld, flagged)] };
    },

    flag: async (id: string, reason: string): Promise<void> => {
      const flag: HeldFlag = { id, reason, flagged_at: now() };
      const problem = flagProblem(flag);
      if (problem !== null) {
        throw new TypeError(`${PREFIX}: refused to write an invalid flag: ${problem}`);
      }
      if (!heldSet().files.some((file) => file.instinct.id === id)) {
        throw new Error(`${PREFIX}: no instinct ${describeValue(id)} is held under ${instinctsDir}`);
      }
      await appendLines(flagsPath, [JSON.stringify(flag)]);
    },
  };
  return Object.freeze(learning);
}
