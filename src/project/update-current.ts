/**
 * What `rafa update current` changes in a project, read first and
 * applied second (#714). The command (`src/commands/update/current.ts`)
 * prints the reading, asks, and hands it back here to apply.
 *
 * ## The steps, in order
 *
 *   1. **Folders.** The folders of `.rafa/` that `rafa init` writes and
 *      the project lacks ({@link PROJECT_TREE}), written through
 *      `writeProjectScope`, which writes only what is missing.
 *   2. **Board labels.** The board labels the repository does not carry
 *      (`missingBoardLabels`), created through `setUpLabels`, on a `gh`
 *      board alone. A listing that fails skips the step with its reason
 *      and changes nothing else.
 *   3. **Deprecations.** The step a deprecated feature's own migration
 *      will run in (#718). None is registered yet, so it reads empty.
 *   4. **The lock.** `rafa.lock` at the root, written at the installed
 *      version unless it already records it.
 *
 * Each step changes only what is missing, so a rerun at the same version
 * is safe, and it is how a label refused the first time gets made.
 * Effort store migrations are not a step: the store applies them itself
 * whenever a command opens it.
 */
import type { CurrentRange } from './update-range.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { BoardPart } from '../board/setup.js';

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { listBoardLabels, missingBoardLabels, setUpLabels } from '../board/setup.js';
import { messageOf } from '../config-sections.js';

import { writeProjectLock } from './lock.js';
import { PROJECT_TREE, writeProjectScope } from './scaffold.js';
import { SCOPE_DIR } from './scope.js';

/** A deprecation a project is moved off on update (#718). None is registered yet. */
export interface Deprecation {
  /** What is deprecated, in one line. */
  readonly what: string;
}

/** The deprecations `update current` runs; empty until #718 defines them. */
export const DEPRECATIONS: readonly Deprecation[] = Object.freeze([]);

/** The board step as read: the labels to create, or why it does not run. */
export type BoardReading =
  | { readonly kind: 'labels'; readonly missing: readonly string[] }
  | { readonly kind: 'skipped'; readonly reason: string };

/** What the lock step does. */
export type LockChange = 'created' | 'updated' | 'unchanged';

/** Everything `update current` would change, read before anything is written. */
export interface UpdatePlan {
  readonly root: string;
  /** The version the lock records, null when there is no lock. */
  readonly from: string | null;
  /** The installed version the project is brought to. */
  readonly to: string;
  /** The `.rafa/` folders to create, relative to the root. */
  readonly folders: readonly string[];
  readonly board: BoardReading;
  readonly deprecations: readonly Deprecation[];
  readonly lock: LockChange;
}

/** A range that was not refused. */
export type AllowedRange = Exclude<CurrentRange, { readonly kind: 'refused' }>;

/** How the plan reaches the board; null when the project has no `gh` board. */
export interface BoardAccess {
  readonly gh: GhRunner | null;
  /** Why there is no board, when `gh` is null. */
  readonly reason: string;
}

/** The `.rafa/` folders under `root` that are missing, relative to it. */
export function missingFolders(root: string): readonly string[] {
  return PROJECT_TREE
    .map((name) => join(SCOPE_DIR, name))
    .filter((relative) => !existsSync(join(root, relative)));
}

async function readBoard(access: BoardAccess): Promise<BoardReading> {
  if (access.gh === null) return { kind: 'skipped', reason: access.reason };
  try {
    const held = await listBoardLabels(access.gh);
    return { kind: 'labels', missing: missingBoardLabels(held).map((label) => label.name) };
  } catch (error) {
    return { kind: 'skipped', reason: messageOf(error) };
  }
}

function lockChangeOf(range: AllowedRange): LockChange {
  if (range.kind === 'adopt') return 'created';
  return range.kind === 'patch'
    ? 'updated'
    : 'unchanged';
}

/** The version the lock records, as the range read it. */
function fromOf(range: AllowedRange): string | null {
  if (range.kind === 'patch') return range.from;
  if (range.kind === 'same') return range.to;
  return null;
}

/** Reads what `update current` would change under `root`; writes nothing. */
export async function readUpdatePlan(root: string, range: AllowedRange, board: BoardAccess): Promise<UpdatePlan> {
  return {
    root,
    from: fromOf(range),
    to: range.to,
    folders: missingFolders(root),
    board: await readBoard(board),
    deprecations: DEPRECATIONS,
    lock: lockChangeOf(range),
  };
}

/** True when applying `plan` would write anything. */
export function planChanges(plan: UpdatePlan): boolean {
  const labels = plan.board.kind === 'labels'
    ? plan.board.missing.length
    : 0;
  return plan.folders.length > 0 || labels > 0 || plan.deprecations.length > 0 || plan.lock !== 'unchanged';
}

/** What applying a plan did. */
export interface UpdateApplied {
  /** The `.rafa/` paths written. */
  readonly folders: readonly string[];
  /** One part per board label, as `setUpLabels` answers them; empty when the step was skipped. */
  readonly labels: readonly BoardPart[];
  readonly lock: LockChange;
}

/**
 * Applies `plan`: the folders, the labels through `gh`, then the lock.
 * A label `gh` refuses is answered as a refused part, never thrown, and
 * the lock is still written.
 *
 * @throws ScaffoldError when a folder cannot be written; nothing after
 * it is applied then.
 */
export async function applyUpdatePlan(plan: UpdatePlan, gh: GhRunner | null): Promise<UpdateApplied> {
  const folders = plan.folders.length === 0
    ? []
    : writeProjectScope(plan.root)
      .filter((write) => write.change === 'created')
      .map((write) => write.path);
  const labels = gh !== null && plan.board.kind === 'labels' && plan.board.missing.length > 0
    ? await setUpLabels(gh)
    : [];
  if (plan.lock !== 'unchanged') writeProjectLock(plan.root, plan.to);
  return { folders, labels, lock: plan.lock };
}
