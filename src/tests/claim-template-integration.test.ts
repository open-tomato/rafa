/**
 * Integration test of the `naming.branch` template over one real bare
 * repository. Its remote holds `work/rafa-7-x` with a claim commit by
 * this device's store, and a clone of it is the project, whose
 * `.rafa/config.yaml` sets `naming.branch: work/{stub}`. The template
 * reaches the three readers of a claim branch the way the commands take
 * it, off the config `loadConfig` resolves there: the claims section of
 * `readStatusSections` lists the claim, `rafa claim release 7` finds
 * and releases it, and `readRunClaim` over a plan stubbed `rafa-7-x`
 * reads it as owned.
 *
 * The control is a second clone of the same remote whose config leaves
 * the template out, so it reads the default `feat/{stub}`: the same
 * three find no claim, and the release refuses with no branch found,
 * pushing nothing.
 */
import type { GitRunner } from '../pr/index.js';
import type { StatusSeams } from '../status/sections.js';
import type { RafaConfig } from '@open-tomato/rafa/core/config';

import '../adapter-registry.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { loadConfig } from '@open-tomato/rafa/core/config/load';

import { makeOwnershipCommit, pushNewClaimBranch } from '../claims/git.js';
import { createClaimReleaseCommand } from '../commands/claim/release.js';
import { createGitRunner } from '../pr/index.js';
import { readRunClaim } from '../start/preflight-claim.js';
import { readStatusSections } from '../status/sections.js';

import { dispatchInProject, plantProjectConfig } from './cli-capture.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-claim-template-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const TEMPLATE = 'work/{stub}';
const BRANCH = 'work/rafa-7-x';
const STORE = 'store-a';
const ISSUE = 7;
const PLAN = '/project/.rafa/plans/PLAN-rafa-7-x.md';
const SUBJECTS = [{ name: 'claim', summary: 'claims' }];

/** The project config a clone carries: the template when given, the default otherwise. */
function configText(template: string | undefined): string {
  const naming = template === undefined
    ? ''
    : `naming:\n  branch: ${template}\n`;
  return `${naming}pr:\n  provider: none\n`;
}

/** A project: a clone of the one remote, its root, the empty home beside it, and its runner. */
interface Project {
  readonly root: string;
  readonly home: string;
  readonly git: GitRunner;
}

/** The remote's runner and the two projects, one per template. */
interface World {
  readonly origin: GitRunner;
  readonly templated: Project;
  readonly defaulted: Project;
}

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

/** A clone of `originPath` made a project under `template`, with an empty home beside it. */
function projectOver(originPath: string, root: string, template: string | undefined): Project {
  const dir = join(root, template === undefined
    ? 'defaulted'
    : 'templated');
  const git = cloneInto(originPath, dir, 'device-a');
  plantProjectConfig(dir, configText(template));
  const home = join(root, template === undefined
    ? 'defaulted-home'
    : 'templated-home');
  mkdirSync(home);
  return { root: dir, home, git };
}

/** Plants a bare remote holding `main` and the claim on `work/rafa-7-x`, and a project of each template over it. */
function plantWorld(name: string): World {
  const root = realpathSync(mkdtempSync(join(scope, `${name}-`)));
  const originPath = join(root, 'origin.git');
  must(createGitRunner(scope), ['init', '--quiet', '--bare', '--initial-branch=main', originPath]);
  const seedPath = join(root, 'seed');
  const seed = cloneInto(originPath, seedPath, 'seed');
  writeFileSync(join(seedPath, 'kept.txt'), 'kept\n', 'utf8');
  must(seed, ['add', '--all']);
  must(seed, ['commit', '--quiet', '-m', 'root']);
  must(seed, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  const made = makeOwnershipCommit(seed, 'main', { action: 'claim', issue: ISSUE, store: STORE });
  if (!made.ok) throw new Error(made.reason);
  const pushed = pushNewClaimBranch(seed, made.sha, BRANCH, TEMPLATE);
  if (pushed.outcome !== 'pushed') throw new Error(`claim push: ${pushed.outcome}`);
  return {
    origin: createGitRunner(originPath),
    templated: projectOver(originPath, root, TEMPLATE),
    defaulted: projectOver(originPath, root, undefined),
  };
}

/** What the remote's `branch` points at, or null when it has none. */
function remoteTip(world: World, branch: string): string | null {
  const result = world.origin(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  return result.ok
    ? result.stdout.trim()
    : null;
}

/** The config that resolves for `project`, as the commands read it. */
async function configOf(project: Project): Promise<RafaConfig> {
  return (await loadConfig({ root: project.root, home: project.home }, {}, () => undefined)).config;
}

/** Seams for the status sections that reach nothing but the clone's own git. */
function statusSeams(): StatusSeams {
  return {
    readRemote: () => null,
    openGh: () => () => Promise.resolve({ ok: true, stdout: '[]', stderr: '' }),
    board: () => ({
      next: () => Promise.resolve({ roadmap: 31, line: null, passed: 0, problems: [] }),
      isReady: () => Promise.resolve(false),
      blocking: () => Promise.resolve(null),
    }),
    listing: () => () => Promise.resolve([]),
    blockedIssues: () => Promise.resolve({ readings: [], faults: [], problem: null, unchecked: null }),
    now: () => new Date(),
    timeoutMs: 2_000,
  };
}

/** The claims `rafa status` lists in `project`: branch, issue and owner of each. */
async function statusClaims(project: Project): Promise<readonly (readonly [string, number, string | null])[]> {
  const config = await configOf(project);
  const sections = await readStatusSections({ root: project.root, home: project.home, config }, statusSeams());
  if (!sections.claims.read) throw new Error(`the claims section was not read: ${sections.claims.problem}`);
  return sections.claims.claims.map((row) => [row.branch, row.issue, row.owner]);
}

/** `readRunClaim` over the plan stubbed `rafa-7-x`, with the branch template `project`'s config names. */
async function runClaim(project: Project): Promise<ReturnType<typeof readRunClaim>> {
  const config = await configOf(project);
  return readRunClaim(PLAN, {
    git: project.git,
    board: null,
    readStoreId: () => ({ ok: true, storeId: STORE, replacedIds: [], mintedAt: '2026-01-01T00:00:00.000Z' }),
    staleAfter: config.claimsStaleAfter,
    branchTemplate: config.namingBranch,
  });
}

/** Dispatches `rafa claim release 7` in `project`, its seams made over the config that resolves there. */
async function releaseIn(project: Project): ReturnType<typeof dispatchInProject> {
  const command = createClaimReleaseCommand((root, config) => ({
    git: createGitRunner(root),
    board: null,
    readStoreId: () => ({ ok: true, storeId: STORE, replacedIds: [], mintedAt: '2026-01-01T00:00:00.000Z' }),
    branchTemplate: config.namingBranch,
  }));
  return dispatchInProject(['claim', 'release', String(ISSUE)], SUBJECTS, [command], project);
}

describe('a claim on work/rafa-7-x under naming.branch work/{stub}', () => {
  it('is listed by the status sections', async () => {
    const world = plantWorld('status');

    expect(await statusClaims(world.templated)).toEqual([[BRANCH, ISSUE, STORE]]);
  });

  it('is owned by readRunClaim over the plan stubbed rafa-7-x', async () => {
    const world = plantWorld('run');

    const claim = await runClaim(world.templated);

    expect(claim).toEqual({ outcome: 'owned', issue: ISSUE, branch: BRANCH, storeId: STORE, via: 'held', note: '', replacedId: null });
  });

  it('is found and released by rafa claim release 7', async () => {
    const world = plantWorld('release');
    const claimTip = remoteTip(world, BRANCH);

    const run = await releaseIn(world.templated);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`Released the claim on #7 (store ${STORE}) on ${BRANCH}`);
    const tip = remoteTip(world, BRANCH);
    expect(tip).not.toBe(claimTip);
    expect(must(world.origin, ['rev-parse', `${tip ?? ''}^`])).toBe(claimTip ?? '');
  });
});

describe('the same claim under the default template', () => {
  it('is listed by no status section', async () => {
    const world = plantWorld('status-control');

    expect(await statusClaims(world.defaulted)).toEqual([]);
  });

  it('is no claim to readRunClaim, which pushes nothing', async () => {
    const world = plantWorld('run-control');

    const claim = await runClaim(world.defaulted);

    expect(claim).toEqual({ outcome: 'none' });
    expect(remoteTip(world, 'feat/rafa-7-x')).toBeNull();
  });

  it('is not found by rafa claim release 7, which refuses and pushes nothing', async () => {
    const world = plantWorld('release-control');
    const claimTip = remoteTip(world, BRANCH);

    const run = await releaseIn(world.defaulted);

    expect(run.exitCode).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain('origin has no feat/rafa-7-<slug> branch, so #7 carries no claim');
    expect(remoteTip(world, BRANCH)).toBe(claimTip);
  });
});
