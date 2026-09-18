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
} from './project-id.js';

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
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
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
