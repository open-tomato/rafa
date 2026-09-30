/**
 * Unit cases for the relationship readings `ghNextBoard` wires
 * (`./relation-readings.ts`), driven over in-process fakes: the
 * blocked-line and ready readings off one issue reader, the away target
 * of a hop record, the walk while a blocker hop is away, and the pick
 * that passes a line whose every open blocker is taken. The wiring
 * itself, and every `gh` call it sends, stays `./sources.test.ts`'s and
 * `./sources-hop.test.ts`'s to count.
 */
import type { HopRecord } from './hop-record.js';
import type { SpecIssue, SpecIssueReader } from '../board/issue.js';
import type { RoadmapLine, RoadmapReadings } from '../board/roadmap.js';

import { describe, expect, test } from 'bun:test';

import { awayTargetOf, blockedLineReadings, waitingPick, walkTarget } from './relation-readings.js';

/** An issue reader over `issues`, open and unlabelled unless a row says otherwise. */
function readerOver(issues: readonly Partial<SpecIssue>[]): SpecIssueReader {
  return (number: number) => {
    const row = issues.find((issue) => issue.number === number);
    if (row === undefined) return Promise.reject(new Error(`#${String(number)} is not planted`));
    return Promise.resolve({ number, title: `Issue ${String(number)}`, body: '', state: 'OPEN', labels: [], author: 'owner', ...row });
  };
}

/** Readings answering `closed` closed, `branches` taken by a branch, and nothing else taken. */
function readingsOver(closed: readonly number[], branches: ReadonlyMap<number, string>): RoadmapReadings {
  return {
    isClosed: (issue) => Promise.resolve(closed.includes(issue)),
    branchFor: (issue) => branches.get(issue) ?? null,
    pullRequestFor: () => Promise.resolve(null),
  };
}

/** A roadmap line for `issue`. */
function lineFor(issue: number, lineNumber: number): RoadmapLine {
  return { issue, ticked: false, why: '', lineNumber };
}

/** A blocker hop record away on `target`. */
function hopRecord(overrides: Partial<HopRecord> = {}): HopRecord {
  return {
    kind: 'blocker',
    home: { board: 1, epic: 10 },
    from: { board: 1, epic: 10 },
    blocked: 100,
    target: 118,
    targetEpic: 20,
    targetBoard: 1,
    state: 'away',
    pullRequest: null,
    startedAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('blockedLineReadings', () => {
  test('reads the Blocked by line with each blocker\'s state off the one reader', async () => {
    const readings = blockedLineReadings(readerOver([
      { number: 100, body: 'Blocked by: #118 #119\n', labels: ['spec:blocked'] },
      { number: 118 },
      { number: 119, state: 'CLOSED' },
    ]));

    const blocked = await readings.blocking(100);

    expect(blocked?.blockers).toEqual([118, 119]);
    expect(blocked?.open).toEqual([118]);
    expect(blocked?.fault).toBeNull();
  });

  test('answers null for an issue carrying no spec:blocked label', async () => {
    const readings = blockedLineReadings(readerOver([{ number: 100, body: 'No blockers here.\n' }]));

    expect(await readings.blocking(100)).toBeNull();
  });

  test('reads ready from the spec:ready label, and not ready without it', async () => {
    const readings = blockedLineReadings(readerOver([
      { number: 100, labels: ['spec:ready'] },
      { number: 101, labels: ['type:spec'] },
    ]));

    expect(await readings.isReady(100)).toBe(true);
    expect(await readings.isReady(101)).toBe(false);
  });
});

describe('awayTargetOf', () => {
  test('answers C for a blocker hop still away', () => {
    expect(awayTargetOf(hopRecord())).toBe(118);
  });

  test('answers null for no record, a hop not away, and a dry hop', () => {
    expect(awayTargetOf(null)).toBeNull();
    expect(awayTargetOf(hopRecord({ state: 'waiting' }))).toBeNull();
    expect(awayTargetOf(hopRecord({ kind: 'dry', blocked: null, target: null }))).toBeNull();
  });
});

describe('walkTarget', () => {
  test('answers C\'s line while it is open with no pull request', async () => {
    const answer = await walkTarget(hopRecord(), 118, readingsOver([], new Map()));

    expect(answer.walk.line).toEqual({ issue: 118, ticked: false, why: '', lineNumber: 0 });
    expect(answer.walk.epic).toBe(20);
    expect(answer.target).toEqual({ issue: 118, closed: false, pullRequest: null });
  });

  test('answers no line once C is closed', async () => {
    const answer = await walkTarget(hopRecord(), 118, readingsOver([118], new Map()));

    expect(answer.walk.line).toBeNull();
    expect(answer.target.closed).toBe(true);
  });
});

describe('waitingPick', () => {
  const issues = readerOver([
    { number: 100, body: 'Blocked by: #118\n', labels: ['spec:blocked'] },
    { number: 101 },
    { number: 118 },
  ]);
  const { blocking } = blockedLineReadings(issues);
  const lines = [lineFor(100, 1), lineFor(101, 2)];

  test('passes a line whose every open blocker a branch has taken, and picks the next', async () => {
    const readings = readingsOver([], new Map([[118, 'rafa-118-far']]));

    const pick = await waitingPick(blocking)(lines, readings);

    expect(pick.line?.issue).toBe(101);
    expect(pick.passed).toBe(1);
    expect(pick.waiting.map((waiting) => waiting.line.issue)).toEqual([100]);
    expect(pick.waiting[0]?.blockers.map((blocker) => blocker.issue)).toEqual([118]);
  });

  test('stops at a line with a free blocker, the control for the case above', async () => {
    const pick = await waitingPick(blocking)(lines, readingsOver([], new Map()));

    expect(pick.line?.issue).toBe(100);
    expect(pick.passed).toBe(0);
    expect(pick.waiting).toEqual([]);
  });
});
