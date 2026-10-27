/**
 * The moves a release commit makes, and the one spelling of its subject.
 *
 * A settle moves the root's version, a workspace package's, or several
 * at once in one commit; each is a {@link ReleaseMove}. The root is
 * `package: null`, never told apart by its manifest's `name`, and a
 * package is named by its manifest's `name`.
 *
 * {@link releaseCommitSubject} is the subject every delivery commits,
 * pushes, titles a pull request with and quotes in its sentences
 * (`./settle.ts`, `./settle-push.ts`, `./settle-pr.ts`,
 * `packages/rafa-release/src/commands/release/settle.ts`), so the spelling lives here once:
 *
 * ```text
 * chore: release 0.46.0                          the root alone
 * chore: release 0.46.0, @scope/plugin@0.2.0     the root and a package
 * chore: release @scope/plugin@0.2.0             a package alone
 * ```
 *
 * {@link moveSpelling} is how one move reads there, which the settle
 * follow-up (`src/pr/settle-waiting.ts`) prints too.
 *
 * The root's move comes first wherever it sits in the list; the packages
 * follow in the order handed, which the caller keeps as workspace order.
 * Pure: imports nothing.
 */

/** One version a release commit moves: the root's or a workspace package's. */
export interface ReleaseMove {
  /** The package's manifest `name`, or null for the root. */
  readonly package: string | null;
  /** The directory from the repository root: `.` for the root, `packages/plugin` for a package. */
  readonly dir: string;
  /** The version before the release. */
  readonly from: string;
  /** The version the release moves to. */
  readonly to: string;
}

/** How one move reads in the subject: the bare version for the root, `<name>@<version>` for a package. */
export function moveSpelling(move: ReleaseMove): string {
  return move.package === null
    ? move.to
    : `${move.package}@${move.to}`;
}

/** The subject of the release commit making `moves`: the root's first, then each package's. */
export function releaseCommitSubject(moves: readonly ReleaseMove[]): string {
  const root = moves.filter((move) => move.package === null);
  const packages = moves.filter((move) => move.package !== null);
  return `chore: release ${[...root, ...packages].map(moveSpelling).join(', ')}`;
}
