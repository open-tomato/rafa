/**
 * The search runner: the whole of `rafa skill search` and
 * `rafa agent search` short of printing, as two code steps around one
 * Claude session.
 *
 * {@link runSearch} ranks the inventory by the question's words
 * (`rank.ts`), copies the ranked files into a scratch directory
 * (`scratch.ts`), runs ONE session in it with the fixed template
 * (`prompt.ts`), reads the `rafa:search` block it ends with
 * (`block.ts`), keeps each match whose quote is in its file near its
 * line (`quote.ts`), and stores one effort row of kind `search`. What it
 * answers is a {@link SearchOutcome}; the commands print it.
 * {@link rankSearch} is step one alone, which is what `--no-model` runs.
 *
 * ## The session
 *
 * The session is spawned through the capturing door
 * (`src/utils/claude.ts`), under the run's `loop.settingSources`, with
 * the argument list {@link searchFlags} builds: `--session-id` with an
 * id the runner picks, `--model` {@link SEARCH_MODEL}, and `--tools`
 * naming {@link SEARCH_TOOLS} and nothing else. `--tools` is variadic,
 * so it goes last, as every other session's does. Its working directory
 * is the scratch copy, so the files the template lists are found by the
 * relative paths it gives, and the copy is removed once the session and
 * the quote check are done, whatever became of either.
 *
 * The quote check reads the COPIES, before the removal: those are the
 * files the session read, so a `line` it gives counts against the text
 * it was looking at.
 *
 * ## One outcome per run
 *
 *   - `no-candidates`: no record scored above zero, so there is nothing
 *     to hand a session and none is started.
 *   - `answered`: the block was read. The kept matches, each with its
 *     record, in the order written; how many the quote check dropped;
 *     and the block parser's issues, one per entry it could not use.
 *   - `unanswerable`: the block said `unanswerable: true`.
 *   - `fallback`: the session exited non-zero, or its output held no
 *     readable block. The outcome carries the ranking and a
 *     {@link SearchFallback.notice} saying why it is shown instead. A
 *     non-zero exit falls back even when a block was written: a session
 *     that failed is not read as having answered.
 *
 * Every outcome carries the ranking, so a command can always print it.
 * A spawner that throws, the spend guard's refusal included, rejects
 * the run with that error once the copy is removed; it is not a
 * fallback, because nothing ran.
 *
 * ## Which records rank
 *
 * Only records of the kind searched, and of each name only the FIRST
 * record given. The inventory lists a name's holders nearest source
 * first, so that is the one a session would load, and every later one
 * is `shadowed-by:` it. A second holder could not be told apart from
 * the first in the block anyway, whose `name` is the only key a match
 * has, and the scratch copy refuses a repeated name.
 *
 * ## The effort row
 *
 * `rafa effort collect` walks the log directory of the project it runs
 * in, and a search session's log is not there: Claude Code files it
 * under the directory it ran in, the scratch copy. So the runner stores
 * the row itself, once the session has exited, from
 * `<home>/.claude/projects/<encoded scratch path>/<session id>.jsonl`,
 * read by the collector's own `collectSessionRow` and appended to the
 * store the caller passes under `sessions`.
 *
 * The scratch path is encoded as its REAL path. Measured on macOS
 * 2026-09-24: under `~/.claude/projects` every session run in `/tmp`
 * is filed as `-private-tmp...`, the real path of `/tmp`, and a child
 * spawned with its cwd under `/var/folders/...` reads its own cwd as
 * `/private/var/folders/...`; `tmpdir()` answers the unresolved form.
 *
 * The row's `kind` is set to `search` rather than read off the prompt:
 * the runner knows what it ran, and a log whose first record the
 * classifier cannot place would otherwise be stored as `other`. The row
 * is written for every session that ran, `fallback` outcomes included,
 * since a session that answered nothing usable was still paid for. It
 * is never a reason to fail a search: {@link SearchEffortWrite} says
 * whether it was written, and why not.
 *
 * The log directory is left behind: it is Claude Code's, one per
 * search, and removing it would take the evidence the row was read
 * from.
 */
import type { SearchBlockIssue, SearchMatch } from './block.js';
import type { RankedCandidate } from './rank.js';
import type { ScratchCopy } from './scratch.js';
import type { ClaudeSettingSource } from '../../config.js';
import type { EffortStore, SessionEffortRow } from '../../effort/store/types.js';
import type { CapturedSession, CapturingSpawner } from '../../utils/claude.js';
import type { InventoryKind, InventoryRecord } from '../record.js';

import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { collectSessionRow, sessionLogDir } from '../../effort/collect.js';
import { SESSION_ID_FLAG } from '../../start/dispatch.js';
import { claudeArgs, spawnClaudeCaptured } from '../../utils/claude.js';

import { parseSearchBlock } from './block.js';
import { renderSearchPrompt } from './prompt.js';
import { checkQuotes } from './quote.js';
import { rankCandidates, readRankCandidate } from './rank.js';
import { withScratchCopy } from './scratch.js';

/** The model alias the search session runs on: the cheapest. */
export const SEARCH_MODEL = 'haiku';

/** The only tools the search session is given. */
export const SEARCH_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob'];

/** What `unanswerable: true` prints. */
export const UNANSWERABLE_TEXT = 'not answerable from these files';

/** One kept match with the record it names. */
export interface SearchResultMatch extends SearchMatch {
  readonly record: InventoryRecord;
}

/** Whether the run's effort row was stored, and why not. */
export type SearchEffortWrite =
  | { readonly written: true; readonly sessionId: string; readonly storePath: string }
  | { readonly written: false; readonly sessionId: string; readonly reason: string };

/** No record ranked, so no session ran. */
export interface SearchNoCandidates {
  readonly status: 'no-candidates';
  readonly ranking: readonly RankedCandidate[];
}

/** What every outcome of a session that ran carries. */
interface SessionOutcome {
  readonly ranking: readonly RankedCandidate[];
  readonly effort: SearchEffortWrite;
}

/** The block was read and its matches checked. */
export interface SearchAnswered extends SessionOutcome {
  readonly status: 'answered';
  /** The matches whose quote was found, in the order written. */
  readonly matches: readonly SearchResultMatch[];
  /** How many usable matches the quote check dropped. */
  readonly dropped: number;
  /** The block parser's issues, one per entry it could not use. */
  readonly issues: readonly SearchBlockIssue[];
}

/** The block said no candidate answers the question. */
export interface SearchUnanswerable extends SessionOutcome {
  readonly status: 'unanswerable';
  /** {@link UNANSWERABLE_TEXT}. */
  readonly text: string;
}

/** The session gave no usable answer; the ranking is shown instead. */
export interface SearchFallback extends SessionOutcome {
  readonly status: 'fallback';
  /** One sentence saying why the ranking is shown. */
  readonly notice: string;
}

/** What {@link runSearch} answers; see the module note. */
export type SearchOutcome = SearchNoCandidates | SearchAnswered | SearchUnanswerable | SearchFallback;

/** What one search is run with. */
export interface SearchOptions {
  /** Whether skills or agents are searched. */
  readonly kind: InventoryKind;
  /** The question as the person typed it. */
  readonly question: string;
  /** The inventory, nearest source first within a name. */
  readonly records: readonly InventoryRecord[];
  /** The run's resolved `loop.settingSources`. No default; see `claudeArgs`. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** The store the `search` row is appended to. */
  readonly store: EffortStore;
  /** The home Claude Code files session logs under. No default. */
  readonly home: string;
  /** The session spawner. Defaults to the real capturing door. */
  readonly spawn?: CapturingSpawner;
  /** Where the scratch copy is made. Defaults to the temp directory. */
  readonly scratchRoot?: string;
  /** Picks the session's id. Defaults to `randomUUID`. */
  readonly sessionId?: () => string;
}

/** The flags the search session is spawned with, `--tools` last. */
export function searchFlags(sessionId: string): string[] {
  return [SESSION_ID_FLAG, sessionId, '--model', SEARCH_MODEL, '--tools', SEARCH_TOOLS.join(',')];
}

/** The first record of each name, of `kind` only; see the module note. */
function searchableRecords(
  kind: InventoryKind,
  records: readonly InventoryRecord[],
): InventoryRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (record.kind !== kind || seen.has(record.name)) return false;
    seen.add(record.name);
    return true;
  });
}

/** Step one alone: `records` of `kind` ranked by `question`, at most twelve. */
export function rankSearch(
  kind: InventoryKind,
  question: string,
  records: readonly InventoryRecord[],
): readonly RankedCandidate[] {
  const candidates = searchableRecords(kind, records).map((record) => readRankCandidate(record));
  return rankCandidates(question, candidates);
}

/**
 * The line a dropped count prints as: `1 match dropped: its quote is
 * not in the file`, or the plural. Empty for zero.
 */
export function droppedLine(count: number): string {
  if (count === 0) return '';
  return count === 1
    ? '1 match dropped: its quote is not in the file'
    : `${count} matches dropped: their quotes are not in their files`;
}

/** The message of whatever was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/**
 * Stores the session's row from its log at `logPath`, kind `search`.
 * Never throws; see the module note.
 */
async function writeSearchEffort(
  store: EffortStore,
  logPath: string,
  sessionId: string,
): Promise<SearchEffortWrite> {
  if (!existsSync(logPath)) {
    return { written: false, sessionId, reason: `no session log at ${logPath}` };
  }
  try {
    const stats = statSync(logPath);
    const candidate = { path: logPath, sessionId, sizeBytes: stats.size, modifiedAtMs: stats.mtimeMs };
    const collected = await collectSessionRow(candidate, []);
    const row: SessionEffortRow = { ...collected, kind: 'search' };
    const result = store.append('sessions', [row]);
    if (result.appended === 0) {
      return { written: false, sessionId, reason: `the store already holds session ${sessionId}` };
    }
    return { written: true, sessionId, storePath: result.path };
  } catch (error) {
    return { written: false, sessionId, reason: `session log ${logPath} did not store: ${messageOf(error)}` };
  }
}

/** The outcome a session's answer reads as, before the effort row. */
type Answer =
  | Omit<SearchAnswered, 'ranking' | 'effort'>
  | Omit<SearchUnanswerable, 'ranking' | 'effort'>
  | Omit<SearchFallback, 'ranking' | 'effort'>;

/** How a fallback notice ends. */
const FALLBACK_TAIL = 'showing the keyword ranking instead';

/** Reads the session's answer and checks its quotes against the copies. */
async function readAnswer(
  session: CapturedSession,
  ranking: readonly RankedCandidate[],
  scratch: ScratchCopy,
): Promise<Answer> {
  if (session.exitCode !== 0) {
    return { status: 'fallback', notice: `the search session exited ${session.exitCode}; ${FALLBACK_TAIL}` };
  }
  const reading = parseSearchBlock(session.stdout, ranking.map((ranked) => ranked.record.name));
  if (!reading.present) {
    return { status: 'fallback', notice: `${reading.text}; ${FALLBACK_TAIL}` };
  }
  if (reading.unanswerable) return { status: 'unanswerable', text: UNANSWERABLE_TEXT };

  const { kept, dropped } = await checkQuotes(reading.matches, scratch.paths);
  const records = new Map(ranking.map((ranked) => [ranked.record.name, ranked.record]));
  const matches = kept.flatMap((match) => {
    const record = records.get(match.name);
    return record === undefined
      ? []
      : [{ ...match, record }];
  });
  return { status: 'answered', matches, dropped, issues: reading.issues };
}

/**
 * Runs one search: rank, scratch copy, one session, the block, the quote
 * check and the `search` effort row. See the module note for each
 * outcome. Rejects only when the spawner does, after removing the copy.
 */
export async function runSearch(options: SearchOptions): Promise<SearchOutcome> {
  const ranking = rankSearch(options.kind, options.question, options.records);
  if (ranking.length === 0) return { status: 'no-candidates', ranking };

  const spawn = options.spawn ?? spawnClaudeCaptured;
  const sessionId = (options.sessionId ?? randomUUID)();
  const scratchCandidates = ranking.map(({ record }) => ({ name: record.name, path: record.path }));

  const { answer, logPath } = await withScratchCopy(scratchCandidates, async (scratch) => {
    const prompt = renderSearchPrompt({
      kind: options.kind,
      question: options.question,
      candidates: ranking.map(({ record }) => ({
        name: record.name,
        file: relative(scratch.dir, scratch.paths.get(record.name) ?? record.path),
      })),
    });
    const logDir = sessionLogDir(realpathSync(scratch.dir), options.home);
    const args = claudeArgs(options.settingSources, searchFlags(sessionId));
    const session = await spawn(args, prompt, { cwd: scratch.dir });
    return {
      answer: await readAnswer(session, ranking, scratch),
      logPath: join(logDir, `${sessionId}.jsonl`),
    };
  }, options.scratchRoot);

  const effort = await writeSearchEffort(options.store, logPath, sessionId);
  return { ...answer, ranking, effort };
}
