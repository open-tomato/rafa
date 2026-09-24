/**
 * The half of the branch offer that touches a repository: it takes the
 * readings `./branch-decision.ts` decides from off a `GitRunner`, asks
 * the question through a `Prompter`, and runs the fetch, the
 * fast-forward and the checkout the decision names.
 *
 * Nothing here decides anything. Which question is asked, which refusal
 * an answer or a git outcome leads to and which steps a route runs are
 * all `./branch-decision.ts`'s, and every message this module writes or
 * throws came out of it. What is left is the four things that need a
 * repository or a terminal:
 *
 *  - reading whether `feat/<stub>` already exists, locally and on the
 *    remote-tracking side ({@link readBranchOffer}'s two flags);
 *  - asking, and reading the answer;
 *  - reading the working tree;
 *  - spawning each step's argv and handing what git said back to
 *    {@link readStepOutcome}.
 *
 * It is the split `rafa pr merge` already has — `src/pr/merge.ts` beside
 * `src/commands/pr/merge.ts` — and the seams are that command's too: a
 * `git` factory over the project root, an `isTerminal` reading, and an
 * `openPrompter` called ONLY when there is a question to ask. So
 * `--create-branch` under a cron job opens no prompter at all, and a
 * test can hand an opener that throws to prove it.
 *
 * ## The order, and what each part of it costs
 *
 * `--any-branch` and a plan with no stub are answered before git is
 * reached: both stand aside whatever the repository holds, and running
 * two `git show-ref` calls to reach the same answer would be two
 * processes spent on nothing. Everything after them is, in order:
 *
 *  1. `git show-ref --verify --quiet refs/heads/feat/<stub>` and the
 *     same for `refs/remotes/origin/feat/<stub>`. Both are local reads;
 *     the remote is not asked, which is the decision module's rule about
 *     never fetching over a branch that already exists.
 *  2. The question, or `--create-branch` standing in for a yes.
 *  3. `git status --porcelain`, read only on a yes. An operator who
 *     declines is never told about a file they were not going to move.
 *  4. The route's steps, each one's outcome read before the next runs.
 *
 * ## Every refusal leaves the run where it found it
 *
 * The refusals from `./branch-decision.ts` all end `The run is still on
 * <base>.`, and that holds for this runner because the checkout is the
 * LAST step of every route: a failed fetch, a base that could not
 * fast-forward and a base that has diverged all stop before anything is
 * checked out. A fast-forward that ran before a later step failed did
 * move the base forward, which is the base's own business and not the
 * run's branch. Each refusal is thrown as a `CommandExit` with exit code
 * 1, the shape `src/start.ts`'s branch guard already refuses with.
 *
 * ## What `git show-ref` answered
 *
 * Measured on git 2.50.1 (Apple Git-155) under macOS with `LC_ALL=C`
 * set, in a clone of a bare remote (2026-09-20):
 * `git show-ref --verify --quiet <ref>` exited 0 for a ref that exists,
 * local and remote-tracking alike, and exited 1 for one that does not
 * and for a string that is no ref at all, writing nothing to either
 * stream in every case. So the reading here is the exit code alone, and
 * ANY failure reads as "no such branch": a git that could not run at all
 * therefore routes to `create`, where its next call is the fetch, which
 * fails for the same reason and refuses with what git said. The reading
 * that could be wrong is the one that creates nothing until git has
 * spoken again.
 */
import type { BranchOffer, BranchPlan, BranchRoute, BranchStep, StandAsideReason } from './branch-decision.js';
import type { Prompter } from '../cli/prompt/confirm.js';
import type { GitRunner, WorkingTreeStatus } from '../pr/index.js';

import { activeOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { createLinePrompter } from '../cli/prompt/confirm.js';
import { createGitRunner, gitSaid, parseWorkingTree } from '../pr/index.js';

import {
  answeredYes,
  branchNameFor,
  branchSteps,
  localRef,
  readBranchOffer,
  readStepOutcome,
  REMOTE,
  remoteTrackingRef,
  treeRefusal,
} from './branch-decision.js';

/** The indent a quoted git line carries, as `./branch-decision.ts` indents its own. */
const INDENT = '   ';

/** What the run knows about itself when the offer is made. */
export interface BranchRequest {
  /** The project root git is run in. */
  readonly repoRoot: string;
  /** The plan's stub, or null when the plan path gave none. */
  readonly planStub: string | null;
  /** The base branch the run was started on, which the offer would leave. */
  readonly base: string;
  /** True when `--any-branch` was passed, which outranks the whole offer. */
  readonly anyBranch: boolean;
  /** True when `--create-branch` was passed, which answers the question yes. */
  readonly createBranch: boolean;
}

/** How this module reaches git and the terminal; see the module note. */
export interface BranchSeams {
  /** The git runner for a root. `createGitRunner` when left out. */
  readonly git?: (root: string) => GitRunner;
  /** True when a question can be answered. Standard input being a TTY when left out. */
  readonly isTerminal?: () => boolean;
  /** Opens the prompter the question is asked through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
}

/** The seams the run uses: the system's own, every one. */
export const DEFAULT_BRANCH_SEAMS: BranchSeams = Object.freeze({});

/** Where the offer left the run. */
export type BranchOutcome =
  | {
    readonly kind: 'stood-aside';
    /** Why nothing was offered; the branch guard has the last word. */
    readonly why: StandAsideReason;
  }
  | {
    readonly kind: 'declined';
    /** The branch that was offered and not taken. */
    readonly branch: string;
    readonly route: BranchRoute;
  }
  | {
    readonly kind: 'moved';
    /** The branch the run is on now. */
    readonly branch: string;
    readonly route: BranchRoute;
    /** The steps that ran, in order, all of them having succeeded. */
    readonly steps: readonly BranchStep[];
  };

/** Whether git can see `ref`; any failure reads as no such branch, per the module note. */
function refExists(git: GitRunner, ref: string): boolean {
  return git(['show-ref', '--verify', '--quiet', ref]).ok;
}

/** True when standard input is a terminal, which is what can answer a question. */
function terminalReading(seams: BranchSeams): () => boolean {
  return seams.isTerminal ?? ((): boolean => process.stdin.isTTY === true);
}

/**
 * What the decision makes of the run, the two ref readings taken off git
 * only when a branch could be offered at all; see the module note.
 */
function readOffer(request: BranchRequest, git: GitRunner, seams: BranchSeams): BranchOffer {
  const stub = request.planStub?.trim() ?? '';
  const branch = request.anyBranch || stub === ''
    ? null
    : branchNameFor(stub);
  return readBranchOffer({
    planStub: request.planStub,
    base: request.base,
    anyBranch: request.anyBranch,
    createBranch: request.createBranch,
    canAsk: terminalReading(seams)(),
    localBranch: branch !== null && refExists(git, localRef(branch)),
    remoteBranch: branch !== null && refExists(git, remoteTrackingRef(branch)),
  });
}

/** Whether the question was answered yes. The prompter is closed however it ends. */
async function confirmed(question: string, seams: BranchSeams): Promise<boolean> {
  const open = seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr));
  const prompter = open();
  try {
    return answeredYes(await prompter.ask(question));
  } finally {
    prompter.close();
  }
}

/** The working tree, or a refusal naming what git said when it could not be read. */
function readWorkingTree(git: GitRunner, plan: BranchPlan): WorkingTreeStatus {
  const result = git(['status', '--porcelain']);
  if (result.ok) return parseWorkingTree(result.stdout);
  throw new CommandExit(1, [
    `❌ Could not read the working tree before leaving ${plan.base} for ${plan.branch}.`,
    `${INDENT}${gitSaid(result)}`,
    `${INDENT}The run is still on ${plan.base}.`,
  ].join('\n'));
}

/** The line the move opens with, naming what is about to happen. */
function openingLine(route: BranchRoute, plan: BranchPlan): string {
  return route === 'create'
    ? `\n🌿 Creating ${plan.branch} from the latest ${REMOTE}/${plan.base}.`
    : `\n🌿 Switching to the existing ${plan.branch}.`;
}

/**
 * Runs the route, reporting each step through the active output, and
 * throws the decision's refusal at the first step it refuses on. The
 * working tree is read first, since a modified tracked file refuses
 * before anything has run.
 */
function runRoute(route: BranchRoute, plan: BranchPlan, git: GitRunner): BranchOutcome {
  const refused = treeRefusal(readWorkingTree(git, plan), plan);
  if (refused !== null) throw new CommandExit(1, `\n${refused}`);

  const steps = branchSteps(route, plan);
  activeOutput().info(openingLine(route, plan));
  for (const step of steps) {
    const outcome = readStepOutcome(step, git(step.argv.slice(1)), plan);
    if (outcome.kind === 'refuse') throw new CommandExit(1, `\n${outcome.message}`);
    activeOutput().info(`${INDENT}${step.label}: done`);
  }
  activeOutput().info(`${INDENT}The run is on ${plan.branch}.`);
  return Object.freeze({ kind: 'moved', branch: plan.branch, route, steps });
}

/**
 * Offers `feat/<stub>` to a run started on its base, and takes it when
 * the offer is accepted: it asks the question, or takes the branch
 * without asking under `--create-branch`, and runs the steps of the
 * route the branch's own existence chooses.
 *
 * Answers where the run was left. `stood-aside` means nothing was
 * offered and the caller's branch guard has the last word, `declined`
 * that the question was answered with anything but yes, and `moved` that
 * the run is now on `branch` — the only reading whose caller should
 * carry a new branch into the guard and the run session. Every refusal
 * is a `CommandExit` with exit code 1; see the module note.
 */
export async function offerRunBranch(
  request: BranchRequest,
  seams: BranchSeams = DEFAULT_BRANCH_SEAMS,
): Promise<BranchOutcome> {
  const git = (seams.git ?? createGitRunner)(request.repoRoot);
  const offer = readOffer(request, git, seams);
  if (offer.kind === 'stand-aside') return Object.freeze({ kind: 'stood-aside', why: offer.why });

  const plan: BranchPlan = { branch: offer.branch, base: request.base };
  if (offer.kind === 'ask' && !await confirmed(offer.question, seams)) {
    activeOutput().info(`Staying on ${plan.base}.`);
    return Object.freeze({ kind: 'declined', branch: offer.branch, route: offer.route });
  }
  return runRoute(offer.route, plan, git);
}
