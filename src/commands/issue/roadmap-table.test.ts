/**
 * Tests for the roadmap table (`src/commands/issue/roadmap-table.ts`):
 * the eight columns in order, the one empty-cell spelling, and the
 * width rule — a too-narrow terminal cutting `title` to its floor before
 * `labels`, an exact fit cutting nothing, and no width cutting nothing.
 *
 * Every row is planted by hand; the `spec` cell is the row module's own
 * {@link readSpecColumn} over a planted body, so the table is read with
 * the spelling it prints and never a copy of it.
 */
import type { RoadmapRow } from '../../board/roadmap-rows.js';

import { describe, expect, it } from 'bun:test';

import { SPEC_READY_LABEL } from '../../board/readiness.js';
import { readSpecColumn } from '../../board/roadmap-rows.js';
import { completeSpecBody } from '../../tests/spec-bodies.js';

import {
  COLUMN_GAP,
  cutCell,
  EMPTY_CELL,
  fitColumnWidths,
  LABELS_FLOOR,
  renderRoadmapTable,
  ROADMAP_COLUMNS,
  roadmapCells,
  TITLE_FLOOR,
} from './roadmap-table.js';

const LONG_TITLE = 'Print the roadmap as one table with what is ready and what blocks it';
const LABELS = ['type:spec', SPEC_READY_LABEL, 'module:board'];

/** A row whose issue is on the board, ready, blocked by one open issue and planned. */
function boardRow(issue: number, title: string, labels: readonly string[] = LABELS): RoadmapRow {
  const body = completeSpecBody(title);
  return {
    line: { issue, ticked: false, why: 'the why', lineNumber: 3 },
    issue: { number: issue, title, body, state: 'OPEN', labels, type: 'spec', module: 'board' },
    spec: readSpecColumn(labels, body),
    blocked: null,
    blockers: [{ reference: '#24', state: 'open' }],
    has: [{ kind: 'plan' }, { kind: 'pr', number: 40 }],
  };
}

/** A row read with no issue on it, as the board being unreachable leaves it. */
function bareRow(issue: number, why: string): RoadmapRow {
  return {
    line: { issue, ticked: false, why, lineNumber: 4 },
    issue: null,
    spec: null,
    blocked: null,
    blockers: [],
    has: [],
  };
}

/** How wide `line` is, in code points, as the renderer counts it. */
function widthOf(line: string): number {
  return [...line].length;
}

/** The widest line `rows` render to with no width given. */
function naturalWidth(rows: readonly RoadmapRow[]): number {
  return Math.max(...renderRoadmapTable(rows).map(widthOf));
}

describe('the columns', () => {
  it('heads the table with the eight columns, in order', () => {
    const [head] = renderRoadmapTable([]);
    expect(ROADMAP_COLUMNS).toEqual(['#', 'state', 'type', 'spec', 'blocked by', 'has', 'labels', 'title']);
    expect(head?.split(/\s{2,}/).map((name) => name.trim())).toEqual([...ROADMAP_COLUMNS]);
  });

  it('prints the header alone when there is no row', () => {
    expect(renderRoadmapTable([])).toHaveLength(1);
  });

  it('fills each cell from the row module\'s spellings', () => {
    expect(roadmapCells(boardRow(123, 'A title'))).toEqual([
      '#123',
      'open',
      'spec',
      'ready',
      '#24 open',
      'plan, pr #40',
      `type:spec, ${SPEC_READY_LABEL}, module:board`,
      'A title',
    ]);
  });

  it('keeps the rows in the order given, one line each', () => {
    const lines = renderRoadmapTable([boardRow(9, 'nine'), boardRow(3, 'three')]);
    expect(lines).toHaveLength(3);
    expect(lines[1]?.trimStart().startsWith('#9')).toBe(true);
    expect(lines[2]?.trimStart().startsWith('#3')).toBe(true);
  });

  it('pads the columns so each starts at one offset on every line', () => {
    const lines = renderRoadmapTable([boardRow(7, 'short'), boardRow(1234, 'longer')]);
    const offsets = lines.map((line) => line.indexOf('open') === -1
      ? line.indexOf('state')
      : line.indexOf('open'));
    expect(new Set(offsets).size).toBe(1);
  });
});

describe('an empty cell', () => {
  it('is spelled - in every column a row with no issue has nothing for', () => {
    expect(roadmapCells(bareRow(5, ''))).toEqual(['#5', ...Array.from({ length: 7 }, () => EMPTY_CELL)]);
  });

  it('takes the Roadmap line\'s why as the title when the row has no issue', () => {
    expect(roadmapCells(bareRow(5, 'read it first')).at(-1)).toBe('read it first');
  });

  it('is spelled - for no blocker, no has mark and no label beside a filled row', () => {
    const row: RoadmapRow = { ...boardRow(8, 'plain', []), blockers: [], has: [] };
    const cells = roadmapCells(row);
    expect([cells[4], cells[5], cells[6]]).toEqual([EMPTY_CELL, EMPTY_CELL, EMPTY_CELL]);
  });
});

describe('the width rule', () => {
  const rows = [boardRow(123, LONG_TITLE), bareRow(45, 'unreachable')];

  it('cuts nothing with no width, whatever the title\'s length', () => {
    const lines = renderRoadmapTable(rows);
    expect(lines[1]?.endsWith(LONG_TITLE)).toBe(true);
    expect(lines.join('\n')).not.toContain('…');
  });

  it('reads a width that is no positive whole number as none', () => {
    const uncut = renderRoadmapTable(rows);
    for (const width of [0, -10, Number.NaN, 12.5]) expect(renderRoadmapTable(rows, width)).toEqual(uncut);
  });

  it('cuts nothing when the table fits the width exactly', () => {
    const exact = naturalWidth(rows);
    const lines = renderRoadmapTable(rows, exact);
    expect(lines).toEqual(renderRoadmapTable(rows));
    expect(Math.max(...lines.map(widthOf))).toBe(exact);
  });

  it('cuts the title by one, ending …, one column short of an exact fit', () => {
    const exact = naturalWidth(rows);
    const lines = renderRoadmapTable(rows, exact - 1);
    expect(Math.max(...lines.map(widthOf))).toBe(exact - 1);
    expect(lines[1]?.endsWith(`${LONG_TITLE.slice(0, -2)}…`)).toBe(true);
  });

  it('cuts the title to its floor before the labels are cut at all', () => {
    const labels = `type:spec, ${SPEC_READY_LABEL}, module:board`;
    const titleSlack = widthOf(LONG_TITLE) - TITLE_FLOOR;
    const atFloor = renderRoadmapTable(rows, naturalWidth(rows) - titleSlack);
    expect(atFloor[1]?.endsWith(`${LONG_TITLE.slice(0, TITLE_FLOOR - 1)}…`)).toBe(true);
    expect(atFloor[1]).toContain(labels);

    const past = renderRoadmapTable(rows, naturalWidth(rows) - titleSlack - 3);
    expect(past[1]?.endsWith(`${LONG_TITLE.slice(0, TITLE_FLOOR - 1)}…`)).toBe(true);
    expect(past[1]).not.toContain(labels);
    expect(past[1]).toContain(`${labels.slice(0, labels.length - 4)}…`);
  });

  it('stops both at their floors on a too-narrow terminal and prints wider than it', () => {
    const lines = renderRoadmapTable(rows, 40);
    const row = lines[1] ?? '';
    const cells = row.split(COLUMN_GAP).filter((text) => text !== '');
    expect(widthOf(cells.at(-1) ?? '')).toBe(TITLE_FLOOR);
    expect(widthOf(cells.at(-2)?.trimEnd() ?? '')).toBe(LABELS_FLOOR);
    expect(widthOf(row)).toBeGreaterThan(40);
    expect(row).toContain('#24 open');
    expect(row).toContain('plan, pr #40');
  });
});

describe('fitColumnWidths', () => {
  const natural = [4, 5, 4, 5, 10, 12, 30, 60];
  const total = natural.reduce((sum, width) => sum + width, 0) + COLUMN_GAP.length * 7;

  it('leaves a title already under its floor and cuts the labels', () => {
    const short = [...natural.slice(0, 7), 10];
    const shortTotal = total - 50;
    expect(fitColumnWidths(short, shortTotal - 5)).toEqual([...natural.slice(0, 6), 25, 10]);
  });

  it('never cuts the six reading and key columns', () => {
    expect(fitColumnWidths(natural, 1).slice(0, 6)).toEqual(natural.slice(0, 6));
  });
});

describe('cutCell', () => {
  it('keeps text that fits and cuts text that does not to the width, ending …', () => {
    expect(cutCell('fits', 4)).toBe('fits');
    expect(cutCell('too long', 4)).toBe('too…');
    expect(widthOf(cutCell('too long', 4))).toBe(4);
  });
});
