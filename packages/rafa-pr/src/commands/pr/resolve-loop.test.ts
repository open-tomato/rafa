/**
 * Tests for one resolve attempt's loop (`resolve-loop.ts`): where the
 * plan is written, the words the loop is spawned with, and what a real
 * spawn does with them.
 *
 * Nothing here spawns rafa, `claude` or `gh`. The spawn case runs the
 * bun this process runs under over a STAND-IN entry the case writes,
 * which records its argv and its working directory and exits with the
 * code the case asked for — so the child is a script this file owns,
 * and the reading is the spawn shape rather than a loop run.
 *
 * ## What the cases are FOR
 *
 *  - The plan OUTSIDE the worktree. A plan written into the worktree is
 *    committed onto the branch by the loop's own commit step, which no
 *    assertion about the file's contents would catch. So the path case
 *    asserts the directory is under the home and that the worktree path
 *    is no prefix of it, with the worktree path as its control.
 *  - A tracker that is not fresh. Two attempts sharing a file means the
 *    second runs nothing and reports a clean loop — a silent pass. The
 *    case writes both attempts and asserts the two paths differ.
 *  - `--no-ci-wait`. The command runs the wait itself, and a child that
 *    waited would spend repair sessions outside the attempt guard. The
 *    argv case asserts the flag is there.
 */
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'bun:test';

import {
  RESOLVE_SUBDIR,
  resolveLoopArgv,
  resolveRunDir,
  runResolveLoop,
  writeResolvePlan,
} from './resolve-loop.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-resolve-loop-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A directory of this case's own, under {@link tempBase}. */
function scratch(name: string): string {
  return realpathSync(mkdtempSync(join(tempBase, `${name}-`)));
}

/** The stand-in entry: records `argv` and `cwd`, then exits with `code`. */
function plantEntry(dir: string, log: string, code: number): string {
  const entry = join(dir, 'fake-rafa.ts');
  writeFileSync(entry, [
    'import { writeFileSync } from \'node:fs\';',
    `writeFileSync(${JSON.stringify(log)}, JSON.stringify({`,
    '  words: Bun.argv.slice(2),',
    '  cwd: process.cwd(),',
    '  output: process.env.RAFA_OUTPUT ?? null,',
    '}));',
    'console.log(\'loop line one\');',
    'console.log(\'loop line two\');',
    `process.exit(${String(code)});`,
  ].join('\n'), 'utf8');
  chmodSync(entry, 0o755);
  return entry;
}

describe('where an attempt keeps its plan', () => {
  test('is under the home and not inside the worktree', () => {
    const home = scratch('home');
    const worktree = join(home, '.rafa', 'worktrees', 'pr-41');

    const dir = resolveRunDir(home, 41, 1);

    expect(dir).toBe(join(home, RESOLVE_SUBDIR, 'pr-41', 'attempt-1'));
    expect(dir.startsWith(worktree)).toBe(false);
    expect(worktree.startsWith(join(home, '.rafa'))).toBe(true);
  });

  test('writes the plan under the pinned plan name and answers its path', () => {
    const home = scratch('home');

    const path = writeResolvePlan({
      home,
      number: 41,
      attempt: 1,
      triageClass: 'conflict-lockfile',
      plan: '# Plan: Resolve lockfile conflict\n',
    });

    expect(path).toBe(join(resolveRunDir(home, 41, 1), 'resolve-conflict-lockfile.md'));
    expect(readFileSync(path, 'utf8')).toBe('# Plan: Resolve lockfile conflict\n');
  });

  test('gives each attempt its own file, so the second runs an untouched tracker', () => {
    const home = scratch('home');
    const one = { home, number: 41, triageClass: 'conflict-lockfile' as const, plan: 'one' };

    const first = writeResolvePlan({ ...one, attempt: 1 });
    const second = writeResolvePlan({ ...one, attempt: 2, plan: 'two' });

    expect(first).not.toBe(second);
    expect([readFileSync(first, 'utf8'), readFileSync(second, 'utf8')]).toEqual(['one', 'two']);
  });
});

describe('the words the loop is spawned with', () => {
  test('run the plan through the ordinary loop and leave the CI wait to the command', () => {
    expect(resolveLoopArgv('/tmp/p/PLAN.md')).toEqual([
      'loop',
      'start',
      '--plan=/tmp/p/PLAN.md',
      '--no-ci-wait',
    ]);
  });
});

describe('the spawn', () => {
  test('runs the entry in the worktree, forwards its lines and answers its exit code', async () => {
    const dir = scratch('spawn');
    const log = join(dir, 'call.json');
    const entry = plantEntry(dir, log, 0);
    const lines: string[] = [];

    const outcome = await runResolveLoop(
      { worktree: dir, planPath: '/tmp/p/PLAN.md', onLine: (line) => lines.push(line) },
      { entry },
    );

    expect([outcome.ok, outcome.exitCode, outcome.problem]).toEqual([true, 0, null]);
    expect(lines).toEqual(['loop line one', 'loop line two']);
    expect(JSON.parse(readFileSync(log, 'utf8'))).toEqual({
      words: ['loop', 'start', '--plan=/tmp/p/PLAN.md', '--no-ci-wait'],
      cwd: dir,
      output: 'text',
    });
  });

  test('answers a loop that failed as failed, with its exit code', async () => {
    const dir = scratch('spawn-red');
    const entry = plantEntry(dir, join(dir, 'call.json'), 2);

    const outcome = await runResolveLoop(
      { worktree: dir, planPath: '/tmp/p/PLAN.md', onLine: () => {} },
      { entry },
    );

    expect([outcome.ok, outcome.exitCode]).toEqual([false, 2]);
  });

  test('answers a child that could not be spawned rather than throwing', async () => {
    const dir = scratch('spawn-none');

    const outcome = await runResolveLoop(
      { worktree: dir, planPath: '/tmp/p/PLAN.md', onLine: () => {} },
      { execPath: join(dir, 'no-such-bun'), entry: join(dir, 'no-such-entry.ts') },
    );

    expect([outcome.ok, outcome.exitCode]).toEqual([false, 1]);
    expect(outcome.problem).not.toBeNull();
  });
});
