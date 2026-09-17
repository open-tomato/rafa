/**
 * Black-box acceptance tests for the CLI's release mechanics: `rafa
 * --version` and `rafa self-update`, both spawned as `bun src/rafa.ts
 * <words>` in a scratch repository of their own, proving what the
 * "Release mechanics" stage of
 * `.specs/phase-2-schema-checker-demotion.md` promises a caller who reads
 * only the command line, and who runs no build.
 *
 * ## What is covered
 *
 *   - `--version` typed beside a routing word (`loop`) is the
 *     `unexpected_version` refusal, exit code 1, nothing on stdout.
 *   - `-V` is not the version flag: with no routing word after it the
 *     line reads as the root help, never the version line.
 *   - `--version` alone prints `rafa <version>` with the version of this
 *     checkout's `package.json`, one line, and exits 0.
 *   - A runtime directory `self-update` would install over, a marker
 *     file planted inside it, is left whole by a plain `self-update`:
 *     the run refuses before it builds. Under `--force` the directory is
 *     replaced whole, so the marker is gone afterwards and the runtime
 *     holds only what the build wrote.
 *
 * Every run goes through `./cli-capture.js`'s `plantScratchRepo` and
 * `runRafa`, under a scratch HOME and a PATH holding only a `bin/` of the
 * case's own and git's directory, so no case reaches a real session or
 * the real home. `self-update` runs from the scratch repository itself,
 * planted as a rafa checkout by {@link plantBuildableManifest}: its
 * `package.json` names this package and a version of the case's own, and
 * its `build` script is the seam a spawned run has for the real `bun run
 * build` `runtime/install.ts` calls — a script that writes `dist/cli.js`
 * fast, standing in for the checkout's own build the way a case that
 * dispatches in-process hands `installRuntime` a `build` function instead
 * (`self-update.test.ts`).
 */
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { name as PACKAGE_NAME, version as PACKAGE_VERSION } from '../../package.json';

import { plantScratchRepo, runRafa } from './cli-capture.js';

/** A temporary directory of this file's own, holding one scratch repository per case. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-mechanics-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long one spawned case may run. */
const RUN_TIMEOUT = { timeout: 30_000 };

/**
 * The version a `self-update` case installs a runtime under: its own,
 * distinct from this checkout's `package.json` version, so no case ever
 * reads or writes the real `~/.rafa/runtime/<version>/` this suite runs
 * from.
 */
const RUNTIME_VERSION = '9.8.7';

/**
 * The `build` script {@link plantBuildableManifest} writes: only `bun`
 * itself is guaranteed on the restricted `PATH` `runBuild` hands the
 * script (`dirname(process.execPath)` plus what the scratch repository
 * was spawned under, neither holding `mkdir` or `echo`), so it reaches
 * for `node:fs` through `bun -e` instead of shelling out.
 */
const FAST_BUILD_SCRIPT = 'bun -e "require(\'fs\').mkdirSync(\'dist\',{recursive:true});'
  + 'require(\'fs\').writeFileSync(\'dist/cli.js\',\'standing-in-for-the-real-build\')"';

/**
 * Writes `package.json` at `repo`, naming this package (so `self-update`
 * does not refuse it as no rafa checkout) and `RUNTIME_VERSION`, with a
 * `build` script that only makes `dist/cli.js` exist, fast: the build
 * seam a spawned run has, see the module note.
 */
function plantBuildableManifest(repo: string): void {
  const manifest = {
    name: PACKAGE_NAME,
    version: RUNTIME_VERSION,
    scripts: { build: FAST_BUILD_SCRIPT },
  };
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
}

/** Plants `marker.txt` inside `~/.rafa/runtime/<RUNTIME_VERSION>/`, and answers both paths. */
function plantRuntimeMarker(home: string): { runtimeDir: string; marker: string } {
  const runtimeDir = join(home, '.rafa', 'runtime', RUNTIME_VERSION);
  const marker = join(runtimeDir, 'marker.txt');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(marker, 'planted\n', 'utf8');
  return { runtimeDir, marker };
}

describe('rafa --version, spawned', () => {
  it('refuses --version beside a routing word, exit code 1, nothing on stdout', () => {
    const scratch = plantScratchRepo(tempBase);

    const run = runRafa(scratch, scratch.repo, ['loop', '--version']);

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe('rafa: "--version" is typed alone and takes no other word; got "loop"\n');
  }, RUN_TIMEOUT);

  it('reads -V as no version flag: with no routing word after it, the line is the root help', () => {
    const scratch = plantScratchRepo(tempBase);

    const run = runRafa(scratch, scratch.repo, ['-V']);

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.stdout).not.toContain(`rafa ${PACKAGE_VERSION}`);
    expect(run.stdout).toContain('Usage');
  }, RUN_TIMEOUT);

  it('prints rafa <version>, equal to package.json, and exits 0', () => {
    const scratch = plantScratchRepo(tempBase);

    const run = runRafa(scratch, scratch.repo, ['--version']);

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe(`rafa ${PACKAGE_VERSION}\n`);
  }, RUN_TIMEOUT);
});

describe('rafa self-update, spawned', () => {
  it('leaves a marker file in a runtime directory already there, refusing before the build', () => {
    const scratch = plantScratchRepo(tempBase);
    plantBuildableManifest(scratch.repo);
    const { runtimeDir, marker } = plantRuntimeMarker(scratch.home);

    const run = runRafa(scratch, scratch.repo, ['self-update']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`REFUSED — ${runtimeDir} already holds version ${RUNTIME_VERSION}`);
    expect(existsSync(marker)).toBe(true);
  }, RUN_TIMEOUT);

  it('replaces the runtime directory whole under --force, the marker file gone afterwards', () => {
    const scratch = plantScratchRepo(tempBase);
    plantBuildableManifest(scratch.repo);
    const { runtimeDir, marker } = plantRuntimeMarker(scratch.home);

    const run = runRafa(scratch, scratch.repo, ['self-update', '--force']);

    expect(run.exitCode).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(runtimeDir, 'cli.js'))).toBe(true);
    expect(readlinkSync(join(scratch.home, '.rafa', 'bin', 'rafa'))).toBe(join(runtimeDir, 'cli.js'));
  }, RUN_TIMEOUT);
});
