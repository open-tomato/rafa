/**
 * The page bundles: `Bun.build` over `index.html` with the Tailwind plugin
 * (what `Bun.serve` runs on request) succeeds, and the stylesheet holds
 * classes from the demo's own variants and from both libraries.
 */
import tailwind from 'bun-plugin-tailwind';
import { describe, expect, it } from 'bun:test';

describe('bun build src/index.html', () => {
  it('bundles the page, its script and its compiled stylesheet', async () => {
    const output = await Bun.build({ entrypoints: [new URL('./index.html', import.meta.url).pathname], plugins: [tailwind], target: 'browser' });
    const css = output.outputs.find((artifact) => artifact.path.endsWith('.css'));
    const text = await css?.text() ?? '';

    expect(output.success).toBe(true);
    expect(output.outputs.some((artifact) => artifact.path.endsWith('.js'))).toBe(true);
    expect(text).toContain('bg-pole-ship-core');
    expect(text).toContain('max-w-6xl');
    expect(text).toContain('bg-grid\\/60');
  }, 30_000);
});
