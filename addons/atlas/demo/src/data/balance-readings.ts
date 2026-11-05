/**
 * The reading beside the balance radar: each pole's level (low, mid, high)
 * from the mean of its switched-on indices, a name for the three-level
 * combination, and a note for any single index on a marked trend.
 */
import type { BalanceIndex, PoleId } from './balance.js';

export type Level = 'low' | 'mid' | 'high';

/** Below `LOW_BELOW` is low, above `HIGH_ABOVE` is high, between is mid; a ±15% band around the usual. */
export const LOW_BELOW = 0.85;
export const HIGH_ABOVE = 1.15;

export const LEVEL_LEGEND: Record<Level, string> = {
  low: `under ${LOW_BELOW}×`,
  mid: `${LOW_BELOW}× to ${HIGH_ABOVE}×`,
  high: `over ${HIGH_ABOVE}×`,
};

export type PoleLevels = Record<PoleId, Level>;

export function levelOf(value: number): Level {
  if (value < LOW_BELOW) return 'low';
  if (value > HIGH_ABOVE) return 'high';
  return 'mid';
}

/** The mean of a pole's enabled indices, or 1 (as usual) when none is on. */
export function poleMean(catalogue: readonly BalanceIndex[], enabled: ReadonlySet<string>, pole: PoleId): number {
  const values = catalogue.filter((index) => index.pole === pole && enabled.has(index.id)).map((index) => index.value);
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 1;
}

export function poleLevels(catalogue: readonly BalanceIndex[], enabled: ReadonlySet<string>): PoleLevels {
  return {
    shipping: levelOf(poleMean(catalogue, enabled, 'shipping')),
    failing: levelOf(poleMean(catalogue, enabled, 'failing')),
    foundation: levelOf(poleMean(catalogue, enabled, 'foundation')),
  };
}

export interface Reading {
  name: string;
  text: string;
}

type Pattern = Partial<PoleLevels>;

interface ReadingRule { when: Pattern; reading: Reading }

/** First match wins; a key left out of `when` matches any level. */
export const READING_RULES: ReadingRule[] = [
  { when: { shipping: 'high', failing: 'high', foundation: 'low' }, reading: { name: 'Sprint on credit', text: 'Shipping fast, fallout rising and the base starved: the week the fire is being paid for later.' } },
  { when: { shipping: 'high', failing: 'high' }, reading: { name: 'Push with cover', text: 'Shipping and fallout both up while the base holds; the fire is the thing to watch next week.' } },
  { when: { shipping: 'high', failing: 'low', foundation: 'high' }, reading: { name: 'Compounding', text: 'More shipped, less burning and the base funded: the investment is paying out.' } },
  { when: { shipping: 'high', failing: 'low', foundation: 'low' }, reading: { name: 'Harvest', text: 'Shipping on past investment with a quiet fire; the base is not being paid this week.' } },
  { when: { shipping: 'high' }, reading: { name: 'Shipping week', text: 'More shipped than usual with the fire and the base near usual.' } },
  { when: { shipping: 'low', failing: 'high' }, reading: { name: 'Firefight', text: 'Little shipped and the fire up: repair is eating the week.' } },
  { when: { failing: 'high' }, reading: { name: 'Leaking', text: 'Usual shipping with the fire up: fallout is outpacing what lands.' } },
  { when: { shipping: 'low', failing: 'low', foundation: 'high' }, reading: { name: 'Rebuilding', text: 'Little shipped, a quiet fire and the base funded: an investment week.' } },
  { when: { shipping: 'low', failing: 'low', foundation: 'low' }, reading: { name: 'Quiet week', text: 'Everything under usual: a holiday, a stall, or a week spent elsewhere.' } },
  { when: { shipping: 'low' }, reading: { name: 'Stalled', text: 'Less shipped than usual with nothing else moving to explain it.' } },
  { when: { failing: 'low', foundation: 'high' }, reading: { name: 'Hardening', text: 'The fire down and the base up: the usual output on firmer ground.' } },
  { when: { shipping: 'mid', failing: 'mid', foundation: 'mid' }, reading: { name: 'As usual', text: 'Every pole within its usual band: a round week.' } },
];

export const DEFAULT_READING: Reading = { name: 'Mixed', text: 'No pole dominates; read the notes for the index that moved.' };

/** A note for one index on a marked trend, shown under the reading. */
interface IndexNote { id: string; level: Level; text: string }

export const INDEX_NOTES: IndexNote[] = [
  { id: 'regressions', level: 'high', text: 'Own fallout drives the fire: the bugs are ours, not inherited.' },
  { id: 'red-ci', level: 'high', text: 'CI is red more than usual; the pipeline is part of the fire.' },
  { id: 'blocked', level: 'high', text: 'Sessions block or repeat more than usual; the pile is dragging.' },
  { id: 'docs-share', level: 'low', text: 'Docs are drifting: fewer doc changes than usual while code moves.' },
  { id: 'refactor-share', level: 'low', text: 'Refactor and chore minutes are down: the base is being skipped.' },
  { id: 'releases', level: 'high', text: 'More releases than usual; check that each one carried a fragment.' },
  { id: 'plan-done', level: 'low', text: 'Plans are starting faster than they finish.' },
];

function matches(pattern: Pattern, levels: PoleLevels): boolean {
  return (Object.keys(pattern) as PoleId[]).every((pole) => pattern[pole] === levels[pole]);
}

export interface BalanceReading {
  levels: PoleLevels;
  means: Record<PoleId, number>;
  reading: Reading;
  notes: string[];
}

export function readBalance(catalogue: readonly BalanceIndex[], enabled: ReadonlySet<string>): BalanceReading {
  const levels = poleLevels(catalogue, enabled);
  const means = {
    shipping: poleMean(catalogue, enabled, 'shipping'),
    failing: poleMean(catalogue, enabled, 'failing'),
    foundation: poleMean(catalogue, enabled, 'foundation'),
  };
  const reading = READING_RULES.find((rule) => matches(rule.when, levels))?.reading ?? DEFAULT_READING;
  const notes = INDEX_NOTES
    .filter((note) => enabled.has(note.id) && levelOf(catalogue.find((index) => index.id === note.id)?.value ?? 1) === note.level)
    .map((note) => note.text);
  return { levels, means, reading, notes };
}
