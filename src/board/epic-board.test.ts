/**
 * Tests for which board an epic sits on (`src/board/epic-board.ts`): the
 * open boards, whether a board lists an epic, and the board an epic moves
 * with. These cases moved here from `src/commands/switch.test.ts` with
 * the functions they cover.
 *
 * The board: three open `type:roadmap` boards, #31 (the default in most
 * cases), #40 and #45, and a closed one, #41. #31 lists epics #50 and
 * #60; #40 lists #80, #50 and #85; #45 lists #85; #41 lists #50. #90 is
 * an epic no board lists. Every case counts how often the default board
 * was asked, so a pick that asked it needlessly fails as a wrong pick
 * does.
 */
import type { BoardView } from './epic-board.js';
import type { BoardIssue, BoardIssueState } from './roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';

import { boardListsEpic, boardOfEpic, openBoards } from './epic-board.js';

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

/** The board the module note describes, the plain issue #7 first. */
const LISTING: readonly BoardIssue[] = [
  row(7, ['type:bug']),
  board(31, [50, 60]),
  board(40, [80, 50, 85]),
  board(41, [50], 'CLOSED'),
  board(45, [85]),
  ...[50, 60, 80, 85, 90].map((number) => row(number, ['type:epic', `epic:e${String(number)}`])),
];

/** The view of `listing`, the default answered as `fallback`, counting each ask. */
function viewOf(fallback = 31, listing: readonly BoardIssue[] = LISTING): BoardView & { readonly asked: () => number } {
  let asked = 0;
  return {
    listing,
    rows: new Map(listing.map((issue) => [issue.number, issue])),
    defaultBoard: () => {
      asked += 1;
      return Promise.resolve(fallback);
    },
    asked: () => asked,
  };
}

describe('openBoards', () => {
  it('keeps the open labelled rows, lowest number first', () => {
    expect(openBoards([...LISTING].reverse()).map((issue) => issue.number)).toEqual([31, 40, 45]);
  });
});

describe('boardListsEpic', () => {
  it('reads an open board whose checklist names the epic, ticked or not', () => {
    const ticked = [row(33, ['type:roadmap'], '- [x] #50')];

    expect(boardListsEpic(40, 85, viewOf())).toBe(true);
    expect(boardListsEpic(33, 50, viewOf(31, ticked))).toBe(true);
  });

  it('refuses a board that does not name it, a closed board and a number off the listing', () => {
    expect(boardListsEpic(45, 50, viewOf())).toBe(false);
    expect(boardListsEpic(41, 50, viewOf())).toBe(false);
    expect(boardListsEpic(500, 50, viewOf())).toBe(false);
  });
});

describe('boardOfEpic', () => {
  it('takes the current board first when it lists the epic, asking no default', async () => {
    const view = viewOf();

    expect(await boardOfEpic(50, { board: 40 }, view)).toBe(40);
    expect(await boardOfEpic(50, { board: 31 }, view)).toBe(31);
    expect(view.asked()).toBe(0);
  });

  it('takes the default board next, then the lowest-numbered listing it, then the default', async () => {
    expect(await boardOfEpic(60, { board: 40 }, viewOf())).toBe(31);
    expect(await boardOfEpic(85, { board: 31 }, viewOf())).toBe(40);
    expect(await boardOfEpic(90, { board: 40 }, viewOf())).toBe(31);
  });

  it('passes a closed board that lists the epic', async () => {
    expect(await boardOfEpic(50, { board: 41 }, viewOf(45))).toBe(31);
  });

  it('rejects with the default board\'s own rejection when it is needed', async () => {
    const view: BoardView = { ...viewOf(), defaultBoard: () => Promise.reject(new Error('no Roadmap issue')) };

    await expect(boardOfEpic(60, { board: 40 }, view)).rejects.toThrow('no Roadmap issue');
  });
});
