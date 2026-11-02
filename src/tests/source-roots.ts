/**
 * The folders that hold the code shipped in the CLI, for the content
 * sweeps that read it.
 *
 * The six feature moves of the monorepo migration took most of the
 * code out of the root's `src/` and into `packages/<name>/src/`, so a
 * sweep that walks `src/` alone stays green over what it no longer
 * reads. Each such sweep walks {@link SOURCE_ROOTS} instead and keeps no
 * glob or root constant of its own, so a root added here reaches every
 * sweep at once.
 *
 * The list holds the root's `src/`, core's `packages/rafa/src/` and the
 * six feature roots. Four workspace members stay out, each named with
 * its reason in {@link MEMBERS_LEFT_OUT}: the hub server is a bin of its
 * own and never in the CLI, the service sync strategy is loaded by the
 * hub's users and not shipped in the CLI, and the two config packages
 * hold no `src/`. The unit tests in `./source-roots.test.ts` sort every
 * `packages/<name>/` directory into one of the two, so a package added
 * later fails there until it is listed or left out with a reason.
 *
 * Every path is repo-relative, with no trailing slash: a sweep joins it
 * under the repository root to walk it, and reports a hit by its
 * repo-relative path, never relative to the root that holds it.
 */

/** The eight repo-relative roots of the code shipped in the CLI. */
export const SOURCE_ROOTS: readonly string[] = Object.freeze([
  'src',
  'packages/rafa/src',
  'packages/rafa-board/src',
  'packages/rafa-run/src',
  'packages/rafa-pr/src',
  'packages/rafa-release/src',
  'packages/rafa-inventory/src',
  'packages/rafa-effort/src',
]);

/** The four workspace members kept out of {@link SOURCE_ROOTS}, by repo-relative directory, with why. */
export const MEMBERS_LEFT_OUT: Readonly<Record<string, string>> = Object.freeze({
  'packages/rafa-hub': 'the hub server, a bin of its own, never in the CLI',
  'packages/rafa-sync-service': 'the service sync strategy, loaded by the hub\'s users, not shipped in the CLI',
  'packages/eslint-config': 'a config package, which holds no src/',
  'packages/typescript-config': 'a config package, which holds no src/',
});
