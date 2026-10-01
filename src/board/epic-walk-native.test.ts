/**
 * Tests for the epic descent (`src/board/epic-walk.ts`) in `native` mode:
 * `descendRoadmap`, `epicLines` and `nextNowEpic` handed the board's
 * relationships port, walking an epic's open sub-issues in its sub-issue
 * order. The `labels` cases stay in `./epic-walk.test.ts`.
 *
 * Every case plants one literal native board behind the descent's seams,
 * as `./epic-walk.test.ts` does, and reads it through the real `native`
 * adapter made over a `gh` that fails any call. Nothing spawns.
 *
 * ## The controls
 *
 *  - Every epic also carries a checklist and `epic:` labels naming other
 *    issues, and the same board walked with no port must walk those, so
 *    a native walk that fell back to the checklist or labels fails.
 *  - Sub-issue order is chosen to differ from ascending number.
 *  - The native-only `subIssues` key is asserted absent, by
 *    `Object.keys`, on the same epic walked in `labels` mode.
 *  - `nextNowEpic` answers an epic in native mode beside a board where
 *    only labels make it one, which native mode must pass as dry.
 */
import type { SpecIssue, SpecIssueReader } from './issue.js';
import type { BoardIssue, BoardIssueLink } from './roadmap-board.js';
import type { RoadmapLine, RoadmapPullRequest } from './roadmap.js';
import type { GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';

import {
  descendRoadmap,
  dryEpicSentence,
  epicHeaderSentence,
  epicLines,
  nextNowEpic,
  NOW_HORIZON_LABEL,
  pickDescendedLine,
} from './epic-walk.js';
import { readEpics } from './epics.js';
import { createNativeRelations } from './relations/native.js';
import { createRoadmapReadings, parseRoadmapBody } from './roadmap.js';

/** The board's own repository. */
const BOARD = 'acme/board';

/** A `gh` every call to which fails the case: reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** The `native` adapter on {@link BOARD}. */
const NATIVE = createNativeRelations({ gh: NO_GH, repository: BOARD });

/** Issue `number` as a link node names it. */
function link(number: number): BoardIssueLink {
  return { number, title: `issue ${String(number)}`, state: 'OPEN', repository: BOARD };
}

/** The fields a case may set on a native row. */
interface RowFields {
  readonly labels?: readonly string[];
  readonly state?: 'OPEN' | 'CLOSED';
  readonly body?: string;
  readonly parent?: number;
  readonly subIssues?: readonly number[];
}

/** A native row carrying all five native fields, its type read from its labels. */
function row(number: number, fields: RowFields = {}): BoardIssue {
  const labels = fields.labels ?? [];
  const subIssues = fields.subIssues ?? [];
  return {
    number,
    title: `issue ${String(number)}`,
    body: fields.body ?? '',
    state: fields.state ?? 'OPEN',
    stateReason: fields.state === 'CLOSED'
      ? 'COMPLETED'
      : null,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
    parent: fields.parent === undefined
      ? null
      : link(fields.parent),
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
    subIssuesSummary: { total: subIssues.length, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: subIssues.map(link) },
  };
}

/** A three-line body whose checklist names `checklist`. */
function checklistBody(checklist: readonly number[]): string {
  return ['## Acceptance criteria', '', ...checklist.map((item) => `- [ ] #${String(item)} spec ${String(item)}`)].join('\n');
}

/** An open `now` epic `epic:<slug>` holding `order` as sub-issues, its body's checklist naming `checklist`. */
function epic(number: number, slug: string, order: readonly number[], checklist: readonly number[] = []): BoardIssue {
  return row(number, {
    labels: ['type:epic', `epic:${slug}`, NOW_HORIZON_LABEL],
    subIssues: order,
    body: checklistBody(checklist),
  });
}

/** A `type:spec` row, a sub-issue of `parent` when given, carrying `epic:<slug>` when given. */
function spec(number: number, parent: number | null, fields: RowFields & { readonly slug?: string } = {}): BoardIssue {
  const slugLabels = fields.slug === undefined
    ? []
    : [`epic:${fields.slug}`];
  return row(number, {
    ...fields,
    labels: ['type:spec', ...slugLabels],
    ...parent === null
      ? {}
      : { parent },
  });
}

/** A roadmap body naming `lines`. */
function roadmap(...lines: readonly number[]): readonly RoadmapLine[] {
  return parseRoadmapBody(lines.map((line) => `- [ ] #${String(line)} why`).join('\n'));
}

/** The descent's seams over `board`, in `native` mode unless `native` is false. */
function seamsOver(board: readonly BoardIssue[], native = true): Parameters<typeof descendRoadmap>[1] {
  const taken = new Map<number, Promise<SpecIssue>>();
  const raw = (number: number): Promise<SpecIssue> => {
    const found = board.find((candidate) => candidate.number === number);
    if (found === undefined) return Promise.reject(new Error(`no issue #${String(number)} is planted`));
    return Promise.resolve({
      number,
      title: found.title,
      body: found.body,
      state: found.state,
      labels: found.labels,
      author: '',
    });
  };
  const issues: SpecIssueReader = (number) => {
    const found = taken.get(number) ?? raw(number);
    taken.set(number, found);
    return found;
  };
  const readings = createRoadmapReadings({
    issues,
    branches: { refs: [], problems: [] },
    pullRequests: (): Promise<readonly RoadmapPullRequest[]> => Promise.resolve([]),
  });
  const base = { issues, readings, listing: (): Promise<readonly BoardIssue[]> => Promise.resolve(board) };
  return native
    ? { ...base, relations: NATIVE }
    : base;
}

/**
 * Epic #10 holds #13, #11, #12 as sub-issues in that order, #12 closed;
 * its checklist names #14 and #15, which carry `epic:alpha` and no parent.
 */
const WALK_BOARD: readonly BoardIssue[] = [
  epic(10, 'alpha', [13, 11, 12], [14, 15]),
  spec(11, 10),
  spec(12, 10, { state: 'CLOSED' }),
  spec(13, 10),
  spec(14, null, { slug: 'alpha' }),
  spec(15, null, { slug: 'alpha' }),
];

describe('descendRoadmap in native mode', () => {
  it('walks the epic\'s open sub-issues in sub-issue order, and nothing else', async () => {
    const descent = await descendRoadmap(roadmap(10), seamsOver(WALK_BOARD));

    expect(descent.lines.map((line) => line.issue)).toEqual([13, 11]);
    expect(descent.epic?.subIssues?.map((member) => member.number)).toEqual([13, 11]);
    expect(descent.epic?.checklist).toEqual([]);
    expect(descent.epic?.labelOnly).toEqual([]);
    expect(descent.epic?.slug).toBeNull();
  });

  it('numbers each line past the epic body\'s last line, one apiece', async () => {
    const descent = await descendRoadmap(roadmap(10), seamsOver(WALK_BOARD));

    expect(descent.lines.map((line) => line.lineNumber)).toEqual([5, 6]);
    expect(descent.lines.map((line) => line.why)).toEqual(['issue 13', 'issue 11']);
  });

  it('control: the same board with no port walks the checklist, with no subIssues key', async () => {
    const descent = await descendRoadmap(roadmap(10), seamsOver(WALK_BOARD, false));

    expect(descent.lines.map((line) => line.issue)).toEqual([14, 15]);
    expect(descent.epic?.slug).toBe('alpha');
    expect(Object.keys(descent.epic ?? {})).not.toContain('subIssues');
  });

  it('passes an epic whose every sub-issue is closed as done, with its done/total', async () => {
    const board = [
      epic(10, 'alpha', [11], [14]),
      spec(11, 10, { state: 'CLOSED' }),
      spec(14, null, { slug: 'alpha' }),
      spec(20, null),
    ];

    const descent = await descendRoadmap(roadmap(10, 20), seamsOver(board));

    expect(descent.passed).toEqual([{ kind: 'epic', skip: { line: roadmap(10)[0], reason: 'done', detail: '1/1' } }]);
    expect(descent.epic).toBeNull();
    expect(descent.lines.map((line) => line.issue)).toEqual([20]);
  });

  it('runs dry on an epic whose only sub-issues are taken, naming sub-issues', async () => {
    const board = [epic(10, 'alpha', [11]), spec(11, 10)];
    const seams = seamsOver(board);
    const taken = { ...seams, readings: { ...seams.readings, branchFor: () => 'feat/rafa-11-taken' } };

    const { dry, descent } = await pickDescendedLine(roadmap(10), taken);

    expect(dry).toBe(true);
    expect(descent.epic === null
      ? ''
      : dryEpicSentence(descent.epic)).toContain('every open sub-issue is done or taken');
  });
});

describe('the walk\'s sentences in native mode', () => {
  it('heads the walk with sub-issue order, and the labels wording stays as it was', async () => {
    const native = await descendRoadmap(roadmap(10), seamsOver(WALK_BOARD));
    const labels = await descendRoadmap(roadmap(10), seamsOver(WALK_BOARD, false));

    expect(native.epic === null
      ? ''
      : epicHeaderSentence(native.epic))
      .toBe('walking into epic #10 issue 10 (1/3 done): its open sub-issues, in the order the epic holds them');
    expect(labels.epic === null
      ? ''
      : epicHeaderSentence(labels.epic))
      .toBe('walking into epic #10 issue 10 (0/2 done): its checklist, then its labelled members missing from it');
  });
});

describe('epicLines in native mode', () => {
  it('answers the open sub-issues in order, and the checklist and label-only parts empty', () => {
    const [read] = readEpics({ issues: WALK_BOARD, claims: new Set(), today: new Date(0), relations: NATIVE }).epics;
    if (read === undefined) throw new Error('epic #10 was not read');

    const lines = epicLines(read, WALK_BOARD[0] ?? { body: '' });

    expect(lines.lines.map((line) => line.issue)).toEqual([13, 11]);
    expect(lines.subIssues?.map((member) => member.number)).toEqual([13, 11]);
    expect(lines.checklist).toEqual([]);
    expect(lines.labelOnly).toEqual([]);
  });

  it('control: the same epic read in labels mode answers no subIssues key', () => {
    const [read] = readEpics({ issues: WALK_BOARD, claims: new Set(), today: new Date(0) }).epics;
    if (read === undefined) throw new Error('epic #10 was not read');

    expect(Object.keys(epicLines(read, WALK_BOARD[0] ?? { body: '' }))).toEqual(['checklist', 'labelOnly', 'lines']);
  });
});

describe('nextNowEpic in native mode', () => {
  /** Board #1 lists epics #10 then #30; #10 has run dry, and #30 holds sub-issue #31 unless `labelOnly`. */
  function board(labelOnly: boolean): readonly BoardIssue[] {
    return [
      row(1, { labels: ['type:roadmap'], body: '- [ ] #10 first\n- [ ] #30 second' }),
      epic(10, 'alpha', [11]),
      spec(11, 10, { state: 'CLOSED' }),
      spec(12, 10),
      epic(30, 'gamma', labelOnly
        ? []
        : [31]),
      labelOnly
        ? spec(31, null, { slug: 'gamma' })
        : spec(31, 30),
    ];
  }

  /** `nextNowEpic` past epic #10 on `listing`, in `native` mode unless told otherwise. */
  async function next(listing: readonly BoardIssue[], native = true): ReturnType<typeof nextNowEpic> {
    const { readings } = seamsOver(listing);
    const request = { after: 10, board: 1, listing, readings };
    return nextNowEpic(native
      ? { ...request, relations: NATIVE }
      : request);
  }

  it('answers the next epic with an open sub-issue, named by number and title', async () => {
    const found = await next(board(false));

    expect(found?.number).toBe(30);
    expect(found?.slug).toBeNull();
    expect(found?.progress).toEqual({ done: 0, total: 1, notPlanned: 0 });
  });

  it('control: an epic whose only member carries its label is dry in native mode, but not in labels mode', async () => {
    expect(await next(board(true))).toBeNull();
    expect((await next(board(true), false))?.number).toBe(30);
  });
});
