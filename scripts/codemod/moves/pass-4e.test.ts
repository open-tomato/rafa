import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { bunResolver, textImports } from '../../survey/import-graph';

import { PASS_4E_MOVES } from './pass-4e';

const ROOT = join(import.meta.dir, '..', '..', '..');
const MOVE_COUNT = 82;
const PACKAGE_FOLDER = 'packages/rafa-pr/';

/** Whether the move has run on this tree: every listed `to` exists. */
const moved = PASS_4E_MOVES.every((move) => existsSync(join(ROOT, move.to)));

/** Where a listed file sits on this tree: its `to` once the move has run, its `from` before. */
function sitting(move: (typeof PASS_4E_MOVES)[number]): string {
  return moved
    ? move.to
    : move.from;
}

function trackedFiles(): ReadonlySet<string> {
  const result = Bun.spawnSync(['git', 'ls-files', '-z'], { cwd: ROOT, stdout: 'pipe' });
  return new Set(result.stdout.toString().split('\0')
    .filter((path) => path !== ''));
}

describe('PASS_4E_MOVES', () => {
  const tracked = trackedFiles();
  const listed = new Set(PASS_4E_MOVES.map((move) => move.from));

  it('holds 82 moves sorted by from', () => {
    const froms = PASS_4E_MOVES.map((move) => move.from);

    expect(froms).toHaveLength(MOVE_COUNT);
    expect(new Set(froms).size).toBe(MOVE_COUNT);
    expect(froms).toEqual([...froms].sort());
  });

  it('moves each file to the same path below packages/rafa-pr/', () => {
    for (const move of PASS_4E_MOVES) {
      expect(move.to).toBe(`${PACKAGE_FOLDER}${move.from}`);
    }
  });

  it.skipIf(moved)('lists only tracked sources and no destination that exists', () => {
    for (const move of PASS_4E_MOVES) {
      expect(tracked.has(move.from)).toBe(true);
      expect(tracked.has(move.to)).toBe(false);
      expect(existsSync(join(ROOT, move.to))).toBe(false);
    }
  });

  it.skipIf(!moved)('leaves each source gone and each destination tracked once the move has run', () => {
    for (const move of PASS_4E_MOVES) {
      expect([move.from, tracked.has(move.from), existsSync(join(ROOT, move.from))]).toEqual([move.from, false, false]);
      expect([move.to, tracked.has(move.to)]).toEqual([move.to, true]);
    }
  });

  it('has no relative import reaching outside the list, packages/rafa/ and packages/rafa-pr/', () => {
    const resolve = bunResolver(ROOT);
    const escapes: string[] = [];
    for (const move of PASS_4E_MOVES) {
      const from = sitting(move);
      const specifiers = textImports(readFileSync(join(ROOT, from), 'utf8')).filter((s) => s.startsWith('.'));
      for (const specifier of specifiers) {
        const target = resolve(specifier, from);
        const inside = target !== undefined
          && (listed.has(target) || target.startsWith('packages/rafa/') || target.startsWith(PACKAGE_FOLDER));
        if (!inside) {
          escapes.push(`${from} -> ${specifier} (${target ?? 'unresolved'})`);
        }
      }
    }

    expect(escapes).toEqual([]);
  });

  it('lists the eight PR_NAMED files outside pr\'s folders', () => {
    const outside = [
      'src/bugs/filed-values.ts',
      'src/cleanup/branches.ts',
      'src/cleanup/groups.ts',
      'src/cleanup/worktrees.ts',
      'src/docs/task-reading.ts',
      'src/plan/risk.ts',
      'src/plan/risk/accounts.ts',
      'src/start/pr-retarget.ts',
    ];

    expect(outside.filter((path) => !listed.has(path))).toEqual([]);
  });
});
