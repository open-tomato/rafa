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
 *   - `rafa release status` and `rafa release tag`, each in a scratch
 *     repository of its own with a bare `origin` remote of its own: the
 *     tag `release tag` writes is one `git tag --list` on the real
 *     repository then holds, and `release status` reads it back as the
 *     latest, with nothing left untagged. A tag already at HEAD is left
 *     alone by a second `release tag` — refused, the one tag unchanged —
 *     and `release status` already read it as the latest before that
 *     refusal. A tree that is not `main` refuses `release tag` outright,
 *     naming both branches, while `release status` still answers from
 *     wherever the tree is, since nothing in it depends on the branch.
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
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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

/**
 * The version a `release` case's scratch repositories are about to
 * release: its own, distinct from {@link RUNTIME_VERSION} and from this
 * checkout's `package.json` version, for the reason {@link RUNTIME_VERSION}
 * is.
 */
const RELEASE_VERSION = '1.4.0';

/** The tag `release tag` writes for {@link RELEASE_VERSION}. */
const RELEASE_TAG = `v${RELEASE_VERSION}`;

/** A manifest naming {@link RELEASE_VERSION}, at `release.versionFile`'s default path. */
const RELEASE_MANIFEST = `${JSON.stringify({ name: 'scratch-release-repo', version: RELEASE_VERSION })}\n`;

/** A changelog whose newest section names {@link RELEASE_VERSION}, at `release.changelog`'s default path. */
const RELEASE_CHANGELOG = [
  '# Changelog',
  '',
  `## ${RELEASE_VERSION} — 2026-09-20, a scratch release`,
  '',
  '- release: a change worth releasing',
  '',
].join('\n');

/**
 * Runs git with `args` in `cwd`, under `home` and a config of this
 * suite's own — an identity for the commit {@link plantReleaseRepo}
 * makes, which `git tag` and `git rev-parse` need none of.
 */
function git(cwd: string, home: string, args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'rafa test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'rafa test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  });
}

/**
 * Plants a scratch repository of its own with a bare `origin` remote of
 * its own beside it: `main` checked out, one commit carrying
 * {@link RELEASE_MANIFEST} and {@link RELEASE_CHANGELOG}, pushed to
 * `origin`. `branch`, given, is checked out from that commit afterwards,
 * so the repository's tree ends up wherever a case asks while `origin`'s
 * `main` always carries the release commit.
 */
function plantReleaseRepo(branch: string = 'main'): ScratchRepo {
  const scratch = plantScratchRepo(tempBase);
  const origin = join(dirname(scratch.repo), 'origin.git');
  git(dirname(scratch.repo), scratch.home, ['init', '-q', '--bare', '--initial-branch=main', origin]);

  git(scratch.repo, scratch.home, ['checkout', '-q', '-B', 'main']);
  writeFileSync(join(scratch.repo, 'package.json'), RELEASE_MANIFEST, 'utf8');
  writeFileSync(join(scratch.repo, 'CHANGELOG.md'), RELEASE_CHANGELOG, 'utf8');
  git(scratch.repo, scratch.home, ['add', '-A']);
  git(scratch.repo, scratch.home, ['commit', '-q', '-m', `chore: release ${RELEASE_VERSION}`]);
  git(scratch.repo, scratch.home, ['remote', 'add', 'origin', origin]);
  git(scratch.repo, scratch.home, ['push', '-q', '-u', 'origin', 'main']);
  if (branch !== 'main') git(scratch.repo, scratch.home, ['checkout', '-q', '-b', branch]);
  return scratch;
}

/**
 * The value of the labeled cell `renderStatus` (`../commands/release/status.ts`)
 * wrote on its own line of `block` — read by label rather than by
 * column width, so a case does not pin the block's padding.
 */
function cellOf(block: string, label: string): string {
  const prefix = new RegExp(`^${label}\\s+`);
  const line = block.split('\n').find((entry) => prefix.test(entry.trim()));
  if (line === undefined) throw new Error(`no "${label}" line in:\n${block}`);
  return line.trim().replace(prefix, '');
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

describe('rafa release status and release tag, spawned', () => {
  it('writes the tag `release tag` promises, which `release status` then reads as the latest', () => {
    const scratch = plantReleaseRepo();

    const before = runRafa(scratch, scratch.repo, ['release', 'status']);
    expect(before.exitCode).toBe(0);
    expect(cellOf(before.stdout, 'version file')).toBe(`package.json: ${RELEASE_VERSION}`);
    expect(cellOf(before.stdout, 'latest tag')).toBe('none, of 0 release tags');
    expect(cellOf(before.stdout, 'untagged')).toBe(RELEASE_VERSION);

    const tagged = runRafa(scratch, scratch.repo, ['release', 'tag']);
    expect(tagged.exitCode).toBe(0);
    expect(tagged.stdout).toContain(`Tagged ${RELEASE_TAG} at the HEAD of main.`);
    expect(git(scratch.repo, scratch.home, ['tag', '--list']).trim()).toBe(RELEASE_TAG);

    const after = runRafa(scratch, scratch.repo, ['release', 'status']);
    expect(after.exitCode).toBe(0);
    expect(cellOf(after.stdout, 'latest tag')).toBe(`${RELEASE_TAG}, of 1 release tags`);
    expect(cellOf(after.stdout, 'untagged')).toBe('none');
  }, RUN_TIMEOUT);

  it('refuses a second tag once one already names the version, which status already read as latest', () => {
    const scratch = plantReleaseRepo();
    git(scratch.repo, scratch.home, ['tag', RELEASE_TAG, 'HEAD']);

    const status = runRafa(scratch, scratch.repo, ['release', 'status']);
    expect(status.exitCode).toBe(0);
    expect(cellOf(status.stdout, 'latest tag')).toBe(`${RELEASE_TAG}, of 1 release tags`);
    expect(cellOf(status.stdout, 'untagged')).toBe('none');

    const tag = runRafa(scratch, scratch.repo, ['release', 'tag']);
    expect(tag.exitCode).toBe(1);
    expect(tag.stderr).toContain(`${RELEASE_TAG} already names ${RELEASE_VERSION}`);
    expect(git(scratch.repo, scratch.home, ['tag', '--list']).trim()).toBe(RELEASE_TAG);
  }, RUN_TIMEOUT);

  it('refuses on a tree that is not main, naming both branches, while status still answers from it', () => {
    const branch = 'feat/scratch-release-not-main';
    const scratch = plantReleaseRepo(branch);

    const tag = runRafa(scratch, scratch.repo, ['release', 'tag']);
    expect(tag.exitCode).toBe(1);
    expect(tag.stderr).toContain(branch);
    expect(tag.stderr).toContain('main');
    expect(git(scratch.repo, scratch.home, ['tag', '--list']).trim()).toBe('');

    const status = runRafa(scratch, scratch.repo, ['release', 'status']);
    expect(status.exitCode).toBe(0);
    expect(cellOf(status.stdout, 'version file')).toBe(`package.json: ${RELEASE_VERSION}`);
    expect(cellOf(status.stdout, 'latest tag')).toBe('none, of 0 release tags');
  }, RUN_TIMEOUT);
});
