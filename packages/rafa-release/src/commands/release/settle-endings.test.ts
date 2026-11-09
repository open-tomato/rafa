import type { SettleEndingPlace } from './settle-endings.js';
import type { ReleaseStep } from './step-cases.js';
import type { SettleDelivered, SettleTagOutcome } from '../../release/settle-tag.js';
import type { SettleBuilt, SettleFolded, SettleNothing } from '../../release/settle.js';
import type { PullRequestSummary } from '@open-tomato/rafa/pr/types';

import { describe, expect, it } from 'bun:test';

import { NOTHING_TO_TAG, renderSettleEnding, settleEndedOf, settleEnding, settleNext, withSettleEnding } from './settle-endings.js';
import { dryRunResult, settledResult } from './settle.js';

/** Where the literal settles ran: `/side`, a linked worktree, its project root. */
const ROOT = '/side';

/**
 * The place of a settle from `integration`, held by `holder`, run from
 * `topLevel`, with every path in `present` there on disk.
 */
function place(holder: string | null, topLevel: string | null = ROOT, present: readonly string[] = ['/repo', ROOT]): SettleEndingPlace {
  return {
    branch: 'integration',
    remote: 'origin',
    holder,
    placing: { root: ROOT, seams: { readTopLevel: () => topLevel, pathExists: (path) => present.includes(path) } },
  };
}

/** The basis every literal reading shares. */
const BASIS = { strategy: 'semver-by-level', commit: 'a'.repeat(40), baseVersion: '0.4.0', fragments: [] } as const;

/** A reading with no fragment that ships a release. */
const NOTHING: SettleNothing = { ...BASIS, outcome: 'nothing' };

/** A folded reading moving the root from 0.4.0 to 0.5.0. */
const FOLDED: SettleFolded = {
  ...BASIS,
  outcome: 'folded',
  units: [{
    package: null,
    dir: '.',
    versionFile: 'package.json',
    changelog: 'CHANGELOG.md',
    baseVersion: '0.4.0',
    version: '0.5.0',
    section: '## 0.5.0',
    changelogMissing: false,
    fragments: [],
  }],
  lock: null,
};

/** The build of {@link FOLDED}. */
const BUILT: SettleBuilt = {
  ...FOLDED,
  outcome: 'built',
  release: 'c'.repeat(40),
  deleted: [],
  insertPoints: [],
  createdChangelog: [],
};

/** A tag step that was not meant to write. */
const NO_TAG: SettleTagOutcome = { outcome: 'skipped', exitCode: 0, reason: 'manual', sentence: null };

/** The release pull request a `pr` delivery opened. */
const PULL: PullRequestSummary = {
  number: 7,
  title: 'chore: release 0.5.0',
  url: 'https://example.invalid/pull/7',
  state: 'open',
  headRefName: 'rafa/release',
  baseRefName: 'integration',
  author: { login: 'someone', isBot: false },
  isCrossRepository: false,
  updatedAt: '2026-11-08T00:00:00Z',
};

/** A push that landed. */
const PUSHED: SettleDelivered = { delivery: 'push', outcome: { outcome: 'pushed', exitCode: 0, attempts: 1, build: BUILT } };

/** A pull request that was opened. */
const DELIVERED: SettleDelivered = {
  delivery: 'pr',
  outcome: { outcome: 'delivered', exitCode: 0, build: BUILT, head: BUILT.release, pushed: true, pull: PULL, action: 'opened' },
};

describe('settleEndedOf, which ending a run reached', () => {
  it('reads a landed or superseded push, a delivered pull request and nothing to settle', () => {
    const superseded: SettleDelivered = {
      delivery: 'push',
      outcome: { outcome: 'superseded', exitCode: 0, attempts: 1, build: BUILT, base: 'd'.repeat(40), winner: null, sentence: 'another settle released them' },
    };
    const unsettled: SettleDelivered = { delivery: 'push', outcome: { outcome: 'unsettled', exitCode: 0, attempts: 1, build: NOTHING } };
    expect(settleEndedOf(settledResult(PUSHED, NO_TAG, 'origin/integration', 'integration'))).toEqual({ kind: 'push', tagged: false });
    expect(settleEndedOf(settledResult(superseded, NO_TAG, 'origin/integration', 'integration'))).toEqual({ kind: 'push', tagged: false });
    expect(settleEndedOf(settledResult(DELIVERED, NO_TAG, 'origin/integration', 'integration'))).toEqual({ kind: 'pr', pull: 7 });
    expect(settleEndedOf(settledResult(unsettled, NO_TAG, 'origin/integration', 'integration'))).toEqual({ kind: 'nothing' });
  });

  it('reads a push release.tag tagged as tagged, so its tag step is left out', () => {
    const tag: SettleTagOutcome = { outcome: 'tagged', exitCode: 0, tags: ['v0.5.0'], commit: BUILT.release, sentence: 'v0.5.0 names it' };
    expect(settleEndedOf(settledResult(PUSHED, tag, 'origin/integration', 'integration'))).toEqual({ kind: 'push', tagged: true });
  });

  it('reads a dry run that would fold and one with nothing to settle', () => {
    expect(settleEndedOf(dryRunResult(FOLDED, 'origin/integration', 'integration'))).toEqual({ kind: 'fold' });
    expect(settleEndedOf(dryRunResult(NOTHING, 'origin/integration', 'integration'))).toEqual({ kind: 'nothing' });
  });

  it('gives a refused run no ending, a delivery refusal and a tag failure alike', () => {
    const protectedPush: SettleDelivered = {
      delivery: 'push',
      outcome: { outcome: 'protected', exitCode: 1, attempts: 1, build: BUILT, sentence: 'integration is protected' },
    };
    const failedTag: SettleTagOutcome = { outcome: 'failed', exitCode: 1, tag: 'v0.5.0', commit: BUILT.release, written: true, tags: [], sentence: 'no push' };
    expect(settleEndedOf(settledResult(protectedPush, NO_TAG, 'origin/integration', 'integration'))).toEqual({ kind: 'none' });
    expect(settleEndedOf(settledResult(PUSHED, failedTag, 'origin/integration', 'integration'))).toEqual({ kind: 'none' });
  });
});

describe('settleEnding, the steps each ending names', () => {
  it('ends a push in the holding checkout with the bare merge and tag', () => {
    const ending = settleEnding({ kind: 'push', tagged: false }, place(ROOT));
    expect(renderSettleEnding(ending, false)).toEqual([
      'Next:',
      '  git merge --ff-only origin/integration — the release commit is on origin/integration; this brings integration up to it',
      '  rafa release tag --push — tags the release commit and pushes the tag',
    ]);
  });

  it('places a push\'s steps with cd at the checkout holding the branch when the run stood elsewhere', () => {
    const ending = settleEnding({ kind: 'push', tagged: false }, place('/repo'));
    expect(ending.steps.map((step) => step.command)).toEqual([
      'cd /repo && git merge --ff-only origin/integration',
      'cd /repo && rafa release tag --push',
    ]);
  });

  it('leaves the tag step out of a push release.tag already tagged', () => {
    const ending = settleEnding({ kind: 'push', tagged: true }, place(ROOT));
    expect(ending.steps.map((step) => step.command)).toEqual(['git merge --ff-only origin/integration']);
  });

  it('precedes the steps with git switch when no checkout holds the branch', () => {
    const ending = settleEnding({ kind: 'push', tagged: false }, place(null));
    expect(ending.steps.map((step) => step.command)).toEqual([
      'git switch integration',
      'git merge --ff-only origin/integration',
      'rafa release tag --push',
    ]);
  });

  it('falls back to git switch when the holder git lists is gone from disk', () => {
    const ending = settleEnding({ kind: 'push', tagged: false }, place('/pruned'));
    expect(ending.steps.map((step) => step.command)).toEqual([
      'git switch integration',
      'git merge --ff-only origin/integration',
      'rafa release tag --push',
    ]);
  });

  it('keeps the cd on every step when git did not answer the top-level read', () => {
    const ending = settleEnding({ kind: 'push', tagged: false }, place(null, null));
    expect(ending.steps.map((step) => step.command)).toEqual([
      'cd /side && git switch integration',
      'cd /side && git merge --ff-only origin/integration',
      'cd /side && rafa release tag --push',
    ]);
  });

  it('ends a pull request with rafa pr wait, then the merge and the tag once it merges', () => {
    const ending = settleEnding({ kind: 'pr', pull: 7 }, place('/repo'));
    expect(renderSettleEnding(ending, false)).toEqual([
      'Next:',
      '  rafa pr wait 7 — waits for the checks of release pull request #7; merge it once they pass',
      '  cd /repo && git merge --ff-only origin/integration — once #7 merges, the release commit is on origin/integration; this brings integration up to it',
      '  cd /repo && rafa release tag --push — once #7 merges, tags the release commit and pushes the tag',
    ]);
  });

  it('ends a dry run that would fold with rafa release settle, without --dry-run', () => {
    const ending = settleEnding({ kind: 'fold' }, place(ROOT));
    expect(renderSettleEnding(ending, false)).toEqual([
      'Next:',
      '  rafa release settle — the dry run wrote nothing; this folds the fragments and delivers the release',
    ]);
  });

  it('ends nothing to settle with its sentence and no step', () => {
    const ending = settleEnding({ kind: 'nothing' }, place(ROOT));
    expect(ending.steps).toEqual([]);
    expect(renderSettleEnding(ending, false)).toEqual([NOTHING_TO_TAG]);
    expect(NOTHING_TO_TAG).toBe('Nothing to tag either: every unit keeps its version.');
  });

  it('gives a refused run no lines and no steps', () => {
    const ending = settleEnding({ kind: 'none' }, place(ROOT));
    expect(renderSettleEnding(ending, true)).toEqual([]);
    expect(settleNext(ending, true)).toEqual([]);
  });
});

describe('the skill line and the next list under hints.skills', () => {
  it('follows each step with its outcome\'s skill line when the switch is on', () => {
    expect(renderSettleEnding(settleEnding({ kind: 'push', tagged: true }, place(ROOT)), true)).toEqual([
      'Next:',
      '  git merge --ff-only origin/integration — the release commit is on origin/integration; this brings integration up to it',
      '    skill: rafa-release › settle-push',
    ]);
    expect(renderSettleEnding(settleEnding({ kind: 'pr', pull: 7 }, place(ROOT)), true).filter((line) => line.includes('skill:'))).toEqual([
      '    skill: rafa-release › settle-pr',
      '    skill: rafa-release › settle-pr',
      '    skill: rafa-release › settle-pr',
    ]);
  });

  it('follows the nothing sentence with its skill line when on, and prints none when off', () => {
    const ending = settleEnding({ kind: 'nothing' }, place(ROOT));
    expect(renderSettleEnding(ending, true)).toEqual([NOTHING_TO_TAG, '  skill: rafa-release › settle-nothing']);
    expect(renderSettleEnding(ending, false)).toEqual([NOTHING_TO_TAG]);
  });

  it('prints no skill line for the dry run\'s step, which has no case', () => {
    expect(renderSettleEnding(settleEnding({ kind: 'fold' }, place(ROOT)), true)).toHaveLength(2);
  });

  it('carries the steps as next entries, skill null while the switch is off', () => {
    const ending = settleEnding({ kind: 'push', tagged: true }, place(ROOT));
    const step: ReleaseStep = {
      command: 'git merge --ff-only origin/integration',
      why: 'the release commit is on origin/integration; this brings integration up to it',
      case: 'settle-push',
    };
    expect(settleNext(ending, false)).toEqual([{ ...step, skill: null }]);
    expect(settleNext(ending, true)).toEqual([{ ...step, skill: 'rafa-release › settle-push' }]);
  });

  it('appends the ending to a result\'s lines and carries it as its next list', () => {
    const result = settledResult(PUSHED, NO_TAG, 'origin/integration', 'integration');
    expect(result.next).toEqual([]);
    const ended = withSettleEnding(result, settleEnding(settleEndedOf(result), place(ROOT)), false);
    expect(ended.lines.slice(0, result.lines.length)).toEqual([...result.lines]);
    expect(ended.lines.slice(result.lines.length)).toEqual([
      'Next:',
      '  git merge --ff-only origin/integration — the release commit is on origin/integration; this brings integration up to it',
      '  rafa release tag --push — tags the release commit and pushes the tag',
    ]);
    expect(ended.next.map((entry) => entry.command)).toEqual(['git merge --ff-only origin/integration', 'rafa release tag --push']);
  });
});
