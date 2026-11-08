/**
 * Tests for the bug-fix join's store reader (`bug-fix-rows.ts`).
 *
 * Every case writes a fixture store of its own under the system's
 * temporary directory, through the writers the loop stores a report with
 * (`writeFindings`, `writeTriage`, `writeTrackerRef`, `writeTaskReport`),
 * so each row holds what those writers put there and not what a case
 * planted. None opens `.rafa/effort/`.
 *
 * Each case that expects a row left out holds a row beside it that is
 * read, so an empty list cannot come from a store that was never read.
 */
import type { ReportBug, ReportFinding } from '@open-tomato/rafa/report/parse';
import type { FindingsDispatch } from '@open-tomato/rafa/store/findings';

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeFindings } from '@open-tomato/rafa/store/findings';
import { writeTaskReport } from '@open-tomato/rafa/store/reports';
import { sqliteStorePath } from '@open-tomato/rafa/store/sqlite';
import { writeTrackerRef } from '@open-tomato/rafa/store/tracker-refs';
import { writeTriage } from '@open-tomato/rafa/store/triage';
import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { readBugFixRows } from './bug-fix-rows.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-bug-fix-rows-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A root of its own under the suite's temporary directory, holding no store. */
function freshRoot(): string {
  planted += 1;
  return join(tempRoot, `${planted}-repo`);
}

/** A clock fixed at `iso`, as the writers' `now` seam takes one. */
function at(iso: string): { now: () => Date } {
  return { now: () => new Date(iso) };
}

/** A finding as `parseReport` answers one. */
function finding(fields: Partial<ReportFinding>): ReportFinding {
  return {
    trigger: 'when the fixture runs',
    kind: 'gotcha',
    what: 'the fixture finding',
    cause: null,
    resolution: null,
    artifact: null,
    signal: 'loud',
    domain: null,
    extras: [],
    ...fields,
  };
}

/** A bug as `parseReport` answers one. */
function bug(what: string, artifact: string | null): ReportBug {
  return {
    what, artifact, security: false, kind: 'bug', module: null, action: null, reproduce: null, cause: null, extras: [],
  };
}

const FILING: FindingsDispatch = {
  sessionId: 'session-filing',
  planStub: 'rafa-1400-sweep',
  taskLine: 'Sweep the readers',
};

const FIXING: FindingsDispatch = {
  sessionId: 'session-fixing',
  planStub: 'rafa-12-fix-reader',
  taskLine: 'Fix the reader #12',
};

const BYSTANDER: FindingsDispatch = {
  sessionId: 'session-bystander',
  planStub: 'rafa-1401-other',
  taskLine: 'Another task',
};

const BUG_ARTIFACT = 'expected 2, received 1';
const BUG_KEY = `PLAN_TRACKER-rafa-1400-sweep.md: ${BUG_ARTIFACT}`;
const GITHUB_REF = { opt: 12, kind: 'github', externalId: '12', url: 'https://github.com/o/r/issues/12' } as const;

/**
 * The fixture: a filing session that files one bug, a fixing session
 * that resolves it and reports `done`, and a bystander whose rows match
 * none of the four selections but sit beside rows that do.
 */
function plantStore(root: string): void {
  writeTriage(root, {
    dispatch: FILING,
    outcome: 'done',
    blockers: [],
    outOfScopeBugs: [bug('the reader drops the last entry', BUG_ARTIFACT)],
  }, at('2026-11-01T10:00:00.000Z'));
  writeTrackerRef(root, {
    dispatch: FILING,
    outcome: 'done',
    artifact: BUG_KEY,
    ref: GITHUB_REF,
  }, at('2026-11-01T10:00:01.000Z'));
  writeTaskReport(root, {
    dispatch: FILING,
    outcome: 'done',
    report: { status: 'done' },
  }, at('2026-11-01T10:00:02.000Z'));

  writeFindings(root, {
    dispatch: FIXING,
    outcome: 'done',
    findings: [finding({ artifact: BUG_ARTIFACT, resolution: 'keep the last entry' })],
  }, at('2026-11-02T10:00:00.000Z'));
  writeTaskReport(root, {
    dispatch: FIXING,
    outcome: 'done',
    report: { status: 'done' },
  }, at('2026-11-02T10:00:01.000Z'));

  // A finding with no resolution and no reference, a bug no reference was
  // filed for, and a blocked report: none is read.
  writeFindings(root, {
    dispatch: BYSTANDER,
    outcome: 'blocked',
    findings: [finding({ what: 'an unresolved finding' })],
  }, at('2026-11-03T10:00:00.000Z'));
  writeTriage(root, {
    dispatch: BYSTANDER,
    outcome: 'blocked',
    blockers: [],
    outOfScopeBugs: [bug('a bug of a session that filed none', null)],
  }, at('2026-11-03T10:00:01.000Z'));
  writeTaskReport(root, {
    dispatch: BYSTANDER,
    outcome: 'blocked',
    report: { status: 'blocked' },
  }, at('2026-11-03T10:00:02.000Z'));
}

/** Sets a bug row's stored reference to `json`, as a write from outside would. */
function plantRefJson(root: string, json: string): void {
  const db = new Database(sqliteStorePath(root));
  try {
    db.query('UPDATE findings SET tracker_ref = ? WHERE tracker_ref IS NOT NULL').run(json);
  } finally {
    db.close();
  }
}

describe('readBugFixRows with no store', () => {
  it('answers empty rows and a note naming the file, creating nothing', () => {
    const root = freshRoot();
    const path = sqliteStorePath(root);

    const reading = readBugFixRows(root);

    expect(reading.rows).toEqual({ bugs: [], outOfScope: [], resolved: [], reports: [] });
    expect(reading.note).toContain(path);
    expect(reading.note).toContain('store: ndjson');
    expect(existsSync(path)).toBe(false);
  });

  it('answers no note once the store exists, its control', () => {
    const root = freshRoot();
    plantStore(root);

    expect(readBugFixRows(root).note).toBeNull();
  });
});

describe('readBugFixRows over a fixture store', () => {
  it('reads the bug finding with its reference, leaving the unreferenced finding out', () => {
    const root = freshRoot();
    plantStore(root);

    const { bugs } = readBugFixRows(root).rows;

    expect(bugs).toHaveLength(1);
    expect(bugs[0]).toMatchObject({
      sessionId: FILING.sessionId,
      planStub: FILING.planStub,
      taskLine: FILING.taskLine,
      artifact: BUG_KEY,
      trackerRef: { kind: 'github', externalId: '12', url: GITHUB_REF.url },
      outcome: 'done',
      collectedAt: '2026-11-01T10:00:01.000Z',
    });
    expect(typeof bugs[0]?.id).toBe('string');
  });

  it('reads the out-of-scope bugs of the filing session only', () => {
    const root = freshRoot();
    plantStore(root);

    expect(readBugFixRows(root).rows.outOfScope).toEqual([
      { sessionId: FILING.sessionId, what: 'the reader drops the last entry', artifact: BUG_ARTIFACT },
    ]);
  });

  it('reads the resolved finding, leaving the unresolved one out', () => {
    const root = freshRoot();
    plantStore(root);

    expect(readBugFixRows(root).rows.resolved).toEqual([{
      sessionId: FIXING.sessionId,
      planStub: FIXING.planStub,
      taskLine: FIXING.taskLine,
      artifact: BUG_ARTIFACT,
      resolution: 'keep the last entry',
    }]);
  });

  it('reads the done reports in the order they were recorded, leaving the blocked one out', () => {
    const root = freshRoot();
    plantStore(root);

    expect(readBugFixRows(root).rows.reports).toEqual([
      {
        sessionId: FILING.sessionId,
        planStub: FILING.planStub,
        taskLine: FILING.taskLine,
        outcome: 'done',
        collectedAt: '2026-11-01T10:00:02.000Z',
      },
      {
        sessionId: FIXING.sessionId,
        planStub: FIXING.planStub,
        taskLine: FIXING.taskLine,
        outcome: 'done',
        collectedAt: '2026-11-02T10:00:01.000Z',
      },
    ]);
  });

  it('reads a resolved finding holding a reference as resolved, not as a bug', () => {
    const root = freshRoot();
    plantStore(root);
    // The fixing session's resolved finding is keyed by the bug's artifact,
    // so the reference is attached to it rather than inserted beside it.
    const write = writeTrackerRef(root, {
      dispatch: FIXING,
      outcome: 'done',
      artifact: BUG_ARTIFACT,
      ref: GITHUB_REF,
    }, at('2026-11-02T10:00:02.000Z'));

    const { bugs, resolved } = readBugFixRows(root).rows;

    expect(write.action).toBe('attached');
    expect(bugs.map((row) => row.sessionId)).toEqual([FILING.sessionId]);
    expect(resolved.map((row) => row.sessionId)).toEqual([FIXING.sessionId]);
  });
});

describe('readBugFixRows over a reference it cannot read', () => {
  it('throws naming the row for a reference that is no JSON object', () => {
    const root = freshRoot();
    plantStore(root);
    plantRefJson(root, '"12"');

    expect(() => readBugFixRows(root)).toThrow(/findings row \d+ holds a tracker_ref that is no JSON object/);
  });

  it('throws for a reference with no string externalId', () => {
    const root = freshRoot();
    plantStore(root);
    plantRefJson(root, JSON.stringify({ opt: 12, kind: 'github', externalId: 12, url: null }));

    expect(() => readBugFixRows(root)).toThrow(/no string kind and externalId/);
  });

  it('reads a reference with a null url, its control', () => {
    const root = freshRoot();
    plantStore(root);
    plantRefJson(root, JSON.stringify({ opt: 12, kind: 'github', externalId: '12', url: null }));

    expect(readBugFixRows(root).rows.bugs[0]?.trackerRef).toEqual({ kind: 'github', externalId: '12', url: null });
  });
});
