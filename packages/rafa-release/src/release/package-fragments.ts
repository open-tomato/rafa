/**
 * The one answer to whether a fragment may name a package, under
 * `release.packageFragments`: what `rafa release fragment --package` and
 * the release guard `rafa pr merge` runs both ask, so the command and
 * the merge cannot disagree about the same fragment.
 *
 * ```text
 * packageFragmentRefusal(mode, package, where)  → the command's sentence | null  (pure)
 * refusedPackageFragments(mode, fragments)      → one refusal per named file      (pure)
 * ```
 *
 * ## The rule
 *
 * Under `allow`, the default, every fragment is taken, package or none.
 * Under `refuse` a fragment with a `package:` line is refused, and a root
 * fragment, `package: null`, is still taken: the setting says the
 * project releases no package yet, not that it takes no fragments.
 * {@link isPackageFragmentRefused} is that rule and nothing else; both
 * sentences below are built on it.
 *
 * ## The two sentences
 *
 * The command refuses before it writes anything, naming the key, its
 * value and where it is set, then what to do:
 *
 * ```text
 * release.packageFragments is refuse (/repo/rafa.config.ts): this project takes no package fragments; drop --package
 * ```
 *
 * `where` is the caller's, since only it holds the resolved config's
 * sources: this module reads no config and runs no git.
 *
 * The guard reads a tree's fragments (`./fragment-tree.ts`) and is
 * handed one {@link RefusedPackageFragment} per refused file, its
 * sentence naming the file's path under `release.fragments`, the package
 * and the key. A fragment the parser refused is not this reading's to
 * judge, so it is passed over rather than refused twice.
 */
import type { TreeFragment } from './fragment-tree.js';
import type { PackageFragmentMode } from '@open-tomato/rafa/config-schema-release';

/** The key whose value this module reads, as a sentence names it. */
export const PACKAGE_FRAGMENTS_KEY = 'release.packageFragments';

/** The clause both sentences share after the key and its value. */
const TAKES_NONE = 'this project takes no package fragments';

/** One fragment of a tree refused under `refuse`, named by its path. */
export interface RefusedPackageFragment {
  /** The fragment's path from the repository root, e.g. `.changes/rafa-247.md`. */
  readonly path: string;
  /** The package its `package:` line names. */
  readonly package: string;
  /** One sentence naming the path, the package and the key, for a caller to print. */
  readonly sentence: string;
}

/**
 * Whether `mode` refuses a fragment whose `package` value is
 * `packageName`; see the module note.
 *
 * @param mode - The resolved `release.packageFragments`.
 * @param packageName - The fragment's package, null for a root fragment.
 * @returns True only under `refuse` for a fragment that names a package.
 */
export function isPackageFragmentRefused(mode: PackageFragmentMode, packageName: string | null): boolean {
  return mode === 'refuse' && packageName !== null;
}

/**
 * The sentence `rafa release fragment` refuses `--package` with, or
 * null when `mode` takes the fragment.
 *
 * @param mode - The resolved `release.packageFragments`.
 * @param packageName - The `--package` value, null when none was given.
 * @param where - Where the key is set, e.g. the config file's path.
 * @returns `release.packageFragments is refuse (<where>): this project
 *   takes no package fragments; drop --package`, or null.
 */
export function packageFragmentRefusal(
  mode: PackageFragmentMode,
  packageName: string | null,
  where: string,
): string | null {
  if (!isPackageFragmentRefused(mode, packageName)) return null;
  return `${PACKAGE_FRAGMENTS_KEY} is ${mode} (${where}): ${TAKES_NONE}; drop --package`;
}

/**
 * Each of `fragments` that `mode` refuses, in the order given, named by
 * its path; empty under `allow` or when none names a package. A
 * fragment the parser refused is passed over; see the module note.
 *
 * @param mode - The resolved `release.packageFragments`.
 * @param fragments - The fragments a tree holds, as `readFragmentTree` read them.
 * @returns One {@link RefusedPackageFragment} per refused file.
 */
export function refusedPackageFragments(
  mode: PackageFragmentMode,
  fragments: readonly Pick<TreeFragment, 'path' | 'reading'>[],
): readonly RefusedPackageFragment[] {
  return fragments.flatMap(({ path, reading }) => {
    if (!reading.ok) return [];
    const packageName = reading.fragment.package;
    if (packageName === null || !isPackageFragmentRefused(mode, packageName)) return [];
    const sentence = `${path} names package ${packageName}, and ${PACKAGE_FRAGMENTS_KEY} is ${mode}: ${TAKES_NONE}`;
    return [{ path, package: packageName, sentence }];
  });
}
