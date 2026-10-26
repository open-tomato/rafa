/**
 * Tests for the Rank rule (`rules.ts`, `ranksOf` and `rankOf`).
 *
 * Every board below is a literal body read with the real
 * `parseRoadmapBody`, and every epic is read off a literal listing with
 * the real `readEpics`, so the numbers are held to the order those
 * readers answer rather than to an order the test spells again.
 *
 * ## The controls
 *
 *  - An issue on no line is read beside the same issue on a line, so a
 *    null proves the line is what was missing, not that the rule numbers
 *    nothing.
 *  - A ticked line is held against the same board with the box empty:
 *    every number must match, so ticking moves no Rank.
 *  - An epic's checklist is written out of number order, and a label-only
 *    member numbered below every checklist line, so a rule sorting by
 *    number fails.
 *  - In `native` mode the sub-issue order differs from ascending number,
 *    and the rows carry `epic:` labels naming a different grouping, so a
 *    native reading that fell back to the labels fails.
 */
import type { RankFacts } from './rules.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { Epic, EpicRelations } from '../epics.js';
import type { BoardIssue, BoardIssueLink } from '../roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../../adapters/tracker/github.js';
import { readEpics, unknownEpic } from '../epics.js';
import { createNativeRelations } from '../relations/native.js';
import { parseRoadmapBody } from '../roadmap.js';

import { rankOf, ranksOf } from './rules.js';

/** The board's own repository, for the native rows. */
const BOARD = 'acme/board';

/** A `gh` every call to which fails the case: the rule never spawns. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** The `native` adapter on {@link BOARD}. */
const NATIVE: EpicRelations = createNativeRelations({ gh: NO_GH, repository: BOARD });

/** A day no epic below is late on. */
const TODAY = new Date(2026, 9, 6);

/** The fields a case may set on a row. */
interface RowFields {
  readonly body?: string;
  readonly state?: 'OPEN' | 'CLOSED';
  readonly stateReason?: string | null;
  readonly parent?: number;
  readonly subIssues?: readonly number[];
}

/** Issue `number` as a native link node names it. */
function link(number: number): BoardIssueLink {
  return { number, title: `#${String(number)}`, state: 'OPEN', repository: BOARD };
}

/** One listing row, its type read from its labels, with the native fields too. */
function row(number: number, labels: readonly string[], fields: RowFields = {}): BoardIssue {
  const subIssues = fields.subIssues ?? [];
  return {
    number,
    title: `#${String(number)}`,
    body: fields.body ?? '',
    state: fields.state ?? 'OPEN',
    stateReason: fields.stateReason ?? null,
    labels,
    type: typeOfLabels(labels),
    module: '',
    parent: fields.parent === undefined
      ? null
      : link(fields.parent),
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
    subIssuesSummary: { total: subIssues.length, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: subIssues.map(link) },
  };
}

/** A checklist body: one `- [ ] #<n>` line per entry, `x` ticking it. */
function checklist(entries: readonly (readonly [issue: number, ticked?: boolean])[]): string {
  return entries
    .map(([issue, ticked = false]) => {
      const box = ticked
        ? 'x'
        : ' ';
      return `- [${box}] #${String(issue)} why`;
    })
    .join('\n');
}

/** Every epic on `issues`, read in `labels` mode. */
function labelsEpics(issues: readonly BoardIssue[]): readonly Epic[] {
  return readEpics({ issues, claims: new Set(), today: TODAY }).epics;
}

/** Every epic on `issues`, read in `native` mode. */
function nativeEpics(issues: readonly BoardIssue[]): readonly Epic[] {
  return readEpics({ issues, claims: new Set(), today: TODAY, relations: NATIVE }).epics;
}

/** The facts of a board whose body is `board`, with `epics`. */
function facts(board: string, epics: readonly Epic[] = []): RankFacts {
  return { lines: parseRoadmapBody(board), epics };
}

/** Every Rank `ranksOf` answers, as `[issue, rank]` pairs in Rank order. */
function ranked(input: RankFacts): readonly (readonly [number, number])[] {
  return [...ranksOf(input)].sort(([, left], [, right]) => left - right);
}

describe('ranksOf: the board\'s lines', () => {
  it('numbers each line in the board\'s order, 1 first, never by issue number', () => {
    const board = checklist([[30], [10], [20]]);

    expect(ranked(facts(board))).toEqual([[30, 1], [10, 2], [20, 3]]);
  });

  it('numbers nothing for a board with no line', () => {
    expect(ranksOf(facts('No lines yet.')).size).toBe(0);
  });

  it('reads no line inside a fenced block, as parseRoadmapBody reads none', () => {
    const board = [checklist([[10]]), '```', checklist([[99]]), '```', checklist([[20]])].join('\n');

    expect(ranked(facts(board))).toEqual([[10, 1], [20, 2]]);
  });

  it('keeps the first Rank of an issue named on two lines, its second line taking no number', () => {
    const board = checklist([[10], [20], [10], [30]]);

    expect(ranked(facts(board))).toEqual([[10, 1], [20, 2], [30, 3]]);
  });
});

describe('ranksOf: ticked items keep their Rank', () => {
  it('numbers a ticked board line where it stands, so ticking it moves no Rank', () => {
    const open = checklist([[10], [20], [30]]);
    const ticked = checklist([[10], [20, true], [30]]);

    expect(ranked(facts(ticked))).toEqual([[10, 1], [20, 2], [30, 3]]);
    expect(ranked(facts(ticked))).toEqual(ranked(facts(open)));
  });

  it('numbers a ticked line of an epic\'s checklist, so ticking it moves no member\'s Rank', () => {
    const board = checklist([[40], [50]]);
    const listing = (tickedFirst: boolean): readonly BoardIssue[] => [
      row(40, ['type:epic', 'epic:alpha'], { body: checklist([[42, tickedFirst], [41]]) }),
      row(41, ['type:spec', 'epic:alpha']),
      row(42, ['type:spec', 'epic:alpha'], { state: tickedFirst
        ? 'CLOSED'
        : 'OPEN' }),
    ];

    const open = ranked(facts(board, labelsEpics(listing(false))));
    const ticked = ranked(facts(board, labelsEpics(listing(true))));

    expect(ticked).toEqual([[40, 1], [42, 2], [41, 3], [50, 4]]);
    expect(ticked).toEqual(open);
  });
});

describe('ranksOf: an epic\'s members in labels mode', () => {
  /**
   * Board: #60, epic #40, #70. Epic #40's checklist names #45 then #43;
   * #41 and #44 carry `epic:alpha` but sit on no checklist line, #44
   * closed; #42 carries the label and is closed with no line either.
   */
  const LISTING: readonly BoardIssue[] = [
    row(40, ['type:epic', 'epic:alpha'], { body: checklist([[45], [43]]) }),
    row(41, ['type:spec', 'epic:alpha']),
    row(42, ['type:spec', 'epic:alpha'], { state: 'CLOSED', stateReason: 'COMPLETED' }),
    row(43, ['type:spec', 'epic:alpha']),
    row(44, ['type:spec', 'epic:alpha']),
    row(45, ['type:spec', 'epic:alpha']),
  ];
  const BOARD_BODY = checklist([[60], [40], [70]]);

  it('numbers the members right after the epic: its checklist first, then its open members missing from it by number', () => {
    expect(ranked(facts(BOARD_BODY, labelsEpics(LISTING)))).toEqual([
      [60, 1],
      [40, 2],
      [45, 3],
      [43, 4],
      [41, 5],
      [44, 6],
      [70, 7],
    ]);
  });

  it('gives a member closed off the checklist no Rank, sitting on no line', () => {
    const ranks = ranksOf(facts(BOARD_BODY, labelsEpics(LISTING)));

    expect(rankOf(ranks, 42)).toBeNull();
  });

  it('numbers a checklist line whose issue lacks the epic\'s label, since the checklist is the order', () => {
    const listing = [
      row(40, ['type:epic', 'epic:alpha'], { body: checklist([[46]]) }),
      row(46, ['type:spec']),
    ];

    expect(ranked(facts(checklist([[40]]), labelsEpics(listing)))).toEqual([[40, 1], [46, 2]]);
  });

  it('numbers a member also on a board line where it first appears, its later line taking no number', () => {
    const board = checklist([[45], [40]]);

    expect(ranked(facts(board, labelsEpics(LISTING)))).toEqual([
      [45, 1],
      [40, 2],
      [43, 3],
      [41, 4],
      [44, 5],
    ]);
  });

  it('opens only the board\'s epics: an epic named on another\'s checklist takes one number, its members unread there', () => {
    const listing = [
      row(40, ['type:epic', 'epic:alpha'], { body: checklist([[80], [41]]) }),
      row(41, ['type:spec', 'epic:alpha']),
      row(80, ['type:epic', 'epic:beta']),
      row(81, ['type:spec', 'epic:beta']),
    ];

    const ranks = ranksOf(facts(checklist([[40]]), labelsEpics(listing)));

    expect([...ranks]).toEqual([[40, 1], [80, 2], [41, 3]]);
    expect(rankOf(ranks, 81)).toBeNull();
  });

  it('numbers an epic with no members and no checklist as its one line', () => {
    const listing = [row(40, ['type:epic', 'epic:alpha'])];

    expect(ranked(facts(checklist([[40], [50]]), labelsEpics(listing)))).toEqual([[40, 1], [50, 2]]);
  });

  it('numbers an epic read off a failed listing as one line, having no members to read', () => {
    expect(ranked(facts(checklist([[40], [50]]), [unknownEpic(40, 'gh failed')]))).toEqual([[40, 1], [50, 2]]);
  });
});

describe('ranksOf: an epic\'s members in native mode', () => {
  /**
   * Epic #40 holds #43, #41, #42 as sub-issues in that order, #41
   * closed; #44 carries `epic:alpha` with no parent, and the epic's body
   * holds a checklist naming #44, neither of which native mode reads.
   */
  const LISTING: readonly BoardIssue[] = [
    row(40, ['type:epic', 'epic:alpha'], { body: checklist([[44]]), subIssues: [43, 41, 42] }),
    row(41, ['type:spec'], { parent: 40, state: 'CLOSED', stateReason: 'COMPLETED' }),
    row(42, ['type:spec'], { parent: 40 }),
    row(43, ['type:spec'], { parent: 40 }),
    row(44, ['type:spec', 'epic:alpha']),
  ];

  it('numbers the sub-issues right after the epic, in the epic\'s order, a closed one keeping its place', () => {
    const board = checklist([[40], [50]]);

    expect(ranked(facts(board, nativeEpics(LISTING)))).toEqual([[40, 1], [43, 2], [41, 3], [42, 4], [50, 5]]);
  });

  it('reads no checklist or epic: label for membership, which the same listing in labels mode reads', () => {
    const board = checklist([[40]]);

    expect(rankOf(ranksOf(facts(board, nativeEpics(LISTING))), 44)).toBeNull();
    expect(ranked(facts(board, labelsEpics(LISTING)))).toEqual([[40, 1], [44, 2]]);
  });
});

describe('rankOf: an issue on no line', () => {
  it('answers null for an issue on no line, and its Rank once a line names it', () => {
    const without = ranksOf(facts(checklist([[10], [20]])));
    const withIt = ranksOf(facts(checklist([[10], [20], [30]])));

    expect(rankOf(without, 30)).toBeNull();
    expect(rankOf(withIt, 30)).toBe(3);
  });

  it('answers null for a member of an epic the board does not name', () => {
    const listing = [
      row(40, ['type:epic', 'epic:alpha'], { body: checklist([[41]]) }),
      row(41, ['type:spec', 'epic:alpha']),
    ];

    const ranks = ranksOf(facts(checklist([[10]]), labelsEpics(listing)));

    expect(rankOf(ranks, 40)).toBeNull();
    expect(rankOf(ranks, 41)).toBeNull();
    expect(rankOf(ranks, 10)).toBe(1);
  });
});
