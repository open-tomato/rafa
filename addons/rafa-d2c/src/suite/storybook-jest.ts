/**
 * The `storybook-jest` suite kind: the readings of the files a Storybook
 * test-runner run writes, `@storybook/test-runner` over Jest with
 * jest-image-snapshot.
 *
 * - The jest JSON report counts snapshots (`snapshot.matched`, `added`,
 *   `updated`, `unmatched`, `total`) and names no file. Each story test
 *   carries `ancestorTitles`, the story's title and name.
 * - The storybook build's `index.json` maps that pair to the story id.
 *   The test runner names a story by its export (`SmallSize`), where the
 *   index's `name` is the display name (`Small Size`), so both map.
 * - A snapshot file is `<story id>--<light|dark>.png`. A story id itself
 *   holds `--` (`atoms-avatar--away`), so the theme is after the last one.
 *
 * So a passed test compared both themes' files. A failed test compared
 * its first theme only, because the runner stops at the first theme
 * that fails.
 */
import type { RunCounts } from '../store/set-record.js';

import { describeValue, isMapping } from '@open-tomato/rafa-core/core/config/sections';

/** The themes a story is drawn in, in the order the runner asserts them. */
export const THEMES = ['light', 'dark'] as const;

/** The report's snapshot counts. */
export interface SnapshotCounts {
  readonly matched: number;
  readonly added: number;
  readonly updated: number;
  readonly unmatched: number;
  readonly total: number;
}

/** One story test: the story's title and name, and how the test ended. */
export interface StoryTest {
  readonly title: string;
  readonly name: string;
  readonly status: string;
}

/** What a report says. */
export interface JestReading {
  readonly counts: SnapshotCounts;
  readonly tests: readonly StoryTest[];
}

/** The stories a storybook build holds. */
export interface StoryIndex {
  readonly idOf: (title: string, name: string) => string | undefined;
  readonly ids: ReadonlySet<string>;
}

/** Reads a JSON file, naming it when it is missing or no JSON. */
async function readJson(file: string, what: string): Promise<unknown> {
  const source = Bun.file(file);
  if (!(await source.exists())) throw new Error(`no ${what} at ${file}`);
  try {
    return await source.json();
  } catch (error) {
    throw new Error(`${file} is not JSON: ${error instanceof Error
      ? error.message
      : String(error)}`, { cause: error });
  }
}

/** A count at `key` of `snapshot`, refusing anything but a whole number from 0. */
function countAt(snapshot: Readonly<Record<string, unknown>>, key: keyof SnapshotCounts, file: string): number {
  const value = snapshot[key];
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new Error(`${file}: snapshot.${key} is ${describeValue(value)}, expected a whole number from 0`);
}

/** The story tests of one `testResults` entry. */
function testsOf(result: unknown): StoryTest[] {
  if (!isMapping(result) || !Array.isArray(result['assertionResults'])) return [];
  return result['assertionResults'].flatMap((assertion: unknown) => {
    if (!isMapping(assertion)) return [];
    const titles = assertion['ancestorTitles'];
    const status = assertion['status'];
    if (!Array.isArray(titles) || titles.length < 2 || typeof status !== 'string') return [];
    const [title, name] = titles as unknown[];
    return typeof title === 'string' && typeof name === 'string'
      ? [{ title, name, status }]
      : [];
  });
}

/** Reads a jest JSON report. Throws naming the file when it is missing, no JSON, or has no `snapshot` counts. */
export async function readJestReport(file: string): Promise<JestReading> {
  const raw = await readJson(file, 'jest report');
  if (!isMapping(raw) || !isMapping(raw['snapshot'])) throw new Error(`${file}: the report has no snapshot key; is it a jest --json report?`);
  const snapshot = raw['snapshot'];
  const counts: SnapshotCounts = {
    matched: countAt(snapshot, 'matched', file),
    added: countAt(snapshot, 'added', file),
    updated: countAt(snapshot, 'updated', file),
    unmatched: countAt(snapshot, 'unmatched', file),
    total: countAt(snapshot, 'total', file),
  };
  const results = Array.isArray(raw['testResults'])
    ? raw['testResults'] as unknown[]
    : [];
  return { counts, tests: results.flatMap(testsOf) };
}

/** Reads a storybook `index.json`, keeping its `story` entries. Throws naming the file when it is missing or no index. */
export async function readStoryIndex(file: string): Promise<StoryIndex> {
  const raw = await readJson(file, 'story index');
  if (!isMapping(raw) || !isMapping(raw['entries'])) throw new Error(`${file}: the index has no entries key; is it a storybook index.json?`);
  const byPair = new Map<string, string>();
  for (const entry of Object.values(raw['entries'])) {
    if (!isMapping(entry) || entry['type'] !== 'story') continue;
    const { id, title, name, exportName } = entry;
    if (typeof id !== 'string' || typeof title !== 'string') continue;
    for (const label of [name, exportName]) {
      if (typeof label === 'string') byPair.set(JSON.stringify([title, label]), id);
    }
  }
  return { idOf: (title, name) => byPair.get(JSON.stringify([title, name])), ids: new Set(byPair.values()) };
}

/** The story id of a snapshot file name, or null when it is no `<id>--<theme>.png`. */
export function storyIdOfFile(fileName: string): string | null {
  const match = /^(.+)--([^-]+)\.png$/.exec(fileName);
  if (match === null) return null;
  const [, id, theme] = match;
  return THEMES.some((known) => known === theme)
    ? id ?? null
    : null;
}

/** The snapshot files a run compared, and the tests the index has no story for. */
export function comparedFiles(reading: JestReading, index: StoryIndex): { compared: readonly string[]; unmapped: readonly StoryTest[] } {
  const compared: string[] = [];
  const unmapped: StoryTest[] = [];
  for (const test of reading.tests) {
    if (test.status !== 'passed' && test.status !== 'failed') continue;
    const id = index.idOf(test.title, test.name);
    if (id === undefined) {
      unmapped.push(test);
      continue;
    }
    const themes = test.status === 'passed'
      ? THEMES
      : THEMES.slice(0, 1);
    for (const theme of themes) compared.push(`${id}--${theme}.png`);
  }
  return { compared, unmapped };
}

/** The snapshot files whose story the index lacks, sorted. Files that are no themed snapshot are left out. */
export function orphanFiles(files: Iterable<string>, index: StoryIndex): readonly string[] {
  return [...files].filter((file) => {
    const id = storyIdOfFile(file);
    return id !== null && !index.ids.has(id);
  }).sort((a, b) => a.localeCompare(b));
}

/** What kind of run the counts show, given how many files were seeded. */
export function runKindOf(counts: SnapshotCounts, seededFiles: number): RunCounts['kind'] {
  if (seededFiles === 0) return 'seed';
  return counts.added + counts.updated > 0
    ? 'update'
    : 'assert';
}

/** The one line that says what kind of run it was. A seed run never reads as a pass. */
export function runLine(kind: RunCounts['kind'], counts: SnapshotCounts, staged: number): string {
  if (kind === 'seed') return `seed run: ${counts.added} written, 0 compared — not a pass`;
  if (kind === 'update') return `update: ${counts.added} added, ${counts.updated} updated, ${staged} staged`;
  return counts.unmatched === 0
    ? `assert: ${counts.matched} compared, all match`
    : `assert: ${counts.unmatched} shots differ, nothing staged; rerun with the update args to accept them`;
}
