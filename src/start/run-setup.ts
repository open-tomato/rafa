/**
 * What a run settles before it reads its plan: the words of its line,
 * and the branch it runs on.
 *
 * {@link readRunArgs} reads the flags `start()` reads itself, once,
 * right after the run's config has loaded (`start/run-config.ts`) and
 * before the `--start-at` deferral: the time to defer to, the plan path
 * as typed, the three CI flags, and whether `--roadmap` was passed. Every
 * one is a pure reading of the words, so reading them together where the
 * first used to be read alone changes nothing a run does. `--inject`,
 * `--skills-resolver`, `--runtime` and `-d|--detached` are read by
 * `start/run-config.ts` and `start/runtime.ts`, and not here.
 *
 * {@link resolveRunBranch} and {@link guardRunBranch} are the branch
 * step: on `main` or `master` the run is offered the plan's own branch
 * (`start/branch.ts`), and whichever branch that answers is the one the
 * guard reads and the session record names. `start()` calls the two in
 * that order, back to back, once the plan file is known to exist.
 *
 * The guard's two warnings go through the active output
 * (`adapters/output/active.ts`), and its refusal is thrown as a
 * `CommandExit` with exit code 1.
 *
 * {@link refuseWorktreeBesideCreateBranch} runs ahead of all of it, on
 * the words alone: `--as-worktree` and `--create-branch` both make the
 * plan's `feat/<stub>`, one in a worktree of its own and the other by
 * switching the main checkout, so a line naming both asks for two
 * contradictory things and is refused before anything is read.
 */
import type { RafaConfig } from '../config-schema.js';
import type { BranchSeams } from './branch.js';

import { activeOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';

import { branchNameFor, REMOTE } from './branch-decision.js';
import { DEFAULT_BRANCH_SEAMS, offerRunBranch } from './branch.js';
import { DEFAULT_CI_ATTEMPTS, DEFAULT_CI_TIMEOUT_MIN } from './pr-lifecycle.js';
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
  /** The branch the run was started on. */
  readonly base: string;
  /** The words of the run's line, which the two branch flags are read from. */
  readonly args: readonly string[];
}

/**
 * The branch the rest of the run reads: the one it was started on, or
 * the plan's own branch once the offer to leave the base has been made
 * and taken.
 *
 * The offer is only made on a branch {@link DEFAULT_BRANCHES} names,
 * which is exactly the set {@link guardRunBranch} refuses. Everywhere
 * else the run is already on a branch of its own and there is nothing to
 * offer, so no git runs and no question is asked — a run on
 * `feat/<stub>` costs this function one array lookup.
 *
 * On the base, `start/branch.ts` has the whole of it: which question is
 * asked, what `--create-branch` stands in for, and which refusal a
 * modified tracked file, a failed fetch or a diverged base throws. Only
 * a `moved` outcome answers a new branch; `stood-aside` and `declined`
 * both answer the base, and the guard then refuses or lets it through
 * exactly as it did before this offer existed.
 *
 * The answer is the branch handed to BOTH {@link guardRunBranch} and
 * `openRunSession`, so a run that moved is guarded on, and records, the
 * branch it is actually on.
 */
export async function resolveRunBranch(
  request: RunBranchRequest,
  seams: BranchSeams = DEFAULT_BRANCH_SEAMS,
): Promise<string> {
  const { args, base } = request;
  if (!DEFAULT_BRANCHES.includes(base)) return base;

  const outcome = await offerRunBranch({
    repoRoot: request.checkout,
    planStub: request.planStub,
    base,
    anyBranch: args.includes(ANY_BRANCH_FLAG),
    createBranch: args.includes(CREATE_BRANCH_FLAG),
  }, seams);

  return outcome.kind === 'moved'
    ? outcome.branch
    : base;
}

/**
 * The middle of the refusal: how to get onto the plan's branch. Named
 * after the plan's stub when there is one, and the `git` line when there
 * is not; see {@link guardRunBranch}.
 */
function branchOffer(planStub: string | null, base: string): readonly string[] {
  if (planStub === null) {
    return [
      `\n   git checkout -b ${branchNameFor(UNNAMED_PLAN)}`,
      `   ${CREATE_BRANCH_FLAG} names the branch after the plan's stub, as`,
      '   `PLAN-<stub>.md` spells it, and this plan file spells none.',
    ];
  }
  return [
    `\n   Pass ${CREATE_BRANCH_FLAG} to create ${branchNameFor(planStub)} from the latest`,
    `   ${REMOTE}/${base} and run there.`,
    '   On a terminal the run asks that as a question instead of refusing.',
  ];
}

/**
 * Refuses to run a plan on the default branch, and warns on a branch
 * that names no plan.
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
 * The refusal is thrown as a `CommandExit` with exit code 1 whose
 * message is the whole refusal, the lines the guard printed before it
 * threw, joined. Both warnings go through the active output.
 */
export function guardRunBranch(
  planStub: string | null,
  branch: string,
  args: readonly string[],
): void {
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
      ...branchOffer(planStub, branch),
      `\n   Pass ${ANY_BRANCH_FLAG} to run here anyway.`,
    ].join('\n'));
  }

  if (planStub !== null && !branch.includes('/')) {
    activeOutput().warn(`\n⚠️  Branch \`${branch}\` carries no \`<type>/\` prefix.`);
    activeOutput().warn('   The run proceeds; the convention is `feat/<plan-stub>`.');
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
  };
}
