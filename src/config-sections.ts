/**
 * The value readers behind `config.ts`: one per shape a setting takes,
 * the closed lists of values a setting accepts, and the two item shapes
 * the schema's lists hold.
 *
 * `config.ts` owns the file: its sections, its keys, the layers and how
 * they rank. For each setting it asks this module one question: is this
 * raw value one the setting accepts, and if so, what is it? Every rule
 * about a VALUE lives here, apart from the rules about KEYS, and
 * `config.ts` stays under the size cap.
 *
 * The file is `config-sections.ts` and not `config/index.ts` on purpose.
 * From `src/`, `./config.js` resolves to `src/config.ts`, and a
 * `src/config/` directory beside it would set the trap
 * `context/source.md` records for `./plan`.
 *
 * ## What a reader answers
 *
 * A {@link Reader} takes the raw value, as the YAML parser returned it
 * or as a command line passed it, and a {@link ValueAt} saying where
 * that value sits. It answers a {@link Reading}: the value, or undefined
 * with every problem named, plus any unknown key an item carried. A
 * reader never throws and never prints, because `config.ts` collects the
 * problems of every setting before it refuses, so one run names all of
 * them.
 *
 * A problem is one sentence opening with the label it was handed, so
 * one reader serves the file (`/repo/.rafa/config.yaml: tracker.default`)
 * and the command line (`command line: trackerDefault`). A list item's
 * label and key gain its index: `prerequisites.required[1]`.
 *
 * ## Rules every reader keeps
 *
 *   - Nothing is coerced. `tracker.fallback: local` is not read as
 *     `[local]`, and `tracking.all: "true"` is not read as `true`.
 *     Guessing what the operator meant is the silent choice `config.ts`
 *     refuses.
 *   - A string names something only when it holds a character other
 *     than whitespace. It is kept as written, never trimmed.
 *   - A key an item carries is matched against a list with `===`,
 *     never with `in` or an object index. The parser keeps a key spelled
 *     `toString`, `constructor` or `__proto__` as an ordinary own key,
 *     and `'toString' in item` is true for every mapping. Measured on
 *     bun 1.3.14: an item carrying `__proto__: x` beside `tool: bun`
 *     holds both as own keys, and its prototype stays `Object.prototype`.
 *   - Every list a reader answers is frozen, and so is every item in
 *     it. A value one caller holds cannot be edited for the next.
 *   - A null optional key in an item (`probe:` above a commented-out
 *     command) says nothing, as a null setting says nothing in
 *     `config.ts`. A null kind key (`- tool:`) names no tool and is
 *     refused.
 *   - A key an item does not read is retained as a {@link ConfigExtra}
 *     under its path (`prerequisites.optional[0].timeout`), for
 *     `config.ts` to warn about, never refused. That is the rule
 *     `config.ts` keeps for unknown keys, applied one level down.
 *
 * ## The item shapes
 *
 * A prerequisite item names exactly one of `tool`, `env`, `service` or
 * `lsp`, may carry a `probe`, and on the optional tier a `reason`. That
 * is the shape of the block under "Config schema" in
 * `.specs/phase-1-installable.md`. A `reason` on a required item is a
 * key that tier does not read, so it is retained and warned about.
 *
 * A module source names exactly one of `npm`, `github` or `path`, and a
 * `github` source may carry a `ref`: the source shapes of the registry
 * example in `.specs/modules-and-addons.md`, which `modules:` lists
 * "by source". This module accepts all three. Whether a source kind can
 * be loaded is the module loader's answer, not the config's.
 */

/** One key a file carried that names nothing this version reads. */
export interface ConfigExtra {
  /**
   * Its path from the top of the file: `nonesuch`, `plan.depth`,
   * `prerequisites.required[0].timeout`.
   */
  key: string;
  /**
   * The value exactly as the parser returned it. Never serialised
   * here: a YAML alias can make it cyclic.
   */
  value: unknown;
}

/** Where a value sits, as a problem and an extra name it. */
export interface ValueAt {
  /** What a problem opens with: `<file>: tracker.default`. */
  label: string;
  /** The path an unknown key inside the value is retained under. */
  key: string;
}

/** What a reader made of one raw value. */
export interface Reading<T> {
  /** The value read, or undefined when a problem refused it. */
  value: T | undefined;
  /** One sentence per problem, each opening with the label. */
  problems: readonly string[];
  /** Keys inside the value that name nothing, retained. */
  extras: readonly ConfigExtra[];
}

/** Reads one raw value; see the module note. */
export type Reader<T> = (raw: unknown, at: ValueAt) => Reading<T>;

/** A plain mapping, as the parser returns one. */
export type Mapping = Readonly<Record<string, unknown>>;

/** True for a mapping; false for a list, a scalar or null. */
export function isMapping(value: unknown): value is Mapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A value as a refusal quotes it. Never serialises a collection. */
export function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  return String(value);
}

/** The schema versions `config.ts` reads. */
export const CONFIG_VERSIONS = [1] as const;

/** One schema version `config.ts` reads. */
export type ConfigVersion = (typeof CONFIG_VERSIONS)[number];

/** Backends the effort store can be selected as. */
export const STORE_BACKENDS = ['sqlite', 'ndjson'] as const;

/** One of the two effort-store backends. */
export type StoreBackend = (typeof STORE_BACKENDS)[number];

/** How much of the plan a task session is handed, widest first. */
export const INJECT_MODES = ['full', 'stage', 'task'] as const;

/** One of the three injection modes. */
export type InjectMode = (typeof INJECT_MODES)[number];

/** How a command writes what it has to say. */
export const OUTPUT_MODES = ['text', 'json'] as const;

/** One of the two output modes. */
export type OutputMode = (typeof OUTPUT_MODES)[number];

/** The sources Claude Code's `--setting-sources` takes a subset of. */
export const CLAUDE_SETTING_SOURCES = ['user', 'project', 'local'] as const;

/** One of Claude Code's three setting sources. */
export type ClaudeSettingSource = (typeof CLAUDE_SETTING_SOURCES)[number];

/** A reading of `value` with nothing wrong. */
function accepted<T>(value: T): Reading<T> {
  return { value, problems: [], extras: [] };
}

/** A reading refusing `raw`, saying what was expected instead. */
function refused<T>(at: ValueAt, raw: unknown, expected: string): Reading<T> {
  const problem = `${at.label} is ${describeValue(raw)}, expected ${expected}`;
  return { value: undefined, problems: [problem], extras: [] };
}

/** A reading carrying `problems` alone. */
function refusedWith<T>(problems: readonly string[]): Reading<T> {
  return { value: undefined, problems, extras: [] };
}

/** `reading` with its value, when it has one, passed through `map`. */
function mapReading<T, U>(reading: Reading<T>, map: (value: T) => U): Reading<U> {
  return reading.value === undefined
    ? { ...reading, value: undefined }
    : { ...reading, value: map(reading.value) };
}

/** `at` one step down: an index (`[1]`) or a key (`.probe`). */
function below(at: ValueAt, step: string): ValueAt {
  return { label: `${at.label}${step}`, key: `${at.key}${step}` };
}

/** Accepts exactly one of `values`, compared with `===`. */
export function oneOf<T>(values: readonly T[]): Reader<T> {
  const expected = `one of: ${values.join(', ')}`;
  return (raw, at) => {
    const hit = values.find((value) => value === raw);
    return hit === undefined
      ? refused(at, raw, expected)
      : accepted(hit);
  };
}

/**
 * Accepts a string holding a character other than whitespace, kept as
 * written. `expected` names what the string is for, in a refusal.
 */
export function text(expected: string): Reader<string> {
  return (raw, at) => typeof raw === 'string' && raw.trim() !== ''
    ? accepted(raw)
    : refused(at, raw, expected);
}

/** Accepts a YAML boolean, and nothing spelled like one. */
export const flag: Reader<boolean> = (raw, at) => typeof raw === 'boolean'
  ? accepted(raw)
  : refused(at, raw, 'true or false');

/**
 * Accepts a list whose every entry `item` accepts, answered frozen.
 * Every entry is read, so a list with two unusable entries names both.
 * `expected` names the entries, in the refusal of a value that is not a
 * list.
 */
export function listOf<T>(item: Reader<T>, expected: string): Reader<readonly T[]> {
  return (raw, at) => {
    if (!Array.isArray(raw)) return refused(at, raw, `a list of ${expected}`);

    const readings = raw.map((entry: unknown, index) => item(entry, below(at, `[${index}]`)));
    const problems = readings.flatMap((reading) => reading.problems);
    const extras = readings.flatMap((reading) => reading.extras);
    if (problems.length > 0) return { value: undefined, problems, extras };

    const values = readings.flatMap((reading) => reading.value === undefined
      ? []
      : [reading.value]);
    return { value: Object.freeze(values), problems, extras };
  };
}

/**
 * Accepts a comma-separated subset of `values`, answered as a frozen
 * list in the order written. Space around a comma is allowed, since the
 * list, not the string, is what a caller acts on. An empty value, an
 * empty entry, an entry naming nothing in `values` and an entry given
 * twice are each refused: none of them is a subset spelled out.
 */
export function subsetOf<T extends string>(values: readonly T[]): Reader<readonly T[]> {
  const expected = `a comma-separated subset of: ${values.join(', ')}`;
  return (raw, at) => {
    if (typeof raw !== 'string') return refused(at, raw, expected);

    const named: T[] = [];
    for (const entry of raw.split(',')) {
      const hit = values.find((value) => value === entry.trim());
      if (hit === undefined || named.includes(hit)) return refused(at, raw, expected);
      named.push(hit);
    }
    return accepted(Object.freeze(named));
  };
}

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
