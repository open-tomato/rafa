/**
 * The commands-direction sweep: pins the direction rule behind epic #801's
 * first acceptance criterion against the live tree, not a fixture.
 *
 * The rule: a non-test file outside `src/commands/` holds no import whose
 * target is inside `src/commands/` — static, `import type`, `export …
 * from`, or dynamic `import()` — except `src/rafa.ts` and `src/plan.ts`,
 * exempt as the CLI's own layer. `scripts/survey/commands-direction.ts`
 * (`readCommandsEdges`, `checkCommandsDirection`) does the reading and the
 * comparison; its own unit tests cover both over planted trees. This file
 * is the other half: it runs them over every file git tracks under `src/`
 * and each `packages/<name>/src/`, and reddens on whichever of the
 * check's three reports is not empty:
 *
 *   - `unlisted`: a measured edge the allow-list does not hold — a new
 *     import into `src/commands/` landed without a reason recorded;
 *   - `stale`: an allow-list line no measured edge matches — the import
 *     is gone (most often a split moved its importer's library half) and
 *     the line was left behind;
 *   - `absentFromFirstList`: an allow-list line the first list does not
 *     hold — a line added after `commands-direction.first-list.txt` was
 *     captured, which the plan forbids (the file is never edited).
 *
 * `commands-direction.allow-list.txt` and `commands-direction.first-list.txt`
 * (under `testdata/`, both one edge per line, sorted, in the
 * `<importer> -> <module>` form `edgeLine` spells) start out identical,
 * holding every edge measured on the branch when this sweep was added. A
 * split task then removes its own lines from the allow-list alone, never
 * adding one and never touching the first list — so `stale` keeps
 * shrinking while `absentFromFirstList` stays empty, and a measured edge
 * that is not a split, landing with no allow-list line, reddens `unlisted`
 * immediately.
 *
 * The files read are printed once, at load time, before any assertion
 * runs, so a run that silently read nothing (an empty `sources` map, a
 * resolver that matches no file) cannot pass by reporting three empty
 * lists for the wrong reason.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { checkCommandsDirection, readCommandsEdges } from '../../scripts/survey/commands-direction.js';
import { listTrackedFiles } from '../../scripts/survey/files.js';
import { bunResolver } from '../../scripts/survey/import-graph.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TESTDATA_DIR = join(REPO_ROOT, 'src', 'tests', 'testdata');
const ALLOW_LIST_PATH = join(TESTDATA_DIR, 'commands-direction.allow-list.txt');
const FIRST_LIST_PATH = join(TESTDATA_DIR, 'commands-direction.first-list.txt');

/**
 * The non-blank lines of a list file, each trimmed.
 *
 * @param path - The file's absolute path.
 * @returns Its lines, in file order, blanks dropped.
 */
function readListLines(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * The line this sweep prints before it asserts: how many files it read,
 * named, so a vacuous run (an empty read set) cannot pass silently.
 *
 * @param read - The files `readCommandsEdges` read.
 * @returns One line naming the count and the files.
 */
function filesReadLine(read: readonly string[]): string {
  return `commands-direction: read ${read.length} file(s): ${read.join(', ')}`;
}

const tracked = listTrackedFiles(REPO_ROOT);
const sources = new Map<string, string>();
for (const path of tracked.all) {
  sources.set(path, readFileSync(join(REPO_ROOT, path), 'utf8'));
}

const reading = readCommandsEdges({ files: tracked.all, resolve: bunResolver(REPO_ROOT), sources });
const allowList = readListLines(ALLOW_LIST_PATH);
const firstList = readListLines(FIRST_LIST_PATH);
const report = checkCommandsDirection({ allowList, edges: reading.edges, firstList });

// Printed once, at load time, so a vacuous run (an empty read set) shows
// up in every test's output rather than only in one of them.
console.log(filesReadLine(reading.read));

describe('the commands-direction sweep', () => {
  it('reads a non-empty file set, proving the scan is not vacuous', () => {
    expect(reading.read.length).toBeGreaterThan(0);
    expect(reading.missing).toEqual([]);
  });

  it('holds no measured edge the allow-list does not list (unlisted)', () => {
    expect(
      report.unlisted,
      `new import(s) into src/commands/, add a reason to ${ALLOW_LIST_PATH}: ${report.unlisted.join(', ')}`,
    ).toEqual([]);
  });

  it('holds no allow-list line without a measured edge (stale)', () => {
    expect(
      report.stale,
      `allow-list line(s) with no matching import left in the tree, drop them: ${report.stale.join(', ')}`,
    ).toEqual([]);
  });

  it('holds no allow-list line absent from the first list (absentFromFirstList)', () => {
    expect(
      report.absentFromFirstList,
      `allow-list line(s) added after the first measure, commands-direction.first-list.txt is never edited: ${report.absentFromFirstList.join(', ')}`,
    ).toEqual([]);
  });
});
