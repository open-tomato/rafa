import type { BranchPlace, StepPlacing } from './tag-next-steps.js';
import type { TagInputs, TagRefusalReason, TagRefused } from './tag.js';
import type { GitResult } from '@open-tomato/rafa/core/git';

import { describe, expect, it } from 'bun:test';

import { nextStepsOf, placedAtRoot, readBranchHolder } from './tag-next-steps.js';

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

/**
 * Steps placed as from `topLevel`, the project root at `/side`, with
 * every path in `present` there on disk and every other missing.
 */
function placing(topLevel: string | null = '/side', present: readonly string[] = ['/repo', '/side']): StepPlacing {
  return { root: '/side', seams: { readTopLevel: () => topLevel, pathExists: (path) => present.includes(path) } };
}

/** The `<command> — <why>` lines of `steps`, as the `Next:` block prints them. */
function lines(steps: readonly { readonly command: string; readonly why: string }[]): readonly string[] {
  return steps.map((step) => `${step.command} — ${step.why}`);
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
    expect(lines(nextStepsOf(refused('branch'), inputs(), null, placing())))
      .toEqual(['git switch integration, then rafa release tag — a release is tagged from integration']);
    expect(lines(nextStepsOf(refused('branch'), inputs(), { ...held, holder: null }, placing()))[0])
      .toStartWith('git switch integration');
  });

  it('names the checkout to cd into when another worktree holds the branch', () => {
    expect(lines(nextStepsOf(refused('branch'), inputs(), held, placing())))
      .toEqual(['cd /repo && rafa release tag — integration is checked out there']);
  });

  it('prints no cd when the run stands in the checkout holding the branch', () => {
    expect(lines(nextStepsOf(refused('branch'), inputs(), held, placing('/repo'))))
      .toEqual(['rafa release tag — integration is checked out there']);
  });

  it('keeps the cd when git did not answer the top-level read', () => {
    expect(nextStepsOf(refused('branch'), inputs(), held, placing(null))[0]?.command)
      .toBe('cd /repo && rafa release tag');
  });

  it('falls back to git switch when the holder git lists is not there on disk', () => {
    expect(lines(nextStepsOf(refused('branch'), inputs(), held, placing('/side', ['/side']))))
      .toEqual(['git switch integration, then rafa release tag — a release is tagged from integration']);
  });

  it('places the git switch step at the project root when the run stands elsewhere', () => {
    expect(nextStepsOf(refused('branch'), inputs(), null, placing('/elsewhere'))[0]?.command)
      .toBe('cd /side && git switch integration, then rafa release tag');
  });

  it('names pr.base and the config file read first when the branch is the default', () => {
    const steps = lines(nextStepsOf(refused('branch'), inputs({ releaseBranch: 'main' }), {
      holder: null,
      defaulted: true,
      configFile: '/side/rafa.config.ts',
    }, placing()));

    expect(steps).toHaveLength(2);
    expect(steps[0]).toStartWith('set pr.base in /side/rafa.config.ts — it is unset there, so main is the default');
    expect(steps[1]).toStartWith('git switch main');
  });

  it('gives every step of the refusal its case', () => {
    const steps = nextStepsOf(refused('branch'), inputs(), { ...held, defaulted: true }, placing());

    expect(steps.map((step) => step.case)).toEqual(['tag-branch', 'tag-branch']);
  });
});

describe('the next steps of the other refusals', () => {
  it('gives behind no step, since its sentence names the merge to run', () => {
    expect(nextStepsOf(refused('behind'), inputs(), null, placing())).toEqual([]);
  });

  it('gives every other reason exactly one step', () => {
    const reasons: readonly TagRefusalReason[] = ['version', 'tagged', 'changelog', 'git', 'receipt'];

    for (const reason of reasons) expect(nextStepsOf(refused(reason), inputs(), null, placing())).toHaveLength(1);
  });

  it('carries the case of its reason on each step', () => {
    const reasons: readonly TagRefusalReason[] = ['version', 'tagged', 'changelog', 'git', 'receipt'];

    for (const reason of reasons) {
      expect(nextStepsOf(refused(reason), inputs(), null, placing())[0]?.case).toBe(`tag-${reason}`);
    }
  });

  it('places a command step at the project root only when the run stands in another checkout', () => {
    expect(nextStepsOf(refused('tagged'), inputs(), null, placing())[0]?.command).toBe('rafa release status');
    expect(nextStepsOf(refused('tagged'), inputs(), null, placing('/repo'))[0]?.command)
      .toBe('cd /side && rafa release status');
    expect(nextStepsOf(refused('git'), inputs(), null, placing(null))[0]?.command).toBe('cd /side && git status');
  });

  it('prints an instruction that is no command without a cd', () => {
    expect(nextStepsOf(refused('version'), inputs(), null, placing('/repo'))[0]?.command).toBe('check package.json');
  });

  it('names settle and the never-released rule for a package with no changelog', () => {
    const steps = nextStepsOf(refused('changelog'), inputs({
      package: '@scope/plugin',
      version: { path: 'plugins/x/package.json', text: null, version: '0.1.0', problem: null },
      changelog: { path: 'plugins/x/CHANGELOG.md', version: null, problem: 'could not be read', absent: true },
    }), null, placing());

    expect(lines(steps)[0]).toStartWith('rafa release settle — writes plugins/x/CHANGELOG.md when @scope/plugin is released');
    expect(lines(steps)[0]).toContain('stays at 0.0.0 in plugins/x/package.json');
  });

  it('names a readability check for a changelog that is there and could not be read', () => {
    const steps = nextStepsOf(refused('changelog'), inputs({
      changelog: { path: 'CHANGELOG.md', version: null, problem: 'could not be read' },
    }), null, placing());

    expect(lines(steps)).toEqual(['check that CHANGELOG.md is readable — it is there and could not be read']);
  });

  it('names release status for a changelog that disagrees with the version', () => {
    const steps = nextStepsOf(refused('changelog'), inputs({
      changelog: { path: 'CHANGELOG.md', version: '1.1.0', problem: null },
    }), null, placing());

    expect(lines(steps)[0]).toStartWith('rafa release status');
  });
});

describe('placedAtRoot', () => {
  it('leaves the command bare in the project root and prefixes it elsewhere', () => {
    expect(placedAtRoot('git push origin v1.2.0', placing())).toBe('git push origin v1.2.0');
    expect(placedAtRoot('git push origin v1.2.0', placing('/repo'))).toBe('cd /side && git push origin v1.2.0');
  });

  it('leaves the command bare rather than drop it when the root is not there', () => {
    expect(placedAtRoot('npm publish', placing('/repo', []))).toBe('npm publish');
  });
});
