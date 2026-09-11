/**
 * Folds the session and commit collectors into one incremental run.
 *
 * The four sibling modules each answer one question — what a session
 * log holds, what it was dispatched to do, which plan it belongs to,
 * what a commit changed. This one walks the session log directory and
 * the commit history, skips whatever the store already holds, and
 * appends the rest. It owns no parsing of its own: everything it
 * writes is a projection of what those modules answered.
 *
 * ## Where the session logs are
 *
 * Claude Code files a project's logs under
 * `~/.claude/projects/<encoded repo root>/`, where the encoding
 * replaces every `/` and `.` with a hyphen. That is measured off the
 * live directory rather than assumed: this repo's root encodes as
 * `-Users-marcos-projects-agentic-research`, and a sibling entry for
 * `<root>/.claude/worktrees/<name>` encodes as
 * `...-agentic-research--claude-worktrees-<name>` — the doubled
 * hyphen being the slash and the dot of `/.claude` in turn. Only
 * those two characters are known to be replaced; anything else in a
 * path is untested here, so {@link CollectOptions.logDir} exists as
 * the override rather than the derivation being widened on a guess.
 *
 * The population is DEPTH-DEFINED and that is the whole reason
 * {@link listSessionLogs} reads one directory instead of walking.
 * Loose `*.jsonl` files at the top of that directory are sessions;
 * `<session-uuid>/subagents/agent-*.jsonl` one level down are subagent
 * transcripts. A recursive walk folds the second population into the
 * first silently — the counts stay plausible, the token totals double
 * -count every subagent turn already billed to its parent, and
 * nothing in the output says so.
 *
 * ## What incrementality is keyed on
 *
 * A session row's key is the session id, which is the log's basename.
 * One row per session, ever.
 *
 * The consequence is worth stating rather than discovering: a session
 * still being APPENDED TO when it is collected is frozen at whatever
 * it held, and no later run will revisit it — the append-only store
 * dedupes by that same key, so a second read would be discarded even
 * if one were taken. The repair is to delete the store file and
 * re-collect; the rows are a measurement of one machine's runs and
 * are regenerable from the logs at any time.
 *
 * Widening the key with a size or a line count would collect the
 * grown log again, and that is worse rather than better: nothing in
 * an append-only store can retract the first row, so the session
 * would then be counted TWICE by every report that sums rows —
 * silently, and with both rows looking well-formed. A frozen row is
 * visible instead, because {@link SessionEffortRow.sizeBytes} and
 * {@link SessionEffortRow.modifiedAt} are recorded beside the
 * counters: a row whose size is short of the file on disk is a row
 * taken mid-session.
 *
 * ## `--since` is one instant, resolved once
 *
 * The flag is parsed with `Date.parse` and REFUSED when that fails.
 * Handing the raw string to git instead would look more capable and
 * be a trap: git's approxidate resolves an unreadable string to NOW
 * rather than failing — measured, `--since=qqqq` and
 * `--since='not a date at all'` both resolve to the current second —
 * so a typo would collect zero commits, exit 0, and print a summary
 * that reads exactly like an up-to-date store. A refusal is the only
 * answer that cannot be mistaken for a clean run.
 *
 * Resolving it once is also what keeps the two halves talking about
 * the same window: the session half compares the resolved epoch
 * against each log's mtime, and the commit half hands git the ISO
 * form of that same epoch, so neither half re-parses anything.
 *
 * ## What the commit half walks
 *
 * With no `--since` the walk is the whole history reachable from
 * HEAD. That is deliberate even though almost every row is then
 * skipped: `minutesSincePrevious` is a property of the RANGE, so a
 * full walk measures every gap against its true predecessor while a
 * bounded one gives its oldest commit a null. Append-only means that
 * null is permanent — a later full run re-derives the real gap and
 * the append is dropped on the sha it already holds. So the first
 * collect on a store should be unbounded; `--since` is for topping
 * one up.
 *
 * No revision range is passed, so `%S` answers `HEAD` and the row's
 * `branch` is null throughout. That is the honest answer rather than
 * a missing feature: `%S` is the ref a WALK reached a commit from and
 * not a property of the commit, so naming a branch would stamp it
 * onto every ancestor the branch shares with main. Per-plan
 * attribution runs through the sessions instead, where `gitBranch` is
 * a field on the record. A caller that wants `%S` populated can pass
 * its own reader through {@link CollectOptions.readCommits}.
 *
 * ## Two reads per session log, on purpose
 *
 * The head scan for the enqueue record and the full fold are separate
 * passes over the same file. The first is bounded to ten lines and
 * tears its stream down at the match, so the cost is one extra open;
 * the alternative is teeing one line source into two consumers, which
 * buys a few milliseconds across the tree and costs the property that
 * makes both sibling modules testable — each takes a plain
 * `AsyncIterable<string>` and consumes it exactly once.
 *
 * ## Refusals
 *
 * An unrecognised argument is an error rather than an ignored token.
 * A mistyped `--no-sessons` would otherwise collect sessions while
 * the operator read the summary as proof they had been skipped, and
 * that is the same class of silent-success failure the `--since`
 * refusal above exists to prevent. `--no-git` together with
 * `--no-sessions` is refused for the same reason: it leaves nothing
 * to collect, and a zero-row run that looks successful is worse than
 * a message.
 *
 * An EMPTY plan roster is not refused — `.plans/` is gitignored and
 * legitimately absent on a fresh clone — but it makes every session's
 * `planStub` resolve to null, which reads as a collector that failed
 * to attribute anything. The roster size is reported for that reason.
 */
import type { PlanStubMatch } from './attribution.js';
import type { SessionKind } from './classify.js';
import type {
  CommitLogOptions,
  CommitLogParseResult,
  CommitStats,
} from './commits.js';
import type { SessionStats } from './session-log.js';

import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { getRepoRoot } from '../utils/git.js';

import { attributeSession, planStubsFromFileNames } from './attribution.js';
import { findFirstEnqueue } from './classify.js';
import { readCommitLog } from './commits.js';
import {
  readLines,
  readSessionLog,
  sessionIdFromPath,
} from './session-log.js';
import { effortStorePath, openEffortStore } from './store.js';

/**
 * Path characters the project log directory name replaces.
 *
 * Both are measured against the live directory; see the module note
 * on why the class is not widened past what was observed.
 */
const LOG_DIR_SEPARATORS = /[/\\.]/g;

/** A session log by name; a directory so named is excluded by stat. */
const SESSION_LOG_NAME = /\.jsonl$/i;

/** Where Claude Code files per-project logs, under the home directory. */
const PROJECT_LOG_ROOT = ['.claude', 'projects'] as const;

/** The plan directory, relative to the repo root. */
const PLANS_DIR = '.plans';

/** One stats row widened with everything attribution answered. */
export interface SessionEffortRow extends SessionStats {
  /** What the session was dispatched to do. */
  kind: SessionKind;
  /** The modal branch of the session's records, or null. */
  branch: string | null;
  /** Records carrying it, and how many distinct branches were seen. */
  branchRecordCount: number;
  distinctBranchCount: number;
  /** The branch split; the stub is not yet a plan stub. */
  branchType: string | null;
  branchStub: string | null;
  /** The resolved plan, or null — never the branch stub as a fallback. */
  planStub: string | null;
  planStubMatch: PlanStubMatch;
  /** The dispatched task sentence, for a task session only. */
  taskText: string | null;
  /** Index of the enqueue among parsed records, or null if none. */
  enqueueRecordIndex: number | null;
  /** File size at collection; short of the file means a frozen row. */
  sizeBytes: number;
  /** File mtime at collection, ISO 8601. */
  modifiedAt: string;
}

/** One session log the walk found, before anything has been read. */
export interface SessionLogCandidate {
  path: string;
  /** Basename without the extension, which is the session uuid. */
  sessionId: string;
  sizeBytes: number;
  modifiedAtMs: number;
}

/** Candidates split into the three buckets, which partition them. */
export interface SessionSelection {
  /** To be read. */
  pending: SessionLogCandidate[];
  /** Held by the store already. */
  alreadyCollected: SessionLogCandidate[];
  /** Older than the resolved `--since` instant. */
  outsideWindow: SessionLogCandidate[];
}

/** Commit rows split by whether the store already holds them. */
export interface CommitSelection {
  pending: CommitStats[];
  alreadyCollected: CommitStats[];
}

/** What the parsed argv asked for. */
export interface CollectArgs {
  /** The `--since` value as given, for reporting. */
  since: string | null;
  /** The same instant, resolved once and shared by both halves. */
  sinceEpochMs: number | null;
  collectSessions: boolean;
  collectCommits: boolean;
  verbose: boolean;
  /** Every refusal, so all of them are reported and not just the first. */
  errors: string[];
}

/** What the session half did. */
export interface SessionCollectSummary {
  logDir: string;
  storePath: string;
  /** Plan stubs the roster held; zero attributes nothing. */
  planStubCount: number;
  /** Loose `*.jsonl` files found. */
  candidates: number;
  outsideWindow: number;
  alreadyCollected: number;
  /** Logs read without error. */
  read: number;
  /** Logs that threw while being read; counted, never swallowed. */
  failed: number;
  appended: number;
  /**
   * Rows the store declined on a key it already held. Must be zero:
   * the pending set was built from the same key projection, so
   * anything here means the two disagreed.
   */
  skippedOnAppend: number;
}

/** What the commit half did. */
export interface CommitCollectSummary {
  storePath: string;
  /** The `--since` argument handed to git, ISO, or null. */
  since: string | null;
  parsedRows: number;
  /** Non-blank log lines that were neither a header nor a stat line. */
  unparsedLineCount: number;
  alreadyCollected: number;
  appended: number;
  /** Must be zero, for the reason on the session summary's field. */
  skippedOnAppend: number;
}

/** One collect run. A half that was switched off answers null. */
export interface CollectResult {
  repoRoot: string;
  sessions: SessionCollectSummary | null;
  commits: CommitCollectSummary | null;
}

/** How a run is bounded and where it reads from. */
export interface CollectOptions {
  /** Defaults to the git repo root. Governs the store and git's cwd. */
  repoRoot?: string;
  /** Defaults to the derived project log directory. */
  logDir?: string;
  /** Defaults to `<repoRoot>/.plans`. */
  plansDir?: string;
  /** The resolved `--since` instant, shared by both halves. */
  sinceEpochMs?: number | null;
  collectSessions?: boolean;
  collectCommits?: boolean;
  verbose?: boolean;
  /** Sink for progress and errors. Defaults to `console.log`. */
  log?: (line: string) => void;
  /** Commit reader seam, so a test needs no repository. */
  readCommits?: (options: CommitLogOptions) => CommitLogParseResult;
}

/** Everything the two halves share, resolved once. */
interface HalfContext {
  repoRoot: string;
  logDir: string;
  plansDir: string;
  sinceEpochMs: number | null;
  log: (line: string) => void;
  note: (line: string) => void;
  readCommits: (options: CommitLogOptions) => CommitLogParseResult;
}

/** Encodes a repo root the way Claude Code names its log directory. */
export function projectLogDirName(repoRoot: string): string {
  return repoRoot.replace(LOG_DIR_SEPARATORS, '-');
}

/** The session log directory for one repo root. */
export function sessionLogDir(
  repoRoot: string,
  home: string = homedir(),
): string {
  return join(home, ...PROJECT_LOG_ROOT, projectLogDirName(repoRoot));
}

/** The store's key projection for a session row. */
export function sessionRowKey(
  row: Pick<SessionEffortRow, 'sessionId'>,
): string {
  return row.sessionId;
}

/** The store's key projection for a commit row. */
export function commitRowKey(row: Pick<CommitStats, 'sha'>): string {
  return row.sha;
}

/**
 * Lists the loose session logs in one directory.
 *
 * One directory read, never a walk — see the module note on the depth
 * rule. Entries are stat'd here rather than at read time so the
 * `--since` filter and the row's own size and mtime come from one
 * reading, and so the whole selection below is pure over the result.
 *
 * A missing directory THROWS rather than answering an empty list: an
 * empty answer is what a wrong derivation and a repo with no sessions
 * both look like, and only one of those is worth reporting as a clean
 * run of zero.
 */
export function listSessionLogs(dir: string): SessionLogCandidate[] {
  if (!existsSync(dir)) {
    throw new Error(
      `effort collect: no session log directory at ${dir}`
      + ' (pass logDir, or run with --no-sessions)',
    );
  }

  const candidates: SessionLogCandidate[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!SESSION_LOG_NAME.test(entry.name)) continue;

    const path = join(dir, entry.name);
    const stats = statSync(path);
    candidates.push({
      path,
      sessionId: sessionIdFromPath(path),
      sizeBytes: stats.size,
      modifiedAtMs: stats.mtimeMs,
    });
  }
  return sortCandidates(candidates);
}

/**
 * Oldest first, ties broken by id.
 *
 * Deterministic on purpose: the store is append-only, so this is also
 * the order rows are written in, and two runs over the same tree
 * should not produce two different files.
 */
function sortCandidates(
  candidates: SessionLogCandidate[],
): SessionLogCandidate[] {
  return candidates.sort((a, b) => {
    if (a.modifiedAtMs !== b.modifiedAtMs) {
      return a.modifiedAtMs - b.modifiedAtMs;
    }
    if (a.sessionId === b.sessionId) return 0;
    return a.sessionId < b.sessionId
      ? -1
      : 1;
  });
}

/**
 * Splits candidates into the three buckets.
 *
 * The window is tested BEFORE the store, so the buckets are disjoint
 * by precedence rather than by luck and their sizes sum to the
 * candidate count. A log exactly ON the `--since` instant is inside
 * the window: the flag names the earliest moment to consider, and an
 * exclusive bound would drop the one commit or session an operator
 * copied the timestamp from.
 */
export function selectSessionLogs(
  candidates: readonly SessionLogCandidate[],
  collected: ReadonlySet<string>,
  sinceEpochMs: number | null,
): SessionSelection {
  const pending: SessionLogCandidate[] = [];
  const alreadyCollected: SessionLogCandidate[] = [];
  const outsideWindow: SessionLogCandidate[] = [];

  for (const candidate of candidates) {
    if (sinceEpochMs !== null && candidate.modifiedAtMs < sinceEpochMs) {
      outsideWindow.push(candidate);
      continue;
    }
    if (collected.has(candidate.sessionId)) {
      alreadyCollected.push(candidate);
      continue;
    }
    pending.push(candidate);
  }
  return { pending, alreadyCollected, outsideWindow };
}

/**
 * Splits parsed commit rows by whether the store already holds them.
 *
 * No window test: the walk was already bounded by `--since`, so a row
 * that arrived here is inside it by construction.
 */
export function selectCommits(
  rows: readonly CommitStats[],
  collected: ReadonlySet<string>,
): CommitSelection {
  const pending: CommitStats[] = [];
  const alreadyCollected: CommitStats[] = [];

  for (const row of rows) {
    if (collected.has(row.sha)) {
      alreadyCollected.push(row);
      continue;
    }
    pending.push(row);
  }
  return { pending, alreadyCollected };
}

/**
 * Resolves a `--since` value to an instant, or null when it cannot be
 * read. See the module note on why an unreadable value is refused
 * rather than handed to git.
 */
export function parseSinceInstant(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const epoch = Date.parse(trimmed);
  return Number.isNaN(epoch)
    ? null
    : epoch;
}

/**
 * Parses the collect argv.
 *
 * Every refusal is collected rather than thrown at the first one, so
 * an operator fixing a command line sees all of it at once. A
 * repeated flag takes its LAST occurrence, which is what a shell
 * alias appending an override expects.
 */
export function parseCollectArgs(args: readonly string[]): CollectArgs {
  const errors: string[] = [];
  let since: string | null = null;
  let sinceEpochMs: number | null = null;
  let collectSessions = true;
  let collectCommits = true;
  let verbose = false;

  for (const arg of args) {
    if (arg === '--no-git') {
      collectCommits = false;
    } else if (arg === '--no-sessions') {
      collectSessions = false;
    } else if (arg === '--verbose') {
      verbose = true;
    } else if (arg === '--since') {
      errors.push('--since takes a value, as --since=<date>');
    } else if (arg.startsWith('--since=')) {
      const raw = arg.slice('--since='.length);
      const epoch = parseSinceInstant(raw);
      if (epoch === null) {
        errors.push(`--since value is not a date this can read: ${raw}`);
      } else {
        since = raw;
        sinceEpochMs = epoch;
      }
    } else {
      errors.push(`unrecognised argument: ${arg}`);
    }
  }

  if (!collectSessions && !collectCommits) {
    errors.push('--no-git with --no-sessions leaves nothing to collect');
  }
  return {
    since,
    sinceEpochMs,
    collectSessions,
    collectCommits,
    verbose,
    errors,
  };
}

/** Reads the plan roster, tolerating a `.plans/` that is not there. */
export function readPlanStubs(plansDir: string): string[] {
  return existsSync(plansDir)
    ? planStubsFromFileNames(readdirSync(plansDir))
    : [];
}

/**
 * Reads one session log into a store row.
 *
 * Two passes; see the module note. The candidate supplies the size
 * and mtime rather than a second stat, so the row describes the file
 * as the walk saw it.
 */
export async function collectSessionRow(
  candidate: SessionLogCandidate,
  planStubs: readonly string[],
): Promise<SessionEffortRow> {
  const enqueue = await findFirstEnqueue(readLines(candidate.path));
  const stats = await readSessionLog(candidate.path);
  const attribution = attributeSession(stats, enqueue.content, planStubs);

  return {
    ...stats,
    kind: attribution.kind,
    branch: attribution.branch,
    branchRecordCount: attribution.branchRecordCount,
    distinctBranchCount: attribution.distinctBranchCount,
    branchType: attribution.branchType,
    branchStub: attribution.branchStub,
    planStub: attribution.planStub,
    planStubMatch: attribution.planStubMatch,
    taskText: attribution.taskText,
    enqueueRecordIndex: enqueue.recordIndex,
    sizeBytes: candidate.sizeBytes,
    modifiedAt: new Date(candidate.modifiedAtMs).toISOString(),
  };
}

/** An error's message, however it was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** Collects the session half. */
async function collectSessionHalf(
  context: HalfContext,
): Promise<SessionCollectSummary> {
  const storePath = effortStorePath(context.repoRoot, 'sessions');
  const store = openEffortStore<SessionEffortRow>(storePath, sessionRowKey);
  const planStubs = readPlanStubs(context.plansDir);
  const candidates = listSessionLogs(context.logDir);
  const selection = selectSessionLogs(
    candidates,
    store.collectedKeys(),
    context.sinceEpochMs,
  );

  context.note(`sessions: ${candidates.length} logs in ${context.logDir}`);
  const stubs = `${planStubs.length} plan stubs`;
  context.note(`sessions: ${stubs} in ${context.plansDir}`);

  const rows: SessionEffortRow[] = [];
  let failed = 0;
  for (const candidate of selection.pending) {
    try {
      rows.push(await collectSessionRow(candidate, planStubs));
      context.note(`sessions: read ${candidate.sessionId}`);
    } catch (error) {
      failed += 1;
      context.log(`sessions: FAILED ${candidate.path}: ${messageOf(error)}`);
    }
  }

  const appended = store.append(rows);
  return {
    logDir: context.logDir,
    storePath,
    planStubCount: planStubs.length,
    candidates: candidates.length,
    outsideWindow: selection.outsideWindow.length,
    alreadyCollected: selection.alreadyCollected.length,
    read: rows.length,
    failed,
    appended: appended.appended,
    skippedOnAppend: appended.skipped,
  };
}

/** Collects the commit half. */
function collectCommitHalf(context: HalfContext): CommitCollectSummary {
  const storePath = effortStorePath(context.repoRoot, 'commits');
  const store = openEffortStore<CommitStats>(storePath, commitRowKey);
  const since = context.sinceEpochMs === null
    ? undefined
    : new Date(context.sinceEpochMs).toISOString();

  const parsed = context.readCommits({ cwd: context.repoRoot, since });
  const selection = selectCommits(parsed.rows, store.collectedKeys());
  const window = since ?? 'all';
  context.note(`commits: ${parsed.rows.length} parsed, since ${window}`);

  const appended = store.append(selection.pending);
  return {
    storePath,
    since: since ?? null,
    parsedRows: parsed.rows.length,
    unparsedLineCount: parsed.unparsedLineCount,
    alreadyCollected: selection.alreadyCollected.length,
    appended: appended.appended,
    skippedOnAppend: appended.skipped,
  };
}

/**
 * Runs one collect.
 *
 * The halves are independent and neither reads the other's store, so
 * switching one off changes nothing about the other's result.
 */
export async function collectEffort(
  options: CollectOptions = {},
): Promise<CollectResult> {
  const repoRoot = options.repoRoot ?? getRepoRoot();
  const verbose = options.verbose ?? false;
  const log = options.log ?? ((line: string) => console.log(line));
  const context: HalfContext = {
    repoRoot,
    logDir: options.logDir ?? sessionLogDir(repoRoot),
    plansDir: options.plansDir ?? join(repoRoot, PLANS_DIR),
    sinceEpochMs: options.sinceEpochMs ?? null,
    log,
    note: (line: string) => {
      if (verbose) log(line);
    },
    readCommits: options.readCommits ?? readCommitLog,
  };

  return {
    repoRoot,
    sessions: options.collectSessions === false
      ? null
      : await collectSessionHalf(context),
    commits: options.collectCommits === false
      ? null
      : collectCommitHalf(context),
  };
}

/** Renders a run as the lines the command prints. */
export function formatCollectSummary(result: CollectResult): string[] {
  const lines = [`effort collect: ${result.repoRoot}`];
  const sessions = result.sessions;
  const commits = result.commits;

  if (sessions === null) {
    lines.push('  sessions  skipped (--no-sessions)');
  } else {
    lines.push(
      `  sessions  ${sessions.candidates} logs`
      + `, ${sessions.outsideWindow} outside window`
      + `, ${sessions.alreadyCollected} already stored`
      + `, ${sessions.read} read`
      + `, ${sessions.failed} failed`
      + `, +${sessions.appended} rows`,
    );
    lines.push(`  sessions  ${sessions.planStubCount} plan stubs`);
  }

  if (commits === null) {
    lines.push('  commits   skipped (--no-git)');
  } else {
    lines.push(
      `  commits   ${commits.parsedRows} parsed`
      + `, ${commits.alreadyCollected} already stored`
      + `, +${commits.appended} rows`,
    );
  }
  return lines;
}

/**
 * `ralph effort collect` — the command entry.
 *
 * Sets `process.exitCode` rather than calling `process.exit`, so the
 * function is drivable from a test and so a caller's own output is
 * not truncated mid-flush.
 */
export default async function collect(args: string[]): Promise<void> {
  const parsed = parseCollectArgs(args);
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) {
      console.error(`ralph effort collect: ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  const result = await collectEffort({
    sinceEpochMs: parsed.sinceEpochMs,
    collectSessions: parsed.collectSessions,
    collectCommits: parsed.collectCommits,
    verbose: parsed.verbose,
  });
  for (const line of formatCollectSummary(result)) {
    console.log(line);
  }
}
