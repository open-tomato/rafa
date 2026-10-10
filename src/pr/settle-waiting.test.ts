/**
 * Tests for the settle reading (`settle-waiting.ts`): what the settle dry
 * run folded on `origin/<base>`, read over a real repository under
 * tmpdir whose one commit holds a version file, a changelog and the
 * fragments, with `origin/main` pointing at it.
 *
 * Every null case has its control over the same planted base: the
 * release turned off against the same place with it on, a base no ref
 * names against `main`, and a `level: none` fragment against a `patch`
 * one. So a null is shown to come from the rule and not from a base the
 * dry run could never have folded. `src/commands/pr/merge-cleanup.test.ts`
 * drives the same function through the follow-ups it decides.
 */
import type { GitRunner } from './git.js';
import type { SettleWaitingPlace } from './settle-waiting.js';
import type { Fragment } from '../release/fragment.js';
import type { MergeGuardSettings } from '../release/guard-merge.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { serializeFragment } from '../release/fragment.js';

import { createGitRunner } from './git.js';
import { SETTLE_REMOTE, settleWaitingOn } from './settle-waiting.js';

const RELEASE: MergeGuardSettings = {
  releaseEnabled: 'auto',
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseFragments: '.changes',
  releaseStrategy: 'semver-by-level',
  releaseHeading: '## {version} — {date}, {title}',
  prVersionCollision: 'report',
  dangerousAcceptVersionCollision: false,
};

/** Runs git in `cwd` under a fixed identity and no system config. */
function runGit(cwd: string, ...args: readonly string[]): void {
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'rafa test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'rafa test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      GIT_CONFIG_NOSYSTEM: '1',
      LC_ALL: 'C',
    },
  });
}

describe('settleWaitingOn', () => {
  const planted: string[] = [];

  afterEach(() => {
    for (const dir of planted.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * A repository at version 1.2.3 whose one commit holds one fragment
   * per level in `levels`, with `origin/main` pointing at that commit.
   */
  function plantBase(levels: readonly Fragment['level'][]): { place: SettleWaitingPlace; git: GitRunner } {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'settle-waiting-root-')));
    planted.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'other', version: '1.2.3' }));
    writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n');
    mkdirSync(join(root, '.changes'), { recursive: true });
    levels.forEach((level, index) => {
      const plan = `rafa-${String(index + 1)}`;
      const fragment = { plan, title: `Plan ${plan}`, level, notes: ['- loop: a change'] };
      writeFileSync(join(root, '.changes', `${plan}.md`), serializeFragment(fragment));
    });
    runGit(root, 'init', '--quiet', '--initial-branch=main');
    runGit(root, 'add', '-A');
    runGit(root, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '-m', 'base');
    runGit(root, 'update-ref', `refs/remotes/${SETTLE_REMOTE}/main`, 'HEAD');
    return { place: { root, base: 'main', release: RELEASE }, git: createGitRunner(root) };
  }

  it('answers the base, the fragment count and the version they fold into', () => {
    const { place, git } = plantBase(['patch', 'minor']);
    expect(settleWaitingOn(place, git)).toEqual({ base: 'main', fragments: 2, version: '1.3.0' });
  });

  it('answers null where release.enabled is false, over the base that folds with it on', () => {
    const { place, git } = plantBase(['patch']);
    expect(settleWaitingOn({ ...place, release: { ...RELEASE, releaseEnabled: false } }, git)).toBeNull();
    expect(settleWaitingOn(place, git)).toEqual({ base: 'main', fragments: 1, version: '1.2.4' });
  });

  it('asks git nothing where the release is off', () => {
    const { place } = plantBase(['patch']);
    const calls: string[][] = [];
    const git: GitRunner = (args) => {
      calls.push([...args]);
      return { ok: true, stdout: '', stderr: '' };
    };
    expect(settleWaitingOn({ ...place, release: { ...RELEASE, releaseEnabled: false } }, git)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('answers null where only level none fragments wait, and a version once a patch waits beside them', () => {
    expect(settleWaitingOn(...placeAndGit(plantBase(['none'])))).toBeNull();
    expect(settleWaitingOn(...placeAndGit(plantBase(['none', 'patch'])))?.version).toBe('1.2.4');
  });

  it('answers null where the remote holds no such base, over the repository whose main folds', () => {
    const { place, git } = plantBase(['patch']);
    expect(settleWaitingOn({ ...place, base: 'trunk' }, git)).toBeNull();
    expect(settleWaitingOn(place, git)?.base).toBe('main');
  });
});

/** A planted base as the two arguments {@link settleWaitingOn} takes. */
function placeAndGit(planted: { place: SettleWaitingPlace; git: GitRunner }): [SettleWaitingPlace, GitRunner] {
  return [planted.place, planted.git];
}
