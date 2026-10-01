/**
 * Tests for the blocker epic locator (`src/board/blocker-epic.ts`) handed
 * the board's relationships port: C's epic read from its `parent` in
 * `native` mode, a foreign C named from the repository its `blockedBy`
 * node carries, and the rows the port reads as in no epic. The `labels`
 * cases the locator had before the port stay in `./blocker-epic.test.ts`.
 *
 * The board, on `acme/board`, is the one that file reads, recorded both
 * ways: home is board #10 at epic #20, which also lists #30 and the
 * closed #60; board #11 lists #40; the closed board #12 lists #50; epic
 * #70 is on no board. The default board is #10. Every case reads it
 * through the real adapters made over a `gh` that fails any call, so a
 * read that spawned would be seen.
 *
 * ## The controls
 *
 *  - Each native row also carries an `epic:<slug>` label naming ANOTHER
 *    epic than its parent, and the same board read in `labels` mode must
 *    answer that other epic. A native reading that fell back to the label
 *    locates the wrong epic.
 *  - The foreign C is numbered #101, which this board holds and locates;
 *    a reading that dropped the node's repository would locate it.
 *  - Each `native` reason is paired with a C differing in the one thing
 *    it is about, which is located.
 *  - The located answer's `slug` is null in `native` mode and the epic's
 *    own slug in `labels` mode, read on the same row.
 */
import type { BoardView } from './epic-board.js';
import type { EpicRelations } from './epics.js';
import type { RelatedIssue } from './relations/port.js';
import type { BoardIssue, BoardIssueLink, BoardIssueState } from './roadmap-board.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { Place } from '../project/position.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';

import { locateBlockerEpic, noHopSentence } from './blocker-epic.js';
import { createLabelsRelations } from './relations/labels.js';
import { createNativeRelations } from './relations/native.js';

/** The board's own repository. */
const BOARD = 'acme/board';

/** The repository a foreign C lives on. */
const OTHER = 'other/lib';

/** A `gh` every call to which fails the case: reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** The `native` adapter on {@link BOARD}. */
const NATIVE = createNativeRelations({ gh: NO_GH, repository: BOARD });

/** The `labels` adapter, for the controls. */
const LABELS = createLabelsRelations({ gh: NO_GH });

/** A parent link to issue `number` on `repository`. */
function link(number: number, repository = BOARD): BoardIssueLink {
  return { number, title: `issue ${String(number)}`, state: 'OPEN', repository };
}

/** A native row carrying all five native fields, its type read from its labels. */
function row(
  number: number,
  labels: readonly string[],
  parent: BoardIssueLink | null = null,
  body = '',
  state: BoardIssueState = 'OPEN',
): BoardIssue {
  return {
    number,
    title: `Issue ${String(number)}`,
    body,
    state,
    stateReason: state === 'CLOSED'
      ? 'COMPLETED'
      : null,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
    parent,
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: [] },
  };
}

/** A board whose checklist names `epics`, unticked. */
function board(number: number, epics: readonly number[], state: BoardIssueState = 'OPEN'): BoardIssue {
  return row(number, ['type:roadmap'], null, epics.map((epic) => `- [ ] #${String(epic)}`).join('\n'), state);
}

/** An epic issue whose own slug is `slug`. */
function epic(number: number, slug: string, state: BoardIssueState = 'OPEN'): BoardIssue {
  return row(number, ['type:epic', `epic:${slug}`, 'horizon:now'], null, '', state);
}

/** A member of the epic `parent` natively, labelled into the epic `slug`: the control. */
function member(number: number, parent: BoardIssueLink | null, slug: string): BoardIssue {
  return row(number, ['type:spec', `epic:${slug}`], parent);
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
  row(80, ['type:epic', 'horizon:now']),
  member(100, link(20), 'other'),
  member(101, link(30), 'far'),
  member(102, link(40), 'other'),
  member(103, null, 'other'),
  member(106, link(60), 'other'),
  member(107, link(50), 'other'),
  member(108, link(70), 'other'),
  member(109, link(110), 'other'),
  member(110, null, 'other'),
  member(111, link(30, OTHER), 'other'),
  member(112, link(999), 'other'),
  member(113, link(30), 'home'),
];

/** Home: board #10 at epic #20. */
const HOME: Place = { board: 10, epic: 20 };

/** The view of `listing`, the default board #10, counting each ask. */
function viewOf(listing: readonly BoardIssue[] = LISTING): BoardView & { readonly asked: () => number } {
  let asked = 0;
  return {
    listing,
    rows: new Map(listing.map((issue) => [issue.number, issue])),
    defaultBoard: () => {
      asked += 1;
      return Promise.resolve(10);
    },
    asked: () => asked,
  };
}

/** Locates `blocker` from `home` through `relations`. */
function locate(
  blocker: number | string | RelatedIssue,
  relations: EpicRelations = NATIVE,
  view: BoardView = viewOf(),
  home: Place = HOME,
) {
  return locateBlockerEpic({ blocker, home, view, relations });
}

describe('locateBlockerEpic in native mode, located', () => {
  it('answers C\'s parent epic on home\'s board, where the labels read another epic', async () => {
    const view = viewOf();

    expect(await locate(101, NATIVE, view)).toEqual({ kind: 'located', blocker: 101, epic: 30, slug: null, board: 10 });
    expect(view.asked()).toBe(0);
    expect(await locate(101, LABELS)).toEqual({ kind: 'located', blocker: 101, epic: 40, slug: 'far', board: 11 });
  });

  it('answers a parent epic on another board, the one that lists it', async () => {
    expect(await locate(102)).toEqual({ kind: 'located', blocker: 102, epic: 40, slug: null, board: 11 });
    expect(await locate(102, LABELS)).toMatchObject({ kind: 'located', epic: 30, board: 10 });
  });

  it('reads a blocker node on this board as a local number', async () => {
    expect(await locate({ number: 101, repository: null })).toEqual({ kind: 'located', blocker: 101, epic: 30, slug: null, board: 10 });
  });

  it('answers an epic row as its own epic, in both modes', async () => {
    expect(await locate(30)).toEqual({ kind: 'located', blocker: 30, epic: 30, slug: null, board: 10 });
    expect(await locate(30, LABELS)).toEqual({ kind: 'located', blocker: 30, epic: 30, slug: 'other', board: 10 });
  });
});

describe('locateBlockerEpic in native mode, no hop', () => {
  it('names a foreign blocker from its node\'s repository without reading the local #101', async () => {
    const view = viewOf();
    const foreign = await locate({ number: 101, repository: OTHER }, NATIVE, view);

    expect(foreign).toEqual({ kind: 'no-hop', blocker: 'other/lib#101', reason: 'cross-repository', epic: null });
    expect(view.asked()).toBe(0);
    expect(await locate({ number: 101, repository: null })).toMatchObject({ kind: 'located', epic: 30 });
  });

  it('answers a C with no parent as no-parent, where the labels locate it', async () => {
    expect(await locate(103)).toEqual({ kind: 'no-hop', blocker: 103, reason: 'no-parent', epic: null });
    expect(await locate(103, LABELS)).toMatchObject({ kind: 'located', epic: 30 });
  });

  it('answers a parent the listing does not hold as an epic as parent-not-epic', async () => {
    const expected = (blocker: number) => ({ kind: 'no-hop', blocker, reason: 'parent-not-epic', epic: null });

    expect(await locate(109)).toEqual(expected(109));
    expect(await locate(111)).toEqual(expected(111));
    expect(await locate(112)).toEqual(expected(112));
    expect(await locate(113)).toMatchObject({ kind: 'located', epic: 30 });
  });

  it('answers a C whose parent is home\'s epic as same-epic, where the labels read another', async () => {
    expect(await locate(100)).toEqual({ kind: 'no-hop', blocker: 100, reason: 'same-epic', epic: 20 });
    expect(await locate(100, LABELS)).toMatchObject({ kind: 'located', epic: 30 });
    expect(await locate(113, LABELS)).toEqual({ kind: 'no-hop', blocker: 113, reason: 'same-epic', epic: 20 });
  });

  it('answers the home epic itself as same-epic', async () => {
    expect(await locate(20)).toEqual({ kind: 'no-hop', blocker: 20, reason: 'same-epic', epic: 20 });
  });

  it('answers a closed parent epic, and one only a closed board or no board lists', async () => {
    const view = viewOf();

    expect(await locate(106, NATIVE, view)).toEqual({ kind: 'no-hop', blocker: 106, reason: 'closed-epic', epic: 60 });
    expect(view.asked()).toBe(0);
    expect(await locate(107)).toEqual({ kind: 'no-hop', blocker: 107, reason: 'no-open-board', epic: 50 });
    expect(await locate(108)).toEqual({ kind: 'no-hop', blocker: 108, reason: 'no-open-board', epic: 70 });
  });

  it('answers a number off the listing', async () => {
    expect(await locate(999)).toEqual({ kind: 'no-hop', blocker: 999, reason: 'not-on-listing', epic: null });
  });

  it('rejects a listing read without the native fields, naming board.relationships', async () => {
    const native = new Set(['parent', 'blockedBy', 'blocking', 'subIssuesSummary', 'subIssues']);
    const bare = LISTING.map((issue) => Object.fromEntries(Object.entries(issue).filter(([key]) => !native.has(key))) as BoardIssue);

    await expect(locate(101, NATIVE, viewOf(bare))).rejects.toThrow('board.relationships');
    expect(await locate(101, LABELS, viewOf(bare))).toMatchObject({ kind: 'located', epic: 40 });
  });
});

describe('locateBlockerEpic, an epic row with no epic: label', () => {
  it('is no-epic-label in labels mode, as before the port, and its own epic in native mode', async () => {
    const listing = [...LISTING.filter((issue) => issue.number !== 10), board(10, [20, 30, 60, 80])];

    expect(await locate(80, LABELS, viewOf(listing))).toEqual({ kind: 'no-hop', blocker: 80, reason: 'no-epic-label', epic: null });
    expect(await locate(80, NATIVE, viewOf(listing))).toEqual({ kind: 'located', blocker: 80, epic: 80, slug: null, board: 10 });
  });
});

describe('locateBlockerEpic, the relations left out', () => {
  it('reads labels mode, as a caller before the port did', async () => {
    const answer = await locateBlockerEpic({ blocker: 101, home: HOME, view: viewOf() });

    expect(answer).toEqual({ kind: 'located', blocker: 101, epic: 40, slug: 'far', board: 11 });
    expect(Object.keys(answer)).toEqual(['kind', 'blocker', 'epic', 'slug', 'board']);
  });
});

describe('noHopSentence, native reasons', () => {
  it('names the parent, not a label, and the foreign blocker as its node names it', async () => {
    const none = await locate(103);
    const stray = await locate(109);
    const foreign = await locate({ number: 7, repository: OTHER });
    if (none.kind !== 'no-hop' || stray.kind !== 'no-hop' || foreign.kind !== 'no-hop') throw new Error('expected no-hop answers');

    expect(noHopSentence(none)).toBe('#103 has no parent issue, so no epic holds it');
    expect(noHopSentence(stray)).toBe('#109 has a parent that is no epic issue on the board listing');
    expect(noHopSentence(foreign)).toBe('other/lib#7 is on another repository, which the board listing does not read');
  });
});
