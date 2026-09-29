/**
 * The worktree a loop runs in: `feat/<stub>` added as a linked worktree
 * at `loop.worktreeDir/<stub>`, leaving the main checkout's branch and
 * working tree exactly as they were.
 *
 * It is `--create-branch`'s branch (`./branch.ts`) reached without
 * moving the main checkout, and it reuses that offer's decision whole:
 * the branch name, the stub rule and which route the branch's own
 * existence chooses all come from {@link readBranchOffer}, answered as
 * `--create-branch` answers it, so the two flags cannot name or reach a
 * branch differently. What differs is only the steps:
 *
 *  - `create` fetches `origin/<base>` and adds the worktree on a new
 *    branch cut from that fetched ref. The local base is never read or
 *    fast-forwarded, since doing so is a merge IN the main checkout,
 *    which is the one thing this module must not touch. A local base
 *    that is behind or has diverged therefore does not matter here.
 *  - `switch-local` adds the worktree on the existing local branch, and
 *    `switch-remote` on a new local branch tracking `origin/feat/<stub>`.
 *    Neither fetches: a branch that already exists is never fetched over,
 *    the decision module's rule.
 *
 * Nothing here asks a question: the worktree is asked for by a flag, and
 * the flag is the answer. Git runs in the PROJECT ROOT (`./checkout.ts`),
 * the checkout whose `.git` the new worktree is registered with, and the
 * worktree's directory is {@link worktreeDirAt} under that root.
 *
 * ## What git said, as measured
 *
 * Measured on git 2.50.1 (Apple Git-155) under macOS with `LC_ALL=C`
 * set, in a clone of a bare remote (2026-09-29):
 *
 *  - `git worktree add -b feat/x <path> origin/main` wrote `branch
 *    'feat/x' set up to track 'origin/main'.`, and
 *    `git config branch.feat/x.merge` then answered `refs/heads/main`.
 *    With `--no-track` the same command set no upstream (that config
 *    read exited 1), which is what `--create-branch`'s `git switch -c`
 *    from the local base leaves too. So the `create` step passes it: a
 *    plan branch tracking the base would push to the base.
 *  - Adding a worktree on a branch another worktree holds exited 128
 *    with `fatal: 'feat/x' is already used by worktree at '<path>'`,
 *    and the same for a branch the MAIN checkout holds. That wording is
 *    not read. On a failed add the runner reads `git worktree list
 *    --porcelain` instead and names the checkout whose `branch` line is
 *    the plan's, which holds whatever git's message says in another
 *    version; git's own lines are quoted beneath it either way.
 *  - `-b` on a name already taken exited 255 with `fatal: a branch named
 *    'feat/x' already exists`, a path already there exited 128 with
 *    `fatal: '<path>' already exists`, and a fetch of a base the remote
 *    has not got exited 128 with `fatal: couldn't find remote ref <base>`.
 *    Each is refused with git's own lines quoted.
 *  - After every one of those, `git status --short` in the main checkout
 *    printed nothing and its branch was still `main`.
 *
 * ## Refusals
 *
 * Every refusal is a `CommandExit` with exit code 1, the shape
 * `./branch.ts` refuses with, and each ends by saying the main checkout
 * was left alone, which the last reading above is the ground for.
 */
import type { BranchPlan, BranchRoute } from './branch-decision.js';
import type { GitResult, GitRunner, WorktreeEntry } from '../pr/index.js';

import { join } from 'node:path';

import { activeOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { createGitRunner, gitSaid, parseWorktrees } from '../pr/index.js';

import { branchNameFor, localRef, readBranchOffer, REMOTE, remoteTrackingRef } from './branch-decision.js';
import { worktreeDirAt } from './worktree-dir.js';

/** The indent a quoted git line carries, as `./branch.ts` indents its own. */
const INDENT = '   ';

/** The line every refusal here ends with; see the module note. */
const UNTOUCHED = `${INDENT}The main checkout's branch and working tree were not touched.`;

/** What the run asks a worktree for. */
export interface WorktreeRequest {
  /** The main checkout, which git runs in and `worktreeDir` is read from. */
  readonly projectRoot: string;
  /** `loop.worktreeDir` as the config holds it, before it is resolved. */
  readonly worktreeDir: string;
  /** The plan's stub, or null when the plan path gave none. */
  readonly planStub: string | null;
  /** The base the branch is cut from, as `origin/<base>`. */
  readonly base: string;
}

/** How this module reaches git. */
export interface WorktreeSeams {
  /** The git runner for a root. `createGitRunner` when left out. */
  readonly git?: (root: string) => GitRunner;
}

/** The seams the run uses: the system's own. */
export const DEFAULT_WORKTREE_SEAMS: WorktreeSeams = Object.freeze({});

/** One step of adding the worktree, in the order it runs. */
export type WorktreeStepId = 'fetch' | 'add';

/** One step: what it is called, and exactly what it runs. */
export interface WorktreeStep {
  readonly id: WorktreeStepId;
  /** What is reported as the step runs, lower case, no full stop. */
  readonly label: string;
  /** The whole command, `git` included, ready to spawn or to print. */
  readonly argv: readonly string[];
}

/** The worktree the run now has. */
export interface WorktreeOutcome {
  /** The branch the worktree holds, `feat/<stub>`. */
  readonly branch: string;
  /** The worktree's directory, `loop.worktreeDir/<stub>` under the project root. */
  readonly path: string;
  readonly route: BranchRoute;
  /** The steps that ran, in order, all of them having succeeded. */
  readonly steps: readonly WorktreeStep[];
}

/** The directory the worktree for `stub` is added at. */
export function worktreePathFor(projectRoot: string, worktreeDir: string, stub: string): string {
  return join(worktreeDirAt(projectRoot, worktreeDir), stub);
}

/** The `worktree add` step a route runs; see the module note for the flags. */
function addStep(route: BranchRoute, plan: BranchPlan, path: string): WorktreeStep {
  const label = `add the worktree for ${plan.branch} at ${path}`;
  if (route === 'switch-local') {
    return { id: 'add', label, argv: ['git', 'worktree', 'add', path, plan.branch] };
  }
  if (route === 'switch-remote') {
    return {
      id: 'add',
      label,
      argv: ['git', 'worktree', 'add', '--track', '-b', plan.branch, path, `${REMOTE}/${plan.branch}`],
    };
  }
  return {
    id: 'add',
    label,
    argv: ['git', 'worktree', 'add', '--no-track', '-b', plan.branch, path, `${REMOTE}/${plan.base}`],
  };
}

/**
 * The steps a route runs, in order, frozen. Only `create` fetches, and
 * it fetches the base alone; see the module note.
 */
export function worktreeSteps(route: BranchRoute, plan: BranchPlan, path: string): readonly WorktreeStep[] {
  const add = addStep(route, plan, path);
  if (route !== 'create') return Object.freeze([add]);
  return Object.freeze([
    { id: 'fetch', label: `fetch ${REMOTE} ${plan.base}`, argv: ['git', 'fetch', REMOTE, plan.base] },
    add,
  ]);
}

/** What git said, each line indented, and nothing at all when it said nothing. */
function quotedLines(said: string): readonly string[] {
  return said === ''
    ? []
    : said.split('\n').map((line) => `${INDENT}${line}`);
}

/**
 * The checkout holding `branch` in a `git worktree list --porcelain`
 * listing, and whether it is the main checkout (the listing's first
 * entry), or null when no checkout holds it.
 */
export function holderOf(
  listing: readonly WorktreeEntry[],
  branch: string,
): { readonly path: string; readonly main: boolean } | null {
  const index = listing.findIndex((entry) => entry.branch === branch);
  const holder = listing[index];
  if (holder === undefined) return null;
  return Object.freeze({ path: holder.path, main: index === 0 });
}

/** What a refusal calls the checkout holding the branch. */
function holderName(holder: { readonly main: boolean }): string {
  return holder.main
    ? 'the main checkout'
    : 'another worktree';
}

/**
 * The refusal a failed step answers. A failed add names the checkout
 * that holds the branch when the listing shows one, since that is the
 * refusal an operator can act on; every other failure names the step.
 */
export function stepRefusal(
  step: WorktreeStep,
  result: GitResult,
  plan: BranchPlan,
  listing: readonly WorktreeEntry[],
): string {
  const holder = step.id === 'add'
    ? holderOf(listing, plan.branch)
    : null;
  if (holder !== null) {
    return [
      `❌ Refusing to add a worktree for ${plan.branch}: it is checked out in ${holderName(holder)} at ${holder.path}.`,
      ...quotedLines(gitSaid(result)),
      `${INDENT}Switch that checkout off ${plan.branch}, or remove it with git worktree remove, then run again.`,
      UNTOUCHED,
    ].join('\n');
  }
  const fetchNote = step.id === 'fetch'
    ? [`${INDENT}Refusing to cut ${plan.branch} from a stale ${REMOTE}/${plan.base}.`]
    : [];
  return [`❌ Could not ${step.label}.`, ...quotedLines(gitSaid(result)), ...fetchNote, UNTOUCHED].join('\n');
}

/** Whether git can see `ref`; any failure reads as no such branch, as `./branch.ts` reads it. */
function refExists(git: GitRunner, ref: string): boolean {
  return git(['show-ref', '--verify', '--quiet', ref]).ok;
}

/** The worktree listing, or none when git could not list it. */
function readListing(git: GitRunner): readonly WorktreeEntry[] {
  const listed = git(['worktree', 'list', '--porcelain']);
  return listed.ok
    ? parseWorktrees(listed.stdout)
    : [];
}

/** The line the steps open with, naming what is about to happen. */
function openingLine(route: BranchRoute, plan: BranchPlan): string {
  return route === 'create'
    ? `\n🌿 Creating ${plan.branch} from the latest ${REMOTE}/${plan.base} in its own worktree.`
    : `\n🌿 Adding a worktree for the existing ${plan.branch}.`;
}

/**
 * Adds the worktree for the plan's branch: `feat/<stub>` created from
 * the freshly fetched `origin/<base>`, or the existing branch when git
 * already has it, checked out at `loop.worktreeDir/<stub>`. The main
 * checkout's branch and working tree are never touched.
 *
 * Answers the worktree the run now has. A plan with no stub, a failed
 * fetch, and an add git refused — a branch checked out elsewhere, named
 * by that checkout's path, above all — are each a `CommandExit` with
 * exit code 1; see the module note.
 */
export function addRunWorktree(
  request: WorktreeRequest,
  seams: WorktreeSeams = DEFAULT_WORKTREE_SEAMS,
): WorktreeOutcome {
  const git = (seams.git ?? createGitRunner)(request.projectRoot);
  const stub = request.planStub?.trim() ?? '';
  if (stub === '') {
    throw new CommandExit(1, '\n❌ Cannot add a worktree for a plan with no stub: its branch would be feat/ alone.');
  }
  const offer = readBranchOffer({
    planStub: stub,
    base: request.base,
    anyBranch: false,
    createBranch: true,
    canAsk: false,
    localBranch: refExists(git, localRef(branchNameFor(stub))),
    remoteBranch: refExists(git, remoteTrackingRef(branchNameFor(stub))),
  });
  if (offer.kind !== 'take') throw new Error(`the branch decision answered ${offer.kind} under --create-branch`);

  const plan: BranchPlan = { branch: offer.branch, base: request.base };
  const path = worktreePathFor(request.projectRoot, request.worktreeDir, stub);
  const steps = worktreeSteps(offer.route, plan, path);
  activeOutput().info(openingLine(offer.route, plan));
  for (const step of steps) {
    const result = git(step.argv.slice(1));
    if (result.ok) {
      activeOutput().info(`${INDENT}${step.label}: done`);
      continue;
    }
    const listing = step.id === 'add'
      ? readListing(git)
      : [];
    throw new CommandExit(1, `\n${stepRefusal(step, result, plan, listing)}`);
  }
  activeOutput().info(`${INDENT}The run is on ${plan.branch} in ${path}.`);
  return Object.freeze({ branch: plan.branch, path, route: offer.route, steps });
}
