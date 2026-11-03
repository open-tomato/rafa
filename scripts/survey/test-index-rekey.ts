/**
 * The re-key of the test-index record: it moves the record's paths along
 * the test files git renamed since the record was taken, and reads each
 * entry's unit again from the cut map, without walking or measuring
 * anything.
 *
 * {@link rekeyRecord} is pure. Over the parsed record, a rename list
 * (each `{ from, to }`), the cut map and the head commit it answers the
 * re-keyed record and a report of what it did:
 *
 *   - a rename whose old side is no entry of `tests` and no path of
 *     `unindexed` is skipped and counted (a test added after the record
 *     and moved since, or one an earlier re-key already moved);
 *   - every other rename moves its entry, or its `unindexed` path, to the
 *     new path, and the `unsorted` list follows it. A rename whose new
 *     path the map places in no unit is named unplaced; the entry still
 *     moves in the answer, keeping its `package`, and the driver then
 *     writes nothing;
 *   - per entry, moved or not, its `package` becomes `map.unitOf` of its
 *     path (kept as written when the map places it nowhere), and that unit
 *     is added to its `packages`, sorted without duplicates. An entry whose
 *     unit changed is named with both units. `kind`, `deep`, `meets`,
 *     `spawns` and `spawnsVia` are kept as written;
 *   - the header's `map` becomes the handed map's path and sha256,
 *     `rekeyed` becomes the head, and `unit`, `commit` and `binReach` are
 *     kept.
 *
 * {@link readRenames} reads the rename list from git:
 * `git diff -M --name-status -z --diff-filter=R <since> HEAD -- src packages`,
 * keeping each pair whose two sides are test files (`classifyFile` of
 * `files.ts`), so a renamed source file or fixture is not followed.
 *
 * {@link rekey} is the driver of the `--rekey=<record> --map=<file>` mode
 * of `test-index.ts`. It reads the record (`parseRecord`, refusing a
 * missing file as the guard does) and the map (`readCutMap`), reads the
 * renames since the record's `rekeyed` when the repository holds that
 * commit and since its `commit` otherwise, saying which, runs
 * {@link rekeyRecord} and writes the record in place through
 * `renderRecordJson`, unless the mode is a dry run or a rename is
 * unplaced. Its lines ({@link rekeyLines}) name the count of entries to
 * move, the count of units read again, each unplaced rename and each
 * skipped one, and whether the file was written.
 */

import type { CutMap } from './cut-map';
import type { TestIndexRecord, TestRecord } from './test-index-record';

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { readCutMap } from './cut-map';
import { classifyFile } from './files';
import { parseRecord, renderRecordJson } from './test-index-record';

/** One file git renamed: its old path and its new one. */
export interface Rename {
  /** The path before the rename. */
  readonly from: string;
  /** The path after it. */
  readonly to: string;
}

/** An entry whose unit the map reads as another than the record's `package`. */
export interface UnitChange {
  /** The entry's path, after any rename. */
  readonly test: string;
  /** The unit the record named. */
  readonly from: string;
  /** The unit the map places the path in now. */
  readonly to: string;
}

/** What {@link rekeyRecord} did, each list in the order it was met. */
export interface RekeyReport {
  /** The record entries moved to a new path. */
  readonly moved: readonly Rename[];
  /** The `unindexed` paths moved to a new path. */
  readonly movedUnindexed: readonly Rename[];
  /** The entries whose unit was read as another, sorted by path. */
  readonly unitsReadAgain: readonly UnitChange[];
  /** The renames of the record's paths whose new path the map places in no unit. */
  readonly unplaced: readonly Rename[];
  /** The renames whose old side is no entry and no `unindexed` path of the record. */
  readonly skipped: readonly Rename[];
}

/** The re-keyed record and what the re-key did. */
export interface RekeyResult {
  /** The record, its paths moved, its units read again and its header re-keyed. */
  readonly record: TestIndexRecord;
  /** What moved, what was read again, what could not be placed and what was skipped. */
  readonly report: RekeyReport;
}

/** The re-key mode: the record to re-key, the map to read units by, and whether to write. */
export interface RekeyRequest {
  /** The record's path, absolute or relative to the repository root. */
  readonly rekey: string;
  /** The map's path, absolute or relative to the repository root; the record names it so. */
  readonly map: string;
  /** Whether to print the lines and write nothing. */
  readonly dryRun: boolean;
}

/** Where the rename list was read from: the record's `rekeyed`, or its `commit` and why. */
export interface RenameBase {
  /** The commit the renames were read since. */
  readonly since: string;
  /** Which header field named it. */
  readonly field: 'commit' | 'rekeyed';
  /** The record's `rekeyed`, when it names one the repository lacks. */
  readonly missing: string | undefined;
}

/** What the driver did and what it prints. */
export interface RekeyReading {
  /** The lines the mode prints. */
  readonly lines: readonly string[];
  /** Whether the record file was written. */
  readonly written: boolean;
  /** Whether a rename was unplaced, so the mode exits 1. */
  readonly refused: boolean;
}

/** A full or abbreviated commit hash, the only text handed to git as a revision. */
const COMMIT_HASH = /^[0-9a-f]{7,64}$/;

/** The units of `packages` with `unit` among them, sorted without duplicates. */
function withUnit(packages: readonly string[], unit: string): string[] {
  return [...new Set([...packages, unit])].sort();
}

/** The `[from, to]` of an entry at `path` whose unit the map reads as another, or none. */
function unitChange(path: string, entry: TestRecord, unit: string): UnitChange[] {
  return unit === entry.package
    ? []
    : [{ from: entry.package, test: path, to: unit }];
}

/**
 * Re-keys a record along a rename list and a cut map (see the module
 * note). Pure: the handed record is not changed.
 *
 * @param record - The record, as `parseRecord` reads it.
 * @param renames - The renames since the record was taken or last re-keyed.
 * @param map - The cut map each entry's unit is read from; its path and sha256 go to the header.
 * @param head - The full hash of the commit the renames were read to; it becomes `rekeyed`.
 * @returns The re-keyed record and the report.
 */
export function rekeyRecord(
  record: TestIndexRecord,
  renames: readonly Rename[],
  map: Pick<CutMap, 'path' | 'sha256' | 'unitOf'>,
  head: string,
): RekeyResult {
  const unindexed = new Set(record.unindexed);
  const known = (path: string): boolean => record.tests.has(path) || unindexed.has(path);
  const applied = renames.filter((rename) => known(rename.from));
  const target = new Map(applied.map((rename) => [rename.from, rename.to]));
  const follow = (path: string): string => target.get(path) ?? path;
  const tests: [string, TestRecord][] = [];
  const unitsReadAgain: UnitChange[] = [];
  for (const [test, entry] of record.tests) {
    const path = follow(test);
    const unit = map.unitOf(path) ?? entry.package;
    unitsReadAgain.push(...unitChange(path, entry, unit));
    tests.push([path, { ...entry, package: unit, packages: withUnit(entry.packages, unit) }]);
  }
  tests.sort(([left], [right]) => (left < right
    ? -1
    : left > right
      ? 1
      : 0));
  const rekeyed: TestIndexRecord = {
    ...record,
    map: { path: map.path, sha256: map.sha256 },
    rekeyed: head,
    tests: new Map(tests),
    unindexed: record.unindexed.map(follow).sort(),
    unsorted: record.unsorted.map(follow).sort(),
  };
  const report: RekeyReport = {
    moved: applied.filter((rename) => record.tests.has(rename.from)),
    movedUnindexed: applied.filter((rename) => unindexed.has(rename.from)),
    skipped: renames.filter((rename) => !known(rename.from)),
    unitsReadAgain: unitsReadAgain.sort((left, right) => (left.test < right.test
      ? -1
      : 1)),
    unplaced: applied.filter((rename) => map.unitOf(rename.to) === undefined),
  };
  return { record: rekeyed, report };
}

/**
 * Runs git in `root` and returns what it printed.
 *
 * @throws When git cannot run or exits non-zero, naming the command and its error.
 */
function gitOutput(root: string, args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${root} (exit ${result.exitCode}): ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

/** Refuses a revision that is not a commit hash, so no text of the record reaches git as an option. */
function assertHash(hash: string, what: string): void {
  if (!COMMIT_HASH.test(hash)) {
    throw new Error(`cannot read renames: ${what} ${JSON.stringify(hash)} is not a commit hash`);
  }
}

/**
 * The renames of test files between `since` and `HEAD`, under `src` and
 * `packages`, a pair kept only when both sides are test files.
 *
 * @param root - The repository root.
 * @param since - The commit to read from, a hash.
 * @returns Each rename, in the order git lists them.
 * @throws When `since` is not a commit hash or git refuses the diff.
 */
export function readRenames(root: string, since: string): Rename[] {
  assertHash(since, 'the commit');
  const fields = gitOutput(root, ['diff', '-M', '--name-status', '-z', '--diff-filter=R', since, 'HEAD', '--', 'src', 'packages'])
    .split('\0');
  const renames: Rename[] = [];
  for (let at = 0; at + 2 < fields.length; at += 3) {
    const from = fields[at + 1] ?? '';
    const to = fields[at + 2] ?? '';
    if (classifyFile(from) === 'test' && classifyFile(to) === 'test') {
      renames.push({ from, to });
    }
  }
  return renames;
}

/** Whether the repository at `root` holds `hash` as a commit. */
function holdsCommit(root: string, hash: string): boolean {
  if (!COMMIT_HASH.test(hash)) {
    return false;
  }
  const result = Bun.spawnSync(['git', 'cat-file', '-e', `${hash}^{commit}`], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  return result.exitCode === 0;
}

/**
 * The commit the rename list is read since: the record's `rekeyed` when
 * the repository holds it, else its `commit`.
 *
 * @param root - The repository root.
 * @param record - The record's `commit` and `rekeyed`.
 * @returns The commit, the field that named it, and a `rekeyed` the repository lacks.
 */
export function renameBase(root: string, record: Pick<TestIndexRecord, 'commit' | 'rekeyed'>): RenameBase {
  if (record.rekeyed !== undefined && holdsCommit(root, record.rekeyed)) {
    return { field: 'rekeyed', missing: undefined, since: record.rekeyed };
  }
  return { field: 'commit', missing: record.rekeyed, since: record.commit };
}

/** `count` and the noun, plural unless the count is one. */
function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1
    ? one
    : many}`;
}

/** The line naming where the renames were read from. */
function baseLine(base: RenameBase, head: string): string {
  const reason = base.field === 'rekeyed'
    ? ''
    : base.missing === undefined
      ? '; the record names no rekeyed'
      : `; the record's rekeyed ${base.missing} is no commit of this repository`;
  return `test-index: renames read from the record's ${base.field} ${base.since} to ${head}${reason}`;
}

/** A heading with one indented line per rename below it, or nothing when there is none. */
function renameBlock(heading: string, renames: readonly Rename[]): string[] {
  return renames.length === 0
    ? []
    : [heading, ...renames.map((rename) => `  ${rename.from} -> ${rename.to}`)];
}

/**
 * The lines the re-key mode prints.
 *
 * @param report - What the re-key did.
 * @param base - Where the renames were read from.
 * @param head - The commit they were read to.
 * @param outcome - The record's path when it was written, else why it was not.
 * @returns The lines, the last one saying whether the file was written.
 */
export function rekeyLines(
  report: RekeyReport,
  base: RenameBase,
  head: string,
  outcome: { readonly wrote: string } | { readonly reasons: readonly string[] },
): string[] {
  return [
    baseLine(base, head),
    `test-index: ${counted(report.moved.length, 'entry', 'entries')} to move, `
    + `${counted(report.movedUnindexed.length, 'unindexed path', 'unindexed paths')} to move, `
    + `${counted(report.unitsReadAgain.length, 'unit', 'units')} read again`,
    ...report.unitsReadAgain.map((change) => `  ${change.test}: ${change.from} -> ${change.to}`),
    ...renameBlock(`test-index: ${counted(report.unplaced.length, 'rename', 'renames')} to a path the map places in no unit:`, report.unplaced),
    ...renameBlock(`test-index: ${counted(report.skipped.length, 'rename', 'renames')} skipped, the old path no entry and no unindexed path of the record:`, report.skipped),
    'wrote' in outcome
      ? `test-index: wrote ${outcome.wrote}`
      : `test-index: nothing written (${outcome.reasons.join('; ')})`,
  ];
}

/**
 * Re-keys the record at `mode.rekey` in place (see the module note).
 *
 * @param root - The repository root.
 * @param mode - The record's and the map's paths, and whether this is a dry run.
 * @param head - The full hash of `HEAD`, as `readCommit` names it; it becomes `rekeyed`.
 * @returns The lines to print, whether the file was written, and whether a rename was unplaced.
 * @throws When the record is missing or `parseRecord` refuses it, the map
 *   is refused, a header hash is not a commit hash, or git refuses the diff.
 */
export function rekey(root: string, mode: RekeyRequest, head: string): RekeyReading {
  const file = isAbsolute(mode.rekey)
    ? mode.rekey
    : join(root, mode.rekey);
  if (!existsSync(file)) {
    throw new Error(`cannot read the record: no file at ${file}`);
  }
  const record = parseRecord(readFileSync(file, 'utf8'));
  const map = readCutMap(root, mode.map);
  const base = renameBase(root, record);
  const { record: rekeyed, report } = rekeyRecord(record, readRenames(root, base.since), map, head);
  const refused = report.unplaced.length > 0;
  const reasons = [
    ...mode.dryRun
      ? ['--dry-run']
      : [],
    ...refused
      ? [`${counted(report.unplaced.length, 'rename', 'renames')} placed in no unit`]
      : [],
  ];
  if (reasons.length > 0) {
    return { lines: rekeyLines(report, base, head, { reasons }), refused, written: false };
  }
  writeFileSync(file, renderRecordJson(rekeyed, rekeyed));
  return { lines: rekeyLines(report, base, head, { wrote: mode.rekey }), refused, written: true };
}
