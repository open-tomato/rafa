/**
 * The architect cards' mappers (spec C6 to C8) over hand-built answers in
 * the columns `arch.composition` and `arch.import-flow` answer, and over
 * the stub client's fixture rows.
 */
import type { QueryResult, Scalar } from '@open-tomato/atlas-data/contract';

import { describe, expect, it } from 'bun:test';

import { COMPONENT_TONES } from './composition.js';
import { LAYER_TONES } from './graph.js';
import {
  architectureOf,
  compositionOf,
  CONFIG_PACKAGES,
  importFlowOf,
  layerOrderOf,
  layerTonesOf,
  ROSE_MIN_LINES,
  sizeRoseOf,
  UNASSIGNED,
} from './live-architecture.js';
import { resultOf, STUB_COMPOSITION, STUB_IMPORT_FLOW } from './testdata/live-client.fixture.js';

/** The columns `arch.composition` answers. */
const COMPOSITION_COLUMNS = ['path', 'package', 'layer', 'layer_rank', 'loc', 'test_loc', 'docs_loc', 'config_loc', 'fixtures_loc'] as const;

/** The columns `arch.import-flow` answers. */
const FLOW_COLUMNS = ['path', 'package', 'layer', 'layer_rank', 'imports_json'] as const;

/** An `arch.composition` answer of `rows`, asked with no window. */
function compositionAnswer(rows: readonly (readonly Scalar[])[]): QueryResult {
  return resultOf(COMPOSITION_COLUMNS, rows, { from: null, to: null });
}

/** An `arch.import-flow` answer of `rows`, asked with no window. */
function flowAnswer(rows: readonly (readonly Scalar[])[]): QueryResult {
  return resultOf(FLOW_COLUMNS, rows, { from: null, to: null });
}

describe('sizeRoseOf (C6)', () => {
  it('leaves out a folder under 1,000 lines, the five kinds summed, and keeps one at exactly 1,000', () => {
    const rose = sizeRoseOf(compositionAnswer([
      ['packages/under', null, 'core', 0, 500, 300, 100, 90, 9],
      ['packages/at', null, 'core', 0, 400, 300, 100, 100, 100],
    ]));

    expect(ROSE_MIN_LINES).toBe(1_000);
    expect(rose.map((slice) => [slice.id, slice.value])).toEqual([['packages/at', 1_000]]);
  });

  it('sums the five kinds, the largest first, each slice grouped and toned by its layer', () => {
    const rose = sizeRoseOf(STUB_COMPOSITION);

    expect(rose).toEqual([
      { id: 'packages/stub-core', label: 'stub-core', value: 1_950, group: 'core', tone: LAYER_TONES.core },
      { id: 'packages/stub-loose', label: 'stub-loose', value: 1_200, group: UNASSIGNED, tone: 'muted' },
    ]);
  });

  it('control: draws no slice over an answer with no row', () => {
    expect(sizeRoseOf(compositionAnswer([]))).toEqual([]);
  });
});

describe('compositionOf (C7)', () => {
  it('leaves a kind with no line off the outer ring, and keeps the others in kind order, toned by kind', () => {
    const { sunburst } = compositionOf(compositionAnswer([['packages/a', null, 'core', 0, 10, 0, 3, 0, 2]]));

    expect(sunburst[0]?.children).toEqual([
      { id: 'packages/a/source', label: 'source', value: 10, group: 'source', tone: COMPONENT_TONES.source },
      { id: 'packages/a/docs', label: 'docs', value: 3, group: 'docs', tone: COMPONENT_TONES.docs },
      { id: 'packages/a/fixtures', label: 'fixtures', value: 2, group: 'fixtures', tone: COMPONENT_TONES.fixtures },
    ]);
  });

  it('keeps a folder under 1,000 lines on the inner ring, leaves one with no line out, and answers the same folders as table rows with no deps count', () => {
    const { sunburst, rows } = compositionOf(STUB_COMPOSITION);

    expect(sunburst.map((node) => [node.id, node.group])).toEqual([
      ['packages/stub-core', 'core'],
      ['packages/stub-loose', UNASSIGNED],
      ['addons/stub-addon', 'addon'],
      ['packages/stub-lint', 'config'],
    ]);
    expect(rows[2]).toEqual({ id: 'addons/stub-addon', source: 300, tests: 200, docs: 0, config: 40, fixtures: 10, deps: null });
    expect(rows.map((row) => row.id)).toEqual(sunburst.map((node) => node.id));
  });

  it('places a folder no layer lists in the unassigned group, toned muted', () => {
    const { sunburst } = compositionOf(compositionAnswer([
      ['packages/listed', null, 'core', 0, 10, 0, 0, 0, 0],
      ['packages/unlisted', null, null, null, 20, 0, 0, 0, 0],
    ]));

    expect(sunburst.map((node) => [node.id, node.group, node.tone])).toEqual([
      ['packages/unlisted', UNASSIGNED, 'muted'],
      ['packages/listed', 'core', LAYER_TONES.core],
    ]);
  });
});

describe('importFlowOf (C8)', () => {
  it('orders the columns by layer_rank, unassigned last, whatever the row order', () => {
    const flow = importFlowOf(flowAnswer([
      ['packages/loose', null, null, null, '[]'],
      ['packages/top', '@open-tomato/top', 'app', 4, '[]'],
      ['packages/base', '@open-tomato/base', 'core', 1, '[]'],
    ]));

    expect(flow.layerOrder).toEqual(['core', 'app', UNASSIGNED]);
    expect(flow.nodes.map((node) => [node.id, node.group])).toEqual([
      ['packages/loose', UNASSIGNED],
      ['@open-tomato/top', 'app'],
      ['@open-tomato/base', 'core'],
    ]);
  });

  it('draws an edge from the dependency to the dependent, and marks one into an earlier layer upward', () => {
    const flow = importFlowOf(flowAnswer([
      ['packages/base', '@open-tomato/base', 'core', 0, '["@open-tomato/feature"]'],
      ['packages/feature', '@open-tomato/feature', 'feature', 1, '[]'],
      ['packages/app', '@open-tomato/app', 'app', 2, '["@open-tomato/feature","@open-tomato/base"]'],
    ]));

    expect(flow.links).toEqual([
      { source: '@open-tomato/feature', target: '@open-tomato/base', value: 1, upward: true },
      { source: '@open-tomato/feature', target: '@open-tomato/app', value: 1, upward: false },
      { source: '@open-tomato/base', target: '@open-tomato/app', value: 1, upward: false },
    ]);
  });

  it('control: an edge inside one layer is not upward', () => {
    const flow = importFlowOf(flowAnswer([
      ['packages/a', '@open-tomato/a', 'core', 0, '["@open-tomato/b"]'],
      ['packages/b', '@open-tomato/b', 'core', 0, '[]'],
    ]));

    expect(flow.links).toEqual([{ source: '@open-tomato/b', target: '@open-tomato/a', value: 1, upward: false }]);
  });

  it('leaves the lint and TypeScript config packages out, as nodes, as edges and as a column, and a package no module carries', () => {
    const flow = importFlowOf(STUB_IMPORT_FLOW);

    expect([...CONFIG_PACKAGES].sort()).toEqual(['@open-tomato/eslint-config', '@open-tomato/typescript-config']);
    expect(flow.nodes.map((node) => node.id)).toEqual(['@open-tomato/stub-addon', '@open-tomato/stub-core', '@open-tomato/stub-low', 'packages/stub-loose']);
    expect(flow.layerOrder).toEqual(['core', 'addon', UNASSIGNED]);
    expect(flow.links).toEqual([
      { source: '@open-tomato/stub-core', target: '@open-tomato/stub-addon', value: 1, upward: false },
      { source: '@open-tomato/stub-addon', target: '@open-tomato/stub-low', value: 1, upward: true },
      { source: '@open-tomato/stub-core', target: 'packages/stub-loose', value: 1, upward: false },
    ]);
  });

  it('weighs a node one more than its dependents in the flow', () => {
    const flow = importFlowOf(STUB_IMPORT_FLOW);

    expect(flow.nodes.map((node) => [node.id, node.value])).toEqual([
      ['@open-tomato/stub-addon', 2],
      ['@open-tomato/stub-core', 3],
      ['@open-tomato/stub-low', 1],
      ['packages/stub-loose', 1],
    ]);
  });

  it('refuses an import list that is not a list of package names', () => {
    expect(() => importFlowOf(flowAnswer([['packages/a', '@open-tomato/a', 'core', 0, '{"a":1}']]))).toThrow('is not a list of packages');
  });
});

describe('a replica with no layers', () => {
  /** Every folder NULL in both layer columns, as a build with no atlas.layers stamps them. */
  const composition = compositionAnswer([
    ['packages/a', '@open-tomato/a', null, null, 1_500, 0, 0, 0, 0],
    ['packages/b', '@open-tomato/b', null, null, 200, 0, 0, 0, 0],
  ]);
  const flow = flowAnswer([
    ['packages/a', '@open-tomato/a', null, null, '["@open-tomato/b"]'],
    ['packages/b', '@open-tomato/b', null, null, '[]'],
  ]);

  it('draws every module in the one unassigned column, its edges not upward', () => {
    const fields = architectureOf(composition, flow);

    expect(fields.layerOrder).toEqual([UNASSIGNED]);
    expect(fields.layerTones).toEqual({ [UNASSIGNED]: 'muted' });
    expect(fields.sankeyNodes.map((node) => node.group)).toEqual([UNASSIGNED, UNASSIGNED]);
    expect(fields.sankeyLinks).toEqual([{ source: '@open-tomato/b', target: '@open-tomato/a', value: 1, upward: false }]);
  });

  it('still draws the rose and the sunburst, every slice unassigned and muted', () => {
    const fields = architectureOf(composition, flow);

    expect(fields.sizeRose.map((slice) => [slice.id, slice.group, slice.tone])).toEqual([['packages/a', UNASSIGNED, 'muted']]);
    expect(fields.compositionSunburst.map((node) => [node.id, node.group, node.tone])).toEqual([
      ['packages/a', UNASSIGNED, 'muted'],
      ['packages/b', UNASSIGNED, 'muted'],
    ]);
  });

  it('control: an answer with no row draws no column at all', () => {
    expect(architectureOf(compositionAnswer([]), flowAnswer([]))).toEqual({
      composition: [],
      sizeRose: [],
      compositionSunburst: [],
      sankeyNodes: [],
      sankeyLinks: [],
      layerOrder: [],
      layerTones: {},
    });
  });
});

describe('layerTonesOf and layerOrderOf', () => {
  it('keeps the mock\'s tone for a layer it names, gives any other the next series tone no layer holds, and unassigned muted', () => {
    expect(layerTonesOf(['core', 'domain', 'ui', UNASSIGNED])).toEqual({
      'core': 'series-1',
      'domain': 'series-2',
      'ui': 'series-3',
      [UNASSIGNED]: 'muted',
    });
  });

  it('draws a layer past the eighth series tone muted', () => {
    const tones = layerTonesOf(Array.from({ length: 9 }, (_, index) => `layer-${index}`));

    expect(tones['layer-7']).toBe('series-8');
    expect(tones['layer-8']).toBe('muted');
  });

  it('orders layers by rank, ties by name, and adds unassigned only when a place has no layer', () => {
    expect(layerOrderOf([{ layer: 'b', rank: 1 }, { layer: 'a', rank: 1 }, { layer: 'z', rank: 0 }])).toEqual(['z', 'a', 'b']);
    expect(layerOrderOf([{ layer: 'z', rank: 0 }, { layer: UNASSIGNED, rank: null }])).toEqual(['z', UNASSIGNED]);
  });

  it('tones a layer alike on the three cards: the tones come from both answers', () => {
    const fields = architectureOf(STUB_COMPOSITION, STUB_IMPORT_FLOW);

    expect(fields.layerTones).toEqual({ config: LAYER_TONES.config, core: LAYER_TONES.core, addon: LAYER_TONES.addon, [UNASSIGNED]: 'muted' });
    for (const slice of fields.sizeRose) expect(slice.tone).toBe(fields.layerTones[slice.group ?? '']);
    for (const node of fields.sankeyNodes) expect(fields.layerTones[node.group]).toBeDefined();
  });
});
