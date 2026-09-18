/**
 * Tests for the report a write of the pass produces (`./draft.ts`):
 * one classified row per selected file, and what happens to a review
 * that is already there when the report is written again.
 *
 * Nothing here reads a directory. A {@link SelectedFile} is built from
 * a string, because {@link buildDemotionReport} takes what
 * `./select.ts` found and never the disk, and `select.test.ts` is where
 * the finding itself is measured.
 *
 * ## The controls
 *
 * The carry rule is a rule about what is NOT copied, so every reading
 * of it is paired with the reading that would pass on a carry that
 * copied everything:
 *
 *   - **An override survives a re-run.** Beside it, the SAME override
 *     against a file whose bytes changed is dropped, so a carry keyed
 *     on the path alone would be red.
 *   - **`status: reviewed` survives an unchanged row set.** Beside it,
 *     the same reviewed report with one row added, one removed and one
 *     edited each goes back to `draft`, so a carry that kept the status
 *     unconditionally would be red on three cases.
 *
 * The override reason is asserted beside the override verdict in both
 * directions: a carry that took the verdict and left the reason behind
 * would produce `override-without-reason` on the next parse, which is
 * the half-finished review `./report.ts` exists to refuse.
 */
import type { SelectedFile } from './select.js';

import { describe, expect, it } from 'bun:test';

import { buildDemotionReport, carryReview, classifiedRow } from './draft.js';
import { DRAFT_STATUS, REVIEWED_STATUS, sourceHash } from './report.js';

/** A body with one Problem and one Solution and no numbered run. */
function observation(action: string): string {
  return [
    '---',
    'name: one',
    'description: A single observation.',
    '---',
    '',
    '# One',
    '',
    '## When to Use',
    '',
    'When the thing happens.',
    '',
    '## Problem',
    '',
    'The cause.',
    '',
    '## Solution',
    '',
    action,
    '',
  ].join('\n');
}

/** A body with a numbered procedure of three consecutive steps. */
function procedure(): string {
  return [
    '---',
    'name: two',
    'description: The steps, in order.',
    '---',
    '',
    '# Two',
    '',
    '## Problem',
    '',
    'Steps get skipped.',
    '',
    '## Solution',
    '',
    '1. Bump the version.',
    '2. Run the gates.',
    '3. Tag the commit.',
    '',
  ].join('\n');
}

/** A body with no frontmatter at all, which nothing can classify. */
function unclassified(): string {
  return ['# Three', '', 'Some prose and no sections.', ''].join('\n');
}

/** One selected file, as `./select.ts` would have answered it. */
function file(path: string, text: string): SelectedFile {
  return { path, text, entries: undefined, absolute: `/nowhere/${path}`, hash: sourceHash(text), mtime: '2026-09-01T00:00:00Z' };
}

describe('the rows a write produces', () => {
  it('answers one row per file, with its hash, its verdict and the rule that decided it', () => {
    const files = [
      file('one/SKILL.md', observation('Read the stream as it comes.')),
      file('two/SKILL.md', procedure()),
      file('three/SKILL.md', unclassified()),
    ];
    const report = buildDemotionReport(files, null);

    expect(report.status).toBe(DRAFT_STATUS);
    expect(report.rows.map((row) => [row.path, row.verdict]))
      .toEqual([['one/SKILL.md', 'observation'], ['two/SKILL.md', 'procedure'], ['three/SKILL.md', 'unclassified']]);
    expect(report.rows.map((row) => row.hash)).toEqual(files.map((entry) => entry.hash));
    expect(report.rows.filter((row) => row.reason === '')).toEqual([]);
  });

  it('leaves both override columns empty on a fresh row', () => {
    const row = classifiedRow(file('one/SKILL.md', observation('Read it.')));

    expect(row.override).toBeNull();
    expect(row.overrideReason).toBeNull();
  });
});

describe('a review already in the report', () => {
  it('carries an override whose file has not changed, and drops one whose file has', () => {
    const before = buildDemotionReport([file('one/SKILL.md', observation('Read it.'))], null);
    const reviewed = {
      status: REVIEWED_STATUS,
      rows: before.rows.map((row) => ({ ...row, override: 'procedure' as const, overrideReason: 'it is a recipe' })),
    };

    const unchanged = buildDemotionReport([file('one/SKILL.md', observation('Read it.'))], reviewed);
    const edited = buildDemotionReport([file('one/SKILL.md', observation('Read it twice.'))], reviewed);

    expect(unchanged.rows[0]?.override).toBe('procedure');
    expect(unchanged.rows[0]?.overrideReason).toBe('it is a recipe');
    expect(edited.rows[0]?.override).toBeNull();
    expect(edited.rows[0]?.overrideReason).toBeNull();
  });

  it('keeps the reviewed status over an unchanged row set and drops it when the tree moved', () => {
    const one = file('one/SKILL.md', observation('Read it.'));
    const two = file('two/SKILL.md', procedure());
    const reviewed = { ...buildDemotionReport([one, two], null), status: REVIEWED_STATUS };

    expect(carryReview(buildDemotionReport([one, two], null).rows, reviewed).status).toBe(REVIEWED_STATUS);
    expect(carryReview(buildDemotionReport([one], null).rows, reviewed).status).toBe(DRAFT_STATUS);
    expect(carryReview(buildDemotionReport([one, two, file('x/SKILL.md', procedure())], null).rows, reviewed).status)
      .toBe(DRAFT_STATUS);
    expect(carryReview(buildDemotionReport([one, file('two/SKILL.md', observation('Other.'))], null).rows, reviewed).status)
      .toBe(DRAFT_STATUS);
  });

  it('carries nothing at all when there is no report to carry from', () => {
    const report = buildDemotionReport([file('one/SKILL.md', observation('Read it.'))], null);

    expect(report.status).toBe(DRAFT_STATUS);
    expect(report.rows[0]?.override).toBeNull();
  });
});
