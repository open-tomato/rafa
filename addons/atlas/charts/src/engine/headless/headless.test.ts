import type { TokenName } from '../../theme/index.js';

import { describe, expect, it } from 'bun:test';

import { THEME_TOKENS, tokenName } from '../../theme/index.js';
import { LINE_SERIES, RADAR_AXES, RADAR_POLES, RADAR_SERIES, SUNBURST_NODES, SUNBURST_TONES } from '../fixtures.js';

import { formatterFor, OPTION_BUILDERS, renderToSvg, tokensFrom, valueFormatSchema } from './index.js';

/** A value for every token, distinct and fixed, as a headless caller would pass them. */
const VALUES = Object.fromEntries(THEME_TOKENS.map((token, index) => {
  const channel = (step: number): string => ((index * step + 40) % 216 + 20).toString(16).padStart(2, '0');
  return [tokenName(token), `#${channel(37)}${channel(91)}${channel(53)}`];
})) as Record<TokenName, string>;

const TOKENS = tokensFrom(VALUES);

const SIZE = { width: 480, height: 260 } as const;

const LINE_PROPS = { ariaLabel: 'Tokens per day', series: LINE_SERIES };

const RADAR_PROPS = {
  ariaLabel: 'Balance',
  axes: RADAR_AXES,
  poles: RADAR_POLES,
  series: RADAR_SERIES,
  baseline: { value: 1, label: 'baseline' },
};

/** How many `<path` elements an SVG string holds. */
function pathCount(svg: string): number {
  return svg.match(/<path\b/g)?.length ?? 0;
}

describe('tokensFrom', () => {
  it('keys every token by its name and every tone by its own, neutral reading ink-2', () => {
    expect(TOKENS['series-1']).toBe(VALUES['series-1']);
    expect(TOKENS['seq-300']).toBe(VALUES['seq-300']);
    expect(TOKENS['delta-up']).toBe(VALUES['delta-up']);
    expect(TOKENS['neutral']).toBe(VALUES['ink-2']);
    expect(TOKENS['muted']).toBe(VALUES['muted']);
  });
});

describe('OPTION_BUILDERS', () => {
  it('holds a builder for each of the fifteen primitives', () => {
    expect(Object.keys(OPTION_BUILDERS)).toHaveLength(15);
  });
});

describe('renderToSvg', () => {
  it('draws a line chart as an SVG string with one stroke per series', () => {
    const svg = renderToSvg('LineChart', LINE_PROPS, TOKENS, SIZE);

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(`width="${SIZE.width}"`);
    expect(svg).toContain(`height="${SIZE.height}"`);
    for (const entry of LINE_SERIES) {
      expect(svg).toContain(`stroke="${TOKENS[entry.tone]}"`);
    }
    expect(pathCount(svg)).toBeGreaterThan(LINE_SERIES.length);
  });

  it('draws a radar with its shape and the baseline ring', () => {
    const svg = renderToSvg('Radar', RADAR_PROPS, TOKENS, SIZE);

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(TOKENS['ink-2']);
    expect(pathCount(svg)).toBeGreaterThan(RADAR_AXES.length);
  });

  it('gives the same string for the same input, whatever was drawn before', () => {
    const first = renderToSvg('LineChart', LINE_PROPS, TOKENS, SIZE);
    renderToSvg('Radar', RADAR_PROPS, TOKENS, SIZE);
    const second = renderToSvg('LineChart', LINE_PROPS, TOKENS, SIZE);

    expect(second).toBe(first);
    expect(renderToSvg('Radar', RADAR_PROPS, TOKENS, SIZE)).toBe(renderToSvg('Radar', RADAR_PROPS, TOKENS, SIZE));
  });

  it('prefixes ids with the caller\'s prefix, or a hash that differs between drawings', () => {
    const named = renderToSvg('LineChart', LINE_PROPS, TOKENS, { ...SIZE, idPrefix: 'tokens' });
    const line = renderToSvg('LineChart', LINE_PROPS, TOKENS, SIZE);
    const radar = renderToSvg('Radar', RADAR_PROPS, TOKENS, SIZE);
    const prefixOf = (svg: string): string | undefined => /id="([a-z0-9]+)-c\d+"/.exec(svg)?.[1];

    expect(prefixOf(named)).toBe('tokens');
    expect(named).not.toMatch(/zr\d*-/);
    expect(prefixOf(line)).toMatch(/^c[0-9a-f]{8}$/);
    expect(prefixOf(radar)).not.toBe(prefixOf(line));
  });

  it('fills the drawing for height fill, as the drawing\'s own height in px would', () => {
    const sunburst = { ariaLabel: 'Composition', nodes: SUNBURST_NODES, groupTones: SUNBURST_TONES, unit: 'lines' };
    const filled = renderToSvg('Sunburst', { ...sunburst, height: 'fill' }, TOKENS, SIZE);

    expect(filled).toBe(renderToSvg('Sunburst', { ...sunburst, height: SIZE.height }, TOKENS, SIZE));
  });

  it('draws text in the caller\'s font stack', () => {
    const svg = renderToSvg('LineChart', LINE_PROPS, TOKENS, { ...SIZE, fontFamily: 'Inter' });

    expect(svg).toContain('Inter');
  });
});

describe('the headless entry', () => {
  it('carries the format spec, so a report producer writes values as a chart does', () => {
    const spec = valueFormatSchema.parse({ kind: 'duration', from: 'minutes' });

    expect(formatterFor(spec)(90)).toBe('1.5 h');
  });

  it('bundles the renderer with no React import', async () => {
    const build = await Bun.build({ entrypoints: [new URL('./index.ts', import.meta.url).pathname], target: 'node', packages: 'external' });
    const code = (await Promise.all(build.outputs.map((output) => output.text()))).join('\n');

    expect(build.success).toBe(true);
    // The renderer itself is in the bundle, not only an export list naming it.
    expect(code).toContain('renderToSVGString');
    expect(code).not.toMatch(/from\s*["']react(-dom)?(\/[^"']*)?["']/);
  });

  // Text is measured on a canvas when the page has one and estimated when it
  // has none, so a drawing with no DOM is compared with itself, not with this
  // process's, which runs under happy-dom.
  it('draws in a process with no DOM, the same string each time', () => {
    const entry = new URL('./index.ts', import.meta.url).pathname;
    const fixtures = new URL('../fixtures.ts', import.meta.url).pathname;
    const script = [
      `const { renderToSvg, tokensFrom } = await import(${JSON.stringify(entry)});`,
      `const { LINE_SERIES } = await import(${JSON.stringify(fixtures)});`,
      'if (typeof document !== \'undefined\') throw new Error(\'a DOM is present\');',
      'const values = JSON.parse(process.argv[1]);',
      `const draw = () => renderToSvg('LineChart', { ariaLabel: 'Tokens per day', series: LINE_SERIES }, tokensFrom(values), ${JSON.stringify(SIZE)});`,
      'process.stdout.write(JSON.stringify([draw(), draw()]));',
    ].join('\n');
    const child = Bun.spawnSync([process.execPath, '-e', script, JSON.stringify(VALUES)]);

    expect(child.stderr.toString()).toBe('');
    expect(child.exitCode).toBe(0);
    const [first, second] = JSON.parse(child.stdout.toString()) as [string, string];

    expect(first.startsWith('<svg')).toBe(true);
    expect(first).toContain(`stroke="${TOKENS['series-1']}"`);
    expect(second).toBe(first);
  });
});
