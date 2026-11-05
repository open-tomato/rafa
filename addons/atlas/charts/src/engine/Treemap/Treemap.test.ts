import type { TreemapProps } from '../../seam/types.js';

import { describe, expect, it } from 'bun:test';

import { readableOn, withAlpha } from '../core.js';
import { FIXED_TOKENS, seriesOf, TREEMAP_NODES, TREEMAP_TONES } from '../fixtures.js';

import { buildOption } from './Treemap.option.js';

const base: TreemapProps = { ariaLabel: 'Lines by module', nodes: TREEMAP_NODES, groupTones: TREEMAP_TONES, unit: 'lines' };

type Leaf = { id: string; name: string; value: number; itemStyle: { color: string }; label: { color: string } };

describe('Treemap option', () => {
  it('draws one treemap series with a leaf per node, carrying its id and value', () => {
    const [treemap] = seriesOf(buildOption(base, FIXED_TOKENS));
    const leaves = treemap?.data as Leaf[];

    expect(treemap?.type).toBe('treemap');
    expect(leaves.map((leaf) => leaf.id)).toEqual(TREEMAP_NODES.map((node) => node.id));
    expect(leaves[0]?.value).toBe(9_800);
  });

  it('fills each leaf with its group tone at 85%', () => {
    const [treemap] = seriesOf(buildOption(base, FIXED_TOKENS));
    const [core, , , board] = treemap?.data as Leaf[];

    expect(core?.itemStyle.color).toBe(withAlpha(FIXED_TOKENS['series-1'] ?? '', 0.85));
    expect(board?.itemStyle.color).toBe(withAlpha(FIXED_TOKENS['series-2'] ?? '', 0.85));
  });

  it('picks the label colour that reads on the fill', () => {
    const [treemap] = seriesOf(buildOption(base, FIXED_TOKENS));
    const [core] = treemap?.data as Leaf[];

    expect(core?.label.color).toBe(readableOn(FIXED_TOKENS, FIXED_TOKENS['series-1'] ?? ''));
  });

  it('falls back to the neutral tone for a group with no tone', () => {
    const [treemap] = seriesOf(buildOption({ ...base, groupTones: {} }, FIXED_TOKENS));
    const [core] = treemap?.data as Leaf[];

    expect(core?.itemStyle.color).toBe(withAlpha(FIXED_TOKENS['neutral'] ?? '', 0.85));
  });

  it('separates nodes with a 2px gap and hides the breadcrumb', () => {
    const [treemap] = seriesOf(buildOption(base, FIXED_TOKENS));

    expect((treemap?.itemStyle as { gapWidth: number }).gapWidth).toBe(2);
    expect(treemap?.breadcrumb).toEqual({ show: false });
    expect(treemap?.roam).toBe(false);
  });
});
