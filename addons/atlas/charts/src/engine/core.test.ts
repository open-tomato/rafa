import { describe, expect, it } from 'bun:test';

import { finishOption, mix, paint, readableOn, withAlpha } from './core.js';
import { FIXED_TOKENS } from './fixtures.js';

describe('the token bridge', () => {
  it('paints a tone or a chrome token with its resolved colour', () => {
    expect(paint(FIXED_TOKENS, 'series-3')).toBe(FIXED_TOKENS['series-3']);
    expect(paint(FIXED_TOKENS, 'grid')).toBe(FIXED_TOKENS['grid']);
  });

  it('paints an unknown name as an empty string', () => {
    expect(paint(FIXED_TOKENS, 'not-a-token')).toBe('');
  });

  it('washes a colour to an alpha', () => {
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255,0,0,0.5)');
  });

  it('mixes two colours by share, clamped to the ends', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('rgba(0,0,0,1)');
    expect(mix('#000000', '#ffffff', 2)).toBe('rgba(255,255,255,1)');
  });

  it('picks the text colour that contrasts with the background', () => {
    const tokens = { ink: '#000000', surface: '#ffffff' };

    expect(readableOn(tokens, '#ffffff')).toBe('#000000');
    expect(readableOn(tokens, '#101010')).toBe('#ffffff');
  });

  it('keeps tokens distinct in the fixed map the tests use', () => {
    const colours = Object.values(FIXED_TOKENS);

    expect(new Set(colours).size).toBe(colours.length);
  });
});

describe('finishOption', () => {
  it('animates by default and when asked to', () => {
    expect(finishOption({}, undefined).animation).toBe(true);
    expect(finishOption({}, true).animation).toBe(true);
  });

  it('reads time axes in UTC, so ticks fall where the UTC labels name them', () => {
    expect(finishOption({}, undefined).useUTC).toBe(true);
  });

  it('switches animation off when animate is false', () => {
    expect(finishOption({}, false).animation).toBe(false);
  });

  it('lets a primitive override the shared options but not the text style', () => {
    const option = finishOption({ animationDuration: 10, textStyle: { fontFamily: 'x' } }, true);

    expect(option.animationDuration).toBe(10);
    expect(option.textStyle).toEqual({ fontFamily: 'sans-serif' });
  });
});
