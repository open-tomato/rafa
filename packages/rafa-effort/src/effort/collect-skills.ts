/**
 * The skill half of `rafa effort collect`: which skills each session
 * invoked, read off its logs by `skill-use.ts` and written to the
 * `skill_invocations` table by `store/skill-invocations.ts`.
 *
 * ## Which sessions it reads
 *
 * {@link SkillScope} names the two populations. `appended` is the default
 * and follows the session half: the sessions whose logs this run read
 * into a session row, so a collect counts the skills of what it collects
 * and nothing it did not. `held`, which `--skills` selects, is every
 * session the store already holds a row for whose log is still in the
 * log directory, inside the `--since` window, so the sessions collected
 * before this half existed can be counted once. `collect.ts` picks the
 * logs; this module is handed them.
 *
 * Either way, a session that already holds a `skill_invocations` row is
 * not read again: the writer would skip it whole anyway, so reading it
 * would only cost the read. That makes `--skills` incremental the way the
 * session half is. A session read and found to invoke no skill holds no
 * row, so a later `--skills` reads it again and again finds none; that is
 * the price of storing no row for nothing.
 *
 * ## Where it lands
 *
 * `skill_invocations` is one of the SQLite-only tables, so this half
 * writes `effort.sqlite` under the repo root whichever backend `store`
 * selects, beside the NDJSON files a `store: ndjson` run writes. A
 * session with a record logged below `SKILL_USE_CLI_FLOOR` (2.1.280) is
 * stored as an `unknown` row, never as 0, and counted here under
 * `unknown` alone. A session read by skill name whose records do not all
 * carry `SKILL_USE_FIXTURE_VERSION` (2.1.280), the version its recorded
 * fixture was logged under, is stored by name like a vouched one and
 * counted here under `unvouched` too, so a run says how many of its
 * counts rest on a log shape no fixture has pinned. Under `--verbose`
 * each read names the session's versions and which of the three it is,
 * as in `skills: read <id> (2.1.316, unvouched)`.
 *
 * ## Failures
 *
 * A log that throws while being read is counted under `failed`, reported
 * through the run's log sink, and written nothing for, as the session
 * half counts its own. The write itself is not caught: every value it
 * refuses comes from code, so a refusal is a fault, not a reading.
 */
import type { SkillUseOutcome } from './skill-use.js';

import { readSkillInvocations, UNKNOWN_SKILL_COUNT, writeSkillInvocations } from '@open-tomato/rafa/store/skill-invocations';

import { readSkillUse } from './skill-use.js';

/** The sessions the skill half reads: the ones this run appended, or every one the store holds. */
export type SkillScope = 'appended' | 'held';

/** One session log the skill half is handed. */
export interface SkillLog {
  /** The session's main log, `<dir>/<session>.jsonl`. */
  readonly path: string;
  /** The log's basename, the session row's id. */
  readonly sessionId: string;
}

/** What the skill half did. */
export interface SkillCollectSummary {
  /** Which sessions it was handed. */
  scope: SkillScope;
  /** The store file the write targeted, `effort.sqlite` under the repo root. */
  storePath: string;
  /** Session logs handed to it. */
  candidates: number;
  /** Of those, the sessions already holding a row, not read again. */
  alreadyCounted: number;
  /** Logs read without error. */
  read: number;
  /** Of the logs read, the ones stored by skill name whose reading is not vouched for. */
  unvouched: number;
  /** Of the logs read, the ones whose count is unknown. */
  unknown: number;
  /** Logs that threw while being read; counted, never swallowed. */
  failed: number;
  /** Rows written. */
  appended: number;
  /** Rows not written because their session held a row by the time of the write. */
  skippedOnAppend: number;
}

/** What the skill half is handed. */
export interface SkillHalfInput {
  /** The project root the store sits under. */
  readonly repoRoot: string;
  /** Which sessions `logs` are, for the summary. */
  readonly scope: SkillScope;
  /** The session logs in scope, in the order they are read. */
  readonly logs: readonly SkillLog[];
  /** Sink for failures, always written. */
  readonly log: (line: string) => void;
  /** Sink for progress, written under `--verbose`. */
  readonly note: (line: string) => void;
}

/** An error's message, however it was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/**
 * What `--verbose` says of one reading: its versions, and whether it is
 * vouched for, unvouched, or unknown.
 */
function readingNote(reading: SkillUseOutcome): string {
  const versions = reading.versions.length === 0
    ? 'no version'
    : reading.versions.join(', ');
  const standing = reading.uses === UNKNOWN_SKILL_COUNT
    ? 'unknown'
    : reading.vouched
      ? 'vouched'
      : 'unvouched';
  return `skills: read ${reading.sessionId} (${versions}, ${standing})`;
}

/** The sessions that already hold a `skill_invocations` row. */
function countedSessions(repoRoot: string): Set<string> {
  return new Set(readSkillInvocations(repoRoot).map((row) => row.sessionId));
}

/**
 * Reads the skill use of each log not yet counted and writes it in one
 * write. Opens no store when handed no log.
 */
export async function collectSkillHalf(input: SkillHalfInput): Promise<SkillCollectSummary> {
  const counted = input.logs.length === 0
    ? new Set<string>()
    : countedSessions(input.repoRoot);
  const pending = input.logs.filter((log) => !counted.has(log.sessionId));

  const readings: SkillUseOutcome[] = [];
  let failed = 0;
  for (const log of pending) {
    try {
      const reading = await readSkillUse(log.path);
      readings.push(reading);
      input.note(readingNote(reading));
    } catch (error) {
      failed += 1;
      input.log(`skills: FAILED ${log.path}: ${messageOf(error)}`);
    }
  }

  const written = writeSkillInvocations(input.repoRoot, readings);
  return {
    scope: input.scope,
    storePath: written.path,
    candidates: input.logs.length,
    alreadyCounted: input.logs.length - pending.length,
    read: readings.length,
    unvouched: readings.filter((reading) => reading.uses !== UNKNOWN_SKILL_COUNT && !reading.vouched).length,
    unknown: readings.filter((reading) => reading.uses === UNKNOWN_SKILL_COUNT).length,
    failed,
    appended: written.appended,
    skippedOnAppend: written.skipped,
  };
}

/** The summary line of the skill half, or of it not running. */
export function formatSkillSummary(skills: SkillCollectSummary | null): string {
  if (skills === null) return '  skills    skipped (--no-sessions)';
  const scope = skills.scope === 'held'
    ? 'stored'
    : 'appended';
  return `  skills    ${skills.candidates} ${scope} sessions`
    + `, ${skills.alreadyCounted} already counted`
    + `, ${skills.read} read`
    + `, ${skills.unvouched} unvouched`
    + `, ${skills.unknown} unknown`
    + `, ${skills.failed} failed`
    + `, +${skills.appended} rows`;
}
