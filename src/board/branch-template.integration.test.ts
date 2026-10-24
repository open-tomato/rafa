/**
 * Integration test of the `naming.branch` template over a real bare
 * repository holding `work/rafa-20-x` with a claim commit, read by a
 * clone of it.
 *
 * `scanClaimBranches` under `work/{stub}` handed to
 * `createRoadmapReadings` answers the branch for issue 20 and its claim
 * as held, and the drift check through a scan made under the template
 * names no `label-without-branch` for a labelled issue 20. Each reading
 * sits beside the control under the default template, which finds no
 * branch and so reads nothing and names the drift.
 */
import type { SpecIssue } from './issue.js';
import type { BoardIssue } from './roadmap-board.js';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { makeOwnershipCommit, pushNewClaimBranch } from '@open-tomato/rafa/claims/git';
import { CLAIMED_LABEL } from '@open-tomato/rafa/claims/stale';

import { findDrift } from '../claims/drift.js';
import { createGitRunner } from '../pr/index.js';

import { createRoadmapReadings, DEFAULT_REMOTE, scanClaimBranches } from './roadmap.js';

const TEMPLATE = 'work/{stub}';
const BRANCH = 'work/rafa-20-x';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-board-template-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

type Git = ReturnType<typeof createGitRunner>;

/** Runs git and throws with what it said when it fails: a fixture step, not a reading. */
function must(git: Git, args: readonly string[]): void {
  const result = git(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

/** A bare remote holding `main` and `work/rafa-20-x` with a claim commit, and a clone of it. */
function plantClone(): Git {
  const originPath = join(scope, 'origin.git');
  must(createGitRunner(scope), ['init', '--quiet', '--bare', '--initial-branch=main', originPath]);
  const dir = join(scope, 'clone');
  must(createGitRunner(scope), ['clone', '--quiet', originPath, dir]);
  const git = createGitRunner(dir);
  must(git, ['config', 'user.name', 'device']);
  must(git, ['config', 'user.email', 'device@example.invalid']);
  must(git, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'kept.txt'), 'kept\n', 'utf8');
  must(git, ['add', '--all']);
  must(git, ['commit', '--quiet', '-m', 'root']);
  must(git, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  const made = makeOwnershipCommit(git, 'HEAD', { action: 'claim', issue: 20, store: 'store-a' });
  if (!made.ok) throw new Error(made.reason);
  const pushed = pushNewClaimBranch(git, made.sha, BRANCH, TEMPLATE);
  if (pushed.outcome !== 'pushed') throw new Error(`claim push: ${pushed.outcome}`);
  return git;
}

const labelled: BoardIssue = {
  number: 20, title: 'issue 20', body: '', state: 'OPEN', stateReason: null, labels: [CLAIMED_LABEL], type: 'code', module: '',
};

const specIssue: SpecIssue = {
  number: 20, title: 'issue 20', body: '', state: 'OPEN', labels: ['type:spec', CLAIMED_LABEL], author: 'octocat',
};

describe('the branch template over a real bare repository', () => {
  const git = plantClone();
  const readingsOver = (template?: string): ReturnType<typeof createRoadmapReadings> => createRoadmapReadings({
    issues: () => Promise.resolve(specIssue),
    branches: template === undefined
      ? scanClaimBranches(git)
      : scanClaimBranches(git, DEFAULT_REMOTE, template),
    pullRequests: () => Promise.resolve([]),
  });

  it('answers the branch for issue 20 and its claim as held under work/{stub}', async () => {
    const readings = readingsOver(TEMPLATE);

    const claim = await readings.branchClaimFor(20);

    expect(readings.branchFor(20)).toEndWith(BRANCH);
    expect(claim?.branch).toEndWith(BRANCH);
    expect(claim?.claim).toMatchObject({ state: 'held', owner: 'store-a' });
  });

  it('answers no branch and no claim under the default template', async () => {
    const readings = readingsOver();

    expect([readings.branchFor(20), await readings.branchClaimFor(20)]).toEqual([null, null]);
  });

  it('names no label-without-branch for the labelled issue 20 through a scan made under the template', () => {
    const report = findDrift({ issues: [labelled], checklists: [], branches: () => scanClaimBranches(git, DEFAULT_REMOTE, TEMPLATE) });

    expect(report.findings).toEqual([]);
    expect(report.notices).toEqual([]);
  });

  it('names label-without-branch for the labelled issue 20 through a scan made under the default template', () => {
    const report = findDrift({ issues: [labelled], checklists: [], branches: () => scanClaimBranches(git) });

    expect(report.findings.map((finding) => [finding.kind, finding.issue])).toEqual([['label-without-branch', 20]]);
  });
});
