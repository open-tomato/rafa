import type { BranchPlace } from './tag-next-steps.js';
import type { TagInputs, TagRefusalReason, TagRefused } from './tag.js';
import type { GitResult } from '@open-tomato/rafa/core/git';

import { describe, expect, it } from 'bun:test';

import { nextStepsOf, readBranchHolder } from './tag-next-steps.js';

/** A git that answered `stdout`. */
function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** The readings of a root release at 1.2.0 from `integration`, narrowed by `over`. */
function inputs(over: Partial<TagInputs> = {}): TagInputs {
  return {
    releaseBranch: 'integration',
    branch: { branch: null, problem: 'no branch is checked out, so this is a detached HEAD' },
    package: null,
    version: { path: 'package.json', text: null, version: '1.2.0', problem: null },
    changelog: { path: 'CHANGELOG.md', version: '1.2.0', problem: null },
    tags: { tags: [], latest: null, problem: null },
    release: null,
    receipt: null,
    ...over,
  };
}

/** A refusal for `reason`. */
function refused(reason: TagRefusalReason): TagRefused {
  return { kind: 'refused', reason, message: 'refused' };
}

/** Two worktrees, the main one on `integration`, as `git worktree list --porcelain` prints them. */
const PORCELAIN = [
  'worktree /repo',
  'HEAD 713f2c19',
  'branch refs/heads/integration',
  '',
  'worktree /repo/.claude/worktrees/side',
  'HEAD 713f2c19',
  'detached',
  '',
].join('\n');

describe('the worktree holding the release branch', () => {
  it('answers null when no worktree has the branch checked out', () => {
    expect(readBranchHolder(() => said(PORCELAIN), 'main')).toBeNull();
  });

  it('answers null when git did not answer', () => {
    expect(readBranchHolder(() => ({ ok: false, stdout: '', stderr: 'fatal' }), 'integration')).toBeNull();
  });

  it('answers the path of the worktree that has the branch checked out', () => {
    expect(readBranchHolder(() => said(PORCELAIN), 'integration')).toBe('/repo');
  });

  it('does not read a branch whose name only starts the same', () => {
    expect(readBranchHolder(() => said(PORCELAIN), 'integ')).toBeNull();
  });
});

describe('the next steps of a branch refusal', () => {
  const held: BranchPlace = { holder: '/repo', defaulted: false, configFile: '/repo/rafa.config.ts' };

  it('names git switch when no checkout holds the branch, or none was read', () => {
    expect(nextStepsOf(refused('branch'), inputs(), null))
      .toEqual(['git switch integration, then rafa release tag — a release is tagged from integration']);
    expect(nextStepsOf(refused('branch'), inputs(), { ...held, holder: null })[0]).toStartWith('git switch integration');
  });

  it('names the checkout to cd into when another worktree holds the branch', () => {
    expect(nextStepsOf(refused('branch'), inputs(), held))
      .toEqual(['cd /repo && rafa release tag — integration is checked out there']);
  });

  it('names pr.base and the config file read first when the branch is the default', () => {
    const steps = nextStepsOf(refused('branch'), inputs({ releaseBranch: 'main' }), {
      holder: null,
      defaulted: true,
      configFile: '/side/rafa.config.ts',
    });

    expect(steps).toHaveLength(2);
    expect(steps[0]).toStartWith('set pr.base in /side/rafa.config.ts — it is unset there, so main is the default');
    expect(steps[1]).toStartWith('git switch main');
  });
});

describe('the next steps of the other refusals', () => {
  it('gives behind no step, since its sentence names the merge to run', () => {
    expect(nextStepsOf(refused('behind'), inputs(), null)).toEqual([]);
  });

  it('gives every other reason exactly one step', () => {
    const reasons: readonly TagRefusalReason[] = ['version', 'tagged', 'changelog', 'git', 'receipt'];

    for (const reason of reasons) expect(nextStepsOf(refused(reason), inputs(), null)).toHaveLength(1);
  });

  it('names settle and the never-released rule for a package with no changelog', () => {
    const steps = nextStepsOf(refused('changelog'), inputs({
      package: '@scope/plugin',
      version: { path: 'plugins/x/package.json', text: null, version: '0.1.0', problem: null },
      changelog: { path: 'plugins/x/CHANGELOG.md', version: null, problem: 'could not be read', absent: true },
    }), null);

    expect(steps[0]).toStartWith('rafa release settle — writes plugins/x/CHANGELOG.md when @scope/plugin is released');
    expect(steps[0]).toContain('stays at 0.0.0 in plugins/x/package.json');
  });

  it('names a readability check for a changelog that is there and could not be read', () => {
    const steps = nextStepsOf(refused('changelog'), inputs({
      changelog: { path: 'CHANGELOG.md', version: null, problem: 'could not be read' },
    }), null);

    expect(steps).toEqual(['check that CHANGELOG.md is readable — it is there and could not be read']);
  });

  it('names release status for a changelog that disagrees with the version', () => {
    const steps = nextStepsOf(refused('changelog'), inputs({
      changelog: { path: 'CHANGELOG.md', version: '1.1.0', problem: null },
    }), null);

    expect(steps[0]).toStartWith('rafa release status');
  });
});
