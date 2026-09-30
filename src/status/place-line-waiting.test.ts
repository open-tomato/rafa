/**
 * Tests for the waiting line (`waitingLine`, `./place-line.ts`) and where
 * `renderStatus` (`./render.ts`) puts it: under the away line, above
 * the place's notices, and only when the place carries `waiting`.
 *
 * `./place-line.test.ts` and `./render.test.ts` hold the place and away
 * lines; these cases sit in a file of their own beside them.
 */
import type { PlaceReading, SectionUnread, StatusSections, WaitingReading } from './sections.js';

import { describe, expect, it } from 'bun:test';

import { WAITING_ON, waitingLine } from './place-line.js';
import { renderStatus } from './render.js';

/** A section not read, for the sections these cases do not look at. */
const UNREAD: SectionUnread = { read: false, problem: 'not part of this case' };

/** A place away from home: working epic #60 for epic #50, both on board #31. */
const AWAY: PlaceReading = {
  current: { board: 31, epic: 60 },
  home: { board: 31, epic: 50 },
  view: { board: 31, epic: null, next: null },
  notices: ['a fallback notice'],
};

/** C #61's pull request #70 waiting on its owner. */
const WAITING: WaitingReading = { issue: 61, pullRequest: 70, gate: 'waiting', reason: 'owner @team of board #40 has not approved #70' };

/** The sections with a board reading carrying `place`, every other section not read. */
function withPlace(place: PlaceReading): StatusSections {
  return {
    branch: UNREAD,
    loops: UNREAD,
    pull: UNREAD,
    board: { read: true, roadmap: 31, next: null, passed: 0, blockedIssues: 0, notes: [], place },
    claims: UNREAD,
    housekeeping: UNREAD,
  };
}

/** The lines under the board line, as `renderStatus` writes them. */
function boardBody(place: PlaceReading): readonly { readonly level: string; readonly text: string }[] {
  const lines = renderStatus(withPlace(place));
  const board = lines.findIndex((line) => line.text.startsWith('Board: '));
  const next = lines.findIndex((line, index) => index > board && !line.text.startsWith('  '));
  return lines.slice(board + 1, next);
}

describe('waitingLine', () => {
  it('names the issue and the owner review it waits on', () => {
    expect(waitingLine(61)).toBe('waiting on #61 (owner review)');
  });

  it('spells what it waits on from WAITING_ON', () => {
    expect(waitingLine(7)).toBe(`waiting on #7 (${WAITING_ON})`);
  });
});

describe('the waiting line under the board line', () => {
  it('prints it under the away line and above the notices', () => {
    expect(boardBody({ ...AWAY, waiting: WAITING })).toEqual([
      { level: 'info', text: '  board #31 · no epic' },
      { level: 'info', text: '  away from home: working #60 for #50' },
      { level: 'info', text: '  waiting on #61 (owner review)' },
      { level: 'warn', text: '  a fallback notice' },
    ]);
  });

  it('prints it at home, where there is no away line, a hop having come back', () => {
    const home: PlaceReading = { ...AWAY, current: AWAY.home, notices: [], waiting: WAITING };

    expect(boardBody(home)).toEqual([
      { level: 'info', text: '  board #31 · no epic' },
      { level: 'info', text: '  waiting on #61 (owner review)' },
    ]);
  });

  it('prints none for a place without waiting, where the same place with it prints one', () => {
    const without = boardBody(AWAY).map((line) => line.text);
    const withIt = boardBody({ ...AWAY, waiting: WAITING }).map((line) => line.text);

    expect(without.some((text) => text.includes('waiting on'))).toBe(false);
    expect(withIt.filter((text) => text.includes('waiting on'))).toHaveLength(1);
    expect(withIt.filter((text) => !text.includes('waiting on'))).toEqual(without);
  });
});
