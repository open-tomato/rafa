/**
 * Tests for the trend report's readers (`report-trend-read.ts`):
 * `readTrendInputs` over projects planted under a temporary directory, with
 * an empty home beside each, and `trendReportOf` over hand-built inputs.
 *
 * The rows are stored as the collector's JSON holds them, the outcomes as
 * the loop's task report writer stores them, and the agents through the
 * dispatch writer from a task line declaring `{agent=...}`.
 */
import type { TrendInputs } from './report-trend-read.js';
import type { TrendOptions, TrendSessionRow } from './report-trend.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { ConfigError } from '../config.js';
import { plantProject, plantProjectConfig } from '../tests/cli-capture.js';
import { parseTaskDeclaration, resolveDeclarationFlags } from '../utils/declaration.js';

import { readTrendInputs, trendReportOf } from './report-trend-read.js';
import { summariseTrend } from './report-trend.js';
import { emptyUsageTotals } from './session-log.js';
import { writeDispatch } from './store/dispatches.js';
import { writeTaskReport } from './store/reports.js';
import { sqliteStorePath, withSqliteStore } from './store/sqlite.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-trend-read-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const OPTIONS: TrendOptions = { days: 3, recentDays: 2, loops: null, by: null };

/** A task session of ten minutes on 2026-09-20. */
function row(sessionId: string, planStub: string | null): TrendSessionRow {
  return {
    sessionId,
    planStub,
    branch: null,
    kind: 'task',
    assistantRecordCount: 2,
    firstTimestamp: '2026-09-20T10:00:00.000Z',
    lastTimestamp: '2026-09-20T10:10:00.000Z',
    entrypointCounts: {},
    modelCounts: {},
    usage: emptyUsageTotals(),
  };
}

/** A project of a case's own. */
function plant(): ReturnType<typeof plantProject> {
  return plantProject(realpathSync(mkdtempSync(join(tempBase, 'case-'))));
}

/** Stores `sessions` as rows of the SQLite store's session table, the default backend. */
function storeRows(root: string, sessions: readonly TrendSessionRow[]): void {
  withSqliteStore(sqliteStorePath(root), 'write', true, (db) => {
    for (const session of sessions) {
      db.run('INSERT INTO sessions (session_id, row_json) VALUES (?, ?)', [session.sessionId, JSON.stringify(session)]);
    }
  });
}

/** Stores a dispatch of `sessionId` whose task line declares `agent`. */
function storeAgent(root: string, sessionId: string, agent: string): void {
  const { text, declaration } = parseTaskDeclaration(`Do it  {agent=${agent}}`);
  writeDispatch(root, {
    sessionId,
    planStub: 'demo',
    taskLine: text,
    declaration,
    flags: resolveDeclarationFlags(declaration, () => false).args,
  });
}

describe('readTrendInputs', () => {
  it('answers no rows, outcomes or agents for a project with no store', () => {
    const { root, home } = plant();

    const inputs = readTrendInputs(root, home);

    expect([...inputs.rows]).toEqual([]);
    expect(inputs.outcomes.size).toBe(0);
    expect(inputs.agents.size).toBe(0);
  });

  it('reads the stored session rows, each session\'s reported outcome and its dispatched agent by session id', () => {
    const { root, home } = plant();
    storeRows(root, [row('s-1', 'demo'), row('s-2', 'demo')]);
    writeTaskReport(root, {
      dispatch: { sessionId: 's-1', planStub: 'demo', taskLine: '- [ ] A task' },
      outcome: 'blocked',
      report: { status: 'done' },
    });
    storeAgent(root, 's-2', 'tdd-guide');

    const inputs = readTrendInputs(root, home);

    expect(inputs.rows.map((stored) => stored.sessionId)).toEqual(['s-1', 's-2']);
    expect(inputs.outcomes.get('s-1')).toBe('blocked');
    expect(inputs.outcomes.has('s-2')).toBe(false);
    expect(inputs.agents.get('s-2')).toBe('tdd-guide');
    expect(inputs.agents.has('s-1')).toBe(false);
  });

  it('throws a ConfigError, reading no row, for a config the loop cannot run on', () => {
    const { root, home } = plant();
    plantProjectConfig(root, 'not: [valid\n');

    expect(() => readTrendInputs(root, home)).toThrow(ConfigError);
  });
});

describe('trendReportOf', () => {
  it('answers what summariseTrend answers over the same rows, outcomes and agents', () => {
    const inputs: TrendInputs = {
      rows: [row('s-1', 'demo'), row('s-2', 'other')],
      outcomes: new Map([['s-1', 'done']]),
      agents: new Map([['s-2', 'coder']]),
    };

    expect(trendReportOf(inputs, OPTIONS)).toEqual(summariseTrend(inputs.rows, inputs.outcomes, inputs.agents, OPTIONS));
  });

  it('reads the same inputs under different options without changing them', () => {
    const inputs: TrendInputs = { rows: [row('s-1', 'demo'), row('s-2', 'other')], outcomes: new Map(), agents: new Map() };

    const narrow = trendReportOf(inputs, { ...OPTIONS, loops: 1 });
    const wide = trendReportOf(inputs, { ...OPTIONS, loops: 5 });

    expect(narrow.loops.rows).toHaveLength(1);
    expect(wide.loops.rows).toHaveLength(2);
    expect(inputs.rows).toHaveLength(2);
  });
});
