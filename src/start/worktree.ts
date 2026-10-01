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
 * ## A worktree already there
 *
 * Before any step runs, the runner reads `git worktree list --porcelain`
 * once, so a run started again after one that stopped finds what that
 * one left ({@link readExisting}):
 *
 *  - a worktree at `loop.worktreeDir/<stub>` holding `feat/<stub>` is
 *    reused as it stands: one line says so, nothing is fetched or added,
 *    and the outcome's route is `reuse` with no steps;
 *  - that path holding another branch, or a detached HEAD, is refused,
 *    naming the path and what it holds;
 *  - `feat/<stub>` held by a checkout at any other path, the main one
 *    included, is refused, naming that path and the one the run wanted.
 *
 * Paths are compared after resolving symlinks on both sides, since git
 * lists them resolved (see below); a path that is gone is compared as
 * written. A listing git could not give reads as no worktree at all, and
 * the add then refuses as it did before this reading existed.
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
 * Measured on git 2.53.0 under Linux (2026-10-01), with the project
 * reached through a symlink: `git worktree list --porcelain` printed
 * every path with the symlink resolved, the main checkout's and each
 * linked worktree's alike, and a detached worktree's block carried a
 * `detached` line and no `branch` line. Adding a worktree again at the
 * path of one that already held `feat/x` exited 128 with `fatal:
 * '<path>' already exists`, which is why the listing is read first.
 *
 * ## Refusals
 *
 * Every refusal is a `CommandExit` with exit code 1, the shape
 * `./branch.ts` refuses with, and each ends by saying the main checkout
 * was left alone, which the last reading above is the ground for.
 */
import type { BranchPlan, BranchRoute } from './branch-decision.js';
import type { GitResult, GitRunner, WorktreeEntry } from '../pr/index.js';

import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

/**
 * How the run came by its worktree: one of the branch decision's routes,
 * or `reuse` for a worktree an earlier start left at the same path on
 * the same branch.
 */
export type WorktreeRoute = BranchRoute | 'reuse';

/** The worktree the run now has. */
export interface WorktreeOutcome {
  /** The branch the worktree holds, `feat/<stub>`. */
  readonly branch: string;
  /** The worktree's directory, `loop.worktreeDir/<stub>` under the project root. */
  readonly path: string;
  readonly route: WorktreeRoute;
  /** The steps that ran, in order, all of them having succeeded; none on `reuse`. */
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
 * The refusal for `branch` checked out in another checkout, `detail`
 * lines beneath the first: git's own when an add failed, the path the
 * run wanted when the listing read before any step found the holder.
 */
function heldRefusal(
  branch: string,
  holder: { readonly path: string; readonly main: boolean },
  detail: readonly string[],
): string {
  return [
    `❌ Refusing to add a worktree for ${branch}: it is checked out in ${holderName(holder)} at ${holder.path}.`,
    ...detail,
    `${INDENT}Switch that checkout off ${branch}, or remove it with git worktree remove, then run again.`,
    UNTOUCHED,
  ].join('\n');
}

/** `path` as git lists it: its symlinks resolved, or resolved as written when it is gone. */
function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** What the listing already holds at the run's path and for its branch; see the module note. */
export type ExistingWorktree =
  | { readonly kind: 'none' }
  | { readonly kind: 'reuse' }
  | {
    readonly kind: 'path-taken';
    /** The branch the worktree at the run's path holds, or null when it is detached. */
    readonly holds: string | null;
  }
  | {
    readonly kind: 'branch-held';
    /** The checkout holding the run's branch, at a path that is not the run's. */
    readonly holder: { readonly path: string; readonly main: boolean };
  };

/**
 * Reads a `git worktree list --porcelain` listing for the run's worktree:
 * the entry at `path` decides first, reused when it holds `branch` and
 * refused when it holds anything else, and only with no entry there is a
 * checkout holding `branch` elsewhere looked for.
 */
export function readExisting(
  listing: readonly WorktreeEntry[],
  branch: string,
  path: string,
): ExistingWorktree {
  const wanted = canonicalPath(path);
  const atPath = listing.find((entry) => canonicalPath(entry.path) === wanted);
  if (atPath !== undefined) {
    return atPath.branch === branch
      ? Object.freeze({ kind: 'reuse' })
      : Object.freeze({ kind: 'path-taken', holds: atPath.branch });
  }
  const holder = holderOf(listing, branch);
  return holder === null
    ? Object.freeze({ kind: 'none' })
    : Object.freeze({ kind: 'branch-held', holder });
}

/**
 * The refusal a worktree already there answers when it cannot be reused,
 * naming both sides: the run's path and the branch it holds, or the
 * run's branch, the path holding it and the path the run wanted.
 */
export function existingRefusal(
  existing: Extract<ExistingWorktree, { kind: 'path-taken' | 'branch-held' }>,
  branch: string,
  path: string,
): string {
  if (existing.kind === 'branch-held') {
    return heldRefusal(branch, existing.holder, [`${INDENT}The run's worktree for it would be at ${path}.`]);
  }
  const holds = existing.holds === null
    ? 'a detached HEAD'
    : existing.holds;
  return [
    `❌ Refusing to reuse the worktree at ${path} for ${branch}: it holds ${holds}.`,
    `${INDENT}Switch that worktree to ${branch}, or remove it with git worktree remove, then run again.`,
    UNTOUCHED,
  ].join('\n');
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
  if (holder !== null) return heldRefusal(plan.branch, holder, quotedLines(gitSaid(result)));
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
 * The worktree an earlier start left at `path` on `branch`, reused with
 * one line saying so; null when the listing holds nothing for the run.
 * A worktree there that cannot be reused is refused; see the module note.
 */
function reuseExisting(git: GitRunner, branch: string, path: string): WorktreeOutcome | null {
  const existing = readExisting(readListing(git), branch, path);
  if (existing.kind === 'none') return null;
  if (existing.kind !== 'reuse') throw new CommandExit(1, `\n${existingRefusal(existing, branch, path)}`);
  activeOutput().info(`\n🌿 Reusing the worktree at ${path}, which already holds ${branch}.`);
  return Object.freeze({ branch, path, route: 'reuse', steps: Object.freeze([]) });
}

/**
 * Adds the worktree for the plan's branch: `feat/<stub>` created from
 * the freshly fetched `origin/<base>`, or the existing branch when git
 * already has it, checked out at `loop.worktreeDir/<stub>`. A worktree
 * an earlier start left there on that branch is reused instead. The main
 * checkout's branch and working tree are never touched.
 *
 * Answers the worktree the run now has. A plan with no stub, a worktree
 * already there that cannot be reused, a failed fetch, and an add git
 * refused — a branch checked out elsewhere, named by that checkout's
 * path, above all — are each a `CommandExit` with exit code 1; see the
 * module note.
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
  const path = worktreePathFor(request.projectRoot, request.worktreeDir, stub);
  const reused = reuseExisting(git, branchNameFor(stub), path);
  if (reused !== null) return reused;
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
