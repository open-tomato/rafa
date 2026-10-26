import { describe, expect, test } from 'bun:test';

import { DEFAULT_BUG_TITLE, renderTitle, titleRoundTrips } from '@open-tomato/rafa/bugs/title';

import { GITHUB_LABEL_MAX_LENGTH, GITHUB_LABELS } from '../adapters/tracker/github.js';

import { boundaryValueOf, summaryOf } from './filed-values.js';

/** The longest module whose `module:` label GitHub accepts. */
const LONGEST_MODULE = GITHUB_LABEL_MAX_LENGTH - GITHUB_LABELS.modulePrefix.length;

describe('boundaryValueOf', () => {
  test('a null or blank word is unknown, with nothing reported', () => {
    expect(boundaryValueOf('module', null, [])).toEqual({ value: 'unknown', reported: null });
    expect(boundaryValueOf('action', '  \t ', [])).toEqual({ value: 'unknown', reported: null });
  });

  test('the word unknown, in any case, is unknown with nothing reported', () => {
    expect(boundaryValueOf('module', ' Unknown ', [])).toEqual({ value: 'unknown', reported: null });
  });

  test('a word of the shape is lower-cased and trimmed, with nothing reported', () => {
    expect(boundaryValueOf('module', ' Loop ', [])).toEqual({ value: 'loop', reported: null });
    expect(boundaryValueOf('action', 'Run Tests', [])).toEqual({ value: 'run tests', reported: null });
  });

  test('a module holding a space is unknown, the session\'s word reported', () => {
    expect(boundaryValueOf('module', ' Loop Start ', [])).toEqual({ value: 'unknown', reported: 'Loop Start' });
  });

  test('a word off the shape is unknown, the session\'s word reported', () => {
    expect(boundaryValueOf('action', 'start: resume', [])).toEqual({ value: 'unknown', reported: 'start: resume' });
    expect(boundaryValueOf('module', 'src/start.ts', [])).toEqual({ value: 'unknown', reported: 'src/start.ts' });
  });

  test('a word inside a vocabulary that is set is used', () => {
    expect(boundaryValueOf('module', 'Triage', ['loop', 'triage'])).toEqual({ value: 'triage', reported: null });
  });

  test('a word outside a vocabulary that is set is unknown, the session\'s word reported', () => {
    expect(boundaryValueOf('module', 'board', ['loop', 'triage'])).toEqual({ value: 'unknown', reported: 'board' });
    expect(boundaryValueOf('action', 'merge', ['start'])).toEqual({ value: 'unknown', reported: 'merge' });
  });

  test('a module whose label fits GitHub\'s cap is used, and one a character longer is unknown', () => {
    const fits = 'm'.repeat(LONGEST_MODULE);
    const over = 'm'.repeat(LONGEST_MODULE + 1);
    expect(boundaryValueOf('module', fits, [])).toEqual({ value: fits, reported: null });
    expect(boundaryValueOf('module', over, [])).toEqual({ value: 'unknown', reported: over });
  });

  test('an action is held to the cap of a label\'s name alone', () => {
    const fits = 'a'.repeat(GITHUB_LABEL_MAX_LENGTH);
    const over = 'a'.repeat(GITHUB_LABEL_MAX_LENGTH + 1);
    expect(boundaryValueOf('action', fits, [])).toEqual({ value: fits, reported: null });
    expect(boundaryValueOf('action', over, [])).toEqual({ value: 'unknown', reported: over });
  });
});

describe('summaryOf', () => {
  test('a what within the cap is put on one line and kept whole', () => {
    expect(summaryOf('resume  does not\n find the\tbranch ', 80, DEFAULT_BUG_TITLE, { module: 'loop' }))
      .toBe('resume does not find the branch');
  });

  test('a what exactly at the cap is kept whole', () => {
    const what = 'x'.repeat(20);
    expect(summaryOf(what, 20, DEFAULT_BUG_TITLE, {})).toBe(what);
  });

  test('a what past the cap is cut to the cap with ..., the space before it trimmed', () => {
    const summary = summaryOf('the loop does not find the worktree branch on resume', 20, DEFAULT_BUG_TITLE, {});
    expect(summary).toBe('the loop does not...');
    expect(Array.from(summary).length).toBeLessThanOrEqual(20);
  });

  test('the cap counts code points, not UTF-16 units', () => {
    const summary = summaryOf('🍅'.repeat(30), 20, DEFAULT_BUG_TITLE, {});
    expect(summary).toBe(`${'🍅'.repeat(17)}...`);
  });

  test('a summary with a colon whose title reads back keeps its colon', () => {
    const fields = { module: 'loop', action: 'start' };
    const summary = summaryOf('resume: the branch is missing', 80, DEFAULT_BUG_TITLE, fields);
    expect(summary).toBe('resume: the branch is missing');
    expect(renderTitle(DEFAULT_BUG_TITLE, { ...fields, summary })).toBe('loop - start: resume: the branch is missing');
  });

  test('a test file and a colon with no module is written with a dash, and the title then reads back', () => {
    const fields = { module: 'unknown', action: 'unknown' };
    const what = 'start.test.ts: resume: the branch is missing';
    expect(titleRoundTrips(DEFAULT_BUG_TITLE, { ...fields, summary: what })).toBe(false);
    const summary = summaryOf(what, 80, DEFAULT_BUG_TITLE, fields);
    expect(summary).toBe('start.test.ts — resume: the branch is missing');
    expect(titleRoundTrips(DEFAULT_BUG_TITLE, { ...fields, summary })).toBe(true);
  });

  test('the rewrite stays within the cap', () => {
    const what = `start.test.ts: ${'y'.repeat(40)}`;
    const summary = summaryOf(what, 30, DEFAULT_BUG_TITLE, {});
    expect(summary).toBe(`start.test.ts — ${'y'.repeat(11)}...`);
    expect(Array.from(summary).length).toBe(30);
  });

  test('a summary with no colon is never rewritten', () => {
    expect(summaryOf('start.test.ts fails', 80, DEFAULT_BUG_TITLE, {})).toBe('start.test.ts fails');
  });
});
