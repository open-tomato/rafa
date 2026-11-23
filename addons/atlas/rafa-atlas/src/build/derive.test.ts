/**
 * Tests for `derive.ts`: the work type each session reads from its change
 * level (D4), `plan_facts` with its repeat and ci-repair sessions, and the
 * count columns of `daily_rollup`, whose day sums are checked against
 * sums taken in TypeScript over the replica's `task_facts`. Each reading
 * that could pass over empty tables has a fixed value beside it.
 *
 * The fixture is the ingest's store (`writeFixtureStore` and
 * `writeFactsFixture`) widened through core's writers with a third
 * attempt of the fixture's task line, a ci-repair session of the plan, a
 * wrap-up session of a plan with no file, and three preflight runs, one on
 * a day no session started on. The plan folder is planted under the root.
 * No row is copied from a real store.
 */
import type { Derivation } from './derive.js';
import type { ReportChange } from '@open-tomato/rafa-core/report/parse';
import type { PreflightCheck } from '@open-tomato/rafa-core/store/preflight-check';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openReplica, writeReplica } from '@open-tomato/atlas-data/replica';
import { writeChanges } from '@open-tomato/rafa-core/store/changes';
import { writeDispatch } from '@open-tomato/rafa-core/store/dispatches';
import { writePreflightChecks } from '@open-tomato/rafa-core/store/preflight';
import { writeTaskReport } from '@open-tomato/rafa-core/store/reports';
import { openSqliteStore } from '@open-tomato/rafa-core/store/sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { ingestEffort, TASKS_SOURCE } from '../ingest/effort.js';
import { DEFAULT_PLAN_DIR } from '../ingest/plans.js';
import {
  FIXTURE_PLAN,
  FIXTURE_TASK_LINE,
  sessionRow,
  TASK_SESSIONS,
  withFixtureDatabase,
  writeFactsFixture,
  writeFixtureStore,
} from '../ingest/testdata/effort-store.fixture.js';

import { DAILY_SOURCE } from './daily.js';
import { CHANGE_LEVELS, deriveBuild, deriveWorkType, PLANS_SOURCE, UNREAD_DAILY_COLUMNS, UNREAD_PLAN_COLUMNS } from './derive.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-build-derive-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** The third attempt of the fixture's task line, done, reporting a `none` change. */
const THIRD_ATTEMPT = 'session-task-3';
const REPAIR_SESSION = 'session-repair';
const WRAP_SESSION = 'session-wrap-gone';

/** A plan the wrap-up session names and no file holds. */
const GONE_PLAN = 'gone-plan';

/** A plan the folder holds with every task done and no session. */
const DONE_PLAN = 'done-plan';

/** The day only a preflight run is on. */
const PREFLIGHT_ONLY_DAY = '2026-11-05';

type Row = Readonly<Record<string, string | number | null>>;

/** What one build of the fixture holds. */
interface Built {
  readonly derivation: Derivation;
  readonly facts: readonly Row[];
  readonly changes: readonly Row[];
  readonly plans: readonly Row[];
  readonly days: readonly Row[];
}

/** A plan document with `issue` in its header and one task line per entry of `boxes`. */
function planText(stub: string, issue: string, boxes: readonly string[]): string {
  const tasks = boxes.map((box, index) => `- ${box} Task ${String(index + 1)}`);
  return [`# Plan: ${stub}`, '', '```rafa:plan', `stub: ${stub}`, `issue: "${issue}"`, '```', '', '## Stage one', '', ...tasks, ''].join('\n');
}

/** A change entry of `level`, as `parseReport` answers one. */
function change(level: ReportChange['level'], summary: string): ReportChange {
  return { level, area: null, summary, extras: [] };
}

/** A preflight check of `tier` with `outcome`, as `runPreflight` answers one. */
function check(tier: PreflightCheck['tier'], outcome: PreflightCheck['outcome']): PreflightCheck {
  return {
    tier,
    item: { kind: 'tool', name: 'bun', probe: null },
    outcome,
    durationMs: 5,
    failure: outcome === 'pass'
      ? null
      : 'bun is not on PATH',
  };
}

/** The third attempt's session, dispatch, report and change, through core's writers. */
function writeThirdAttempt(root: string): void {
  const at = { now: () => new Date('2026-11-04T09:21:00.000Z') };
  const dispatch = { sessionId: THIRD_ATTEMPT, planStub: FIXTURE_PLAN, taskLine: FIXTURE_TASK_LINE };
  writeDispatch(root, { ...dispatch, declaration: null, flags: [] }, at);
  writeTaskReport(root, { dispatch, outcome: 'done', report: { status: 'done', skillsUsed: [] } }, at);
  writeChanges(root, { dispatch, changes: [change('none', 'the fixture notes')] }, at);
}

/** The fixture store under `root`, widened as the module note says, and its plan folder. */
function writeDeriveFixture(root: string): void {
  writeFixtureStore(root);
  writeFactsFixture(root);
  openSqliteStore(root).append('sessions', [
    sessionRow({ sessionId: THIRD_ATTEMPT, kind: 'task', first: '2026-11-04T09:00:00.000Z', last: '2026-11-04T09:20:00.000Z' }),
    {
      ...sessionRow({ sessionId: REPAIR_SESSION, kind: 'ci-repair', first: '2026-11-03T11:00:00.000Z', last: '2026-11-03T11:10:00.000Z' }),
      planStub: FIXTURE_PLAN,
    },
    {
      ...sessionRow({ sessionId: WRAP_SESSION, kind: 'wrap-up', first: '2026-11-02T12:00:00.000Z', last: '2026-11-02T12:20:00.000Z' }),
      planStub: GONE_PLAN,
    },
  ]);
  writeThirdAttempt(root);
  const run = (runId: string, at: string, checks: readonly PreflightCheck[]): void => {
    writePreflightChecks(root, { runId, checks }, { now: () => new Date(at) });
  };
  run('run-pass', '2026-11-02T09:00:00.000Z', [check('required', 'pass')]);
  run('run-halt', '2026-11-03T09:00:00.000Z', [check('optional', 'pass'), check('required', 'fail')]);
  run('run-warn', `${PREFLIGHT_ONLY_DAY}T09:00:00.000Z`, [check('required', 'pass'), check('optional', 'timeout')]);
  const planDir = join(root, DEFAULT_PLAN_DIR);
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, `PLAN_TRACKER-${FIXTURE_PLAN}.md`), planText(FIXTURE_PLAN, '42', ['[x]', '[x]', '[BLOCKED]', '[ ]']));
  writeFileSync(join(planDir, `PLAN-${DONE_PLAN}.md`), planText(DONE_PLAN, '#7', ['[x]', '[x]']));
}

/** Build the fixture under a fresh root, `widen` run on it first; answers the derivation and the replica's rows. */
async function build(name: string, widen: (root: string) => void = () => undefined): Promise<Built> {
  const root = join(scope, name);
  writeDeriveFixture(root);
  widen(root);
  const replicaPath = join(root, '.rafa', 'atlas', 'atlas.sqlite');
  const result = await writeReplica({ replicaPath, projectLabel: 'fixture' }, (replica) => {
    const effort = ingestEffort(replica, { root, env: {} });
    return deriveBuild(replica, { planDir: join(root, DEFAULT_PLAN_DIR), snapshotPath: effort.snapshot.snapshotPath, stamps: effort.stamps });
  });
  const reader = openReplica(replicaPath);
  try {
    const { database } = reader.current();
    const all = (sql: string): Row[] => database.query<Row, []>(sql).all();
    return {
      derivation: result.value,
      facts: all('SELECT * FROM task_facts ORDER BY session_id'),
      changes: all('SELECT * FROM change_facts'),
      plans: all('SELECT * FROM plan_facts ORDER BY plan_stub'),
      days: all('SELECT * FROM daily_rollup ORDER BY day'),
    };
  } finally {
    reader.close();
  }
}

let main: Promise<Built> | undefined;

/** The fixture's one build, shared by the cases that only read it. */
function mainBuild(): Promise<Built> {
  main ??= build('main');
  return main;
}

/** The row of `rows` whose `key` is `value`, or a failed expectation. */
function rowOf(rows: readonly Row[], key: string, value: string): Row {
  const row = rows.find((each) => each[key] === value);
  expect(row).toBeDefined();
  return row ?? {};
}

describe('deriveWorkType, work type from change level', () => {
  it('reads each level as its work type, the highest of a session\'s changes winning, and NULL with no known level', async () => {
    const replicaPath = join(scope, 'bare', 'atlas.sqlite');
    const sessions: readonly (readonly [string, readonly string[]])[] = [
      ['s-major', ['major']],
      ['s-minor', ['minor']],
      ['s-patch', ['patch']],
      ['s-none', ['none']],
      ['s-mixed', ['none', 'minor', 'patch']],
      ['s-fix-and-notes', ['none', 'patch']],
      ['s-unknown', ['huge']],
      ['s-no-change', []],
    ];
    const result = await writeReplica({ replicaPath, projectLabel: 'bare' }, (replica) => {
      const { database } = replica;
      sessions.forEach(([sessionId, levels]) => {
        database.run('INSERT INTO task_facts (session_id, kind, branch_type) VALUES (?, \'task\', \'feat\')', [sessionId]);
        levels.forEach((level, index) => {
          database.run('INSERT INTO change_facts (id, session_id, level) VALUES (?, ?, ?)', [`${sessionId}-${String(index)}`, sessionId, level]);
        });
      });
      const typed = deriveWorkType(database);
      const rows = database.query<{ readonly session_id: string; readonly work_type: string | null }, []>(
        'SELECT session_id, work_type FROM task_facts ORDER BY rowid',
      ).all();
      return { typed, rows };
    });

    expect(Object.fromEntries(result.value.rows.map((row) => [row.session_id, row.work_type]))).toEqual({
      's-major': 'feature',
      's-minor': 'feature',
      's-patch': 'fix',
      's-none': 'chore',
      's-mixed': 'feature',
      's-fix-and-notes': 'fix',
      's-unknown': null,
      's-no-change': null,
    });
    expect(result.value.typed).toBe(6);
  });

  it('names the four levels a report may give, minor as feature, patch as fix and none as chore', () => {
    expect(Object.fromEntries(Object.entries(CHANGE_LEVELS).map(([level, { workType }]) => [level, workType])))
      .toEqual({ major: 'feature', minor: 'feature', patch: 'fix', none: 'chore' });
  });

  it('types the fixture\'s sessions by the change each reported, though every one is on a feat branch', async () => {
    const { facts, derivation } = await mainBuild();

    const typeOf = (sessionId: string): unknown => rowOf(facts, 'session_id', sessionId).work_type;
    expect([typeOf(TASK_SESSIONS[0]), typeOf(TASK_SESSIONS[1]), typeOf(THIRD_ATTEMPT)]).toEqual(['fix', 'feature', 'chore']);
    expect(typeOf(REPAIR_SESSION)).toBeNull();
    expect(derivation.workTyped).toBe(3);
  });

  it('control: branch_type is feat on every session, so it could not have split them', async () => {
    const { facts } = await mainBuild();

    expect(new Set(facts.map((fact) => fact.branch_type))).toEqual(new Set(['feat']));
  });
});

describe('deriveBuild, plan_facts', () => {
  it('derives the fixture plan from its tracker, its sessions and its CI readings', async () => {
    const { plans } = await mainBuild();

    expect(rowOf(plans, 'plan_stub', FIXTURE_PLAN)).toEqual(expect.objectContaining({
      plan_source: 'tracker',
      issue_number: 42,
      epic_slug: null,
      tasks_planned: 4,
      tasks_done: 2,
      tasks_blocked: 1,
      sessions: 4,
      task_sessions: 3,
      reports_done: 2,
      reports_blocked: 1,
      repeat_sessions: 2,
      ci_repair_sessions: 1,
      first_at: '2026-11-02T10:00:00.000Z',
      last_at: '2026-11-04T09:20:00.000Z',
      minutes: 30 + 45 + 20 + 10,
      ci_last_verdict: 'red',
      ci_red_readings: 3,
      pr_number: 7,
      merged_at: null,
      completed: 0,
    }));
  });

  it('counts as repeat sessions the task sessions past the first attempt of their task line', async () => {
    const { facts, plans } = await mainBuild();

    const attempts = facts
      .filter((fact) => fact.plan_stub === FIXTURE_PLAN && fact.kind === 'task')
      .map((fact) => fact.attempt)
      .sort();
    expect(attempts).toEqual([1, 2, 3]);
    expect(rowOf(plans, 'plan_stub', FIXTURE_PLAN).repeat_sessions).toBe(attempts.filter((attempt) => Number(attempt) > 1).length);
  });

  it('control: the ci-repair session is not a repeat, and the plan\'s first attempt is not one', async () => {
    const { facts } = await mainBuild();

    expect(rowOf(facts, 'session_id', REPAIR_SESSION)).toEqual(expect.objectContaining({ kind: 'ci-repair', attempt: null }));
    expect(rowOf(facts, 'session_id', TASK_SESSIONS[0]).attempt).toBe(1);
  });

  it('sums each plan\'s minutes and tokens to the task sums of its sessions', async () => {
    const { facts, plans } = await mainBuild();

    for (const plan of plans) {
      const own = facts.filter((fact) => fact.plan_stub === plan.plan_stub);
      if (own.length === 0) {
        expect(plan).toEqual(expect.objectContaining({ sessions: 0, minutes: null, tokens: null, first_at: null }));
        continue;
      }
      expect(plan.minutes).toBeCloseTo(own.reduce((sum, fact) => sum + Number(fact.minutes ?? 0), 0), 9);
      expect(plan.tokens).toBe(own.reduce((sum, fact) => sum + Number(fact.tokens ?? 0), 0));
      expect(plan.sessions).toBe(own.length);
    }
    expect(Number(rowOf(plans, 'plan_stub', FIXTURE_PLAN).tokens)).toBeGreaterThan(0);
  });

  it('reads a plan with every task done as completed, and one the store names with no file as missing', async () => {
    const { plans } = await mainBuild();

    expect(plans.map((plan) => plan.plan_stub)).toEqual([FIXTURE_PLAN, DONE_PLAN, GONE_PLAN]);
    expect(rowOf(plans, 'plan_stub', DONE_PLAN)).toEqual(expect.objectContaining({
      plan_source: 'plan', issue_number: 7, tasks_planned: 2, tasks_done: 2, completed: 1, ci_last_verdict: null, ci_red_readings: 0,
    }));
    expect(rowOf(plans, 'plan_stub', GONE_PLAN)).toEqual(expect.objectContaining({
      plan_source: 'missing', tasks_planned: null, tasks_done: null, sessions: 1, task_sessions: 0, completed: 0,
    }));
  });

  it('stamps local.plans partial, naming the columns no source fills', async () => {
    const { derivation, plans } = await mainBuild();

    const stamp = derivation.stamps.find((each) => each.source === PLANS_SOURCE);
    expect(stamp).toEqual(expect.objectContaining({ rows: plans.length, partial: true }));
    for (const column of UNREAD_PLAN_COLUMNS) expect(stamp?.reason).toContain(column);
    expect(stamp?.asOf).not.toBeNull();
  });
});

/** The `task_facts` figure each count column sums, over the sessions of one day. */
const DAY_FIGURES: Readonly<Record<string, (facts: readonly Row[], changes: readonly Row[]) => number>> = {
  sessions: (facts) => facts.length,
  task_sessions: (facts) => facts.filter((fact) => fact.kind === 'task').length,
  tasks_done: (facts) => facts.filter((fact) => fact.kind === 'task' && fact.status === 'done').length,
  tasks_blocked: (facts) => facts.filter((fact) => fact.kind === 'task' && fact.status === 'blocked').length,
  findings: (facts) => facts.reduce((sum, fact) => sum + Number(fact.findings), 0),
  bugs: (facts) => facts.reduce((sum, fact) => sum + Number(fact.bugs), 0),
  changes: (facts, changes) => changes.filter((each) => facts.some((fact) => fact.session_id === each.session_id)).length,
};

describe('deriveBuild, the count columns of daily_rollup', () => {
  it('sums each day\'s counts to the task sums over the sessions that started on it', async () => {
    const { facts, changes, days } = await mainBuild();

    for (const row of days) {
      const own = facts.filter((fact) => fact.day === row.day);
      for (const [column, figure] of Object.entries(DAY_FIGURES)) expect([row.day, column, row[column]]).toEqual([row.day, column, figure(own, changes)]);
    }
  });

  it('equals the task sums across all days, over the sessions that have a day', async () => {
    const { facts, changes, days } = await mainBuild();

    const dated = facts.filter((fact) => fact.day !== null);
    for (const [column, figure] of Object.entries(DAY_FIGURES)) {
      expect([column, days.reduce((sum, row) => sum + Number(row[column]), 0)]).toEqual([column, figure(dated, changes)]);
    }
  });

  it('control: the sums run over filled days, with known values for two of them', async () => {
    const { days } = await mainBuild();

    expect(rowOf(days, 'day', '2026-11-02')).toEqual(expect.objectContaining({
      sessions: 2, task_sessions: 1, tasks_done: 0, tasks_blocked: 1, findings: 2, bugs: 1, changes: 1,
    }));
    expect(rowOf(days, 'day', '2026-11-03')).toEqual(expect.objectContaining({
      sessions: 2, task_sessions: 1, tasks_done: 1, tasks_blocked: 0, findings: 1, bugs: 2, changes: 1,
    }));
  });

  it('counts preflight runs and halts per day, adding a row for a day only a preflight ran on', async () => {
    const { days } = await mainBuild();

    const preflight = Object.fromEntries(days.map((row) => [row.day, [row.preflight_runs, row.preflight_halts]]));
    expect(preflight).toEqual({
      '2026-10-30': [0, 0],
      '2026-11-01': [0, 0],
      '2026-11-02': [1, 0],
      '2026-11-03': [1, 1],
      '2026-11-04': [0, 0],
      [PREFLIGHT_ONLY_DAY]: [1, 0],
    });
    expect(rowOf(days, 'day', PREFLIGHT_ONLY_DAY)).toEqual(expect.objectContaining({
      sessions: 0, minutes_task: 0, minutes_other: 0, tokens_task: 0, tokens_total: 0, changes: 0,
    }));
  });

  it('leaves commits and prs_merged NULL and stamps local.daily partial, naming them and no input', async () => {
    const { derivation, days } = await mainBuild();

    for (const row of days) {
      for (const column of UNREAD_DAILY_COLUMNS) expect(row[column]).toBeNull();
    }
    const stamp = derivation.stamps.find((each) => each.source === DAILY_SOURCE);
    expect(stamp).toEqual(expect.objectContaining({ rows: days.length, partial: true }));
    expect(stamp?.reason).toContain('commits, prs_merged');
    expect(stamp?.reason).not.toContain(TASKS_SOURCE);
    expect(stamp?.reason).not.toContain('preflight');
  });

  it('reads the preflight columns NULL when the store has no preflight table, and names it in the stamp', async () => {
    const { derivation, days } = await build('no-preflight', (root) => {
      withFixtureDatabase(root, (database) => database.run('DROP TABLE preflight'));
    });

    expect(days.map((row) => row.day)).not.toContain(PREFLIGHT_ONLY_DAY);
    for (const row of days) expect([row.preflight_runs, row.preflight_halts]).toEqual([null, null]);
    expect(derivation.preflight.days).toBeNull();
    expect(derivation.stamps.find((each) => each.source === DAILY_SOURCE)?.reason).toContain('preflight.run_id');
  });
});

describe('deriveBuild, refused', () => {
  it('refuses a call with no local.tasks stamp', async () => {
    const replicaPath = join(scope, 'refused', 'atlas.sqlite');

    await expect(writeReplica({ replicaPath, projectLabel: 'refused' }, (replica) => deriveBuild(replica, {
      planDir: join(scope, 'refused'),
      snapshotPath: join(scope, 'refused', 'none.sqlite'),
      stamps: [],
    }))).rejects.toThrow(TASKS_SOURCE);
  });
});
