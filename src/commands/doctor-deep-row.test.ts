/**
 * Tests for the deep row and section rendering (`doctor-deep-row.ts`).
 * Each shape is held against its neighbour — a row with a fix against
 * one without, a section with rows against an empty one — so a renderer
 * that always or never printed the extra line fails one side.
 */
import { describe, expect, test } from 'bun:test';

import { EMPTY_SECTION_LINE, renderDeepRow, renderDeepSection } from './doctor-deep-row.js';

describe('renderDeepRow', () => {
  test('renders a row without a fix as one line', () => {
    expect(renderDeepRow({ status: 'ok', name: 'gh', detail: 'found on PATH' }))
      .toEqual(['  ok    gh: found on PATH']);
  });

  test('renders a row with a fix as the row and an indented fix line', () => {
    const row = { status: 'warn', name: 'ts-symbols', detail: 'not on PATH', fix: 'install it' } as const;
    expect(renderDeepRow(row)).toEqual([
      '  warn  ts-symbols: not on PATH',
      '        fix: install it',
    ]);
  });

  test('pads every status to one column', () => {
    const starts = (['ok', 'warn', 'note'] as const)
      .map((status) => renderDeepRow({ status, name: 'n', detail: 'd' })[0]?.indexOf('n: d'));
    expect(new Set(starts).size).toBe(1);
  });
});

describe('renderDeepSection', () => {
  test('renders the title then each row with its fix', () => {
    const lines = renderDeepSection({
      title: 'Settings',
      rows: [
        { status: 'note', name: 'skill x', detail: 'user only', fix: 'add user to setting sources' },
        { status: 'ok', name: 'sources', detail: 'project,local' },
      ],
    });
    expect(lines).toEqual([
      'Settings:',
      '  note  skill x: user only',
      '        fix: add user to setting sources',
      '  ok    sources: project,local',
    ]);
  });

  test('says a section with no rows has nothing to report', () => {
    expect(renderDeepSection({ title: 'Stack tools', rows: [] }))
      .toEqual(['Stack tools:', EMPTY_SECTION_LINE]);
  });
});
