/**
 * The page source: one result set per lens page and range, which every
 * card selects its slice from. The mock is reseeded per range, so the four
 * ranges differ; 'past-month' draws with the bake-off's seeds and gives its
 * values. The measured parts (package composition, the import graph) are
 * the same in every range.
 */
import type { DataSource, TimeRange } from '@open-tomato/atlas-ui';
import type { GraphLink, GraphNode, RoseSlice, SunburstNode } from '@open-tomato/charts';

import { BALANCE_CATALOGUE, type BalanceIndex } from './balance.js';
import { COMPOSITION_SUNBURST, PACKAGE_COMPOSITION, SIZE_ROSE, type PackageComposition } from './composition.js';
import { SANKEY_LINKS, SANKEY_NODES, WORKSPACE_LINKS, WORKSPACE_NODES } from './graph.js';
import { buildMock, MOCK_SEEDS, type MockData, type MockSeeds } from './mock.js';
import { between, seeded } from './random.js';

/** The workspace as measured on 2026-11-02: package composition and the import graph. */
export interface MeasuredWorkspace {
  readonly composition: readonly PackageComposition[];
  readonly sizeRose: readonly RoseSlice[];
  readonly compositionSunburst: readonly SunburstNode[];
  readonly members: readonly GraphNode[];
  readonly edges: readonly GraphLink[];
  readonly sankeyNodes: readonly GraphNode[];
  readonly sankeyLinks: readonly GraphLink[];
}

/** What the page source answers for one range: every card's data. */
export interface LensResult {
  readonly range: TimeRange;
  readonly mock: MockData;
  /** The balance indices with this range's values. */
  readonly balance: readonly BalanceIndex[];
  readonly workspace: MeasuredWorkspace;
}

/** How far each range's seeds sit from the bake-off's; 'past-month' is the bake-off. */
const RANGE_OFFSET: Readonly<Record<TimeRange, number>> = {
  'now': 1,
  'last-week': 2,
  'past-month': 0,
  'last-year': 3,
};

/** A prime step between two ranges' seeds. */
const SEED_STEP = 7_919;

/** How far a non-default range moves a balance index, either way. */
const BALANCE_JITTER = 0.2;

/** The delay the default source waits before it answers, so the loading status shows once. */
export const SOURCE_DELAY_MS = 400;

const WORKSPACE: MeasuredWorkspace = {
  composition: PACKAGE_COMPOSITION,
  sizeRose: SIZE_ROSE,
  compositionSunburst: COMPOSITION_SUNBURST,
  members: WORKSPACE_NODES,
  edges: WORKSPACE_LINKS,
  sankeyNodes: SANKEY_NODES,
  sankeyLinks: SANKEY_LINKS,
};

/** The seeds one range draws with. */
export function seedsOf(range: TimeRange): MockSeeds {
  const offset = RANGE_OFFSET[range] * SEED_STEP;
  return { main: MOCK_SEEDS.main + offset, extra: MOCK_SEEDS.extra + offset, tree: MOCK_SEEDS.tree + offset };
}

/** The balance catalogue with this range's values: as listed for 'past-month', moved by a seeded factor otherwise. */
function balanceOf(range: TimeRange): readonly BalanceIndex[] {
  if (RANGE_OFFSET[range] === 0) return BALANCE_CATALOGUE;
  const random = seeded(seedsOf(range).main);
  return BALANCE_CATALOGUE.map((index) => ({
    ...index,
    value: Math.round(index.value * between(random, 1 - BALANCE_JITTER, 1 + BALANCE_JITTER) * 100) / 100,
  }));
}

/** The result set for one range, computed at once. */
export function lensResultOf(range: TimeRange): LensResult {
  return { range, mock: buildMock(seedsOf(range)), balance: balanceOf(range), workspace: WORKSPACE };
}

/** A page source over the mock that answers after `delayMs`. */
export function createLensSource(delayMs: number = SOURCE_DELAY_MS): DataSource<LensResult, TimeRange> {
  return (range) => new Promise((resolve) => {
    setTimeout(() => resolve(lensResultOf(range)), delayMs);
  });
}
