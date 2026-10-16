/**
 * The survey's test index as `docs/survey/test-index.md` holds it: the
 * coverage line, the counts, the test files with the highest indexes and
 * the source files reached by the most test files from other folders.
 * Pure over the index `computeTestIndex` of `test-index.ts` returns; that
 * script's survey mode writes the text this module renders.
 */

import type { SourceReach, TestIndex, TestIndexEntry } from './test-index';

import { coverageLine } from './files';

/** How many test files the summary lists by index. */
export const TOP_INDEXES = 20;

/** How many source files the summary lists by tests from other folders. */
export const TOP_REACHED = 20;

/**
 * Orders two strings by UTF-16 code unit, the order `sort` gives.
 *
 * @param left - One string.
 * @param right - The other.
 * @returns A negative, zero or positive number.
 */
function byText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right
    ? -1
    : 1;
}

/**
 * A list of paths as one markdown cell, each in code, or `-` when empty.
 *
 * @param paths - The paths.
 * @returns The cell.
 */
function codeCell(paths: readonly string[]): string {
  return paths.length === 0
    ? '-'
    : paths.map((path) => `\`${path}\``).join(', ');
}

/**
 * The table of the highest indexes, highest first, then by path.
 *
 * @param tests - Every indexed test.
 * @returns The table's lines.
 */
function topIndexRows(tests: readonly TestIndexEntry[]): string[] {
  const top = [...tests]
    .sort((left, right) => right.index - left.index || byText(left.test, right.test))
    .slice(0, TOP_INDEXES);
  return [
    '| Rank | Test | Index | Folders | Spawns via | Support-only folders |',
    '| --- | --- | --- | --- | --- | --- |',
    ...top.map((entry, rank) => `| ${rank + 1} | \`${entry.test}\` | ${entry.index} | ${entry.folders.length} | `
      + `${codeCell(entry.spawnsVia)} | ${codeCell(entry.supportFolders)} |`),
  ];
}

/**
 * The table of the source files most reached from other folders, most
 * first, then by path; a file no test from another folder reaches is left
 * out.
 *
 * @param sources - Every source file.
 * @returns The table's lines.
 */
function topReachedRows(sources: readonly SourceReach[]): string[] {
  const top = sources
    .filter((source) => source.testsFromOtherFolders > 0)
    .sort((left, right) => right.testsFromOtherFolders - left.testsFromOtherFolders || byText(left.source, right.source))
    .slice(0, TOP_REACHED);
  return [
    '| Rank | Source file | Tests from other folders | All tests | Support-only tests |',
    '| --- | --- | --- | --- | --- |',
    ...top.map((source, rank) => `| ${rank + 1} | \`${source.source}\` | ${source.testsFromOtherFolders} | `
      + `${source.tests.length} | ${source.supportOnlyTests.length} |`),
  ];
}

/**
 * The index as `docs/survey/test-index.md` holds it: the coverage line,
 * the counts, the highest indexes, and the source files reached by the
 * most test files from other folders.
 *
 * @param index - The computed index.
 * @param tracked - The tracked files in scope, for the coverage line.
 * @returns The markdown text, ending in a newline.
 */
export function renderTestIndexMarkdown(index: TestIndex, tracked: readonly string[]): string {
  const spawning = index.tests.filter((entry) => entry.spawns).length;
  const unreached = index.sources.filter((source) => source.tests.length === 0).length;
  const lines = [
    '# Test index',
    '',
    coverageLine(index.read, tracked),
    '',
    `${index.tests.length} test files indexed, ${spawning} of them spawning a process; `
    + `${index.sources.length} source files, ${unreached} of them reached by no test outside support files. `
    + 'A test\'s index is the number of folders (a package counts as one) its transitive imports reach '
    + 'through source files, doubled when it spawns a process; folders reached only through `src/tests/` '
    + 'support files and fakes are listed apart and not counted.',
    '',
    `## The ${TOP_INDEXES} highest indexes`,
    '',
    ...topIndexRows(index.tests),
    '',
    `## The ${TOP_REACHED} source files reached by the most test files from other folders`,
    '',
    ...topReachedRows(index.sources),
  ];
  if (index.unindexed.length > 0) {
    lines.push('', '## Unindexed tests', '', 'No `bun build` entry reached these; their imports were not read.', '');
    lines.push(...index.unindexed.map((path) => `- \`${path}\``));
  }
  return `${lines.join('\n')}\n`;
}
