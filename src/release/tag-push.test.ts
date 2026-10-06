/**
 * Tests for `pushTag` and `trackedRemote` (`tag-push.ts`), over real
 * repositories: a bare origin, a second bare remote the release branch
 * can track instead, and a clone holding a lightweight tag.
 *
 * Each push is read back off the bare repository it was meant for,
 * never off the answer alone, and the remote case is paired: the tag
 * lands on the tracked remote AND not on `origin`, so a push that went
 * to `origin` whatever the branch tracked would redden. The refused
 * push is a `pre-receive` hook in the origin, paired with the same
 * origin without it taking the tag, and its sentence is held to carry
 * the hook's words and no porcelain `Done` line.
 */
import type { GitRunner } from '../pr/git.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/git.js';
import { gitIdentityEnv } from '../tests/git-identity.js';

import { pushTag, trackedRemote } from './tag-push.js';
import { RELEASE_REMOTE } from './version.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-tag-push-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The tag every case pushes. */
const TAG = 'v0.5.0';

/** The words the refusing hook prints. */
const HOOK_WORDS = 'tags are frozen on this origin';

/** A bare origin, a second bare remote, and a clone on `main` holding {@link TAG}. */
interface World {
  readonly origin: string;
  readonly upstream: string;
  readonly clone: string;
  /** Runs git in `cwd` under an isolated environment, answering stdout trimmed. */
  readonly git: (cwd: string, args: readonly string[]) => string;
  /** The runner `pushTag` is handed, in the clone. */
  readonly runner: GitRunner;
}

/** Builds a {@link World}; `main` tracks nothing until a case says so. */
function world(): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const origin = join(dir, 'origin.git');
  const upstream = join(dir, 'upstream.git');
  const clone = join(dir, 'clone');
  mkdirSync(home, { recursive: true });
  const env = {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    ...gitIdentityEnv(),
    LC_ALL: 'C',
  };
  const git = (cwd: string, args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  for (const bare of [origin, upstream]) {
    git(dir, ['init', '-q', '--bare', '--initial-branch=main', bare]);
    git(bare, ['config', 'core.hooksPath', join(bare, 'hooks')]);
  }
  git(dir, ['init', '-q', '--initial-branch=main', clone]);
  git(clone, ['remote', 'add', 'origin', origin]);
  git(clone, ['remote', 'add', 'upstream', upstream]);
  writeFileSync(join(clone, 'package.json'), '{"name":"demo","version":"0.5.0"}\n');
  git(clone, ['add', '-A']);
  git(clone, ['commit', '-q', '-m', 'chore: release 0.5.0']);
  git(clone, ['tag', TAG]);
  return { origin, upstream, clone, git, runner: createGitRunner(clone) };
}

/** The tags `bare` holds, one per line. */
function tagsOn(w: World, bare: string): string {
  return w.git(bare, ['tag', '--list']);
}

/** Plants a `pre-receive` hook in `bare` that prints {@link HOOK_WORDS} and declines. */
function refuseIn(bare: string): void {
  const hook = join(bare, 'hooks', 'pre-receive');
  mkdirSync(join(bare, 'hooks'), { recursive: true });
  writeFileSync(hook, `#!/bin/sh\necho "${HOOK_WORDS}" >&2\nexit 1\n`);
  chmodSync(hook, 0o755);
}

describe('the remote a tag is pushed to', () => {
  it('is origin when the release branch tracks none', () => {
    const w = world();

    expect(trackedRemote(w.runner, 'main')).toBe(RELEASE_REMOTE);
  });

  it('is the remote the release branch tracks, when it tracks one', () => {
    const w = world();
    w.git(w.clone, ['config', 'branch.main.remote', 'upstream']);

    expect(trackedRemote(w.runner, 'main')).toBe('upstream');
  });

  it('is origin when the release branch tracks a local branch, which git spells as a dot', () => {
    const w = world();
    w.git(w.clone, ['config', 'branch.main.remote', '.']);

    expect(trackedRemote(w.runner, 'main')).toBe(RELEASE_REMOTE);
  });
});

describe('pushing the tag', () => {
  it('puts the tag on origin, naming the commit the local tag names', () => {
    const w = world();
    // The control: the origin holds no tag before the push.
    expect(tagsOn(w, w.origin)).toBe('');

    const pushed = pushTag(w.runner, TAG, 'main');

    expect(pushed).toEqual({ outcome: 'pushed', exitCode: 0, tag: TAG, remote: 'origin', sentence: `${TAG} is pushed to origin` });
    expect(tagsOn(w, w.origin)).toBe(TAG);
    expect(w.git(w.origin, ['rev-parse', `${TAG}^{commit}`])).toBe(w.git(w.clone, ['rev-parse', `${TAG}^{commit}`]));
  });

  it('pushes to the remote the release branch tracks, and not to origin', () => {
    const w = world();
    w.git(w.clone, ['config', 'branch.main.remote', 'upstream']);

    const pushed = pushTag(w.runner, TAG, 'main');

    expect(pushed.outcome).toBe('pushed');
    expect(pushed.remote).toBe('upstream');
    expect(tagsOn(w, w.upstream)).toBe(TAG);
    expect(tagsOn(w, w.origin)).toBe('');
  });

  it('answers failed with exit 1 and the hook\'s words when the origin refuses, keeping the local tag', () => {
    const w = world();
    refuseIn(w.origin);

    const pushed = pushTag(w.runner, TAG, 'main');

    expect(pushed.outcome).toBe('failed');
    expect(pushed.exitCode).toBe(1);
    expect(pushed.sentence).toContain(`${TAG} is written and kept locally, but could not be pushed to origin`);
    expect(pushed.sentence).toContain(`git push origin ${TAG}`);
    expect(pushed.sentence).toContain(HOOK_WORDS);
    expect(pushed.sentence).toContain('[remote rejected] (pre-receive hook declined)');
    expect(pushed.sentence.split('\n').some((line) => line.trim() === 'Done')).toBe(false);
    expect(tagsOn(w, w.origin)).toBe('');
    expect(w.git(w.clone, ['tag', '--list'])).toBe(TAG);
  });

  it('answers failed when the remote the branch tracks does not exist, naming what git said', () => {
    const w = world();
    w.git(w.clone, ['config', 'branch.main.remote', 'gone']);

    const pushed = pushTag(w.runner, TAG, 'main');

    expect(pushed.outcome).toBe('failed');
    expect(pushed.remote).toBe('gone');
    expect(pushed.sentence).toContain('gone');
    expect(w.git(w.clone, ['tag', '--list'])).toBe(TAG);
  });
});
