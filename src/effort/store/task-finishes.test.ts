/**
 * Tests for the finish reader (`effort/store/task-finishes.ts`).
 *
 * Every store sits under a fresh temporary repo root and is written
 * through the loop's own writers, `writeTaskReport` and
 * `writeReportAbsence`, with the clock and the row id handed in, so each
 * row's `collected_at` is known. Each row the reader answers sits beside
 * rows it passes over that differ from it in one column: another plan
 * stub, NULL against a stub, another outcome, and an earlier time. The
 * absence is `parseReport`'s own answer over an output with no report
 * block.
 */
import type { FindingOutcome } from './findings.js';
import type { ReportAbsent } from '../../report/parse.js';

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { parseReport } from '../../report/parse.js';

import { writeReportAbsence } from './absences.js';
import { writeTaskReport } from './reports.js';
import { SQLITE_SCHEMA_VERSION, sqliteStorePath } from './sqlite.js';
import { readTaskFinishes } from './task-finishes.js';

/** This file's scratch directory. */
const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-task-finishes-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let roots = 0;

/** A repo root under {@link tempRoot} that does not exist yet. */
function freshRoot(): string {
  roots += 1;
  return join(tempRoot, `root-${roots}`);
}

/** When the session every query reads from started. */
const START = '2026-09-15T12:00:00.000Z';

/** One row a case writes. */
interface Row {
  /** Its `collected_at`. */
  readonly at: string;
  readonly planStub: string | null;
  readonly outcome: FindingOutcome;
  /** Written as a report absence rather than a task report. */
  readonly absent?: boolean;
}

let rows = 0;

/** The absence `parseReport` answers for an output holding no report block. */
function noReport(): ReportAbsent {
  const reading = parseReport('The session ended without writing a report.');
  if (reading.present) throw new Error('parseReport read a report in an output holding none');
  return reading;
}

/** Writes `row` under `root` through the loop's own writer for its table. */
function write(root: string, row: Row): void {
  rows += 1;
  const dispatch = { sessionId: `task-session-${rows}`, planStub: row.planStub, taskLine: `- [ ] Task ${rows}` };
  const seams = { now: () => new Date(row.at), newId: () => `row-${rows}` };
  if (row.absent === true) {
    writeReportAbsence(root, { dispatch, outcome: row.outcome, absence: noReport() }, seams);
    return;
  }
  writeTaskReport(root, { dispatch, outcome: row.outcome, report: { status: 'done' } }, seams);
}

/** A root holding one row of each kind the reader answers or passes over. */
function plantedRoot(): string {
  const root = freshRoot();
  for (const row of [
    { at: '2026-09-15T12:10:00.000Z', planStub: 'demo', outcome: 'done' },
    { at: '2026-09-15T12:05:00.000Z', planStub: 'demo', outcome: 'done', absent: true },
    { at: '2026-09-15T12:20:00.000Z', planStub: 'demo', outcome: 'blocked' },
    { at: '2026-09-15T12:21:00.000Z', planStub: 'demo', outcome: 'failed', absent: true },
    { at: '2026-09-15T12:15:00.000Z', planStub: 'other', outcome: 'done' },
    { at: '2026-09-15T12:25:00.000Z', planStub: null, outcome: 'done' },
    { at: '2026-09-15T11:59:59.999Z', planStub: 'demo', outcome: 'done' },
    { at: START, planStub: 'demo', outcome: 'done', absent: true },
  ] satisfies Row[]) {
    write(root, row);
  }
  return root;
}

describe('readTaskFinishes', () => {
  it('answers none and creates nothing when no store exists', () => {
    const root = freshRoot();

    expect(readTaskFinishes(root, { planStub: 'demo', since: START })).toEqual([]);
    expect(existsSync(sqliteStorePath(root))).toBe(false);
  });

  it('answers the done rows of both tables for the plan from the start on, oldest first', () => {
    const root = plantedRoot();

    expect(readTaskFinishes(root, { planStub: 'demo', since: START })).toEqual([
      START,
      '2026-09-15T12:05:00.000Z',
      '2026-09-15T12:10:00.000Z',
    ]);
  });

  it('reads a start one millisecond earlier as taking in the row collected then', () => {
    const root = plantedRoot();

    expect(readTaskFinishes(root, { planStub: 'demo', since: '2026-09-15T11:59:59.999Z' })).toHaveLength(4);
  });

  it('reads NULL as a plan with no stub, and a stub as that stub alone', () => {
    const root = plantedRoot();

    expect(readTaskFinishes(root, { planStub: null, since: START })).toEqual(['2026-09-15T12:25:00.000Z']);
    expect(readTaskFinishes(root, { planStub: 'other', since: START })).toEqual(['2026-09-15T12:15:00.000Z']);
  });

  it('refuses a store past the last schema version, as a write does', () => {
    const root = freshRoot();
    const path = sqliteStorePath(root);
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path, { create: true });
    db.run(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION + 1}`);
    db.close();

    expect(() => readTaskFinishes(root, { planStub: 'demo', since: START })).toThrow();
  });
});
