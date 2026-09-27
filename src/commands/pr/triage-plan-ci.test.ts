/**
 * Tests for the `plan_ci` row `rafa pr triage` leaves behind each time it
 * reads a pull request's checks (`triage.ts`, through `recordPlanCi` in
 * `src/effort/store/plan-ci.ts`).
 *
 * Each case dispatches the command from a project of its own under this
 * file's temporary directory, over the recorded fake (`pr/gh-fake.ts`),
 * so the store it writes is that project's and never the live
 * `.rafa/effort/`. The table is read back with `bun:sqlite` directly, so
 * the columns are spelled here rather than read off the code under test.
 *
 * Three controls carry readings that would otherwise pass while wrong:
 *
 *   - The plan stub is read against a plan file the case planted under
 *     the configured `plan.dir`, beside the same run with no plan file,
 *     which stores the branch's stub verbatim. So "the configured
 *     directory is the one resolved against" is a difference, not a
 *     default that happens to match.
 *   - Each case that stores nothing sits beside one that stores a row
 *     over the same fake, so a command that never writes reddens.
 *   - A second run over a head the stored triage comment already
 *     assessed is measured to assess nothing, so the row it still
 *     stores is shown to come from the checks read, not the assessment.
 */
import type { TriageSeams } from './triage.js';
import type { FakePullRequestSeed } from '../../pr/gh-fake.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { createGhPermissions } from '../../board/trust.js';
import { sqliteStorePath } from '../../effort/store/sqlite.js';
import { createFakePrGh, logFailedText } from '../../pr/gh-fake.js';
import { createGhPullRequests } from '../../pr/index.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';

import { createPrTriageCommand } from './triage.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-triage-plan-ci-')));

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

/** The Actions run the failing check points at. */
const RUN_ID = '9006';

/** The account the fake writes a comment as, given write access. */
const FAKE_COMMENT_AUTHOR = 'rafa-fake';

/** The instant a run is stamped with unless a case says otherwise. */
const NOW = '2026-09-27T09:00:00Z';

/** That instant as the store holds it. */
const NOW_STORED = '2026-09-27T09:00:00.000Z';

/** A check at `state`, pointing at {@link RUN_ID}. */
function gates(state: string): { name: string; state: string; link: string } {
  return { name: 'gates', state, link: `https://github.com/open-tomato/rafa/actions/runs/${RUN_ID}/job/1` };
}

/** Pull request 41 on `headRefName`, its one check at `state`. */
function pull(state: string, headRefName: string = PLAN_BRANCH): FakePullRequestSeed {
  return { number: 41, title: 'q24: skills', headRefName, headRefOid: HEAD, checks: [gates(state)] };
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

/** A fake repository holding `seed`, the failing run's log and the fake's write access. */
function plantedFake(seed: FakePullRequestSeed): ReturnType<typeof createFakePrGh> {
  const fake = createFakePrGh({ now: () => '2026-09-27T09:00:05Z' });
  fake.plant(seed);
  fake.plantRun(RUN_ID, logFailedText('gates', ['##[error]Process completed with exit code 1.']));
  fake.plantPermission(FAKE_COMMENT_AUTHOR, 'admin');
  return fake;
}

/** Seams over `fake`, the clock answering `now` and the branch {@link PLAN_BRANCH}. */
function seamsOver(fake: ReturnType<typeof createFakePrGh>, now: string = NOW): TriageSeams {
  const pulls = createGhPullRequests({ gh: fake.run });
  return {
    pullRequests: () => pulls,
    readBranch: () => PLAN_BRANCH,
    readRemote: () => 'git@github.com:open-tomato/rafa.git',
    permissions: () => createGhPermissions({ gh: fake.run }),
    git: () => () => ({ ok: false, stdout: '', stderr: 'stub git: no such ref' }),
    now: () => now,
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

/** Dispatches `rafa pr triage 41` over `seams` from `project`. */
function triage(seams: TriageSeams, project: PlantedProject): Promise<CapturedRun> {
  return dispatchInProject(
    ['pr', 'triage', '41', '--no-hint'],
    [{ name: 'pr', summary: 'pull requests' }],
    [createPrTriageCommand(seams)],
    project,
  );
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

describe('rafa pr triage stores what the checks read', () => {
  it('stores a red reading under the plan the head branch resolves to in plan.dir', async () => {
    const project = freshProject();
    const run = await triage(seamsOver(plantedFake(pull('FAILURE'))), project);

    expect(run.exitCode).toBe(0);
    expect(storedRows(project)).toEqual([{
      plan_stub: PLAN_STUB,
      pr: 41,
      head_sha: HEAD,
      verdict: 'red',
      failing: '["gates"]',
      read_at: NOW_STORED,
    }]);
  });

  it('stores the branch stub verbatim when plan.dir holds no plan for it', async () => {
    const project = freshProject([]);
    const run = await triage(seamsOver(plantedFake(pull('FAILURE'))), project);

    expect(run.exitCode).toBe(0);
    expect(storedRows(project).map((row) => row.plan_stub)).toEqual(['q24']);
  });

  it('stores nothing for a queue id reaching two plans in plan.dir', async () => {
    const project = freshProject([PLAN_STUB, 'q24-another-plan']);
    const run = await triage(seamsOver(plantedFake(pull('FAILURE'))), project);

    expect(run.exitCode).toBe(0);
    expect(existsSync(sqliteStorePath(project.root))).toBe(false);
  });

  it('stores a green reading with no failing names', async () => {
    const project = freshProject();
    const run = await triage(seamsOver(plantedFake(pull('SUCCESS'))), project);

    expect(run.exitCode).toBe(0);
    expect(storedRows(project).map((row) => [row.verdict, row.failing])).toEqual([['green', '[]']]);
  });

  it('stores nothing, and creates no store, while a check is still running', async () => {
    const project = freshProject();
    const run = await triage(seamsOver(plantedFake(pull('IN_PROGRESS'))), project);

    expect(run.exitCode).toBe(0);
    expect(existsSync(sqliteStorePath(project.root))).toBe(false);
  });

  it('stores nothing for a head branch that names no plan', async () => {
    const project = freshProject();
    const run = await triage(seamsOver(plantedFake(pull('FAILURE', 'main'))), project);

    expect(run.exitCode).toBe(0);
    expect(existsSync(sqliteStorePath(project.root))).toBe(false);
  });

  it('stores a reading of a head the stored comment already assessed', async () => {
    const project = freshProject();
    const fake = plantedFake(pull('FAILURE'));
    const first = await triage(seamsOver(fake), project);
    const second = await triage(seamsOver(fake, '2026-09-27T10:00:00Z'), project);

    expect([first.exitCode, second.exitCode]).toEqual([0, 0]);
    // The first run assessed; the second assessed nothing, the head being the one the comment names.
    expect(first.stdout).toContain('Follow-up prompt:');
    expect(second.stdout).not.toContain('Follow-up prompt:');
    expect(second.stdout).toContain('already assessed at');
    expect(storedRows(project).map((row) => row.read_at)).toEqual([NOW_STORED, '2026-09-27T10:00:00.000Z']);
  });

  it('warns about a store it cannot write and still ends the triage 0', async () => {
    const project = freshProject();
    // A directory where the store file goes, so the store cannot be opened.
    mkdirSync(sqliteStorePath(project.root), { recursive: true });
    const run = await triage(seamsOver(plantedFake(pull('FAILURE'))), project);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('warn: the CI reading of #41 was not stored');
    expect(run.stdout).toContain('Posted the triage comment');
  });
});
