/**
 * Tests for `entries.ts`: the 35 metrics of spec section B4, numbered in
 * its order, with the lens counts its table holds and the feasibility
 * counts after D17 moved entries 1 and 25 offline, every metric they name
 * served by the catalogue and every served metric named by an entry or
 * listed as unnumbered. A control shows the name check can fail: an id
 * the catalogue lacks is caught.
 */
import type { CatalogueEntry } from './entries.js';
import type { Feasibility, Lens } from '@open-tomato/atlas-data/contract';

import { describe, expect, it } from 'bun:test';

import { METRIC_CATALOGUE } from './catalogue.js';
import { CATALOGUE_ENTRIES, UNNUMBERED_METRIC_IDS } from './entries.js';

const SERVED: ReadonlySet<string> = new Set(METRIC_CATALOGUE.map((metric) => metric.id));

/** The ids `entries` name that the catalogue does not serve. */
function unserved(entries: readonly CatalogueEntry[]): string[] {
  return entries.flatMap((entry) => entry.metricIds).filter((id) => !SERVED.has(id));
}

function countBy<K extends string>(key: (entry: CatalogueEntry) => K): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {};
  for (const entry of CATALOGUE_ENTRIES) counts[key(entry)] = (counts[key(entry)] ?? 0) + 1;
  return counts;
}

describe('CATALOGUE_ENTRIES', () => {
  it('lists the 35 metrics of section B4, numbered 1 to 35 in order', () => {
    expect(CATALOGUE_ENTRIES.map((entry) => entry.number)).toEqual(Array.from({ length: 35 }, (_, index) => index + 1));
  });

  it('holds the lens counts of the B4 table', () => {
    const expected: Record<Lens, number> = { pm: 10, architect: 8, developer: 8, qa: 9 };

    expect(countBy((entry) => entry.lens)).toEqual(expected);
  });

  it('holds the feasibility counts of the B4 table, entries 1 and 25 moved from gh to direct (D17)', () => {
    const expected: Record<Feasibility, number> = { direct: 14, proxy: 14, gh: 4, collect: 3 };

    expect(countBy((entry) => entry.feasibility)).toEqual(expected);
  });

  it('names only metrics the catalogue serves', () => {
    expect(unserved(CATALOGUE_ENTRIES)).toEqual([]);
  });

  it('control: an entry naming a metric the catalogue lacks is caught', () => {
    const planted = { ...CATALOGUE_ENTRIES[0], metricIds: ['pm.milestone-burndown'] } as CatalogueEntry;

    expect(unserved([planted])).toEqual(['pm.milestone-burndown']);
  });

  it('names every served metric in at least one entry, or as one no B4 row names', () => {
    const named = new Set([...CATALOGUE_ENTRIES.flatMap((entry) => entry.metricIds), ...UNNUMBERED_METRIC_IDS]);

    expect(METRIC_CATALOGUE.map((metric) => metric.id).filter((id) => !named.has(id))).toEqual([]);
  });

  it('lists as unnumbered only served metrics that no entry names', () => {
    const named = new Set(CATALOGUE_ENTRIES.flatMap((entry) => entry.metricIds));

    expect(UNNUMBERED_METRIC_IDS.filter((id) => !SERVED.has(id) || named.has(id))).toEqual([]);
  });

  it('draws no entry that needs a collector, and each gh entry only by metrics labelled gh', () => {
    const collect = CATALOGUE_ENTRIES.filter((entry) => entry.feasibility === 'collect');
    const github = CATALOGUE_ENTRIES.filter((entry) => entry.feasibility === 'gh');
    const feasibilityOf = new Map(METRIC_CATALOGUE.map((metric) => [metric.id, metric.feasibility]));

    expect(collect.flatMap((entry) => entry.metricIds)).toEqual([]);
    expect(github.map((entry) => [entry.number, entry.metricIds])).toEqual([
      [22, ['dev.pr-cycle-time']], [23, []], [29, ['qa.resolution-time']], [33, ['qa.defect-age']],
    ]);
    expect(github.flatMap((entry) => entry.metricIds).every((id) => feasibilityOf.get(id) === 'gh')).toBe(true);
  });

  it('draws entries 1 and 25 offline, by the board metrics (D17)', () => {
    const drawn = CATALOGUE_ENTRIES.filter((entry) => entry.number === 1 || entry.number === 25);

    expect(drawn.map((entry) => [entry.feasibility, entry.metricIds])).toEqual([
      ['direct', ['pm.milestone-completion']], ['direct', ['dev.wip']],
    ]);
  });

  it('gives every entry a name, a basis and a chart', () => {
    expect(CATALOGUE_ENTRIES.filter((entry) => entry.name === '' || entry.basis === '' || entry.chart === '')).toEqual([]);
  });
});
