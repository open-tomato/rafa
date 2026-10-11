/**
 * What the state table of `./state.ts` is answered over: the run
 * records, the git seam, the plans directory, the pull request provider
 * and the board, behind one set of readings each made at most once.
 *
 * The split is the `pr` subject's own (`src/pr/merge.ts` beside
 * `src/commands/pr/merge.ts`): this module is the half that READS, and
 * `./state.ts` is the half that decides, so a row of the table is a
 * comparison over data and never a command. Nothing is spawned here
 * either — git arrives through the {@link NextSources.git} seam, the
 * provider through {@link NextSources.pulls} and the board through
 * {@link NextBoard} — which is what keeps every case of
 * `./readings.test.ts` and `./state.test.ts` off GitHub and off the
 * network.
 *
 * ## Each reading is made at most once, and only when it is asked for
 *
 * {@link openWorld} answers a {@link NextWorld} of functions, every one
 * of them memoised ({@link once}). The table is ordered, so a state an
 * early row settles never spends what a later one would have: a loop
 * that is running is answered out of `.rafa/runs/` alone, with no git,
 * no provider and no board asked at all. The provider is reached from
 * row 5 on, and the board from row 10 on.
 *
 * {@link NextWorld.tracked} and {@link NextWorld.checkout} are the two
 * readings the table does not own: `./preconditions.ts` makes them once
 * row 1 has found no live run and ahead of every other row, for the
 * pre-condition that stops the table on a working tree with changes to
 * tracked files. The first is one `git status --porcelain` at the
 * project root, and the second, `git rev-parse --show-toplevel` there,
 * is asked only once the first has found a change, to name the checkout
 * the changes were read in. Neither asks anything of the network.
 *
 * The board is asked from the BASE BRANCH alone, because every row that
 * reads it names the base. So `rafa next` on a plan branch spends no
 * `gh issue view`, whatever the roadmap holds.
 *
 * ## The base is fetched before its standing is read
 *
 * {@link NextWorld.standing} runs `git fetch <remote> <base>` and then
 * `git rev-list --left-right --count <base>...<remote>/<base>`, the pair
 * `src/start/branch-decision.ts` measured and parses. A standing read
 * off an unfetched clone answers "up to date" for a base a colleague
 * pushed to an hour ago, and the row that reads it is the one that
 * exists to stop a plan being cut from that base.
 *
 * ## A plan branch holding claim commits alone is not started
 *
 * `plan create` claims the issue it plans (`src/claims/`): one empty
 * commit, subject `claim(rafa-<n>): claim`, on the base, pushed as
 * `feat/<stub>`. So a plan nobody has run on has a branch all the same,
 * and {@link NextWorld.unstartedPlan} reads past it: a plan is started
 * by a run or by a branch tip, here or remote-tracking, holding any
 * commit past its fork from the base that is no well-formed ownership
 * commit ({@link hasStartedBranch}). A branch that holds no commit past
 * its fork reads started, as every branch did before claims, and so
 * does one whose commits could not be read: a remote-only branch this
 * clone has not fetched is noted and never fetched here.
 *
 * ## A failed reading is carried, not thrown
 *
 * Every read that fails for an ordinary reason — no network, no remote,
 * a detached HEAD, a plans directory that cannot be read, a branch scan
 * whose remote half did not answer — is carried out as one sentence in
 * {@link NextWorld.problems}, the way `scanClaimBranches` carries a
 * failed remote read out as `BranchScan.problems` rather than stopping
 * the walk on it. The caller prints them beside the answer.
 *
 * The one thing NOT carried is a provider that could not be ASKED. The
 * port answers null for a pull request that is not there and THROWS when
 * it could not look (`src/pr/types.ts`), so a throw out of `findOpen`,
 * `get` or `checks` means the provider is unusable rather than that the
 * repository has no pull request, and it is left to the caller
 * unchanged.
 */
import type { HopDecision, TakenBy } from './hop-chain.js';
import type { HopRecord } from './hop-record.js';
import type { BlockedLine } from '../board/blocked-line.js';
import type { NextNowEpic } from '../board/epic-walk.js';
import type { RoadmapLine } from '../board/roadmap.js';
import type { BoardRelationshipMode } from '../config-sections.js';
import type { SessionRecord } from '../loop/sessions.js';
import type { PlanListing } from '../plan/list.js';
import type { PlansDir } from '../plan/plan-files.js';
import type { ChecksVerdict, GitRunner, Mergeability, PullRequests, PullRequestSummary } from '../pr/index.js';
import type { OwnerApproval } from '../pr/owner-approval.js';
import type { Position } from '../project/position.js';
import type { BaseStanding } from '../start/branch-decision.js';

import { scanClaimBranches } from '../board/roadmap.js';
import { parseClaimMessage } from '../claims/record.js';
import { messageOf } from '../config-sections.js';
import { isLive } from '../loop/session-readings.js';
import { listPlans } from '../plan/list.js';
import { planFileName } from '../plan/plan-files.js';
import { gitSaid, parseWorkingTree } from '../pr/index.js';
import { BRANCH_PREFIX, parseBaseStanding, REMOTE, trackedChanges } from '../start/branch-decision.js';

/** The branch `git rev-parse --abbrev-ref HEAD` answers on a detached HEAD. */
const DETACHED = 'HEAD';

/** Where the path starts in a `git status --porcelain` line; see {@link changedPaths}. */
const PORCELAIN_PATH_AT = 3;

/** What one walk of the roadmap answered. */
export interface NextRoadmapReading {
  /** The roadmap issue the walk read, as the last row names it. */
  readonly roadmap: number;
  /** The first line neither done nor taken, or null when the roadmap has none left. */
  readonly line: RoadmapLine | null;
  /** How many lines the walk passed to reach it. */
  readonly passed: number;
  /** One sentence per reading that failed, carried and never thrown. */
  readonly problems: readonly string[];
  /**
   * The epic the walk ran dry in: walked into, or named by the current
   * place, with every line done or taken. The key is LEFT OUT, not set
   * to undefined, when no epic ran dry, so a board with no epic reads
   * with the four keys it always had.
   */
  readonly dryEpic?: DryEpic;
  /**
   * What the walk read for `rafa next --roadmap`: the hop record, the
   * away target, the lines passed as waiting, the one-hop decision and
   * the next `now` epic. The key is LEFT OUT, not set to undefined, on a
   * board built without `roadmap` (`./sources.ts`), so a walk without
   * the flag answers the keys it always did.
   */
  readonly hop?: NextHopReading;
}

/** One blocker of a waiting line, and what took it. */
export interface TakenBlocker {
  /** The blocker's issue number. */
  readonly issue: number;
  /** The branch or the open pull request that took it. */
  readonly taken: TakenBy;
}

/** A line the walk passed because every open blocker it waits on is taken. */
export interface WaitingLine {
  /** The line passed: H. */
  readonly line: RoadmapLine;
  /** Each open or unread blocker of H, in line order, with what took it. */
  readonly blockers: readonly TakenBlocker[];
}

/** The away hop's target C, as this turn read it. */
export interface HopTarget {
  /** C, the record's `target`. */
  readonly issue: number;
  /** True when C is closed. */
  readonly closed: boolean;
  /** The open pull request closing C, or null; not read once C is closed. */
  readonly pullRequest: number | null;
}

/** What {@link NextRoadmapReading.hop} holds; `./sources.ts` holds how each is read. */
export interface NextHopReading {
  /** The hop record this turn follows, or null: none, unset, or dropped as stale. */
  readonly record: HopRecord | null;
  /** A record read and dropped because the position's home is not its home, else null. */
  readonly stale: HopRecord | null;
  /** The position file as read, or null when it reads unset. */
  readonly position: Position | null;
  /** C and its state while a blocker hop is away, else null. */
  readonly target: HopTarget | null;
  /** The lines passed as waiting, in walk order. */
  readonly waiting: readonly WaitingLine[];
  /** The one-hop decision for the line the walk answered when it is blocked, else null. */
  readonly decision: HopDecision | null;
  /** The next `now` epic after the epic that ran dry, else null. */
  readonly nextEpic: NextNowEpic | null;
}

/** An epic whose every line is done or taken, as {@link NextRoadmapReading.dryEpic} names it. */
export interface DryEpic {
  /** The epic issue's number. */
  readonly number: number;
  /** The epic issue's title. */
  readonly title: string;
}

/**
 * The board, as the roadmap rows read it: the next line, and the two
 * readings over that line's issue.
 *
 * The three are the walk `plan create --next` makes
 * (`src/board/spec-source-roadmap.ts`) and the readings beside it
 * (`src/board/blocked-line.ts`), behind one interface, so neither this
 * module nor the table composes any `gh` of its own.
 */
export interface NextBoard {
  /** The roadmap walked once. */
  readonly next: () => Promise<NextRoadmapReading>;
  /** Why the issue waits on other issues, or null when it does not. */
  readonly blocking: (issue: number) => Promise<BlockedLine | null>;
  /** Whether the issue carries `spec:ready`. */
  readonly isReady: (issue: number) => Promise<boolean>;
  /**
   * `native` when the board reads its relationships natively, where the
   * tracker clears a blocker when it closes and `./state.ts` proposes no
   * `unblock`. The key is LEFT OUT, not set to undefined, in `labels`
   * mode, the default.
   */
  readonly mode?: Extract<BoardRelationshipMode, 'native'>;
}

/** What the readings are taken over; see the module note. */
export interface NextSources {
  /** The branch plans are cut from and merged into. */
  readonly base: string;
  /** Where this project's plans sit, as `plan.dir` resolved it. */
  readonly plans: PlansDir;
  /** The session records under `.rafa/runs/`, read at most once per answer. */
  readonly runs: () => readonly SessionRecord[];
  /** git at the project root: the `pr` subject's seam (`src/pr/git.ts`). */
  readonly git: GitRunner;
  /** The pull request provider, resolved at the project root. */
  readonly pulls: PullRequests;
  /** The board. */
  readonly board: NextBoard;
  /** The remote the base is fetched from and the branches are scanned on; `origin` when left out. */
  readonly remote?: string;
  /**
   * What `rafa next --roadmap` reads beside the rest. Set, the table reads
   * its hop rows as well (`./hop-rows.ts`); left out, it reads the
   * thirteen rows alone, and nothing it names is asked.
   */
  readonly roadmap?: NextRoadmapSources;
}

/** What {@link NextSources.roadmap} holds. */
export interface NextRoadmapSources {
  /**
   * The owner gate for one pull request against the home board
   * (`readOwnerApproval`, `src/pr/owner-approval.ts`). A rejection is
   * read as `unknown` by the row that asks, never as approved.
   */
  readonly ownerApproval: (pullRequest: number) => Promise<OwnerApproval>;
}

/** The open pull request of the branch, with the readings the rows split on. */
export interface OpenPull {
  /** The pull request, as `findOpen` answered it. */
  readonly summary: PullRequestSummary;
  /** Whether GitHub says it merges; `unknown` when the detail could not be read. */
  readonly mergeable: Mergeability;
  /** The verdict over its checks. */
  readonly verdict: ChecksVerdict;
}

/** The roadmap's next line, with the readings the roadmap rows split on. */
export interface PickedLine {
  /** The line the walk answered. */
  readonly line: RoadmapLine;
  /** Whether its issue carries `spec:ready`. */
  readonly ready: boolean;
  /** Why its issue waits on other issues, or null when it does not. */
  readonly blocked: BlockedLine | null;
}

/** The readings of one answer, each made at most once. */
export interface NextWorld {
  /** What the readings are taken through. */
  readonly sources: NextSources;
  /** The remote the base is fetched from and the branches are scanned on. */
  readonly remote: string;
  /** The branch at the project root, or the empty string when there was none to read. */
  readonly branch: () => string;
  /** The session record whose run has not ended, or null when no record has one. */
  readonly liveRun: () => SessionRecord | null;
  /** How the base stands against its remote, or null when that could not be read. */
  readonly standing: () => BaseStanding | null;
  /** The tracked paths the working tree has changes to, in git's order. */
  readonly tracked: () => readonly string[];
  /** The checkout {@link NextWorld.tracked} was read in, absolute, or null when it could not be named. */
  readonly checkout: () => string | null;
  /** The plan the branch is named after, or null when the branch names none. */
  readonly branchPlan: () => PlanListing | null;
  /**
   * The first plan with no run and no branch holding work, or null when
   * every plan has one. A `feat/<stub>` holding claim commits alone past
   * its fork from the base is no work: see {@link hasStartedBranch}.
   */
  readonly unstartedPlan: () => PlanListing | null;
  /** The open pull request of the branch, or null when it has none. */
  readonly openPull: () => Promise<OpenPull | null>;
  /** The roadmap walked once. */
  readonly roadmap: () => Promise<NextRoadmapReading>;
  /** The roadmap's next line read, or null off the base branch and on a roadmap with none left. */
  readonly picked: () => Promise<PickedLine | null>;
  /** Every reading that failed, in the order they were made. */
  readonly problems: () => readonly string[];
}

/** One sentence about a reading that failed. */
type Note = (problem: string) => void;

/** `read`, called at most once; every later call answers what the first one read. */
export function once<T>(read: () => T): () => T {
  let held: { readonly value: T } | null = null;
  return (): T => {
    held = held ?? { value: read() };
    return held.value;
  };
}

/** The branch at the project root, or the empty string with a problem noted. */
export function readBranch(sources: NextSources, note: Note): string {
  const result = sources.git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!result.ok) {
    note(`the branch at the project root could not be read, so no branch names a plan or a pull request: ${gitSaid(result)}`);
    return '';
  }

  const branch = result.stdout.trim();
  if (branch !== DETACHED) return branch;

  note('the project root is on a detached HEAD, so no branch names a plan or a pull request');
  return '';
}

/**
 * How the base stands against its remote, the base fetched first; see
 * the module note. A fetch that failed is a problem and not a stop: the
 * counts are then read off whatever the clone already holds.
 */
export function readStanding(sources: NextSources, remote: string, note: Note): BaseStanding | null {
  const { base } = sources;
  const tracking = `${remote}/${base}`;
  const fetched = sources.git(['fetch', remote, base]);
  if (!fetched.ok) {
    note(`\`${tracking}\` could not be fetched, so how \`${base}\` stands is read off what this clone holds: ${gitSaid(fetched)}`);
  }

  const counted = sources.git(['rev-list', '--left-right', '--count', `${base}...${tracking}`]);
  if (!counted.ok) {
    note(`how \`${base}\` stands against \`${tracking}\` could not be read: ${gitSaid(counted)}`);
    return null;
  }

  const standing = parseBaseStanding(counted.stdout);
  if (standing === null) {
    note(`git answered ${JSON.stringify(counted.stdout)} for how \`${base}\` stands against \`${tracking}\`, which is no pair of counts`);
  }
  return standing;
}

/**
 * The paths of the porcelain lines, git's own words kept.
 *
 * A porcelain line is two status characters, a space and the path, so
 * the path is what follows the first three characters. Nothing else is
 * interpreted: a path git quoted stays quoted, and a rename stays the
 * `old -> new` pair git wrote, because the pre-condition that prints
 * these names the files rather than re-rendering them.
 */
export function changedPaths(entries: readonly string[]): readonly string[] {
  return Object.freeze(entries.map((entry) => entry.slice(PORCELAIN_PATH_AT).trim()));
}

/**
 * The tracked paths the working tree has changes to, staged and
 * unstaged alike, or none with a problem noted. An untracked path is
 * left out, the way `treeRefusal` leaves one out: nothing rafa runs
 * loses an untracked file.
 */
export function readTracked(sources: NextSources, note: Note): readonly string[] {
  const result = sources.git(['status', '--porcelain']);
  if (!result.ok) {
    note(`the working tree could not be read, so whether it holds changes to tracked files is unknown: ${gitSaid(result)}`);
    return Object.freeze([]);
  }

  return changedPaths(trackedChanges(parseWorkingTree(result.stdout)));
}

/**
 * The top level of the working tree git reads at the project root, as
 * `git rev-parse --show-toplevel` prints it, or null with a problem
 * noted. It is the checkout {@link readTracked}'s `git status` read,
 * which is the main checkout when the project root is one even though
 * the command ran in a linked worktree beside it.
 */
export function readCheckout(sources: NextSources, note: Note): string | null {
  const result = sources.git(['rev-parse', '--show-toplevel']);
  const checkout = result.ok
    ? result.stdout.trim()
    : '';
  if (checkout !== '') return checkout;

  const why = result.ok
    ? 'git printed no top level'
    : gitSaid(result);
  note(`the checkout the working tree was read in could not be named: ${why}`);
  return null;
}

/** Every branch ref this clone and the remote hold, each half that failed noted. */
export function readRefs(sources: NextSources, remote: string, note: Note): readonly string[] {
  const scan = scanClaimBranches(sources.git, remote);
  scan.problems.forEach((problem) => note(problem));
  return scan.refs;
}

/** Every plan under the plans directory, or none with a problem noted. */
export function readPlans(sources: NextSources, note: Note): readonly PlanListing[] {
  try {
    const listing = listPlans(sources.plans);
    return listing.plans;
  } catch (error) {
    note(`the plans under ${sources.plans.label}/ could not be read: ${messageOf(error)}`);
    return [];
  }
}

/**
 * The open pull request of `branch` with the readings the rows split on,
 * or null when the branch has none. A provider that could not be asked
 * throws; see the module note.
 */
export async function readOpenPull(sources: NextSources, branch: string, note: Note): Promise<OpenPull | null> {
  if (branch === '') return null;

  const summary = await sources.pulls.findOpen(branch);
  if (summary === null) return null;

  const detail = await sources.pulls.get(summary.number);
  if (detail === null) {
    note(`the provider answered no pull request #${summary.number}, having just named it as the open one on \`${branch}\``);
  }
  const checks = await sources.pulls.checks(summary.number);
  return { summary, mergeable: detail?.mergeable ?? 'unknown', verdict: checks.verdict };
}

/** The plan `branch` is named after, or null when the branch names none. */
export function readBranchPlan(branch: string, plans: readonly PlanListing[]): PlanListing | null {
  if (!branch.startsWith(BRANCH_PREFIX)) return null;

  const stub = branch.slice(BRANCH_PREFIX.length);
  return plans.find((plan) => plan.stub === stub) ?? null;
}

/** True when a session record names the plan `stub`, whichever state the record reads. */
export function hasRun(records: readonly SessionRecord[], stub: string): boolean {
  const file = planFileName(stub, false);
  return records.some((record) => record.planStub === stub
    || record.plan === file
    || record.plan.endsWith(`/${file}`));
}

/** True when `refs` holds `feat/<stub>`, here or on the remote. */
export function hasBranch(refs: readonly string[], stub: string): boolean {
  const branch = `${BRANCH_PREFIX}${stub}`;
  return refs.some((ref) => ref === branch || ref.endsWith(`/${branch}`));
}

/**
 * The tips of `feat/<stub>` this clone holds, its own branch and its
 * remote-tracking one, as full refs that resolve here; or null with a
 * problem noted when git could not say. A ref git answers nothing for
 * is absent, the way `src/claims/git.ts` reads one.
 */
export function readBranchTips(sources: NextSources, remote: string, stub: string, note: Note): readonly string[] | null {
  const branch = `${BRANCH_PREFIX}${stub}`;
  const tips: string[] = [];
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/${remote}/${branch}`]) {
    const resolved = sources.git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    const said = gitSaid(resolved);
    if (resolved.ok && resolved.stdout.trim() !== '') {
      tips.push(ref);
    } else if (said !== '') {
      note(`\`${ref}\` could not be read, so its plan reads as started: ${said}`);
      return null;
    }
  }
  return tips;
}

/**
 * The messages of the commits `ref` holds past its fork from the base,
 * as `git log -z --format=%B <base>..<ref>` writes them, or null with a
 * problem noted when git could not read them.
 */
export function readBranchMessages(sources: NextSources, ref: string, note: Note): readonly string[] | null {
  const result = sources.git(['log', '-z', '--format=%B', `${sources.base}..${ref}`]);
  if (!result.ok) {
    note(`the commits of \`${ref}\` past \`${sources.base}\` could not be read, so its plan reads as started: ${gitSaid(result)}`);
    return null;
  }

  return result.stdout
    .split('\0')
    .map((message) => message.trim())
    .filter((message) => message !== '');
}

/**
 * True when `messages` are claim commits and nothing else: at least one,
 * and each a well-formed ownership record (`src/claims/record.ts`), its
 * subject `claim(rafa-<n>): <action>` and its trailers both read. A
 * branch with no commit past its fork reads false, as every branch did
 * before `plan create` claimed one.
 */
export function claimsOnly(messages: readonly string[]): boolean {
  return messages.length > 0
    && messages.every((message) => parseClaimMessage(message).kind === 'ownership');
}

/**
 * True when the plan `stub` has a branch, here or on the remote, that
 * may hold work: any commit past its fork from the base that is no
 * claim commit. A branch `plan create` claimed and nobody has run on
 * holds claim commits alone, and reads false. Whatever cannot be read
 * reads true, as a branch always did: a tip that does not resolve, a
 * log git refused, and a branch the remote holds that this clone has
 * no tip of, that last one with a problem noted too.
 */
export function hasStartedBranch(sources: NextSources, remote: string, refs: readonly string[], stub: string, note: Note): boolean {
  if (!hasBranch(refs, stub)) return false;

  const tips = readBranchTips(sources, remote, stub, note);
  if (tips === null) return true;
  if (tips.length === 0) {
    note(`\`${BRANCH_PREFIX}${stub}\` is on ${remote} but not fetched here, so its commits were not read and its plan reads as started`);
    return true;
  }

  return tips.some((ref) => {
    const messages = readBranchMessages(sources, ref, note);
    return messages === null || !claimsOnly(messages);
  });
}

/** The readings of one answer, each made at most once and only when a row asks. */
export function openWorld(sources: NextSources): NextWorld {
  let problems: readonly string[] = [];
  const note: Note = (problem) => {
    problems = [...problems, problem];
  };

  const remote = sources.remote ?? REMOTE;
  const runs = once(() => sources.runs());
  const branch = once(() => readBranch(sources, note));
  const plans = once(() => readPlans(sources, note));
  const refs = once(() => readRefs(sources, remote, note));
  const roadmap = once(async (): Promise<NextRoadmapReading> => {
    const reading = await sources.board.next();
    reading.problems.forEach((problem) => note(problem));
    return reading;
  });

  return {
    sources,
    remote,
    branch,
    liveRun: once(() => runs().find((record) => isLive(record)) ?? null),
    standing: once(() => readStanding(sources, remote, note)),
    tracked: once(() => readTracked(sources, note)),
    checkout: once(() => readCheckout(sources, note)),
    branchPlan: once(() => readBranchPlan(branch(), plans())),
    unstartedPlan: once(() => plans()
      .find((plan) => !hasRun(runs(), plan.stub) && !hasStartedBranch(sources, remote, refs(), plan.stub, note)) ?? null),
    openPull: once(() => readOpenPull(sources, branch(), note)),
    roadmap,
    picked: once(async (): Promise<PickedLine | null> => {
      if (branch() !== sources.base) return null;

      const { line } = await roadmap();
      if (line === null) return null;

      return {
        line,
        ready: await sources.board.isReady(line.issue),
        blocked: await sources.board.blocking(line.issue),
      };
    }),
    problems: () => problems,
  };
}

/** True when the branch at the project root is the base. */
export function onBase(world: NextWorld): boolean {
  return world.branch() === world.sources.base;
}

/** The branch as a sentence names it, or `this checkout` when there was none to read. */
export function branchLabel(world: NextWorld): string {
  const branch = world.branch();
  return branch === ''
    ? 'this checkout'
    : `\`${branch}\``;
}
