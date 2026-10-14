/**
 * One config entry and the list of them a config module exports:
 * {@link ConfigEntry}, rafa's own deep partial of the nested file shape
 * `ConfigShape` (`shape.ts`), {@link Config}, {@link defineConfig}, and
 * {@link entryOf}, which nests dotted keys into an entry.
 *
 * ## What an entry may hold
 *
 * An entry holds any part of the shape, every key at every depth
 * optional, and two more forms the merge reads:
 *
 * - `false` at an id of a keyed map (`routing`, `tiers.skills`,
 *   `tiers.agents`, `logger.modules`) overrides what an earlier entry
 *   gave that id, so `{ logger: { modules: { board: false } } }` drops
 *   what an earlier entry gave `board`. Where the map takes `false` as a
 *   value (`routing`, the `tiers` pins) the loader keeps it as one, so it
 *   also shadows a lower layer's row, as in a YAML file; where it does
 *   not (`logger.modules`) the id is removed (`config-load.ts` in
 *   `src/core/config/`). A named key takes `false` only where its own
 *   value does (`loop.retries`), never to remove it.
 * - `{ $replace: true, …rest }` at any mapping below the top replaces
 *   that mapping whole with `rest`, discarding what earlier entries put
 *   there. On a scalar or a list it is a type error, since a later
 *   entry's list replaces an earlier one whole already. Inside `rest`
 *   neither form is read again: `rest` is a plain deep partial.
 *
 * These are the rules `@open-tomato/define-config`'s `merge` reads and
 * its own `ConfigEntry` types. The type is declared here rather than
 * imported so the `./config` subpath's declaration names nothing outside
 * rafa. Its shapes follow that package's: one mapped type over every key
 * with `$replace` beside them, never the named keys intersected with a
 * keyed map's index signature, which that package's notes give as
 * letting a stray `true` past at a map id.
 *
 * ## Values
 *
 * {@link defineConfig} is the identity: it answers the very list it is
 * given and exists for its parameter type, so an editor flags a wrong
 * key or value as the file is written. {@link entryOf} builds an entry
 * from dotted keys, as `index.ts`'s `defaults` is built.
 */

import type { ConfigShape } from './shape.js';

/** A value an entry never descends into: a scalar, or a list, which replaces whole. */
type EntryLeaf = string | number | boolean | bigint | symbol | null | undefined | readonly unknown[];

/** True when `K` is an index signature's key, an id of a keyed map, rather than a named key. */
type IsMapId<K> = string extends K
  ? true
  : number extends K
    ? true
    : false;

/** The value type of `T`'s string index signature, or `never` when it has none. */
type MapValue<T> = string extends keyof T
  ? T extends { readonly [id: string]: infer V }
    ? V
    : never
  : never;

/** Every key of `T`, optional, its index signature included: the skeleton the shapes below map over. */
type Keys<T> = { [K in keyof T]?: 0 };

/** `T` with every key at every depth optional, leaves whole: what `rest` of a `$replace` holds. */
type PartialOf<T> = T extends EntryLeaf
  ? T
  : T extends object
    ? { [K in keyof T]?: PartialOf<T[K]> }
    : T;

/** Maps skeleton `S` to a replacing mapping: `$replace` itself, then a deep partial of each key. */
type ReplaceShape<S, T> = {
  [K in keyof S]: K extends '$replace'
    ? true
    : IsMapId<K> extends true
      ? PartialOf<MapValue<T>> | true | undefined
      : PartialOf<T[K & keyof T]>;
};

/**
 * `{ $replace: true, …rest }` standing in for a mapping of type `T`;
 * `never` for a leaf, so a `$replace` on a scalar or a list is refused.
 * Over a keyed map the index signature admits `true` beside each id's
 * value, since `$replace` is checked against it too.
 */
type Replace<T> = T extends EntryLeaf
  ? never
  : T extends object
    ? ReplaceShape<{ $replace: 0 } & Keys<T>, T>
    : never;

/** What an entry may set at key `K` of a mapping of type `T`. */
type EntryAt<T, K> = IsMapId<K> extends true
  ? EntryOf<MapValue<T>> | Replace<MapValue<T>> | false | undefined
  : EntryOf<T[K & keyof T]> | Replace<T[K & keyof T]>;

/** Maps skeleton `S`, with its modifiers, to the values an entry sets. */
type EntryShape<S, T> = { [K in keyof S]: EntryAt<T, K> };

/**
 * An entry for a value of type `T`: a leaf whole, a mapping key by key
 * with `false` at a map id and `$replace` below it; see the module note.
 *
 * @typeParam T - The shape, or any part of it.
 */
export type EntryOf<T> = T extends EntryLeaf
  ? T
  : T extends object
    ? EntryShape<Keys<T>, T>
    : T;

/** One config entry: a deep partial of {@link ConfigShape}; see the module note. */
export type ConfigEntry = EntryOf<ConfigShape>;

/** A config module's default export: its entries, applied in order over rafa's defaults. */
export type Config = readonly ConfigEntry[];

/**
 * Declares a config's entries. At run time the identity: it answers the
 * very list it is given, unchanged.
 *
 * @example
 * ```ts
 * export default defineConfig([{ naming: { branch: 'work/{stub}' } }]);
 * ```
 *
 * @param entries - The entries, in the order they apply.
 * @returns `entries`, the same list.
 */
export function defineConfig(entries: Config): Config {
  return entries;
}

/** One value and the path below the mapping being built that it sits at. */
type Placed = readonly [path: readonly string[], value: unknown];

/**
 * The mapping `placed` describes, every level frozen.
 *
 * @param placed - Each value with its path below this level, none empty.
 * @param above - The dotted path of this level, for a refusal to name.
 * @returns A new frozen mapping, its keys in the order first named.
 */
function nest(placed: readonly Placed[], above: string): Readonly<Record<string, unknown>> {
  const heads = [...new Set(placed.map(([[head]]) => head ?? ''))];
  return Object.freeze(Object.fromEntries(heads.map((head) => {
    const key = above === ''
      ? head
      : `${above}.${head}`;
    const under = placed.filter(([[first]]) => first === head);
    const [leaf, ...more] = under.filter(([path]) => path.length === 1);
    if (leaf === undefined) return [head, nest(under.map(([path, value]) => [path.slice(1), value]), key)];
    if (more.length > 0 || under.length > 1) throw new Error(`rafa config: ${key} is given twice, or as a value and a mapping`);
    return [head, leaf[1]];
  })));
}

/**
 * Nests dotted keys into one entry: `[['plan.inject', 'task']]` into
 * `{ plan: { inject: 'task' } }`, every mapping frozen, keys in the
 * order first named. The values are taken as given, already in the
 * file's spelling. Throws on an empty key or segment, on a key given
 * twice, and on a key that is both a value and a mapping (`a` beside
 * `a.b`).
 *
 * The answer is typed {@link ConfigEntry} on the caller's word:
 * nothing here checks a key against the shape. `index.ts`'s `defaults`
 * is built from the registry's own keys, and `index.test.ts` reads each
 * value back through its setting's reader.
 *
 * @param pairs - Each dotted key with its value.
 * @returns A new frozen entry.
 */
export function entryOf(pairs: readonly (readonly [key: string, value: unknown])[]): ConfigEntry {
  const placed = pairs.map(([key, value]): Placed => {
    const path = key.split('.');
    if (path.some((segment) => segment === '')) throw new Error(`rafa config: ${JSON.stringify(key)} is no dotted key`);
    return [path, value];
  });
  return nest(placed, '') as ConfigEntry;
}
