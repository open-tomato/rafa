/**
 * `rafa pr triage --resolve` driven over a REAL scratch git repository:
 * a genuine two-sided `bun.lock` conflict, a real `git worktree add` and
 * `git worktree remove`, and a real `git merge-tree` reading of it.
 *
 * `triage-resolve.test.ts` proves the command's own logic — the plan, the
 * budget, the comment, the dependabot note, the attempt guard's two
 * readings — over a stub `git` that answers `merge-tree` and the three
 * worktree commands however a case wants them to read. That is the right
 * tool for that file's job, and it says so in its own module note. It
 * does not prove that a REAL conflict, read by a REAL `git merge-tree`,
 * and a REAL worktree, added and removed by REAL git, drive the same
 * command to the same two endings. This file is that proof.
 *
 * Only the pull-request PROVIDER stays a fake, the same recorded one
 * every other `pr` test uses (`gh-fake.ts`): GitHub itself is out of
 * scope for a repository test, and `triage-resolve.test.ts` already
 * proves what this command sends it. Git is never stubbed here — every
 * `TriageSeams.git` call reaches the real default, `createGitRunner`,
 * left out of the seams below on purpose so this file exercises the
 * production path rather than a shim of its own — and the stand-in loop
 * (`TriageSeams.runLoop`) is the only thing standing in for a spawned
 * `rafa loop start`, exactly as `resolve-loop.ts`'s own module note says
 * a caller may.
 *
 * ## The planted conflict, and its liveness control
 *
 * `bun.lock` holds one line. The feature branch and the base each
 * replace that one line with different text after the branch point, so
 * `git merge-tree` has a genuine content conflict to report — not an
 * unresolvable ref, which is exit 1 too and the ambiguity
 * `conflict.ts`'s own module note is about. The first case below is the
 * liveness control that ambiguity asks for: it reads the planted
 * repository directly, before any command runs over it, and asserts a
 * real `CONFLICT` message and not merely a nonzero exit.
 *
 * ## What each of the two endings proves, and its control
 *
 * - **The fix.** The stand-in loop writes a resolved `bun.lock` INSIDE
 *   the real worktree and commits it there with real git, then tells the
 *   fake pull request the new head and a clean merge state. The case
 *   reads the commit back out of the OPERATOR's own repository, at the
 *   branch name, through git rather than through anything the fake
 *   recorded, which is what proves the worktree was a real one and not a
 *   directory the command merely believes was there.
 * - **The stall.** The stand-in loop touches nothing at all, so the
 *   second attempt reassesses the identical planted conflict — same
 *   class, no step named either time — and the repeat reading stops the
 *   command at its second attempt without waiting for `--max-attempts`
 *   to be typed smaller. Its control is the fix case beside it: the same
 *   worktree, the same seams, a stand-in that does nothing rather than
 *   one that does the fix, and a different ending.
 *
 * Both endings read the real worktree gone afterwards — `existsSync`
 * false AND absent from `git worktree list` — which a stub answering
 * `ok: true` for `worktree remove` could not fail even if the command
 * never called it.
 */
import type { TriageSeams } from './triage.js';
import type { FakePullRequestSeed } from '../../pr/gh-fake.js';
import type { GitRunner } from '../../pr/index.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGhPermissions } from '../../board/trust.js';
import { createFakePrGh } from '../../pr/gh-fake.js';
import { createGhPullRequests, createGitRunner } from '../../pr/index.js';
import { hasConflictMessage, readConflict } from '../../pr/triage/conflict.js';
import { resolveWorktreePath } from '../../pr/worktree.js';
import { dispatchInProject, plantProjectConfig } from '../../tests/cli-capture.js';

import { createPrTriageCommand } from './triage.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-resolve-driven-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** A config naming the GitHub CLI, so no origin remote needs probing. */
const GH_CONFIG = 'pr:\n  provider: gh\n';

/** The base branch of every planted repository. */
const BASE = 'main';

/** The pull request number every case names, and the branch its worktree checks out. */
const NUMBER = 77;

/** The clock every comment in this file is stamped with. */
const NOW = '2026-09-19T09:00:00Z';

/** A scratch repository holding a real, two-sided `bun.lock` conflict. */
interface ConflictRepo {
  /** The operator's own checkout, which the command dispatches over. */
  readonly work: string;
  /** The home `~/.rafa/worktrees` and `~/.rafa/resolve` are built under. */
  readonly home: string;
  /** The head branch, matching the pull request's `headRefName`. */
  readonly branch: string;
  /** The commit the branch was left at, matching the pull request's `headRefOid`. */
  readonly headOid: string;
}

/**
 * Plants a repository under `tempBase`: one commit on {@link BASE}, then
 * {@link branch} off it, with `bun.lock`'s one line changed to different
 * text on each side after the branch point — a real content conflict for
 * `git merge-tree` to find, and not merely a ref neither side resolves;
 * see the module note.
 */
function plantConflictRepo(name: string): ConflictRepo {
  const root = realpathSync(mkdtempSync(join(tempBase, name)));
  const work = join(root, 'work');
  const home = join(root, 'home');
  mkdirSync(work, { recursive: true });
  mkdirSync(home, { recursive: true });
  const git = createGitRunner(work);
  const branch = `feat/pr-${String(NUMBER)}`;

  expect(git(['init', '--quiet', `--initial-branch=${BASE}`, '.']).ok).toBe(true);
  git(['config', 'user.email', 'rafa@example.test']);
  git(['config', 'user.name', 'rafa test']);
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(work, 'bun.lock'), 'main\n', 'utf8');
  git(['add', 'bun.lock']);
  expect(git(['commit', '--quiet', '--message', 'seed']).ok).toBe(true);

  expect(git(['switch', '--quiet', '-c', branch]).ok).toBe(true);
  writeFileSync(join(work, 'bun.lock'), 'feature bumps a dependency\n', 'utf8');
  git(['add', 'bun.lock']);
  expect(git(['commit', '--quiet', '--message', 'feature bumps a dependency']).ok).toBe(true);

  expect(git(['switch', '--quiet', BASE]).ok).toBe(true);
  writeFileSync(join(work, 'bun.lock'), 'main bumps a different dependency\n', 'utf8');
  git(['add', 'bun.lock']);
  expect(git(['commit', '--quiet', '--message', 'main bumps a different dependency']).ok).toBe(true);

  const headOid = git(['rev-parse', branch]).stdout.trim();
  plantProjectConfig(work, GH_CONFIG);

  return { work, home, branch, headOid };
}

/** The pull request seed every case plants, a genuine conflict on the real branch and commit. */
function conflictedSeed(repo: ConflictRepo, over: Partial<FakePullRequestSeed> = {}): FakePullRequestSeed {
  return {
    number: NUMBER,
    title: 'a driven resolve',
    headRefName: repo.branch,
    headRefOid: repo.headOid,
    checks: [],
    mergeable: 'CONFLICTING',
    mergeStateStatus: 'DIRTY',
    ...over,
  };
}

/** What one attempt's stand-in loop was handed. */
interface LoopCall {
  readonly worktree: string;
  readonly planPath: string;
}

/** The commit at `branch` in `git`'s repository, real git's own answer. */
function tipOf(git: GitRunner, branch: string): string {
  return git(['rev-parse', branch]).stdout.trim();
}

/** `bun.lock` as `branch` holds it, read with `git show` rather than off any fake. */
function lockfileAt(git: GitRunner, branch: string): string {
  return git(['show', `${branch}:bun.lock`]).stdout;
}

/** The login a planted pull request carries, and the one the fake comments as. */
const TRUSTED_LOGINS: readonly string[] = ['octo', 'rafa-fake'];

/**
 * Gives the pull request's author and the fake's own commenting account
 * write access, which is what lets a resolve run start and what makes
 * the triage comment it writes one the next read may trust
 * (`./triage-trust.ts`).
 */
function plantTrust(fake: ReturnType<typeof createFakePrGh>): void {
  for (const login of TRUSTED_LOGINS) fake.plantPermission(login, 'admin');
}

/** Whether git still lists a worktree at `path`. */
function stillListed(git: GitRunner, path: string): boolean {
  return git(['worktree', 'list', '--porcelain']).stdout.includes(path);
}

describe('the planted repository, read directly', () => {
  it('answers a real CONFLICT from git merge-tree, not merely a nonzero exit', () => {
    const repo = plantConflictRepo('liveness');
    const git = createGitRunner(repo.work);

    const reading = readConflict(git, BASE, repo.branch);

    expect(reading.kind).toBe('conflict');
    expect(reading.files).toEqual(['bun.lock']);
    expect(hasConflictMessage(reading)).toBe(true);
  });
});

describe('a real lockfile conflict the attempt actually fixes', () => {
  it('commits the fix in the real worktree, ends green after one attempt, and removes the worktree', async () => {
    const repo = plantConflictRepo('green');
    const fake = createFakePrGh({ now: () => NOW });
    fake.plant(conflictedSeed(repo));
    plantTrust(fake);
    const loops: LoopCall[] = [];
    let resolvedSha = '';

    const seams: TriageSeams = {
      pullRequests: () => createGhPullRequests({ gh: fake.run }),
      permissions: () => createGhPermissions({ gh: fake.run }),
      now: () => NOW,
      clock: () => 0,
      sleep: async () => undefined,
      runLoop: async (run) => {
        loops.push({ worktree: run.worktree, planPath: run.planPath });
        const inside = createGitRunner(run.worktree);
        writeFileSync(join(run.worktree, 'bun.lock'), 'resolved\n', 'utf8');
        inside(['add', 'bun.lock']);
        inside(['commit', '--quiet', '--message', 'resolve the lockfile conflict']);
        resolvedSha = inside(['rev-parse', 'HEAD']).stdout.trim();
        fake.update(NUMBER, (pull) => ({
          ...pull,
          headRefOid: resolvedSha,
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'CLEAN',
        }));
        return { ok: true, exitCode: 0, argv: ['loop', 'start'], problem: null };
      },
    };
    const command = createPrTriageCommand(seams);
    const project: PlantedProject = { root: repo.work, home: repo.home };

    const run = await dispatchInProject(['pr', 'triage', String(NUMBER), '--resolve'], SUBJECTS, [command], project);

    expect(run.exitCode).toBe(0);
    expect(loops).toHaveLength(1);
    expect(run.stdout).toContain('is green after 1 of 2 resolve attempts');

    const git = createGitRunner(repo.work);
    const worktreePath = resolveWorktreePath(repo.home, NUMBER);
    expect(existsSync(worktreePath)).toBe(false);
    expect(stillListed(git, worktreePath)).toBe(false);

    // The real evidence: the branch in the OPERATOR's own repository now
    // carries the commit the stand-in loop made inside the worktree, read
    // back through git and not off anything the fake recorded.
    expect(resolvedSha).not.toBe('');
    expect(tipOf(git, repo.branch)).toBe(resolvedSha);
    expect(lockfileAt(git, repo.branch)).toBe('resolved\n');

    const comment = fake.pull(NUMBER)?.comments.at(-1)?.body ?? '';
    expect(comment).toContain('resolved');
    expect(comment).toContain('attempts: 1');
  });
});

describe('a real lockfile conflict no attempt fixes', () => {
  it('stops at two attempts, exit 3, the raised comment and the follow-up prompt, worktree gone', async () => {
    const repo = plantConflictRepo('stuck');
    const fake = createFakePrGh({ now: () => NOW });
    fake.plant(conflictedSeed(repo, { title: 'a driven resolve that stays broken' }));
    plantTrust(fake);
    const loops: LoopCall[] = [];

    const seams: TriageSeams = {
      pullRequests: () => createGhPullRequests({ gh: fake.run }),
      permissions: () => createGhPermissions({ gh: fake.run }),
      now: () => NOW,
      clock: () => 0,
      sleep: async () => undefined,
      runLoop: async (run) => {
        loops.push({ worktree: run.worktree, planPath: run.planPath });
        // The attempt touches nothing: the worktree, the branch and the
        // pull request are left exactly as they were planted.
        return { ok: true, exitCode: 0, argv: ['loop', 'start'], problem: null };
      },
    };
    const command = createPrTriageCommand(seams);
    const project: PlantedProject = { root: repo.work, home: repo.home };

    const run = await dispatchInProject(['pr', 'triage', String(NUMBER), '--resolve'], SUBJECTS, [command], project);

    expect(run.exitCode).toBe(3);
    expect(loops).toHaveLength(2);
    // The same real worktree both times: added once, reused, removed once.
    expect(new Set(loops.map((call) => call.worktree)).size).toBe(1);
    expect(run.stderr).toContain(`rafa pr triage --resolve gave up on #${String(NUMBER)}`);
    expect(run.stdout).toContain('the same reading as the run before it');
    expect(run.stdout).toContain('# Assessed pull request: act on this triage');

    const git = createGitRunner(repo.work);
    const worktreePath = resolveWorktreePath(repo.home, NUMBER);
    expect(existsSync(worktreePath)).toBe(false);
    expect(stillListed(git, worktreePath)).toBe(false);

    // Nothing was resolved: the branch git lists is exactly the commit it
    // was planted at, and the conflicting content is untouched.
    expect(tipOf(git, repo.branch)).toBe(repo.headOid);
    expect(lockfileAt(git, repo.branch)).toBe('feature bumps a dependency\n');

    const comment = fake.pull(NUMBER)?.comments.at(-1)?.body ?? '';
    expect(comment).toContain('attempts: 2');
  });
});
