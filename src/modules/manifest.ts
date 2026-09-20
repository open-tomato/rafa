/**
 * The `rafa` manifest a module's `package.json` carries, its schema, and
 * {@link validateManifest}, which reads one and names every failure.
 *
 * `.rafa/specs/modules-and-addons.md` gives the manifest under "Module
 * manifest" and makes its check the first step of "Validation at install
 * and enable": the schema, `manifestVersion`, `requires.rafa` against the
 * running version, and the port versions, each with a named failure and
 * nothing silent. This module is that step and nothing after it. Whether
 * an entry file resolves and exports its shape (step 2), whether two
 * modules collide (step 5), and which modules are loaded at all are the
 * loader's, never answered here.
 *
 * ## What a manifest holds
 *
 *   - `manifestVersion`: exactly `1`, and nothing spelled like it. A
 *     manifest naming any other version is answered with that one
 *     problem alone, because its other keys follow a schema this module
 *     cannot read.
 *   - `types`: a non-empty list of the feature types in the spec's table,
 *     each given once. `learning` is refused by name: the spec closes
 *     that port to third parties, so no module provides a learning
 *     source.
 *   - `provides`: one entry per listed type, read by that type's shape.
 *     `tracker`, `store` and `planner` name a `kind` and an `entry`;
 *     `output` adds `channels`, a non-empty list of the spec's channels;
 *     `commands` names an `entry`; `skills` and `agents` are a directory
 *     path; `mcp` is a non-empty list of servers, each a `name` unique in
 *     the list, a `command`, and optional string `args`.
 *   - `requires`: `rafa`, a version range the running version must
 *     satisfy, and `ports`, the version of each port the module
 *     implements. Every listed type that is a port (`tracker`, `store`,
 *     `planner`, `output`) states its version, and a stated version core
 *     does not serve is refused naming both numbers.
 *   - `prerequisites` and `source`, both optional: the `required` and
 *     `optional` item lists `.rafa/config.yaml` reads, through the same
 *     readers, and a non-empty string.
 *
 * `types` is the declaration the rest is held to. A `provides` entry or a
 * `requires.ports` version for a type `types` does not list is refused,
 * as is a listed type with no entry. The spec's own example lists
 * `tracker` and `commands` and provides six entries, so its `provides`
 * is refused four times; `manifest.test.ts` spells that reading. Those
 * cross checks run only when `types` itself reads clean, since a list
 * with a failure in it says nothing reliable about what a module meant.
 *
 * ## Strict keys
 *
 * A key the schema does not name is a refusal at every level, never a
 * warning. `.rafa/config.yaml` warns about an unknown key because an
 * operator edits it by hand between runs. A manifest is published, and a
 * misspelt `provide` accepted with a warning would ship a module whose
 * adapters never register. The one reading kept from the config readers
 * is a prerequisite item's unread key, which those readers retain and
 * this module turns into a problem.
 *
 * Keys are matched against closed lists with `===`, and values taken
 * through `Object.entries` into a `Map`, never with `in` or an index into
 * the manifest. `JSON.parse` keeps a key spelled `__proto__` as an own
 * key and leaves the object's prototype alone, so `__proto__` and
 * `constructor` are keys like any other, and each is refused as one the
 * schema does not name. The manifest answered is built from the closed
 * lists alone and frozen throughout.
 *
 * ## Version ranges, measured on bun 1.3.14
 *
 * `Bun.semver.satisfies` answers `true` for ranges that are no range:
 * `"garbage"`, `""`, `"latest"`, `"x.y.z"`, `">=abc"` and
 * `">=0.1.0,<1"` all satisfied `0.1.0`. So a range is first held to a
 * grammar here and only then handed to it: one or more alternatives
 * joined by `||`, each one or more comparators separated by whitespace,
 * a comparator being an optional `>=`, `<=`, `>`, `<`, `=`, `^` or `~`
 * written against a version of one to three whole numbers. No space sits
 * between an operator and its version, which keeps the pattern free of
 * two adjacent whitespace runs to backtrack across, and a prerelease, a
 * wildcard and a tag are refused. Over ranges the grammar accepts, bun
 * answered as npm does (`^0.2` refuses `0.3.0`, `>0.1` refuses `0.1.1`),
 * and `manifest.test.ts` pins a table of those answers.
 *
 * ## Seams
 *
 * The running version is `package.json`'s `version`, imported by name as
 * `src/commands/describe.ts` imports it, and the served port versions
 * are `PORT_VERSIONS` from `src/adapters/registry.ts`. Both reach
 * {@link validateManifest} through {@link ManifestSeams}, so a case holds
 * a module against a version core does not run.
 */
import type {
  OptionalPrerequisiteItem,
  PrerequisiteItem,
  Reading,
  ValueAt,
} from '../config-sections.js';
import type { PortType, PortVersions } from '../ports/index.js';

import { version as RUNNING_VERSION } from '../../package.json';
import { PORT_VERSIONS } from '../adapters/registry.js';
import {
  describeValue,
  isMapping,
  listOf,
  optionalPrerequisite,
  requiredPrerequisite,
} from '../config-sections.js';

/** The manifest version this module reads. */
export const MANIFEST_VERSION = 1;

/** The feature types of the spec's table, in its order. */
export const FEATURE_TYPES = ['output', 'tracker', 'store', 'planner', 'learning', 'skills', 'agents', 'mcp', 'commands'] as const;

/** One feature type. */
export type FeatureType = (typeof FEATURE_TYPES)[number];

/** A feature type a third-party module may list: every one but `learning`. */
export type ModuleFeatureType = Exclude<FeatureType, 'learning'>;

/** The channels an `output` entry may claim. */
export const OUTPUT_CHANNELS = ['stdout', 'file', 'socket', 'mqtt', 'kafka', 'tui'] as const;

/** One output channel. */
export type OutputChannel = (typeof OUTPUT_CHANNELS)[number];

/** A `tracker`, `store` or `planner` entry: the kind a config selects, and the file implementing it. */
export interface AdapterProvision {
  readonly kind: string;
  readonly entry: string;
}

/** An `output` entry: an adapter, and the channels it writes to. */
export interface OutputProvision extends AdapterProvision {
  readonly channels: readonly OutputChannel[];
}

/** A `commands` entry: the file whose default export is the module's `RafaCommand[]`. */
export interface CommandsProvision {
  readonly entry: string;
}

/** One `mcp` server a module declares for the task session. */
export interface McpServer {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
}

/** What a module provides, one entry per listed type. */
export interface ManifestProvides {
  readonly output?: OutputProvision;
  readonly tracker?: AdapterProvision;
  readonly store?: AdapterProvision;
  readonly planner?: AdapterProvision;
  readonly skills?: string;
  readonly agents?: string;
  readonly mcp?: readonly McpServer[];
  readonly commands?: CommandsProvision;
}

/** A manifest that passed {@link validateManifest}. */
export interface ModuleManifest {
  readonly manifestVersion: typeof MANIFEST_VERSION;
  readonly types: readonly ModuleFeatureType[];
  readonly provides: ManifestProvides;
  readonly requires: {
    /** The range the running rafa satisfied, as written. */
    readonly rafa: string;
    /** The version of each port the module implements. */
    readonly ports: Readonly<Partial<Record<PortType, number>>>;
  };
  readonly prerequisites: {
    readonly required: readonly PrerequisiteItem[];
    readonly optional: readonly OptionalPrerequisiteItem[];
  };
  /** Where the module's source lives, or null. */
  readonly source: string | null;
}

/** What a manifest is held against: the rafa running, and the port versions it serves. */
export interface ManifestSeams {
  /** A plain `major.minor.patch` version. */
  readonly rafaVersion: string;
  readonly portVersions: Readonly<PortVersions>;
}

/** The manifest, or every problem found in it. */
export type ManifestValidation =
  | { readonly ok: true; readonly manifest: ModuleManifest }
  | { readonly ok: false; readonly problems: readonly string[] };

/** The running rafa and the port versions it serves. */
export const RUNNING_MANIFEST_SEAMS: ManifestSeams = Object.freeze({
  rafaVersion: RUNNING_VERSION,
  portVersions: PORT_VERSIONS,
});

/** A value read, or undefined beside the problems naming why not. */
interface Checked<T> {
  readonly value: T | undefined;
  readonly problems: readonly string[];
}

/** Reads one value at a label. */
type Check<T> = (raw: unknown, label: string) => Checked<T>;

/** A mapping's values under the keys the schema names, and a problem for each other key and each missing one. */
interface Fields {
  readonly fields: ReadonlyMap<string, unknown>;
  readonly problems: readonly string[];
}

/** The keys a manifest reads. */
const MANIFEST_KEYS: readonly string[] = ['manifestVersion', 'types', 'provides', 'requires', 'prerequisites', 'source'];

/** A plain release version, as the running version must be. */
const RELEASE_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

/** One comparator of a range; see the module note. */
const COMPARATOR = String.raw`(?:>=|<=|>|<|=|\^|~)?(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,2}`;

/** One `||` alternative of a range: comparators separated by whitespace. */
const ALTERNATIVE_PATTERN = new RegExp(String.raw`^\s*${COMPARATOR}(?:\s+${COMPARATOR})*\s*$`);

/** What a refused range was expected to be. */
const RANGE_EXPECTED = 'a version range such as ">=0.2 <1"';

/** Why `learning` is refused, wherever a manifest names it. */
const LEARNING_CLOSED = 'which core closes to third parties: a module never provides a learning source';

/** A checked value with nothing wrong. */
function passed<T>(value: T): Checked<T> {
  return { value, problems: [] };
}

/** A checked value refused for `problems`. */
function failed<T>(...problems: string[]): Checked<T> {
  return { value: undefined, problems };
}

/** The refusal of `raw` at `label`, saying what was expected. An empty list is named as one. */
function expected(label: string, raw: unknown, what: string): string {
  const described = Array.isArray(raw) && raw.length === 0
    ? 'an empty list'
    : describeValue(raw);
  return `${label} is ${described}, expected ${what}`;
}

/** Reads `raw` as a mapping of `keys` alone; see {@link Fields}. */
function readFields(raw: unknown, label: string, keys: readonly string[], required: readonly string[]): Fields {
  if (!isMapping(raw)) return { fields: new Map(), problems: [expected(label, raw, 'a mapping')] };

  const fields = new Map<string, unknown>();
  const problems: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (keys.includes(key)) fields.set(key, value);
    else problems.push(`${label} carries ${JSON.stringify(key)}, which is none of: ${keys.join(', ')}`);
  }
  for (const key of required) {
    if (!fields.has(key)) problems.push(`${label}.${key} is missing`);
  }
  return { fields, problems };
}

/** `check` over the value under `key`, or no value and no problem when there is none: a missing key is named by {@link readFields}. */
function field<T>(fields: ReadonlyMap<string, unknown>, key: string, label: string, check: Check<T>): Checked<T> {
  return fields.has(key)
    ? check(fields.get(key), `${label}.${key}`)
    : failed();
}

/** Accepts a string holding a character other than whitespace, kept as written. */
function readText(raw: unknown, label: string, what: string): Checked<string> {
  return typeof raw === 'string' && raw.trim() !== ''
    ? passed(raw)
    : failed(expected(label, raw, what));
}

/** {@link readText} expecting a non-empty string. */
const nonEmpty: Check<string> = (raw, label) => readText(raw, label, 'a non-empty string');

/**
 * Accepts a non-empty list of distinct `values`. `refusal` may refuse a
 * value the list holds, answering the sentence that follows its label.
 */
function readChoices<T>(
  raw: unknown,
  label: string,
  values: readonly T[],
  refusal: (value: T) => string | undefined = () => undefined,
): Checked<readonly T[]> {
  const choices = values.join(', ');
  if (!Array.isArray(raw) || raw.length === 0) return failed(expected(label, raw, `a non-empty list of: ${choices}`));

  const chosen: T[] = [];
  const problems: string[] = [];
  raw.forEach((entry: unknown, index) => {
    const at = `${label}[${index}]`;
    const hit = values.find((value) => value === entry);
    const refused = hit === undefined
      ? undefined
      : refusal(hit);
    if (hit === undefined) problems.push(expected(at, entry, `one of: ${choices}`));
    else if (refused !== undefined) problems.push(`${at} ${refused}`);
    else if (chosen.includes(hit)) problems.push(`${at} is ${describeValue(entry)}, listed already`);
    else chosen.push(hit);
  });
  return problems.length > 0
    ? failed(...problems)
    : passed(Object.freeze(chosen));
}

/** True for every feature type but `learning`. */
function isModuleType(type: FeatureType): type is ModuleFeatureType {
  return type !== 'learning';
}

/** Reads `types`, refusing `learning` by name. */
const readTypes: Check<readonly ModuleFeatureType[]> = (raw, label) => {
  const read = readChoices(raw, label, FEATURE_TYPES, (type) => isModuleType(type)
    ? undefined
    : `is "learning", ${LEARNING_CLOSED}`);
  return read.value === undefined
    ? failed(...read.problems)
    : passed(Object.freeze(read.value.filter(isModuleType)));
};

/** Reads a `tracker`, `store` or `planner` entry. */
const readAdapter: Check<AdapterProvision> = (raw, label) => {
  const { fields, problems } = readFields(raw, label, ['kind', 'entry'], ['kind', 'entry']);
  const kind = field(fields, 'kind', label, nonEmpty);
  const entry = field(fields, 'entry', label, nonEmpty);
  const all = [...problems, ...kind.problems, ...entry.problems];
  return all.length > 0 || kind.value === undefined || entry.value === undefined
    ? failed(...all)
    : passed(Object.freeze({ kind: kind.value, entry: entry.value }));
};

/** Reads an `output` entry. */
const readOutput: Check<OutputProvision> = (raw, label) => {
  const keys = ['kind', 'entry', 'channels'];
  const { fields, problems } = readFields(raw, label, keys, keys);
  const kind = field(fields, 'kind', label, nonEmpty);
  const entry = field(fields, 'entry', label, nonEmpty);
  const channels = field(fields, 'channels', label, (value, at) => readChoices(value, at, OUTPUT_CHANNELS));
  const all = [...problems, ...kind.problems, ...entry.problems, ...channels.problems];
  return all.length > 0 || kind.value === undefined || entry.value === undefined || channels.value === undefined
    ? failed(...all)
    : passed(Object.freeze({ kind: kind.value, entry: entry.value, channels: channels.value }));
};

/** Reads a `commands` entry. */
const readCommands: Check<CommandsProvision> = (raw, label) => {
  const { fields, problems } = readFields(raw, label, ['entry'], ['entry']);
  const entry = field(fields, 'entry', label, nonEmpty);
  const all = [...problems, ...entry.problems];
  return all.length > 0 || entry.value === undefined
    ? failed(...all)
    : passed(Object.freeze({ entry: entry.value }));
};

/** Accepts a list of strings, empty included. */
const readArgs: Check<readonly string[]> = (raw, label) => {
  if (!Array.isArray(raw)) return failed(expected(label, raw, 'a list of strings'));

  const problems = raw.flatMap((arg: unknown, index) => typeof arg === 'string'
    ? []
    : [expected(`${label}[${index}]`, arg, 'a string')]);
  return problems.length > 0
    ? failed(...problems)
    : passed(Object.freeze(raw.filter((arg): arg is string => typeof arg === 'string')));
};

/** Reads one `mcp` server. */
const readServer: Check<McpServer> = (raw, label) => {
  const { fields, problems } = readFields(raw, label, ['name', 'command', 'args'], ['name', 'command']);
  const name = field(fields, 'name', label, nonEmpty);
  const command = field(fields, 'command', label, nonEmpty);
  const args = fields.has('args')
    ? field(fields, 'args', label, readArgs)
    : passed<readonly string[]>(Object.freeze([]));
  const all = [...problems, ...name.problems, ...command.problems, ...args.problems];
  return all.length > 0 || name.value === undefined || command.value === undefined || args.value === undefined
    ? failed(...all)
    : passed(Object.freeze({ name: name.value, command: command.value, args: args.value }));
};

/** Reads an `mcp` entry: a non-empty list of servers with distinct names. */
const readMcp: Check<readonly McpServer[]> = (raw, label) => {
  if (!Array.isArray(raw) || raw.length === 0) return failed(expected(label, raw, 'a non-empty list of servers'));

  const servers = raw.map((entry: unknown, index) => readServer(entry, `${label}[${index}]`));
  const read = servers.flatMap((server) => server.value === undefined
    ? []
    : [server.value]);
  const repeated = read
    .filter((server, index) => read.findIndex((other) => other.name === server.name) !== index)
    .map((server) => `${label} names the server ${JSON.stringify(server.name)} more than once`);
  const problems = [...servers.flatMap((server) => server.problems), ...new Set(repeated)];
  return problems.length > 0
    ? failed(...problems)
    : passed(Object.freeze(read));
};

/** Reads a directory path: a `skills` or `agents` entry. */
const readDirectory: Check<string> = (raw, label) => readText(raw, label, 'a directory path');

/** The reader of each module type's `provides` entry, by type. `learning` has none. */
const PROVISION_READERS: ReadonlyMap<string, Check<unknown>> = new Map<string, Check<unknown>>([
  ['output', readOutput],
  ['tracker', readAdapter],
  ['store', readAdapter],
  ['planner', readAdapter],
  ['skills', readDirectory],
  ['agents', readDirectory],
  ['mcp', readMcp],
  ['commands', readCommands],
]);

/** What `types` declares, when it read clean, and the label a cross check names it by. */
interface Declared {
  readonly types: readonly ModuleFeatureType[] | undefined;
  readonly label: string;
}

/** True when `declared` read clean and does not list `type`. */
function undeclared(declared: Declared, type: string): boolean {
  return declared.types !== undefined && !declared.types.some((listed) => listed === type);
}

/** Reads `provides`: each entry by its type's shape, held to what `types` declares. */
function readProvides(raw: unknown, label: string, declared: Declared): Checked<ManifestProvides> {
  const { fields, problems } = readFields(raw, label, FEATURE_TYPES, []);
  if (!isMapping(raw)) return failed(...problems);

  const all = [...problems];
  const provided: [string, unknown][] = [];
  for (const [type, value] of fields) {
    const at = `${label}.${type}`;
    const reader = PROVISION_READERS.get(type);
    if (reader === undefined) {
      all.push(`${at} names learning, ${LEARNING_CLOSED}`);
      continue;
    }
    const read = reader(value, at);
    all.push(...read.problems);
    if (read.value !== undefined) provided.push([type, read.value]);
    if (undeclared(declared, type)) all.push(`${at} is given, but ${declared.label} does not list ${type}`);
  }
  for (const type of declared.types ?? []) {
    if (!fields.has(type)) all.push(`${label}.${type} is missing: ${declared.label} lists ${type}`);
  }
  return all.length > 0
    ? failed(...all)
    : passed(Object.freeze(Object.fromEntries(provided)) as ManifestProvides);
}

/** Reads `requires.rafa`: a range, by the grammar in the module note, that `running` satisfies. */
function readRange(raw: unknown, label: string, running: string): Checked<string> {
  const read = readText(raw, label, RANGE_EXPECTED);
  if (read.value === undefined) return read;

  const range = read.value;
  if (!range.split('||').every((alternative) => ALTERNATIVE_PATTERN.test(alternative))) {
    return failed(expected(label, raw, RANGE_EXPECTED));
  }
  return Bun.semver.satisfies(running, range)
    ? passed(range)
    : failed(`${label} is ${JSON.stringify(range)}, which the running rafa ${running} does not satisfy`);
}

/** Reads `requires.ports`: each version core serves, one per port `types` declares. */
function readPorts(raw: unknown, label: string, declared: Declared, served: Readonly<PortVersions>): Checked<ModuleManifest['requires']['ports']> {
  const versions = new Map<string, number>(Object.entries(served));
  const { fields, problems } = readFields(raw, label, [...versions.keys()], []);
  if (!isMapping(raw)) return failed(...problems);

  const all = [...problems];
  const ports: [string, number][] = [];
  for (const [port, core] of versions) {
    const at = `${label}.${port}`;
    if (!fields.has(port)) {
      if (declared.types?.some((type) => type === port) === true) all.push(`${at} is missing: ${declared.label} lists ${port}, a port core versions`);
      continue;
    }
    const stated = fields.get(port);
    if (typeof stated !== 'number' || !Number.isInteger(stated) || stated < 1) all.push(expected(at, stated, 'a whole number above 0'));
    else if (stated !== core) all.push(`${at} is ${stated}, but core serves ${port} port version ${core}`);
    else ports.push([port, stated]);
    if (undeclared(declared, port)) all.push(`${at} is given, but ${declared.label} does not list ${port}`);
  }
  return all.length > 0
    ? failed(...all)
    : passed(Object.freeze(Object.fromEntries(ports)));
}

/** Reads `requires`: `rafa` against the running version, `ports` against the served versions. */
function readRequires(raw: unknown, label: string, declared: Declared, seams: ManifestSeams): Checked<ModuleManifest['requires']> {
  const { fields, problems } = readFields(raw, label, ['rafa', 'ports'], ['rafa']);
  if (!isMapping(raw)) return failed(...problems);

  const rafa = field(fields, 'rafa', label, (value, at) => readRange(value, at, seams.rafaVersion));
  const ports = readPorts(fields.has('ports')
    ? fields.get('ports')
    : {}, `${label}.ports`, declared, seams.portVersions);
  const all = [...problems, ...rafa.problems, ...ports.problems];
  return all.length > 0 || rafa.value === undefined || ports.value === undefined
    ? failed(...all)
    : passed(Object.freeze({ rafa: rafa.value, ports: ports.value }));
}

/** A config reader's reading as a checked value, each key it retained refused. */
function fromReading<T>(reading: Reading<T>): Checked<T> {
  const problems = [
    ...reading.problems,
    ...reading.extras.map((extra) => `${extra.key} is no key a prerequisite item reads`),
  ];
  return problems.length > 0 || reading.value === undefined
    ? failed(...problems)
    : passed(reading.value);
}

/** The reader `.rafa/config.yaml` reads a prerequisite list with, answering a checked value. */
function prerequisiteList<T>(item: (raw: unknown, at: ValueAt) => Reading<T>): Check<readonly T[]> {
  const list = listOf(item, 'prerequisite items');
  return (raw, label) => fromReading(list(raw, { label, key: label }));
}

/** Reads `prerequisites`: optional `required` and `optional` lists. */
const readPrerequisites: Check<ModuleManifest['prerequisites']> = (raw, label) => {
  const { fields, problems } = readFields(raw, label, ['required', 'optional'], []);
  const none = passed(Object.freeze([]));
  const required = fields.has('required')
    ? field(fields, 'required', label, prerequisiteList(requiredPrerequisite))
    : none;
  const optional = fields.has('optional')
    ? field(fields, 'optional', label, prerequisiteList(optionalPrerequisite))
    : none;
  const all = [...problems, ...required.problems, ...optional.problems];
  return all.length > 0 || required.value === undefined || optional.value === undefined
    ? failed(...all)
    : passed(Object.freeze({ required: required.value, optional: optional.value }));
};

/** A refusal carrying `problems`. */
function refusal(problems: readonly string[]): ManifestValidation {
  return { ok: false, problems: Object.freeze([...problems]) };
}

/**
 * Validates a module's `rafa` manifest, naming every failure.
 *
 * `raw` is the value under the `rafa` key of a module's `package.json`,
 * as `JSON.parse` returned it, and `label` opens every problem, so a
 * loader passes `<path>/package.json: rafa`. The answer is the manifest,
 * frozen, or every problem found, each one sentence; see the module note
 * for the schema and the order they are checked in.
 *
 * @throws Error when `seams.rafaVersion` is no plain `major.minor.patch`
 *   version, which is a fault in the caller and not in the manifest.
 */
export function validateManifest(raw: unknown, label = 'rafa', seams: ManifestSeams = RUNNING_MANIFEST_SEAMS): ManifestValidation {
  if (!RELEASE_PATTERN.test(seams.rafaVersion)) {
    throw new Error(`the running rafa version ${JSON.stringify(seams.rafaVersion)} is no major.minor.patch version`);
  }
  if (!isMapping(raw)) return refusal([expected(label, raw, 'a mapping')]);

  const versionAt = `${label}.manifestVersion`;
  if (!Object.hasOwn(raw, 'manifestVersion')) return refusal([`${versionAt} is missing`]);
  if (raw['manifestVersion'] !== MANIFEST_VERSION) return refusal([expected(versionAt, raw['manifestVersion'], String(MANIFEST_VERSION))]);

  const { fields, problems } = readFields(raw, label, MANIFEST_KEYS, ['types', 'provides', 'requires']);
  const types = field(fields, 'types', label, readTypes);
  const declared: Declared = {
    types: types.problems.length === 0
      ? types.value
      : undefined,
    label: `${label}.types`,
  };
  const provides = field(fields, 'provides', label, (value, at) => readProvides(value, at, declared));
  const requires = field(fields, 'requires', label, (value, at) => readRequires(value, at, declared, seams));
  const prerequisites = fields.has('prerequisites')
    ? field(fields, 'prerequisites', label, readPrerequisites)
    : passed<ModuleManifest['prerequisites']>(Object.freeze({ required: Object.freeze([]), optional: Object.freeze([]) }));
  const source = fields.has('source')
    ? field(fields, 'source', label, nonEmpty)
    : passed<string | null>(null);

  const all = [...problems, ...types.problems, ...provides.problems, ...requires.problems, ...prerequisites.problems, ...source.problems];
  if (all.length > 0 || types.value === undefined || provides.value === undefined || requires.value === undefined
    || prerequisites.value === undefined || source.value === undefined) return refusal(all);

  return {
    ok: true,
    manifest: Object.freeze({
      manifestVersion: MANIFEST_VERSION,
      types: types.value,
      provides: provides.value,
      requires: requires.value,
      prerequisites: prerequisites.value,
      source: source.value,
    }),
  };
}
