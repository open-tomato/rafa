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
 *  - `switch-local` adds the worktree on the existing local branch, whose
 *    upstream is left as it was found.
 *  - `switch-remote` adds it on a new local branch cut from
 *    `origin/feat/<stub>` with `--no-track`, then sets that branch's
 *    upstream to `origin/feat/<stub>` in a `set-upstream` step of its
 *    own (below).
 *
 * Neither of the last two fetches the branch: a branch that already
 * exists is never fetched over, the decision module's rule. Both then
 * catch up (below).
 *
 * ## The upstream step
 *
 * A branch's upstream is written to the one `.git/config` the main
 * checkout and every linked worktree share, and git refuses a second
 * writer at once rather than making it wait. An add that carried the
 * write (`--track`) therefore lost to another run's add started in the
 * same instant, and was left with a local `feat/<stub>` holding no
 * upstream and no worktree (issue #960; measured below). So the add of
 * `switch-remote` writes nothing to that file, and the upstream is the
 * `set-upstream` step after it, run through `setUpstream`
 * (`./worktree-upstream.ts`) in the project root: tried again only while
 * git says the config file is locked, `UPSTREAM_TRIES` times with a
 * pause between two tries. The pause is the `sleep` seam.
 *
 * A step that fails is refused, naming the branch and the upstream line
 * (`upstreamRefusal`), and what becomes of the worktree the add made
 * depends on why:
 *
 *  - the lock still held after the last try: the worktree is removed
 *    with `git worktree remove --force <path>` before the refusal, and
 *    the refusal says so. The local branch is kept, since the line the
 *    refusal names sets its upstream; a run started again then finds it
 *    and takes route `switch-local`. A removal git refused is said in
 *    the refusal too, with git's own lines beneath;
 *  - any other failure: the run ends after that one try with git's text,
 *    nothing is removed, and the refusal says the worktree was left.
 *
 * ## A worktree already there
 *
 * Before any step runs, the runner reads `git worktree list --porcelain`
 * once, so a run started again after one that stopped finds what that
 * one left ({@link readExisting}):
 *
 *  - a worktree at `loop.worktreeDir/<stub>` holding `feat/<stub>` is
 *    reused: one line says so, nothing is added, the outcome's route is
 *    `reuse` with no steps, and it catches up (below);
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
 * ## Catching a claim branch up
 *
 * Every route that takes an existing branch (`switch-local`,
 * `switch-remote` and `reuse`) catches it up before the first task
 * ({@link catchUpExisting}), since a branch `rafa plan create` claimed
 * days earlier was cut from a base that has moved since. It fetches
 * `origin/<base>` — the base, never the branch — reads the branch with
 * `./claim-catch-up.ts`, and answers the reading:
 *
 *  - `catch-up`, every commit past `origin/<base>` a claim: `git merge
 *    --no-edit origin/<base>` in the run's worktree, a merge and never a
 *    rewrite of a pushed branch, and one line naming the commits taken,
 *    their count and the `<merge base>..<base tip>` range;
 *  - `behind`, the branch holding any other commit: never merged, one
 *    warning line saying how far behind it is, and the run goes on;
 *  - `current`, at or ahead of `origin/<base>`: nothing printed;
 *  - `unreadable`: one warning line naming why, and the run goes on.
 *
 * A failed fetch is a warning, and the branch is read against
 * `origin/<base>` as it stood: before the catch-up existed these routes
 * fetched nothing, and a run that could start offline still does. A
 * failed merge is refused: `git merge --abort` runs in the worktree
 * first, its answer unread, so a merge git left half done is not what
 * the next start finds. Measured on git 2.53.0 under Linux with
 * `LC_ALL=C` (2026-10-05): a merge an untracked file in the worktree
 * would overwrite exited 1 with `error: The following untracked working
 * tree files would be overwritten by merge:` and started nothing, and
 * `git merge --abort` with no merge under way exited 128 with `fatal:
 * There is no merge to abort (MERGE_HEAD missing).`, touching nothing.
 * The outcome carries what was read as `catchUp`, on those three routes
 * alone.
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
 * Measured on git 2.53.0 under Linux with `LC_ALL=C` (2026-10-12), in a
 * project on `main` holding `origin/feat/x` and no local `feat/x`, with
 * `.git/config.lock` created by hand and held throughout:
 *
 *  - `git worktree add --track -b feat/x <path> origin/feat/x` exited
 *    255, having written `Preparing worktree (new branch 'feat/x')` and
 *    then `error: could not lock config file .git/config: File exists`.
 *    It left `refs/heads/feat/x` behind with no upstream (`git config
 *    branch.feat/x.merge` exited 1), no entry at `<path>` in the listing
 *    and no directory there. That is issue #960 with the other writer
 *    stood in for by the lock file, and why the add carries no upstream.
 *  - `git worktree add --no-track -b feat/x <path> origin/feat/x` exited
 *    0 under the same held lock, and the config read exited 1 after it:
 *    this add writes nothing to the shared config file, so it does not
 *    meet the lock at all.
 *  - The upstream line then exited 1 with the lock message
 *    `./worktree-upstream.ts` records in its own note.
 *  - `git worktree remove --force <path>` exited 0 under the held lock,
 *    printing nothing. The listing then held the main checkout alone,
 *    `<path>` was gone (its parent directories were left, empty),
 *    `refs/heads/feat/x` was still there, `git status --short` in the
 *    main checkout printed nothing and its branch was still `main`.
 *  - With the lock deleted, the upstream line exited 0 and `git config
 *    branch.feat/x.merge` answered `refs/heads/feat/x`; a second branch
 *    added with `--no-track` and the line, no lock held at any point,
 *    read `origin/feat/y` as its `@{upstream}`.
 *  - `git worktree remove --force` on a path the listing has no worktree
 *    at exited 128 with `fatal: '<path>' is not a working tree`.
 *
 * ## Refusals
 *
 * Every refusal is a `CommandExit` with exit code 1, the shape
 * `./branch.ts` refuses with, and each ends by saying the main checkout
 * was left alone, which the `git status --short` readings above are the
 * ground for.
 */
import type { BranchPlan, BranchRoute } from './branch-decision.js';
import type { ClaimCatchUpReading } from './claim-catch-up.js';
import type { Sleep } from './worktree-upstream.js';
import type { GitResult, GitRunner, WorktreeEntry } from '../pr/index.js';

import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { CommandExit } from '../core/command/index.js';
import { activeOutput } from '../core/output/index.js';
import { createGitRunner, gitSaid, parseWorktrees } from '../pr/index.js';

import { branchNameFor, localRef, readBranchOffer, REMOTE, remoteTrackingRef } from './branch-decision.js';
import { readClaimCatchUp } from './claim-catch-up.js';
import { worktreeDirAt } from './worktree-dir.js';
import { isConfigLockRefusal, setUpstream, upstreamArgv, upstreamRefusal } from './worktree-upstream.js';

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
  /**
   * `naming.branch`, the template the plan's branch is named from
   * (`branchNameFor`); `feat/{stub}` when left out.
   */
  readonly branchTemplate?: string;
}

/** How this module reaches git, and how it waits between two tries of the upstream step. */
export interface WorktreeSeams {
  /** The git runner for a root. `createGitRunner` when left out. */
  readonly git?: (root: string) => GitRunner;
  /**
   * The pause between two tries of the `set-upstream` step, which returns
   * once it is over. `Bun.sleepSync` when left out; a test hands in one
   * that waits for nothing.
   */
  readonly sleep?: Sleep;
}

/** The seams the run uses: the system's own. */
export const DEFAULT_WORKTREE_SEAMS: WorktreeSeams = Object.freeze({});

/** One step of adding the worktree, in the order it runs. */
export type WorktreeStepId = 'fetch' | 'add' | 'set-upstream';

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
  /** The catch-up of a route that takes an existing branch; absent on `create`. See the module note. */
  readonly catchUp?: WorktreeCatchUp;
}

/** What the catch-up of an existing branch fetched and read; see the module note. */
export interface WorktreeCatchUp {
  /** Whether `git fetch origin <base>` succeeded; when it did not, the reading is against `origin/<base>` as it stood. */
  readonly fetched: boolean;
  /** What `./claim-catch-up.ts` read before any merge; a `catch-up` reading is one that was merged. */
  readonly reading: ClaimCatchUpReading;
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
      argv: ['git', 'worktree', 'add', '--no-track', '-b', plan.branch, path, `${REMOTE}/${plan.branch}`],
    };
  }
  return {
    id: 'add',
    label,
    argv: ['git', 'worktree', 'add', '--no-track', '-b', plan.branch, path, `${REMOTE}/${plan.base}`],
  };
}

/**
 * The step that sets the upstream of the branch `switch-remote` added,
 * its argv the upstream line of `./worktree-upstream.ts`. The runner
 * gives this step to `setUpstream` rather than spawning the argv once.
 */
function upstreamStep(plan: BranchPlan): WorktreeStep {
  return {
    id: 'set-upstream',
    label: `set the upstream of ${plan.branch} to ${REMOTE}/${plan.branch}`,
    argv: upstreamArgv(plan.branch),
  };
}

/**
 * The steps a route runs, in order, frozen. Only `create` fetches, and
 * it fetches the base alone; only `switch-remote` sets an upstream, in a
 * step after its add. See the module note.
 */
export function worktreeSteps(route: BranchRoute, plan: BranchPlan, path: string): readonly WorktreeStep[] {
  const add = addStep(route, plan, path);
  if (route === 'switch-local') return Object.freeze([add]);
  if (route === 'switch-remote') return Object.freeze([add, upstreamStep(plan)]);
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

/**
 * The lines saying what became of the worktree the add made once the
 * upstream step failed: `removal` is what `git worktree remove --force`
 * answered, or null when it was never run.
 */
function addedWorktreeLines(plan: BranchPlan, path: string, removal: GitResult | null): readonly string[] {
  if (removal === null) return [`${INDENT}The worktree added at ${path} was left in place, holding ${plan.branch}.`];
  if (removal.ok) {
    return [`${INDENT}The worktree added at ${path} was removed and ${plan.branch} was kept: run again once its upstream is set.`];
  }
  return [
    `${INDENT}The worktree added at ${path} could not be removed and still holds ${plan.branch}:`,
    ...quotedLines(gitSaid(removal)),
  ];
}

/**
 * Ends the run on a failed `set-upstream` step whose last try answered
 * `result`. A step that gave up on a lock still held has the worktree
 * the add made removed first, through `git` (the project root); any
 * other failure removes nothing. The refusal names the branch and the
 * upstream line either way; see the module note.
 */
function refuseUpstream(git: GitRunner, plan: BranchPlan, path: string, result: GitResult): never {
  const removal = isConfigLockRefusal(result)
    ? git(['worktree', 'remove', '--force', path])
    : null;
  throw new CommandExit(1, `\n${[
    upstreamRefusal(plan.branch, result),
    ...addedWorktreeLines(plan, path, removal),
    UNTOUCHED,
  ].join('\n')}`);
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

/** How many characters of a commit the catch-up line names, as this repository's own notes do. */
const SHORT_SHA = 12;

/** `count` commits, worded for a line. */
function commitCount(count: number): string {
  return count === 1
    ? '1 commit'
    : `${count} commits`;
}

/** The one line a merged catch-up prints: the commits taken, counted, and their range. */
export function caughtUpLine(reading: Extract<ClaimCatchUpReading, { kind: 'catch-up' }>): string {
  const range = `${reading.mergeBase.slice(0, SHORT_SHA)}..${reading.baseTip.slice(0, SHORT_SHA)}`;
  return `${INDENT}Merged ${commitCount(reading.behind)} of ${REMOTE}/${reading.base} (${range}) `
    + `into ${reading.branch}, which held only claim commits.`;
}

/** The one line a branch with work on it prints when it is behind: never merged. */
export function behindLine(reading: Extract<ClaimCatchUpReading, { kind: 'behind' }>): string {
  const work = reading.workCommits === 1
    ? 'is not a claim'
    : 'are not claims';
  return `${INDENT}⚠️  ${reading.branch} is ${commitCount(reading.behind)} behind ${REMOTE}/${reading.base} `
    + `and was not merged: ${reading.workCommits} of its ${commitCount(reading.ahead)} past it ${work}.`;
}

/** The refusal a failed catch-up merge answers, after `git merge --abort` ran. */
export function mergeRefusal(
  reading: Extract<ClaimCatchUpReading, { kind: 'catch-up' }>,
  path: string,
  result: GitResult,
): string {
  return [
    `❌ Could not merge ${REMOTE}/${reading.base} into ${reading.branch} in ${path}.`,
    ...quotedLines(gitSaid(result)),
    `${INDENT}${reading.branch} holds only claim commits and is ${commitCount(reading.behind)} behind; `
    + 'any merge git started there was aborted.',
    `${INDENT}Clear what git names in that worktree, then run again.`,
    UNTOUCHED,
  ].join('\n');
}

/**
 * Catches the existing `branch` up with `origin/<base>` before the first
 * task: fetches the base, reads the branch through `git` (the project
 * root), merges in `worktreeGit` (the run's worktree at `path`) when it
 * holds only claim commits, and says what it found. See the module note.
 */
export function catchUpExisting(
  git: GitRunner,
  worktreeGit: () => GitRunner,
  plan: BranchPlan,
  path: string,
): WorktreeCatchUp {
  const fetch = git(['fetch', REMOTE, plan.base]);
  if (!fetch.ok) {
    activeOutput().warn([
      `${INDENT}⚠️  Could not fetch ${REMOTE} ${plan.base}; reading ${plan.branch} against ${REMOTE}/${plan.base} as it stands.`,
      ...quotedLines(gitSaid(fetch)),
    ].join('\n'));
  }
  const reading = readClaimCatchUp(git, plan.branch, plan.base);
  const caughtUp = Object.freeze({ fetched: fetch.ok, reading });
  if (reading.kind === 'behind') activeOutput().warn(behindLine(reading));
  if (reading.kind === 'unreadable') {
    activeOutput().warn(`${INDENT}⚠️  Could not read whether ${plan.branch} can catch up: ${reading.reason}. It was left as it stands.`);
  }
  if (reading.kind !== 'catch-up') return caughtUp;

  const inWorktree = worktreeGit();
  const merged = inWorktree(['merge', '--no-edit', `${REMOTE}/${plan.base}`]);
  if (!merged.ok) {
    inWorktree(['merge', '--abort']);
    throw new CommandExit(1, `\n${mergeRefusal(reading, path, merged)}`);
  }
  activeOutput().info(caughtUpLine(reading));
  return caughtUp;
}

/**
 * Adds the worktree for the plan's branch: `feat/<stub>` created from
 * the freshly fetched `origin/<base>`, or the existing branch when git
 * already has it, checked out at `loop.worktreeDir/<stub>`. A worktree
 * an earlier start left there on that branch is reused instead. The main
 * checkout's branch and working tree are never touched. A branch that
 * already existed is caught up before the answer: merged with
 * `origin/<base>` when it holds only claim commits, reported when it is
 * behind with other work on it.
 *
 * Answers the worktree the run now has. A plan with no stub, a worktree
 * already there that cannot be reused, a failed fetch on `create`, an
 * add git refused — a branch checked out elsewhere, named by that
 * checkout's path, above all — an upstream step that failed or gave up
 * on a locked config file, and a catch-up merge git refused are each a
 * `CommandExit` with exit code 1; see the module note.
 */
export function addRunWorktree(
  request: WorktreeRequest,
  seams: WorktreeSeams = DEFAULT_WORKTREE_SEAMS,
): WorktreeOutcome {
  const gitIn = seams.git ?? createGitRunner;
  const sleep = seams.sleep ?? Bun.sleepSync;
  const git = gitIn(request.projectRoot);
  const stub = request.planStub?.trim() ?? '';
  if (stub === '') {
    const bare = branchNameFor('', request.branchTemplate);
    throw new CommandExit(1, `\n❌ Cannot add a worktree for a plan with no stub: its branch would be ${bare} alone.`);
  }
  const branch = branchNameFor(stub, request.branchTemplate);
  const path = worktreePathFor(request.projectRoot, request.worktreeDir, stub);
  const worktreeGit = (): GitRunner => gitIn(path);
  const reused = reuseExisting(git, branch, path);
  if (reused !== null) {
    const catchUp = catchUpExisting(git, worktreeGit, { branch: reused.branch, base: request.base }, path);
    return Object.freeze({ ...reused, catchUp });
  }
  const offer = readBranchOffer({
    planStub: stub,
    base: request.base,
    anyBranch: false,
    createBranch: true,
    canAsk: false,
    branchTemplate: request.branchTemplate,
    localBranch: refExists(git, localRef(branch)),
    remoteBranch: refExists(git, remoteTrackingRef(branch)),
  });
  if (offer.kind !== 'take') throw new Error(`the branch decision answered ${offer.kind} under --create-branch`);

  const plan: BranchPlan = { branch: offer.branch, base: request.base };
  const steps = worktreeSteps(offer.route, plan, path);
  activeOutput().info(openingLine(offer.route, plan));
  for (const step of steps) {
    const result = step.id === 'set-upstream'
      ? setUpstream(git, plan.branch, sleep)
      : git(step.argv.slice(1));
    if (result.ok) {
      activeOutput().info(`${INDENT}${step.label}: done`);
      continue;
    }
    if (step.id === 'set-upstream') refuseUpstream(git, plan, path, result);
    const listing = step.id === 'add'
      ? readListing(git)
      : [];
    throw new CommandExit(1, `\n${stepRefusal(step, result, plan, listing)}`);
  }
  const outcome = { branch: plan.branch, path, route: offer.route, steps };
  if (offer.route === 'create') {
    activeOutput().info(`${INDENT}The run is on ${plan.branch} in ${path}.`);
    return Object.freeze(outcome);
  }
  const catchUp = catchUpExisting(git, worktreeGit, plan, path);
  activeOutput().info(`${INDENT}The run is on ${plan.branch} in ${path}.`);
  return Object.freeze({ ...outcome, catchUp });
}
