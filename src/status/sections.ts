/**
 * The five readings `rafa status` prints — branch and plan, loops, pull
 * request, board, housekeeping — each composed from a reader that
 * already exists, and none re-implemented here.
 *
 * | Section | Composed from | Reaches |
 * | --- | --- | --- |
 * | `branch` | `readBranch`, `readPlans`, `readBranchPlan` (`src/next/readings.ts`) | git, the plans directory |
 * | `loops` | `readSessions` (`src/loop/sessions.ts`), `isLive`, `readSessionChecklist` (`src/commands/loop/loop-sessions.ts`), `blockedTasks` (`src/commands/loop/status.ts`) | `.rafa/runs/`, the trackers |
 * | `pull` | `readOpenPull` (`src/next/readings.ts`) over `createGhPullRequests` | `gh` |
 * | `board` | `ghNextBoard` (`src/next/sources.ts`), `readBlockedIssues` (`src/commands/doctor-blocked.ts`) | `gh`, git |
 * | `housekeeping` | `readCleanup`, `cleanupCounts` (`src/cleanup/index.ts`) with `doctorCleanupSettings` (`src/commands/doctor-cleanup.ts`) | git, the disk, `gh` for merged pull requests |
 *
 * Nothing here prints, and nothing spawns except through
 * {@link StatusSeams}, whose defaults are the system's own, so a unit
 * case scripts git, `gh`, the session records and the clock. The config
 * arrives already loaded ({@link StatusInput.config}): refusing one that
 * cannot be used is the command's, and the only exit 1 it has.
 *
 * ## Every section answers, none rejects
 *
 * Each is a {@link Section}: the reading with `read: true`, or
 * `{ read: false, problem }` with one sentence saying why not. A reader
 * that throws, a git that refuses, a `gh` that times out and a provider
 * that is not `gh` all land there, so {@link readStatusSections} never
 * rejects and one section that could not be read costs the others
 * nothing. What a section read around — a plans directory that could not
 * be listed, a branch scan whose remote half did not answer, a provider
 * `readCleanup` could not reach — is carried in its `notes`.
 *
 * The branch section is not read on a detached HEAD either: `readBranch`
 * answers no branch there, and the problem is its own sentence, which
 * says no branch names a plan or a pull request. The pull request section
 * is then not read, being the branch's.
 *
 * ## The local sections are read first
 *
 * `branch` and `loops` read git at the project root, `.rafa/runs/`, the
 * trackers and the plans directory, and nothing that could wait on the
 * network, so they are read, in that order, before any `gh` is spawned.
 * `pr.provider` is then resolved (`resolvePrProvider`, whose one probe is
 * `git remote get-url origin`), and `pull`, `board` and `housekeeping`
 * start together, sharing one deadline.
 *
 * ## The network deadline
 *
 * {@link STATUS_NETWORK_TIMEOUT_MS} is measured from the moment the three
 * start, and it bounds them twice:
 *
 * - **Each `gh` command** goes through a runner opened with the time
 *   still left as its `timeoutMs` (`createGhRunner`,
 *   `src/adapters/tracker/github.ts`), so a command still running at the
 *   deadline is killed rather than left holding the process open. Past
 *   the deadline a command is not spawned at all: it answers `ok: false`
 *   saying so. A section's commands run one after another, so a runner
 *   opened with the whole timeout per command would let three slow ones
 *   run three times as long.
 * - **The `pull` and `board` sections** are each raced against the same
 *   deadline, so a section whose provider waits on something other than
 *   the runner is still answered `{ read: false, problem }` on time.
 *
 * `housekeeping` is not raced: its one `gh` command is the merged
 * listing, which the runner bounds, and `readCleanup` turns a listing
 * that failed or timed out into a note (`readProviderMerges`,
 * `src/cleanup/groups.ts`) rather than failing the counts git read.
 *
 * ## A provider that is not `gh`
 *
 * `rafa next` refuses one with exit 2 (`openNextSources`); `rafa status`
 * does not. `pull` and `board` are answered `{ read: false, problem }`
 * naming the provider and where it came from, and `housekeeping` reads
 * with no provider at all, as `rafa doctor` does, so Merged holds only
 * what git reads as merged.
 *
 * ## Which sessions the loops section names
 *
 * `live` is every record reading `running` or `paused`, a record whose
 * pid is gone reading `stopped` (`readState`). `blocked` is every
 * checklist holding a `- [BLOCKED]` task, named with the NEWEST session
 * whose plan it is: several sessions of one plan read one tracker, and
 * naming each would print the same blocked task once per session. A
 * session whose plan and tracker are both gone has no checklist and is
 * not named.
 *
 * ## The idle worktrees
 *
 * `housekeeping.idleWorktrees` counts the listed worktrees whose
 * `WorktreeRow.blockers` hold no `recent` blocker: nothing touched them
 * within `cleanup.worktreeIdleDays` (`src/cleanup/worktrees.ts`). A
 * worktree blocked for being dirty or locked is still idle by that rule.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { CleanupCounts, CleanupSeams, WorktreeRow } from '../cleanup/index.js';
import type { BlockedIssuesReport } from '../commands/doctor-blocked.js';
import type { BlockedTask } from '../commands/loop/status.js';
import type { PlanListing } from '../commands/plan/list.js';
import type { RafaConfig } from '../config.js';
import type { PidProbe, SessionRecord } from '../loop/sessions.js';
import type { NextBoard, NextSources, OpenPull, PickedLine } from '../next/readings.js';
import type { NextBoardOptions } from '../next/sources.js';
import type { GitRunner, PrProviderReading, PullRequests } from '../pr/index.js';

import { createGhRunner } from '../adapters/tracker/github.js';
import { SPEC_BLOCKED_LABEL } from '../board/blocked.js';
import { cleanupCounts, defaultCleanupSeams, readCleanup } from '../cleanup/index.js';
import { readBlockedIssues } from '../commands/doctor-blocked.js';
import { doctorCleanupSettings } from '../commands/doctor-cleanup.js';
import { isLive, readSessionChecklist } from '../commands/loop/loop-sessions.js';
import { blockedTasks } from '../commands/loop/status.js';
import { plansDirAt } from '../commands/plan/plan-files.js';
import { messageOf } from '../config-sections.js';
import { readSessions } from '../loop/sessions.js';
import { readBranch, readBranchPlan, readOpenPull, readPlans } from '../next/readings.js';
import { DEFAULT_BASE_BRANCH, ghNextBoard } from '../next/sources.js';
import { createGhPullRequests, createGitRunner, resolvePrProvider } from '../pr/index.js';

/** How long the network sections may take together, in milliseconds; see the module note. */
export const STATUS_NETWORK_TIMEOUT_MS = 5_000;

/** A section that could not be read, and why. */
export interface SectionUnread {
  readonly read: false;
  /** One sentence: the reader's own words where it said any. */
  readonly problem: string;
}

/** A section's reading, or why it could not be taken. */
export type Section<T> = (T & { readonly read: true }) | SectionUnread;

/** The branch at the project root, and the plan it is named after. */
export interface BranchReading {
  /** The branch, as `git rev-parse --abbrev-ref HEAD` names it. */
  readonly branch: string;
  /** The plan `feat/<stub>` names, with its task counts, or null when the branch names none. */
  readonly plan: PlanListing | null;
  /** What was read around: the plans directory, when it could not be listed. */
  readonly notes: readonly string[];
}

/** One checklist holding blocked tasks, and the newest session of its plan. */
export interface BlockedSession {
  /** The newest session whose plan the checklist tracks. */
  readonly session: SessionRecord;
  /** The file read, absolute: the tracker once there is one, the plan before then. */
  readonly checklist: string;
  /** Its blocked tasks, in file order, each with the blocker its line trails. */
  readonly tasks: readonly BlockedTask[];
}

/** The loop sessions: the ones still running, and the blocked checklists. */
export interface LoopsReading {
  /** Every record reading `running` or `paused`, oldest first. */
  readonly live: readonly SessionRecord[];
  /** Every checklist holding a blocked task, newest session first. */
  readonly blocked: readonly BlockedSession[];
}

/** The branch's open pull request. */
export interface PullReading {
  /** Its summary, mergeability and checks verdict, or null when the branch has none. */
  readonly pull: OpenPull | null;
  /** What was read around: a detail the provider did not answer. */
  readonly notes: readonly string[];
}

/** The roadmap's next line, and the blocked issues on the board. */
export interface BoardReading {
  /** The roadmap issue walked. */
  readonly roadmap: number;
  /** The next line with whether it is ready and what blocks it, or null when the roadmap has none left. */
  readonly next: PickedLine | null;
  /** How many lines the walk passed to reach it. */
  readonly passed: number;
  /** How many open issues carry `spec:blocked`, or null when they could not be listed. */
  readonly blockedIssues: number | null;
  /** What was read around: a branch scan, a blocked listing that failed. */
  readonly notes: readonly string[];
}

/** What `rafa cleanup` would list, counted. */
export interface HousekeepingReading {
  /** The rows of each group. */
  readonly counts: CleanupCounts;
  /** The listed worktrees with no `recent` blocker; see the module note. */
  readonly idleWorktrees: number;
  /** What was read around: a provider that could not be reached. */
  readonly notes: readonly string[];
}

/** The five sections, as `rafa status` prints them and as its JSON `data` holds them. */
export interface StatusSections {
  readonly branch: Section<BranchReading>;
  readonly loops: Section<LoopsReading>;
  readonly pull: Section<PullReading>;
  readonly board: Section<BoardReading>;
  readonly housekeeping: Section<HousekeepingReading>;
}

/** The settings the sections read. */
export type StatusConfig = Pick<
  RafaConfig,
  | 'planDir'
  | 'prBase'
  | 'prProvider'
  | 'roadmapIssue'
  | 'cleanupKeep'
  | 'cleanupStaleDays'
  | 'cleanupWorktreeIdleDays'
>;

/** What {@link readStatusSections} reads. */
export interface StatusInput {
  /** The project root: git runs here, and its `.rafa/runs/` holds the sessions. */
  readonly root: string;
  /** The home `~/.rafa/worktrees/` is under. */
  readonly home: string;
  /** The resolved config. */
  readonly config: StatusConfig;
}

/** How the sections reach the system; each left out is the system's own. */
export interface StatusSeams {
  /** Opens the runner every git command goes through. `createGitRunner` when left out. */
  readonly openGit?: (root: string) => GitRunner;
  /** Opens a runner for one `gh` command with `timeoutMs` left. `createGhRunner` when left out. */
  readonly openGh?: (root: string, timeoutMs: number) => GhRunner;
  /** The provider over the bounded runner. `createGhPullRequests` when left out. */
  readonly pullRequests?: (gh: GhRunner) => PullRequests;
  /** The board over the bounded runner. `ghNextBoard` when left out. */
  readonly board?: (options: NextBoardOptions) => NextBoard;
  /** The blocked-issue listing over the bounded runner. `readBlockedIssues` when left out. */
  readonly blockedIssues?: (gh: GhRunner) => Promise<BlockedIssuesReport>;
  /** The `origin` probe `resolvePrProvider` takes. `gitRemoteUrl` when left out. */
  readonly readRemote?: (dir: string) => string | null;
  /** Whether a pid is alive, as a session record's state is read. `isPidAlive` when left out. */
  readonly isAlive?: PidProbe;
  /** The seams the housekeeping reading runs through. `defaultCleanupSeams` when left out. */
  readonly cleanupSeams?: (cwd: string, pulls: PullRequests | null) => CleanupSeams;
  /** The clock the Stale and idle ages are read against. `new Date()` when left out. */
  readonly now?: () => Date;
  /** The network deadline. {@link STATUS_NETWORK_TIMEOUT_MS} when left out. */
  readonly timeoutMs?: number;
}

/** The deadline the network sections share; see the module note. */
interface NetworkDeadline {
  /** The whole deadline, as a problem names it. */
  readonly ms: number;
  /** Starts the clock; until then the whole deadline is left. */
  readonly start: () => void;
  /** Milliseconds left; zero or less once it has passed. */
  readonly left: () => number;
}

/** True when nothing touched `row` within `cleanup.worktreeIdleDays`: it holds no `recent` blocker. */
export function isIdleWorktree(row: Pick<WorktreeRow, 'blockers'>): boolean {
  return !row.blockers.some((blocker) => blocker.kind === 'recent');
}

/** A section not read, for `problem`. */
function unread(problem: string): SectionUnread {
  return { read: false, problem };
}

/** A section read. */
function read<T>(reading: T): T & { readonly read: true } {
  return { ...reading, read: true };
}

/** `work`'s reading, or the sentence it threw. */
function localSection<T>(work: () => T | SectionUnread): Section<T> {
  try {
    const reading = work();
    return isUnread(reading)
      ? reading
      : read(reading);
  } catch (error) {
    return unread(messageOf(error));
  }
}

/** True for a value {@link unread} made. */
function isUnread(value: unknown): value is SectionUnread {
  return typeof value === 'object' && value !== null && (value as { read?: unknown }).read === false;
}

/**
 * A deadline of `ms`, measured from its `start`. The runner and the
 * sources are made before the local sections are read, and the clock
 * must not run while they are.
 */
function openDeadline(ms: number): NetworkDeadline {
  let endsAt: number | null = null;
  return {
    ms,
    start: () => {
      endsAt = Date.now() + ms;
    },
    left: () => endsAt === null
      ? ms
      : endsAt - Date.now(),
  };
}

/** A runner that gives each command the time left, and spawns none past the deadline. */
function boundedRunner(open: (root: string, timeoutMs: number) => GhRunner, root: string, deadline: NetworkDeadline): GhRunner {
  return (args): Promise<GhResult> => {
    const left = deadline.left();
    if (left <= 0) {
      return Promise.resolve({
        ok: false,
        stdout: '',
        stderr: `gh ${args.join(' ')} was not run: the ${String(deadline.ms)}ms network deadline had passed`,
      });
    }
    return open(root, left)(args);
  };
}

/**
 * `work`'s reading, or `{ read: false, problem }` when it threw or the
 * deadline passed first. Never a rejection; the timer is cleared either way.
 */
async function networkSection<T>(what: string, deadline: NetworkDeadline, work: () => Promise<T>): Promise<Section<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<SectionUnread>((resolve) => {
    timer = setTimeout(() => {
      resolve(unread(`the ${what} was not read within the ${String(deadline.ms)}ms network deadline`));
    }, Math.max(0, deadline.left()));
  });
  try {
    return await Promise.race([work().then((reading) => read(reading)), expired]);
  } catch (error) {
    return unread(messageOf(error));
  } finally {
    clearTimeout(timer);
  }
}

/** Why a section read through `gh` was not read under `provider`. */
function notGhProblem(what: string, provider: PrProviderReading): string {
  const from = provider.source === 'config'
    ? 'as the config names it'
    : 'as origin is no GitHub remote';
  return `pr.provider is ${provider.provider}, ${from}, and rafa status reads the ${what} through gh alone`;
}

/** The branch and its plan; see the module note. */
function readBranchSection(sources: NextSources): BranchReading | SectionUnread {
  let notes: readonly string[] = [];
  const note = (problem: string): void => {
    notes = [...notes, problem];
  };
  const branch = readBranch(sources, note);
  if (branch === '') {
    return unread(notes.join('; ') || 'the branch at the project root could not be read');
  }
  const plans = readPlans(sources, note);
  return { branch, plan: readBranchPlan(branch, plans), notes };
}

/** Every checklist holding a blocked task, named with the newest session of its plan. */
function blockedSessions(root: string, records: readonly SessionRecord[]): readonly BlockedSession[] {
  let seen: ReadonlySet<string> = new Set();
  let found: readonly BlockedSession[] = [];
  for (const session of [...records].reverse()) {
    const checklist = readSessionChecklist(root, session);
    if (checklist === null || seen.has(checklist.file)) continue;
    seen = new Set([...seen, checklist.file]);
    const tasks = blockedTasks(checklist);
    if (tasks.length > 0) found = [...found, { session, checklist: checklist.file, tasks }];
  }
  return found;
}

/** The loops: the sessions still running, and the blocked checklists; see the module note. */
function readLoopsSection(root: string, sources: NextSources): Section<LoopsReading> {
  return localSection(() => {
    const records = sources.runs();
    return { live: records.filter((record) => isLive(record)), blocked: blockedSessions(root, records) };
  });
}

/** The pull request section: read through `gh`, or why it is not. */
function pullSection(
  sources: NextSources,
  branch: Section<BranchReading>,
  provider: PrProviderReading,
  deadline: NetworkDeadline,
): Promise<Section<PullReading>> {
  if (provider.provider !== 'gh') return Promise.resolve(unread(notGhProblem('pull request', provider)));
  if (!branch.read) {
    return Promise.resolve(unread(`no pull request was looked for, as the branch was not read: ${branch.problem}`));
  }
  return networkSection('pull request', deadline, () => readPull(sources, branch.branch));
}

/** The branch's open pull request. */
async function readPull(sources: NextSources, branch: string): Promise<PullReading> {
  let notes: readonly string[] = [];
  const pull = await readOpenPull(sources, branch, (problem) => {
    notes = [...notes, problem];
  });
  return { pull, notes };
}

/** The roadmap's next line and the count of blocked issues, the two read together. */
async function readBoard(board: NextBoard, blocked: Promise<BlockedIssuesReport>): Promise<BoardReading> {
  const [walk, report] = await Promise.all([board.next(), blocked]);
  const { line } = walk;
  const next = line === null
    ? null
    : { line, ready: await board.isReady(line.issue), blocked: await board.blocking(line.issue) };
  const listed = report.problem === null
    ? []
    : [`the issues labelled ${SPEC_BLOCKED_LABEL} could not be read: ${report.problem}`];
  return {
    roadmap: walk.roadmap,
    next,
    passed: walk.passed,
    blockedIssues: report.problem === null
      ? report.readings.length
      : null,
    notes: [...walk.problems, ...listed],
  };
}

/** What `rafa cleanup` would list, counted, read without fetching; see the module note. */
async function readHousekeeping(
  input: StatusInput,
  cleanup: CleanupSeams,
  now: Date,
): Promise<Section<HousekeepingReading>> {
  try {
    const settings = doctorCleanupSettings({ root: input.root, home: input.home, config: input.config, gh: null }, now);
    const reading = await readCleanup(cleanup, settings);
    if (!reading.ok) return unread(reading.detail);
    const idle = reading.worktrees.filter((row) => isIdleWorktree(row));
    return read({ counts: cleanupCounts(reading), idleWorktrees: idle.length, notes: reading.notes });
  } catch (error) {
    return unread(messageOf(error));
  }
}

/**
 * The five sections for the project at `input.root`: `branch` and
 * `loops` first, then `pull`, `board` and `housekeeping` together under
 * one network deadline. Never a rejection; see the module note.
 */
export async function readStatusSections(input: StatusInput, seams: StatusSeams = {}): Promise<StatusSections> {
  const { root, config } = input;
  const git = (seams.openGit ?? createGitRunner)(root);
  const openGh = seams.openGh ?? ((cwd: string, timeoutMs: number): GhRunner => createGhRunner({ cwd, timeoutMs }));
  const deadline = openDeadline(seams.timeoutMs ?? STATUS_NETWORK_TIMEOUT_MS);
  const gh = boundedRunner(openGh, root, deadline);
  const pulls = (seams.pullRequests ?? ((runner: GhRunner): PullRequests => createGhPullRequests({ gh: runner })))(gh);
  const board = (seams.board ?? ghNextBoard)({ gh, git, configured: config.roadmapIssue });
  const sources: NextSources = {
    base: config.prBase ?? DEFAULT_BASE_BRANCH,
    plans: plansDirAt(root, config.planDir),
    runs: () => readSessions(root, { isAlive: seams.isAlive }),
    git,
    pulls,
    board,
  };

  const branch = localSection(() => readBranchSection(sources));
  const loops = readLoopsSection(root, sources);

  const provider = resolvePrProvider({ configured: config.prProvider, dir: root, readRemote: seams.readRemote });
  const isGh = provider.provider === 'gh';
  const cleanup = (seams.cleanupSeams ?? defaultCleanupSeams)(root, isGh
    ? pulls
    : null);
  const now = (seams.now ?? ((): Date => new Date()))();
  const blockedIssues = seams.blockedIssues ?? ((runner: GhRunner): Promise<BlockedIssuesReport> => readBlockedIssues({ gh: runner }));

  deadline.start();
  const pull = pullSection(sources, branch, provider, deadline);
  const boardSection = isGh
    ? networkSection('board', deadline, () => readBoard(board, blockedIssues(gh)))
    : Promise.resolve(unread(notGhProblem('board', provider)));
  const housekeeping = readHousekeeping(input, cleanup, now);

  return {
    branch,
    loops,
    pull: await pull,
    board: await boardSection,
    housekeeping: await housekeeping,
  };
}
