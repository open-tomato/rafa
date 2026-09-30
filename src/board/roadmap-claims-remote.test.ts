/**
 * Walks a roadmap's four claim readings over a REAL bare remote: a held
 * claim, a released claim, a stale `rafa:claimed` claim and a stale
 * `rafa:in-development` claim, each on its own `feat/rafa-<n>-*` branch
 * pushed to a bare `origin`. `./roadmap.test.ts` and
 * `./roadmap-claims.test.ts` drive the same readings and the same walk
 * over planted fakes; this file drives them over the real git operations
 * {@link scanClaimBranches} runs (`git ls-remote --heads`, one fetch,
 * then the local reads `../claims/git.ts` makes), so a wiring mistake
 * between that module and the walk — a wrong remote name, a refspec
 * that misses a branch, a reading passed through unweighed — fails here
 * even though every case of those two files, driven over fakes, would
 * still pass.
 *
 * The released claim's line is placed LAST on the roadmap on purpose:
 * `pickNextRoadmapLine` never skips ahead, so reaching it at all proves
 * the walk passed every other line first, for the reason each one's
 * claim gives.
 */
import type { SpecIssue } from './issue.js';
import type { ClaimRecord } from '../claims/record.js';
import type { GitRunner } from '../pr/index.js';

import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { formatClaimMessage } from '../claims/record.js';
import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from '../claims/stale.js';
import { createGitRunner } from '../pr/index.js';

import {
  createRoadmapReadings, parseRoadmapBody, pickNextRoadmapLine, scanClaimBranches,
} from './roadmap.js';

/** This suite's own temporary directory, removed once every case has run. */
const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-roadmap-claims-remote-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** The four issues, one per claim shape, the released one last; see the module note. */
const HELD = 21;
const STALE_IN_DEVELOPMENT = 24;
const STALE_CLAIMED = 23;
const RELEASED = 22;

/** A committer date well past the default `claims.staleAfter` (3d): five days ago. */
const STALE_DATE = new Date(Date.now() - (5 * 24 * 60 * 60 * 1000)).toISOString();

/** Runs git and throws with what it said when it fails: a fixture step, not a reading. */
function must(git: GitRunner, args: readonly string[]): string {
  const result = git(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Makes `dir` a clone of `origin` with an identity of its own. */
function cloneInto(originPath: string, dir: string): GitRunner {
  must(createGitRunner(scope), ['clone', '--quiet', originPath, dir]);
  const git = createGitRunner(dir);
  must(git, ['config', 'user.name', 'device']);
  must(git, ['config', 'user.email', 'device@example.invalid']);
  must(git, ['config', 'commit.gpgsign', 'false']);
  return git;
}

/**
 * One empty commit on `parent`, its message `record`'s, its committer
 * (and author) date `date`, or the current one when left out. Touches
 * no ref: the caller pushes the sha where it belongs.
 */
function ownershipCommitAt(dir: string, parent: string, record: ClaimRecord, date?: string): string {
  const message = formatClaimMessage(record);
  const result = spawnSync('git', ['commit-tree', `${parent}^{tree}`, '-p', parent, '-m', message], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      LC_ALL: 'C',
      ...date === undefined
        ? {}
        : { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date },
    },
  });
  if (result.status !== 0) throw new Error(`commit-tree: ${result.stderr}`);
  return result.stdout.trim();
}

/** Pushes `sha` to `branch` on `origin`, without force: only ever the first commit of a branch here. */
function pushBranch(git: GitRunner, sha: string, branch: string): void {
  must(git, ['push', '--quiet', 'origin', `${sha}:refs/heads/${branch}`]);
}

/**
 * Force-pushes `sha` to `branch` on `origin`: the second commit of the
 * released branch, moving its tip past the first commit already there.
 */
function forcePushBranch(git: GitRunner, sha: string, branch: string): void {
  must(git, ['push', '--quiet', '--force', 'origin', `${sha}:refs/heads/${branch}`]);
}

/** A bare `origin` holding one commit on `main`, and a clone of it with an identity of its own. */
function plantOrigin(): { readonly originPath: string; readonly workPath: string; readonly git: GitRunner } {
  const root = realpathSync(mkdtempSync(join(scope, 'repo-')));
  const originPath = join(root, 'origin.git');
  must(createGitRunner(scope), ['init', '--quiet', '--bare', '--initial-branch=main', originPath]);
  const workPath = join(root, 'work');
  const git = cloneInto(originPath, workPath);
  writeFileSync(join(workPath, 'README.md'), 'a scratch repository for the claim-reading suite\n', 'utf8');
  must(git, ['add', 'README.md']);
  must(git, ['commit', '--quiet', '-m', 'root']);
  must(git, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  return { originPath, workPath, git };
}

/** Plants the four claim branches on `origin`, each named after its issue. */
function plantClaims(workPath: string, git: GitRunner): void {
  const main = must(git, ['rev-parse', 'main']);

  const held = ownershipCommitAt(workPath, main, { action: 'claim', issue: HELD, store: 'store-held' });
  pushBranch(git, held, `feat/rafa-${String(HELD)}-held`);

  const staleInDevelopment = ownershipCommitAt(workPath, main, { action: 'claim', issue: STALE_IN_DEVELOPMENT, store: 'store-in-development' }, STALE_DATE);
  pushBranch(git, staleInDevelopment, `feat/rafa-${String(STALE_IN_DEVELOPMENT)}-in-development`);

  const staleClaimed = ownershipCommitAt(workPath, main, { action: 'claim', issue: STALE_CLAIMED, store: 'store-claimed' }, STALE_DATE);
  pushBranch(git, staleClaimed, `feat/rafa-${String(STALE_CLAIMED)}-claimed`);

  const claimed = ownershipCommitAt(workPath, main, { action: 'claim', issue: RELEASED, store: 'store-released' });
  const branch = `feat/rafa-${String(RELEASED)}-released`;
  pushBranch(git, claimed, branch);
  const released = ownershipCommitAt(workPath, claimed, { action: 'release', issue: RELEASED, store: 'store-released' });
  forcePushBranch(git, released, branch);
}

/** One issue's minimal shape, labelled and open, for the roadmap's own reader. */
function issueOf(number: number, labels: readonly string[]): SpecIssue {
  return {
    number, title: `issue ${String(number)}`, body: '', state: 'OPEN', labels, author: '',
  };
}

const ISSUES: Readonly<Record<number, SpecIssue>> = {
  [HELD]: issueOf(HELD, []),
  [STALE_IN_DEVELOPMENT]: issueOf(STALE_IN_DEVELOPMENT, [IN_DEVELOPMENT_LABEL]),
  [STALE_CLAIMED]: issueOf(STALE_CLAIMED, [CLAIMED_LABEL]),
  [RELEASED]: issueOf(RELEASED, []),
};

/** The roadmap body: held, then stale in-development, then stale claimed, then released last; see the module note. */
const ROADMAP_BODY = [
  `- [ ] #${String(HELD)}`,
  `- [ ] #${String(STALE_IN_DEVELOPMENT)}`,
  `- [ ] #${String(STALE_CLAIMED)}`,
  `- [ ] #${String(RELEASED)}`,
  '',
].join('\n');

describe('a roadmap walk over a bare remote holding one of each claim shape', () => {
  it('passes the held and stale in-development claims, offers the stale claimed one, and picks the released one', async () => {
    const { workPath, git } = plantOrigin();
    plantClaims(workPath, git);

    const branches = scanClaimBranches(git, 'origin');
    expect(branches.problems).toEqual([]);

    const readings = createRoadmapReadings({
      issues: async (issue: number) => {
        const issueRow = ISSUES[issue];
        if (issueRow === undefined) throw new Error(`unplanned issue read: ${String(issue)}`);
        return issueRow;
      },
      branches,
      pullRequests: async () => [],
    });

    const lines = parseRoadmapBody(ROADMAP_BODY);
    expect(lines.map((line) => line.issue)).toEqual([HELD, STALE_IN_DEVELOPMENT, STALE_CLAIMED, RELEASED]);

    const pick = await pickNextRoadmapLine(lines, readings);

    expect(pick.line?.issue).toBe(RELEASED);
    expect(pick.skipped.map((skip) => [skip.line.issue, skip.reason, skip.claim?.state])).toEqual([
      [HELD, 'branch', 'held'],
      [STALE_IN_DEVELOPMENT, 'branch', 'stale-in-development'],
      [STALE_CLAIMED, 'stale-claim', 'stale-claimed'],
    ]);
  });
});
