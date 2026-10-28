/**
 * Tests for `settle-lock.ts`: the lock step of a settle, read off a real
 * repository's commits and written into a real directory.
 *
 * Every refusal is paired with the same repository shape that reads,
 * so a refusal cannot be a reading that never looked, and every reading
 * checks `git status --porcelain` stays empty, since the reading writes
 * nothing. The checkout is left holding a different lock and manifest
 * than the commit read, so a reading taken from the disk would fail.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createGitRunner } from '@open-tomato/rafa/core/git';
import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';
import { afterAll, describe, expect, it } from 'bun:test';

import { LOCK_FILE, projectLockText, readProjectLock } from '../project/lock.js';

import { RAFA_PACKAGE_NAME, readSettleLock, writeSettleLock } from './settle-lock.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-settle-lock-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** This repository's own manifest, named from this file and not from the working directory. */
const OWN_MANIFEST = join(import.meta.dir, '..', '..', '..', '..', 'package.json');

/** Rafa's manifest at 0.4.0. */
const RAFA_MANIFEST = `{\n  "name": "${RAFA_PACKAGE_NAME}",\n  "version": "0.4.0"\n}\n`;

/** A project's manifest, named `demo`. */
const DEMO_MANIFEST = '{\n  "name": "demo",\n  "version": "0.4.0"\n}\n';

/** A lock in a format this rafa does not read. */
const UNKNOWN_LOCK = '{\n  "lockfileVersion": 99,\n  "rafa": "0.4.0"\n}\n';

/** How many repositories this file has made. */
let repoCount = 0;

/** A repository with one commit holding `files`, and a runner over it. */
interface Repo {
  readonly dir: string;
  readonly commit: string;
  readonly run: ReturnType<typeof createGitRunner>;
  readonly status: () => string;
}

/** Commits `files` in a fresh repository, then dirties the checkout so a disk read would differ. */
function repo(files: Readonly<Record<string, string>>): Repo {
  repoCount += 1;
  const dir = join(tempBase, `repo-${String(repoCount)}`);
  const home = join(dir, '..', `home-${String(repoCount)}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(home, { recursive: true });
  const env = {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    ...gitIdentityEnv(),
    LC_ALL: 'C',
  };
  const git = (args: readonly string[]): string => execFileSync('git', [...args], { cwd: dir, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q', '--initial-branch=main']);
  git(['config', 'commit.gpgsign', 'false']);
  for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'first']);
  const commit = git(['rev-parse', 'HEAD']);
  return { dir, commit, run: createGitRunner(dir), status: () => git(['status', '--porcelain']) };
}

/** The sentence a reading refused with, or a marker that fails every refusal's assertion. */
function problemOf(reading: ReturnType<typeof readSettleLock>): string {
  return 'problem' in reading
    ? reading.problem
    : '<planned>';
}

describe('RAFA_PACKAGE_NAME', () => {
  it('is the name the root package.json publishes rafa under', () => {
    const manifest = JSON.parse(readFileSync(OWN_MANIFEST, 'utf8')) as { readonly name?: unknown };
    expect(manifest.name).toBe(RAFA_PACKAGE_NAME);
  });
});

describe('readSettleLock refusals', () => {
  it('refuses a manifest that names a package other than rafa, naming release.moveLock and the name', () => {
    const r = repo({ 'package.json': DEMO_MANIFEST, [LOCK_FILE]: projectLockText('0.4.0') });

    const reading = readSettleLock(r.run, r.commit, 'package.json', '0.5.0');

    expect(problemOf(reading)).toContain('release.moveLock');
    expect(problemOf(reading)).toContain('"demo"');
    expect(r.status()).toBe('');
  });

  it('refuses a manifest that names no package', () => {
    const r = repo({ 'package.json': '{"version":"0.4.0"}\n' });

    const reading = readSettleLock(r.run, r.commit, 'package.json', '0.5.0');

    expect(problemOf(reading)).toContain('no package name');
  });

  it('refuses a lock in a format it does not read, with the sentence that names rafa.lock', () => {
    const r = repo({ 'package.json': RAFA_MANIFEST, [LOCK_FILE]: UNKNOWN_LOCK });

    const reading = readSettleLock(r.run, r.commit, 'package.json', '0.5.0');

    const problem = problemOf(reading);
    expect(problem.startsWith(`${LOCK_FILE} `)).toBe(true);
    expect(problem).toContain('lockfileVersion 99');
    expect(r.status()).toBe('');
  });

  it('refuses a lock that is not JSON', () => {
    const r = repo({ 'package.json': RAFA_MANIFEST, [LOCK_FILE]: 'not json\n' });

    const reading = readSettleLock(r.run, r.commit, 'package.json', '0.5.0');

    expect(reading).toEqual({ problem: `${LOCK_FILE} is not JSON` });
  });

  it('answers the sentence git gave when the manifest is not at the commit', () => {
    const r = repo({ 'README.md': 'only\n' });

    const reading = readSettleLock(r.run, r.commit, './package.json', '0.5.0');

    expect(problemOf(reading)).toContain(`${r.commit}:package.json could not be read`);
  });
});

describe('readSettleLock plans', () => {
  it('moves a lock at 0.4.0 to the settled version, read at the commit and not off the disk', () => {
    const r = repo({ 'package.json': RAFA_MANIFEST, [LOCK_FILE]: projectLockText('0.4.0') });
    writeFileSync(join(r.dir, LOCK_FILE), UNKNOWN_LOCK);
    writeFileSync(join(r.dir, 'package.json'), DEMO_MANIFEST);
    const dirty = r.status();

    const reading = readSettleLock(r.run, r.commit, 'package.json', '0.5.0');

    expect(reading).toEqual({ path: LOCK_FILE, from: '0.4.0', to: '0.5.0' });
    expect(dirty).not.toBe('');
    expect(r.status()).toBe(dirty);
  });

  it('plans a lock the commit lacks as one created at the settled version', () => {
    const r = repo({ 'package.json': RAFA_MANIFEST });

    const reading = readSettleLock(r.run, r.commit, 'package.json', '0.5.0');

    expect(reading).toEqual({ path: LOCK_FILE, from: null, to: '0.5.0' });
    expect(r.status()).toBe('');
  });
});

describe('writeSettleLock', () => {
  it('replaces a lock at 0.4.0 with one at the settled version', () => {
    const r = repo({ 'package.json': RAFA_MANIFEST, [LOCK_FILE]: projectLockText('0.4.0') });

    writeSettleLock(r.dir, '0.5.0');

    expect(readFileSync(join(r.dir, LOCK_FILE), 'utf8')).toBe(projectLockText('0.5.0'));
    expect(readProjectLock(r.dir)?.rafa).toBe('0.5.0');
    expect(r.status()).toBe(`M ${LOCK_FILE}`);
  });

  it('creates the lock where there was none', () => {
    const r = repo({ 'package.json': RAFA_MANIFEST });

    writeSettleLock(r.dir, '0.5.0');

    expect(readProjectLock(r.dir)?.rafa).toBe('0.5.0');
    expect(r.status()).toBe(`?? ${LOCK_FILE}`);
  });
});
