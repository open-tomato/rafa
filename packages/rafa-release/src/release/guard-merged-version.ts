/**
 * The root version a merge leaves, for the release guard's dry fold
 * (`./guard.ts`, "A stamp that merges in moves where the root's fold
 * starts"): git takes a side's change to the version file only when the
 * other side left it as the merge base had it.
 */

/**
 * The root version a merge of the branch leaves when that is not the
 * base's: the branch's, when the branch moved the version file since the
 * merge base and the base did not, so git takes the branch's side.
 * Null otherwise, the base's version standing; a base that moved it too
 * is a conflict the merge cannot hand the branch. See the module note.
 */
export function mergedRootVersion(versions: {
  readonly mergeBase: string | null;
  readonly branch: string | null;
  readonly base: string | null;
}): string | null {
  const { mergeBase, branch, base } = versions;
  return branch !== null && branch !== mergeBase && base === mergeBase
    ? branch
    : null;
}
