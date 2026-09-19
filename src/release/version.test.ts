/**
 * Tests for the release version (`src/release/version.ts`): the base
 * read off `origin/main`, the next version each level lands on, and
 * the write that changes one token of a manifest.
 *
 * The three halves are driven three ways. {@link nextVersion} takes
 * literals, since it reads nothing. The write works in a scratch
 * directory under `mkdtemp`, never in the checkout the suite runs in,
 * whose own `package.json` is the module's stated no-trailing-newline
 * example and would be rewritten by a case that took a shortcut. The
 * base reading is driven mostly through a fake {@link GitRunner} that
 * records its argv, and ONCE through the real git against a scratch
 * clone of a scratch repository — a file path for a remote, so nothing
 * reaches a network.
 *
 * That real-git case is here because the module's note makes a claim
 * about git and not about this code: that `git fetch origin main`
 * updates `refs/remotes/origin/main` and not only `FETCH_HEAD`, so the
 * `show` after it reads the tip just fetched. A fake runner cannot
 * measure that, and the claim is the reason the two argv are in that
 * order at all. Its control is in the case itself: the version before
 * the fetch is asserted to be the OLD one, so the reading could have
 * come out stale and did not.
 *
 * Several things here would pass while wrong:
 *
 *  - A bump that formatted the triple by string arithmetic satisfies
 *    every single-digit case, so `1.9.9` minor is asserted to be
 *    `1.10.0` and not `1.1.0` or `1.90.0`.
 *  - A write that round-tripped the JSON satisfies every assertion
 *    about the new version. So each write case compares the whole text
 *    outside the version token byte for byte, and the manifests carry
 *    a tab indent, a CRLF line ending, a key AFTER `version` and both
 *    trailing-newline states.
 *  - A replacement that took the first `"version":` pair satisfies
 *    every manifest whose own version comes first. So one manifest
 *    puts a nested `version` block ABOVE the top-level one, and
 *    another gives the nested one the SAME value, which defeats a
 *    by-value search too.
 *
 * Five mutations of `version.ts` were driven on 2026-09-20, one at a
 * time over `env -u CLAUDECODE bun test src/release/version.test.ts`,
 * the module restored from a scratch copy and verified with
 * `shasum -c` after each. 45 pass either side, and each count is that
 * run's own:
 *
 *  - the prerelease rule dropped, so every level bumps the number it
 *    names: 4 fail, the three prerelease rows of the module's table and
 *    the build-metadata case, which carries a prerelease of its own.
 *  - the candidate loop reduced to its first match, so the pair found
 *    first wins: 3 fail, all three nested-manifest cases.
 *  - the rewrite replaced by `JSON.stringify(fields, null, 2)`: 5 fail
 *    — the tab-and-CRLF case, both cases whose manifest ends WITH a
 *    newline, and two nested ones. The cases whose manifest ends
 *    without a newline survive it, this file's own `package.json` case
 *    included, because a two-space manifest with no trailing newline
 *    IS its own round trip: measured 2026-09-20,
 *    `JSON.stringify(JSON.parse(text), null, 2) === text` is true of
 *    this repository's manifest. So the with-newline direction is the
 *    one carrying that mutation, which is why both directions are here.
 *  - the fetch dropped from `readBaseVersion`: 7 fail, every case that
 *    counts the argv or reads a moved base, the real-git one included,
 *    which then reads the version the clone held before the upstream
 *    moved.
 *  - `gitPathOf` returning its argument: 2 fail, the `./` case and the
 *    reading that asks git for one.
 */
import type { GitResult, GitRunner } from '../pr/git.js';

import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/git.js';

import {
  RELEASE_BASE_BRANCH,
  RELEASE_REMOTE,
  formatSemanticVersion,
  gitPathOf,
  nextVersion,
  parseSemanticVersion,
  readBaseVersion,
  readManifestVersion,
  replaceManifestVersion,
  writeManifestVersion,
} from './version.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-version-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A directory of this case's own under the temporary base. */
function scratchDir(name: string): string {
  return mkdtempSync(join(tempBase, `${name}-`));
}

/** This repository's own manifest, named from this file and not from the working directory. */
const OWN_MANIFEST = join(import.meta.dir, '..', '..', 'package.json');

/** What a fake runner answered, and the argv it was asked. */
interface FakeGit {
  /** The runner to hand to the module. */
  readonly run: GitRunner;
  /** Every argv it was called with, in order. */
  readonly calls: string[][];
}

/** A runner answering `replies` in order, recording what it was asked. */
function fakeGit(...replies: Partial<GitResult>[]): FakeGit {
  const calls: string[][] = [];
  const run: GitRunner = (args) => {
    calls.push([...args]);
    const reply = replies[calls.length - 1] ?? {};
    return { ok: reply.ok ?? true, stdout: reply.stdout ?? '', stderr: reply.stderr ?? '' };
  };
  return { run, calls };
}

describe('parseSemanticVersion', () => {
  it('reads the three numbers of a plain version', () => {
    expect(parseSemanticVersion('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: '',
      build: '',
    });
  });

  it('keeps the prerelease and the build apart from the numbers', () => {
    expect(parseSemanticVersion('10.0.7-rc.1+build.9')).toEqual({
      major: 10,
      minor: 0,
      patch: 7,
      prerelease: 'rc.1',
      build: 'build.9',
    });
  });

  it('refuses a version that is not three numbers', () => {
    expect(parseSemanticVersion('1.2')).toBeNull();
    expect(parseSemanticVersion('1.2.3.4')).toBeNull();
    expect(parseSemanticVersion('1.2.x')).toBeNull();
    expect(parseSemanticVersion('')).toBeNull();
  });

  it('refuses a v prefix and surrounding space', () => {
    expect(parseSemanticVersion('v1.2.3')).toBeNull();
    expect(parseSemanticVersion(' 1.2.3')).toBeNull();
    expect(parseSemanticVersion('1.2.3 ')).toBeNull();
  });

  it('refuses a leading zero in any of the three numbers', () => {
    expect(parseSemanticVersion('01.2.3')).toBeNull();
    expect(parseSemanticVersion('1.02.3')).toBeNull();
    expect(parseSemanticVersion('1.2.03')).toBeNull();
    expect(parseSemanticVersion('0.2.3')).not.toBeNull();
  });

  it('round-trips through formatSemanticVersion', () => {
    for (const raw of ['0.4.0', '1.2.3-rc.1', '1.2.3+b9', '10.0.7-rc.1+build.9']) {
      const parsed = parseSemanticVersion(raw);
      expect(parsed).not.toBeNull();
      expect(formatSemanticVersion(parsed ?? { major: 0, minor: 0, patch: 0, prerelease: '', build: '' })).toBe(raw);
    }
  });
});

describe('nextVersion over a plain version', () => {
  it('adds one to the patch', () => {
    expect(nextVersion('1.2.3', 'patch')).toBe('1.2.4');
  });

  it('adds one to the minor and zeroes the patch', () => {
    expect(nextVersion('0.4.0', 'minor')).toBe('0.5.0');
    expect(nextVersion('1.2.3', 'minor')).toBe('1.3.0');
  });

  it('adds one to the major and zeroes the rest', () => {
    expect(nextVersion('1.2.3', 'major')).toBe('2.0.0');
  });

  it('counts rather than concatenates when a number reaches ten', () => {
    expect(nextVersion('1.9.9', 'patch')).toBe('1.9.10');
    expect(nextVersion('1.9.9', 'minor')).toBe('1.10.0');
    expect(nextVersion('9.9.9', 'major')).toBe('10.0.0');
  });

  it('answers the base unchanged for none', () => {
    expect(nextVersion('1.2.3', 'none')).toBe('1.2.3');
    expect(nextVersion('1.2.3-rc.1', 'none')).toBe('1.2.3-rc.1');
  });
});

describe('nextVersion over a prerelease or a build', () => {
  it('lands a patch on the triple the prerelease was heading for', () => {
    expect(nextVersion('1.2.3-rc.1', 'patch')).toBe('1.2.3');
  });

  it('lands a minor on that triple only when the patch is already zero', () => {
    expect(nextVersion('1.3.0-rc.1', 'minor')).toBe('1.3.0');
    expect(nextVersion('1.2.3-rc.1', 'minor')).toBe('1.3.0');
  });

  it('lands a major on that triple only when the minor and patch are zero', () => {
    expect(nextVersion('2.0.0-rc.1', 'major')).toBe('2.0.0');
    expect(nextVersion('1.2.3-rc.1', 'major')).toBe('2.0.0');
  });

  it('drops the build metadata on every bump', () => {
    expect(nextVersion('1.2.3+b9', 'patch')).toBe('1.2.4');
    expect(nextVersion('1.2.3-rc.1+b9', 'patch')).toBe('1.2.3');
    expect(nextVersion('1.2.3+b9', 'major')).toBe('2.0.0');
  });
});

describe('nextVersion over a base it cannot read', () => {
  it('refuses at every level, none included', () => {
    for (const level of ['patch', 'minor', 'major', 'none'] as const) {
      expect(nextVersion('v1.2.3', level)).toBeNull();
      expect(nextVersion('nightly', level)).toBeNull();
      expect(nextVersion('', level)).toBeNull();
    }
  });
});

describe('readManifestVersion', () => {
  it('reads the version a manifest declares, trimmed', () => {
    expect(readManifestVersion('{"name":"x","version":"0.4.0"}')).toBe('0.4.0');
    expect(readManifestVersion('{"version":"  0.4.0  "}')).toBe('0.4.0');
  });

  it('answers null for a text that is no JSON object', () => {
    expect(readManifestVersion('not json at all')).toBeNull();
    expect(readManifestVersion('["0.4.0"]')).toBeNull();
    expect(readManifestVersion('"0.4.0"')).toBeNull();
    expect(readManifestVersion('')).toBeNull();
  });

  it('answers null when the version is absent, blank or not a string', () => {
    expect(readManifestVersion('{"name":"x"}')).toBeNull();
    expect(readManifestVersion('{"version":""}')).toBeNull();
    expect(readManifestVersion('{"version":"   "}')).toBeNull();
    expect(readManifestVersion('{"version":4}')).toBeNull();
    expect(readManifestVersion('{"version":null}')).toBeNull();
  });

  it('reads a version it could never bump, and leaves the judgement to nextVersion', () => {
    expect(readManifestVersion('{"version":"nightly"}')).toBe('nightly');
    expect(nextVersion('nightly', 'patch')).toBeNull();
  });
});

describe('replaceManifestVersion byte for byte', () => {
  it('keeps a manifest that ends without a newline ending without one', () => {
    const text = '{\n  "name": "rafa",\n  "version": "0.4.0"\n}';
    const rewritten = replaceManifestVersion(text, '0.5.0');

    expect(rewritten?.previous).toBe('0.4.0');
    expect(rewritten?.text).toBe('{\n  "name": "rafa",\n  "version": "0.5.0"\n}');
    expect(rewritten?.text.endsWith('}')).toBe(true);
  });

  it('keeps a manifest that ends with a newline ending with one', () => {
    const text = '{\n  "name": "rafa",\n  "version": "0.4.0"\n}\n';
    const rewritten = replaceManifestVersion(text, '0.5.0');

    expect(rewritten?.text).toBe('{\n  "name": "rafa",\n  "version": "0.5.0"\n}\n');
  });

  it('keeps a tab indent, a CRLF line ending and the spacing around the colon', () => {
    const text = '{\r\n\t"name": "rafa",\r\n\t"version"  :   "0.4.0",\r\n\t"private": true\r\n}\r\n';
    const rewritten = replaceManifestVersion(text, '1.0.0');

    expect(rewritten?.text).toBe('{\r\n\t"name": "rafa",\r\n\t"version"  :   "1.0.0",\r\n\t"private": true\r\n}\r\n');
  });

  it('changes nothing but the version token of a manifest with keys on both sides of it', () => {
    const text = readFileSync(OWN_MANIFEST, 'utf8');
    const previous = readManifestVersion(text);
    expect(previous).not.toBeNull();

    const rewritten = replaceManifestVersion(text, '99.0.0');

    expect(rewritten?.previous).toBe(previous ?? '');
    expect(rewritten?.text).toBe(text.replace(`"version": ${JSON.stringify(previous)}`, '"version": "99.0.0"'));
    expect(rewritten?.text.length).toBe(text.length + '99.0.0'.length - (previous ?? '').length);
  });

  it('writes the same bytes back when the version does not move', () => {
    const text = '{\n  "version": "0.4.0"\n}';

    expect(replaceManifestVersion(text, '0.4.0')?.text).toBe(text);
  });

  it('answers null when there is no version to replace', () => {
    expect(replaceManifestVersion('{"name":"x"}', '1.0.0')).toBeNull();
    expect(replaceManifestVersion('not json', '1.0.0')).toBeNull();
    expect(replaceManifestVersion('{"version":4}', '1.0.0')).toBeNull();
  });
});

describe('replaceManifestVersion against a nested version key', () => {
  it('takes the top-level pair and not a nested one above it', () => {
    const text = '{\n  "volta": { "version": "1.1.1" },\n  "version": "0.4.0"\n}';
    const rewritten = replaceManifestVersion(text, '0.5.0');

    expect(rewritten?.previous).toBe('0.4.0');
    expect(rewritten?.text).toBe('{\n  "volta": { "version": "1.1.1" },\n  "version": "0.5.0"\n}');
  });

  it('takes the top-level pair when a nested one holds the same value', () => {
    const text = '{\n  "tool": { "version": "0.4.0" },\n  "version": "0.4.0"\n}';
    const rewritten = replaceManifestVersion(text, '0.5.0');

    expect(rewritten?.text).toBe('{\n  "tool": { "version": "0.4.0" },\n  "version": "0.5.0"\n}');
  });

  it('leaves every other value of the parsed manifest as it was', () => {
    const text = '{\n  "name": "rafa",\n  "engines": { "version": "20" },\n  "version": "0.4.0",\n  "private": true\n}';
    const rewritten = replaceManifestVersion(text, '0.5.0');
    const before = JSON.parse(text) as Record<string, unknown>;
    const after = JSON.parse(rewritten?.text ?? '{}') as Record<string, unknown>;

    expect(after['version']).toBe('0.5.0');
    expect(JSON.stringify({ ...after, version: before['version'] })).toBe(JSON.stringify(before));
  });
});

describe('writeManifestVersion', () => {
  it('writes the bump into a manifest that ends without a newline, byte for byte', () => {
    const dir = scratchDir('write-no-newline');
    const path = join(dir, 'package.json');
    const text = '{\n  "name": "rafa",\n  "version": "0.4.0",\n  "private": true\n}';
    writeFileSync(path, text);

    const reading = writeManifestVersion(path, '0.5.0');

    expect(reading.written).toBe(true);
    expect(reading.previous).toBe('0.4.0');
    expect(reading.version).toBe('0.5.0');
    expect(reading.problem).toBeNull();
    expect(readFileSync(path, 'utf8')).toBe('{\n  "name": "rafa",\n  "version": "0.5.0",\n  "private": true\n}');
  });

  it('writes the bump into a manifest that ends with a newline, keeping it', () => {
    const dir = scratchDir('write-newline');
    const path = join(dir, 'package.json');
    writeFileSync(path, '{\n  "version": "0.4.0"\n}\n');

    const reading = writeManifestVersion(path, '1.0.0');

    expect(reading.written).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('{\n  "version": "1.0.0"\n}\n');
  });

  it('reports a manifest that is not there and writes nothing', () => {
    const dir = scratchDir('write-missing');
    const path = join(dir, 'package.json');

    const reading = writeManifestVersion(path, '1.0.0');

    expect(reading.written).toBe(false);
    expect(reading.previous).toBeNull();
    expect(reading.problem).toContain(path);
    expect(reading.problem).toContain('could not be read');
  });

  it('reports a manifest holding no version and leaves it untouched', () => {
    const dir = scratchDir('write-versionless');
    const path = join(dir, 'package.json');
    const text = '{\n  "name": "rafa"\n}';
    writeFileSync(path, text);

    const reading = writeManifestVersion(path, '1.0.0');

    expect(reading.written).toBe(false);
    expect(reading.previous).toBeNull();
    expect(reading.problem).toContain('declares no version');
    expect(readFileSync(path, 'utf8')).toBe(text);
  });

  it('reports a manifest that is no JSON object and leaves it untouched', () => {
    const dir = scratchDir('write-not-json');
    const path = join(dir, 'package.json');
    const text = 'version = "0.4.0"\n';
    writeFileSync(path, text);

    const reading = writeManifestVersion(path, '1.0.0');

    expect(reading.written).toBe(false);
    expect(reading.problem).toContain('declares no version');
    expect(readFileSync(path, 'utf8')).toBe(text);
  });
});

describe('gitPathOf', () => {
  it('leaves a repository-root-relative path alone', () => {
    expect(gitPathOf('package.json')).toBe('package.json');
    expect(gitPathOf('packages/cli/package.json')).toBe('packages/cli/package.json');
  });

  it('strips a leading dot-slash, which git would read against the working directory', () => {
    expect(gitPathOf('./package.json')).toBe('package.json');
    expect(gitPathOf('././package.json')).toBe('package.json');
  });
});

describe('readBaseVersion through a fake runner', () => {
  it('fetches the branch and then shows the manifest on it', () => {
    const git = fakeGit({}, { stdout: '{"version":"0.4.0"}' });

    const reading = readBaseVersion(git.run, 'package.json');

    expect(git.calls).toEqual([
      ['fetch', RELEASE_REMOTE, RELEASE_BASE_BRANCH],
      ['show', 'origin/main:package.json'],
    ]);
    expect(reading.version).toBe('0.4.0');
    expect(reading.ref).toBe('origin/main');
    expect(reading.path).toBe('package.json');
    expect(reading.fetched).toBe(true);
    expect(reading.problems).toEqual([]);
  });

  it('asks git for a dot-slash path without its dot-slash', () => {
    const git = fakeGit({}, { stdout: '{"version":"0.4.0"}' });

    const reading = readBaseVersion(git.run, './package.json');

    expect(git.calls[1]).toEqual(['show', 'origin/main:package.json']);
    expect(reading.path).toBe('package.json');
  });

  it('reads a manifest under a named remote and branch', () => {
    const git = fakeGit({}, { stdout: '{"version":"2.1.0"}' });

    const reading = readBaseVersion(git.run, 'packages/cli/package.json', {
      remote: 'upstream',
      branch: 'trunk',
    });

    expect(git.calls).toEqual([
      ['fetch', 'upstream', 'trunk'],
      ['show', 'upstream/trunk:packages/cli/package.json'],
    ]);
    expect(reading.ref).toBe('upstream/trunk');
    expect(reading.version).toBe('2.1.0');
  });

  it('still reads after a failed fetch, and says the version may be stale', () => {
    const git = fakeGit(
      { ok: false, stderr: 'fatal: unable to access origin' },
      { stdout: '{"version":"0.4.0"}' },
    );

    const reading = readBaseVersion(git.run, 'package.json');

    expect(reading.fetched).toBe(false);
    expect(reading.version).toBe('0.4.0');
    expect(reading.problems).toHaveLength(1);
    expect(reading.problems[0]).toContain('could not be fetched');
    expect(reading.problems[0]).toContain('fatal: unable to access origin');
  });

  it('answers no version when the show failed, naming the ref and the path', () => {
    const git = fakeGit({}, { ok: false, stderr: 'fatal: path \'package.json\' does not exist in \'origin/main\'' });

    const reading = readBaseVersion(git.run, 'package.json');

    expect(reading.version).toBeNull();
    expect(reading.fetched).toBe(true);
    expect(reading.problems).toHaveLength(1);
    expect(reading.problems[0]).toContain('origin/main:package.json');
    expect(reading.problems[0]).toContain('does not exist');
  });

  it('carries both problems when the fetch and the show each failed', () => {
    const git = fakeGit(
      { ok: false, stderr: 'fatal: unable to access origin' },
      { ok: false, stderr: 'fatal: invalid object name' },
    );

    const reading = readBaseVersion(git.run, 'package.json');

    expect(reading.fetched).toBe(false);
    expect(reading.version).toBeNull();
    expect(reading.problems).toHaveLength(2);
  });

  it('says so when the manifest on the base declares no version', () => {
    const git = fakeGit({}, { stdout: '{"name":"rafa"}' });

    const reading = readBaseVersion(git.run, 'package.json');

    expect(reading.version).toBeNull();
    expect(reading.fetched).toBe(true);
    expect(reading.problems).toEqual(['origin/main:package.json declares no version']);
  });
});

describe('readBaseVersion against the real git', () => {
  it('reads the version the fetch just brought down, not the one the clone held', () => {
    const dir = scratchDir('real-git');
    const upstream = join(dir, 'upstream');
    const clone = join(dir, 'clone');
    const outside = createGitRunner(dir);

    outside(['init', '--quiet', '--initial-branch', RELEASE_BASE_BRANCH, upstream]);
    const inUpstream = createGitRunner(upstream);
    inUpstream(['config', 'user.email', 'rafa@example.test']);
    inUpstream(['config', 'user.name', 'rafa test']);
    writeFileSync(join(upstream, 'package.json'), '{\n  "version": "0.4.0"\n}');
    inUpstream(['add', '--all']);
    inUpstream(['commit', '--quiet', '--message', 'base']);

    outside(['clone', '--quiet', upstream, clone]);
    const inClone = createGitRunner(clone);

    // The control: before the upstream moves, the clone reads the base it has.
    expect(readBaseVersion(inClone, 'package.json').version).toBe('0.4.0');

    writeFileSync(join(upstream, 'package.json'), '{\n  "version": "0.5.0"\n}');
    inUpstream(['commit', '--quiet', '--all', '--message', 'release']);

    // Nothing has fetched yet, so the clone still holds the old tip.
    expect(inClone(['show', 'origin/main:package.json']).stdout).toContain('0.4.0');

    const reading = readBaseVersion(inClone, 'package.json');

    expect(reading.fetched).toBe(true);
    expect(reading.problems).toEqual([]);
    expect(reading.version).toBe('0.5.0');
    expect(nextVersion(reading.version ?? '', 'minor')).toBe('0.6.0');
  });

  it('reports the file that is not on the base, leaving the fetch green', () => {
    const dir = scratchDir('real-git-missing');
    const upstream = join(dir, 'upstream');
    const clone = join(dir, 'clone');
    const outside = createGitRunner(dir);

    outside(['init', '--quiet', '--initial-branch', RELEASE_BASE_BRANCH, upstream]);
    const inUpstream = createGitRunner(upstream);
    inUpstream(['config', 'user.email', 'rafa@example.test']);
    inUpstream(['config', 'user.name', 'rafa test']);
    writeFileSync(join(upstream, 'README.md'), 'no manifest here\n');
    inUpstream(['add', '--all']);
    inUpstream(['commit', '--quiet', '--message', 'base']);

    outside(['clone', '--quiet', upstream, clone]);

    const reading = readBaseVersion(createGitRunner(clone), 'package.json');

    expect(reading.fetched).toBe(true);
    expect(reading.version).toBeNull();
    expect(reading.problems).toHaveLength(1);
    expect(reading.problems[0]).toContain('origin/main:package.json could not be read');
  });
});
