/**
 * Tests for `entries.ts`: the 35 metrics of spec section B4, numbered in
 * its order, with the lens and feasibility counts its table holds, every
 * metric they name served by the catalogue and every served metric named
 * by an entry. A control shows the name check can fail: an id the
 * catalogue lacks is caught.
 */
import type { CatalogueEntry } from './entries.js';
import type { Feasibility, Lens } from '@open-tomato/atlas-data/contract';

import { describe, expect, it } from 'bun:test';

import { METRIC_CATALOGUE } from './catalogue.js';
import { CATALOGUE_ENTRIES } from './entries.js';

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

  it('holds the feasibility counts of the B4 table', () => {
    const expected: Record<Feasibility, number> = { direct: 12, proxy: 14, gh: 6, collect: 3 };

    expect(countBy((entry) => entry.feasibility)).toEqual(expected);
  });

  it('names only metrics the catalogue serves', () => {
    expect(unserved(CATALOGUE_ENTRIES)).toEqual([]);
  });

  it('control: an entry naming a metric the catalogue lacks is caught', () => {
    const planted = { ...CATALOGUE_ENTRIES[0], metricIds: ['pm.milestone-completion'] } as CatalogueEntry;

    expect(unserved([planted])).toEqual(['pm.milestone-completion']);
  });

  it('names every served metric in at least one entry', () => {
    const named = new Set(CATALOGUE_ENTRIES.flatMap((entry) => entry.metricIds));

    expect(METRIC_CATALOGUE.map((metric) => metric.id).filter((id) => !named.has(id))).toEqual([]);
  });

  it('draws no entry that needs the GitHub source or a collector', () => {
    const waiting = CATALOGUE_ENTRIES.filter((entry) => entry.feasibility === 'gh' || entry.feasibility === 'collect');

    expect(waiting.flatMap((entry) => entry.metricIds)).toEqual([]);
  });

  it('gives every entry a name, a basis and a chart', () => {
    expect(CATALOGUE_ENTRIES.filter((entry) => entry.name === '' || entry.basis === '' || entry.chart === '')).toEqual([]);
  });
});
