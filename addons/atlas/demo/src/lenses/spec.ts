/**
 * What every lens card shares: the spec defaults (the mock's source line,
 * no animation under `?still`), the plot height, which fills the box
 * inside the maximise modal, and the rule that says whether a card or a
 * tile draws on the live page (`isWired`).
 */
import type { LensField, LensResult } from '../data/source.js';
import type { CardSpec } from '@open-tomato/atlas-ui';
import type { ChartHeight } from '@open-tomato/charts';

import { isStill } from '../url.js';

/** Where the mock values come from unless the card says otherwise. */
export const MOCK_SOURCE = 'Mock data: seeded random series over the 12 weeks ending 2026-11-01, reseeded per range (src/data/mock.ts).';

/** Where the measured workspace values come from. */
export const MEASURED_SOURCE = 'Measured on 2026-11-02 from the workspace folders: lines of source, tests, docs, config and fixtures per package (src/data/composition.ts).';

/** Where a card's values come from on the live page. */
export const LIVE_SOURCE = 'Live: the Atlas API under /api/atlas, over the replica built from the project\'s effort store (src/data/live.ts).';

/** What a card or a tile that no live metric feeds says on the live page. */
export const NOT_WIRED_TITLE = 'Not wired yet';

/** A card's spec as a lens writes it: the primitive by name, the rest of the spec, the source optional. */
export type LensCardSpec = Omit<CardSpec, 'chart' | 'source' | 'animate'> & {
  readonly primitive: string;
  readonly source?: string;
};

/** Read once: the page opened with `?still` draws every card without animation. */
const ANIMATE = !isStill();

/** A full `CardSpec` from a lens card's fields. */
export function cardSpec({ primitive, source = MOCK_SOURCE, ...rest }: LensCardSpec): CardSpec {
  return { ...rest, chart: { primitive }, source, animate: ANIMATE };
}

/**
 * The plot height for where the chart draws: the card's `base` px, or
 * `'fill'` when the card hands `'fill'` (the maximise modal's box).
 */
export function plotHeight(base: number, height: ChartHeight): ChartHeight {
  return height === 'fill'
    ? 'fill'
    : base;
}

/**
 * Whether a card or a tile reading `reads` draws over `result`: always
 * over the mock; over the live source only when it names a field and no
 * field it names is marked not wired. A card that names none reads module
 * constants alone, which no live metric fills.
 */
export function isWired(result: LensResult, reads: readonly LensField[]): boolean {
  if (result.source === 'mock') return true;
  return reads.length > 0 && reads.every((field) => !result.notWired.has(field));
}
