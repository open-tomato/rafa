/**
 * The series kinds a weekly stacked card draws: the mock's fixed list, or
 * on the live page the groups the answer names. A live answer can name a
 * group the mock's list lacks (`machine`, a route such as `repaired`, or
 * `unknown` for a NULL group), and a fixed list would drop it from the
 * chart and the table.
 */
import type { Kind } from '../data/mock.js';
import type { ChartTone } from '@open-tomato/charts';

/** The tones a group the known list lacks takes, in order; past the last, `muted`. */
const EXTRA_TONES: readonly ChartTone[] = ['series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6', 'series-7', 'series-8'];

/**
 * The kinds of `rows`: each of `known` some row names, in its order, then
 * each other group in the order the rows first name it, labelled by its
 * id and toned with the first series tone no kind holds yet.
 */
export function kindsOf(rows: readonly Readonly<Record<string, number>>[], known: readonly Kind[]): Kind[] {
  const named = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const kept = known.filter((kind) => named.includes(kind.id));
  const extras = named.filter((id) => !known.some((kind) => kind.id === id));
  const free = EXTRA_TONES.filter((tone) => !kept.some((kind) => kind.tone === tone));
  return [...kept, ...extras.map((id, index) => ({ id, label: id, tone: free[index] ?? 'muted' }))];
}
