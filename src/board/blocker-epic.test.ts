/**
 * Tests for the blocker epic locator (`src/board/blocker-epic.ts`): the
 * epic holding C and the board it sits on, and each reason C cannot be
 * hopped to, over one literal listing.
 *
 * The board: home is board #10 at epic #20 (`epic:home`), where H is
 * #100. #10 also lists epic #30 (`other`) and the closed epic #60
 * (`gone`); board #11 lists epic #40 (`far`); the closed board #12 lists
 * epic #50 (`orphan`); epic #70 (`stray`) is on no board. The default
 * board is #10.
 *
 * ## The controls
 *
 * Each reason is read beside a C that differs from it in the one thing
 * the reason is about and is located, so a locator answering every C
 * with that reason fails: `owner/repo#101` beside local #101, #105
 * (`far` and `home`) beside #102 (`far` alone), #106's closed epic
 * beside #101's open one on the same board, #107's closed board beside
 * #102's open one. The view counts every ask of the default board, so a
 * locator that asked it where home's board already answers fails too.
 */
import type { BoardView } from './epic-board.js';
import type { BoardIssue, BoardIssueState } from './roadmap-board.js';
import type { Place } from '../project/position.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';

import { locateBlockerEpic, noHopSentence } from './blocker-epic.js';

/** One row as the listing reads it. */
function row(number: number, labels: readonly string[], body = '', state: BoardIssueState = 'OPEN'): BoardIssue {
  const stateReason = state === 'CLOSED'
    ? 'COMPLETED'
    : null;
  return { number, title: `Issue ${String(number)}`, body, state, stateReason, labels, type: typeOfLabels(labels), module: 'unassigned' };
}

/** A board whose checklist names `epics`, unticked. */
function board(number: number, epics: readonly number[], state: BoardIssueState = 'OPEN'): BoardIssue {
  return row(number, ['type:roadmap'], epics.map((epic) => `- [ ] #${String(epic)}`).join('\n'), state);
}

/** An epic issue whose own slug is `slug`. */
function epic(number: number, slug: string, state: BoardIssueState = 'OPEN'): BoardIssue {
  return row(number, ['type:epic', `epic:${slug}`, 'horizon:now'], '', state);
}

/** The board the module note describes. */
const LISTING: readonly BoardIssue[] = [
  board(10, [20, 30, 60]),
  board(11, [40]),
  board(12, [50], 'CLOSED'),
  epic(20, 'home'),
  epic(30, 'other'),
  epic(40, 'far'),
  epic(50, 'orphan'),
  epic(60, 'gone', 'CLOSED'),
  epic(70, 'stray'),
  row(100, ['epic:home']),
  row(101, ['epic:other']),
  row(102, ['epic:far']),
  row(103, ['type:bug']),
  row(104, ['epic:home']),
  row(105, ['epic:far', 'epic:home']),
  row(106, ['epic:gone']),
  row(107, ['epic:orphan']),
  row(108, ['epic:stray']),
  row(109, ['epic:ghost']),
];

/** Home: board #10 at epic #20. */
const HOME: Place = { board: 10, epic: 20 };

/** The view of {@link LISTING}, the default board #10, counting each ask. */
function viewOf(): BoardView & { readonly asked: () => number } {
  let asked = 0;
  return {
    listing: LISTING,
    rows: new Map(LISTING.map((issue) => [issue.number, issue])),
    defaultBoard: () => {
      asked += 1;
      return Promise.resolve(10);
    },
    asked: () => asked,
  };
}

/** Locates `blocker` from {@link HOME}. */
function locate(blocker: number | string, view: BoardView = viewOf(), home: Place = HOME) {
  return locateBlockerEpic({ blocker, home, view });
}

describe('locateBlockerEpic, located', () => {
  it('answers an epic on home\'s own board without asking the default board', async () => {
    const view = viewOf();

    expect(await locate(101, view)).toEqual({ kind: 'located', blocker: 101, epic: 30, slug: 'other', board: 10 });
    expect(view.asked()).toBe(0);
  });

  it('answers an epic on another board, the one that lists it', async () => {
    expect(await locate(102)).toEqual({ kind: 'located', blocker: 102, epic: 40, slug: 'far', board: 11 });
  });

  it('answers home\'s board first when both boards list the epic', async () => {
    const listing = [...LISTING.filter((issue) => issue.number !== 10), board(10, [20, 30, 40, 60])];
    const view: BoardView = { listing, rows: new Map(listing.map((issue) => [issue.number, issue])), defaultBoard: () => Promise.resolve(11) };

    expect(await locate(102, view)).toMatchObject({ kind: 'located', board: 10 });
  });
});

describe('locateBlockerEpic, no hop', () => {
  it('answers a cross-repository blocker as written, and the same number local is located', async () => {
    const view = viewOf();

    expect(await locate('open-tomato/agentic-research#101', view)).toEqual({
      kind: 'no-hop',
      blocker: 'open-tomato/agentic-research#101',
      reason: 'cross-repository',
      epic: null,
    });
    expect(view.asked()).toBe(0);
    expect(await locate(101)).toMatchObject({ kind: 'located' });
  });

  it('answers a number off the listing', async () => {
    expect(await locate(999)).toEqual({ kind: 'no-hop', blocker: 999, reason: 'not-on-listing', epic: null });
  });

  it('answers a blocker carrying no epic label', async () => {
    expect(await locate(103)).toEqual({ kind: 'no-hop', blocker: 103, reason: 'no-epic-label', epic: null });
  });

  it('answers a blocker in H\'s own epic, by its only label or beside another', async () => {
    expect(await locate(104)).toEqual({ kind: 'no-hop', blocker: 104, reason: 'same-epic', epic: 20 });
    expect(await locate(105)).toEqual({ kind: 'no-hop', blocker: 105, reason: 'same-epic', epic: 20 });
    expect(await locate(102)).toMatchObject({ kind: 'located', epic: 40 });
  });

  it('reads the same epic against home, so a blocker in #30 is same-epic from #30', async () => {
    expect(await locate(101, viewOf(), { board: 10, epic: 30 })).toMatchObject({ reason: 'same-epic', epic: 30 });
  });

  it('answers a slug no epic issue owns', async () => {
    expect(await locate(109)).toEqual({ kind: 'no-hop', blocker: 109, reason: 'no-epic', epic: null });
  });

  it('answers a closed epic, naming it, without asking for a board', async () => {
    const view = viewOf();

    expect(await locate(106, view)).toEqual({ kind: 'no-hop', blocker: 106, reason: 'closed-epic', epic: 60 });
    expect(view.asked()).toBe(0);
  });

  it('answers an epic only a closed board lists, and one no board lists', async () => {
    expect(await locate(107)).toEqual({ kind: 'no-hop', blocker: 107, reason: 'no-open-board', epic: 50 });
    expect(await locate(108)).toEqual({ kind: 'no-hop', blocker: 108, reason: 'no-open-board', epic: 70 });
  });

  it('rejects with the default board\'s rejection when the pick needs it', async () => {
    const view: BoardView = { ...viewOf(), defaultBoard: () => Promise.reject(new Error('no Roadmap issue')) };

    await expect(locate(102, view)).rejects.toThrow('no Roadmap issue');
    expect(await locate(101, view)).toMatchObject({ kind: 'located' });
  });
});

describe('noHopSentence', () => {
  it('names the blocker, its epic when found, and the reason', async () => {
    const closed = await locate(106);
    const foreign = await locate('open-tomato/agentic-research#12');
    if (closed.kind !== 'no-hop' || foreign.kind !== 'no-hop') throw new Error('expected no-hop answers');

    expect(noHopSentence(closed)).toBe('#106 (epic #60) is in a closed epic');
    expect(noHopSentence(foreign)).toBe('open-tomato/agentic-research#12 is on another repository, which the board listing does not read');
  });
});
