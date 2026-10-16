/**
 * Settle's grouping: the fragments waiting on the base split into one
 * batch per unit that releases, the root and each workspace package a
 * fragment names, before any fold runs.
 *
 * ```text
 * groupSettleFragments(fragments, packages, commit)
 *   → { ok: true, root, packages }   one batch per unit, fold order kept
 *   → { ok: false, problems }        one sentence per fragment refused
 * ```
 *
 * A fragment with no `package` line (`package: null`) belongs to the
 * root. One naming a package belongs to the workspace member whose
 * manifest `name` matches it exactly, read at the same commit the
 * fragments were (`readWorkspacePackagesAt`, `./workspace-packages.ts`).
 * Two names are refused, one sentence per fragment, in the order given:
 *
 * ```text
 * .changes/rafa-1200.md names package @scope/x, which the workspace at <short hash> does not hold
 * .changes/rafa-1200.md names package @scope/core, which is private and never publishes
 * ```
 *
 * A refusal refuses the whole batch, as a fragment that does not parse
 * does: the caller answers the sentences through settle's `malformed`
 * outcome, so nothing is folded and nothing is written.
 *
 * Every fragment keeps its place in fold order within its batch. The
 * package batches follow workspace order, the order of `packages`, and
 * hold only the packages some fragment names, so a package with no
 * fragment is never folded. The root's batch is always answered, empty
 * when no fragment names the root. Pure: no git, no disk, and new lists
 * every call.
 */
import type { SettleFragment } from './settle.js';
import type { WorkspacePackage } from './workspace-packages.js';

/** How many digits of the workspace commit a refusal prints, as the settle lines do. */
const SHORT_HASH = 12;

/** One workspace package's batch: the member and the fragments that name it, in fold order. */
export interface SettlePackageGroup {
  /** The workspace member the fragments name. */
  readonly package: WorkspacePackage;
  /** The fragments naming it, in fold order. */
  readonly fragments: readonly SettleFragment[];
}

/** What {@link groupSettleFragments} answers: the batches, or the sentences refusing them. */
export type SettleGrouping =
  | {
    readonly ok: true;
    /** The fragments with no `package`, in fold order; empty when there are none. */
    readonly root: readonly SettleFragment[];
    /** One batch per package some fragment names, in workspace order. */
    readonly packages: readonly SettlePackageGroup[];
  }
  | {
    readonly ok: false;
    /** One sentence per fragment naming a package the workspace lacks or a private one, in the order given. */
    readonly problems: readonly string[];
  };

/**
 * The fragments split into the root's batch and one batch per package
 * they name, or the sentences refusing every fragment that names a
 * package the workspace lacks or a private one.
 *
 * @param fragments - The fragments present at `commit`, in fold order.
 * @param packages - The workspace members at `commit`, in workspace order.
 * @param commit - The hash the workspace was read at; a refusal names
 *   its first 12 digits.
 * @returns The batches, or the problems; see the module note.
 */
export function groupSettleFragments(
  fragments: readonly SettleFragment[],
  packages: readonly WorkspacePackage[],
  commit: string,
): SettleGrouping {
  const problems = fragments
    .map((each) => refusalOf(each, packages, commit))
    .filter((problem): problem is string => problem !== null);
  if (problems.length > 0) return { ok: false, problems };

  const root = fragments.filter((each) => each.fragment.package === null);
  const groups = packages
    .map((member) => ({ package: member, fragments: fragments.filter((each) => each.fragment.package === member.name) }))
    .filter((group) => group.fragments.length > 0);
  return { ok: true, root, packages: groups };
}

/** Why `each` cannot be folded at `commit`, or null when it can. */
function refusalOf(each: SettleFragment, packages: readonly WorkspacePackage[], commit: string): string | null {
  const name = each.fragment.package;
  if (name === null) return null;
  const member = packages.find((candidate) => candidate.name === name);
  if (member === undefined) {
    return `${each.path} names package ${name}, which the workspace at ${commit.slice(0, SHORT_HASH)} does not hold`;
  }
  return member.isPrivate
    ? `${each.path} names package ${name}, which is private and never publishes`
    : null;
}
