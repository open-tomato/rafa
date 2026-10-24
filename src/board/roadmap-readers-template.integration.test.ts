/**
 * Integration test of the four roadmap readers under the `naming.branch`
 * template, over one real bare repository whose remote holds
 * `work/rafa-20-x` with a claim commit, read by a clone of it.
 *
 * Under `work/{stub}`, `readLineRows` shows `branch` in the `has` column
 * of issue 20, `claimsOf` counts issue 20 as claimed, `readHorizonChange`
 * reads an epic holding issue 20 as `in-progress`, and `pickRoadmapIssue`
 * skips the line as taken. Each reading sits beside the control of the
 * same reader with the template left out, which finds no branch.
 */
import type { SpecIssue } from './issue.js';
import type { BoardIssue } from './roadmap-board.js';
import type { RoadmapSeams } from './spec-source-roadmap.js';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { makeOwnershipCommit, pushNewClaimBranch } from '@open-tomato/rafa/claims/git';

import { typeOfLabels } from '../adapters/tracker/github.js';
import { createGitRunner } from '../pr/index.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { readHorizonChange } from './epic-horizon.js';
import { claimsOf } from './roadmap-epic-rows.js';
import { hasText, readLineRows } from './roadmap-rows.js';
import { pickRoadmapIssue } from './spec-source-roadmap.js';

const TEMPLATE = 'work/{stub}';
const BRANCH = 'work/rafa-20-x';
const ROADMAP = 31;

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-board-readers-template-')));

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

/** An open board issue. */
function boardIssue(number: number, labels: readonly string[]): BoardIssue {
  return { number, title: `issue ${String(number)}`, body: '', state: 'OPEN', stateReason: null, labels, type: typeOfLabels(labels), module: '' };
}

const MEMBER = boardIssue(20, ['epic:auth']);
const EPIC = boardIssue(40, ['type:epic', 'epic:auth', 'horizon:now']);
const LISTING: readonly BoardIssue[] = [EPIC, MEMBER, boardIssue(21, ['epic:auth'])];
const LINE = { issue: 20, ticked: false, why: 'pull request commands', lineNumber: 3 };
const ROADMAP_BODY = ['## Next, in order', '', '- [ ] #20 pull request commands', '- [ ] #33 the board setup'].join('\n');

const git = plantClone();
const noPulls = (): Promise<[]> => Promise.resolve([]);

/** `readLineRows` over the line for issue 20, the template given or left out. */
async function hasOf20(template?: string): Promise<string> {
  const read = await readLineRows([LINE], {
    board: () => Promise.resolve(LISTING),
    git,
    ...template === undefined
      ? {}
      : { branchTemplate: template },
    pullRequests: noPulls,
    planNames: () => [],
    refs: () => Promise.resolve(new Map()),
  });
  const row = read.rows.find((found) => found.line.issue === 20);
  if (row === undefined) throw new Error('no row for #20');
  return hasText(row.has);
}

/** The state `readHorizonChange` reads for epic 40, the template given or left out. */
async function epicState(template?: string): Promise<string> {
  const reading = await readHorizonChange({
    issues: LISTING,
    epic: 40,
    to: 'later',
    git,
    ...template === undefined
      ? {}
      : { branchTemplate: template },
    pullRequests: noPulls,
    planNames: () => [],
    today: new Date(2026, 8, 28),
  });
  return reading.state;
}

/** The issue `pickRoadmapIssue` picks off the planted roadmap, and the lines it printed. */
async function pick(template?: string): Promise<{ issue: number | null; info: readonly string[] }> {
  const info: string[] = [];
  const specIssue: SpecIssue = { number: ROADMAP, title: 'Roadmap', body: ROADMAP_BODY, state: 'OPEN', labels: [], author: 'owner' };
  const seams: RoadmapSeams = {
    configured: ROADMAP,
    listBoards: () => Promise.resolve([]),
    search: () => Promise.resolve([{ number: ROADMAP, title: 'Roadmap' }]),
    git,
    ...template === undefined
      ? {}
      : { branchTemplate: template },
    pullRequests: noPulls,
    listing: () => Promise.reject(new Error('the board was listed for a roadmap with no epic line')),
  };
  const outcome = await pickRoadmapIssue({
    roadmap: null,
    seams,
    root: scope,
    issues: () => Promise.resolve(specIssue),
    output: sinkOutput({ info: (message) => { info.push(message); }, warn: () => undefined }),
  });
  return { issue: 'issue' in outcome
    ? outcome.issue
    : null, info };
}

describe('the roadmap readers over a real bare repository holding work/rafa-20-x', () => {
  it('shows branch in the has column of issue 20 under work/{stub}, and nothing with the template left out', async () => {
    expect(await hasOf20(TEMPLATE)).toBe('branch');
    expect(await hasOf20()).toBe('');
  });

  it('counts issue 20 as claimed under work/{stub}, and not with the template left out', async () => {
    const seams = { git, pullRequests: noPulls, planNames: () => [] as string[] };

    expect([...await claimsOf([MEMBER], { ...seams, branchTemplate: TEMPLATE })]).toEqual([20]);
    expect([...await claimsOf([MEMBER], seams)]).toEqual([]);
  });

  it('reads the epic holding issue 20 as in-progress under work/{stub}, and backlog with the template left out', async () => {
    expect(await epicState(TEMPLATE)).toBe('in-progress');
    expect(await epicState()).toBe('backlog');
  });

  it('skips the line for issue 20 as taken under work/{stub}, and picks it with the template left out', async () => {
    const templated = await pick(TEMPLATE);
    const control = await pick();

    expect(templated.issue).toBe(33);
    expect(templated.info.join('\n')).toContain(BRANCH);
    expect(control.issue).toBe(20);
  });
});
