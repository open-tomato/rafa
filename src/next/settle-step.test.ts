/**
 * Tests for the settle step `rafa next` reads after a merge
 * (`settle-step.ts`): the state it answers, the two actions it follows,
 * a reading that throws warned about rather than thrown, the reader
 * `openNextSources` composes over a planted base, and how the action
 * table and the `--yes` ceiling meet the `settle` id.
 *
 * What the chain DOES with the step — puts it after a merge, asks it,
 * stops on it — is `src/commands/next-settle.test.ts`, over
 * `runNextChain` and the dispatched command.
 *
 * ## The controls
 *
 *  - The reader over a planted base that names settle is read beside
 *    the same base with only a `none` fragment, with the release off,
 *    and with another base, each of which must answer null: a reader
 *    that answered every base would pass the first alone.
 *  - `followsMerge` is read over every action id, so an id added to the
 *    set by mistake reads as a wrong list rather than passing a check
 *    that the two merges are among them.
 *  - The ceiling is read for `settle` under bare `--yes` AND under a
 *    list naming it, so a bare `--yes` that allowed it would fail.
 */
import type { SettlePlace } from './settle-step.js';
import type { NextActionId } from './state.js';
import type { Fragment } from '../release/fragment.js';
import type { MergeGuardSettings } from '../release/guard-merge.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/index.js';
import { serializeFragment } from '../release/fragment.js';

import { actionInvocation, NEXT_COMMAND_ACTIONS } from './actions.js';
import { allowedUnasked, BARE_YES_ACTIONS, readYesCeiling, YES_ACTIONS, YES_FLAG } from './ceiling.js';
import { nextQuestion } from './hint.js';
import { proposalLine } from './lines.js';
import {
  followsMerge,
  MERGE_ACTIONS,
  readSettleAfterMerge,
  SETTLE_STATE_ID,
  settleReaderFor,
  settleState,
} from './settle-step.js';

/** Every action id a state can carry, spelled out. */
const EVERY_ACTION: readonly NextActionId[] = [
  'none',
  'sync',
  'resume',
  'wait',
  'triage',
  'merge',
  'merge-unchecked',
  'start',
  'plan',
  'unblock',
  'ready',
  'settle',
  'hop',
  'home',
];

/** The release settings the reader reads: on under `auto`, over the default files. */
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

describe('the state the settle step answers', () => {
  it('names one fragment, the base and the version, and carries the settle action', () => {
    const state = settleState({ base: 'main', fragments: 1, version: '1.2.4' });

    expect(state).toEqual({
      id: SETTLE_STATE_ID,
      action: 'settle',
      reading: '1 fragment waits on `main` and folds into 1.2.4',
      proposal: 'settle the fragments on `main` into 1.2.4',
      pullRequest: null,
      issue: null,
      planStub: null,
      planPath: null,
      problems: [],
    });
    expect(SETTLE_STATE_ID).toBe('fragments-waiting');
  });

  it('says several fragments in the plural', () => {
    expect(settleState({ base: 'trunk', fragments: 3, version: '2.0.0' }).reading)
      .toBe('3 fragments wait on `trunk` and fold into 2.0.0');
  });

  it('is proposed as rafa release settle with no words, and asked over its proposal', () => {
    const state = settleState({ base: 'main', fragments: 2, version: '0.26.0' });
    const invocation = actionInvocation(state);

    expect(invocation).toEqual({ action: 'settle', command: 'release settle', argv: [] });
    expect(proposalLine(state, invocation)).toBe('👉 settle the fragments on `main` into 0.26.0 — rafa release settle');
    expect(nextQuestion(state)).toBe('Settle the fragments on `main` into 0.26.0? [y/N] ');
  });
});

describe('the actions the step follows', () => {
  it('follows merge and merge-unchecked, and no other action id', () => {
    expect(EVERY_ACTION.filter((action) => followsMerge(action))).toEqual(['merge', 'merge-unchecked']);
    expect([...MERGE_ACTIONS]).toEqual(['merge', 'merge-unchecked']);
  });
});

describe('readSettleAfterMerge', () => {
  it('answers the settle state where the reader folded, warning nothing', () => {
    const warned: string[] = [];

    const state = readSettleAfterMerge(() => ({ base: 'main', fragments: 1, version: '1.2.4' }), (line) => warned.push(line));

    expect(state?.action).toBe('settle');
    expect(warned).toEqual([]);
  });

  it('answers null where nothing folds, warning nothing', () => {
    const warned: string[] = [];

    expect(readSettleAfterMerge(() => null, (line) => warned.push(line))).toBeNull();
    expect(warned).toEqual([]);
  });

  it('warns and answers null where the reading throws, rather than failing the merge that landed', () => {
    const warned: string[] = [];

    const state = readSettleAfterMerge(() => {
      throw new Error('git could not read origin/main');
    }, (line) => warned.push(line));

    expect(state).toBeNull();
    expect(warned).toEqual([
      'the fragments waiting on the base could not be read after the merge, so rafa next proposes no settle:'
      + ' git could not read origin/main',
    ]);
  });
});

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

describe('settleReaderFor, over a planted base', () => {
  const planted: string[] = [];

  afterEach(() => {
    for (const dir of planted.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * A project root whose one commit holds a `package.json` at 1.2.3, a
   * changelog and one fragment per level in `levels`, with
   * `origin/main` at that commit as a pull after a merge leaves it.
   */
  function plantBase(levels: readonly string[], over: Partial<MergeGuardSettings> = {}): SettlePlace {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'settle-step-root-')));
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'settle-step-home-')));
    planted.push(root, home);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'other', version: '1.2.3' }));
    writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n');
    mkdirSync(join(root, '.changes'), { recursive: true });
    levels.forEach((level, index) => {
      const plan = `rafa-${String(index + 1)}`;
      const fragment = { plan, title: `Plan ${plan}`, level: level as Fragment['level'], notes: ['- loop: a change'] };
      writeFileSync(join(root, '.changes', `${plan}.md`), serializeFragment(fragment));
    });
    runGit(root, 'init', '--quiet', '--initial-branch=main');
    runGit(root, 'add', '-A');
    runGit(root, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '-m', 'base');
    runGit(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    return { root, home, base: 'main', config: { ...RELEASE, ...over } };
  }

  it('answers the fragments waiting on origin/main and the version they fold into', () => {
    const place = plantBase(['patch', 'minor']);

    expect(settleReaderFor(place, createGitRunner(place.root))()).toEqual({ base: 'main', fragments: 2, version: '1.3.0' });
  });

  it('answers null where only a level none fragment waits, beside the base that folds', () => {
    const place = plantBase(['none']);

    expect(settleReaderFor(place, createGitRunner(place.root))()).toBeNull();
  });

  it('answers null with the release off, over the same base that folds with it on', () => {
    const place = plantBase(['patch'], { releaseEnabled: false });
    const git = createGitRunner(place.root);

    expect(settleReaderFor(place, git)()).toBeNull();
    expect(settleReaderFor({ ...place, config: RELEASE }, git)()).toEqual({ base: 'main', fragments: 1, version: '1.2.4' });
  });

  it('answers null where origin/<base> names no commit', () => {
    const place = plantBase(['patch']);

    expect(settleReaderFor({ ...place, base: 'trunk' }, createGitRunner(place.root))()).toBeNull();
  });
});

describe('the settle id under --yes', () => {
  it('is an id a list may name, and bare --yes leaves it out, since it pushes to the base', () => {
    expect(NEXT_COMMAND_ACTIONS).toContain('settle');
    expect(YES_ACTIONS).toContain('settle');
    expect(BARE_YES_ACTIONS).not.toContain('settle');
    expect(allowedUnasked('settle', readYesCeiling({ [YES_FLAG]: true }, 'usage'))).toBe(false);
  });

  it('runs unasked under a list naming it, and is asked under no --yes at all', () => {
    expect(readYesCeiling({ [YES_FLAG]: 'merge,settle' }, 'usage')).toEqual(['merge', 'settle']);
    expect(allowedUnasked('settle', readYesCeiling({ [YES_FLAG]: 'settle' }, 'usage'))).toBe(true);
    expect(allowedUnasked('settle', readYesCeiling({ [YES_FLAG]: 'merge' }, 'usage'))).toBe(false);
    expect(allowedUnasked('settle', null)).toBe(false);
  });
});
