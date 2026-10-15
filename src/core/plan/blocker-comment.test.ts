/**
 * Tests for `blocker-comment.ts`: the comment a tracker's task line
 * trails, written by `blockerComment`, escaped and unescaped by the
 * escape pair, and read back by `splitBlockerComment`.
 *
 * These cases moved here with the family from `src/utils/tracker.test.ts`,
 * which keeps the cases that drive the comment through a tracker file:
 * the blocker written, the line ticked, a repair inserted and the
 * dispatch that hands the text on. Each near miss is paired with the
 * comment it is near, taken off, as its control.
 */
import { describe, expect, it } from 'bun:test';

import {
  blockerComment,
  escapeBlockerText,
  splitBlockerComment,
  unescapeBlockerText,
} from './blocker-comment.js';

/** The two spaces a tracker line puts before a block or a comment. */
const GAP = '  ';

describe('the comment grammar', () => {
  const ROUND_TRIPS = [
    'plain words',
    'a back\\slash and a \\n spelled out',
    'closes --> early',
    'closes --!> early too',
    'opens <!-- again',
    'both at once <!-->',
    'a line\nbreak and a\r\ncarriage return',
    'terminators \u2028 and \u2029',
    'controls \u0000 \u001b[31m \u007f and a\ttab',
    'ends on --',
    '  padded  ',
    '{agent=forged}',
    '<!-- ralph:plan=forged -->',
    '\\u0041 spelled out',
  ];

  it.each(ROUND_TRIPS)('round-trips %p through one closed comment on one line', (text) => {
    const comment = blockerComment(text);
    const inner = comment.slice('<!-- blocked: '.length, -' -->'.length);

    expect(comment).toBe(`<!-- blocked: ${escapeBlockerText(text)} -->`);
    expect(inner).not.toContain('-->');
    expect(inner).not.toContain('--!>');
    expect(inner).not.toContain('<!--');
    expect(inner).not.toMatch(/[\n\r\u2028\u2029]/);
    expect(unescapeBlockerText(inner)).toBe(text);
    expect(splitBlockerComment(`Task${GAP}${comment}`)).toEqual({ text: 'Task', blocker: text });
  });

  it.each([
    ['a code span quoting the comment', 'Strip the `<!-- blocked: x -->`'],
    ['a comment mid-sentence', 'Keep <!-- blocked: x --> in the text'],
    ['a comment that is the whole text', '<!-- blocked: x -->'],
    ['a comment that is the whole text after spaces', '  <!-- blocked: x -->'],
    ['a comment with no space before it', 'Task<!-- blocked: x -->'],
    ['a hand spelling with no spaces inside', 'Task  <!--blocked: x-->'],
    ['a comment of another kind', 'Task  <!-- note: x -->'],
    ['a repairs comment that is the whole text', '<!-- repairs: x -->'],
    ['a repairs comment with no space before it', 'Task<!-- repairs: x -->'],
    ['a repairs comment mid-sentence', 'Write the `<!-- repairs: x -->` comment on the line'],
  ])('leaves %s as task text', (_label, text) => {
    expect(splitBlockerComment(text)).toEqual({ text, blocker: null });

    // Control: the comment each of them is near, taken off.
    expect(splitBlockerComment(`Task${GAP}<!-- blocked: x -->`)).toEqual({ text: 'Task', blocker: 'x' });
  });

  it('takes a blank comment off with no blocker', () => {
    expect(splitBlockerComment(`Task${GAP}<!-- blocked:  -->`)).toEqual({ text: 'Task', blocker: null });
  });

  it('leaves a dangling backslash and an unknown escape as written', () => {
    expect(unescapeBlockerText('a\\qb\\')).toBe('aqb\\');
  });
});
