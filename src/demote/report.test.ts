/**
 * Tests for the demotion report's reader and writer.
 *
 * The report exists to survive a round trip through a human editor, so
 * the readings here are of that round trip rather than of the text:
 * every fixture that is meant to parse is built by
 * {@link writeDemotionReport}, and the assertion is that
 * {@link parseDemotionReport} answers the rows that went in. A test
 * that spelled the table by hand would measure a table nobody writes.
 *
 * The refusals go the other way and ARE spelled by hand, because each
 * one is an edit a reviewer makes in an editor: a cell blanked, a
 * verdict misspelled, a `|` typed into a reason, an override written
 * with its reason still missing. {@link PROVOKED} closes the code set
 * in both directions against {@link DEMOTION_REPORT_ISSUE_CODES}, so a
 * code nothing here provokes and a code produced by nothing named here
 * are both red.
 *
 * ## The controls
 *
 * Two of these readings could be false negatives on their own and each
 * is paired:
 *
 *   - **Escaping.** `a reason carrying a pipe` measures that a `|`
 *     written through the writer comes back whole. Beside it, `a pipe
 *     typed in by hand` feeds the SAME reason unescaped and measures
 *     `wrong-cell-count` — without it the first would pass on a reader
 *     that split on nothing at all.
 *   - **`status: draft`.** `a draft report` measures that a draft
 *     parses with no issues, which is the whole reason `--apply` has
 *     to refuse it itself. Beside it, `an unknown status` measures
 *     that the status is read rather than ignored.
 *
 * {@link sourceHash} is measured against the published sha256 of the
 * three-byte string `abc` rather than against itself, so a hash
 * function that hashed the wrong thing consistently would still be
 * red.
 */
import type { DemotionReportIssueCode, DemotionReportRow } from './report.js';

import { describe, expect, test } from 'bun:test';

import { readFrontmatter } from '../schema/frontmatter.js';

import { DEMOTION_VERDICTS } from './classify.js';
import {
  DEMOTION_REPORT_COLUMNS,
  DEMOTION_REPORT_ISSUE_CODES,
  DEMOTION_REPORT_STATUSES,
  DRAFT_STATUS,
  EMPTY_CELL,
  REVIEWED_STATUS,
  STATUS_FIELD,
  countVerdicts,
  effectiveVerdict,
  parseDemotionReport,
  sourceHash,
  splitTableRow,
  writeDemotionReport,
} from './report.js';

/** A hash cell of the right shape: 64 lower-case hex characters. */
const HASH = 'a'.repeat(64);

/** A second hash, so two rows can differ in more than their path. */
const OTHER_HASH = 'b'.repeat(64);

/** A row the classifier would have written, with `changes` applied. */
function row(changes: Partial<DemotionReportRow> = {}): DemotionReportRow {
  return {
    path: 'assert-the-stub-was-hit/SKILL.md',
    hash: HASH,
    verdict: 'observation',
    reason: 'one Problem section, one Solution section, no numbered procedure',
    override: null,
    overrideReason: null,
    ...changes,
  };
}

/** The lines of a hand-written report whose one row is `cells`. */
function handWritten(cells: readonly string[], status = REVIEWED_STATUS): string {
  return [
    '---',
    `${STATUS_FIELD}: ${status}`,
    '---',
    '',
    `| ${DEMOTION_REPORT_COLUMNS.join(' | ')} |`,
    `| ${DEMOTION_REPORT_COLUMNS.map(() => '---').join(' | ')} |`,
    `| ${cells.join(' | ')} |`,
    '',
  ].join('\n');
}

/** The cells of a row that parses, so one can be broken at a time. */
const GOOD_CELLS: readonly string[] = [
  'assert-the-stub-was-hit/SKILL.md',
  HASH,
  'observation',
  'one Problem section, one Solution section',
  EMPTY_CELL,
  EMPTY_CELL,
];

/** `GOOD_CELLS` with the cell at `index` replaced. */
function cellsWith(index: number, value: string): string[] {
  const cells = [...GOOD_CELLS];
  cells[index] = value;
  return cells;
}

/** Every issue code `text` provokes, in report order. */
function codesOf(text: string): DemotionReportIssueCode[] {
  return parseDemotionReport(text).issues.map((found) => found.code);
}

describe('the written report', () => {
  test('carries the status in frontmatter the schema reader can read', () => {
    const text = writeDemotionReport({ status: DRAFT_STATUS, rows: [row()] });

    expect(readFrontmatter(text)?.[STATUS_FIELD]).toBe(DRAFT_STATUS);
  });

  test('names every column in the header row, in order', () => {
    const text = writeDemotionReport({ status: DRAFT_STATUS, rows: [row()] });
    const header = text.split('\n')
      .map((line) => splitTableRow(line))
      .find((cells) => cells !== null && cells[0] === DEMOTION_REPORT_COLUMNS[0]);

    expect(header).toEqual([...DEMOTION_REPORT_COLUMNS]);
  });

  test('counts the verdicts in a line the reviewer can read', () => {
    const text = writeDemotionReport({
      status: DRAFT_STATUS,
      rows: [row(), row({ path: 'b/SKILL.md', verdict: 'procedure' })],
    });

    expect(text).toContain('2 files: 1 observation, 1 procedure, 0 unclassified.');
  });

  test('writes an empty override as a filled cell rather than a gap', () => {
    const text = writeDemotionReport({ status: DRAFT_STATUS, rows: [row()] });

    expect(text).toContain(`| ${EMPTY_CELL} | ${EMPTY_CELL} |`);
  });

  test('ends in exactly one newline', () => {
    const text = writeDemotionReport({ status: DRAFT_STATUS, rows: [row()] });

    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });
});

describe('a report read back', () => {
  test('answers the rows that were written, and the status', () => {
    const rows = [
      row(),
      row({
        path: 'learned/bash-shim.md',
        hash: OTHER_HASH,
        verdict: 'unclassified',
        reason: 'no Problem and Solution pair',
        override: 'observation',
        overrideReason: 'the body pairs Symptom with Fix',
      }),
    ];
    const result = parseDemotionReport(
      writeDemotionReport({ status: REVIEWED_STATUS, rows }),
    );

    expect(result.issues).toEqual([]);
    expect(result.report).toEqual({ status: REVIEWED_STATUS, rows });
  });

  test('reads a draft with no issues, because refusing it is the apply step', () => {
    const result = parseDemotionReport(
      writeDemotionReport({ status: DRAFT_STATUS, rows: [row()] }),
    );

    expect(result.issues).toEqual([]);
    expect(result.report?.status).toBe(DRAFT_STATUS);
  });

  test('reads a report with no rows at all', () => {
    const result = parseDemotionReport(writeDemotionReport({ status: DRAFT_STATUS, rows: [] }));

    expect(result.issues).toEqual([]);
    expect(result.report).toEqual({ status: DRAFT_STATUS, rows: [] });
  });

  test('reads a reason carrying a pipe back whole', () => {
    const reason = 'the body says `grep -n | head` and nothing else';
    const result = parseDemotionReport(writeDemotionReport({
      status: REVIEWED_STATUS,
      rows: [row({ override: 'procedure', overrideReason: reason })],
    }));

    expect(result.issues).toEqual([]);
    expect(result.report?.rows[0]?.overrideReason).toBe(reason);
  });

  test('refuses a pipe typed in by hand, naming the row', () => {
    const codes = codesOf(handWritten(
      cellsWith(3, 'the body says `grep -n | head` and nothing else'),
    ));

    expect(codes).toEqual(['wrong-cell-count']);
  });

  test('reads a backslash in a cell back whole', () => {
    const result = parseDemotionReport(writeDemotionReport({
      status: DRAFT_STATUS,
      rows: [row({ reason: 'the body names C:\\Windows\\system32' })],
    }));

    expect(result.report?.rows[0]?.reason).toBe('the body names C:\\Windows\\system32');
  });

  test('reads a row a reviewer wrote without its outer pipes', () => {
    const text = writeDemotionReport({ status: REVIEWED_STATUS, rows: [row()] })
      .split('\n')
      .map((line) => line.replace(/^\| (.*) \|$/, '$1'))
      .join('\n');

    expect(parseDemotionReport(text).report?.rows).toEqual([row()]);
  });

  test('ignores prose the reviewer left above and below the table', () => {
    const text = writeDemotionReport({ status: REVIEWED_STATUS, rows: [row()] })
      .replace('# Demotion report', '# Demotion report\n\nChecked every row on 2026-09-18.');

    expect(parseDemotionReport(`${text}\nStill to do: the sibling.\n`).report?.rows)
      .toEqual([row()]);
  });

  test('stops the table at the first line holding no pipe, losing the rows under it', () => {
    const lines = writeDemotionReport({
      status: REVIEWED_STATUS,
      rows: [row(), row({ path: 'b/SKILL.md', hash: OTHER_HASH })],
    }).split('\n');
    const noted = lines.flatMap((line) => (line.startsWith('| b/SKILL.md')
      ? ['A note about the row below.', line]
      : [line]));
    const result = parseDemotionReport(noted.join('\n'));

    expect(result.issues).toEqual([]);
    expect(result.report?.rows.map((found) => found.path)).toEqual([
      'assert-the-stub-was-hit/SKILL.md',
    ]);
  });

  test('reads an override cell left blank as no override', () => {
    const result = parseDemotionReport(handWritten(cellsWith(4, '')));

    expect(result.report?.rows[0]?.override).toBeNull();
    expect(result.report?.rows[0]?.overrideReason).toBeNull();
  });
});

/** One hand-written report per code, so the set can be closed. */
const PROVOKED: Readonly<Record<DemotionReportIssueCode, string>> = {
  'missing-frontmatter': handWritten(GOOD_CELLS).slice(4),
  'missing-status': handWritten(GOOD_CELLS).replace(`${STATUS_FIELD}: ${REVIEWED_STATUS}`, 'note: x'),
  'unknown-status': handWritten(GOOD_CELLS).replace(REVIEWED_STATUS, 'approved'),
  'missing-table': `---\n${STATUS_FIELD}: ${REVIEWED_STATUS}\n---\n\nNo table here.\n`,
  'unknown-columns': handWritten(GOOD_CELLS).replace('sha256', 'digest'),
  'wrong-cell-count': handWritten(GOOD_CELLS.slice(0, 5)),
  'missing-path': handWritten(cellsWith(0, '')),
  'invalid-hash': handWritten(cellsWith(1, 'deadbeef')),
  'unknown-verdict': handWritten(cellsWith(2, 'observational')),
  'missing-reason': handWritten(cellsWith(3, '')),
  'unknown-override': handWritten(cellsWith(4, 'keep')),
  'override-without-reason': handWritten(cellsWith(4, 'procedure')),
  'override-reason-without-verdict': handWritten(cellsWith(5, 'it reads as a procedure')),
  'duplicate-path': handWritten(GOOD_CELLS).replace(
    `| ${GOOD_CELLS.join(' | ')} |`,
    `| ${GOOD_CELLS.join(' | ')} |\n| ${GOOD_CELLS.join(' | ')} |`,
  ),
};

describe('the issue set', () => {
  test('holds every code a fixture provokes, and no code none does', () => {
    expect(Object.keys(PROVOKED).sort()).toEqual([...DEMOTION_REPORT_ISSUE_CODES].sort());
  });

  test('answers each fixture with its own code and refuses the report', () => {
    for (const [code, text] of Object.entries(PROVOKED)) {
      const result = parseDemotionReport(text);

      expect({ code, codes: result.issues.map((found) => found.code) })
        .toEqual({ code, codes: [code] });
      expect({ code, report: result.report }).toEqual({ code, report: null });
    }
  });

  test('names the line each row issue was read on', () => {
    const issues = parseDemotionReport(PROVOKED['invalid-hash']).issues;

    expect(issues[0]?.line).toBe(7);
    expect(issues[0]?.field).toBe('sha256');
  });
});

describe('a row verdict', () => {
  test('is the classified verdict where the review wrote no override', () => {
    expect(effectiveVerdict(row({ verdict: 'procedure' }))).toBe('procedure');
  });

  test('is the override where the review wrote one', () => {
    expect(effectiveVerdict(row({
      verdict: 'unclassified',
      override: 'observation',
      overrideReason: 'Symptom and Fix are a Problem and Solution pair',
    }))).toBe('observation');
  });
});

describe('the verdict counts', () => {
  test('name every verdict, including the ones no row carries', () => {
    expect(Object.keys(countVerdicts([])).sort()).toEqual([...DEMOTION_VERDICTS].sort());
  });

  test('count a row under its override rather than its verdict', () => {
    const counts = countVerdicts([
      row(),
      row({
        path: 'b/SKILL.md',
        verdict: 'observation',
        override: 'procedure',
        overrideReason: 'it names a script',
      }),
    ]);

    expect(counts).toEqual({ observation: 1, procedure: 1, unclassified: 0 });
  });
});

describe('the hash column', () => {
  test('is the published sha256 of its text', () => {
    expect(sourceHash('abc'))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('changes when one byte of the file does', () => {
    expect(sourceHash('abc')).not.toBe(sourceHash('abd'));
  });
});

describe('the status set', () => {
  test('holds the draft and reviewed constants and nothing else', () => {
    expect([...DEMOTION_REPORT_STATUSES].sort()).toEqual([DRAFT_STATUS, REVIEWED_STATUS].sort());
  });
});
