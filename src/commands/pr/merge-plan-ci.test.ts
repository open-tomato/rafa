/**
 * Tests for the `plan_ci` row `rafa pr merge` leaves behind each time it
 * reads a pull request's checks (`merge.ts`, through `recordPlanCi` in
 * `src/effort/store/plan-ci.ts`).
 *
 * Each case dispatches the command from a project of its own under this
 * file's temporary directory, over the recorded fake (`pr/gh-fake.ts`)
 * behind `createGhPullRequests`, so the store it writes is that
 * project's and never the live `.rafa/effort/`. Git is a stub answering
 * the three readings `readMergeRefusal` needs with a clean tree and this
 * checkout alone, and every other command with success: what is under
 * test is the store, and `merge-driven.test.ts` already drives the
 * clean-up over real git. The table is read back with `bun:sqlite`
 * directly, so the columns are spelled here rather than read off the
 * code under test.
 *
 * `pr merge` has no clock seam, so `read_at` is held between the
 * instants taken just before and just after the run.
 *
 * Controls carrying readings that would otherwise pass while wrong:
 *
 *   - The plan stub is read against a plan file the case planted under
 *     the configured `plan.dir`, beside the same run with no plan file,
 *     which stores the branch's stub verbatim.
 *   - Each case that stores nothing sits beside one that stores a row
 *     over the same fake, so a command that never writes reddens.
 *   - The refused cases read the fake back for no `pr merge` sent, so the
 *     row they store is shown to come from the checks read and not from
 *     a merge that went through.
 */
import type { MergeSeams } from './merge.js';
import type { FakePullRequestSeed } from '../../pr/gh-fake.js';
import type { GitResult } from '../../pr/index.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { sqliteStorePath } from '../../effort/store/sqlite.js';
import { createFakePrGh } from '../../pr/gh-fake.js';
import { createGhPullRequests } from '../../pr/index.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';

import { createPrMergeCommand } from './merge.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-merge-plan-ci-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The directory the planted config names as `plan.dir`. */
const PLAN_DIR = 'plans-here';

/** A config naming the GitHub CLI and {@link PLAN_DIR}. */
const CONFIG = `pr:\n  provider: gh\nplan:\n  dir: ${PLAN_DIR}\n`;

/** The plan a planted plan file holds, led by a queue id. */
const PLAN_STUB = 'q24-know-which-skills-earn';

/** A head branch naming that plan by its queue id alone. */
const PLAN_BRANCH = 'feat/q24';

/** The head commit the planted pull request's checks ran on. */
const HEAD = 'c0ffee'.padEnd(40, '0');

/** The pull request number every case names on the line. */
const NUMBER = 41;

/** A check named `name` at `state`. */
function check(name: string, state: string): { name: string; state: string; link: string } {
  return { name, state, link: `https://github.com/open-tomato/rafa/actions/runs/9006/job/${name}` };
}

/** Pull request {@link NUMBER} on `headRefName`, carrying `checks`. */
function pull(checks: FakePullRequestSeed['checks'], headRefName: string = PLAN_BRANCH): FakePullRequestSeed {
  return { number: NUMBER, title: 'q24: skills', headRefName, headRefOid: HEAD, checks };
}

/** A plan CI row as the table holds it, `seq` left out. */
interface StoredRow {
  plan_stub: string;
  pr: number;
  head_sha: string;
  verdict: string;
  failing: string;
  read_at: string;
}

/** A successful git answer. */
function ok(stdout = ''): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** A fake repository holding `seed`. */
function plantedFake(seed: FakePullRequestSeed): ReturnType<typeof createFakePrGh> {
  const fake = createFakePrGh();
  fake.plant(seed);
  return fake;
}

/** Seams over `fake` and a git stub reading a clean checkout of `headRefName` at `root`. */
function seamsOver(fake: ReturnType<typeof createFakePrGh>, root: string, headRefName: string): MergeSeams {
  const answers: Readonly<Record<string, GitResult>> = {
    'status --porcelain': ok(''),
    'worktree list --porcelain': ok(`worktree ${root}\nbranch refs/heads/${headRefName}\n\n`),
    'rev-parse --show-toplevel': ok(`${root}\n`),
  };
  return {
    pullRequests: () => createGhPullRequests({ gh: fake.run }),
    git: () => (args) => answers[args.join(' ')] ?? ok(''),
    isTerminal: () => false,
  };
}

/** A project of its own, holding a plan file for each of `planStubs` under {@link PLAN_DIR}. */
function freshProject(planStubs: readonly string[] = [PLAN_STUB]): PlantedProject {
  const project = plantProject(mkdtempSync(join(tempBase, 'case-')), CONFIG);
  mkdirSync(join(project.root, PLAN_DIR));
  for (const stub of planStubs) {
    writeFileSync(join(project.root, PLAN_DIR, `PLAN-${stub}.md`), '# plan\n', 'utf8');
  }
  return project;
}

/** What one run left, beside the instants taken around it. */
interface TimedRun {
  readonly run: CapturedRun;
  readonly before: string;
  readonly after: string;
}

/** Dispatches `rafa pr merge 41 --yes` over `fake` from `project`. */
async function merge(
  fake: ReturnType<typeof createFakePrGh>,
  project: PlantedProject,
  headRefName: string = PLAN_BRANCH,
): Promise<TimedRun> {
  const before = new Date().toISOString();
  const run = await dispatchInProject(
    ['pr', 'merge', String(NUMBER), '--yes', '--no-hint'],
    [{ name: 'pr', summary: 'pull requests' }],
    [createPrMergeCommand(seamsOver(fake, project.root, headRefName))],
    project,
  );
  return { run, before, after: new Date().toISOString() };
}

/** Every `plan_ci` row the project's store holds, in append order; none when there is no store. */
function storedRows(project: PlantedProject): StoredRow[] {
  const path = sqliteStorePath(project.root);
  if (!existsSync(path)) return [];
  const db = new Database(path, { readonly: true });
  try {
    return db.query<StoredRow, []>(
      'SELECT plan_stub, pr, head_sha, verdict, failing, read_at FROM plan_ci ORDER BY seq',
    ).all();
  } finally {
    db.close();
  }
}

/** The `pr merge` commands the fake was sent. */
function mergesSent(fake: ReturnType<typeof createFakePrGh>): readonly (readonly string[])[] {
  return fake.calls().filter((call) => call[0] === 'pr' && call[1] === 'merge');
}

describe('rafa pr merge stores what the checks read', () => {
  it('stores a green reading under the plan the head branch resolves to in plan.dir, and merges', async () => {
    const project = freshProject();
    const fake = plantedFake(pull([check('gates', 'SUCCESS')]));
    const { run, before, after } = await merge(fake, project);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`Merged #${NUMBER} into main (squash).`);
    const rows = storedRows(project);
    expect(rows.map((row) => [row.plan_stub, row.pr, row.head_sha, row.verdict, row.failing])).toEqual([
      [PLAN_STUB, NUMBER, HEAD, 'green', '[]'],
    ]);
    // ISO 8601 strings of one shape order as their instants do.
    const readAt = rows[0]?.read_at ?? '';
    expect(readAt >= before && readAt <= after).toBe(true);
  });

  it('stores the branch stub verbatim when plan.dir holds no plan for it', async () => {
    const project = freshProject([]);
    const { run } = await merge(plantedFake(pull([check('gates', 'SUCCESS')])), project);

    expect(run.exitCode).toBe(0);
    expect(storedRows(project).map((row) => row.plan_stub)).toEqual(['q24']);
  });

  it('stores a red reading with its failing names on a merge it refuses', async () => {
    const project = freshProject();
    const fake = plantedFake(pull([check('gates', 'FAILURE'), check('lint', 'SUCCESS'), check('unit', 'FAILURE')]));
    const { run } = await merge(fake, project);

    expect(run.exitCode).toBe(1);
    expect(mergesSent(fake)).toEqual([]);
    expect(storedRows(project).map((row) => [row.verdict, row.failing])).toEqual([['red', '["gates","unit"]']]);
  });

  it('stores a none reading for a pull request reporting no checks, refused without --skip-checks', async () => {
    const project = freshProject();
    const fake = plantedFake(pull([]));
    const { run } = await merge(fake, project);

    expect(run.exitCode).toBe(1);
    expect(mergesSent(fake)).toEqual([]);
    expect(storedRows(project).map((row) => [row.verdict, row.failing])).toEqual([['none', '[]']]);
  });

  it('stores nothing, and creates no store, while a check is still running', async () => {
    const project = freshProject();
    const fake = plantedFake(pull([check('gates', 'IN_PROGRESS')]));
    const { run } = await merge(fake, project);

    expect(run.exitCode).toBe(1);
    expect(mergesSent(fake)).toEqual([]);
    expect(existsSync(sqliteStorePath(project.root))).toBe(false);
  });

  it('stores nothing for a head branch that names no plan', async () => {
    const project = freshProject();
    const { run } = await merge(plantedFake(pull([check('gates', 'SUCCESS')], 'main-work')), project, 'main-work');

    expect(run.exitCode).toBe(0);
    expect(existsSync(sqliteStorePath(project.root))).toBe(false);
  });

  it('stores nothing for a queue id reaching two plans in plan.dir', async () => {
    const project = freshProject([PLAN_STUB, 'q24-another-plan']);
    const { run } = await merge(plantedFake(pull([check('gates', 'SUCCESS')])), project);

    expect(run.exitCode).toBe(0);
    expect(existsSync(sqliteStorePath(project.root))).toBe(false);
  });

  it('warns about a store it cannot write and still merges, ending 0', async () => {
    const project = freshProject();
    // A directory where the store file goes, so the store cannot be opened.
    mkdirSync(sqliteStorePath(project.root), { recursive: true });
    const fake = plantedFake(pull([check('gates', 'SUCCESS')]));
    const { run } = await merge(fake, project);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`warn: the CI reading of #${NUMBER} was not stored`);
    expect(mergesSent(fake)).toEqual([['pr', 'merge', String(NUMBER), '--squash']]);
  });
});
