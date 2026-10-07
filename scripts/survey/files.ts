/**
 * The survey's shared reader of tracked files, and the coverage line every
 * survey summary opens with.
 *
 * The scope is the code `git ls-files` lists under `src/` and under each
 * `packages/<name>/src/`: files ending `.ts`, `.tsx`, `.mts`, `.js` or
 * `.mjs`. Data files (JSON, text, markdown) are out of scope. A file git
 * does not track is never listed, so a scratch file in the working tree
 * cannot reach a map.
 *
 * Each file in scope is one of three kinds:
 *
 *   - `test`: its name ends `.test.<ext>` (a `.sweep.test.ts` included);
 *   - `test-support`: any other file a test leans on, read by path only.
 *     It lies below a `tests/` or `testdata/` folder, or below a
 *     `fixtures/` folder inside a module (`src/tools/ts-symbols/fixtures/`),
 *     or its stem names a fake (`gh-fake.ts`, `gh-fake-shapes.ts`). The
 *     top-level `src/fixtures/` is not one: it holds the fixture path
 *     rule and the scrubber, which production scripts import;
 *   - `source`: every other file.
 *
 * Paths are read the way `git ls-files` prints them: relative to the
 * repository root, with `/` between segments.
 */

/** The kind a file in scope is counted as. */
export type FileKind = 'source' | 'test' | 'test-support';

/** The files in scope, each list sorted, and all of them together. */
export interface TrackedFiles {
  /** Every file in scope, sorted. */
  readonly all: readonly string[];
  /** Files of kind `source`, sorted. */
  readonly source: readonly string[];
  /** Files of kind `test`, sorted. */
  readonly test: readonly string[];
  /** Files of kind `test-support`, sorted. */
  readonly testSupport: readonly string[];
}

/** The scope the coverage line names, in the words a reader sees. */
export const SCOPE_LABEL = 'src/ and packages/*/src/';

const CODE_EXTENSION = /\.(?:ts|tsx|mts|js|mjs)$/;
const TEST_NAME = /\.test\.(?:ts|tsx|mts|js|mjs)$/;
const FAKE_STEM = /(?:^|[-.])fakes?(?:[-.]|$)/;
const SUPPORT_FOLDERS: ReadonlySet<string> = new Set(['tests', 'testdata']);

/**
 * The path below the scope root a file lies under (`src/` or
 * `packages/<name>/src/`), or `undefined` when it lies under neither.
 *
 * @param path - A repository-relative path.
 * @returns The part of `path` after its scope root.
 */
function pathBelowScopeRoot(path: string): string | undefined {
  if (path.startsWith('src/')) {
    return path.slice('src/'.length);
  }
  const packaged = /^packages\/[^/]+\/src\/(.+)$/.exec(path);
  return packaged?.[1];
}

/**
 * Whether a path is in the survey's scope: a code file under `src/` or a
 * `packages/<name>/src/`.
 *
 * @param path - A repository-relative path.
 * @returns `true` when the survey reads the file.
 */
export function isInScope(path: string): boolean {
  return pathBelowScopeRoot(path) !== undefined && CODE_EXTENSION.test(path);
}

/**
 * The kind a file in scope is counted as, by its path alone.
 *
 * @param path - A repository-relative path in scope.
 * @returns `test`, `test-support` or `source`.
 */
export function classifyFile(path: string): FileKind {
  if (TEST_NAME.test(path)) {
    return 'test';
  }
  const below = pathBelowScopeRoot(path) ?? path;
  const segments = below.split('/');
  const folders = segments.slice(0, -1);
  const isSupportFolder = folders.some(
    (folder, depth) => SUPPORT_FOLDERS.has(folder) || (folder === 'fixtures' && depth > 0),
  );
  const stem = (segments.at(-1) ?? '').replace(CODE_EXTENSION, '');
  return isSupportFolder || FAKE_STEM.test(stem)
    ? 'test-support'
    : 'source';
}

/**
 * Keeps the paths in scope and splits them by kind. Pure: the caller
 * passes the paths, normally the output of `git ls-files`.
 *
 * @param paths - Repository-relative paths, in any order, duplicates allowed.
 * @returns The files in scope, each list sorted and free of duplicates.
 */
export function splitTrackedFiles(paths: readonly string[]): TrackedFiles {
  const all = [...new Set(paths.filter(isInScope))].sort();
  return {
    all,
    source: all.filter((path) => classifyFile(path) === 'source'),
    test: all.filter((path) => classifyFile(path) === 'test'),
    testSupport: all.filter((path) => classifyFile(path) === 'test-support'),
  };
}

/**
 * Lists the files git tracks in a repository and splits those in scope by
 * kind. A file in the working tree that git does not track is left out.
 *
 * @param root - The repository's root folder.
 * @returns The tracked files in scope.
 * @throws When `git ls-files` cannot run or exits non-zero.
 */
export function listTrackedFiles(root: string): TrackedFiles {
  const result = Bun.spawnSync(['git', 'ls-files', '-z', '--', 'src', 'packages'], {
    cwd: root,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (result.exitCode !== 0) {
    const reason = result.stderr.toString().trim();
    throw new Error(`git ls-files failed in ${root} (exit ${result.exitCode}): ${reason}`);
  }
  const paths = result.stdout
    .toString()
    .split('\0')
    .filter((path) => path !== '');
  return splitTrackedFiles(paths);
}

/**
 * The line a survey summary opens with: the files it read against the
 * files tracked for the same scope, and each tracked file it did not read
 * named. Only tracked files count as read, so reading an untracked file
 * cannot hide a dropped one.
 *
 * @param read - The paths the script read, in any order.
 * @param tracked - The tracked files in scope (`TrackedFiles.all`).
 * @returns One line of markdown.
 */
export function coverageLine(read: Iterable<string>, tracked: readonly string[]): string {
  const readSet = new Set(read);
  const trackedSorted = [...new Set(tracked)].sort();
  const unread = trackedSorted.filter((path) => !readSet.has(path));
  const readCount = trackedSorted.length - unread.length;
  const head = `Coverage: ${readCount} of ${trackedSorted.length} tracked files read (${SCOPE_LABEL}).`;
  if (unread.length === 0) {
    return head;
  }
  const named = unread.map((path) => `\`${path}\``).join(', ');
  return `${head} Not read: ${named}.`;
}
