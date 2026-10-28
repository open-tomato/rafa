/**
 * What a run settles before it reads its plan: the words of its line,
 * and the branch it runs on.
 *
 * {@link readRunArgs} reads the flags `start()` reads itself, once,
 * right after the run's config has loaded (`start/run-config.ts`) and
 * before the `--start-at` deferral: the time to defer to, the plan path
 * as typed, the three CI flags, and whether `--roadmap` was passed. Every
 * one is a pure reading of the words, so reading them together where the
 * first used to be read alone changes nothing a run does. `--retry` is
 * one it refuses: anything but `--retry=<n>` with n a whole number
 * from 1 to 3 throws exit code 1 before the deferral, so a run queued
 * for 23:00 does not learn of a typo then. The `--continue` flags are
 * the others, read and refused the same way by
 * `start/continue-args.ts`. `--inject`,
 * `--skills-resolver`, `--runtime` and `-d|--detached` are read by
 * `start/run-config.ts` and `start/runtime.ts`, and not here.
 *
 * {@link resolveRunBranch} and {@link guardRunBranch} are the branch
 * step: on `main` or `master`, or with no branch checked out, the run is
 * offered the plan's own branch (`start/branch.ts`), and whichever
 * branch that answers is the one the guard reads and the session record
 * names. Once the plan file is known to exist, `start()` reaches the
 * first through `start/run-checkout.ts`, which makes no offer under
 * `--as-worktree`, and calls the second right after on whichever branch
 * that answered.
 *
 * No branch is treated like the default branch. A run started on a
 * detached HEAD is offered the plan's branch as a run on `main` is, cut from
 * the latest `origin/<base>` of the base its caller read for it, and
 * `--create-branch` answers that yes. Where the offer is not taken the
 * run is still on no branch, which {@link resolveRunBranch} answers as
 * null and the guard refuses, naming `--create-branch` and the branch it
 * would create first and `--as-worktree`, the route that leaves the
 * checkout alone and so never reaches the offer, second. `--any-branch`
 * changes none of it: the flag waives WHICH branch the run is on, not
 * that it is on one. The refusal is thrown before `start()` opens the
 * session record, so a refused run leaves nothing under `.rafa/runs/`.
 *
 * Every branch name the guard writes, in either refusal and in the
 * convention warning, is rendered from `naming.branch`, the template
 * `start()` hands it beside the one it hands the offer, so a project
 * whose template is `work/{stub}` is told `work/<stub>` and never
 * `feat/<stub>`; the template is `feat/{stub}` when left out.
 *
 * The guard's two warnings go through the active output
 * (`core/output/active.ts`), and its refusals are thrown as a
 * `CommandExit` with exit code 1.
 *
 * {@link refuseWorktreeBesideCreateBranch} runs ahead of all of it, on
 * the words alone: `--as-worktree` and `--create-branch` both make the
 * plan's `feat/<stub>`, one in a worktree of its own and the other by
 * switching the main checkout, so a line naming both asks for two
 * contradictory things and is refused before anything is read.
 */
import type { BranchSeams } from './branch.js';
import type { ContinueArgs } from './continue-args.js';
import type { RafaConfig } from '@open-tomato/rafa/core/config';
import type { RunStanding } from '@open-tomato/rafa/start/branch-decision';

import { isLoopRetryCount } from '@open-tomato/rafa/config-schema-loop-retries';
import { CommandExit, DEFAULT_CI_TIMEOUT_MIN } from '@open-tomato/rafa/core/command';
import { activeOutput } from '@open-tomato/rafa/core/output';
import { branchNameFor, detachedHeadRefusal, REMOTE } from '@open-tomato/rafa/start/branch-decision';

import { DEFAULT_BRANCH_SEAMS, offerRunBranch } from './branch.js';
import { readContinueArgs } from './continue-args.js';
import { DEFAULT_CI_ATTEMPTS } from './pr-lifecycle.js';
import { argValue } from './run-config.js';
import { NOTHING_DISPATCHED } from './session.js';

/** Branches a plan run is refused on, and the ones the branch offer is made on. */
const DEFAULT_BRANCHES: readonly string[] = ['main', 'master'];

/** The flag that runs the loop where it stands, offering nothing and checking nothing. */
const ANY_BRANCH_FLAG = '--any-branch';

/** The flag that answers the branch question yes before it is asked. */
const CREATE_BRANCH_FLAG = '--create-branch';

/**
 * The flag that runs the plan in a linked worktree of its own
 * (`start/worktree.ts`), leaving the main checkout where it is.
 */
export const AS_WORKTREE_FLAG = '--as-worktree';

/** The flag `rafa next --roadmap` passes on, stamping the away hop on the session record (`start/session.ts`). */
const ROADMAP_FLAG = '--roadmap';

/** What the refusal calls a plan whose file names no stub. */
const UNNAMED_PLAN = 'this-plan';

/**
 * What the refusal calls the base of a run with no branch checked out:
 * the placeholder the command's help spells it with. The guard is handed
 * the run's branch and not the base read for it.
 */
const UNREAD_BASE = '<base>';

/**
 * Throws `CommandExit` with exit code 1 when the words carry both
 * `--as-worktree` and `--create-branch`, and returns otherwise.
 *
 * Both flags are read as bare words, the way {@link resolveRunBranch}
 * reads `--create-branch`, so the refusal fires on exactly the lines
 * where each flag would act. It names both routes rather than choosing
 * one: which checkout the operator meant to leave on the base is not
 * something the words say.
 */
export function refuseWorktreeBesideCreateBranch(args: readonly string[]): void {
  if (!args.includes(AS_WORKTREE_FLAG) || !args.includes(CREATE_BRANCH_FLAG)) return;
  throw new CommandExit(1, [
    `❌ Refusing ${AS_WORKTREE_FLAG} beside ${CREATE_BRANCH_FLAG}: each makes the plan's branch, one in a worktree`,
    '   of its own and the other by switching the main checkout to it.',
    `   Pass ${AS_WORKTREE_FLAG} alone to run under \`loop.worktreeDir\` and leave the main checkout as it is,`,
    `   or ${CREATE_BRANCH_FLAG} alone to switch the main checkout to the branch and run there.`,
    NOTHING_DISPATCHED,
  ].join('\n'));
}

/** The tracking settings that refuse `--as-worktree`, each with its config key. */
const TRACKING_SETTINGS: readonly (readonly [keyof RafaConfig & `tracking${string}`, string])[] = [
  ['trackingSpecs', 'tracking.specs'],
  ['trackingPlans', 'tracking.plans'],
  ['trackingAll', 'tracking.all'],
];

/**
 * Throws `CommandExit` with exit code 1 when the words carry
 * `--as-worktree` and any of `tracking.specs`, `tracking.plans` or
 * `tracking.all` is on, naming every one that is on, and returns
 * otherwise.
 *
 * Tracked `.rafa/` content would be checked out into the worktree as a
 * second copy beside the main checkout's, which a worktree loop serves
 * its sessions from; the two would drift apart.
 */
export function refuseWorktreeWhileTracking(
  args: readonly string[],
  config: Pick<RafaConfig, 'trackingSpecs' | 'trackingPlans' | 'trackingAll'>,
): void {
  if (!args.includes(AS_WORKTREE_FLAG)) return;
  const on = TRACKING_SETTINGS.filter(([field]) => config[field]).map(([, key]) => `\`${key}\``);
  if (on.length === 0) return;
  const single = on.length === 1;
  const verb = single
    ? 'is'
    : 'are';
  const pronoun = single
    ? 'it'
    : 'them';
  throw new CommandExit(1, [
    `❌ Refusing ${AS_WORKTREE_FLAG} while ${on.join(', ')} ${verb} on: a worktree checks out`,
    '   what git tracks, so it would hold a second copy of the `.rafa/` content the main checkout owns.',
    `   Turn ${pronoun} off in \`.rafa/config.yaml\`, or run without ${AS_WORKTREE_FLAG}.`,
    NOTHING_DISPATCHED,
  ].join('\n'));
}

/** What the run knows about its branch when the offer is made. */
export interface RunBranchRequest {
  /**
   * The run's checkout, which git is run in (`start/checkout.ts`): the
   * project root unless the loop runs in a linked worktree.
   */
  readonly checkout: string;
  /** The plan's stub, or null when the plan path gave none. */
  readonly planStub: string | null;
  /**
   * The branch the run was started on, or under `standing: 'no-branch'`
   * the base its caller read for the run, which `feat/<stub>` is cut
   * from on `origin`.
   */
  readonly base: string;
  /**
   * Where the run was started: on the branch `base` names, or with no
   * branch checked out at all. `on-base` when left out.
   */
  readonly standing?: RunStanding;
  /** The words of the run's line, which the two branch flags are read from. */
  readonly args: readonly string[];
  /**
   * `naming.branch`, the template the plan's branch is named from;
   * `feat/{stub}` when left out.
   */
  readonly branchTemplate?: string;
}

/**
 * The branch the rest of the run reads: the one it was started on, or
 * the plan's own branch once the offer to leave where it stands has been
 * made and taken, or null when it was started on no branch and is still
 * on none.
 *
 * The offer is made on a branch {@link DEFAULT_BRANCHES} names and with
 * no branch checked out (`standing: 'no-branch'`), which is exactly what
 * {@link guardRunBranch} refuses. Everywhere else the run is already on
 * a branch of its own and there is nothing to offer, so no git runs and
 * no question is asked — a run on `feat/<stub>` costs this function one
 * array lookup.
 *
 * Where it is made, `start/branch.ts` has the whole of it: which
 * question is asked, what `--create-branch` stands in for, which steps a
 * yes runs on either standing, and which refusal a modified tracked
 * file, a failed fetch or a diverged base throws. Only a `moved` outcome
 * answers a new branch. `stood-aside` and `declined` both answer where
 * the run was left: the base, which the guard then refuses or lets
 * through under `--any-branch`, or null for no branch, which it refuses
 * under every line. A base that is the word `HEAD` is a name like any
 * other here; a detached HEAD is the standing, read by the caller
 * (`start/run-checkout.ts`), and never that word.
 *
 * The answer is the branch handed to BOTH {@link guardRunBranch} and,
 * past it, `openRunSession`, so a run that moved is guarded on, and
 * records, the branch it is actually on.
 */
export async function resolveRunBranch(
  request: RunBranchRequest,
  seams: BranchSeams = DEFAULT_BRANCH_SEAMS,
): Promise<string | null> {
  const { args, base, standing } = request;
  const noBranch = standing === 'no-branch';
  if (!noBranch && !DEFAULT_BRANCHES.includes(base)) return base;

  const outcome = await offerRunBranch({
    repoRoot: request.checkout,
    planStub: request.planStub,
    base,
    standing,
    anyBranch: args.includes(ANY_BRANCH_FLAG),
    createBranch: args.includes(CREATE_BRANCH_FLAG),
    branchTemplate: request.branchTemplate,
  }, seams);

  if (outcome.kind === 'moved') return outcome.branch;
  return noBranch
    ? null
    : base;
}

/**
 * The middle of the refusal: how to get onto the plan's branch. Named
 * after the plan's stub when there is one, and the `git` line when there
 * is not; see {@link guardRunBranch}. `base` is the branch the plan's
 * own is created from on {@link REMOTE}, or {@link UNREAD_BASE}, and
 * `branchTemplate` is `naming.branch`, which renders the branch named.
 */
function branchOffer(
  planStub: string | null,
  base: string,
  branchTemplate: string | undefined,
): readonly string[] {
  if (planStub === null) {
    return [
      `\n   git checkout -b ${branchNameFor(UNNAMED_PLAN, branchTemplate)}`,
      `   ${CREATE_BRANCH_FLAG} names the branch after the plan's stub, as`,
      '   `PLAN-<stub>.md` spells it, and this plan file spells none.',
    ];
  }
  return [
    `\n   Pass ${CREATE_BRANCH_FLAG} to create ${branchNameFor(planStub, branchTemplate)} from the latest`,
    `   ${REMOTE}/${base} and run there.`,
    '   On a terminal the run asks that as a question instead of refusing.',
  ];
}

/**
 * The refusal of a run with no branch checked out: the offer's own lines
 * first, then `--as-worktree`. A plan whose file names no stub is handed
 * neither flag as a way on, since both build the branch name out of the
 * stub and the worktree route refuses a plan with none
 * (`start/worktree.ts`): it gets the `git` line alone, which cuts a
 * branch where HEAD stands.
 */
function refuseNoBranch(planStub: string | null, branchTemplate: string | undefined): never {
  const worktreeFlag = planStub === null
    ? null
    : AS_WORKTREE_FLAG;
  const offer = branchOffer(planStub, UNREAD_BASE, branchTemplate);
  const refusal = detachedHeadRefusal(offer, worktreeFlag);
  throw new CommandExit(1, `${refusal}\n${NOTHING_DISPATCHED}`);
}

/**
 * Refuses to run a plan on the default branch or on no branch at all,
 * and warns on a branch that names no plan. Past it `branch` is a
 * branch's name, which the signature asserts for its caller.
 *
 * No branch, a detached HEAD read as null, is refused first and on every
 * line, `--any-branch` included: the flag waives which branch the run is
 * on, and a run commits to, pushes and opens its pull request from one.
 * The refusal is {@link refuseNoBranch}'s. It is reached only where the
 * offer of the plan's branch was not taken ({@link resolveRunBranch}).
 *
 * Measured: one run executed on `main`. It produced 21 commits and 74
 * sessions and cost three things — no PR, so the wrap-up's CI stage
 * found nothing to verify and skipped itself; no review; and, before
 * prompts carried a plan stamp, no per-plan attribution, its sessions
 * landing in the `main` group beside every other main-branch session
 * ever recorded.
 *
 * A refusal rather than a warning, because the only signal the mistake
 * produced at the time was silence, and a warning in a loop nobody
 * watches is the same silence one line longer. `--any-branch` is the
 * whole of the escape hatch, so an operator who means it says so once.
 *
 * What the refusal offers depends on whether the plan's file named a
 * stub, because that is what `--create-branch` builds the branch name
 * out of ({@link resolveRunBranch}). With a stub the refusal names the
 * flag and the branch it would create, since passing it is all the
 * operator has to do. With none — a plain `PLAN.md` — the flag would
 * stand aside on the next run too, so the refusal says so and prints the
 * `git` line instead of naming a flag that could not help. A refusal
 * naming a flag that does nothing is the failure this branch exists to
 * avoid.
 *
 * The branch-names-the-plan check is only a WARNING, and deliberately.
 * A branch stub is not a plan stub — measured across eleven
 * plan-driven branches, five named their plan differently
 * (`feat/q17-dynamic-forms` against `q17-dynamic-form-provider-v1`) —
 * so a refusal keyed on it would reject the project's own convention.
 * Attribution no longer depends on it either, the stamp having taken
 * that job over.
 *
 * `branchTemplate` is `naming.branch`, the template the offer named the
 * plan's branch from ({@link RunBranchRequest.branchTemplate}): both
 * refusals name the branch `--create-branch` would make through it, and
 * the convention warning spells the convention through it, with
 * `<plan-stub>` for the stub. `feat/{stub}` when left out.
 *
 * Either refusal is thrown as a `CommandExit` with exit code 1 whose
 * message is the whole refusal, the lines the guard printed before it
 * threw, joined. Both warnings go through the active output.
 */
export function guardRunBranch(
  planStub: string | null,
  branch: string | null,
  args: readonly string[],
  branchTemplate?: string,
): asserts branch is string {
  if (branch === null) refuseNoBranch(planStub, branchTemplate);

  if (args.includes(ANY_BRANCH_FLAG)) {
    activeOutput().warn(`\n⚠️  ${ANY_BRANCH_FLAG}: running on \`${branch}\` without the branch check.`);
    return;
  }

  if (DEFAULT_BRANCHES.includes(branch)) {
    throw new CommandExit(1, [
      `\n❌ Refusing to run a plan on \`${branch}\`.`,
      '   A plan run needs its own branch: that is what gives it a PR to',
      '   review, and what lets the wrap-up\'s CI stage have something to',
      '   wait on. Run on main and both are silently skipped.',
      ...branchOffer(planStub, branch, branchTemplate),
      `\n   Pass ${ANY_BRANCH_FLAG} to run here anyway.`,
    ].join('\n'));
  }

  if (planStub !== null && !branch.includes('/')) {
    activeOutput().warn(`\n⚠️  Branch \`${branch}\` carries no \`<type>/\` prefix.`);
    const convention = branchNameFor('<plan-stub>', branchTemplate);
    activeOutput().warn(`   The run proceeds; the convention is \`${convention}\`.`);
  }
}

/** The flag that finishes the run at the push instead of waiting for CI. */
const NO_CI_WAIT_FLAG = '--no-ci-wait';

/** What `start()` reads off the words of its line itself. */
export interface RunArgs {
  /** The local time of day `--start-at` defers the run to, or undefined. */
  readonly startAt: string | undefined;
  /** The plan file `--plan` names, as typed, or undefined (`start/plan-path.ts`). */
  readonly plan: string | undefined;
  /** False under `--no-ci-wait`: the run ends at the push. */
  readonly ciWait: boolean;
  /** `--ci-timeout`, in minutes, or {@link DEFAULT_CI_TIMEOUT_MIN}. */
  readonly ciTimeoutMin: number;
  /** `--ci-attempts`, or {@link DEFAULT_CI_ATTEMPTS}. */
  readonly ciAttempts: number;
  /** Whether `--roadmap` was passed (`start/session.ts`). */
  readonly roadmap: boolean;
  /**
   * `--retry=<n>`, the retries this run makes after a retry-safe stop
   * (`start/retry-budget.ts`), or undefined when the line names none.
   */
  readonly retry: number | undefined;
  /** What the line asks of `--continue` (`start/continue-args.ts`). */
  readonly continueRun: ContinueArgs;
}

/** The flag naming this run's retries, outranking `loop.retries`. */
const RETRY_FLAG = '--retry';

/** Its negation, refused: off is spelled `loop.retries: false`. */
const NO_RETRY_FLAG = '--no-retry';

/** A count as `--retry` takes one: digits with no leading zero, no sign and no point. */
const RETRY_COUNT = /^[1-9][0-9]*$/;

/** Throws the refusal of a `--retry` word, `reason` saying what is wrong with it. */
function refuseRetry(reason: string): never {
  throw new CommandExit(1, [
    `❌ Refusing ${reason}: ${RETRY_FLAG} takes a whole number from 1 to 3 as ${RETRY_FLAG}=<n>,`,
    '   the retries this run makes after a retry-safe stop. Leave it out to take `loop.retries`,',
    '   and set `loop.retries: false` in .rafa/config.yaml for none.',
    NOTHING_DISPATCHED,
  ].join('\n'));
}

/**
 * `--retry=<n>` off the words before a `--`, the last one when two are
 * typed, or undefined when none is; see the module note for what is
 * refused. `--no-retry` is refused rather than read as none: off is
 * spelled `loop.retries: false`, and a count is never read as off.
 */
function readRetryFlag(args: readonly string[]): number | undefined {
  const end = args.indexOf('--');
  const words = end === -1
    ? args
    : args.slice(0, end);
  if (words.includes(NO_RETRY_FLAG)) refuseRetry(NO_RETRY_FLAG);
  if (words.includes(RETRY_FLAG)) refuseRetry(`a bare ${RETRY_FLAG}`);
  // `argValue` answers the first hit, so the words are read last first.
  const typed = argValue([...words].reverse(), RETRY_FLAG);
  if (typed === undefined) return undefined;
  const count = RETRY_COUNT.test(typed)
    ? Number(typed)
    : Number.NaN;
  if (!isLoopRetryCount(count)) refuseRetry(`${RETRY_FLAG}=${typed}`);
  return count;
}

/**
 * The flags `start()` reads itself, off the words of its line. The two
 * numbers are `Number` of what was typed, unclamped: a word that is no
 * number reads `NaN`, and the wrap-up's CI stage clamps both where it
 * uses them, as it always has.
 */
export function readRunArgs(args: readonly string[]): RunArgs {
  return {
    startAt: argValue(args, '--start-at'),
    plan: argValue(args, '--plan'),
    ciWait: !args.includes(NO_CI_WAIT_FLAG),
    ciTimeoutMin: Number(argValue(args, '--ci-timeout') ?? DEFAULT_CI_TIMEOUT_MIN),
    ciAttempts: Number(argValue(args, '--ci-attempts') ?? DEFAULT_CI_ATTEMPTS),
    roadmap: args.includes(ROADMAP_FLAG),
    retry: readRetryFlag(args),
    continueRun: readContinueArgs(args),
  };
}
