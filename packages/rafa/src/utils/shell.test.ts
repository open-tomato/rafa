/**
 * Tests for `shell.ts`: a plain word left as it stands, a word with a
 * space quoted, and a word with a single quote quoted with the quote
 * escaped. Each quoted reading sits beside the plain one, so a quoter
 * that quoted everything, or nothing, fails here.
 */
import { describe, expect, it } from 'bun:test';

import { shellQuote } from './shell.js';

describe('shellQuote', () => {
  it('leaves a plain word as it stands', () => {
    expect(shellQuote('github.com')).toBe('github.com');
  });

  it('quotes a word carrying a space', () => {
    expect(shellQuote('git hub.com')).toBe('\'git hub.com\'');
  });

  it('quotes a word carrying a single quote, escaping the quote', () => {
    expect(shellQuote('o\'hara.com')).toBe('\'o\'\\\'\'hara.com\'');
  });
});
