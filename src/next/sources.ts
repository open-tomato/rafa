/**
 * What the state table is read over in a real project: the config, git,
 * the session records, the plans directory, the pull request provider
 * and the board, composed into the one {@link NextSources} value
 * `./readings.ts` declares.
 *
 * `./state.ts` decides and `./readings.ts` reads; this module is the
 * half that WIRES, and it is the only one of the three that knows a
 * `RafaContext`. So a caller — `rafa next`, and the ending hint of every
 * command in the cycle — composes the sources once and hands them on,
 * and every case of `./state.test.ts` and `./readings.test.ts` keeps
 * driving fakes with no context at all.
 *
 * ## What the config answers
 *
 * One `loadConfig` for the whole composition, which is what keeps the
 * settings it reads on one reading of the file:
 *
 * | Setting | Field | What it answers |
 * | --- | --- | --- |
 * | `plan.dir` | `planDir` | the plans directory rows 3, 4 and 9 read |
 * | `pr.base` | `prBase` | the base rows 2 and 9 to 13 are read against |
 * | `pr.provider` | `prProvider` | whether this repository has a provider at all |
 * | `roadmap.issue` | `roadmapIssue` | the roadmap issue, when a layer named one |
 * | `release.changelog` | `releaseChangelog` | the changelog the end of an epic reads for an untagged version (`./epic-end.ts`) |
 * | the keys `mergeGuardSettings` copies | `release*` and the two collision keys | the settle dry run read after a merge step (`./settle-step.ts`) |
 *
 * `pr.base` unset is {@link DEFAULT_BASE_BRANCH}: `main`, which is what
 * `release tag` resolves the same setting to and the first of the two
 * branches `src/start.ts` reads as a base. A project whose base is
 * `master` and whose config says nothing therefore reads as being off
 * its base, and every row that names the base stays quiet — the setting
 * is the one place that is fixed, and no probe here guesses at it.
 *
 * A config `loadConfig` refuses is refused with exit code 1 naming
 * `rafa next`, in the words `src/commands/plan/plan-files.ts` refuses
 * one with; the six other commands that read a config of their own
 * spell it the same way.
 *
 * ## The provider is required to be `gh`
 *
 * {@link openNextSources} resolves `pr.provider` through
 * `resolvePrProvider` at the project root and hands the reading to
 * `requireGhProvider`, so a repository that is no GitHub one is refused
 * with exit 2 and `PR_NEEDS_GH`, the constant every `pr` action refuses
 * with. The message opens with `rafa pr`, which is right here: every
 * action rows 5 to 8 propose IS a `pr` action, and a second wording
 * of one refusal is the smell `context/source.md` names.
 *
 * That check asks the config and `origin`, and it spawns no `gh`.
 * Whether the CLI is installed and authenticated is the preflight's
 * reading (`src/pr/preflight-items.ts`), and a `gh` that then cannot
 * answer is the `pulls-unusable` pre-condition of `./state.ts`, which
 * names `rafa doctor`.
 *
 * ## The board, and what it does NOT do
 *
 * {@link ghNextBoard} answers the three readings {@link NextBoard}
 * declares over one `gh` runner and one memoised issue reader, out of
 * the pieces `plan create --next` walks the roadmap with: the roadmap
 * issue resolved by `resolveDefaultBoard` (`src/board/boards.ts`:
 * `roadmap.issue`, else the lowest-numbered open `type:roadmap` board,
 * else the one open issue titled `Roadmap`, after one
 * `gh issue list --label type:roadmap`), its body parsed, and the walk's
 * own done and taken
 * readings. Nothing is composed here a second time.
 *
 * The walk is `pickDescendedLine`'s (`src/board/epic-walk.ts`), the one
 * `plan create --next` takes, spelled as its two halves,
 * `descendRoadmap` and then the pick, so that the pick can pass waiting
 * lines under `roadmap` (see "The hop"); without it the pick is
 * `pickNextRoadmapLine`, exactly as that function makes it. It runs over
 * the same memoised reader: a roadmap
 * line whose issue carries `type:epic` is replaced by that epic's
 * checklist and then its labelled members, so the line `rafa next`
 * proposes is the epic's first open spec. The board is listed with one
 * `gh issue list --state all` only when the walk meets an open `now`
 * epic line, or when a position file is there to weigh (see "Where the
 * walk starts"); a roadmap with no epic line and a project with no
 * position file send no other listing. The listing is read at most once
 * per board, the place and the walk sharing it. A
 * caller that reads the listing itself hands it in as
 * {@link NextBoardOptions.listing}, so the command reads it once:
 * `rafa status` does, for the current place (`src/status/sections.ts`). An epic whose every line is done or taken has run dry and the
 * walk answers no line, so row 13 reads it without naming a second
 * epic's issue; `passed` counts the lines passed on the roadmap and
 * inside the epic together. The dry epic's number and title are
 * carried out as {@link NextRoadmapReading.dryEpic}, the `dry` that
 * `pickDescendedLine` would answer; the key is left out of a reading where no
 * epic ran dry, so a roadmap with no epic line answers the same four
 * keys it did before.
 *
 * ## Where the walk starts
 *
 * The default board is resolved first, as above, and then, with
 * {@link NextBoardOptions.root} handed in, the CURRENT PLACE is read by
 * `readCurrentPlace` (`src/board/roadmap-rows.ts`), the reading
 * `rafa roadmap` and `rafa epics` take: nothing at all when the root
 * holds no position file, else `resolvePlace` (`src/board/place.ts`) over
 * the one listing, a place that no longer stands falling back by its
 * rule. `rafa next` hands its project root; `rafa status` hands none, so
 * its walk starts from the default board as before.
 *
 * - No position file, or no root: the default board's checklist is
 *   walked exactly as before positions, with the same `gh` commands.
 * - A place naming a board alone: that board's checklist is walked the
 *   same way, descending into its first open `now` epic, and
 *   {@link NextRoadmapReading.roadmap} names that board.
 * - A place naming an epic: that epic's lines alone are walked, in the
 *   order `epicLines` (`src/board/epic-walk.ts`) gives them, WHATEVER
 *   its horizon, since a switch chose it; no board body is read, and
 *   `passed` counts the epic's lines passed. Every line done or taken
 *   answers no line, as a dry epic does on the roadmap walk, and names
 *   the epic as {@link NextRoadmapReading.dryEpic} the same way.
 *
 * Every notice the place reading gives, but the absent-file one, is
 * carried out as a problem ahead of the branch scan's, which
 * `rafa next` writes as a warning; a listing that failed while a
 * position file is there is one such notice, the default board then
 * walked unweighed.
 *
 * With {@link NextBoardOptions.noticeCancelled} set, as `rafa next` sets
 * it, the cancelled-epic notice (`src/board/epic-cancel-notice.ts`) is
 * carried out as problems after the place's notices, one line per epic
 * closed as not planned that open issues outside it still wait on — but
 * only when the walk or the place read the listing already, so it costs
 * no `gh` command of its own, and a roadmap walked with no epic line and
 * no position file prints no notice. A failed listing adds none.
 *
 * ## The hop, under `roadmap`
 *
 * With {@link NextBoardOptions.roadmap} set, as `rafa next --roadmap`
 * sets it, the answer carries {@link NextRoadmapReading.hop}; without
 * it, the key is LEFT OUT and nothing below is read, so the board sends
 * the `gh` and git commands it always did. Everything is read afresh on
 * each answer, the record and the position included; nothing is kept
 * from one turn to the next.
 *
 * - **The record.** `.rafa/hop.json` (`./hop-record.ts`) and
 *   `.rafa/position.json` are read under {@link NextBoardOptions.root}.
 *   The record is followed only when the position reads and its `home`
 *   is the record's (`staleAgainst`): a person who switched by hand
 *   re-homed, so the record is carried as `stale`, not followed, and the
 *   walk starts from the new position. With no position file the record
 *   has nothing to be weighed against and is stale the same way. The
 *   board never deletes or rewrites the file: it reads, and a
 *   `--dry-run` writes nothing. A file that does not read is one
 *   problem naming it; an absent one is none.
 * - **The away target.** While the followed record is a `blocker` hop in
 *   state `away`, the walk answers C, the record's `target`, rather than
 *   walking the epic the position stands in, whose first line is not
 *   the one the hop went for. C is asked whether it is closed and, when
 *   open, whether an open pull request closes it; either makes the line
 *   null and is carried as {@link NextHopReading.target}, for the row
 *   that goes home. A branch claiming C is NOT asked: while away it is
 *   the hop's own. C's line is the record's, read off no body, so its
 *   `why` is empty and its `lineNumber` 0.
 * - **Waiting lines.** At home, and on a dry hop, the pick passes a line
 *   whose `Blocked by:` reading (`readBlockedLine`, as `blocking`
 *   answers it) holds open or unread blockers every one of which a
 *   branch or an open pull request has taken, and names it in
 *   {@link NextHopReading.waiting}; `passed` counts it. A line with one
 *   free blocker, or with a fault, stops the walk as it always did. An
 *   epic whose lines are all done, taken or waiting has run dry.
 * - **The decision.** For the line the walk answered, when it is
 *   blocked: at home, `decideHop` (`./hop-chain.ts`) over its open and
 *   unread blockers in line order, the first answer that is not a
 *   `wait` winning, read at the place H was read (the board and the
 *   epic walked, which a board-only position does not name) with home
 *   the position's own while it stands away, else that same place;
 *   while away, the record's own hop read again from the record's
 *   `from` and `home`, C's branch not taking it, so C blocked in turn
 *   answers the halt with the chain `#H ← #C ← #B`.
 * - **The next `now` epic.** For an epic that ran dry, `nextNowEpic`
 *   (`src/board/epic-walk.ts`) after it on the walked board.
 *
 * The decision and the next epic are read over the ONE listing the
 * walk shares, with the default board already resolved, and a reading
 * of the two that fails is one problem and no proposal: a hop is never
 * proposed on a board nobody could read.
 *
 * The memo lives for the length of one board, which is one `rafa next`
 * answer: the walk reads the picked line's issue to ask whether it is
 * closed, and `blocking` and `isReady` then read the LABELS and the
 * `Blocked by:` line off that same answer, so rows 10, 11 and 12 cost no
 * `gh issue view` of their own. `spec-source.ts` memoises for the same
 * reason and its suite counts the reads; `./sources.test.ts` counts them
 * here.
 *
 * It runs NO trust check. `src/board/trust.ts` is wired where board text
 * reaches a prompt or a snapshot — `plan create --issue`, `--next`,
 * the spec-review comment and `issue ready` — and nothing here reaches
 * either: the roadmap body is read for the ids of its unticked lines, a
 * body for its labels and its `Blocked by:` ids, and the numbers land in
 * a sentence a person reads. The action a row proposes runs the check
 * itself, because it is that command's own.
 *
 * A failed branch scan is carried out as {@link NextRoadmapReading}
 * `.problems` rather than thrown, which is `scanClaimBranches`'s own
 * shape and what `./readings.ts` carries into the answer. The scan is
 * taken here as well as by `./readings.ts`'s row 9, so an answer that
 * reaches both spends two `git for-each-ref` calls — both local, both
 * free of the network, and each memoised where it is taken.
 */
import type { EpicEndRelease } from './epic-end.js';
import type { HopDecision, TakenReadings } from './hop-chain.js';
import type { HopRecord } from './hop-record.js';
import type {
  DryEpic,
  HopTarget,
  NextBoard,
  NextHopReading,
  NextRoadmapReading,
  NextSources,
  TakenBlocker,
  WaitingLine,
} from './readings.js';
import type { SettleReader } from './settle-step.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { BlockedLine } from '../board/blocked-line.js';
import type { BoardView } from '../board/epic-board.js';
import type { EpicDescentSeams } from '../board/epic-walk.js';
import type { SpecIssue, SpecIssueReader } from '../board/issue.js';
import type { BoardListing } from '../board/roadmap-board.js';
import type { RoadmapLine, RoadmapReadings } from '../board/roadmap.js';
import type { RafaContext } from '../cli/command.js';
import type { RafaConfig } from '../config.js';
import type { SessionRecord } from '../loop/sessions.js';
import type { GitRunner, PullRequests } from '../pr/index.js';
import type { Place, Position } from '../project/position.js';
import type { ProjectFound } from '../project/scope.js';
import type { MergeGuardSettings } from '../release/guard-merge.js';

import { createGhRunner } from '../adapters/tracker/github.js';
import { blockerStatesOf, readBlockedLine } from '../board/blocked-line.js';
import { createGhBoardLister, resolveDefaultBoard } from '../board/boards.js';
import { cancelledEpicNoticeLines } from '../board/epic-cancel-notice.js';
import { descendRoadmap, epicLines, nextNowEpic } from '../board/epic-walk.js';
import { readEpics } from '../board/epics.js';
import { createGhSpecIssueReader } from '../board/issue.js';
import { samePlace } from '../board/place.js';
import { hasSpecReadyLabel } from '../board/readiness.js';
import { createGhBoardListing } from '../board/roadmap-board.js';
import { readCurrentPlace } from '../board/roadmap-rows.js';
import {
  createGhOpenPullRequests,
  createGhRoadmapSearch,
  createRoadmapReadings,
  parseRoadmapBody,
  pickNextRoadmapLine,
  scanClaimBranches,
} from '../board/roadmap.js';
import { CommandExit } from '../cli/command.js';
import { readRecords, resolveLoopSeams } from '../commands/loop/loop-sessions.js';
import { plansDirAt } from '../commands/plan/plan-files.js';
import { loadConfig } from '../config-load.js';
import { messageOf } from '../config-sections.js';
import { ConfigError } from '../config.js';
import { createGitRunner, ghPullRequestsIn, requireGhProvider, resolvePrProvider } from '../pr/index.js';
import { readPositionFile } from '../project/position.js';

import { readEpicEndRelease } from './epic-end.js';
import { decideHop, takenBy } from './hop-chain.js';
import { readHopRecord, staleAgainst } from './hop-record.js';
import { nextOwnerGate } from './owner-gate.js';
import { settleReaderFor } from './settle-step.js';

/** What a refusal and a defect here name, being the one command that composes these. */
const PREFIX = 'rafa next';

/** The base every row that names one is read against where `pr.base` names none. */
export const DEFAULT_BASE_BRANCH = 'main';

/** How the composition reaches git, `gh`, the provider, `origin` and the pids; each left out is the system's own. */
export interface NextSourceSeams {
  /** Opens the runner every `gh` command goes through. `gh` spawned at the project root when left out. */
  readonly openGh?: (root: string) => GhRunner;
  /** Opens the runner every git command goes through. `createGitRunner` when left out. */
  readonly openGit?: (root: string) => GitRunner;
  /** The provider for a repository. `ghPullRequestsIn` when left out. */
  readonly pullRequests?: (root: string) => PullRequests;
  /** The `origin` probe `resolvePrProvider` takes. `gitRemoteUrl` when left out. */
  readonly readRemote?: (dir: string) => string | null;
  /** Whether a pid is alive, as a session record's state is read. `isPidAlive` when left out. */
  readonly isAlive?: (pid: number) => boolean;
}

/** The seams a registered command runs with: the system's own, every one. */
export const DEFAULT_NEXT_SOURCE_SEAMS: NextSourceSeams = Object.freeze({});

/** What {@link ghNextBoard} reads the board through. */
export interface NextBoardOptions {
  /** Runs every `gh` command, in the repository the board belongs to. */
  readonly gh: GhRunner;
  /** Runs the two branch reads the taken reading is taken from. */
  readonly git: GitRunner;
  /** `roadmap.issue` as the config resolved it, or null for the default board `resolveDefaultBoard` ranks. */
  readonly configured: number | null;
  /** The remote the pushed half of the branch scan asks; `origin` when left out. */
  readonly remote?: string;
  /** The board listing the walk reads, for a caller that reads it too; `createGhBoardListing` over `gh` when left out. */
  readonly listing?: BoardListing;
  /** The project root whose position file names the current place; left out, the walk starts from the default board. */
  readonly root?: string;
  /**
   * Carry the cancelled-epic notice's lines as problems when the walk read
   * the listing; `rafa next` sets it, and `rafa status` leaves it out.
   */
  readonly noticeCancelled?: boolean;
  /**
   * Read the hop for `rafa next --roadmap`: the answer carries
   * {@link NextRoadmapReading.hop}, and the walk passes waiting lines and
   * answers an away hop's target. Left out, no key and no call is added;
   * see the module note's "The hop, under `roadmap`".
   */
  readonly roadmap?: boolean;
}

/** The settings the composition reads off the config. */
type NextConfig = Pick<RafaConfig, 'planDir' | 'prBase' | 'prProvider' | 'releaseChangelog' | 'roadmapIssue' | keyof MergeGuardSettings>;

/** `read`, called at most once per issue; the module note holds how long the memo lives. */
function memoiseIssues(issues: SpecIssueReader): SpecIssueReader {
  const read = new Map<number, Promise<SpecIssue>>();
  return (issue: number): Promise<SpecIssue> => {
    const taken = read.get(issue) ?? issues(issue);
    read.set(issue, taken);
    return taken;
  };
}

/** `read`, asked on the first call only; every call answers or rejects as the first did. */
function listOnce(read: BoardListing): BoardListing {
  let kept: ReturnType<BoardListing> | null = null;
  return () => {
    kept ??= read();
    return kept;
  };
}

/** The cancelled-epic notice's lines over the kept listing; none when it failed, which the place reading says. */
async function cancelledNotices(listing: BoardListing): Promise<readonly string[]> {
  try {
    return cancelledEpicNoticeLines(await listing());
  } catch {
    return [];
  }
}

/** What one walk answers: the line it picked, how many lines it passed, and the epic it ran dry in. */
interface WalkAnswer {
  readonly line: RoadmapLine | null;
  readonly passed: number;
  readonly dry: DryEpic | null;
  /** The epic the line was read in: the place's, or the one walked into; null when none. */
  readonly epic: number | null;
  /** The lines passed as waiting; always empty without `roadmap`. */
  readonly waiting: readonly WaitingLine[];
}

/** What a pick over one list of lines answers. */
interface LinePick {
  readonly line: RoadmapLine | null;
  readonly passed: number;
  readonly waiting: readonly WaitingLine[];
}

/** How the walk picks among lines: `pickNextRoadmapLine` alone, or passing waiting lines too. */
type LinePicker = (lines: readonly RoadmapLine[], readings: RoadmapReadings) => Promise<LinePick>;

/** `pickNextRoadmapLine`, as every walk without `roadmap` picks. */
const plainPick: LinePicker = async (lines, readings) => {
  const pick = await pickNextRoadmapLine(lines, readings);
  return { line: pick.line, passed: pick.skipped.length, waiting: [] };
};

/** The blockers `blocked` waits on, each with what took it, when every open or unread one is taken; else null. */
async function everyBlockerTaken(blocked: BlockedLine | null, readings: RoadmapReadings): Promise<readonly TakenBlocker[] | null> {
  if (blocked === null || blocked.fault !== null) return null;
  const held = blocked.blockers.filter((id) => blocked.open.includes(id) || blocked.unread.includes(id));
  if (held.length === 0) return null;
  let taken: readonly TakenBlocker[] = [];
  for (const issue of held) {
    const by = await takenBy(issue, readings);
    if (by === null) return null;
    taken = [...taken, Object.freeze({ issue, taken: Object.freeze(by) })];
  }
  return Object.freeze(taken);
}

/** A picker passing, as waiting, every line whose open blockers are all taken; see the module note. */
function waitingPick(blocking: NextBoard['blocking']): LinePicker {
  const pick = async (lines: readonly RoadmapLine[], readings: RoadmapReadings, before: LinePick): Promise<LinePick> => {
    const next = await pickNextRoadmapLine(lines, readings);
    const passed = before.passed + next.skipped.length;
    if (next.line === null) return { line: null, passed, waiting: before.waiting };
    const blockers = await everyBlockerTaken(await blocking(next.line.issue), readings);
    if (blockers === null) return { line: next.line, passed, waiting: before.waiting };
    const waiting = [...before.waiting, Object.freeze({ line: next.line, blockers })];
    return pick(lines.slice(lines.indexOf(next.line) + 1), readings, { line: null, passed: passed + 1, waiting });
  };
  return (lines, readings) => pick(lines, readings, { line: null, passed: 0, waiting: [] });
}

/**
 * The walk inside `epic` alone, whatever its horizon: its lines as
 * `epicLines` orders them, picked with the roadmap's own readings. See
 * the module note's "Where the walk starts".
 */
async function walkEpic(epic: number, listing: BoardListing, readings: RoadmapReadings, picker: LinePicker): Promise<WalkAnswer> {
  const rows = await listing();
  const read = readEpics({ issues: rows, claims: new Set(), today: new Date(0) }).epics
    .find((candidate) => candidate.number === epic);
  const row = rows.find((issue) => issue.number === epic);
  if (read === undefined || row === undefined) {
    throw new Error(`${PREFIX}: epic #${String(epic)}, the current place, is not on the board listing, so its members cannot be read`);
  }
  const pick = await picker(epicLines(read, row).lines, readings);
  return {
    line: pick.line,
    passed: pick.passed,
    dry: pick.line === null
      ? { number: read.number, title: read.title }
      : null,
    epic,
    waiting: pick.waiting,
  };
}

/** The hop record as one turn follows it; see the module note's "The hop, under `roadmap`". */
interface FollowedHop {
  readonly record: HopRecord | null;
  readonly stale: HopRecord | null;
  readonly position: Position | null;
  readonly problems: readonly string[];
}

/** The position and the hop record under `root`, the record kept only when the position's home is its home. */
function followHopRecord(root: string | undefined): FollowedHop {
  if (root === undefined) return { record: null, stale: null, position: null, problems: [] };
  const placed = readPositionFile(root);
  const position = placed.set
    ? placed.position
    : null;
  const hop = readHopRecord(root);
  if (!hop.set) {
    const problems = hop.reason === 'absent'
      ? []
      : [`${hop.detail}, so no hop is followed`];
    return { record: null, stale: null, position, problems };
  }
  return position === null || staleAgainst(hop.record, position)
    ? { record: null, stale: hop.record, position, problems: [] }
    : { record: hop.record, stale: null, position, problems: [] };
}

/** C, when `record` is a blocker hop still away; else null. */
function awayTargetOf(record: HopRecord | null): number | null {
  if (record?.state !== 'away' || record.kind !== 'blocker') return null;
  return record.target;
}

/** The walk while a blocker hop is away: C alone, answered while it is open with no pull request. */
async function walkTarget(record: HopRecord, target: number, readings: RoadmapReadings): Promise<{ walk: WalkAnswer; target: HopTarget }> {
  const closed = await readings.isClosed(target);
  const pullRequest = closed
    ? null
    : await readings.pullRequestFor(target);
  const line: RoadmapLine | null = closed || pullRequest !== null
    ? null
    : Object.freeze({ issue: target, ticked: false, why: '', lineNumber: 0 });
  return {
    walk: { line, passed: 0, dry: null, epic: record.targetEpic, waiting: [] },
    target: Object.freeze({ issue: target, closed, pullRequest }),
  };
}

/** Taken readings answering nothing taken: C is the away hop's own work, its branch included. */
const NOTHING_TAKEN: TakenReadings = Object.freeze({
  branchFor: () => null,
  pullRequestFor: () => Promise.resolve(null),
});

/** What the hop's decision and next epic are read over. */
interface HopSeams {
  readonly blocking: NextBoard['blocking'];
  readonly readings: RoadmapReadings;
  readonly listing: BoardListing;
  readonly fallback: number;
  readonly roadmap: number;
}

/** The turn's one listing as a {@link BoardView}, the default board already resolved. */
async function boardView(seams: HopSeams): Promise<BoardView> {
  const listing = await seams.listing();
  return {
    listing,
    rows: new Map(listing.map((row) => [row.number, row])),
    defaultBoard: () => Promise.resolve(seams.fallback),
  };
}

/** The decision for H read at `places.current`: the first of its open or unread blockers that is not a wait. */
async function decideAtHome(line: RoadmapLine, places: Pick<Position, 'current' | 'home'>, seams: HopSeams): Promise<HopDecision | null> {
  const blocked = await seams.blocking(line.issue);
  if (blocked === null || blocked.fault !== null) return null;
  const held = blocked.blockers.filter((id) => blocked.open.includes(id) || blocked.unread.includes(id));
  const view = await boardView(seams);
  let last: HopDecision | null = null;
  for (const blocker of held) {
    last = await decideHop({ blocked: line.issue, blocker, position: places, view, taken: seams.readings });
    if (last.kind !== 'wait') return last;
  }
  return last;
}

/** The decision for the away target C when it is blocked: the record's own hop, read again from home. */
async function decideAway(record: HopRecord, target: number, seams: HopSeams): Promise<HopDecision | null> {
  if (record.blocked === null || await seams.blocking(target) === null) return null;
  return decideHop({
    blocked: record.blocked,
    blocker: target,
    position: { current: record.from, home: record.home },
    view: await boardView(seams),
    taken: NOTHING_TAKEN,
  });
}

/** Where H was read, and home: the position's home while it stands away, else that same place. */
function placesOf(walk: WalkAnswer, roadmap: number, position: Position | null): Pick<Position, 'current' | 'home'> {
  const current: Place = { board: roadmap, epic: walk.epic };
  const away = position !== null && !samePlace(position.current, position.home);
  return {
    current,
    home: away
      ? position.home
      : current,
  };
}

/** What one turn's hop reading holds but the record and position already read. */
type HopAnswer = Pick<NextHopReading, 'decision' | 'nextEpic'> & { readonly problems: readonly string[] };

/** The decision for the line the walk answered: C's own while away, H's at home, none without a line. */
async function decisionFor(walk: WalkAnswer, followed: FollowedHop, seams: HopSeams): Promise<HopDecision | null> {
  if (walk.line === null) return null;
  const target = awayTargetOf(followed.record);
  if (followed.record !== null && target !== null) return decideAway(followed.record, target, seams);
  return decideAtHome(walk.line, placesOf(walk, seams.roadmap, followed.position), seams);
}

/** The decision for the line the walk answered and the next `now` epic after a dry one; a failed reading a problem. */
async function readHopAnswer(walk: WalkAnswer, followed: FollowedHop, seams: HopSeams): Promise<HopAnswer> {
  try {
    const decision = await decisionFor(walk, followed, seams);
    const nextEpic = walk.dry === null
      ? null
      : await nextNowEpic({ after: walk.dry.number, board: seams.roadmap, listing: await seams.listing(), readings: seams.readings });
    return { decision, nextEpic, problems: [] };
  } catch (error) {
    return { decision: null, nextEpic: null, problems: [`the hop could not be read, so none is proposed: ${messageOf(error)}`] };
  }
}

/**
 * The board over one `gh` runner and one git runner: the roadmap walked
 * once, and the two readings over a line's issue. See the module note
 * for where the walk starts, for the memo, for what it does not do, and
 * for the problems it carries.
 */
export function ghNextBoard(options: NextBoardOptions): NextBoard {
  const { gh, git, configured, remote, root } = options;
  const listed = options.listing ?? createGhBoardListing({ gh });
  let asked = false;
  const listing = listOnce(() => {
    asked = true;
    return listed();
  });
  const issues = memoiseIssues(createGhSpecIssueReader({ gh }));

  const board: Pick<NextBoard, 'blocking' | 'isReady'> = {
    blocking: async (issue: number): Promise<BlockedLine | null> => readBlockedLine(
      await issues(issue),
      blockerStatesOf(issues),
    ),
    isReady: async (issue: number): Promise<boolean> => hasSpecReadyLabel((await issues(issue)).labels),
  };

  return Object.freeze({
    next: async (): Promise<NextRoadmapReading> => {
      const { number: fallback } = await resolveDefaultBoard({
        configured,
        listBoards: createGhBoardLister({ gh }),
        search: createGhRoadmapSearch({ gh }),
      });
      const current = root === undefined
        ? null
        : await readCurrentPlace(root, listing, fallback);
      const roadmap = current?.place?.board ?? fallback;
      const epic = current?.place?.epic ?? null;
      const branches = scanClaimBranches(git, remote);
      const readings = createRoadmapReadings({
        issues,
        branches,
        pullRequests: createGhOpenPullRequests({ gh }),
      });
      const followed = options.roadmap === true
        ? followHopRecord(root)
        : null;
      const picker = followed === null
        ? plainPick
        : waitingPick(board.blocking);
      const record = followed?.record ?? null;
      const target = awayTargetOf(record);
      const away = record !== null && target !== null
        ? await walkTarget(record, target, readings)
        : null;
      const walk = away?.walk ?? (epic === null
        ? await walkBoard(roadmap, { issues, readings, listing }, picker)
        : await walkEpic(epic, listing, readings, picker));
      const answer = followed === null
        ? null
        : await readHopAnswer(walk, followed, { blocking: board.blocking, readings, listing, fallback, roadmap });
      const cancelled = options.noticeCancelled === true && asked
        ? await cancelledNotices(listing)
        : [];
      return {
        roadmap,
        line: walk.line,
        passed: walk.passed,
        problems: [...current?.notices ?? [], ...cancelled, ...branches.problems, ...followed?.problems ?? [], ...answer?.problems ?? []],
        ...walk.dry === null
          ? {}
          : { dryEpic: walk.dry },
        ...followed === null || answer === null
          ? {}
          : {
            hop: Object.freeze({
              record: followed.record,
              stale: followed.stale,
              position: followed.position,
              target: away?.target ?? null,
              waiting: walk.waiting,
              decision: answer.decision,
              nextEpic: answer.nextEpic,
            }),
          },
      };
    },

    blocking: board.blocking,
    isReady: board.isReady,
  });
}

/**
 * The walk down `roadmap`'s checklist, descending into its first open
 * `now` epic: `pickDescendedLine`'s descent and pick, the pick made by
 * `picker`.
 */
async function walkBoard(roadmap: number, seams: EpicDescentSeams, picker: LinePicker): Promise<WalkAnswer> {
  const read = await seams.issues(roadmap);
  const descent = await descendRoadmap(parseRoadmapBody(read.body), seams);
  const pick = await picker(descent.lines, seams.readings);
  return {
    line: pick.line,
    passed: descent.passed.length + pick.passed,
    dry: descent.epic !== null && pick.line === null
      ? { number: descent.epic.number, title: descent.epic.title }
      : null,
    epic: descent.epic?.number ?? null,
    waiting: pick.waiting,
  };
}

/** The project the dispatcher resolved, which it resolves for every command declaring it needs one. */
function nextProject(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error(`${PREFIX} runs inside a project, and was handed none`);
  return context.project;
}

/** The settings the composition reads, or the exit-1 refusal of a config that cannot be used. */
function nextConfig(project: ProjectFound, warn: (message: string) => void): NextConfig {
  try {
    return loadConfig({ root: project.root, home: project.home }, {}, warn).config;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(1, [
      `❌ ${PREFIX}: the config cannot be used:`,
      ...error.problems.map((problem) => `   ${problem}`),
    ].join('\n'));
  }
}

/** How {@link openNextSources} opens the sources beside the seams. */
export interface NextSourcesOptions {
  /** Open them for `rafa next --roadmap`; see {@link openNextSources}. False when left out. */
  readonly roadmap?: boolean;
}

/**
 * What {@link openNextSources} answers: the sources, and {@link
 * OpenedNextSources.answer} for the next one. Only `rafa next` holds
 * this type; every reading takes the plain {@link NextSources}, so a
 * test's double needs nothing new.
 */
export interface OpenedNextSources extends NextSources {
  /**
   * Sources for ONE answer, with a board of their own. The board memoises
   * the issue it reads so the rows over one answer cost one `gh issue
   * view` between them, and a memo held across a chain's turns is a
   * chain that cannot see what its own action changed: on 2026-09-23
   * `rafa next` marked #82 ready, read the labels it had cached before
   * that, proposed the same step again and stopped `unchanged`. So the
   * chain takes a new answer per turn.
   */
  readonly answer: () => NextSources;
  /**
   * The released versions `release.changelog` names that carry no tag,
   * read afresh each call and only when called: `rafa next` asks it once
   * an epic ran dry, and nothing else does (`./epic-end.ts`).
   */
  readonly release: () => EpicEndRelease;
  /** The settle dry run over `origin/<base>`, read only after a merge step (`./settle-step.ts`). */
  readonly settle: SettleReader;
}

/**
 * The sources one answer is read over, composed for the project the
 * dispatcher resolved. Warnings the config raises are written through
 * the command's output.
 *
 * With {@link NextSourcesOptions.roadmap}, as `rafa next --roadmap` opens
 * them, each board is built with {@link NextBoardOptions.roadmap} and the
 * sources carry {@link NextSources.roadmap}, the owner gate composed by
 * `./owner-gate.ts`; without it neither key is there and nothing more is
 * read.
 *
 * Throws `CommandExit(2, PR_NEEDS_GH)` where `pr.provider` is not `gh`,
 * and `CommandExit(1, ...)` for a config that cannot be used. Nothing is
 * read off git, the board or the provider here: every reading is a
 * function the table calls only where a row asks for it.
 */
export function openNextSources(
  context: RafaContext,
  seams: NextSourceSeams = DEFAULT_NEXT_SOURCE_SEAMS,
  options: NextSourcesOptions = {},
): OpenedNextSources {
  const project = nextProject(context);
  const config = nextConfig(project, (message: string) => {
    context.output.warn(message);
  });
  requireGhProvider(resolvePrProvider({
    configured: config.prProvider,
    dir: project.root,
    readRemote: seams.readRemote,
  }));

  const git = (seams.openGit ?? createGitRunner)(project.root);
  const gh = (seams.openGh ?? ((root: string): GhRunner => createGhRunner({ cwd: root })))(project.root);
  const loop = resolveLoopSeams({ isAlive: seams.isAlive });

  const roadmap = options.roadmap === true;
  const board = (): NextBoard => ghNextBoard({
    gh,
    git,
    configured: config.roadmapIssue,
    root: project.root,
    noticeCancelled: true,
    ...roadmap
      ? { roadmap }
      : {},
  });
  const pulls = (seams.pullRequests ?? ghPullRequestsIn)(project.root);
  const held = {
    base: config.prBase ?? DEFAULT_BASE_BRANCH,
    plans: plansDirAt(project.root, config.planDir),
    runs: (): readonly SessionRecord[] => readRecords(project.root, loop),
    git,
    pulls,
    ...roadmap
      ? { roadmap: Object.freeze({ ownerApproval: nextOwnerGate({ gh, root: project.root, pulls, configured: config.roadmapIssue }) }) }
      : {},
  };

  return Object.freeze({
    ...held,
    board: board(),
    answer: () => Object.freeze({ ...held, board: board() }),
    release: () => readEpicEndRelease(git, project.root, config.releaseChangelog),
    settle: settleReaderFor({ root: project.root, home: project.home, base: held.base, config }, git),
  });
}
