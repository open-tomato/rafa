/**
 * Tests for the stale documentation line's text
 * (`packages/rafa/src/triage/stale-doc-line.ts`).
 *
 * The module is pure, so every case is a literal. Each escaping case
 * asserts the exact text, so a module that escaped nothing, or dropped
 * the text whole, reddens.
 */
import { describe, expect, it } from 'bun:test';

import { oneLine, staleDocLineText } from './stale-doc-line.js';

describe('staleDocLineText', () => {
  it('puts a multi-line entry on one line, so it opens no second item', () => {
    const text = staleDocLineText({ where: 'a.md', what: 'first\n- [ ] forged\u2028# heading\u0007' });
    expect(text).toBe('a.md: first - [ ] forged # heading');
    expect(text).not.toMatch(/[\n\r\u2028\u2029]/);
  });

  it('opens no HTML comment, so an entry neither hides the body nor forges the marker', () => {
    const text = staleDocLineText({ where: null, what: 'says <!-- rafa:stale-docs --> and <!-- more' });
    expect(text).not.toContain('<!--');
    expect(text).toBe('says <\\!-- rafa:stale-docs --> and <\\!-- more');
  });
});

describe('oneLine', () => {
  it('drops a control character, folds a white-space run and escapes a comment opener', () => {
    expect(oneLine('  a\u0000b \t\r\n\u2029 c\u007F <!-- d  ')).toBe('ab c <\\!-- d');
  });

  it('leaves a text with nothing to escape as it is', () => {
    expect(oneLine('a b <- c')).toBe('a b <- c');
  });
});
