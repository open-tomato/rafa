/**
 * Tests for the loop-worktree step `rafa pr merge` runs before
 * `readMergeRefusal` (`./merge.ts`, "The loop worktree holding the
 * branch"; the rule itself is `./merge-loop-worktree.ts`'s): a head
 * branch held by a clean, ended loop worktree merges, with the two plan
 * files copied into the main checkout's `plan.dir` and the worktree
 * removed, while a dirty one refuses before anything is merged.
 *
 * Every case dispatches the real command from a project of its own
 * (`tests/cli-capture.ts`) over a stub provider and a planted git
 * runner. The runner answers by directory, and its `worktree remove`
 * deletes the holder on disk and drops it from the next listing, so
 * "the worktree is gone" is read off the disk and off the listing the
 * merge reads after it.
 *
 * ## The controls
 *
 *  - The holder outside `loop.worktreeDir` runs over the same listing
 *    and the same clean status, and must refuse with the existing
 *    "checked out in another worktree" refusal, sending no remove: a
 *    step that freed every holder would pass the first case.
 *  - The dirty case asserts that the provider was never asked to merge
 *    and that no remove was sent, so its refusal is the step's and not a
 *    later one.
 */
import type { MergeSeams } from './merge.js';
import type { GitResult, GitRunner, PullRequestDetail } from '../../pr/index.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { WORKTREE_STATUS } from '../../cleanup/worktrees.js';
import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';

import { createPrMergeCommand } from './merge.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-merge-loop-holder-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];
const CONFIG = 'pr:\n  provider: gh\n';
const STUB = 'rafa-20-sign-in';
const BRANCH = `feat/${STUB}`;
const BASE = 'main';
const PLAN_FILES = [`CLOSEOUT-${STUB}.md`, `PLAN_TRACKER-${STUB}.md`];

function detail(): PullRequestDetail {
  return {
    number: 41,
    title: 'rafa-20: sign-in',
    url: 'https://github.com/acme/board/pull/41',
    state: 'open',
    headRefName: BRANCH,
    baseRefName: BASE,
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-30T11:00:00Z',
    body: 'Refactors the sign-in form.',
    headRefOid: '1f0c2b7de6a94c1a0b5e3d2f4a6b8c0d1e2f3a4b',
    mergeable: 'mergeable',
    mergeStateStatus: 'CLEAN',
    labels: [],
    closes: [],
  };
}

const ok = (stdout = ''): GitResult => ({ ok: true, stdout, stderr: '' });

/** A git runner by directory, and every line it was handed, prefixed with that directory. */
interface FakeGit {
  readonly git: (dir: string) => GitRunner;
  readonly ran: () => readonly string[];
}

/** Answers for the main checkout and the holder; `status` is the holder's. */
function fakeGit(root: string, holder: string, status: string): FakeGit {
  const ran: string[] = [];
  const git = (dir: string): GitRunner => (args) => {
    const line = args.join(' ');
    ran.push(`${dir}: ${line}`);
    if (dir === holder && line === WORKTREE_STATUS.join(' ')) return ok(status);
    if (dir === holder) return ok();
    if (line === 'worktree list --porcelain') {
      const held = existsSync(holder)
        ? `worktree ${holder}\nbranch refs/heads/${BRANCH}\n\n`
        : '';
      return ok(`worktree ${root}\nbranch refs/heads/${BASE}\n\n${held}`);
    }
    if (line === 'rev-parse --show-toplevel') return ok(`${root}\n`);
    if (line === `worktree remove ${holder}`) {
      rmSync(holder, { recursive: true, force: true });
      return ok();
    }
    if (line === `ls-remote --heads origin ${BRANCH}`) return ok(`1f0c2b7\trefs/heads/${BRANCH}\n`);
    return ok();
  };
  return { git, ran: () => [...ran] };
}

interface Ran {
  readonly exitCode: number;
  readonly out: string;
  readonly root: string;
  readonly holder: string;
  readonly git: FakeGit;
  readonly mergeCalls: () => number;
}

/** Dispatches `rafa pr merge 41 --yes --no-hint` with a holder at `<root>/<under>/<stub>` holding the branch. */
async function ran(options: { readonly under?: string; readonly status?: string } = {}): Promise<Ran> {
  const project = plantProject(mkdtempSync(join(tempBase, 'case-')), CONFIG);
  const holder = join(project.root, options.under ?? join('.rafa', 'worktrees'), STUB);
  mkdirSync(join(holder, '.rafa', 'plans'), { recursive: true });
  for (const name of PLAN_FILES) writeFileSync(join(holder, '.rafa', 'plans', name), `${name} from the loop\n`);
  const git = fakeGit(project.root, holder, options.status ?? '');
  let merges = 0;
  const pulls = createPullRequestsDouble({
    get: () => Promise.resolve(detail()),
    checks: () => Promise.resolve({ rows: [], verdict: 'green' }),
    merge: () => {
      merges += 1;
      return Promise.resolve({ merged: true, detail: 'Squashed and merged pull request #41' });
    },
  }, { refusal: 'the stub provider models get, checks and merge alone' });
  const seams: MergeSeams = {
    pullRequests: () => pulls.pulls,
    readBranch: () => BASE,
    readRemote: () => 'git@github.com:acme/board.git',
    git: git.git,
    isTerminal: () => true,
  };
  const run = await dispatchInProject(['pr', 'merge', '41', '--yes', '--no-hint'], SUBJECTS, [createPrMergeCommand(seams)], project);
  return { exitCode: run.exitCode, out: `${run.stdout}\n${run.stderr}`, root: project.root, holder, git, mergeCalls: () => merges };
}

describe('a head branch held by a clean, ended loop worktree', () => {
  it('merges, with the two plan files in the main checkout\'s plan.dir and the worktree gone', async () => {
    const run = await ran();

    expect(run.exitCode).toBe(0);
    expect(run.mergeCalls()).toBe(1);
    for (const name of PLAN_FILES) {
      expect(readFileSync(join(run.root, '.rafa', 'plans', name), 'utf8')).toBe(`${name} from the loop\n`);
    }
    expect(existsSync(run.holder)).toBe(false);
    expect(run.git.ran()).toContain(`${run.root}: worktree remove ${run.holder}`);
    expect(run.out).toContain(`Freed the ended loop worktree ${run.holder} holding ${BRANCH}: `);
  });
});

describe('the holders the step does not free', () => {
  it('refuses a dirty loop worktree naming its path, merging nothing and removing nothing', async () => {
    const run = await ran({ status: '?? notes.txt\n' });

    expect(run.exitCode).toBe(1);
    expect(run.out).toContain(`is checked out in the loop worktree ${run.holder}, which cannot be freed:`);
    expect(run.out).toContain('1 untracked file');
    expect(run.mergeCalls()).toBe(0);
    expect(run.git.ran().some((line) => line.includes('worktree remove'))).toBe(false);
    expect(existsSync(run.holder)).toBe(true);
  });

  it('leaves a holder outside loop.worktreeDir to the existing refusal', async () => {
    const run = await ran({ under: 'elsewhere' });

    expect(run.exitCode).toBe(1);
    expect(run.out).toContain(`branch ${BRANCH} is checked out in another worktree.`);
    expect(run.mergeCalls()).toBe(0);
    expect(run.git.ran().some((line) => line.includes('worktree remove'))).toBe(false);
  });
});
