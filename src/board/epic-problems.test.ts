/**
 * Tests for the epic problem reader (`src/board/epic-problems.ts`): two
 * `epic:` labels on one issue, an `epic:` label no epic owns, an epic
 * without exactly one `horizon:` label, a checklist spec missing the
 * label and a labelled spec missing from the checklist, with the order
 * and sentences a report prints.
 *
 * Every case is a pure call over a literal listing built by {@link issue},
 * which reads each row's type with the tracker's own `typeOfLabels`, as
 * `parseBoardListing` does; the module spawns nothing and opens nothing.
 *
 * ## The controls
 *
 * Each problem is read beside a board that must NOT raise it, so a
 * reader answering the problem for every issue, or for none, fails one
 * of the two: the {@link CLEAN} board answers no problem at all, and each
 * describe block turns exactly one of its issues faulty.
 */
import type { EpicProblem } from './epic-problems.js';
import type { BoardIssue } from './roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';

import { EPIC_PROBLEM_KINDS, epicProblemMessage, readEpicProblems, readHorizonProblems } from './epic-problems.js';

/** The fields a case may set on an issue. */
interface IssueFields {
  readonly labels?: readonly string[];
  readonly state?: 'OPEN' | 'CLOSED';
  readonly body?: string;
}

/** One listing row, its type read from its labels. */
function issue(number: number, fields: IssueFields = {}): BoardIssue {
  const labels = fields.labels ?? [];
  return {
    number,
    title: `issue ${String(number)}`,
    body: fields.body ?? '',
    state: fields.state ?? 'OPEN',
    stateReason: null,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
  };
}

/** An epic for `slug` whose checklist names `specs`, carrying `horizons`. */
function epic(number: number, slug: string, specs: readonly number[], horizons: readonly string[] = ['horizon:now']): BoardIssue {
  const body = ['## Acceptance criteria', '', '- it works', '', ...specs.map((spec) => `- [ ] #${String(spec)}`)].join('\n');
  return issue(number, { labels: ['type:epic', `epic:${slug}`, ...horizons], body });
}

/** A spec carrying `epic:<slug>` and any `labels` more. */
function member(number: number, slug: string, labels: readonly string[] = []): BoardIssue {
  return issue(number, { labels: [`epic:${slug}`, ...labels] });
}

/** A board with two epics, every spec labelled and listed, one bug member unlisted. */
const CLEAN: readonly BoardIssue[] = [
  epic(10, 'board', [11, 12]),
  member(11, 'board'),
  member(12, 'board', ['type:spike']),
  member(13, 'board', ['type:bug']),
  epic(20, 'views', [21], ['horizon:later']),
  member(21, 'views'),
  issue(30),
];

/** The problems `issues` answers, with each one's kind, issue and slug only. */
function brief(issues: readonly BoardIssue[]): readonly string[] {
  return readEpicProblems(issues).map((found) => `${found.kind} #${String(found.issue)} ${found.slug ?? '-'}`);
}

describe('readEpicProblems on a clean board (control)', () => {
  it('answers no problem, a bug member off the checklist included', () => {
    expect(readEpicProblems(CLEAN)).toEqual([]);
  });

  it('answers no problem for an empty listing', () => {
    expect(readEpicProblems([])).toEqual([]);
  });
});

describe('two epic: labels', () => {
  it('names the issue, its first slug and every slug it carries', () => {
    const found = readEpicProblems([...CLEAN.filter((row) => row.number !== 11), member(11, 'board', ['epic:views'])]);

    expect(found).toEqual([
      { kind: 'several-epic-labels', issue: 11, slug: 'board', slugs: ['board', 'views'] },
      { kind: 'unlisted-member', issue: 11, slug: 'views', epic: 20 },
    ]);
  });

  it('names an epic carrying two epic: labels too', () => {
    const doubled = issue(10, { labels: ['type:epic', 'epic:board', 'epic:tables', 'horizon:now'], body: '- [ ] #11\n- [ ] #12' });

    expect(brief([doubled, ...CLEAN.slice(1)])).toEqual(['several-epic-labels #10 board']);
  });

  it('reads one label repeated on an issue as one', () => {
    expect(readEpicProblems([...CLEAN.filter((row) => row.number !== 11), member(11, 'board', ['epic:board'])])).toEqual([]);
  });
});

describe('an epic: label no type:epic issue carries', () => {
  it('names every issue carrying a mistyped slug', () => {
    const found = brief([...CLEAN, member(31, 'baord'), member(32, 'baord', ['type:bug'])]);

    expect(found).toEqual(['orphan-label #31 baord', 'orphan-label #32 baord']);
  });

  it('reads a slug owned only as an epic\'s second label as owned by none', () => {
    const doubled = issue(10, { labels: ['type:epic', 'epic:board', 'epic:tables', 'horizon:now'], body: '- [ ] #11\n- [ ] #12' });

    expect(brief([doubled, ...CLEAN.slice(1), member(31, 'tables')])).toEqual([
      'several-epic-labels #10 board',
      'orphan-label #31 tables',
    ]);
  });

  it('matches the prefix as written, so Epic:board is no epic label', () => {
    expect(readEpicProblems([...CLEAN, issue(31, { labels: ['Epic:board'] })])).toEqual([]);
  });
});

describe('an epic without exactly one horizon: label', () => {
  it('names an epic carrying none, with no horizons', () => {
    const found = readEpicProblems([...CLEAN.filter((row) => row.number !== 20), epic(20, 'views', [21], [])]);

    expect(found).toEqual([{ kind: 'horizon', issue: 20, slug: 'views', horizons: [] }]);
  });

  it('names an epic carrying two, with both', () => {
    const found = readEpicProblems([
      ...CLEAN.filter((row) => row.number !== 20),
      epic(20, 'views', [21], ['horizon:now', 'horizon:later']),
    ]);

    expect(found).toEqual([{ kind: 'horizon', issue: 20, slug: 'views', horizons: ['horizon:now', 'horizon:later'] }]);
  });

  it('names an epic with no epic: label with a null slug, and reads no checklist for it', () => {
    const bare = issue(40, { labels: ['type:epic'], body: '- [ ] #30' });

    expect(readEpicProblems([...CLEAN, bare])).toEqual([{ kind: 'horizon', issue: 40, slug: null, horizons: [] }]);
  });

  it('never reads a horizon on an issue that is not an epic', () => {
    expect(readEpicProblems([...CLEAN, issue(31, { labels: ['horizon:now', 'horizon:next'] })])).toEqual([]);
  });
});

describe('a checklist spec missing the label', () => {
  it('names the spec, the slug, the epic and the line', () => {
    const found = readEpicProblems([...CLEAN.filter((row) => row.number !== 10), epic(10, 'board', [11, 12, 30])]);

    expect(found).toEqual([{ kind: 'unlabelled-checklist', issue: 30, slug: 'board', epic: 10, lineNumber: 7 }]);
  });

  it('names a spec carrying another epic\'s label, once however often it is listed', () => {
    const found = brief([...CLEAN.filter((row) => row.number !== 10), epic(10, 'board', [11, 12, 21, 21])]);

    expect(found).toEqual(['unlabelled-checklist #21 board']);
  });

  it('leaves out a line pointing at an issue off the listing, or at an epic', () => {
    expect(readEpicProblems([...CLEAN.filter((row) => row.number !== 10), epic(10, 'board', [11, 12, 99, 20])])).toEqual([]);
  });

  it('skips a fenced example checklist', () => {
    const fenced = issue(10, { labels: ['type:epic', 'epic:board', 'horizon:now'], body: '- [ ] #11\n- [ ] #12\n```markdown\n- [ ] #30\n```' });

    expect(readEpicProblems([fenced, ...CLEAN.slice(1)])).toEqual([]);
  });
});

describe('a labelled spec missing from the checklist', () => {
  it('names the spec, the slug and the epic, open or closed', () => {
    const found = readEpicProblems([
      ...CLEAN,
      member(14, 'board'),
      issue(15, { labels: ['epic:board'], state: 'CLOSED' }),
    ]);

    expect(found).toEqual([
      { kind: 'unlisted-member', issue: 14, slug: 'board', epic: 10 },
      { kind: 'unlisted-member', issue: 15, slug: 'board', epic: 10 },
    ]);
  });

  it('names every member of an epic whose checklist is empty, bugs left out', () => {
    expect(brief([...CLEAN.filter((row) => row.number !== 10), epic(10, 'board', [])])).toEqual([
      'unlisted-member #11 board',
      'unlisted-member #12 board',
    ]);
  });
});

describe('the order', () => {
  it('answers kinds in their listed order, then by issue number', () => {
    const found = readEpicProblems([
      epic(20, 'views', [21, 30], []),
      member(21, 'views'),
      member(22, 'views'),
      issue(30),
      member(31, 'baord', ['epic:views']),
      member(5, 'baord'),
    ]);

    expect(found.map((problem) => `${problem.kind} #${String(problem.issue)}`)).toEqual([
      'several-epic-labels #31',
      'orphan-label #5',
      'orphan-label #31',
      'horizon #20',
      'unlabelled-checklist #30',
      'unlisted-member #22',
      'unlisted-member #31',
    ]);
    expect([...new Set(found.map((problem) => problem.kind))]).toEqual([...EPIC_PROBLEM_KINDS]);
  });
});

describe('epicProblemMessage', () => {
  const cases: readonly (readonly [EpicProblem, string])[] = [
    [
      { kind: 'several-epic-labels', issue: 11, slug: 'board', slugs: ['board', 'views'] },
      '#11 carries 2 epic labels (epic:board, epic:views); an issue belongs to one epic, so remove all but one',
    ],
    [
      { kind: 'orphan-label', issue: 31, slug: 'baord' },
      '#31 carries epic:baord, which no type:epic issue carries; fix the slug or open the epic',
    ],
    [
      { kind: 'horizon', issue: 20, slug: 'views', horizons: [] },
      'epic #20 carries no horizon: label; add one of horizon:now, horizon:next or horizon:later',
    ],
    [
      { kind: 'horizon', issue: 20, slug: 'views', horizons: ['horizon:now', 'horizon:later'] },
      'epic #20 carries 2 horizon labels (horizon:now, horizon:later); keep one',
    ],
    [
      { kind: 'unlabelled-checklist', issue: 30, slug: 'board', epic: 10, lineNumber: 7 },
      '#30 is on epic #10\'s checklist on line 7 but does not carry epic:board; label it or take it off the checklist',
    ],
    [
      { kind: 'unlisted-member', issue: 14, slug: 'board', epic: 10 },
      '#14 carries epic:board but is not on epic #10\'s checklist; it is walked last, by issue number, until it is added',
    ],
  ];

  for (const [problem, sentence] of cases) {
    it(`spells ${problem.kind} for #${String(problem.issue)}`, () => {
      expect(epicProblemMessage(problem)).toBe(sentence);
    });
  }
});

describe('readHorizonProblems, the native mode\'s reading', () => {
  /** Every label fault at once: two epic labels, an orphan, an unlabelled checklist line, and two horizon faults. */
  const FAULTY: readonly BoardIssue[] = [
    epic(20, 'views', [21], []),
    member(21, 'views', ['epic:board']),
    epic(10, 'board', [30], ['horizon:now', 'horizon:later']),
    member(14, 'orphan'),
    issue(30),
  ];

  it('answers the horizon problems alone, in ascending epic number, each with a null slug', () => {
    expect(readHorizonProblems(FAULTY)).toEqual([
      { kind: 'horizon', issue: 10, slug: null, horizons: ['horizon:now', 'horizon:later'] },
      { kind: 'horizon', issue: 20, slug: null, horizons: [] },
    ]);
  });

  it('is the labels reading\'s horizon kind with the slug dropped, which also reads the rest (control)', () => {
    const labels = readEpicProblems(FAULTY);
    expect(new Set(labels.map((found) => found.kind)).size).toBeGreaterThan(1);
    expect(labels.filter((found) => found.kind === 'horizon').map((found) => ({ ...found, slug: null })))
      .toEqual([...readHorizonProblems(FAULTY)]);
  });

  it('answers no problem on the clean board', () => {
    expect(readHorizonProblems(CLEAN)).toEqual([]);
  });
});
