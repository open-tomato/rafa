/**
 * The record of the test index in projected packages, the file
 * `docs/survey/test-index.baseline.json` the guard holds the tree to.
 * Per test file it holds the test's kind, its own unit, the units its
 * walk reaches, the specifiers it enters another unit through by no
 * public entry, and whether it meets the rule of its kind.
 *
 * {@link recordEntry} reads one entry of the index (`test-index.ts`,
 * computed under `packageRules`) into its record:
 *
 *   - `kind` is read from the test's name through `testKind`
 *     (`test-kinds.ts`), never from a folder;
 *   - `package` is the test's unit in the cut map (`cut-map.ts`);
 *   - `packages` is the entry's `folders`: the units its walk reaches
 *     through source files, the bin's reach included when it spawns;
 *   - `deep` is read from the test's own text, not its walk: each
 *     specifier `textImports` (`import-graph.ts`) reads is resolved by the
 *     handed resolver. A landing in another unit is held to
 *     `isPublicEntry` (`package-entries.ts`) of the workspace member that
 *     holds it, and is deep when no member holds it (a projected package
 *     with no manifest yet) or the specifier names none of the member's
 *     `exports` keys. A landing in the test's own unit, outside the
 *     repository (an absolute path, `bun:test`, `node:fs`), in no unit of
 *     the map, or a specifier that resolves to nothing, is ignored.
 *
 * The rule per kind ({@link meetsRule}): a unit test and a contract test
 * meet it when `packages` holds nothing but their own unit; a use-case
 * test reaches real code everywhere and meets it when `deep` is empty.
 *
 * {@link renderRecordJson} writes the file with its header first, in the
 * order `unit`, `map`, `commit`, `binReach`, then `tests`, `unsorted`
 * (the tests whose `meets` is false) and `unindexed`, each value through
 * `stableJson`. {@link parseRecord} reads it back, refusing a text with
 * no `unit`, no `map` hash or an entry short of a field, and naming what
 * is missing. It accepts any unit: refusing a unit other than `packages`
 * is the guard's, which names both sides.
 */

import type { CutMap } from './cut-map';
import type { ResolveImport } from './import-graph';
import type { WorkspaceMember } from './package-entries';
import type { TestIndexEntry } from './test-index';
import type { TestKind, TestKindGlobs } from './test-kinds';

import { isAbsolute } from 'node:path';

import { stableJson, textImports } from './import-graph';
import { isPublicEntry, memberOf } from './package-entries';
import { testKind } from './test-kinds';

/** The unit a record in projected packages names. */
export const RECORD_UNIT = 'packages';

/** The kinds a record entry may name, in the order `testKind` reads them. */
const KINDS: readonly TestKind[] = ['unit', 'contract', 'use-case'];

/** One test file's record. */
export interface TestRecord {
  /** The test's kind, read from its name. */
  readonly kind: TestKind;
  /** The test's own unit in the cut map. */
  readonly package: string;
  /** The units its walk reaches through source files, sorted; the bin's reach included when it spawns. */
  readonly packages: readonly string[];
  /** Its own specifiers that land in another unit through no public entry, sorted. */
  readonly deep: readonly string[];
  /** Whether it meets the rule of its kind. */
  readonly meets: boolean;
  /** Whether the test or a support file it reaches spawns a process. */
  readonly spawns: boolean;
  /** The files whose text spawns, sorted. */
  readonly spawnsVia: readonly string[];
}

/** What {@link recordEntry} reads an entry by, all of it passed in as data. */
export interface RecordInput {
  /** The cut map, read for each file's unit. */
  readonly map: CutMap;
  /** The two glob lists a test's kind is read through. */
  readonly globs: TestKindGlobs;
  /** The workspace members, as `readMembers` lists them. */
  readonly members: readonly WorkspaceMember[];
  /** The source text of each file, read for the test's own specifiers. */
  readonly sources: ReadonlyMap<string, string>;
  /** The resolver a specifier is landed by, as `bunResolver` resolves it. */
  readonly resolve: ResolveImport;
}

/** The header the record opens with, less its unit, which is always {@link RECORD_UNIT}. */
export interface RecordHeader {
  /** The map the record was taken on: its path as passed and the sha256 of its bytes. */
  readonly map: { readonly path: string; readonly sha256: string };
  /** The full hash of the commit whose tree the record was read from. */
  readonly commit: string;
  /** The units the bin loads, sorted. */
  readonly binReach: readonly string[];
}

/** The body the record is written from: each test's record and the tests with no index. */
export interface RecordIndex {
  /** Each indexed test's record, keyed by its path. */
  readonly tests: ReadonlyMap<string, TestRecord>;
  /** The test files with no index, sorted. */
  readonly unindexed: readonly string[];
}

/** The record as {@link parseRecord} reads it back. */
export interface TestIndexRecord extends RecordHeader, RecordIndex {
  /** The record's unit; `packages` for a record this module wrote. */
  readonly unit: string;
  /** The tests whose `meets` is false, sorted. */
  readonly unsorted: readonly string[];
}

/** Whether a landing lies outside the repository: an absolute path, or a name such as `bun:test`. */
function isOutsideRepository(landing: string): boolean {
  return isAbsolute(landing) || landing.startsWith('../') || landing.includes(':');
}

/**
 * Whether a specifier enters another unit through no public entry.
 *
 * @param specifier - The specifier, as the test writes it.
 * @param ownUnit - The test's own unit.
 * @param test - The test's path, the resolver's `from`.
 * @param input - The map, the members and the resolver.
 * @returns `true` when the specifier lands in a unit of the map other
 *   than `ownUnit` and no member holds the landing or the specifier names
 *   none of that member's `exports` keys.
 */
function isDeep(specifier: string, ownUnit: string, test: string, input: RecordInput): boolean {
  const landing = input.resolve(specifier, test);
  if (landing === undefined || isOutsideRepository(landing)) {
    return false;
  }
  const unit = input.map.unitOf(landing);
  if (unit === undefined || unit === ownUnit) {
    return false;
  }
  const member = memberOf(landing, input.members);
  return member === undefined || !isPublicEntry(specifier, member);
}

/**
 * Whether a record meets the rule of its kind: a unit or contract test
 * when `packages` holds nothing but its own unit, a use-case test when
 * `deep` is empty.
 *
 * @param record - The record, `meets` aside.
 * @returns Whether it meets its kind's rule.
 */
export function meetsRule(record: Omit<TestRecord, 'meets'>): boolean {
  return record.kind === 'use-case'
    ? record.deep.length === 0
    : record.packages.every((unit) => unit === record.package);
}

/**
 * Reads one indexed test into its record.
 *
 * @param entry - The test's entry, as `computeTestIndex` answers it under `packageRules`.
 * @param input - The map, the kind globs, the members, the texts and the resolver.
 * @returns The test's record.
 * @throws When the map holds no unit for the test, or its text is not in `input.sources`.
 */
export function recordEntry(entry: TestIndexEntry, input: RecordInput): TestRecord {
  const ownUnit = input.map.unitOf(entry.test);
  if (ownUnit === undefined) {
    throw new Error(`${entry.test}: the map ${input.map.path} holds no unit for the test`);
  }
  const text = input.sources.get(entry.test);
  if (text === undefined) {
    throw new Error(`${entry.test}: no source text to read its specifiers from`);
  }
  const deep = [...new Set(textImports(text))]
    .filter((specifier) => isDeep(specifier, ownUnit, entry.test, input))
    .sort();
  const record = {
    deep,
    kind: testKind(entry.test, input.globs),
    package: ownUnit,
    packages: entry.folders,
    spawns: entry.spawns,
    spawnsVia: entry.spawnsVia,
  };
  return { ...record, meets: meetsRule(record) };
}

/**
 * Writes the record file: the header first, in the order `unit`, `map`,
 * `commit`, `binReach`, then `tests`, `unsorted` and `unindexed`, each
 * value through `stableJson`.
 *
 * @param index - Each test's record and the tests with no index.
 * @param header - The map, the commit and the bin's reach.
 * @returns The file's text, closing with a newline.
 */
export function renderRecordJson(index: RecordIndex, header: RecordHeader): string {
  const unsorted = [...index.tests]
    .filter(([, record]) => !record.meets)
    .map(([test]) => test)
    .sort();
  const fields: [string, unknown][] = [
    ['unit', RECORD_UNIT],
    ['map', header.map],
    ['commit', header.commit],
    ['binReach', header.binReach],
    ['tests', Object.fromEntries(index.tests)],
    ['unsorted', unsorted],
    ['unindexed', index.unindexed],
  ];
  const lines = fields.map(([key, value]) => `  ${JSON.stringify(key)}: ${indented(stableJson(value))}`);
  return `{\n${lines.join(',\n')}\n}\n`;
}

/** `stableJson`'s text less its closing newline, every further line indented one level. */
function indented(json: string): string {
  return json.trimEnd().replaceAll('\n', '\n  ');
}

/** Whether a parsed JSON value is an object with keys, not an array or `null`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a parsed JSON value is a list of strings. */
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Whether a parsed JSON value is one of the three kinds. */
function isKind(value: unknown): value is TestKind {
  return KINDS.some((kind) => kind === value);
}

/** The refusal of a record text, naming what it lacks. */
function refusal(what: string): Error {
  return new Error(`not a test-index record: ${what}`);
}

/** A string list, or `undefined` when `value` is not one. */
function stringList(value: unknown): readonly string[] | undefined {
  return isStringList(value)
    ? value
    : undefined;
}

/** A string, or `undefined` when `value` is not one. */
function stringValue(value: unknown): string | undefined {
  return typeof value === 'string'
    ? value
    : undefined;
}

/** A boolean, or `undefined` when `value` is not one. */
function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean'
    ? value
    : undefined;
}

/**
 * One test's record, read from the record's `tests`.
 *
 * @param test - The key it lies under.
 * @param value - The parsed value.
 * @returns The record.
 * @throws When a field is missing or of another type, naming the test and every such field.
 */
function parsedEntry(test: string, value: unknown): TestRecord {
  if (!isRecord(value)) {
    throw refusal(`the entry ${test} is not an object`);
  }
  const kind = isKind(value['kind'])
    ? value['kind']
    : undefined;
  const fields = {
    deep: stringList(value['deep']),
    kind,
    meets: booleanValue(value['meets']),
    package: stringValue(value['package']),
    packages: stringList(value['packages']),
    spawns: booleanValue(value['spawns']),
    spawnsVia: stringList(value['spawnsVia']),
  };
  const { deep, meets, packages, spawns, spawnsVia } = fields;
  const ownUnit = fields.package;
  if (kind === undefined || meets === undefined || ownUnit === undefined || spawns === undefined
    || deep === undefined || packages === undefined || spawnsVia === undefined) {
    const missing = Object.entries(fields).filter(([, field]) => field === undefined)
      .map(([name]) => name);
    throw refusal(`the entry ${test} holds no ${missing.map((name) => `\`${name}\``).join(', ')}`);
  }
  return { deep, kind, meets, package: ownUnit, packages, spawns, spawnsVia };
}

/** The parsed `map` header, or a refusal naming the field it lacks. */
function parsedMap(value: unknown): RecordHeader['map'] {
  if (!isRecord(value)) {
    throw refusal('it holds no `map`');
  }
  if (typeof value['sha256'] !== 'string') {
    throw refusal('its `map` holds no `sha256`');
  }
  if (typeof value['path'] !== 'string') {
    throw refusal('its `map` holds no `path`');
  }
  return { path: value['path'], sha256: value['sha256'] };
}

/**
 * Reads back what {@link renderRecordJson} wrote.
 *
 * @param text - The record file's text.
 * @returns The record, with its unit as written.
 * @throws When the text is not JSON, holds no string `unit`, no `map`
 *   with its `sha256` and `path`, no `commit`, `binReach`, `tests`,
 *   `unsorted` or `unindexed`, or an entry short of one of its fields;
 *   the message names what is missing.
 */
export function parseRecord(text: string): TestIndexRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw refusal(err instanceof Error
      ? err.message
      : String(err));
  }
  if (!isRecord(parsed)) {
    throw refusal('it is not a JSON object');
  }
  if (typeof parsed['unit'] !== 'string') {
    throw refusal('it holds no `unit`');
  }
  const map = parsedMap(parsed['map']);
  if (typeof parsed['commit'] !== 'string') {
    throw refusal('it holds no `commit`');
  }
  const lists = {
    binReach: stringList(parsed['binReach']),
    unindexed: stringList(parsed['unindexed']),
    unsorted: stringList(parsed['unsorted']),
  };
  const { binReach, unindexed, unsorted } = lists;
  if (binReach === undefined || unindexed === undefined || unsorted === undefined) {
    const missing = Object.entries(lists).filter(([, list]) => list === undefined)
      .map(([name]) => `\`${name}\``);
    throw refusal(`it holds no ${missing.join(', ')} list`);
  }
  if (!isRecord(parsed['tests'])) {
    throw refusal('it holds no `tests` keyed by path');
  }
  const tests = new Map(Object.entries(parsed['tests']).map(([test, value]) => [test, parsedEntry(test, value)]));
  return { binReach, commit: parsed['commit'], map, tests, unindexed, unit: parsed['unit'], unsorted };
}
