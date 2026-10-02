/**
 * Where the effort store lives, spelled once for both backends, and the
 * guard that keeps a test away from every store but its own.
 *
 * ## The directory
 *
 * {@link effortStoreDir} answers the directory the SQLite file and the
 * NDJSON files sit in. It is `<root>/.rafa/effort/` (`EFFORT_STORE_DIR`
 * in `effort/store.ts`) unless `RAFA_EFFORT_DIR` names another. Both
 * backends resolve their files under it, so the variable moves the
 * SQLite and the NDJSON files together, and a store cannot end up half
 * in one directory and half in another.
 *
 * `RAFA_EFFORT_DIR` is an environment variable and not a config key, so
 * that it moves the store of one command line and never the loop's: a
 * config key would move the loop's own store too. It is how a task runs
 * branch code over a copy of real data (`rafa effort copy`), and two
 * spellings of it are refused, each naming the value it found:
 *
 *   - A relative path. It would resolve against whatever directory the
 *     command ran in, so one command line could name two stores.
 *   - A path that resolves to the project's own store, read through the
 *     real path when both exist, so a symlink or a `..` spelling is
 *     caught as well. A development build migrates a store under the
 *     variable, so without this refusal the variable would be a bypass
 *     of the one rule it exists to serve: branch code never migrates
 *     the live store.
 *
 * An empty value counts as unset, since `RAFA_EFFORT_DIR= <command>` is
 * how a shell clears a variable for one command line.
 *
 * ## The test guard
 *
 * {@link guardTestProcess} runs before any store file or directory is
 * made, at every open of either backend and at `fix-schema`'s. In a test
 * process, one whose entry file (`Bun.main`) ends in `.test.ts` or whose
 * environment sets `RAFA_TEST=1`, an open of a path outside the
 * temporary directory throws, naming the path and the directory. So a
 * green suite proves no test opened a live store. `runRafa`
 * (`src/tests/cli-capture.ts`) sets `RAFA_TEST=1` on the child it
 * spawns, whose entry is `src/rafa.ts`, and passes it the suite's
 * `TMPDIR`, so the child judges paths by the temporary directory the
 * suite built its scratch project under.
 *
 * "The temporary directory" is `tmpdir()`, read at each open. A path is
 * under it as spelled, or when its real path is under the directory's
 * real path; a path not made yet takes the real path of its nearest
 * existing ancestor. Both spellings are accepted because they can
 * differ, as on macOS, where the default directory sits under the `/var`
 * symlink, so a fixture built with `realpathSync(mkdtempSync(...))` is
 * spelled from `/private/var` and a store path may be spelled from
 * either.
 */
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { EFFORT_STORE_DIR } from '../store.js';

/** The variable that moves the store of one command line. */
export const EFFORT_DIR_VARIABLE = 'RAFA_EFFORT_DIR';

/** The variable that marks a process as a test's, whatever its entry. */
export const TEST_PROCESS_VARIABLE = 'RAFA_TEST';

/** The suffix of a test file's name, which `Bun.main` ends in under `bun test`. */
const TEST_ENTRY_SUFFIX = '.test.ts';

/** An environment, as `process.env` holds one. */
export type StoreEnvironment = Readonly<Record<string, string | undefined>>;

/** What the test guard reads about the process it runs in. */
export interface TestProbe {
  /** The entry file, `Bun.main` by default. */
  readonly main: string;
  /** The environment, `process.env` by default. */
  readonly env: StoreEnvironment;
  /** The temporary directory, `tmpdir()` by default. */
  readonly tempDir: string;
}

/** A path's real path when it exists, and its resolved spelling otherwise. */
function canonical(path: string): string {
  const resolved = resolve(path);
  return existsSync(resolved)
    ? realpathSync(resolved)
    : resolved;
}

/**
 * A path's real path, whether or not it exists yet: the real path of its
 * nearest existing ancestor, with the rest of its resolved spelling
 * appended.
 */
function realPathOf(path: string): string {
  const resolved = resolve(path);
  if (existsSync(resolved)) return realpathSync(resolved);

  const parent = dirname(resolved);
  return parent === resolved
    ? resolved
    : join(realPathOf(parent), basename(resolved));
}

/** True when `path` is `dir` or lies under it, compared as spelled. */
function isWithin(path: string, dir: string): boolean {
  const between = relative(resolve(dir), resolve(path));
  const climbsOut = between === '..' || between.startsWith(`..${sep}`);
  return !climbsOut && !isAbsolute(between);
}

/**
 * The directory `RAFA_EFFORT_DIR` names, or null when it is unset or
 * empty. Throws when it is relative, or names the store under
 * `repoRoot`; see the module note.
 */
export function readEffortDirOverride(repoRoot: string, env: StoreEnvironment = process.env): string | null {
  const value = env[EFFORT_DIR_VARIABLE];
  if (value === undefined || value === '') return null;

  if (!isAbsolute(value)) {
    throw new Error(
      `effort store: ${EFFORT_DIR_VARIABLE} is not an absolute path (${value}); run this command again`
        + ` with ${EFFORT_DIR_VARIABLE} set to the absolute path 'rafa effort copy' printed.`,
    );
  }
  if (canonical(value) === canonical(join(repoRoot, EFFORT_STORE_DIR))) {
    throw new Error(
      `effort store: ${EFFORT_DIR_VARIABLE} names this project's own store (${value}); it points a command`
        + ' at a copy only. Copy the store with \'rafa effort copy\' and run this command with'
        + ` ${EFFORT_DIR_VARIABLE}=<the copy>.`,
    );
  }
  return value;
}

/**
 * The directory both backends keep the store under `repoRoot` in:
 * `RAFA_EFFORT_DIR` when it is set, and `<root>/.rafa/effort` otherwise.
 * Throws as {@link readEffortDirOverride} does.
 */
export function effortStoreDir(repoRoot: string, env: StoreEnvironment = process.env): string {
  return readEffortDirOverride(repoRoot, env) ?? join(repoRoot, EFFORT_STORE_DIR);
}

/**
 * True for a test process: an entry file ending in `.test.ts`, or
 * `RAFA_TEST` set to exactly `1`.
 */
export function isTestProcess(main: string = Bun.main, env: StoreEnvironment = process.env): boolean {
  return main.endsWith(TEST_ENTRY_SUFFIX) || env[TEST_PROCESS_VARIABLE] === '1';
}

/**
 * True when `path` is the temporary directory `tempDir` or lies under
 * it, as spelled or with both resolved to their real paths; a `path`
 * not made yet resolves through its nearest existing ancestor.
 */
export function isUnderTempDir(path: string, tempDir: string = tmpdir()): boolean {
  return isWithin(path, tempDir) || isWithin(realPathOf(path), realPathOf(tempDir));
}

/** The probe of the process this runs in, read afresh at each call. */
function currentProbe(): TestProbe {
  return { main: Bun.main, env: process.env, tempDir: tmpdir() };
}

/**
 * Throws when a test process opens a store at `path` outside the
 * temporary directory, and does nothing otherwise. Called before any
 * file or directory is made; see the module note.
 */
export function guardTestProcess(path: string, probe: TestProbe = currentProbe()): void {
  if (!isTestProcess(probe.main, probe.env)) return;
  if (isUnderTempDir(path, probe.tempDir)) return;

  throw new Error(
    `effort store: a test opened ${resolve(path)}, outside the temp directory ${probe.tempDir};`
      + ' a test opens stores under tmpdir() only',
  );
}
