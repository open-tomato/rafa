/**
 * Tests for the colour decision: `FORCE_COLOR` over `NO_COLOR` over the
 * terminal check, and `paint` for each level, the plain theme and colour
 * off.
 */
import type { LogLevel } from '../../ports/index.js';

import { describe, expect, it } from 'bun:test';

import { colourEnabled, paint } from './colour.js';

describe('colourEnabled', () => {
  const rows: readonly (readonly [string | undefined, string | undefined, boolean, boolean])[] = [
    ['1', '1', false, true],
    ['0', undefined, true, false],
    [undefined, '1', true, false],
    [undefined, '', true, true],
    [undefined, undefined, false, false],
    [undefined, undefined, true, true],
    ['', undefined, false, false],
    ['false', undefined, true, false],
    ['true', '1', false, true],
  ];

  it.each(rows)('reads FORCE_COLOR %p and NO_COLOR %p on a terminal %p as %p', (force, no, terminal, on) => {
    const env = { FORCE_COLOR: force, NO_COLOR: no };

    expect(colourEnabled(env, terminal)).toBe(on);
  });
});

describe('paint', () => {
  it('wraps the text in the level\'s colour and a reset', () => {
    expect(paint('error', 'error:', 'default', true)).toBe('\u001b[31merror:\u001b[0m');
    expect(paint('warn', 'warn:', 'default', true)).toBe('\u001b[33mwarn:\u001b[0m');
    expect(paint('debug', 'debug:', 'default', true)).toBe('\u001b[2mdebug:\u001b[0m');
    expect(paint('api', 'api:', 'default', true)).toBe('\u001b[36mapi:\u001b[0m');
  });

  it('answers the text as it is for a level it has no colour for', () => {
    expect(paint('info' as LogLevel, 'info:', 'default', true)).toBe('info:');
  });

  it('answers the text as it is under the plain theme or with colour off', () => {
    expect(paint('warn', 'warn:', 'plain', true)).toBe('warn:');
    expect(paint('warn', 'warn:', 'default', false)).toBe('warn:');
  });
});
