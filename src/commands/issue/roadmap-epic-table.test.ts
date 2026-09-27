/**
 * Tests for the epic table (`src/commands/issue/roadmap-epic-table.ts`):
 * the spec's sample row, the six columns in order, the horizon headings,
 * the disagreement line under its row, the `Specs` group, the failed
 * listing's `unknown` line, the hidden-horizon line, and a reading with
 * no epic line printing today's table unchanged.
 *
 * Every epic is computed by the model's own `readEpics` over a planted
 * listing, so the cells are read with the states and progress the model
 * answers and never a copy of them.
 */
import type { Epic } from '../../board/epics.js';
import type { BoardIssue } from '../../board/roadmap-board.js';
import type { EpicHorizonGroup, EpicRow, Horizon, RoadmapEpicRows } from '../../board/roadmap-epic-rows.js';
import type { RoadmapRow } from '../../board/roadmap-rows.js';

import { describe, expect, it } from 'bun:test';

import { readEpics } from '../../board/epics.js';

import {
  EPIC_COLUMNS,
  epicCells,
  hiddenLine,
  renderEpicTable,
  SPECS_HEADING,
  unknownLine,
} from './roadmap-epic-table.js';
import { renderRoadmapTable, TITLE_FLOOR } from './roadmap-table.js';

const ROADMAP = 31;
const TODAY = new Date(2026, 8, 27);

/** The spec's sample, as `.rafa/specs/rafa-244-epics-group-issues-features.md` draws it. */
const SAMPLE = [
  'Roadmap #31 · now',
  '   #  state        done/total  blocked  title                  date',
  '#252  in-progress  3/7         -        Epics and boards       -',
];

/** One issue on the planted listing. */
function issue(number: number, fields: Partial<BoardIssue> = {}): BoardIssue {
  return {
    number,
    title: `Issue ${String(number)}`,
    body: '',
    state: 'OPEN',
    stateReason: null,
    labels: [],
    type: 'code',
    module: 'unassigned',
    ...fields,
  };
}

/** An epic issue `slug` with `body`, open unless `state` says otherwise. */
function epicIssue(number: number, slug: string, title: string, fields: Partial<BoardIssue> = {}): BoardIssue {
  return issue(number, { title, labels: ['type:epic', `epic:${slug}`, 'horizon:now'], type: 'epic', ...fields });
}

/** `count` members of `slug` from `first`, the first `closed` of them closed. */
function members(first: number, slug: string, count: number, closed: number): BoardIssue[] {
  return Array.from({ length: count }, (_, index) => issue(first + index, {
    labels: [`epic:${slug}`],
    ...(index < closed
      ? { state: 'CLOSED', stateReason: 'COMPLETED' }
      : {}),
  }));
}

/** The epics `issues` read to, by number. */
function epicsOf(issues: readonly BoardIssue[]): ReadonlyMap<number, Epic> {
  const read = readEpics({ issues, claims: new Set(), today: TODAY });
  return new Map(read.epics.map((epic) => [epic.number, epic]));
}

/** The epic numbered `number` in `epics`; fails the case when absent. */
function epicAt(epics: ReadonlyMap<number, Epic>, number: number): Epic {
  const epic = epics.get(number);
  if (epic === undefined) throw new Error(`no epic #${String(number)}`);
  return epic;
}

/** An epic row for `epic` under `horizon`, its roadmap line reading `why`. */
function epicRow(epic: Epic, horizon: Horizon = 'now', why = 'the why'): EpicRow {
  return { line: { issue: epic.number, ticked: false, why, lineNumber: 3 }, epic, horizon };
}

/** A spec row with no issue on it, as the board being unreachable leaves it. */
function specRow(number: number, why: string): RoadmapRow {
  return {
    line: { issue: number, ticked: false, why, lineNumber: 5 },
    issue: null,
    spec: null,
    blocked: null,
    blockers: [],
    has: [],
    refs: null,
  };
}

/** A reading over `groups` and `specs`, with the rest laid over it. */
function reading(
  groups: readonly EpicHorizonGroup[],
  specs: readonly RoadmapRow[] = [],
  fields: Partial<RoadmapEpicRows> = {},
): RoadmapEpicRows {
  return {
    roadmap: ROADMAP,
    groups,
    hidden: 0,
    specs,
    epics: { epics: [], unknown: null },
    unknown: null,
    problems: [],
    warnings: [],
    ...fields,
  };
}

/** The sample's epic: #252, seven members, three of them closed. */
const SAMPLE_EPICS = epicsOf([epicIssue(252, 'epics', 'Epics and boards'), ...members(300, 'epics', 7, 3)]);
const SAMPLE_EPIC = epicAt(SAMPLE_EPICS, 252);

describe('the spec sample', () => {
  it('computes the sample epic as the sample reads it', () => {
    expect(SAMPLE_EPIC.state).toBe('in-progress');
    expect(SAMPLE_EPIC.progress).toMatchObject({ done: 3, total: 7 });
  });

  it('prints the heading and header, and the row byte for byte up to its title', () => {
    const lines = renderEpicTable(reading([{ horizon: 'now', rows: [epicRow(SAMPLE_EPIC)] }]));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(SAMPLE[0] ?? '');
    const titleAt = (SAMPLE[1] ?? '').indexOf('title');
    expect(lines[1]?.slice(0, titleAt)).toBe(SAMPLE[1]?.slice(0, titleAt));
    expect(lines[2]?.slice(0, titleAt)).toBe(SAMPLE[2]?.slice(0, titleAt));
  });

  it('prints the sample title and date cells, the title padded to its widest cell', () => {
    // Control: the sample pads title to 21 columns; the renderer pads to the widest cell, 16.
    const lines = renderEpicTable(reading([{ horizon: 'now', rows: [epicRow(SAMPLE_EPIC)] }]));
    expect(lines[1]?.endsWith('title             date')).toBe(true);
    expect(lines[2]?.endsWith('Epics and boards  -')).toBe(true);
    expect(lines[2]).not.toBe(SAMPLE[2]);
  });
});

describe('the columns', () => {
  it('heads each group with the six columns, in order', () => {
    const [, head] = renderEpicTable(reading([{ horizon: 'now', rows: [epicRow(SAMPLE_EPIC)] }]));
    expect(EPIC_COLUMNS).toEqual(['#', 'state', 'done/total', 'blocked', 'title', 'date']);
    expect(head?.trim().split(/\s{2,}/)).toEqual([...EPIC_COLUMNS]);
  });

  it('spells blockers, the date and lateness, and not-planned members on neither side', () => {
    const epics = epicsOf([
      epicIssue(10, 'a', 'Alpha', { body: 'Date: 2026-01-02\n' }),
      issue(11, { labels: ['epic:a'], body: 'Blocked by: #21' }),
      issue(12, { labels: ['epic:a'], state: 'CLOSED', stateReason: 'NOT_PLANNED' }),
      epicIssue(20, 'b', 'Beta'),
      issue(21, { labels: ['epic:b'] }),
    ]);
    const alpha = epicAt(epics, 10);
    expect(alpha.late).toBe(true);
    expect(epicCells(epicRow(alpha))).toEqual(['#10', 'backlog', '0/1', '#20', 'Alpha', '2026-01-02 late']);
  });

  it('prints an empty epic as empty with 0/0, never done', () => {
    const empty = epicAt(epicsOf([epicIssue(40, 'none', 'Nothing yet')]), 40);
    expect(epicCells(epicRow(empty))).toEqual(['#40', 'empty', '0/0', '-', 'Nothing yet', '-']);
  });

  it('falls back to the roadmap line for an epic with no title', () => {
    const untitled = { ...SAMPLE_EPIC, title: '' };
    expect(epicCells(epicRow(untitled, 'now', 'the line'))[4]).toBe('the line');
  });

  it('cuts the title to fit a terminal, never below its floor', () => {
    const long = { ...SAMPLE_EPIC, title: 'A title long enough to push the table past forty columns wide' };
    const lines = renderEpicTable(reading([{ horizon: 'now', rows: [epicRow(long)] }]), 70);
    expect(lines[2]).toContain('…');
    expect([...(lines[1] ?? '')].length).toBe(70);
    expect(renderEpicTable(reading([{ horizon: 'now', rows: [epicRow(long)] }]))[2]).toContain(long.title);
    const floored = renderEpicTable(reading([{ horizon: 'now', rows: [epicRow(long)] }]), 30)[2] ?? '';
    expect(floored.slice(floored.indexOf('A title')).split('  ')[0]).toHaveLength(TITLE_FLOOR);
  });
});

describe('the disagreement line', () => {
  it('prints the line under its row, indented to the state column', () => {
    const epics = epicsOf([epicIssue(252, 'epics', 'Epics and boards'), ...members(300, 'epics', 2, 2)]);
    const done = epicAt(epics, 252);
    expect(done.disagreement).toBe('done, but epic #252 is still open');
    const lines = renderEpicTable(reading([{ horizon: 'now', rows: [epicRow(done)] }]));
    expect(lines[3]).toBe('      done, but epic #252 is still open');
    expect(lines[3]?.indexOf('done')).toBe(lines[1]?.indexOf('state'));
  });

  it('prints no line for an epic that agrees', () => {
    expect(SAMPLE_EPIC.disagreement).toBeNull();
    expect(renderEpicTable(reading([{ horizon: 'now', rows: [epicRow(SAMPLE_EPIC)] }]))).toHaveLength(3);
  });
});

describe('the groups', () => {
  it('prints each horizon under its own heading, a blank line between', () => {
    const next = { ...SAMPLE_EPIC, number: 260, title: 'Later work' };
    const lines = renderEpicTable(reading([
      { horizon: 'now', rows: [epicRow(SAMPLE_EPIC)] },
      { horizon: 'next', rows: [epicRow(next, 'next')] },
    ]));
    expect(lines.filter((line) => line.startsWith('Roadmap #'))).toEqual(['Roadmap #31 · now', 'Roadmap #31 · next']);
    expect(lines[3]).toBe('');
  });

  it('prints the spec rows as today\'s table under the Specs heading', () => {
    const specs = [specRow(50, 'a spec')];
    const lines = renderEpicTable(reading([{ horizon: 'now', rows: [epicRow(SAMPLE_EPIC)] }], specs));
    expect(lines.slice(3)).toEqual(['', SPECS_HEADING, ...renderRoadmapTable(specs)]);
  });

  it('prints the hidden line when every epic sits under a horizon not shown', () => {
    const lines = renderEpicTable(reading([], [specRow(50, 'a spec')], { hidden: 2 }));
    expect(lines[0]).toBe(hiddenLine(ROADMAP, 2));
    expect(hiddenLine(ROADMAP, 1)).toContain('1 epic not in now');
    expect(lines[2]).toBe(SPECS_HEADING);
  });

  it('prints unknown with the reason when the listing failed, the lines kept as specs', () => {
    const specs = [specRow(252, 'epics')];
    const lines = renderEpicTable(reading([], specs, { unknown: 'gh: HTTP 502' }));
    expect(lines[0]).toBe(unknownLine(ROADMAP, 'gh: HTTP 502'));
    expect(lines[0]).toBe('Roadmap #31 · epics unknown: gh: HTTP 502');
    expect(lines.slice(1)).toEqual(['', SPECS_HEADING, ...renderRoadmapTable(specs)]);
  });
});

describe('no epic line', () => {
  it('prints today\'s table alone, byte for byte', () => {
    const specs = [specRow(50, 'a spec'), specRow(51, 'another')];
    const lines = renderEpicTable(reading([], specs));
    expect(lines).toEqual(renderRoadmapTable(specs));
    expect(lines).not.toContain(SPECS_HEADING);
  });

  it('passes the terminal width through to today\'s table', () => {
    const specs = [specRow(50, 'a why long enough that a narrow terminal has to cut it down')];
    expect(renderEpicTable(reading([], specs), 60)).toEqual(renderRoadmapTable(specs, 60));
    expect(renderEpicTable(reading([], specs), 60)).not.toEqual(renderRoadmapTable(specs));
  });
});
