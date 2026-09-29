import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { DEFAULT_PER_SIDE } from '../src/effort/store/fixture-extract.js';
import { SQLITE_MIGRATIONS } from '../src/effort/store/migrations.js';

import { EXIT_COULD_NOT_RUN, EXIT_WRITTEN, readExtractArgs, runExtract, TAG, USAGE } from './extract-merge-fixture.js';

/**
 * The script as the thin caller of `src/effort/store/fixture-extract.ts`,
 * whose own suite holds the mapping and the sampling. These cases hold
 * what the script adds: the words it reads, the lines it writes, and its
 * exit codes, the last through one spawned run each way over stores
 * planted under a temporary directory of the case's own.
 */

let base = '';

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-extract-script-')));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A store at `name` under the case's directory, every migration run and one session row planted. */
function plantStore(name: string): string {
  const path = join(base, name);
  const db = new Database(path, { create: true });
  for (const { sql } of SQLITE_MIGRATIONS) db.run(sql);
  db.run('INSERT INTO sessions (seq, session_id, row_json) VALUES (1, \'session-one\', \'{}\')');
  db.close();
  return path;
}

describe('readExtractArgs', () => {
  it('reads two stores and --out, resolved against the directory given, with the default sample', () => {
    expect(readExtractArgs(['a.sqlite', '/x/b.sqlite', '--out=scratch/out'], '/work')).toEqual({
      pathA: resolve('/work', 'a.sqlite'), pathB: '/x/b.sqlite', outDir: resolve('/work', 'scratch/out'), perSide: DEFAULT_PER_SIDE,
    });
    expect(readExtractArgs(['a', 'b', '--per-side=0', '--out=/o'], '/work').perSide).toBe(0);
  });

  it('refuses a missing store, a missing --out, an unknown flag and a sample that is not a whole number', () => {
    const cases: readonly [readonly string[], string][] = [
      [['a', '--out=/o'], 'expected two store files, got 1'],
      [['a', 'b', 'c', '--out=/o'], 'expected two store files, got 3'],
      [['a', 'b'], 'expected one --out=<dir>'],
      [['a', 'b', '--out='], 'expected one --out=<dir>'],
      [['a', 'b', '--out=/o', '--force'], 'unknown argument(s): --force'],
      [['a', 'b', '--out=/o', '--per-side=-3'], '--per-side=-3 is not a whole number'],
      [['a', 'b', '--out=/o', '--per-side=1', '--per-side=2'], 'expected at most one --per-side=<n>'],
    ];
    for (const [argv, message] of cases) {
      expect(() => readExtractArgs(argv, '/work')).toThrow(message);
      expect(() => readExtractArgs(argv, '/work')).toThrow(USAGE);
    }
  });
});

describe('runExtract', () => {
  it('writes the extract under --out and a line per table and per file', () => {
    const lines: string[] = [];
    const outDir = join(base, 'out');

    const code = runExtract({ pathA: plantStore('a.sqlite'), pathB: plantStore('b.sqlite'), outDir, perSide: 5 }, (line) => lines.push(line));

    expect(code).toBe(EXIT_WRITTEN);
    expect(lines).toContain(`${TAG} sessions: rows A 1, B 1; overlap 1; kept A 1, B 1`);
    expect(lines.filter((line) => line.startsWith(`${TAG} wrote `))).toEqual(
      ['a.json', 'b.json', 'summary.json'].map((name) => `${TAG} wrote ${join(outDir, name)}`),
    );
  });
});

describe('the script run as a process', () => {
  /** Runs the script with `argv` in the case's directory. */
  function spawnScript(argv: readonly string[]): { code: number; stdout: string; stderr: string } {
    const run = Bun.spawnSync([process.execPath, resolve(import.meta.dir, 'extract-merge-fixture.ts'), ...argv], { cwd: base });
    return { code: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
  }

  it('exits 0 having written only under --out, and 2 naming the refusal when --out would be replaced', () => {
    plantStore('a.sqlite');
    plantStore('b.sqlite');

    const first = spawnScript(['a.sqlite', 'b.sqlite', '--out=out']);
    const second = spawnScript(['a.sqlite', 'b.sqlite', '--out=out']);

    expect([first.code, first.stderr]).toEqual([EXIT_WRITTEN, '']);
    expect(first.stdout).toContain(`${TAG} wrote ${join(base, 'out', 'a.json')}`);
    expect(readdirSync(base).sort((x, y) => x.localeCompare(y))).toEqual(['a.sqlite', 'b.sqlite', 'out']);
    expect(second.code).toBe(EXIT_COULD_NOT_RUN);
    expect(second.stderr).toContain(`${TAG} FAIL — the extract would replace`);
  });
});
