/**
 * Tests for the roadmap table (`src/commands/issue/roadmap-table.ts`):
 * the eight columns in order, the symbols and their words under
 * `--texts`, the labels row under `--labels`, the legend, the one
 * empty-cell spelling, and the width rule counted in terminal cells — a
 * too-narrow terminal cutting `title` to its floor, an exact fit cutting
 * nothing, and no width cutting nothing.
 *
 * Every row is planted by hand; the `spec` reading is the row module's
 * own {@link readSpecColumn} over a planted body, and the `refs` cell the
 * row module's refsText over a planted count, so the table is read with
 * the spelling it prints and never a copy of it.
 */
import type { TableStyle } from './roadmap-table.js';
import type { RoadmapRow } from '../../board/roadmap-rows.js';

import { describe, expect, it } from 'bun:test';

import { SPEC_READY_LABEL } from '../../board/readiness.js';
import { readSpecColumn } from '../../board/roadmap-rows.js';
import { completeSpecBody } from '../../tests/spec-bodies.js';

import {
  BLOCKER_SYMBOLS,
  blockersCell,
  COLUMN_GAP,
  cutCell,
  DEFAULT_STYLE,
  EMPTY_CELL,
  fitColumnWidths,
  LABELS_LEAD,
  legendLines,
  renderRoadmapTable,
  ROADMAP_COLUMNS,
  roadmapCells,
  SPEC_SYMBOLS,
  specWords,
  SYMBOL_GAP,
  TITLE_FLOOR,
  widthOf,
} from './roadmap-table.js';

const LONG_TITLE = 'Print the roadmap as one table with what is ready and what blocks it';
const LABELS = ['type:spec', SPEC_READY_LABEL, 'module:board'];

/** Words instead of symbols, and no label rows. */
const TEXTS: TableStyle = { labels: false, texts: true };

/** Symbols, with a labels row under each issue. */
const LABELLED: TableStyle = { labels: true, texts: false };

/** A row whose issue is on the board, ready, blocked by one open issue and planned. */
function boardRow(issue: number, title: string, labels: readonly string[] = LABELS): RoadmapRow {
  const body = completeSpecBody(title);
  return {
    line: { issue, ticked: false, why: 'the why', lineNumber: 3 },
    issue: { number: issue, title, body, state: 'OPEN', stateReason: null, labels, type: 'code', module: 'board' },
    spec: readSpecColumn(labels, body),
    blocked: null,
    blockers: [{ reference: '#24', state: 'open' }],
    has: [{ kind: 'plan' }, { kind: 'pr', number: 40 }],
    refs: { copies: 1, suspect: 1, dangling: 1, unknown: 3, errors: [] },
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
    refs: null,
  };
}

/** The widest line `rows` render to with no width given, in terminal cells. */
function naturalWidth(rows: readonly RoadmapRow[], style: TableStyle = TEXTS): number {
  return Math.max(...renderRoadmapTable(rows, undefined, style).map(widthOf));
}

/** Where `text` starts on `line`, in terminal cells. */
function cellOffset(line: string, text: string): number {
  return widthOf(line.slice(0, line.indexOf(text)));
}

describe('the columns', () => {
  it('heads the table with the eight columns, in order, labels among none of them', () => {
    const [head] = renderRoadmapTable([]);
    expect(ROADMAP_COLUMNS).toEqual(['#', 'state', 'type', 'spec', 'blocked by', 'has', 'refs', 'title']);
    expect(head?.split(/\s{2,}/).map((name) => name.trim())).toEqual([...ROADMAP_COLUMNS]);
  });

  it('prints the header alone when there is no row', () => {
    expect(renderRoadmapTable([])).toHaveLength(1);
  });

  it('fills each cell with its symbol by default', () => {
    expect(roadmapCells(boardRow(123, 'A title'))).toEqual([
      '#123',
      'open',
      'code',
      SPEC_SYMBOLS.ready,
      `${BLOCKER_SYMBOLS.open} #24`,
      'plan, pr #40',
      '2',
      'A title',
    ]);
  });

  it('fills the spec and blocked by cells in words under --texts', () => {
    const cells = roadmapCells(boardRow(123, 'A title'), TEXTS);
    expect([cells[3], cells[4]]).toEqual(['ready to plan', 'open #24']);
  });

  it('keeps the rows in the order given, one line each, then the legend', () => {
    const lines = renderRoadmapTable([boardRow(9, 'nine'), boardRow(3, 'three')]);
    expect(lines).toHaveLength(5);
    expect(lines[1]?.trimStart().startsWith('#9')).toBe(true);
    expect(lines[2]?.trimStart().startsWith('#3')).toBe(true);
    expect(lines.slice(3)).toEqual(legendLines([boardRow(9, 'nine')], DEFAULT_STYLE));
  });

  it('starts each column at one offset on every line, counted in terminal cells, symbols included', () => {
    const outline: RoadmapRow = { ...boardRow(1234, 'longer'), spec: readSpecColumn([], '## What you get\n\nonly this') };
    const lines = renderRoadmapTable([boardRow(7, 'short'), outline]).slice(1, 3);
    expect(new Set(lines.map((line) => cellOffset(line, 'open'))).size).toBe(1);
    expect(new Set(lines.map((line) => cellOffset(line, 'plan'))).size).toBe(1);
  });
});

describe('the blocked by cell', () => {
  const blockers = [
    { reference: '#26', state: 'closed' as const },
    { reference: '#24', state: 'open' as const },
    { reference: 'owner/repo#1', state: 'unknown' as const },
    { reference: '#25', state: 'open' as const },
  ];

  it('groups the blockers by state, what still blocks first, each group led by its symbol', () => {
    expect(blockersCell(blockers, DEFAULT_STYLE)).toBe('🔴 #24 #25 ❔ owner/repo#1 🟢 #26');
  });

  it('leads each group with its state in words under --texts', () => {
    expect(blockersCell(blockers, TEXTS)).toBe('open #24 #25 · unknown owner/repo#1 · closed #26');
  });

  it('is empty with no blocker', () => {
    expect(blockersCell([], DEFAULT_STYLE)).toBe('');
  });
});

describe('the labels row', () => {
  it('prints no label anywhere without --labels', () => {
    expect(renderRoadmapTable([boardRow(9, 'nine')]).join('\n')).not.toContain('module:board');
  });

  it('follows each issue with its labels, led by └→ and starting under the state column', () => {
    const lines = renderRoadmapTable([boardRow(9, 'nine'), boardRow(3, 'three', [])], undefined, LABELLED);
    expect(lines[2]).toBe(`${' '.repeat(cellOffset(lines[1] ?? '', 'open'))}${LABELS_LEAD}type:spec, ${SPEC_READY_LABEL}, module:board`);
    expect(lines[4]?.trim()).toBe(`${LABELS_LEAD}${EMPTY_CELL}`);
  });

  it('is cut to the terminal\'s width, ending …', () => {
    const lines = renderRoadmapTable([boardRow(9, 'nine')], 30, LABELLED);
    expect(widthOf(lines[2] ?? '')).toBeLessThanOrEqual(30);
    expect(lines[2]?.endsWith('…')).toBe(true);
  });
});

describe('the legend', () => {
  it('names each symbol the table printed, and only those, one line per column headed by its name', () => {
    expect(legendLines([boardRow(9, 'nine')], DEFAULT_STYLE)).toEqual([
      `spec:        ${SPEC_SYMBOLS.ready} ready to plan`,
      `blocked by:  ${BLOCKER_SYMBOLS.open} still open`,
    ]);
  });

  it('prints no line for a column that printed no symbol', () => {
    const unblocked: RoadmapRow = { ...boardRow(9, 'nine'), blockers: [] };
    expect(legendLines([unblocked], DEFAULT_STYLE)).toEqual([`spec:        ${SPEC_SYMBOLS.ready} ready to plan`]);
  });

  it('is left out under --texts and when no symbol was printed', () => {
    expect(legendLines([boardRow(9, 'nine')], TEXTS)).toEqual([]);
    expect(legendLines([bareRow(5, 'unread')], DEFAULT_STYLE)).toEqual([]);
    expect(renderRoadmapTable([boardRow(9, 'nine')], undefined, TEXTS)).toHaveLength(2);
  });
});

describe('the spec cell in words', () => {
  it('says what each reading means with no rafa term in it, naming the missing sections', () => {
    const complete = completeSpecBody('Complete');
    const missing = complete.replace(/## Design[\s\S]*?(?=## )/u, '');
    expect(specWords(readSpecColumn([SPEC_READY_LABEL], complete))).toBe('ready to plan');
    expect(specWords(readSpecColumn([], complete))).toBe('all sections filled, not marked ready');
    expect(specWords(readSpecColumn([], missing))).toBe('sections missing: Design');
    expect(specWords(readSpecColumn([SPEC_READY_LABEL], missing))).toBe('marked ready, sections missing: Design');
    expect(specWords(readSpecColumn([], '## What you get\n\nonly this'))).toBe('outline only');
  });
});

describe('the gap after a symbol', () => {
  const blockers = [
    { reference: '#24', state: 'open' as const },
    { reference: '#26', state: 'closed' as const },
    { reference: 'owner/repo#1', state: 'unknown' as const },
  ];
  const every = [
    ...Object.values(SPEC_SYMBOLS),
    ...Object.values(BLOCKER_SYMBOLS),
  ];

  /** Each symbol in `text` with what follows it up to the next word. */
  function gapsIn(text: string): readonly string[] {
    return every.flatMap((symbol) => text
      .split(symbol)
      .slice(1)
      .map((after) => /^\s*/u.exec(after)?.[0] ?? ''));
  }

  it('is one space between each symbol and the issue numbers it leads in blocked by', () => {
    const cell = blockersCell(blockers, DEFAULT_STYLE);
    expect(gapsIn(cell)).toEqual([SYMBOL_GAP, SYMBOL_GAP, SYMBOL_GAP]);
    expect(SYMBOL_GAP).toBe(' ');
  });

  it('is one space between each symbol and its meaning in the legend', () => {
    const rows = [boardRow(9, 'nine'), { ...boardRow(3, 'three'), blockers }];
    const legend = legendLines(rows, DEFAULT_STYLE).join('\n');
    expect(gapsIn(legend).length).toBeGreaterThan(0);
    expect(new Set(gapsIn(legend))).toEqual(new Set([SYMBOL_GAP]));
  });
});

describe('an empty cell', () => {
  it('is spelled - in every column a row with no issue has nothing for', () => {
    expect(roadmapCells(bareRow(5, ''))).toEqual(['#5', ...Array.from({ length: 7 }, () => EMPTY_CELL)]);
  });

  it('takes the Roadmap line\'s why as the title when the row has no issue', () => {
    expect(roadmapCells(bareRow(5, 'read it first')).at(-1)).toBe('read it first');
  });

  it('is spelled - for no blocker, no has mark and no saved copy beside a filled row', () => {
    const row: RoadmapRow = { ...boardRow(8, 'plain', []), blockers: [], has: [], refs: null };
    const cells = roadmapCells(row);
    expect([cells[4], cells[5], cells[6]]).toEqual([EMPTY_CELL, EMPTY_CELL, EMPTY_CELL]);
  });

  it('prints 0 in refs for a clean saved copy, not -, and ? for one that could not be read', () => {
    const clean: RoadmapRow = { ...boardRow(8, 'clean'), refs: { copies: 1, suspect: 0, dangling: 0, unknown: 0, errors: [] } };
    const unread: RoadmapRow = { ...boardRow(9, 'unread'), refs: { copies: 1, suspect: 0, dangling: 0, unknown: 0, errors: ['no'] } };
    expect(roadmapCells(clean)[6]).toBe('0');
    expect(roadmapCells(unread)[6]).toBe('?');
  });
});

describe('the width rule', () => {
  const rows = [boardRow(123, LONG_TITLE), bareRow(45, 'unreachable')];

  it('cuts nothing with no width, whatever the title\'s length', () => {
    const lines = renderRoadmapTable(rows, undefined, TEXTS);
    expect(lines[1]?.endsWith(LONG_TITLE)).toBe(true);
    expect(lines.join('\n')).not.toContain('…');
  });

  it('reads a width that is no positive whole number as none', () => {
    const uncut = renderRoadmapTable(rows);
    for (const width of [0, -10, Number.NaN, 12.5]) expect(renderRoadmapTable(rows, width)).toEqual(uncut);
  });

  it('cuts nothing when the table fits the width exactly', () => {
    const exact = naturalWidth(rows);
    const lines = renderRoadmapTable(rows, exact, TEXTS);
    expect(lines).toEqual(renderRoadmapTable(rows, undefined, TEXTS));
    expect(Math.max(...lines.map(widthOf))).toBe(exact);
  });

  it('cuts the title by one, ending …, one column short of an exact fit', () => {
    const exact = naturalWidth(rows);
    const lines = renderRoadmapTable(rows, exact - 1, TEXTS);
    expect(Math.max(...lines.map(widthOf))).toBe(exact - 1);
    expect(lines[1]?.endsWith(`${LONG_TITLE.slice(0, -2)}…`)).toBe(true);
  });

  it('cuts the title no further than its floor, and prints wider than a too-narrow terminal', () => {
    const lines = renderRoadmapTable(rows, 40, TEXTS);
    const row = lines[1] ?? '';
    const cells = row.split(COLUMN_GAP).filter((text) => text !== '');
    expect(widthOf(cells.at(-1)?.trim() ?? '')).toBe(TITLE_FLOOR);
    expect(widthOf(row)).toBeGreaterThan(40);
    expect(row).toContain('open #24');
    expect(row).toContain('plan, pr #40');
    expect(row.split(COLUMN_GAP).map((text) => text.trim())).toContain('2');
  });
});

describe('fitColumnWidths', () => {
  const natural = [4, 5, 4, 5, 10, 12, 4, 60];
  const total = natural.reduce((sum, width) => sum + width, 0) + COLUMN_GAP.length * 7;

  it('cuts the title toward its floor and nothing else', () => {
    expect(fitColumnWidths(natural, total - 10)).toEqual([...natural.slice(0, 7), 50]);
    expect(fitColumnWidths(natural, 1)).toEqual([...natural.slice(0, 7), TITLE_FLOOR]);
  });
});

describe('cutCell', () => {
  it('keeps text that fits and cuts text that does not to the width, ending …', () => {
    expect(cutCell('fits', 4)).toBe('fits');
    expect(cutCell('too long', 4)).toBe('too…');
    expect(widthOf(cutCell('too long', 4))).toBe(4);
  });

  it('counts a symbol as the two cells a terminal draws it in', () => {
    expect(cutCell('✅✅✅', 4)).toBe('✅…');
    expect(widthOf(cutCell('✅✅✅', 4))).toBe(3);
  });
});
