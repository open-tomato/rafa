/**
 * Tests for the symbols an entry names (`symbols.ts`), the cases that
 * must answer nothing first: `#<n>` refs, possessives, short names and
 * plain words. A reader answering nothing would pass each of them, so
 * each keeps a control: the same text, one character or shape changed,
 * answering the symbol.
 */
import { describe, expect, it } from 'bun:test';

import { MIN_SYMBOL_LENGTH, symbolsOf } from './symbols.js';

/** The symbols of an entry whose `what` is `what` and whose artifact is `artifact`. */
function symbols(what: string | null, artifact: string | null = null): readonly string[] {
  return symbolsOf({ what, artifact });
}

describe('symbolsOf leaves out #<n> refs', () => {
  it('reads no symbol from a backticked or parenthesised ref', () => {
    expect(symbols('filed as `#1384` (#1384), see #1528')).toEqual([]);
  });

  it('drops the ref from a phrase and keeps the rest when it is long enough', () => {
    expect(symbols('a leftover (from #1384)')).toEqual([]);
    expect(symbols('a leftover (seen again in #1384)')).toEqual(['seen again in']);
  });

  it('control: a backticked span without the # is read', () => {
    expect(symbols('filed as `issue1384`')).toEqual(['issue1384']);
  });
});

describe('symbolsOf leaves out a quote right after a letter', () => {
  it('reads no span between two possessives', () => {
    expect(symbols('the run\'s, board\'s and plan\'s state')).toEqual([]);
  });

  it('reads no span from a contraction', () => {
    expect(symbols('it doesn\'t read what isn\'t there')).toEqual([]);
  });

  it('control: a quote after a space opens a span', () => {
    expect(symbols('the run \'s, board\' state')).toEqual(['s, board']);
    expect(symbols('the line \'Repair the red\' and "kept capture"')).toEqual(['Repair the red', 'kept capture']);
  });
});

describe('symbolsOf leaves out short names', () => {
  it('drops a span or name one character shorter than the minimum', () => {
    const short = 'a'.repeat(MIN_SYMBOL_LENGTH - 1);
    expect(symbols(`\`${short}\` and (fail) and \`files\``)).toEqual([]);
    expect(symbols('the readX of runId')).toEqual([]);
  });

  it('control: a span of exactly the minimum is read', () => {
    const exact = 'a'.repeat(MIN_SYMBOL_LENGTH);
    expect(symbols(`\`${exact}\``)).toEqual([exact]);
  });
});

describe('symbolsOf reads no plain words', () => {
  it('reads no symbol from lower-case, capitalised and upper-case words', () => {
    expect(symbols('Board refresh fails when README and CHANGELOG differ')).toEqual([]);
  });

  it('reads nothing from an entry with neither field', () => {
    expect(symbols(null, null)).toEqual([]);
  });

  it('reads no span across a line break', () => {
    expect(symbols('an open `backtick\nclosed` later')).toEqual([]);
  });
});

describe('symbolsOf reads each shape', () => {
  it('reads camelCase, PascalCase and CONST_CASE names', () => {
    expect(symbols('readPlanFiles fails when TakenBy holds MIN_SYMBOL_LENGTH')).toEqual([
      'readPlanFiles',
      'TakenBy',
      'MIN_SYMBOL_LENGTH',
    ]);
  });

  it('reads a backticked span and the names inside it', () => {
    expect(symbols('the key `loop.retries` and `checkKind(input)`')).toEqual([
      'loop.retries',
      'checkKind(input)',
      'checkKind',
    ]);
  });

  it('reads a parenthesised phrase, trimmed', () => {
    expect(symbols('the step ( red capture ) is gone')).toEqual(['red capture']);
  });

  it('reads the artifact beside the what', () => {
    expect(symbols('a leftover', 'error: insertLeftoverRepair is not a function')).toEqual(['insertLeftoverRepair']);
  });

  it('answers each symbol once, in the order the text first names it', () => {
    expect(symbols('isPlanFile then pathsNamedIn', 'isPlanFile again')).toEqual(['isPlanFile', 'pathsNamedIn']);
  });
});
