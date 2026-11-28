/**
 * Sweep: no tracked source reaches the size at which Bun starts to cache its
 * transpiled output.
 *
 * Bun writes the transpiled output of a large enough source file under
 * `$HOME/.bun/install/cache/@t@/`. One such file on the `rafa --help` load
 * path turns the `runRafa` case of `./cli-capture.test.ts` red, with a
 * message about `.bun` under `HOME` and none about size. That case spawns the
 * CLI and imports no source, so no changed file selects it. This sweep reads
 * the tree instead, and names the file and its size.
 *
 * It reads tracked files alone, so a scratch file never fails it. When it
 * fails, move one cohesive part of the named file into a module beside it and
 * import it back; exported names keep their paths, or their importers move in
 * the same commit.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, setDefaultTimeout, test } from 'bun:test';

import { SWEEP_TIMEOUT } from './sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = join(import.meta.dir, '..', '..');

/**
 * The size, in bytes, from which Bun's transpiler cache under
 * `$HOME/.bun/install/cache/@t@/` takes a source file. A file at the line or
 * over it fails.
 *
 * Measured with Bun 1.3.14 on scratch files, each run under a fresh empty
 * `HOME`: the 51,199-byte file left no `.bun` there, the 51,201-byte file
 * wrote one, and so did a file of exactly 51,200 bytes.
 */
const BUN_CACHE_LINE_BYTES = 51_200;

/** A source file by its repo-relative path and its size on disk. */
interface SourceSize {
  readonly path: string;
  readonly bytes: number;
}

/** Directories whose files are installed or built, at any depth. */
const SKIPPED_SEGMENTS: readonly string[] = ['node_modules', 'dist'];

/** True when a repo-relative path names a TypeScript source this sweep measures. */
function isMeasuredSource(path: string): boolean {
  return path.endsWith('.ts')
    && !path.endsWith('.test.ts')
    && !path.endsWith('.d.ts')
    && !path.split('/').some((segment) => SKIPPED_SEGMENTS.includes(segment));
}

/** A byte count with thousands separators, as `51,200`. */
function withSeparators(bytes: number): string {
  return bytes.toLocaleString('en-US');
}

/** One line for each entry at or over the line, in the order given. */
function offendersAmong(entries: readonly SourceSize[]): string[] {
  return entries
    .filter(({ bytes }) => bytes >= BUN_CACHE_LINE_BYTES)
    .map(({ path, bytes }) => `${path}: ${withSeparators(bytes)} bytes, the line is ${withSeparators(BUN_CACHE_LINE_BYTES)}`);
}

/**
 * The tracked sources and their sizes. A path the index still lists but the
 * working tree no longer holds has no size to measure and is left out.
 */
function trackedSources(): SourceSize[] {
  return execFileSync('git', ['ls-files', '-z', '--', '*.ts'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((path) => isMeasuredSource(path) && existsSync(join(REPO_ROOT, path)))
    .map((path) => ({ path, bytes: statSync(join(REPO_ROOT, path)).size }));
}

describe('Bun transpiler-cache line', () => {
  test('no tracked source is at or over the line', () => {
    const offenders = offendersAmong(trackedSources());

    expect(
      offenders,
      `move one cohesive part into a module beside the file:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  test('the listing holds measured sources, so an empty answer is not an empty read', () => {
    const sources = trackedSources();

    expect(sources.map((source) => source.path)).toContain('src/tests/sweep-timeout.ts');
    expect(sources.every((source) => source.bytes > 0)).toBe(true);
  });
});

describe('offender check', () => {
  test('names a made-up entry of exactly 51,200 bytes and not one of 51,199', () => {
    const planted: readonly SourceSize[] = [
      { path: 'src/planted/at-the-line.ts', bytes: 51_200 },
      { path: 'src/planted/under-the-line.ts', bytes: 51_199 },
    ];

    expect(offendersAmong(planted)).toEqual([
      'src/planted/at-the-line.ts: 51,200 bytes, the line is 51,200',
    ]);
  });

  test('names every entry over the line, each with its own size', () => {
    const planted: readonly SourceSize[] = [
      { path: 'packages/planted/src/first.ts', bytes: 51_903 },
      { path: 'src/planted/small.ts', bytes: 12 },
      { path: 'src/planted/second.ts', bytes: 1_234_567 },
    ];

    expect(offendersAmong(planted)).toEqual([
      'packages/planted/src/first.ts: 51,903 bytes, the line is 51,200',
      'src/planted/second.ts: 1,234,567 bytes, the line is 51,200',
    ]);
  });

  test('names nothing for an empty listing', () => {
    expect(offendersAmong([])).toEqual([]);
  });
});

describe('measured source filter', () => {
  test('keeps a source under src and under a package', () => {
    expect(isMeasuredSource('src/start.ts')).toBe(true);
    expect(isMeasuredSource('packages/planted/src/a.ts')).toBe(true);
  });

  test.each([
    'src/tests/planted.test.ts',
    'src/planted.sweep.test.ts',
    'src/planted.d.ts',
    'node_modules/planted/index.ts',
    'packages/planted/node_modules/dep/index.ts',
    'dist/planted.ts',
    'packages/planted/dist/index.ts',
    'src/planted.md',
  ])('drops %s', (path) => {
    expect(isMeasuredSource(path)).toBe(false);
  });

  test('keeps a source whose directory only contains a skipped name', () => {
    expect(isMeasuredSource('src/distance/planted.ts')).toBe(true);
  });
});
