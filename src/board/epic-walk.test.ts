/**
 * Tests for the epic descent (`src/board/epic-walk.ts`): which roadmap
 * lines it passes, the epic it walks into and the lines it walks there,
 * the label-only members it names, the dry stop, and a roadmap with no
 * epic line left exactly as written.
 *
 * Every case plants one literal board behind the three seams: an issue
 * reader memoised as both walkers memoise theirs, readings made over it
 * with `createRoadmapReadings`, and a listing answering the same rows.
 * The raw reader and the listing count their calls, which is how the
 * cases read what the descent spent. Nothing spawns `gh` or `git`.
 *
 * ## The controls
 *
 *  - The roadmap with no epic line is read beside the same roadmap with
 *    an epic first, which must NOT come back unchanged, so an
 *    "unchanged" that was really "never looked" fails.
 *  - Its reads are compared with `pickNextRoadmapLine`'s alone over the
 *    same board, and a roadmap whose later line is an epic must leave
 *    that epic unread, so a descent that read ahead fails.
 *  - The dry epic is read beside a second `now` epic further down, whose
 *    issue must be neither read nor walked.
 *  - Each passed epic line is paired with one that is walked into.
 *  - The next `now` epic: each board that answers null is read beside
 *    one that answers an epic, the epic BEFORE the given one is a good
 *    `now` epic that must not be answered, and the epic after the answer
 *    must be left unread.
 */
import type { SpecIssue, SpecIssueReader } from './issue.js';
import type { BoardIssue } from './roadmap-board.js';
import type { RoadmapPullRequest, RoadmapLine } from './roadmap.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';

import {
  descendRoadmap,
  descentPassSentence,
  dryEpicSentence,
  epicHeaderSentence,
  epicLines,
  epicSkipSentence,
  isEpicIssue,
  isNowEpic,
  labelOnlySentence,
  nextNowEpic,
  NOW_HORIZON_LABEL,
  pickDescendedLine,
} from './epic-walk.js';
import { readEpics } from './epics.js';
import { createRoadmapReadings, parseRoadmapBody, pickNextRoadmapLine } from './roadmap.js';

/** The fields a case may set on an issue. */
interface IssueFields {
  readonly labels?: readonly string[];
  readonly state?: 'OPEN' | 'CLOSED';
  readonly stateReason?: string | null;
  readonly body?: string;
}

/** One board row, its type read from its labels as the listing reads it. */
function issue(number: number, fields: IssueFields = {}): BoardIssue {
  const labels = fields.labels ?? [];
  return {
    number,
    title: `issue ${String(number)}`,
    body: fields.body ?? '',
    state: fields.state ?? 'OPEN',
    stateReason: fields.stateReason ?? null,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
  };
}

/** An epic row: `type:epic`, its slug, `horizon:now` unless told otherwise, and a checklist body. */
function epic(number: number, slug: string, checklist: readonly number[], fields: IssueFields = {}): BoardIssue {
  const lines = checklist.map((item) => `- [ ] #${String(item)} spec ${String(item)}`);
  return issue(number, {
    labels: ['type:epic', `epic:${slug}`, NOW_HORIZON_LABEL],
    body: ['## Acceptance criteria', '', '- it works', '', 'Estimate: a week', '', ...lines].join('\n'),
    ...fields,
  });
}

/** A spec row carrying `epic:<slug>`. */
function member(number: number, slug: string, fields: IssueFields = {}): BoardIssue {
  return issue(number, { labels: ['type:spec', `epic:${slug}`], ...fields });
}

/** A roadmap body naming `lines`, a leading `x` ticking one. */
function roadmap(...lines: readonly string[]): readonly RoadmapLine[] {
  return parseRoadmapBody(lines.map((line) => line.startsWith('x')
    ? `- [x] #${line.slice(1)} why`
    : `- [ ] #${line} why`).join('\n'));
}

/** The board a case plants, what it spent, and the seams over it. */
interface World {
  /** Every raw issue read, in order; the memo keeps repeats out. */
  readonly reads: number[];
  /** How many times the listing was read. */
  readonly listings: () => number;
  readonly seams: Parameters<typeof descendRoadmap>[1];
}

/** `read`, called at most once per issue, as both walkers memoise theirs. */
function memoise(read: SpecIssueReader): SpecIssueReader {
  const taken = new Map<number, Promise<SpecIssue>>();
  return (number: number): Promise<SpecIssue> => {
    const found = taken.get(number) ?? read(number);
    taken.set(number, found);
    return found;
  };
}

/** The seams over `board`, with `branches` and `pulls` as the taken readings. */
function world(board: readonly BoardIssue[], options: {
  readonly branches?: readonly string[];
  readonly pulls?: readonly RoadmapPullRequest[];
} = {}): World {
  const reads: number[] = [];
  let listed = 0;
  const raw: SpecIssueReader = async (number: number): Promise<SpecIssue> => {
    reads.push(number);
    const row = board.find((candidate) => candidate.number === number);
    if (row === undefined) throw new Error(`no issue #${String(number)} is planted`);
    return { number, title: row.title, body: row.body, state: row.state, labels: row.labels, author: '' };
  };
  const issues = memoise(raw);
  const readings = createRoadmapReadings({
    issues,
    branches: { refs: options.branches ?? [], problems: [] },
    pullRequests: async (): Promise<readonly RoadmapPullRequest[]> => options.pulls ?? [],
  });
  return {
    reads,
    listings: () => listed,
    seams: {
      issues,
      readings,
      listing: async (): Promise<readonly BoardIssue[]> => {
        listed += 1;
        return board;
      },
    },
  };
}

describe('a roadmap with no epic line', () => {
  const board = [
    issue(1, { labels: ['type:spec'], state: 'CLOSED' }),
    issue(2, { labels: ['type:spec'] }),
    issue(3, { labels: ['type:spec'] }),
    issue(4, { labels: ['type:spec'] }),
  ];

  it('comes back with its lines unchanged, nothing passed and no epic', async () => {
    const lines = roadmap('x9', '1', '2', '3');
    const { seams, listings } = world(board, { branches: ['refs/heads/feat/rafa-2-two'] });

    const descent = await descendRoadmap(lines, seams);

    expect(descent.lines).toBe(lines);
    expect(descent.lines).toEqual(lines);
    expect(descent.passed).toEqual([]);
    expect(descent.epic).toBeNull();
    expect(listings()).toBe(0);
  });

  it('spends the reads the walk alone spends, and picks what it picks', async () => {
    const lines = roadmap('x9', '1', '2', '3', '4');
    const options = { branches: ['refs/heads/feat/rafa-2-two'] };
    const alone = world(board, options);
    const withDescent = world(board, options);

    const expected = await pickNextRoadmapLine(lines, alone.seams.readings);
    const { pick, dry } = await pickDescendedLine(lines, withDescent.seams);

    expect(pick).toEqual(expected);
    expect(pick.line?.issue).toBe(3);
    expect(dry).toBe(false);
    expect(withDescent.reads).toEqual(alone.reads);
    expect(withDescent.reads).toEqual([1, 2, 3]);
  });

  it('reads no line past the one the walk stops on, an epic among them', async () => {
    const lines = roadmap('2', '10');
    const { seams, reads, listings } = world([...board, epic(10, 'big', [3])]);

    const descent = await descendRoadmap(lines, seams);

    expect(descent.lines).toBe(lines);
    expect(reads).toEqual([2]);
    expect(listings()).toBe(0);
  });

  it('control: a roadmap whose first line is an epic does not come back unchanged', async () => {
    const lines = roadmap('10', '2');
    const { seams, listings } = world([...board, epic(10, 'big', [3]), member(3, 'big')]);

    const descent = await descendRoadmap(lines, seams);

    expect(descent.lines).not.toEqual(lines);
    expect(descent.lines.map((line) => line.issue)).toEqual([3]);
    expect(listings()).toBe(1);
  });
});

describe('walking into an epic', () => {
  const board = [
    epic(10, 'walk', [11, 12, 13]),
    member(11, 'walk', { state: 'CLOSED' }),
    member(12, 'walk'),
    member(13, 'walk'),
    member(14, 'walk'),
    issue(20, { labels: ['type:spec'] }),
  ];

  it('walks its checklist and proposes its first open spec', async () => {
    const lines = roadmap('10', '20');
    const { seams } = world(board);

    const { descent, pick, dry } = await pickDescendedLine(lines, seams);

    expect(descent.epic?.number).toBe(10);
    expect(descent.epic?.slug).toBe('walk');
    expect(descent.epic?.progress).toEqual({ done: 1, total: 4, notPlanned: 0 });
    expect(descent.passed).toEqual([]);
    expect(pick.line?.issue).toBe(12);
    expect(pick.skipped.map((skip) => skip.line.issue)).toEqual([11]);
    expect(dry).toBe(false);
  });

  it('keeps the epic\'s own lines only, so the roadmap line after it is never walked', async () => {
    const { seams } = world(board);

    const descent = await descendRoadmap(roadmap('10', '20'), seams);

    expect(descent.lines.map((line) => line.issue)).toEqual([11, 12, 13, 14]);
    expect(descent.lines.some((line) => line.issue === 20)).toBe(false);
  });

  it('passes the roadmap lines before it and reports them in order', async () => {
    const lines = roadmap('x5', '20', '10');
    const { seams } = world(board, { branches: ['origin/feat/rafa-20-other'] });

    const descent = await descendRoadmap(lines, seams);

    expect(descent.epic?.number).toBe(10);
    expect(descent.passed.map(descentPassSentence)).toEqual([
      '#5 done: ticked on the roadmap',
      '#20 taken: branch origin/feat/rafa-20-other exists',
    ]);
  });

  it('walks a ticked checklist line as the roadmap walks one: passed as ticked', async () => {
    const ticked = [epic(10, 'walk', []), member(12, 'walk'), member(13, 'walk')];
    const withBody = ticked.map((row) => row.number === 10
      ? { ...row, body: '- [x] #12 spec\n- [ ] #13 spec' }
      : row);
    const { seams } = world(withBody);

    const { pick } = await pickDescendedLine(roadmap('10'), seams);

    expect(pick.skipped.map((skip) => skip.reason)).toEqual(['ticked']);
    expect(pick.line?.issue).toBe(13);
  });

  it('walks a checklist spec missing the epic\'s label, since the checklist is the order', async () => {
    const { seams } = world([epic(10, 'walk', [30]), issue(30, { labels: ['type:spec'] })]);

    const { pick } = await pickDescendedLine(roadmap('10'), seams);

    expect(pick.line?.issue).toBe(30);
  });
});

describe('label-only members', () => {
  const board = [
    epic(10, 'walk', [12]),
    member(12, 'walk', { state: 'CLOSED' }),
    member(17, 'walk'),
    member(15, 'walk'),
    member(16, 'walk', { state: 'CLOSED' }),
    member(18, 'walk', { state: 'CLOSED', stateReason: 'NOT_PLANNED' }),
  ];

  it('walks the open ones after the checklist, by ascending number, and names them', async () => {
    const { seams } = world(board);

    const { descent, pick } = await pickDescendedLine(roadmap('10'), seams);

    expect(descent.lines.map((line) => line.issue)).toEqual([12, 15, 17]);
    expect(descent.epic?.labelOnly.map((row) => row.number)).toEqual([15, 17]);
    expect(pick.line?.issue).toBe(15);
    expect(pick.line?.why).toBe('issue 15');
  });

  it('numbers them past the epic body\'s last line, each apart from every other', async () => {
    const { seams } = world(board);
    const bodyLines = (board[0]?.body ?? '').split('\n').length;

    const descent = await descendRoadmap(roadmap('10'), seams);
    const numbers = descent.lines.map((line) => line.lineNumber);

    expect(numbers.slice(1)).toEqual([bodyLines + 1, bodyLines + 2]);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('are the lines epicLines answers for the epic read, the one spelling rafa epics prints', async () => {
    const { seams } = world(board);
    const [row] = board;
    const read = readEpics({ issues: board, claims: new Set(), today: new Date(0) }).epics[0];
    if (row === undefined || read === undefined) throw new Error('the board holds no epic');

    const descent = await descendRoadmap(roadmap('10'), seams);
    const lines = epicLines(read, row);

    expect(lines.lines).toEqual(descent.lines);
    expect(lines.checklist.map((line) => line.issue)).toEqual([12]);
    expect(lines.labelOnly.map((issue) => issue.number)).toEqual([15, 17]);
  });

  it('reports each by name with its label', async () => {
    const { seams } = world(board);

    const descent = await descendRoadmap(roadmap('10'), seams);
    const walked = descent.epic;
    if (walked === null) throw new Error('the epic was not walked into');

    expect(walked.labelOnly.map((row) => labelOnlySentence(walked, row))).toEqual([
      '#15 issue 15 carries epic:walk but is not on epic #10\'s checklist; it is walked after the checklist, by issue number',
      '#17 issue 17 carries epic:walk but is not on epic #10\'s checklist; it is walked after the checklist, by issue number',
    ]);
  });
});

describe('the epic lines passed over', () => {
  const walked = [epic(14, 'now', [15]), member(15, 'now')];

  it('passes ticked, closed, not-now and done epics, and walks into the first now epic not done', async () => {
    const board = [
      ...walked,
      epic(10, 'ticked', [], { state: 'CLOSED' }),
      epic(11, 'closed', [], { state: 'CLOSED' }),
      epic(12, 'later', [], { labels: ['type:epic', 'epic:later', 'horizon:next'] }),
      epic(13, 'done', [16]),
      member(16, 'done', { state: 'CLOSED' }),
    ];
    const { seams, reads, listings } = world(board);

    const descent = await descendRoadmap(roadmap('x10', '11', '12', '13', '14'), seams);

    expect(descent.epic?.number).toBe(14);
    expect(descent.passed.map(descentPassSentence)).toEqual([
      '#10 done: ticked on the roadmap',
      'epic #11 done: the epic is closed',
      'epic #12 passed: it carries horizon:next, and only a horizon:now epic is walked into',
      'epic #13 done: every member is closed (1/1)',
    ]);
    expect(reads).toEqual([11, 12, 13, 14]);
    expect(listings()).toBe(1);
  });

  it('passes an epic carrying no horizon, or two', async () => {
    const board = [
      ...walked,
      epic(12, 'bare', [], { labels: ['type:epic', 'epic:bare'] }),
      epic(13, 'both', [], { labels: ['type:epic', 'epic:both', NOW_HORIZON_LABEL, 'horizon:later'] }),
    ];
    const { seams, listings } = world(board);

    const descent = await descendRoadmap(roadmap('12', '13', '14'), seams);

    expect(descent.passed.map(descentPassSentence)).toEqual([
      'epic #12 passed: it carries no horizon: label, and only a horizon:now epic is walked into',
      'epic #13 passed: it carries horizon:now, horizon:later, and only a horizon:now epic is walked into',
    ]);
    expect(descent.epic?.number).toBe(14);
    expect(listings()).toBe(1);
  });

  it('lists no board when every epic line is passed by its labels or state', async () => {
    const board = [
      epic(11, 'closed', [], { state: 'CLOSED' }),
      epic(12, 'later', [], { labels: ['type:epic', 'epic:later', 'horizon:later'] }),
      issue(20, { labels: ['type:spec'] }),
    ];
    const { seams, listings } = world(board);

    const descent = await descendRoadmap(roadmap('11', '12', '20', '21'), seams);

    expect(listings()).toBe(0);
    expect(descent.epic).toBeNull();
    expect(descent.lines.map((line) => line.issue)).toEqual([20, 21]);
    expect(descent.passed.map((pass) => pass.kind)).toEqual(['epic', 'epic']);
  });

  it('answers no lines when every line, epic lines among them, is passed', async () => {
    const { seams } = world([epic(11, 'closed', [], { state: 'CLOSED' })]);

    const { descent, pick, dry } = await pickDescendedLine(roadmap('x5', '11'), seams);

    expect(descent.lines).toEqual([]);
    expect(descent.passed).toHaveLength(2);
    expect(pick.line).toBeNull();
    expect(dry).toBe(false);
  });
});

describe('the dry epic', () => {
  it('stops the walk and never reads or names the second epic', async () => {
    const board = [
      epic(10, 'first', [11, 12]),
      member(11, 'first', { state: 'CLOSED' }),
      member(12, 'first'),
      epic(20, 'second', [21]),
      member(21, 'second'),
    ];
    const { seams, reads } = world(board, {
      pulls: [{ number: 99, headRefName: 'feat/rafa-12-x', body: 'Closes #12' }],
    });

    const { descent, pick, dry } = await pickDescendedLine(roadmap('10', '20'), seams);

    expect(dry).toBe(true);
    expect(pick.line).toBeNull();
    expect(pick.skipped.map((skip) => skip.reason)).toEqual(['closed', 'pull-request']);
    expect(descent.lines.map((line) => line.issue)).toEqual([11, 12]);
    expect(reads).not.toContain(20);
    expect(reads).not.toContain(21);
    if (descent.epic === null) throw new Error('the epic was not walked into');
    expect(dryEpicSentence(descent.epic)).toBe('epic #10 issue 10 has run dry: every line of its checklist and every open'
      + ' member it labels is done or taken, though the epic is not done (1/2); the walk stops here and does not move on'
      + ' to another epic');
  });

  it('control: the same epic with an open untaken spec is not dry', async () => {
    const board = [epic(10, 'first', [11, 12]), member(11, 'first', { state: 'CLOSED' }), member(12, 'first')];
    const { seams } = world(board);

    const { pick, dry } = await pickDescendedLine(roadmap('10', '20'), seams);

    expect(dry).toBe(false);
    expect(pick.line?.issue).toBe(12);
  });

  it('walks into an empty epic, which is never done, and runs dry at once', async () => {
    const { seams } = world([epic(10, 'nobody', []), epic(20, 'second', [21]), member(21, 'second')]);

    const { descent, dry } = await pickDescendedLine(roadmap('10', '20'), seams);

    expect(descent.epic?.number).toBe(10);
    expect(descent.lines).toEqual([]);
    expect(dry).toBe(true);
  });

  it('walks into an epic whose every member was closed as not planned, and runs dry', async () => {
    const board = [epic(10, 'dropped', [11]), member(11, 'dropped', { state: 'CLOSED', stateReason: 'NOT_PLANNED' })];
    const { seams } = world(board);

    const { descent, dry } = await pickDescendedLine(roadmap('10'), seams);

    expect(descent.epic?.progress).toEqual({ done: 0, total: 0, notPlanned: 1 });
    expect(dry).toBe(true);
  });
});

describe('what the descent refuses', () => {
  it('throws naming an epic the listing does not hold', async () => {
    const { seams } = world([epic(10, 'gone', [])]);
    const lonely = { ...seams, listing: async (): Promise<readonly BoardIssue[]> => [] };

    const descent = descendRoadmap(roadmap('10'), lonely);

    await expect(descent).rejects.toThrow('board epic walk: epic #10 is not on the board listing');
  });

  it('throws the listing\'s own error rather than walking the epic as backlog', async () => {
    const { seams } = world([epic(10, 'gone', [])]);
    const failing = {
      ...seams,
      listing: async (): Promise<readonly BoardIssue[]> => {
        throw new Error('board listing: gh issue list failed: offline');
      },
    };

    await expect(descendRoadmap(roadmap('10'), failing)).rejects.toThrow('offline');
  });
});

describe('the readings and sentences', () => {
  it('reads an epic by its type label, as the listing does', () => {
    expect(isEpicIssue({ labels: ['type:epic'] })).toBe(true);
    expect(isEpicIssue({ labels: ['type:spec', 'epic:walk'] })).toBe(false);
    expect(isEpicIssue({ labels: [] })).toBe(false);
  });

  it('reads now only from exactly one horizon label that is now', () => {
    expect(isNowEpic([NOW_HORIZON_LABEL])).toBe(true);
    expect(isNowEpic(['horizon:next'])).toBe(false);
    expect(isNowEpic([])).toBe(false);
    expect(isNowEpic([NOW_HORIZON_LABEL, 'horizon:next'])).toBe(false);
  });

  it('spells the header with the epic\'s progress', async () => {
    const { seams } = world([epic(10, 'walk', [11]), member(11, 'walk')]);

    const descent = await descendRoadmap(roadmap('10'), seams);
    if (descent.epic === null) throw new Error('the epic was not walked into');

    expect(epicHeaderSentence(descent.epic)).toBe('walking into epic #10 issue 10 (0/1 done):'
      + ' its checklist, then its labelled members missing from it');
  });

  it('spells a passed epic line for each reason', () => {
    const line = roadmap('7')[0];
    if (line === undefined) throw new Error('the roadmap read no line');

    expect(epicSkipSentence({ line, reason: 'closed', detail: '' })).toBe('epic #7 done: the epic is closed');
    expect(epicSkipSentence({ line, reason: 'done', detail: '2/2' })).toBe('epic #7 done: every member is closed (2/2)');
  });
});

/** A board row whose checklist names `lines`, a leading `x` ticking one. */
function boardRow(number: number, ...lines: readonly string[]): BoardIssue {
  const body = lines.map((line) => line.startsWith('x')
    ? `- [x] #${line.slice(1)} why`
    : `- [ ] #${line} why`).join('\n');
  return issue(number, { labels: ['type:roadmap'], body });
}

/** `nextNowEpic` over `board` read as board #1, past epic `after`, with the world's readings. */
async function nextAfter(after: number, board: readonly BoardIssue[], options: Parameters<typeof world>[1] = {}) {
  const { seams, reads } = world(board, options);
  const found = await nextNowEpic({ after, board: 1, listing: board, readings: seams.readings });
  return { found, reads };
}

describe('the next now epic', () => {
  /** Epic 10 ran dry; 20 is a good `now` epic before it, 60 one after every pass. */
  const passes = [
    epic(10, 'dry-home', [11]),
    member(11, 'dry-home'),
    epic(20, 'before', [21]),
    member(21, 'before'),
    epic(30, 'ticked', [31]),
    member(31, 'ticked'),
    issue(32, { labels: ['type:spec'] }),
    epic(40, 'closed', [41], { state: 'CLOSED' }),
    member(41, 'closed'),
    epic(42, 'later', [43], { labels: ['type:epic', 'epic:later', 'horizon:next'] }),
    member(43, 'later'),
    epic(44, 'two-horizons', [45], { labels: ['type:epic', 'epic:two-horizons', NOW_HORIZON_LABEL, 'horizon:next'] }),
    member(45, 'two-horizons'),
    epic(46, 'done', [47]),
    member(47, 'done', { state: 'CLOSED' }),
    epic(50, 'dry-too', [51]),
    member(51, 'dry-too'),
    epic(60, 'answer', [61, 62]),
    member(61, 'answer', { state: 'CLOSED' }),
    member(62, 'answer'),
    epic(70, 'after-answer', [71]),
    member(71, 'after-answer'),
  ];
  const options = { branches: ['refs/heads/feat/rafa-11-x', 'refs/heads/feat/rafa-51-y'] };

  it('passes every line that is not an open, now, undone, pickable epic, and answers the first that is', async () => {
    const board = [boardRow(1, '20', '10', 'x30', '32', '40', '42', '44', '46', '50', '60', '70'), ...passes];

    const { found, reads } = await nextAfter(10, board, options);

    expect(found).toEqual({
      number: 60,
      title: 'issue 60',
      slug: 'answer',
      board: 1,
      line: expect.objectContaining({ issue: 60, ticked: false }) as unknown as RoadmapLine,
      progress: { done: 1, total: 2, notPlanned: 0 },
    });
    expect(reads).toEqual([51, 61, 62]);
    expect(reads).not.toContain(71);
  });

  it('control: the same board with the dry epic given a free line answers it instead', async () => {
    const board = [boardRow(1, '20', '10', '50', '60'), ...passes];

    const { found } = await nextAfter(10, board, { branches: [] });

    expect(found?.number).toBe(50);
  });

  it('answers null when no line after the given epic holds one, the good epic before it included', async () => {
    const board = [boardRow(1, '20', '10', 'x30', '40', '46', '50'), ...passes];

    const { found } = await nextAfter(10, board, options);

    expect(found).toBeNull();
  });

  it('control: the same board with the good epic moved after the given one answers it', async () => {
    const board = [boardRow(1, '10', 'x30', '40', '46', '50', '20'), ...passes];

    const { found } = await nextAfter(10, board, options);

    expect(found?.number).toBe(20);
  });

  it('answers null when the given epic is the last line', async () => {
    const { found } = await nextAfter(10, [boardRow(1, '20', '10'), ...passes], options);

    expect(found).toBeNull();
  });

  it('answers null when the board does not list the given epic, rather than its first now epic', async () => {
    const { found, reads } = await nextAfter(10, [boardRow(1, '20', '60'), ...passes], options);

    expect(found).toBeNull();
    expect(reads).toEqual([]);
  });

  it('reads a dry epic taken by an open pull request as dry', async () => {
    const board = [boardRow(1, '10', '50', '60'), ...passes];
    const pulls = [{ number: 99, headRefName: 'feat/rafa-51-y', body: 'Closes #51' }];

    const { found } = await nextAfter(10, board, { pulls, branches: ['refs/heads/feat/rafa-11-x'] });

    expect(found?.number).toBe(60);
  });

  it('reads an empty epic as dry, never done, and passes it', async () => {
    const board = [boardRow(1, '10', '80', '60'), epic(80, 'nobody', []), ...passes];

    const { found } = await nextAfter(10, board, options);

    expect(found?.number).toBe(60);
  });

  it('throws naming a board the listing does not hold', async () => {
    const found = nextAfter(10, passes, options);

    await expect(found).rejects.toThrow('board epic walk: board #1 is not on the board listing');
  });

  it('throws naming an unticked checklist line the listing does not hold, and passes a ticked one unread', async () => {
    const missing = nextAfter(10, [boardRow(1, '10', '99', '60'), ...passes], options);
    const ticked = await nextAfter(10, [boardRow(1, '10', 'x99', '60'), ...passes], options);

    await expect(missing).rejects.toThrow('board epic walk: checklist line #99 is not on the board listing');
    expect(ticked.found?.number).toBe(60);
  });
});
