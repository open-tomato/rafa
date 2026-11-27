/**
 * What every lens card shares: the spec defaults (the mock's source line,
 * no animation under `?still`), the plot height, which fills the box
 * inside the maximise modal, the rule that says whether a card or a
 * tile draws on the live page (`isWired`), and the note a wired card
 * shows there (`liveNoteOf`).
 */
import type { FieldMeta, LensField, LensResult, WorkspaceCard } from '../data/source.js';
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

/**
 * What a tile whose catalogue entry is `collect` says on the live page,
 * before the collector it names: rafa collects nothing it could read, so
 * no metric will feed it until the collector exists. Distinct from
 * `NOT_WIRED_TITLE` (Q1 of the data-integration spec).
 */
export const NEEDS_COLLECTOR_TITLE = 'Needs a collector';

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
 * The note a wired card shows on the live page: per metric behind
 * `reads`, its proxy note when it is a proxy, then the answer's row
 * count, so a thin reading (three red runs in 303) says how little stands
 * behind it. A workspace card naming its `card` reads that card's own
 * meta (`workspaceMeta`) in place of the fields'. Undefined over the
 * mock, or when no field read has a meta.
 */
export function liveNoteOf(result: LensResult, reads: readonly LensField[], card?: WorkspaceCard): string | undefined {
  if (result.source === 'mock') return undefined;
  const own = card === undefined
    ? undefined
    : result.workspaceMeta.get(card);
  const metas: readonly FieldMeta[] = own === undefined
    ? reads.flatMap((field) => {
      const meta = result.fieldMeta.get(field);
      return meta === undefined
        ? []
        : [meta];
    })
    : [own];
  const metrics = [...new Set(metas.map((meta) => meta.metricId))];
  if (metrics.length === 0) return undefined;
  return metrics.map((metricId) => {
    const meta = metas.find((entry) => entry.metricId === metricId);
    const rows = `${meta?.rowCount ?? 0} ${meta?.rowCount === 1
      ? 'row'
      : 'rows'} behind it (${metricId}).`;
    return meta?.proxyNote === undefined
      ? rows
      : `Proxy: ${meta.proxyNote} ${rows}`;
  }).join(' ');
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
