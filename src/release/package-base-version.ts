/**
 * A workspace package's version on the base branch, the one a package
 * slot's forecast folds from.
 *
 * The guard and the pull request body's forecast both fold a package
 * slot from the `version` of the member's own manifest at the base
 * commit, read through {@link readWorkspacePackagesAt} and found by
 * {@link packageNamed}; this is that reading, so the two say the same
 * thing about a package the base cannot fold. The root slot is not read
 * here: each caller keeps its own reading of `release.versionFile`.
 *
 * The checks run in this order, and the first that fails answers its
 * problem line, each ending `so no forecast was folded`:
 *
 * - the base's workspace could not be read (the reader's problem is
 *   appended after a colon);
 * - the workspace holds no member of that name;
 * - the member's manifest sets `private: true`;
 * - the member's manifest declares no `version`.
 */
import type { GitRunner } from '@open-tomato/rafa/core/git';

import { packageNamed, readWorkspacePackagesAt } from './workspace-packages.js';

/** The clause every problem line carries. */
const UNFOLDED = 'so no forecast was folded';

/** What {@link packageBaseVersionAt} answers: the version, or the sentence saying why there is none. */
export type PackageBaseVersion =
  | { readonly version: string }
  | { readonly problem: string };

/** The inputs of {@link packageBaseVersionAt}. */
export interface PackageBaseVersionInput {
  /** The runner for the repository holding the base commit. */
  readonly git: GitRunner;
  /** The base branch: `ref` as the problem lines name it, `commit` as git reads it. */
  readonly base: { readonly ref: string; readonly commit: string };
  /** The member's manifest `name`, compared exactly; never the root. */
  readonly package: string;
}

/**
 * The `version` the member named `package` declares in its manifest at
 * `base.commit`, or the problem line saying why it cannot be folded;
 * see the module note for the order of the checks.
 *
 * @param input - The runner, the base and the package name.
 * @returns `{ version }` with the manifest's trimmed version, or
 *   `{ problem }` with one sentence naming `base.ref` and the package.
 */
export function packageBaseVersionAt(input: PackageBaseVersionInput): PackageBaseVersion {
  const { git, base, package: pkg } = input;
  const workspace = readWorkspacePackagesAt(git, base.commit);
  if (!workspace.ok) return { problem: `${base.ref}'s workspace could not be read for ${pkg}, ${UNFOLDED}: ${workspace.problem}` };
  const member = packageNamed(workspace.packages, pkg);
  if (member === null) return { problem: `${base.ref}'s workspace holds no package ${pkg}, ${UNFOLDED}` };
  if (member.isPrivate) return { problem: `${base.ref} declares ${pkg} private in ${member.manifestPath}, ${UNFOLDED}` };
  return member.version === null
    ? { problem: `${base.ref} declares no version for ${pkg} in ${member.manifestPath}, ${UNFOLDED}` }
    : { version: member.version };
}
