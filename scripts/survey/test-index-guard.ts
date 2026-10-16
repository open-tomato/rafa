/**
 * The guard over the record of the test index in projected packages: it
 * holds the tree to `docs/survey/test-index.baseline.json`
 * (`test-index-record.ts`), where every test file either meets the rule of
 * its kind or lies on the record's `unsorted` list, and that list may only
 * shrink.
 *
 * {@link checkHeader} refuses a record the guard cannot read the tree
 * against, each refusal one line naming both sides: a record whose unit is
 * not `packages`, and one taken on a map whose sha256 is not the handed
 * map's. A path alone does not refuse: the same table may be passed as
 * an absolute or a relative path.
 *
 * {@link compareToRecord} reads each indexed test of the tree into its
 * record now (`recordEntry`) and sorts it into one of:
 *
 *   - `risen`: it does not meet its rule and is not on the record's
 *     `unsorted` list, a test the record does not hold included. Each is
 *     named with its kind, its unit and what breaks the rule: the units
 *     beyond its own that a unit or contract test reaches, the specifiers
 *     a use-case test enters another unit by through no public entry;
 *   - `sorted`: on the list, and meeting its rule now;
 *   - `unsorted`: on the list, and still not meeting it. The units it
 *     reaches now that the record's entry did not are named `widened`;
 *   - `held`: in the record off the list, and meeting its rule still;
 *   - `added`: not in the record, and meeting its rule.
 *
 * A test of the tree with no index now (`bun build` reached no imports of
 * it) is `unread` unless the record listed it under `unindexed` too, when
 * it is `unindexed` still: nothing says an unread test meets its rule, and
 * a test the record could not read either is held to nothing new. A test
 * on the record's `unindexed` list that has an index now is held as a test
 * the record does not hold. A test the map holds no unit for is
 * `unplaced`, read into no record: the mode that reads the map names and
 * fails every unplaced file. A record entry, or a test on the record's
 * `unindexed` list, that no test file of the tree answers is `gone`.
 *
 * {@link holdsRecord} is `false` on a refusal, a `risen` or an `unread`;
 * `sorted`, `unsorted`, `held`, `added` and `gone` fail nothing.
 * {@link renderGuard} prints the counts, the refusals, each risen test
 * with its reason, the unread, the widened with their new units and the
 * sorted by name, and the added and gone by name.
 */

import type { CutMap } from './cut-map';
import type { TestIndex } from './test-index';
import type { RecordInput, TestIndexRecord, TestRecord } from './test-index-record';
import type { TestKind } from './test-kinds';

import { RECORD_UNIT, recordEntry } from './test-index-record';

/** A test that does not meet its rule and is not on the record's unsorted list. */
export interface RisenTest {
  /** The test's path. */
  readonly test: string;
  /** Its kind, read from its name. */
  readonly kind: TestKind;
  /** Its own unit in the map. */
  readonly package: string;
  /** What breaks its rule, as one phrase. */
  readonly reason: string;
  /** Whether the record holds an entry for it; `false` for a new test. */
  readonly inRecord: boolean;
}

/** A test on the record's unsorted list that still does not meet its rule. */
export interface UnsortedTest {
  /** The test's path. */
  readonly test: string;
  /** The units it reaches now that the record's entry did not, sorted. */
  readonly widened: readonly string[];
}

/** Every test file of the tree against the record, each list sorted by path. */
export interface RecordComparison {
  /** The commit the record names. */
  readonly commit: string;
  /** The map's path as the record names it. */
  readonly mapPath: string;
  /** The tests that do not meet their rule and are not on the unsorted list. */
  readonly risen: readonly RisenTest[];
  /** The tests on the unsorted list that meet their rule now. */
  readonly sorted: readonly string[];
  /** The tests on the unsorted list that still do not meet it. */
  readonly unsorted: readonly UnsortedTest[];
  /** The tests the record holds off the list that meet their rule still. */
  readonly held: readonly string[];
  /** The tests the record does not hold that meet their rule. */
  readonly added: readonly string[];
  /** The record's entries and unindexed tests no test file of the tree answers. */
  readonly gone: readonly string[];
  /** The tests with no index now that the record did not list as unindexed. */
  readonly unread: readonly string[];
  /** The tests with no index now that the record listed as unindexed too. */
  readonly unindexed: readonly string[];
  /** The tests the map holds no unit for, read into no record. */
  readonly unplaced: readonly string[];
}

/**
 * The refusals of a record the guard cannot read the tree against.
 *
 * @param record - The record, its unit and map as written.
 * @param map - The map handed to the guard.
 * @returns One line per refusal, naming both sides; empty when the record
 *   is in unit `packages` and was taken on a map of the handed sha256.
 */
export function checkHeader(record: Pick<TestIndexRecord, 'map' | 'unit'>, map: Pick<CutMap, 'path' | 'sha256'>): string[] {
  const unit = record.unit === RECORD_UNIT
    ? []
    : [`test-index: the record's unit is ${record.unit}; the guard reads ${RECORD_UNIT}`];
  const hash = record.map.sha256 === map.sha256
    ? []
    : [`test-index: the record was taken on ${record.map.path} at sha256 ${record.map.sha256}; `
      + `the map handed is ${map.path} at sha256 ${map.sha256}`];
  return [...unit, ...hash];
}

/**
 * What breaks a record's rule, as one phrase.
 *
 * @param record - A record whose `meets` is false.
 * @returns The units a unit or contract test reaches beyond its own, or
 *   the specifiers a use-case test enters another unit by through no
 *   public entry.
 */
function ruleBreak(record: TestRecord): string {
  return record.kind === 'use-case'
    ? `enters another unit through no public entry by ${record.deep.join(', ')}`
    : `reaches ${record.packages.filter((unit) => unit !== record.package).join(', ')} beyond its own unit`;
}

/** The buckets {@link compareToRecord} fills, before they are sorted. */
interface Buckets {
  readonly risen: RisenTest[];
  readonly sorted: string[];
  readonly unsorted: UnsortedTest[];
  readonly held: string[];
  readonly added: string[];
}

/**
 * Puts one test's record now into its bucket.
 *
 * @param test - The test's path.
 * @param now - Its record now.
 * @param record - The record the tree is held to.
 * @param buckets - The buckets, filled in place.
 */
function sortInto(test: string, now: TestRecord, record: TestIndexRecord, buckets: Buckets): void {
  const before = record.tests.get(test);
  const listed = record.unsorted.includes(test);
  if (listed && now.meets) {
    buckets.sorted.push(test);
  } else if (listed) {
    const was = new Set(before?.packages ?? []);
    buckets.unsorted.push({ test, widened: now.packages.filter((unit) => !was.has(unit)) });
  } else if (!now.meets) {
    buckets.risen.push({ inRecord: before !== undefined, kind: now.kind, package: now.package, reason: ruleBreak(now), test });
  } else if (before === undefined) {
    buckets.added.push(test);
  } else {
    buckets.held.push(test);
  }
}

/**
 * Compares the tree with a record, test file by test file (see the module
 * note). Pure: the caller computes the index under `packageRules` and
 * reads the record.
 *
 * @param index - The index of the tree now.
 * @param record - The record it is held to.
 * @param input - The map, the kind globs, the members, the texts and the
 *   resolver each test's record now is read by.
 * @returns Each test file under what it is, and the record's entries left
 *   unanswered.
 */
export function compareToRecord(index: TestIndex, record: TestIndexRecord, input: RecordInput): RecordComparison {
  const buckets: Buckets = { added: [], held: [], risen: [], sorted: [], unsorted: [] };
  const unplaced: string[] = [];
  for (const entry of index.tests) {
    if (input.map.unitOf(entry.test) === undefined) {
      unplaced.push(entry.test);
      continue;
    }
    sortInto(entry.test, recordEntry(entry, input), record, buckets);
  }
  const wasUnindexed = new Set(record.unindexed);
  const answered = new Set([...index.tests.map((entry) => entry.test), ...index.unindexed]);
  const byTest = (left: { test: string }, right: { test: string }): number => (left.test < right.test
    ? -1
    : left.test > right.test
      ? 1
      : 0);
  return {
    added: buckets.added.sort(),
    commit: record.commit,
    gone: [...new Set([...record.tests.keys(), ...record.unindexed])].filter((test) => !answered.has(test)).sort(),
    held: buckets.held.sort(),
    mapPath: record.map.path,
    risen: buckets.risen.sort(byTest),
    sorted: buckets.sorted.sort(),
    unindexed: index.unindexed.filter((test) => wasUnindexed.has(test)).sort(),
    unplaced: unplaced.sort(),
    unread: index.unindexed.filter((test) => !wasUnindexed.has(test)).sort(),
    unsorted: buckets.unsorted.sort(byTest),
  };
}

/**
 * Whether the tree holds to the record: no refusal, no risen test and no
 * unread one.
 *
 * @param comparison - The comparison.
 * @param refusals - The lines {@link checkHeader} answered.
 * @returns `false` when the guard exits 1 on the comparison.
 */
export function holdsRecord(comparison: RecordComparison, refusals: readonly string[]): boolean {
  return refusals.length === 0 && comparison.risen.length === 0 && comparison.unread.length === 0;
}

/**
 * A heading with its lines below it, or nothing when there are no lines.
 *
 * @param heading - What the lines are.
 * @param lines - One line per test file, indented.
 * @returns The block's lines, opened by an empty one.
 */
function namedBlock(heading: string, lines: readonly string[]): string[] {
  return lines.length === 0
    ? []
    : ['', `${heading} (${lines.length}):`, ...lines];
}

/** The line a risen test is printed as: its path, kind and unit, and what breaks its rule. */
function risenLine(risen: RisenTest): string {
  const fresh = risen.inRecord
    ? ''
    : ', not in the record';
  return `  ${risen.test} (${risen.kind} test in ${risen.package}${fresh}): ${risen.reason}`;
}

/**
 * The guard's reading as the mode prints it: the counts, the refusals,
 * each risen test with its reason, the unread, the widened with their new
 * units and the sorted by name, and the added and gone by name. The held,
 * the unindexed still and the unwidened unsorted are counted and not
 * named; the unplaced are counted, and named by the mode that reads the
 * map.
 *
 * @param comparison - The comparison.
 * @param refusals - The lines {@link checkHeader} answered.
 * @param recordPath - The record's path as it was passed.
 * @returns The text, without a closing newline.
 */
export function renderGuard(comparison: RecordComparison, refusals: readonly string[], recordPath: string): string {
  const { added, gone, held, risen, sorted, unindexed, unplaced, unread, unsorted } = comparison;
  const widened = unsorted.filter((test) => test.widened.length > 0);
  const total = risen.length + sorted.length + unsorted.length + held.length + added.length;
  return [
    `test-index: ${total} test file(s) held to ${recordPath}, taken at commit ${comparison.commit} on ${comparison.mapPath}: `
    + `${risen.length} risen, ${sorted.length} sorted, ${unsorted.length} unsorted (${widened.length} widened), `
    + `${held.length} held, ${added.length} new`,
    `test-index: ${gone.length} gone, ${unread.length} not read, ${unindexed.length} unindexed still, ${unplaced.length} unplaced`,
    ...refusals,
    ...namedBlock('Risen, the test does not meet its rule and is not on the unsorted list', risen.map(risenLine)),
    ...namedBlock('Not read, bun build reached no imports and the record did not list it unindexed', unread.map((test) => `  ${test}`)),
    ...namedBlock('Widened, an unsorted test reaches units its record did not', widened.map((test) => `  ${test.test}: ${test.widened.join(', ')}`)),
    ...namedBlock('Sorted, on the unsorted list and meeting its rule now', sorted.map((test) => `  ${test}`)),
    ...namedBlock('New, not in the record and meeting its rule', added.map((test) => `  ${test}`)),
    ...namedBlock('Gone, no test file answers the record entry', gone.map((test) => `  ${test}`)),
  ].join('\n');
}
