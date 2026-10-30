/**
 * Tests for `firstNowEpic` (`now-epic.ts`) over one listing of four
 * epics, built in memory: nothing here reaches `gh` or the disk.
 *
 * The board: epic #80 is `next`, epic #70 is `now` with its one member
 * closed (so `done`, and still open), epic #50 is `now` with an open
 * member and epic #60 is `now` with an open member. A pick that ignored
 * the horizon would answer #80 for the first case, and one that ignored
 * the computed state would answer #70, so each wrong reading has its own
 * wrong number.
 */
import type { BoardIssue } from './roadmap-board.js';
import type { RoadmapLine } from './roadmap.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';

import { readEpics } from './epics.js';
import { firstNowEpic } from './now-epic.js';

/** One listing row, its type read from its labels. */
function issue(number: number, labels: readonly string[], body = '', state: 'OPEN' | 'CLOSED' = 'OPEN'): BoardIssue {
  return {
    number,
    title: `issue ${String(number)}`,
    body,
    state,
    stateReason: null,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
  };
}

/** The board the module note describes. */
const LISTING: readonly BoardIssue[] = [
  issue(50, ['type:epic', 'epic:alpha', 'horizon:now'], '- [ ] #51\n'),
  issue(51, ['epic:alpha']),
  issue(60, ['type:epic', 'epic:beta', 'horizon:now'], '- [ ] #61\n'),
  issue(61, ['epic:beta']),
  issue(70, ['type:epic', 'epic:gamma', 'horizon:now'], '- [ ] #71\n'),
  issue(71, ['epic:gamma'], '', 'CLOSED'),
  issue(80, ['type:epic', 'epic:delta', 'horizon:next'], '- [ ] #81\n'),
  issue(81, ['epic:delta']),
];

/** A roadmap line naming `number`. */
function line(number: number, ticked = false): RoadmapLine {
  return { issue: number, ticked, why: '', lineNumber: number };
}

describe('firstNowEpic', () => {
  const epics = readEpics({ issues: LISTING, claims: new Set(), today: new Date('2026-09-15') });

  it('reads the board the cases stand on: #70 done, the other three not', () => {
    expect(epics.epics.map((epic) => [epic.number, epic.state === 'done'])).toEqual([[50, false], [60, false], [70, true], [80, false]]);
  });

  it('passes a next epic and a done one, and answers the first open now epic not done, in roadmap order', () => {
    expect(firstNowEpic([line(80), line(70), line(50), line(60)], LISTING, epics)?.number).toBe(50);
    expect(firstNowEpic([line(60), line(50)], LISTING, epics)?.number).toBe(60);
  });

  it('passes a ticked line and a line naming no epic, and answers null when nothing is left', () => {
    expect(firstNowEpic([line(51), line(50, true), line(60)], LISTING, epics)?.number).toBe(60);
    expect(firstNowEpic([line(80), line(70), line(51)], LISTING, epics)).toBeNull();
  });

  it('passes a now epic the listing holds closed', () => {
    const closed = LISTING.map((row) => (row.number === 50
      ? { ...row, state: 'CLOSED' as const }
      : row));

    expect(firstNowEpic([line(50), line(60)], closed, epics)?.number).toBe(60);
  });
});
