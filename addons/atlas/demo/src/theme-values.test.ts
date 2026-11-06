/**
 * The demo's stylesheet against the library's token names: every name the
 * library reads has a light value, and the dark re-step only re-steps
 * names the library knows.
 */
import { THEME_TOKENS } from '@open-tomato/charts/theme';
import { describe, expect, it } from 'bun:test';

const STYLES = await Bun.file(new URL('./styles.css', import.meta.url)).text();

/** The custom properties a block declares, by the block's opening line. */
function declaredIn(opening: string): string[] {
  const start = STYLES.indexOf(opening);
  if (start === -1) throw new Error(`styles.css has no block opening with ${opening}`);
  const end = STYLES.indexOf('}', start);
  return [...STYLES.slice(start, end).matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? '');
}

describe('styles.css', () => {
  it('gives every library token a light value in @theme', () => {
    const light = new Set(declaredIn('@theme {'));
    const missing = THEME_TOKENS.filter((token) => !light.has(token));

    expect(missing).toEqual([]);
  });

  it('re-steps only library tokens under the dark theme', () => {
    const known = new Set<string>(THEME_TOKENS);
    const unknown = declaredIn(':root[data-theme="dark"] {').filter((token) => !known.has(token));

    expect(unknown).toEqual([]);
  });
});
