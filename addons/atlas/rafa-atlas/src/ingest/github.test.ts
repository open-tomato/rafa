/**
 * Tests for the GitHub ingest over a stub `gh` answering fixture JSON
 * (`testdata/github.fixture.ts`), so no case runs `gh` or reaches the
 * network: the row parsers, the two list calls and their failures, and
 * whole builds over the effort, git and board fixtures in a tmpdir. A
 * build with `github` true fills `pr_facts`, the issue times, the stages
 * read with the closing pull requests, the third stretch shape's mark,
 * `plan_facts.merged_at` and `daily_rollup.prs_merged`; one without it
 * never calls the runner, which throws; one whose runner answers
 * `ok: false` stamps `local.prs` failed with `gh`'s stderr, names it in
 * no other stamp, and keeps every other bucket as the offline build has it.
 */
import type { BuildOptions, BuildSummary } from '../build/index.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { DAILY_SOURCE } from '../build/daily.js';
import { PLANS_SOURCE } from '../build/derive.js';
import { buildAtlas } from '../build/index.js';

import { ISSUES_SOURCE, LABELS_BASIS, PRS_BASIS } from './board.js';
import { MARKS_SOURCE } from './git.js';
import {
  GH_LIST_LIMIT,
  ISSUE_LIST_FIELDS,
  issueDatesOf,
  PR_LIST_FIELDS,
  PRS_SOURCE,
  pullRequestOf,
  readGithub,
  stretchHeadsOf,
} from './github.js';
import { writeBoardFixture } from './testdata/board-cache.fixture.js';
import { FIXTURE_PLAN, writeFactsFixture, writeFixtureStore } from './testdata/effort-store.fixture.js';
import { writeGitFixture } from './testdata/git-repo.fixture.js';
import {
  commitItem,
  failingGh,
  FIXTURE_GH_STDERR,
  FIXTURE_ISSUE_DATES,
  FIXTURE_MERGES_PER_DAY,
  FIXTURE_PR_MERGED_AT,
  FIXTURE_PRS,
  FIXTURE_PRS_AS_OF,
  fixtureGh,
  stubGh,
  throwingGh,
} from './testdata/github.fixture.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-github-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const BUILT_AT = new Date('2026-11-07T12:00:00.000Z');

/** A project under the scope with the effort, facts, git (plus the item commit) and board fixtures. */
function fixtureProject(name: string): string {
  const root = join(scope, name);
  writeFixtureStore(root);
  writeFactsFixture(root);
  writeGitFixture(root);
  commitItem(root);
  writeBoardFixture(root);
  return root;
}

/** Build `root` with `options` laid over the fixed clock and label. */
function buildOver(root: string, options: Partial<BuildOptions> = {}): Promise<BuildSummary> {
  return buildAtlas({ projectRoot: root, env: {}, now: () => BUILT_AT, projectLabel: 'github-fixture', ...options });
}

/** The rows `sql` answers in the replica of `summary`. */
function rowsOf(summary: BuildSummary, sql: string): Record<string, unknown>[] {
  const database = new Database(summary.replicaPath, { readonly: true });
  try {
    return database.query<Record<string, unknown>, []>(sql).all();
  } finally {
    database.close();
  }
}

/** The stamp of `source` in `summary`. */
function stampOf(summary: BuildSummary, source: string): BuildSummary['sources'][number] | undefined {
  return summary.sources.find((stamp) => stamp.source === source);
}

describe('pullRequestOf and issueDatesOf', () => {
  it('cuts a pull request to its columns: the submitted reviews, the first of them, and the issues it closes here', () => {
    const pr = pullRequestOf(FIXTURE_PRS[0]);

    expect(pr).toEqual({
      number: 7,
      title: 'Fixture pull request 7',
      headRef: 'rafa/atlas-fixture',
      baseRef: 'main',
      state: 'MERGED',
      createdAt: '2026-11-01T08:00:00.000Z',
      updatedAt: '2026-11-02T09:05:00.000Z',
      mergedAt: FIXTURE_PR_MERGED_AT,
      closedAt: '2026-11-02T09:00:00.000Z',
      additions: 3,
      deletions: 1,
      changedFiles: 2,
      reviewCount: 2,
      firstReviewAt: '2026-11-01T10:30:00.000Z',
      closingIssues: [7],
    });
  });

  it('leaves out an issue another repository holds, and reads no review as NULL', () => {
    const pr = pullRequestOf(FIXTURE_PRS[1]);

    expect(pr?.closingIssues).toEqual([42]);
    expect(pr?.reviewCount).toBe(0);
    expect(pr?.firstReviewAt).toBeNull();
  });

  it('refuses a row with no positive number or no known state, and an issue row with no number', () => {
    expect(pullRequestOf({ number: 0, state: 'OPEN' })).toBeNull();
    expect(pullRequestOf({ number: 3, state: 'DRAFT' })).toBeNull();
    expect(pullRequestOf('3')).toBeNull();
    expect(issueDatesOf({ number: 'x' })).toBeNull();
    expect(issueDatesOf(FIXTURE_ISSUE_DATES[2])).toEqual({
      number: 7,
      createdAt: '2026-10-20T09:00:00.000Z',
      closedAt: '2026-11-02T09:00:00.000Z',
    });
  });

  it('names each pull request whose head is stretch/<n>, and no other', () => {
    const prs = FIXTURE_PRS.map(pullRequestOf).filter((pr) => pr !== null);

    expect([...stretchHeadsOf(prs)]).toEqual([[61, '103']]);
  });
});

describe('readGithub over a stub runner', () => {
  it('lists every pull request, then every issue, with the fields and the limit it reads', async () => {
    const gh = fixtureGh();

    const read = await readGithub(gh.runner);

    expect(gh.calls).toEqual([
      ['pr', 'list', '--state', 'all', '--limit', String(GH_LIST_LIMIT), '--json', PR_LIST_FIELDS],
      ['issue', 'list', '--state', 'all', '--limit', String(GH_LIST_LIMIT), '--json', ISSUE_LIST_FIELDS],
    ]);
    expect(read.ok && read.prs.map((pr) => pr.number)).toEqual([7, 44, 45, 46, 61]);
    expect(read.ok && read.issues).toHaveLength(FIXTURE_ISSUE_DATES.length);
    expect(read.ok && read.skipped).toBe(0);
  });

  it('fails on a first call answering ok false, naming gh\'s stderr, and makes no second call', async () => {
    const gh = failingGh();

    const read = await readGithub(gh.runner);

    expect(read).toEqual({ ok: false, reason: `gh pr list failed: ${FIXTURE_GH_STDERR}` });
    expect(gh.calls).toHaveLength(1);
  });

  it('fails on a runner that throws, on output that is no JSON, and on JSON that is no list', async () => {
    const thrown = await readGithub(throwingGh().runner);
    const prose = await readGithub(stubGh(() => ({ ok: true, stdout: 'not json', stderr: '' })).runner);
    const object = await readGithub(stubGh(() => ({ ok: true, stdout: '{}', stderr: '' })).runner);

    expect(thrown).toEqual({ ok: false, reason: 'gh pr list could not run: the stub gh was called' });
    expect(prose.ok || prose.reason).toStartWith('gh pr list answered no JSON (');
    expect(object).toEqual({ ok: false, reason: 'gh pr list answered no JSON list' });
  });

  it('fails on a second call answering ok false, after the first answered', async () => {
    const gh = stubGh((args) => args[0] === 'pr'
      ? { ok: true, stdout: '[]', stderr: '' }
      : { ok: false, stdout: '', stderr: 'gh: issues are off here' });

    const read = await readGithub(gh.runner);

    expect(read).toEqual({ ok: false, reason: 'gh issue list failed: gh: issues are off here' });
    expect(gh.calls).toHaveLength(2);
  });
});

describe('buildAtlas with github true', () => {
  it('fills pr_facts with head_ref, first_review_at and closing_issues_json, and stamps local.prs whole', async () => {
    const summary = await buildOver(fixtureProject('prs'), { github: true, gh: fixtureGh().runner });

    const prs = rowsOf(summary, 'SELECT number, head_ref, state, review_count, first_review_at, closing_issues_json, plan_stub FROM pr_facts ORDER BY number');
    expect(prs).toEqual([
      { number: 7, head_ref: 'rafa/atlas-fixture', state: 'MERGED', review_count: 2, first_review_at: '2026-11-01T10:30:00.000Z', closing_issues_json: '[7]', plan_stub: FIXTURE_PLAN },
      { number: 44, head_ref: 'rafa/notes-page', state: 'OPEN', review_count: 0, first_review_at: null, closing_issues_json: '[42]', plan_stub: null },
      { number: 45, head_ref: 'rafa/claimed-bug', state: 'MERGED', review_count: 0, first_review_at: null, closing_issues_json: '[52]', plan_stub: null },
      { number: 46, head_ref: 'rafa/dropped', state: 'CLOSED', review_count: 0, first_review_at: null, closing_issues_json: '[53]', plan_stub: null },
      { number: 61, head_ref: 'stretch/103', state: 'MERGED', review_count: 0, first_review_at: null, closing_issues_json: '[]', plan_stub: null },
    ]);
    expect(stampOf(summary, PRS_SOURCE)).toEqual({
      source: PRS_SOURCE, asOf: FIXTURE_PRS_AS_OF, readAt: BUILT_AT.toISOString(), rows: 5, partial: false, reason: null,
    });
  });

  it('fills the issue times and reads each stage with its closing pull requests, a closed unmerged one left out', async () => {
    const summary = await buildOver(fixtureProject('issues'), { github: true, gh: fixtureGh().runner });

    const issues = rowsOf(summary, 'SELECT number, stage, stage_basis, created_at, closed_at FROM issue_facts WHERE number IN (7, 42, 52, 53) ORDER BY number');
    expect(issues).toEqual([
      { number: 7, stage: 'Done', stage_basis: PRS_BASIS, created_at: '2026-10-20T09:00:00.000Z', closed_at: '2026-11-02T09:00:00.000Z' },
      { number: 42, stage: 'Waiting for approval', stage_basis: PRS_BASIS, created_at: '2026-10-02T09:00:00.000Z', closed_at: null },
      { number: 52, stage: 'Done', stage_basis: PRS_BASIS, created_at: '2026-10-24T09:00:00.000Z', closed_at: null },
      { number: 53, stage: 'Backlog', stage_basis: PRS_BASIS, created_at: '2026-10-25T09:00:00.000Z', closed_at: null },
    ]);
    const snapshot = rowsOf(summary, 'SELECT stage, count FROM board_snapshot WHERE stage IN (\'Waiting for approval\', \'Ready\', \'Claimed\') ORDER BY stage');
    expect(snapshot).toEqual([{ stage: 'Claimed', count: 0 }, { stage: 'Ready', count: 0 }, { stage: 'Waiting for approval', count: 1 }]);
    expect(stampOf(summary, ISSUES_SOURCE)).toEqual(expect.objectContaining({ partial: false, reason: null }));
  });

  it('control: the same project built offline reads the stages from the labels alone, with no times', async () => {
    const summary = await buildOver(fixtureProject('issues-offline'));

    const issues = rowsOf(summary, 'SELECT number, stage, stage_basis, created_at FROM issue_facts WHERE number IN (42, 52) ORDER BY number');
    expect(issues).toEqual([
      { number: 42, stage: 'Ready', stage_basis: LABELS_BASIS, created_at: null },
      { number: 52, stage: 'Claimed', stage_basis: LABELS_BASIS, created_at: null },
    ]);
  });

  it('counts in local.issues the cached issues gh listed no times for', async () => {
    const dated = FIXTURE_ISSUE_DATES.filter((issue) => issue['number'] !== 53);
    const summary = await buildOver(fixtureProject('undated'), { github: true, gh: fixtureGh(FIXTURE_PRS, dated).runner });

    expect(rowsOf(summary, 'SELECT created_at FROM issue_facts WHERE number = 53')).toEqual([{ created_at: null }]);
    expect(stampOf(summary, ISSUES_SOURCE)?.reason).toBe('gh issue list gave no times for 1 cached issues; their created_at, closed_at read NULL');
  });

  it('marks the third stretch shape through the head ref of the pull request its subject names last', async () => {
    const summary = await buildOver(fixtureProject('marks'), { github: true, gh: fixtureGh().runner });
    const offline = await buildOver(fixtureProject('marks-offline'));

    const marks = rowsOf(summary, 'SELECT number, part, lane, ended_at, pr_number FROM stretch_marks ORDER BY ended_at');
    expect(marks.at(-1)).toEqual({ number: 103, part: 1, lane: 'M', ended_at: '2026-11-06T10:00:00.000Z', pr_number: 61 });
    expect(marks).toHaveLength(5);
    expect(rowsOf(offline, 'SELECT number FROM stretch_marks WHERE number = 103')).toEqual([]);
    expect(stampOf(summary, MARKS_SOURCE)?.rows).toBe(5);
    expect(stampOf(offline, MARKS_SOURCE)?.rows).toBe(4);
  });

  it('fills plan_facts.merged_at and daily_rollup.prs_merged, and drops both from the stamps', async () => {
    const summary = await buildOver(fixtureProject('derived'), { github: true, gh: fixtureGh().runner });

    expect(rowsOf(summary, 'SELECT plan_stub, pr_number, merged_at FROM plan_facts')).toEqual([
      { plan_stub: FIXTURE_PLAN, pr_number: 7, merged_at: FIXTURE_PR_MERGED_AT },
    ]);
    const merges = rowsOf(summary, 'SELECT day, prs_merged FROM daily_rollup WHERE prs_merged > 0 ORDER BY day');
    expect(Object.fromEntries(merges.map((row) => [row['day'], row['prs_merged']]))).toEqual(FIXTURE_MERGES_PER_DAY);
    expect(rowsOf(summary, 'SELECT count(*) AS n FROM daily_rollup WHERE prs_merged IS NULL')).toEqual([{ n: 0 }]);
    expect(stampOf(summary, DAILY_SOURCE)?.reason ?? '').not.toContain('prs_merged');
    expect(stampOf(summary, PLANS_SOURCE)?.reason ?? '').not.toContain('merged_at');
  });
});

describe('buildAtlas without github, and with a failed read (D18)', () => {
  it('never calls the runner without github true, and stamps local.prs not read', async () => {
    const gh = throwingGh();

    const summary = await buildOver(fixtureProject('no-flag'), { gh: gh.runner });

    expect(gh.calls).toEqual([]);
    expect(summary.tables).toEqual(expect.objectContaining({ pr_facts: 0 }));
    expect(stampOf(summary, PRS_SOURCE)).toEqual(expect.objectContaining({ rows: 0, partial: true, reason: 'not read: the build ran without --github' }));
    expect(stampOf(summary, DAILY_SOURCE)?.reason).toContain('prs_merged is not read yet');
  });

  it('control: the same throwing runner is called under github true, and its throw is the failure', async () => {
    const gh = throwingGh();

    const summary = await buildOver(fixtureProject('flag-throws'), { github: true, gh: gh.runner });

    expect(gh.calls).toHaveLength(1);
    expect(stampOf(summary, PRS_SOURCE)?.reason).toContain('gh pr list could not run: the stub gh was called');
  });

  it('stamps local.prs failed with gh\'s stderr, names it in no other stamp, and keeps every other bucket as offline', async () => {
    const failed = await buildOver(fixtureProject('failed'), { github: true, gh: failingGh().runner });
    const offline = await buildOver(fixtureProject('failed-offline'));

    const stamp = stampOf(failed, PRS_SOURCE);
    expect(stamp).toEqual(expect.objectContaining({ rows: 0, partial: true, asOf: null }));
    expect(stamp?.reason).toBe(`the GitHub read failed, so every other source is built as without --github: gh pr list failed: ${FIXTURE_GH_STDERR}`);
    expect(failed.sources.filter((each) => (each.reason ?? '').includes(FIXTURE_GH_STDERR))).toHaveLength(1);
    expect(failed.tables).toEqual(offline.tables);
    expect(failed.sources.filter((each) => each.source !== PRS_SOURCE)).toEqual(offline.sources.filter((each) => each.source !== PRS_SOURCE));
    expect(rowsOf(failed, 'SELECT DISTINCT stage_basis FROM issue_facts')).toEqual([{ stage_basis: LABELS_BASIS }]);
  });
});
