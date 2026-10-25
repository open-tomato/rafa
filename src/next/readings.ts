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
 * that is running in the main checkout is answered out of `.rafa/runs/`
 * alone, with no git, no provider and no board asked at all. The
 * provider is reached from row 5 on, and the board from row 10 on.
 *
 * {@link NextWorld.tracked} and {@link NextWorld.checkout} are the two
 * readings the table does not own: `./preconditions.ts` makes them for
 * the pre-condition that stops the table on a working tree with changes
 * to tracked files, ahead of every row but row 1, and ahead of row 1 too
 * unless {@link NextWorld.liveRunHoldsTree} says a live run works in
 * that tree. The first is one `git status --porcelain` at the project
 * root, and the second, `git rev-parse --show-toplevel` there, names the
 * checkout the changes were read in. Neither asks anything of the
 * network.
 *
 * ## Which live run holds the tree
 *
 * A run's edits land in its checkout, and its record says which that is
 * (`src/loop/sessions.ts`, `src/start/session.ts`): a record with no
 * `worktree` key ran with the project root as its checkout, and one
 * carrying the key names the working tree it ran in, as git spelled its
 * top level. {@link NextWorld.liveRunHoldsTree} reads that over every
 * live record ({@link holdsTree}): true for a record with no `worktree`,
 * with no git asked, since the project root is where the tree is read;
 * and true for a record whose `worktree` is the checkout
 * {@link NextWorld.checkout} names, which is how a project root that
 * sits below its repository's top level reads its own loop. A record
 * naming any other working tree holds a tree nobody read here.
 *
 * So the checkout is named at most once per answer, and from one of two
 * places: by this reading, when live runs all carry a `worktree`, or by
 * the tree line once the tree has shown a change. With no live run and a
 * clean tree it is never asked.
 *
 * The board is asked from the BASE BRANCH alone, because every row that
 * reads it names the base. So `rafa next` on a plan branch spends no
 * `gh issue view`, whatever the roadmap holds.
 *
 * ## The base is fetched before its standing is read
 *
 * {@link NextWorld.standing} runs `git fetch <remote> <base>` and then
 * `git rev-list --left-right --count <base>...<remote>/<base>`, the pair
 * `packages/rafa/src/start/branch-decision.ts` measured and parses. A standing read
 * off an unfetched clone answers "up to date" for a base a colleague
 * pushed to an hour ago, and the row that reads it is the one that
 * exists to stop a plan being cut from that base.
 *
 * ## A plan branch holding claim commits alone is not started
 *
 * `plan create` claims the issue it plans (`src/claims/`): one empty
 * commit, subject `claim(rafa-<n>): claim`, on the base, pushed as the
 * `naming.branch` template with the stub ({@link NextSources.branchTemplate},
 * `feat/rafa-<n>-<slug>` by default). Only that template is read: a
 * branch under another one names no plan here. So a plan nobody has run on has a branch all the same,
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
 *
 * The seven interfaces the board reads with ({@link NextBoard} and its
 * neighbours) live in board's `./relation-readings.ts` since pass 4c,
 * and are re-exported here by type, so no importer of them changes.
 */
import type { NextBoard, NextRoadmapReading } from './relation-readings.js';
import type { PlanListing } from '../plan/list.js';
import type { ChecksVerdict, GitRunner, Mergeability, PullRequests, PullRequestSummary } from '../pr/index.js';
import type { OwnerApproval } from '../pr/owner-approval.js';
import type { SessionRecord } from '@open-tomato/rafa/core/loop';
import type { PlansDir } from '@open-tomato/rafa/core/plan';
import type { BaseStanding } from '@open-tomato/rafa/start/branch-decision';
import type { BlockedLine, RoadmapLine } from '@open-tomato/rafa-board';

import { scanClaimBranches } from '@open-tomato/rafa-board';

import { parseClaimMessage } from '@open-tomato/rafa/claims/record';
import { branchFromTemplate, DEFAULT_BRANCH_TEMPLATE, messageOf } from '@open-tomato/rafa/core/config/sections';
import { parseWorkingTree } from '@open-tomato/rafa/core/git';
import { isLive } from '@open-tomato/rafa/core/loop/readings';
import { planFileName } from '@open-tomato/rafa/core/plan';
import { parseBaseStanding, REMOTE, trackedChanges } from '@open-tomato/rafa/start/branch-decision';

import { listPlans } from '../plan/list.js';
import { gitSaid } from '../pr/index.js';

/** The branch `git rev-parse --abbrev-ref HEAD` answers on a detached HEAD. */
const DETACHED = 'HEAD';

/** Where the path starts in a `git status --porcelain` line; see {@link changedPaths}. */
const PORCELAIN_PATH_AT = 3;

export type {
  DryEpic,
  HopTarget,
  NextBoard,
  NextHopReading,
  NextRoadmapReading,
  TakenBlocker,
  WaitingLine,
} from './relation-readings.js';

/** What the readings are taken over; see the module note. */
export interface NextSources {
  /** The branch plans are cut from and merged into. */
  readonly base: string;
  /** Where this project's plans sit, as `plan.dir` resolved it. */
  readonly plans: PlansDir;
  /** The session records under `.rafa/runs/`, read at most once per answer. */
  readonly runs: () => readonly SessionRecord[];
  /** git at the project root: the git seam of core (`packages/rafa/src/core/git/git.ts`). */
  readonly git: GitRunner;
  /** The pull request provider, resolved at the project root. */
  readonly pulls: PullRequests;
  /** The board. */
  readonly board: NextBoard;
  /** The remote the base is fetched from and the branches are scanned on; `origin` when left out. */
  readonly remote?: string;
  /**
   * The `naming.branch` template a plan branch is named under,
   * `config.namingBranch`; `DEFAULT_BRANCH_TEMPLATE` when left out.
   */
  readonly branchTemplate?: string;
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
  /**
   * True when a live run works in the checkout {@link NextWorld.tracked}
   * is read in, so the changes there are a loop's and not the person's.
   * False with no live run, and when every live run works in a worktree
   * of its own. See the module note.
   */
  readonly liveRunHoldsTree: () => boolean;
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
   * every plan has one. A plan branch holding claim commits alone past
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

/**
 * True when one of the `live` runs works in the checkout the tree is
 * read in: a record with no `worktree`, whose checkout is the project
 * root, or one whose `worktree` is the top level `checkout` names.
 *
 * `checkout` is asked only when every live record carries a `worktree`,
 * so a run in the main checkout, and no live run at all, cost no git.
 * The two paths are compared as written: both are git's own spelling of
 * a top level (`src/start/checkout.ts`, `src/start/worktree.ts`). A
 * checkout that could not be named matches no record.
 */
export function holdsTree(live: readonly SessionRecord[], checkout: () => string | null): boolean {
  return live.some((record) => record.worktree === undefined)
    || live.some((record) => record.worktree === checkout());
}

/**
 * Every branch ref this clone and the remote hold, each half that failed
 * noted. The scan is taken under {@link NextSources.branchTemplate}, so
 * its claim reader fetches that template's claim branches (`work/rafa-*`
 * under `work/{stub}`, `feat/rafa-*` by default). `scanner` stands in for
 * {@link scanClaimBranches} in a test that watches the scan.
 */
export function readRefs(
  sources: NextSources,
  remote: string,
  note: Note,
  scanner: typeof scanClaimBranches = scanClaimBranches,
): readonly string[] {
  const scan = scanner(sources.git, remote, sources.branchTemplate);
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

/**
 * The plan `branch` is named after under the `naming.branch` template,
 * or null when the branch names none: the plan whose stub the template
 * names `branch` with. A branch under another template names none: under
 * `work/{stub}`, `feat/rafa-7-x` is no plan branch.
 */
export function readBranchPlan(
  branch: string,
  plans: readonly PlanListing[],
  template: string = DEFAULT_BRANCH_TEMPLATE,
): PlanListing | null {
  return plans.find((plan) => branchFromTemplate(template, plan.stub) === branch) ?? null;
}

/** True when a session record names the plan `stub`, whichever state the record reads. */
export function hasRun(records: readonly SessionRecord[], stub: string): boolean {
  const file = planFileName(stub, false);
  return records.some((record) => record.planStub === stub
    || record.plan === file
    || record.plan.endsWith(`/${file}`));
}

/**
 * True when `refs` holds the plan branch of `stub`, the `naming.branch`
 * template with the stub (`feat/<stub>` by default), here or on the remote.
 */
export function hasBranch(refs: readonly string[], stub: string, template: string = DEFAULT_BRANCH_TEMPLATE): boolean {
  const branch = branchFromTemplate(template, stub);
  return refs.some((ref) => ref === branch || ref.endsWith(`/${branch}`));
}

/**
 * The tips of the plan branch of `stub` this clone holds, named from
 * {@link NextSources.branchTemplate} (`feat/<stub>` by default): its
 * own branch and its remote-tracking one, as full refs that resolve
 * here; or null with a
 * problem noted when git could not say. A ref git answers nothing for
 * is absent, the way `packages/rafa/src/claims/git.ts` reads one.
 */
export function readBranchTips(sources: NextSources, remote: string, stub: string, note: Note): readonly string[] | null {
  const branch = planBranchOf(sources, stub);
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

/** The plan branch of `stub` under {@link NextSources.branchTemplate}. */
function planBranchOf(sources: NextSources, stub: string): string {
  return branchFromTemplate(sources.branchTemplate ?? DEFAULT_BRANCH_TEMPLATE, stub);
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
 * and each a well-formed ownership record (`packages/rafa/src/claims/record.ts`), its
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
  if (!hasBranch(refs, stub, sources.branchTemplate)) return false;

  const tips = readBranchTips(sources, remote, stub, note);
  if (tips === null) return true;
  if (tips.length === 0) {
    note(`\`${planBranchOf(sources, stub)}\` is on ${remote} but not fetched here, so its commits were not read and its plan reads as started`);
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
  const checkout = once(() => readCheckout(sources, note));

  return {
    sources,
    remote,
    branch,
    liveRun: once(() => runs().find((record) => isLive(record)) ?? null),
    liveRunHoldsTree: once(() => holdsTree(runs().filter((record) => isLive(record)), checkout)),
    standing: once(() => readStanding(sources, remote, note)),
    tracked: once(() => readTracked(sources, note)),
    checkout,
    branchPlan: once(() => readBranchPlan(branch(), plans(), sources.branchTemplate)),
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
