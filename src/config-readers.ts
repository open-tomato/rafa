/**
 * The readers `config-schema.ts` builds its settings from, beyond the
 * value readers `config-sections.ts` exports whole: {@link mapOf}, and
 * the named readers the schema's settings are read through, each built
 * on `mapOf` or on `config-sections.ts`'s `text`. The readers a single
 * setting spells inline, such as `oneOf(STORE_BACKENDS)`, stay beside
 * their key in `config-schema.ts`.
 *
 * They sat in `config-schema.ts` until that module reached the 800-line
 * cap of `context/source.md`, and moved out before any setting was added
 * so a new key is not paid for by rewrapping prose. `config-sections.ts`
 * still holds every rule about a VALUE; {@link mapOf} is here rather
 * than there because what it rules on is a KEY: the names a map
 * setting's file spells below its own key. Outside the config modules
 * only `tiers/routing.test.ts` imports this file, reading a file's
 * `routing` through {@link routeTable} as the schema does.
 *
 * ## Map settings
 *
 * A map setting holds names the schema cannot list — a skill, an agent,
 * a task shape — each with a value an inner reader checks, and
 * {@link mapOf} reads one. Three readings are this module's:
 *
 *   - A name is a key the FILE spells, not one the schema knows, so it
 *     is kept in a `Map` and never in a plain object: a skill named
 *     `constructor` or `__proto__` is an ordinary name, and an object
 *     would match it against `Object.prototype` or reset the
 *     prototype. A name, like any string that names something, holds a
 *     character other than whitespace, and is kept as written.
 *   - Every entry is read, so a map with two unusable values names both,
 *     as `listOf` does for a list. An entry's label and key gain its
 *     name, `tiers.skills.tdd-guide`. A null value is handed to the
 *     inner reader like any other, which is what a map whose values
 *     include `false` needs: whether `false`, or null, means anything is
 *     the inner reader's answer.
 *   - The answer is a fresh `Map` per read, typed as a `ReadonlyMap`. A
 *     `Map` cannot be frozen the way a list is — `Object.freeze` leaves
 *     `set` working — so the promise that no caller edits a value for
 *     the next is kept by building a new one each time.
 */
import type { Reader, Reading, RouteTarget, TierPin } from './config-sections.js';

import {
  describeValue,
  isMapping,
  routeTarget,
  text,
  tierPin,
} from './config-sections.js';

/**
 * Accepts a mapping of names to values `value` accepts, answered as a
 * fresh `Map` in the order written; see "Map settings" in the module
 * note. Every entry is read, so a map with two unusable entries names
 * both. `expected` names the values, in the refusal of a value that is
 * not a mapping.
 */
export function mapOf<T>(
  value: Reader<T>,
  expected: string,
): Reader<ReadonlyMap<string, T>> {
  return (raw, at) => {
    if (!isMapping(raw)) {
      const problem = `${at.label} is ${describeValue(raw)}, expected a mapping of names to ${expected}`;
      return { value: undefined, problems: [problem], extras: [] };
    }

    const readings = Object.entries(raw).map(([name, entry]): [string, Reading<T>] => [
      name,
      name.trim() === ''
        ? {
          value: undefined,
          problems: [`${at.label} names ${JSON.stringify(name)}, expected a non-empty name`],
          extras: [],
        }
        : value(entry, { label: `${at.label}.${name}`, key: `${at.key}.${name}` }),
    ]);
    const problems = readings.flatMap(([, reading]) => reading.problems);
    const extras = readings.flatMap(([, reading]) => reading.extras);
    if (problems.length > 0) return { value: undefined, problems, extras };

    const read = new Map<string, T>();
    for (const [name, reading] of readings) {
      if (reading.value !== undefined) read.set(name, reading.value);
    }
    return { value: read, problems, extras };
  };
}

/** The reader both directory settings, `plan.dir` and `specs.dir`, share. */
export const directory: Reader<string> = text('a directory path');

/** The reader every tracker kind goes through, alone or in a list. */
export const trackerKind: Reader<string> = text('a tracker kind name');

/** The reader both `release` file settings share. */
export const releaseFile: Reader<string> = text('a file path');

/** The reader both `tiers` maps, `tiers.skills` and `tiers.agents`, share. */
export const tierPins: Reader<ReadonlyMap<string, TierPin>> = mapOf(tierPin, 'false or a tier');

/** The reader of `routing`: a task shape to an agent, or `false`. */
export const routeTable: Reader<ReadonlyMap<string, RouteTarget>> = mapOf(
  routeTarget,
  'false or an agent name',
);
