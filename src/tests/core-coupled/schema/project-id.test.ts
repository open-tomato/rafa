/**
 * Tests for the `project_id` derivation.
 *
 * ## The six remotes are measured against the shell this copies
 *
 * Every entry of {@link REMOTES} was run on 2026-09-18 through the
 * text of `_clv2_normalize_remote_url` in
 * `~/.claude/skills/continuous-learning-v2/scripts/detect-project.sh`
 * (copied into a scratch script, because sourcing the real one runs
 * its detection on load and creates directories under the home) piped
 * to `shasum -a 256 | cut -c1-12`, and the normalised strings and
 * digests below are what it printed. FOUR spellings of one remote hash
 * alike, which is the property the whole algorithm exists for, and
 * three rows are the controls that the lowercasing is conditional
 * rather than unconditional: a `file://` path, a local path carrying
 * an `@` with no `:` after it, and `Git@GitHub.com/O/R.git`, which has
 * an `@` and no colon anywhere and so is a path rather than an
 * `scp`-style remote. Those last two are also what measures the
 * `*@*:*` test itself, since the three lowercase-already rows would
 * hash alike whatever it answered. Nothing else in the repository
 * compares the two implementations, so these literals are the whole
 * guard against drift.
 *
 * ## Two cases run git
 *
 * {@link gitRemoteUrl} is a spawn, so it is measured by spawning: a
 * repository created under `mkdtempSync` gets an origin and the
 * function reads it back, and a directory in no repository at all is
 * the control that the same call answers null rather than throwing.
 * Both assert their path resolves under the system temporary directory
 * before they touch it, neither writes anywhere else, and the `git
 * init` runs with `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` pointed
 * at `/dev/null` so no machine's git configuration reaches them.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'bun:test';

import {
  PROJECT_ID_LENGTH,
  PROJECT_ID_PATTERN,
  gitRemoteUrl,
  normalizeRemote,
  projectId,
  projectIdFromRemote,
} from '@open-tomato/rafa/schema/project-id';
import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';

/**
 * The spec's one-second bound on a crafted remote: the old credential
 * strip took about 3.7 s on {@link CRAFTED_SCHEMES} schemes and the old
 * trailing-slash trim about 2.2 s on {@link CRAFTED_SLASHES} slashes,
 * each tried from every start of its run and growing with its square.
 */
const REDOS_BOUND_MS = 1000;

/**
 * `://` repeats in the crafted remote, 100,002 characters: at the plan's
 * 50,000 the old strip took about 0.9 s, under the bound, so the shape
 * is doubled for the case to fail on it.
 */
const CRAFTED_SCHEMES = 33_334;

/** Slashes in the crafted remote's run, about the 50,000 characters of the plan's slow shape. */
const CRAFTED_SLASHES = 50_000;

/** A remote, what the shell normalises it to, and the id it hashes to. */
const REMOTES: readonly (readonly [string, string, string])[] = [
  ['git@github.com:open-tomato/rafa.git', 'github.com/open-tomato/rafa', 'a8785cdba525'],
  ['https://github.com/Open-Tomato/Rafa.git', 'github.com/open-tomato/rafa', 'a8785cdba525'],
  [
    'https://ghp_secret@github.com/open-tomato/rafa.git',
    'github.com/open-tomato/rafa',
    'a8785cdba525',
  ],
  [
    'Git@GitHub.com:Open-Tomato/Rafa.git',
    'github.com/open-tomato/rafa',
    'a8785cdba525',
  ],
  [
    'file:///Users/Marcos/projects/open-tomato/rafa',
    '/Users/Marcos/projects/open-tomato/rafa',
    'da9f5830a0f1',
  ],
  ['ssh://git@example.com:2222/team/Repo.git/', 'example.com:2222/team/repo', '629437dba4b3'],
  ['/srv/git/bare-repo.git', '/srv/git/bare-repo', 'e80fc46c791e'],
  [
    '/Users/Marcos/repos/My@Repo.git',
    '/Users/Marcos/repos/My@Repo',
    'a1f3ed32e99e',
  ],
  [
    'Git@GitHub.com/Open-Tomato/Rafa.git',
    'Git@GitHub.com/Open-Tomato/Rafa',
    'f2e74d9f753e',
  ],
];

describe('the project id', () => {
  for (const [url, normalized, id] of REMOTES) {
    test(`normalises and hashes ${url} as the shell does`, () => {
      expect(normalizeRemote(url)).toBe(normalized);
      expect(projectIdFromRemote(url)).toBe(id);
    });
  }

  test('gives one id to the four spellings of one remote', () => {
    const ids = new Set(REMOTES.slice(0, 4)
      .map(([url]) => projectIdFromRemote(url)));

    expect(ids.size).toBe(1);
  });

  test('gives different ids to different remotes, which is the control', () => {
    expect(projectIdFromRemote('git@github.com:open-tomato/rafa.git'))
      .not.toBe(projectIdFromRemote('git@github.com:open-tomato/other.git'));
  });

  test('is twelve lowercase hex characters', () => {
    expect(projectIdFromRemote(REMOTES[0]![0])).toMatch(PROJECT_ID_PATTERN);
    expect(projectIdFromRemote(REMOTES[0]![0])?.length).toBe(PROJECT_ID_LENGTH);
  });

  test('is null for a remote that says nothing', () => {
    expect(projectIdFromRemote('')).toBeNull();
    expect(projectIdFromRemote('   \n')).toBeNull();
  });

  test('comes from the seam when one is given, and is null when it reads none', () => {
    expect(projectId('/anywhere', { readRemote: () => 'git@github.com:open-tomato/rafa.git' }))
      .toBe('a8785cdba525');
    expect(projectId('/anywhere', { readRemote: () => null })).toBeNull();
  });
});

describe('the credential strip and the slash trim', () => {
  test('strips the credentials after the first scheme that has some, up to the first @, once', () => {
    expect(normalizeRemote('https://user:pw@Host.com/O/R.git')).toBe('host.com/o/r');
    expect(normalizeRemote('ssh://a@b://c@d/r')).toBe('b://c@d/r');
    expect(normalizeRemote('x://@y://u@h/r')).toBe('@y://h/r');
    expect(normalizeRemote('http://h/a@b')).toBe('b');
  });

  test('strips nothing where no scheme holds credentials', () => {
    expect(normalizeRemote('https://@host.com/r')).toBe('@host.com/r');
    expect(normalizeRemote('a@b')).toBe('a@b');
  });

  test('drops every trailing slash and keeps an inner run', () => {
    expect(normalizeRemote('https://host.com/r//')).toBe('host.com/r');
    expect(normalizeRemote('a/////x')).toBe('a/////x');
  });

  test('strips no credentials from a long run of schemes holding no @, within REDOS_BOUND_MS', () => {
    const url = '://'.repeat(CRAFTED_SCHEMES);

    const started = performance.now();
    const normalized = normalizeRemote(url);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(REDOS_BOUND_MS);
    expect(normalized).toBe(`${'://'.repeat(CRAFTED_SCHEMES - 1)}:`);
  });

  test('trims no slash off a remote whose slash run is not at its end, within REDOS_BOUND_MS', () => {
    const url = `a${'/'.repeat(CRAFTED_SLASHES)}x`;

    const started = performance.now();
    const normalized = normalizeRemote(url);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(REDOS_BOUND_MS);
    expect(normalized).toBe(url);
  });
});

/** Every scratch directory this file made, removed once it is done. */
const scratchDirs: string[] = [];

/** A directory under the system temporary directory, asserted to be there. */
function scratchDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-project-id-')));
  scratchDirs.push(dir);

  expect(dir.startsWith(realpathSync(tmpdir()))).toBe(true);
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe('reading the remote from git', () => {
  test('answers the origin of a repository it is pointed at', () => {
    const dir = scratchDir();
    const env = { ...process.env, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
    spawnSync('git', ['init', '-q'], { cwd: dir, env });
    spawnSync('git', ['remote', 'add', 'origin', 'git@github.com:open-tomato/rafa.git'], {
      cwd: dir,
      env,
    });

    expect(gitRemoteUrl(dir)).toBe('git@github.com:open-tomato/rafa.git');
    expect(projectId(dir)).toBe('a8785cdba525');
  });

  test('answers null in a directory no repository holds, which is the control', () => {
    const dir = scratchDir();

    expect(gitRemoteUrl(dir)).toBeNull();
    expect(projectId(dir)).toBeNull();
  });
});
