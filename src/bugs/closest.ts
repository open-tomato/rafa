/**
 * The names closest to a value a person typed (#951), for a refusal that
 * says "closest: billing" beside the name it turns down.
 *
 * Names here are single words: a module, an action, a place. So the
 * measure is edits between spellings ({@link editDistance}), never the
 * shared words `src/errors/match.ts` counts for a cause written as a
 * sentence. A name further than half the value's length, and further than
 * {@link MIN_REACH} edits, is no suggestion: it is another word.
 */

/** The fewest edits a suggestion may be away, whatever the value's length. */
const MIN_REACH = 2;

/** How many names a refusal shows. */
export const CLOSEST_LIMIT = 3;

/** The single-character inserts, deletes and swaps that turn `a` into `b`. */
export function editDistance(a: string, b: string): number {
  const target = [...b];
  const first = Array.from({ length: target.length + 1 }, (_, index) => index);
  const last = [...a].reduce((previous, charA, row) => target.reduce(
    (current, charB, column) => {
      const swap = previous[column]! + (charA === charB
        ? 0
        : 1);
      return [...current, Math.min(previous[column + 1]! + 1, current[column]! + 1, swap)];
    },
    [row + 1],
  ), first);
  return last[target.length]!;
}

/**
 * The `names` nearest `value` by edits, nearest first and by name where
 * two tie, `limit` at most. See the module note for how far is too far.
 */
export function closestNames(value: string, names: readonly string[], limit: number = CLOSEST_LIMIT): readonly string[] {
  const reach = Math.max(MIN_REACH, Math.floor(value.length / 2));
  return names
    .map((name) => ({ name, edits: editDistance(value, name) }))
    .filter(({ edits }) => edits <= reach)
    .sort((left, right) => left.edits - right.edits || left.name.localeCompare(right.name))
    .slice(0, limit)
    .map(({ name }) => name);
}
