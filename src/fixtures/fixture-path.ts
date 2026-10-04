/**
 * Which repository paths hold fixtures: files a test reads as data, and
 * which may quote text as it stood when the fixture was made.
 *
 * A fixture that quotes history names the folders and files the project
 * had then, so a sweep that holds the tree off an old name skips fixtures
 * by this one rule instead of listing each fixture file it meets. The
 * rule is a path rule only: what the file says plays no part.
 *
 * Two places hold fixtures:
 *
 *   - any folder named `testdata`, at any depth (`src/triage/testdata/`,
 *     `packages/rafa-hub/src/testdata/`), and every file below it;
 *   - `src/tests/fixtures/`, and every file below it.
 *
 * Paths are read the way `git ls-files` prints them: relative to the
 * repository root, with `/` between segments.
 */

/** The folder name that marks a fixture folder at any depth. */
const TESTDATA_SEGMENT = 'testdata';

/** The one fixture folder that is not named {@link TESTDATA_SEGMENT}. */
const TESTS_FIXTURES_PREFIX = 'src/tests/fixtures/';

/**
 * Whether a repository-relative path names a file under a fixture folder.
 *
 * A path is a fixture path when one of its folder segments is exactly
 * `testdata` (a segment such as `testdata-old` or `my-testdata` is not),
 * or when it starts with `src/tests/fixtures/`. The last segment is the
 * file itself, so a file named `testdata` is not a fixture path by its
 * own name.
 *
 * @param path - a path relative to the repository root, `/`-separated
 * @returns `true` when the path sits under a fixture folder
 */
export function isFixturePath(path: string): boolean {
  if (path.startsWith(TESTS_FIXTURES_PREFIX)) return true;
  const folders = path.split('/').slice(0, -1);
  return folders.includes(TESTDATA_SEGMENT);
}
