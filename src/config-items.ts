/**
 * The two item shapes the schema's lists hold: a prerequisite item and
 * a module source, each read by one reader of `config-sections.ts`'s
 * {@link Reader} shape.
 *
 * Every other rule about a VALUE is `config-sections.ts`'s, and so are
 * the rules every reader keeps, items included: a kind key matched with
 * `===`, a null optional key saying nothing, and a key an item does not
 * read retained as a {@link ConfigExtra}. The shapes moved here out of
 * that module to keep it under the size cap of `context/source.md`: it
 * stood at 792 lines before the move. `config.ts` re-exports the item
 * types and kind lists, as it did while they lived there.
 *
 * The import runs one way. This module reads the reading helpers
 * `config-sections.ts` exports, and that module imports nothing from
 * this one, so the two form no cycle.
 *
 * ## The item shapes
 *
 * A prerequisite item names exactly one of `tool`, `env`, `service` or
 * `lsp`, may carry a `probe`, and on the optional tier a `reason`. That
 * is the shape of the block under "Config schema" in
 * `.rafa/specs/phase-1-installable.md`. A `reason` on a required item is a
 * key that tier does not read, so it is retained and warned about.
 *
 * A module source names exactly one of `npm`, `github` or `path`, and a
 * `github` source may carry a `ref`: the source shapes of the registry
 * example in `.rafa/specs/modules-and-addons.md`, which `modules:` lists
 * "by source". This module accepts all three. Whether a source kind can
 * be loaded is the module loader's answer, not the config's.
 */
import type {
  ConfigExtra,
  Reader,
  Reading,
  ValueAt,
} from './config-sections.js';

import {
  below,
  isMapping,
  mapReading,
  refused,
  refusedWith,
  text,
} from './config-sections.js';

/** What an item of one of the two list shapes may carry. */
interface ItemShape<K extends string> {
  /** The keys one of which, and only one, names the item. */
  kinds: readonly K[];
  /** The optional keys an item of `kind` reads beside its kind key. */
  optionalFor: (kind: K) => readonly string[];
}

/** An item read against its shape, before it takes its own type. */
interface KeyedItem<K extends string> {
  kind: K;
  /** What the kind key named. */
  named: string;
  /** Each optional key given a usable, non-null value. */
  optional: ReadonlyMap<string, string>;
}

/** The reader every string inside an item goes through. */
const itemText = text('a non-empty string');

/** Reads one item against `shape`; see the module note. */
function readKeyedItem<K extends string>(
  shape: ItemShape<K>,
  raw: unknown,
  at: ValueAt,
): Reading<KeyedItem<K>> {
  const choices = shape.kinds.join(', ');
  if (!isMapping(raw)) return refused(at, raw, `a mapping naming one of: ${choices}`);

  const entries = Object.entries(raw);
  const kinds = shape.kinds.filter((kind) => entries.some(([name]) => name === kind));
  const [kind] = kinds;
  if (kind === undefined) return refusedWith([`${at.label} names none of: ${choices}`]);
  if (kinds.length > 1) {
    const named = kinds.join(' and ');
    return refusedWith([`${at.label} names ${named}, expected exactly one of: ${choices}`]);
  }

  const optionalKeys = shape.optionalFor(kind);
  const problems: string[] = [];
  const extras: ConfigExtra[] = [];
  const optional = new Map<string, string>();
  let named: string | undefined;

  for (const [name, value] of entries) {
    if (name !== kind && !optionalKeys.includes(name)) {
      extras.push({ key: `${at.key}.${name}`, value });
      continue;
    }
    if (name !== kind && value === null) continue;

    const reading = itemText(value, below(at, `.${name}`));
    problems.push(...reading.problems);
    if (reading.value === undefined) continue;
    if (name === kind) named = reading.value;
    else optional.set(name, reading.value);
  }

  return problems.length > 0 || named === undefined
    ? { value: undefined, problems, extras }
    : { value: { kind, named, optional }, problems, extras };
}

/** The keys one of which names a prerequisite item. */
export const PREREQUISITE_KINDS = ['tool', 'env', 'service', 'lsp'] as const;

/** One of the four prerequisite kinds. */
export type PrerequisiteKind = (typeof PREREQUISITE_KINDS)[number];

/** One item of `prerequisites.required`. */
export interface PrerequisiteItem {
  /** Which of the four keys named it. */
  kind: PrerequisiteKind;
  /** What that key named: `bun`, `GITHUB_TOKEN`, a URL, `typescript`. */
  name: string;
  /** The command that proves it, or null to check presence alone. */
  probe: string | null;
}

/** One item of `prerequisites.optional`. */
export interface OptionalPrerequisiteItem extends PrerequisiteItem {
  /** Why the item helps, for the line naming it missing; or null. */
  reason: string | null;
}

/** The keys a required prerequisite item reads. */
export const REQUIRED_ITEM_KEYS: readonly string[] = [...PREREQUISITE_KINDS, 'probe'];

/** The keys an optional prerequisite item reads. */
export const OPTIONAL_ITEM_KEYS: readonly string[] = [...REQUIRED_ITEM_KEYS, 'reason'];

/** Reads one `prerequisites.required` item. */
export const requiredPrerequisite: Reader<PrerequisiteItem> = (raw, at) => {
  const shape = { kinds: PREREQUISITE_KINDS, optionalFor: () => ['probe'] };
  return mapReading(readKeyedItem(shape, raw, at), (item) => Object.freeze({
    kind: item.kind,
    name: item.named,
    probe: item.optional.get('probe') ?? null,
  }));
};

/** Reads one `prerequisites.optional` item. */
export const optionalPrerequisite: Reader<OptionalPrerequisiteItem> = (raw, at) => {
  const shape = { kinds: PREREQUISITE_KINDS, optionalFor: () => ['probe', 'reason'] };
  return mapReading(readKeyedItem(shape, raw, at), (item) => Object.freeze({
    kind: item.kind,
    name: item.named,
    probe: item.optional.get('probe') ?? null,
    reason: item.optional.get('reason') ?? null,
  }));
};

/** The keys one of which names a module source. */
export const MODULE_SOURCE_KINDS = ['npm', 'github', 'path'] as const;

/** One of the three module source kinds. */
export type ModuleSourceKind = (typeof MODULE_SOURCE_KINDS)[number];

/** One entry of `modules:`: where a module is installed from. */
export interface ModuleSource {
  /** Which of the three keys named it. */
  kind: ModuleSourceKind;
  /** What that key named: a package name, an `owner/repo`, a path. */
  location: string;
  /** The git ref beside a `github` source; null for every other. */
  ref: string | null;
}

/** The keys a module source reads, `ref` on a `github` one alone. */
export const MODULE_SOURCE_KEYS: readonly string[] = [...MODULE_SOURCE_KINDS, 'ref'];

/** Reads one `modules:` entry. */
export const moduleSource: Reader<ModuleSource> = (raw, at) => {
  const shape = {
    kinds: MODULE_SOURCE_KINDS,
    optionalFor: (kind: ModuleSourceKind) => kind === 'github'
      ? ['ref']
      : [],
  };
  return mapReading(readKeyedItem(shape, raw, at), (item) => Object.freeze({
    kind: item.kind,
    location: item.named,
    ref: item.optional.get('ref') ?? null,
  }));
};
