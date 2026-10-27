/**
 * Integration test of `claimPlanIssue` under a `naming.branch` template of
 * `work/{stub}`, over a real bare repository and two clones of it standing
 * for two devices. The remote holds `work/rafa-7-x` with a claim commit;
 * the control is the same context with the template left out, which reads
 * only `feat/rafa-*`, finds no claim on `work/rafa-7-x`, and so claims
 * `feat/rafa-7-x` afresh instead of holding the existing claim.
 */
import type { PlanClaimContext, PlanClaimRequest } from './plan-claim.js';
import type { GitRunner } from '@open-tomato/rafa-pr/pr/index';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { makeOwnershipCommit, pushNewClaimBranch } from '@open-tomato/rafa/claims/git';
import { createGitRunner } from '@open-tomato/rafa-pr/pr/index';

import { claimPlanIssue } from './plan-claim.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-plan-claim-template-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const TEMPLATE = 'work/{stub}';
const BRANCH = 'work/rafa-7-x';
const FIRST_STORE = 'store-first';
const SECOND_STORE = 'store-second';

/** Runs git and throws with what it said when it fails: a fixture step, not a reading. */
function must(git: GitRunner, args: readonly string[]): string {
  const result = git(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Makes `dir` a clone of `originPath` with an identity of its own. */
function cloneInto(originPath: string, dir: string, name: string): GitRunner {
  must(createGitRunner(scope), ['clone', '--quiet', originPath, dir]);
  const git = createGitRunner(dir);
  must(git, ['config', 'user.name', name]);
  must(git, ['config', 'user.email', `${name}@example.invalid`]);
  must(git, ['config', 'commit.gpgsign', 'false']);
  return git;
}

/** A bare remote whose `main` holds one commit and `work/rafa-7-x` the first store's claim, with a clone for each device. */
function plantRemote(name: string): { readonly first: GitRunner; readonly second: GitRunner } {
  const root = realpathSync(mkdtempSync(join(scope, `${name}-`)));
  const originPath = join(root, 'origin.git');
  must(createGitRunner(scope), ['init', '--quiet', '--bare', '--initial-branch=main', originPath]);
  const seedPath = join(root, 'seed');
  const seed = cloneInto(originPath, seedPath, 'seed');
  writeFileSync(join(seedPath, 'kept.txt'), 'kept\n', 'utf8');
  must(seed, ['add', '--all']);
  must(seed, ['commit', '--quiet', '-m', 'root']);
  must(seed, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  const made = makeOwnershipCommit(seed, 'main', { action: 'claim', issue: 7, store: FIRST_STORE });
  if (!made.ok) throw new Error(made.reason);
  const pushed = pushNewClaimBranch(seed, made.sha, BRANCH, TEMPLATE);
  if (pushed.outcome !== 'pushed') throw new Error(`claim push: ${pushed.outcome}`);
  return {
    first: cloneInto(originPath, join(root, 'first'), 'first'),
    second: cloneInto(originPath, join(root, 'second'), 'second'),
  };
}

/** A context for the device holding `storeId`, naming branches under `template` when given. */
function contextFor(git: GitRunner, storeId: string, template?: string): PlanClaimContext {
  return {
    git,
    board: null,
    readStoreId: () => ({ ok: true, storeId, replacedIds: [], mintedAt: '2026-01-01T00:00:00.000Z' }),
    staleAfter: '3d',
    claimsAhead: 'off',
    now: new Date(),
    ...(template === undefined
      ? {}
      : { branchTemplate: template }),
  };
}

const request: PlanClaimRequest = { issue: 7, specPath: 'rafa-7-x.md', stub: 'rafa-7-x', labels: null };

describe('claimPlanIssue under a branch template', () => {
  it('reads the remote claim on work/rafa-7-x as this device\'s', async () => {
    const { first } = plantRemote('own');

    const answer = await claimPlanIssue(request, contextFor(first, FIRST_STORE, TEMPLATE));

    expect(answer).toMatchObject({ outcome: 'claimed', issue: 7, branch: BRANCH, storeId: FIRST_STORE, via: 'held' });
  });

  it('refuses a second device on it, naming the owner', async () => {
    const { second } = plantRemote('other');

    const answer = await claimPlanIssue(request, contextFor(second, SECOND_STORE, TEMPLATE));

    expect(answer).toMatchObject({ outcome: 'refused', issue: 7, branch: BRANCH, owner: FIRST_STORE });
  });

  it('does not find the claim with the template left out, and makes a fresh one on feat/rafa-7-x', async () => {
    const { first } = plantRemote('control');

    const answer = await claimPlanIssue(request, contextFor(first, FIRST_STORE));

    expect(answer).toMatchObject({ outcome: 'claimed', branch: 'feat/rafa-7-x', via: 'claim' });
  });
});
