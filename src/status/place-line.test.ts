/**
 * Tests for the place and away lines (`place-line.ts`).
 *
 * Every case builds its view in memory; nothing reads the disk or `gh`.
 * Each form is asserted as the whole line, so a field out of order or a
 * separator spelled differently fails. The away line's null case sits
 * beside cases that differ from it by one field, so a comparison that
 * always answered one way would fail one of them.
 */
import type { EpicView, PlaceView } from './place-line.js';
import type { Place } from '../project/position.js';

import { describe, expect, it } from 'bun:test';

import {
  AWAY_PREFIX,
  awayLine,
  PLACE_SEPARATOR,
  placeLine,
  placeNumber,
} from './place-line.js';

/** Epic #252, three of seven done, on the `now` horizon. */
const EPIC: EpicView = { number: 252, title: 'Epics and boards', horizon: 'now', done: 3, total: 7 };

/** A place on board #31 at `epic`. */
function at(epic: number | null, board = 31): Place {
  return { board, epic };
}

describe('placeLine', () => {
  it('spells the spec\'s example for a place at an epic with a next issue', () => {
    const view: PlaceView = { board: 31, epic: EPIC, next: 245 };
    expect(placeLine(view)).toBe('board #31 · epic #252 Epics and boards (now) · 3/7 done · next #245');
  });

  it('leaves the next field out when there is no next issue', () => {
    expect(placeLine({ board: 31, epic: EPIC, next: null })).toBe('board #31 · epic #252 Epics and boards (now) · 3/7 done');
  });

  it('names the horizon and the counts it is given', () => {
    const epic: EpicView = { ...EPIC, horizon: 'later', done: 0, total: 0 };
    expect(placeLine({ board: 9, epic, next: null })).toBe('board #9 · epic #252 Epics and boards (later) · 0/0 done');
  });

  it('spells the board-only form when the epic is null', () => {
    expect(placeLine({ board: 31, epic: null, next: null })).toBe('board #31 · no epic');
  });

  it('keeps the next field in the board-only form', () => {
    expect(placeLine({ board: 31, epic: null, next: 12 })).toBe('board #31 · no epic · next #12');
  });

  it('joins every field with the one separator', () => {
    const line = placeLine({ board: 31, epic: EPIC, next: 245 });
    expect(line.split(PLACE_SEPARATOR)).toEqual(['board #31', 'epic #252 Epics and boards (now)', '3/7 done', 'next #245']);
  });
});

describe('placeNumber', () => {
  it('names a place by its epic', () => {
    expect(placeNumber(at(252))).toBe(252);
  });

  it('names a place with no epic by its board', () => {
    expect(placeNumber(at(null))).toBe(31);
  });
});

describe('awayLine', () => {
  it('is null while current is home', () => {
    expect(awayLine(at(252), at(252))).toBeNull();
  });

  it('is null while current is home on a board with no epic', () => {
    expect(awayLine(at(null), at(null))).toBeNull();
  });

  it('names both epics when current and home are epics of one board', () => {
    expect(awayLine(at(260), at(252))).toBe('away from home: working #260 for #252');
  });

  it('names both epics when the boards differ', () => {
    expect(awayLine(at(260, 40), at(252, 31))).toBe(`${AWAY_PREFIX}: working #260 for #252`);
  });

  it('names a board for a side with no epic', () => {
    expect(awayLine(at(null, 40), at(252))).toBe('away from home: working #40 for #252');
    expect(awayLine(at(252), at(null, 31))).toBe('away from home: working #252 for #31');
  });

  it('tells one epic on two boards apart as away', () => {
    expect(awayLine(at(252, 40), at(252, 31))).toBe('away from home: working #252 for #252');
  });
});
