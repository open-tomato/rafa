/**
 * The roadmap pick behind `plan create --next`: the board or the epic
 * the walk starts from, the walk over its lines, the lines it prints,
 * and the issue it answers, or the reason the run stops without one.
 *
 * `./spec-source.ts` is the funnel all three flags pass through, and
 * `--next` is `--issue` with the number read off the roadmap rather than
 * typed. This module is that reading and nothing after it: it answers an
 * issue NUMBER, and the read, the checks, the `--dry-run` stop and the
 * snapshot that follow are the funnel's, shared with `--issue`.
 *
 * Nothing here spawns and nothing here reads a flag. The issues arrive
 * through the memoised {@link SpecIssueReader} the funnel hands in, the
 * boards, the search, the branches and the pull requests through
 * {@link RoadmapSeams}, and the position file under the project root
 * through `readCurrentPlace` (`./roadmap-rows.ts`), so every case in
 * `./spec-source-roadmap.test.ts` drives fakes of its own and writes in
 * its own temporary directory.
 *
 * ## Where the walk starts
 *
 * - `--next=<n>` ranks first: board `n` is read and walked as it always
 *   was, and the position file is not read at all, so a typed number
 *   means what it says whatever this checkout was switched to.
 * - Otherwise the DEFAULT board is found by `resolveDefaultBoard`
 *   (`./boards.ts`), `roadmap.issue` first, and then the CURRENT PLACE is
 *   read by `readCurrentPlace`, the reading `rafa roadmap`, `rafa epics`
 *   and `rafa next` take: nothing at all when the root holds no position
 *   file, else `resolvePlace` (`./place.ts`) over one board listing, a
 *   place that no longer stands falling back by that module's rule.
 * - No position file: the default board's checklist is walked exactly as
 *   before positions, the same `gh` commands and the same lines printed.
 * - A place naming a board alone: that board's checklist is walked the
 *   same way, descending into its first open `now` epic, and the header
 *   names that board.
 * - A place naming an epic: that epic's lines alone are walked, in the
 *   order `epicLines` (`./epic-walk.ts`) gives them, WHATEVER its
 *   horizon, since a switch chose it. The walk prints the epic's header
 *   and its label-only members as the descent prints them, and an epic
 *   whose every line is done or taken has run dry. The board's own body
 *   is still read and handed to {@link RoadmapSeams.inspectRoadmap}, so a
 *   run from a place checks the same author a run from the board does,
 *   but none of its lines is walked. The epic's line in
 *   {@link DescendedEpic.line} is on no roadmap: it carries the epic's
 *   own number and title, numbered 0, before any body line.
 *
 * Every notice the place reading gives but the absent-file one is a
 * WARNING, printed before the header; a listing that failed while a
 * position file is there is one such notice, the default board then
 * walked unweighed. The listing is read at most once per run, the place
 * and the walk sharing it, as `rafa next`'s walk shares it
 * (`src/next/sources.ts`).
 *
 * ## Under `--roadmap`: the away hop's target
 *
 * A request carrying {@link RoadmapPickOptions.followHop} (`plan create
 * --next --roadmap`, which `rafa next --roadmap` sends) first reads the
 * hop record (`.rafa/hop.json`, `src/next/hop-record.ts`) and the
 * position file through {@link readAwayHop}. Where the record is a
 * `blocker` hop still `away`, and its home is still the position's, the
 * pick is the record's target C, whether `--next` or `--next=<n>` was
 * typed: C is on the board the record names, not on the one the walk
 * would read, so no board is resolved, no roadmap body read or
 * inspected, no branch scanned and no listing made. C is read once
 * through the memoised reader for its `Blocked by:` line, a C with a
 * blocker still open stops `blocked` ({@link hopBlockedMessage}; a
 * hop's chain never reaches a second one, so nothing is offered in its
 * place), and otherwise its number is answered and the funnel's
 * readiness gate runs on it as on any line picked at home.
 *
 * Every other reading picks as a bare `--next` does: no record, a
 * `dry` hop (the position already stands in the epic it went to), a
 * record no longer `away`, and a STALE record, whose home a person's
 * `rafa switch` has since moved. A record that cannot be read, or is
 * not one, is warned in one line first ({@link unfollowedHopNotice}).
 * Without `followHop` neither file is read.
 *
 * ## The one line the walk moves past, and what moves it
 *
 * A line that is not ready STOPS the walk (`./spec-source.ts`, where
 * `inspect` runs). A BLOCKED pick is the exception, and it is one because
 * an operator said yes to it. A line whose issue carries `spec:blocked`
 * with a blocker still open is work that cannot start whatever anyone
 * types, so the run neither plans it nor stops silently: it names what
 * the line waits on ({@link blockedPickLine}, `#57 is blocked by #24
 * (open)`), walks on for the first line under it that is ready, not
 * blocked and not taken (`./blocked-line.ts`), names that one by number
 * and asks. Only a yes plans it; no answer, no alternative on the
 * roadmap and no terminal to ask on each end the run with a sentence
 * saying which, and all three stop at {@link RoadmapStop} `blocked`.
 *
 * So the walk reorders nothing by itself, and the only thing that moves
 * past a line is an answer, or a claim git refused (below). A run handed no offer
 * ({@link RoadmapSeams.offerAlternative}) plans nothing at all, which is
 * what a `--dry-run` run and a run with no terminal both get
 * (`./plan-spec.ts`).
 *
 * The blocked reading costs NO command of its own: the label and the
 * `Blocked by:` line are read off the issue the walk already read to
 * ask whether it was closed, and each blocker's state goes through the
 * same memoised reader. It runs before the funnel's `inspect`, so a
 * blocked pick is never offered the `spec:ready` label on its way past;
 * the line the offer names goes through `inspect` in full, exactly as a
 * typed `--issue=<n>` would.
 *
 * ## A line whose claim was refused
 *
 * `plan create --next` claims the issue it picked before its planning
 * session (`src/commands/plan/claim-route.ts`), and a claim another
 * store holds is refused. The run then resolves again, handing the
 * refused issues in as {@link RoadmapSeams.passOver}, each with the
 * branch whose claim refused it; the walk reads such a line as TAKEN by
 * that branch, printed as any taken line is, and walks on. So the line
 * is passed because git answered for it, never because the walk
 * guessed, and it is passed wherever the walk meets it: in the
 * roadmap, inside an epic, and on the way to a blocked line's
 * alternative. An away hop whose target was refused is not followed,
 * warned in one line ({@link unfollowedHopNotice}), and the walk picks
 * as a bare `--next` does. With no `passOver`, the walk is the one it
 * always was.
 *
 * ## The roadmap's own body, and why it has a seam of its own
 *
 * `inspect` runs on the line the walk PICKS. The roadmap is a second
 * body the `--next` route reads, and it is board text as much as the
 * spec is: what its lines decide is the ORDER, so whoever can write it
 * can point the next session at an issue of their choosing.
 *
 * It goes through {@link RoadmapSeams.inspectRoadmap} rather than
 * through `inspect`, because the two bodies are asked different
 * questions. The roadmap carries no `spec:ready` label, fills no spec
 * template and is never snapshotted, so the checks `inspect` composes
 * would refuse every roadmap there is; what is left to ask about it is
 * its AUTHOR, and that is the caller's to compose too
 * (`./plan-spec.ts`).
 *
 * It is called on the issue as READ and before a line is parsed out of
 * it, which is also before the branch scan and the pull request list
 * are spent: a roadmap whose author the caller refuses costs the read
 * that found the author and nothing else, and no line of it reaches
 * the walk, the output or a snapshot.
 *
 * ## A roadmap line naming an epic
 *
 * The walk is `pickDescendedLine` (`./epic-walk.ts`), the one `rafa next`
 * shares, over the same memoised reader and readings, so an epic line is
 * told apart by labels already read and a roadmap with no epic line
 * spends nothing more and prints the same lines. The board is listed
 * through {@link RoadmapSeams.listing} only for an open `now` epic line,
 * or when a position file is there to weigh. Walking into one prints its
 * header, each open member missing from its checklist, then the walk
 * over its lines; a blocked pick's alternative is looked for among those
 * lines only. An epic whose every line is done or taken has run dry: the
 * run stops `exhausted` on that sentence and never reads on into a
 * second epic.
 *
 * ## The branch scan's problems are printed, never swallowed
 *
 * `scanClaimBranches` carries a failed remote read out as sentences
 * rather than throwing, because "nothing is taken" read off a check
 * that never ran is how two people end up on one spec
 * (`./roadmap.ts`). This module is the caller that decides what to do
 * with them, and the policy is: WARN each one and carry on. The walk
 * still has the local half, the operator is told which half is
 * missing, and a laptop with no network still plans.
 */
import type { AlternativeOffer, BlockedLine, PassedLine, PlannableReadings } from './blocked-line.js';
import type { BoardLister } from './boards.js';
import type { DescendedEpic, DescendedPick, DescentPass } from './epic-walk.js';
import type { SpecIssue, SpecIssueReader } from './issue.js';
import type { BoardIssue, BoardListing } from './roadmap-board.js';
import type {
  BranchClaimReading,
  OpenPullRequestLister,
  RoadmapLine,
  RoadmapReadings,
  RoadmapSearch,
  RoadmapSkip,
} from './roadmap.js';
import type { HopRecord } from '../next/hop-record.js';
import type { Output } from '../ports/index.js';
import type { GitRunner } from '../pr/git.js';

import { readHopRecord, staleAgainst } from '../next/hop-record.js';
import { readPositionFile } from '../project/position.js';

import {
  blockedLineSentence,
  blockerStatesOf,
  declinedMessage,
  noAlternativeMessage,
  pickPlannableLine,
  plannableReadings,
  readBlockedLine,
  unaskedMessage,
} from './blocked-line.js';
import { resolveDefaultBoard } from './boards.js';
import {
  descentPassSentence,
  dryEpicSentence,
  epicHeaderSentence,
  epicLines,
  labelOnlySentence,
  pickDescendedLine,
} from './epic-walk.js';
import { readEpics } from './epics.js';
import { readCurrentPlace } from './roadmap-rows.js';
import {
  createRoadmapReadings,
  exhaustedMessage,
  parseRoadmapBody,
  pickNextRoadmapLine,
  scanClaimBranches,
  skipSentence,
} from './roadmap.js';

/** What every failure this module raises opens with. */
const PREFIX = 'board spec source roadmap';

/** What `--next` reads the roadmap through; only that route needs it. */
export interface RoadmapSeams {
  /** `roadmap.issue` as config resolved it, or null for the default board `resolveDefaultBoard` ranks. */
  readonly configured: number | null;
  /** Lists the `type:roadmap` boards, once. */
  readonly listBoards: BoardLister;
  /** Finds the issue titled `Roadmap` when nothing names or labels one. */
  readonly search: RoadmapSearch;
  /** Runs the two branch reads the taken reading is taken from. */
  readonly git: GitRunner;
  /** The remote the pushed half of the scan asks; `origin` when left out. */
  readonly remote?: string;
  /** Lists the open pull requests the other taken reading is read from. */
  readonly pullRequests: OpenPullRequestLister;
  /** Lists the board, once, and only for an open `now` epic line or a position file to weigh. */
  readonly listing: BoardListing;
  /** The checks that run on the roadmap issue as read, before a line is parsed out of it. */
  readonly inspectRoadmap?: (issue: SpecIssue) => Promise<void>;
  /**
   * Asks whether to plan the line offered in place of a blocked one;
   * left out for a run with nobody to ask, which plans nothing and says
   * so ({@link unaskedMessage}). See the module note.
   */
  readonly offerAlternative?: AlternativeOffer;
  /**
   * Issues whose claim was refused this run, each with the branch that
   * refused it: read as taken by that branch. Left out, or empty, for a
   * walk that passes nothing over. See the module note.
   */
  readonly passOver?: ReadonlyMap<number, string>;
}

/** Why a `--next` walk stopped without an issue. */
export type RoadmapStop = 'exhausted' | 'blocked';

/**
 * The walk a pick was read off, for the line after it: the board whose
 * body was read and the lines walked, the roadmap's or the one epic's,
 * with the readings they were read through. Claim ahead reads it
 * (`src/claims/ahead.ts`); a pick that followed a hop walked none.
 */
export interface RoadmapWalk {
  readonly board: number;
  readonly lines: readonly RoadmapLine[];
  readonly readings: RoadmapReadings;
}

/**
 * What a `--next` walk came to: the issue to plan from, with the walk
 * it was picked on when it walked one, or why the run stops.
 */
export type RoadmapOutcome =
  | { readonly issue: number; readonly walk?: RoadmapWalk }
  | { readonly stop: RoadmapStop };

/** What {@link pickRoadmapIssue} is handed. */
export interface RoadmapPickOptions {
  /** The roadmap `--next=<n>` named, or null for a bare `--next`. */
  readonly roadmap: number | null;
  /** The seams the roadmap is read through. */
  readonly seams: RoadmapSeams;
  /** The project root whose position file names the current place. */
  readonly root: string;
  /** The funnel's memoised issue reader; the walk and the snapshot share it. */
  readonly issues: SpecIssueReader;
  /** Where the lines go. */
  readonly output: Output;
  /** True under `--roadmap`: an away hop's target is the pick. Left out otherwise; see the module note. */
  readonly followHop?: boolean;
}

/** A blocker hop still away: the record, its target C read off it. */
export interface AwayHop {
  readonly record: HopRecord;
  /** C, the issue the hop works. */
  readonly target: number;
}

/** What {@link readAwayHop} answers: the hop to follow or null, and the warnings. */
export interface AwayHopReading {
  readonly away: AwayHop | null;
  readonly notices: readonly string[];
}

/** The line an away hop's pick opens with, naming C, H and where C lives. */
export function hopHeaderLine(away: AwayHop): string {
  const { record, target } = away;
  return `🧭 Away on a hop: issue #${String(target)}, the blocker of #${String(record.blocked)},`
    + ` in epic #${String(record.targetEpic)} on board #${String(record.targetBoard)}`;
}

/** The line an away hop's pick prints once C is taken. */
export function hopPickLine(target: number): string {
  return `▶ Next on the hop: issue #${String(target)}`;
}

/** The sentence an away hop's pick stops on when C still has an open blocker. */
export function hopBlockedMessage(target: number): string {
  return `issue #${String(target)} is the hop's target and still has an open blocker, so nothing is planned;`
    + ' a hop follows one blocker, never a second, and `rafa next --roadmap` goes home from here';
}

/** The warning a hop record that cannot be read, or is not one, is followed by. */
export function unfollowedHopNotice(detail: string): string {
  return `${detail}, so no hop is followed and --next picks as it does without --roadmap`;
}

/**
 * The hop `plan create --next --roadmap` follows under `root`: a
 * `blocker` record still `away` whose home is the position's, or null.
 * Never throws; see the module note's "Under `--roadmap`".
 */
export function readAwayHop(root: string): AwayHopReading {
  const hop = readHopRecord(root);
  if (!hop.set) {
    return {
      away: null,
      notices: hop.reason === 'absent'
        ? []
        : [unfollowedHopNotice(hop.detail)],
    };
  }
  const { record } = hop;
  const placed = readPositionFile(root);
  if (!placed.set || staleAgainst(record, placed.position)) return { away: null, notices: [] };
  if (record.state !== 'away' || record.kind !== 'blocker' || record.target === null) return { away: null, notices: [] };
  return { away: Object.freeze({ record, target: record.target }), notices: [] };
}

/** The line a `--next` walk opens with, naming the roadmap it is reading. */
export function roadmapHeaderLine(roadmap: number): string {
  return `🗺  Reading the roadmap, issue #${String(roadmap)}, for the next spec...`;
}

/** The line one skipped roadmap line prints; `./roadmap.ts` spells the sentence. */
export function skipLine(skip: RoadmapSkip): string {
  return `   ⏭  ${skipSentence(skip)}`;
}

/** The line one line the epic descent passed prints; a roadmap line's is {@link skipLine}'s. */
export function descentPassLine(pass: DescentPass): string {
  return `   ⏭  ${descentPassSentence(pass)}`;
}

/** The line a walk prints on walking into an epic. */
export function epicHeaderLine(epic: DescendedEpic): string {
  return `   🧭 ${epicHeaderSentence(epic)}`;
}

/** The line one open member missing from the epic's checklist prints. */
export function labelOnlyLine(epic: DescendedEpic, member: BoardIssue): string {
  return `   🏷  ${labelOnlySentence(epic, member)}`;
}

/** The line the pick prints, with the roadmap's own one-line why when it has one. */
export function pickLine(line: RoadmapLine): string {
  const id = `▶ Next on the roadmap: issue #${String(line.issue)}`;
  return line.why === ''
    ? id
    : `${id} — ${line.why}`;
}

/** The line a blocked pick prints, naming what it waits on. */
export function blockedPickLine(blocked: BlockedLine): string {
  return `   🚧 ${blockedLineSentence(blocked)}`;
}

/** The line one line passed on the way to the alternative prints. */
export function passedLine(passed: PassedLine): string {
  return `   ⏭  ${passed.sentence}`;
}

/** The line naming what a run would plan in place of the blocked one. */
export function alternativeLine(line: RoadmapLine): string {
  const id = `▶ Ready instead: issue #${String(line.issue)}`;
  return line.why === ''
    ? id
    : `${id} — ${line.why}`;
}

/** `read`, asked on the first call only; every call answers or rejects as the first did. */
function listOnce(read: BoardListing): BoardListing {
  let kept: ReturnType<BoardListing> | null = null;
  return () => {
    kept ??= read();
    return kept;
  };
}

/** Where one walk starts: the board whose body is read, the epic walked alone or null, and the warnings. */
interface StartingPlace {
  readonly board: number;
  readonly epic: number | null;
  readonly notices: readonly string[];
}

/** Where the walk starts; the module note's "Where the walk starts" holds the order. */
async function startingPlace(options: RoadmapPickOptions, listing: BoardListing): Promise<StartingPlace> {
  const { seams, roadmap } = options;
  const { number: fallback } = await resolveDefaultBoard({
    configured: roadmap ?? seams.configured,
    listBoards: seams.listBoards,
    search: seams.search,
  });
  if (roadmap !== null) return { board: fallback, epic: null, notices: [] };

  const current = await readCurrentPlace(options.root, listing, fallback);
  return {
    board: current.place?.board ?? fallback,
    epic: current.place?.epic ?? null,
    notices: current.notices,
  };
}

/**
 * The walk inside the epic `number` alone, whatever its horizon, shaped
 * as the descent answers one it walked into: its lines as `epicLines`
 * orders them, picked with the roadmap's own readings. See the module
 * note's "Where the walk starts".
 */
async function walkPlaceEpic(number: number, listing: BoardListing, readings: RoadmapReadings): Promise<DescendedPick> {
  const rows = await listing();
  const read = readEpics({ issues: rows, claims: new Set(), today: new Date(0) }).epics
    .find((candidate) => candidate.number === number);
  const row = rows.find((issue) => issue.number === number);
  if (read === undefined || row === undefined) {
    throw new Error(`${PREFIX}: epic #${String(number)}, the current place, is not on the board listing, so its members cannot be read`);
  }

  const { checklist, labelOnly, lines } = epicLines(read, row);
  const epic: DescendedEpic = Object.freeze({
    line: Object.freeze({ issue: number, ticked: false, why: read.title, lineNumber: 0 }),
    number,
    title: read.title,
    slug: read.slug,
    progress: read.progress,
    checklist,
    labelOnly,
  });
  const pick = await pickNextRoadmapLine(lines, readings);
  return Object.freeze({
    descent: Object.freeze({ lines, passed: Object.freeze([]), epic }),
    pick,
    dry: pick.line === null,
  });
}

/**
 * What the `--next` walk answers: the issue to plan from, or why it
 * stops, with every line it passed printed on the way. Throws what the
 * seams throw: the board's refusals from `./boards.ts` and the roadmap
 * checks' own.
 */
export async function pickRoadmapIssue(options: RoadmapPickOptions): Promise<RoadmapOutcome> {
  const { seams, issues, output } = options;
  const passOver = seams.passOver ?? new Map<number, string>();
  if (options.followHop === true) {
    const hop = readAwayHop(options.root);
    hop.notices.forEach((notice) => output.warn(notice));
    const refused = hop.away === null
      ? undefined
      : passOver.get(hop.away.target);
    if (hop.away !== null && refused !== undefined) {
      output.warn(unfollowedHopNotice(`issue #${String(hop.away.target)}, the hop's target, was refused its claim on ${refused}`));
    } else if (hop.away !== null) {
      return await pickHopTarget(hop.away, issues, output);
    }
  }
  const listing = listOnce(seams.listing);
  const start = await startingPlace(options, listing);
  start.notices.forEach((notice) => output.warn(notice));
  const roadmap = start.board;
  output.info(roadmapHeaderLine(roadmap));

  // The roadmap as read, checked before a line is parsed out of it and
  // before either taken reading is spent. See the module note.
  const read = await issues(roadmap);
  await seams.inspectRoadmap?.(read);

  const branches = scanClaimBranches(seams.git, seams.remote);
  branches.problems.forEach((problem) => output.warn(problem));

  const readings = passingOver(createRoadmapReadings({
    issues,
    branches,
    pullRequests: seams.pullRequests,
  }), passOver);
  const walked = start.epic === null
    ? await pickDescendedLine(parseRoadmapBody(read.body), { issues, readings, listing })
    : await walkPlaceEpic(start.epic, listing, readings);
  printDescent(walked, output);
  const { descent, pick } = walked;

  if (descent.epic !== null && walked.dry) {
    output.info(dryEpicSentence(descent.epic));
    return { stop: 'exhausted' };
  }
  if (pick.line === null) {
    output.info(exhaustedMessage(roadmap, [...descent.passed, ...pick.skipped]));
    return { stop: 'exhausted' };
  }

  output.info(pickLine(pick.line));
  const settled = await settlePick(pick.line, { lines: descent.lines, issues, readings, seams, output });
  return 'stop' in settled
    ? settled
    : { ...settled, walk: Object.freeze({ board: roadmap, lines: descent.lines, readings }) };
}

/**
 * `readings` with every issue of `passOver` read as taken by the branch
 * that refused its claim, and every other issue read as `readings` reads
 * it. See the module note's "A line whose claim was refused".
 */
export function passingOver(readings: RoadmapReadings, passOver: ReadonlyMap<number, string>): RoadmapReadings {
  if (passOver.size === 0) return readings;
  return Object.freeze({
    ...readings,
    branchClaimFor: async (issue: number): Promise<BranchClaimReading | null> => {
      const branch = passOver.get(issue);
      return branch === undefined
        ? await readings.branchClaimFor(issue)
        : { branch, claim: { state: 'none' } };
    },
  });
}

/**
 * C, the away hop's target, as the pick, or `blocked` when C still has an
 * open blocker. See the module note's "Under `--roadmap`".
 */
async function pickHopTarget(away: AwayHop, issues: SpecIssueReader, output: Output): Promise<RoadmapOutcome> {
  output.info(hopHeaderLine(away));
  const blocked = await readBlockedLine(await issues(away.target), blockerStatesOf(issues));
  if (blocked !== null) {
    output.info(blockedPickLine(blocked));
    output.info(hopBlockedMessage(away.target));
    return { stop: 'blocked' };
  }
  output.info(hopPickLine(away.target));
  return { issue: away.target };
}

/**
 * The lines the descent and the walk over its lines passed, in the order
 * read: the roadmap lines and epic lines passed to reach the epic, its
 * header and its label-only members, then the lines passed inside it. A
 * roadmap with no epic line prints its skip lines alone, as it always did.
 */
function printDescent(walked: DescendedPick, output: Output): void {
  const { descent, pick } = walked;
  descent.passed.forEach((pass) => output.info(descentPassLine(pass)));
  const { epic } = descent;
  if (epic !== null) {
    output.info(epicHeaderLine(epic));
    epic.labelOnly.forEach((member) => output.info(labelOnlyLine(epic, member)));
  }
  pick.skipped.forEach((skip) => output.info(skipLine(skip)));
}

/** What {@link settlePick} reads the picked line through. */
interface PickSettlement {
  /** The lines walked: the roadmap's, or the one epic's the walk went into. */
  readonly lines: readonly RoadmapLine[];
  readonly issues: SpecIssueReader;
  readonly readings: RoadmapReadings;
  readonly seams: RoadmapSeams;
  readonly output: Output;
}

/**
 * The picked line as it stands, or the blocked reading of it settled.
 *
 * The issue is read off the memoised reader the walk has been using, so
 * the label and the `Blocked by:` line cost no `gh issue view` of their
 * own: the walk read that issue to ask whether it was closed.
 */
async function settlePick(line: RoadmapLine, settlement: PickSettlement): Promise<RoadmapOutcome> {
  const { issues } = settlement;
  const blocked = await readBlockedLine(await issues(line.issue), blockerStatesOf(issues));
  if (blocked === null) return { issue: line.issue };

  return settleBlockedPick({
    blocked,
    lines: settlement.lines,
    line,
    readings: plannableReadings({ issues, readings: settlement.readings }),
    offer: settlement.seams.offerAlternative,
    output: settlement.output,
  });
}

/** What {@link settleBlockedPick} is handed, everything the walk already read. */
interface BlockedPickOptions {
  /** Why the line the walk picked cannot be planned. */
  readonly blocked: BlockedLine;
  /** The lines walked, in order: the roadmap's, or the one epic's. */
  readonly lines: readonly RoadmapLine[];
  /** The blocked line itself; the walk for an alternative resumes under it. */
  readonly line: RoadmapLine;
  /** The three readings the alternative is looked for through. */
  readonly readings: PlannableReadings;
  /** Asks whether to plan the alternative, or undefined for a run with nobody to ask. */
  readonly offer: AlternativeOffer | undefined;
  /** Where the lines go. */
  readonly output: Output;
}

/**
 * What a walk whose pick is BLOCKED comes to: the blocker named, the
 * first line under it that is ready, not blocked and not taken offered
 * by number, and the issue to plan only where the answer was yes.
 *
 * Three of the four endings plan nothing and each says which it is — no
 * alternative on the roadmap at all, nobody to ask, and an answer that
 * was not yes — because a `--next` run that printed one blocked line and
 * stopped would read as a command that did nothing. The module note
 * holds why the offer is the only thing that reorders the roadmap.
 */
async function settleBlockedPick(options: BlockedPickOptions): Promise<RoadmapOutcome> {
  const { blocked, output } = options;
  output.info(blockedPickLine(blocked));

  const plannable = await pickPlannableLine(options.lines, options.line, options.readings);
  plannable.passed.forEach((passed) => output.info(passedLine(passed)));
  if (plannable.line === null) {
    output.info(noAlternativeMessage(blocked.issue));
    return { stop: 'blocked' };
  }

  output.info(alternativeLine(plannable.line));
  const { offer } = options;
  if (offer === undefined) {
    output.info(unaskedMessage(blocked.issue, plannable.line.issue));
    return { stop: 'blocked' };
  }
  if (!await offer({ blocked, line: plannable.line })) {
    output.info(declinedMessage(plannable.line.issue));
    return { stop: 'blocked' };
  }
  return { issue: plannable.line.issue };
}
