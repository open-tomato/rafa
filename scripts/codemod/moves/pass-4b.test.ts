import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { bunResolver, textImports } from '../../survey/import-graph';

import { PASS_4B_MOVES } from './pass-4b';

const ROOT = join(import.meta.dir, '..', '..', '..');
const MOVE_COUNT = 32;
const PACKAGE_FOLDER = 'packages/rafa-effort/';

/** Whether the move has run on this tree: every listed `to` exists. */
const moved = PASS_4B_MOVES.every((move) => existsSync(join(ROOT, move.to)));

/** Where a listed file sits on this tree: its `to` once the move has run, its `from` before. */
function sitting(move: (typeof PASS_4B_MOVES)[number]): string {
  return moved
    ? move.to
    : move.from;
}

function trackedFiles(): ReadonlySet<string> {
  const result = Bun.spawnSync(['git', 'ls-files', '-z'], { cwd: ROOT, stdout: 'pipe' });
  return new Set(result.stdout.toString().split('\0')
    .filter((path) => path !== ''));
}

describe('PASS_4B_MOVES', () => {
  const tracked = trackedFiles();
  const listed = new Set(PASS_4B_MOVES.map((move) => move.from));

  it('holds 32 moves sorted by from', () => {
    const froms = PASS_4B_MOVES.map((move) => move.from);

    expect(froms).toHaveLength(MOVE_COUNT);
    expect(new Set(froms).size).toBe(MOVE_COUNT);
    expect(froms).toEqual([...froms].sort());
  });

  it('moves each file to the same path below packages/rafa-effort/', () => {
    for (const move of PASS_4B_MOVES) {
      expect(move.to).toBe(`${PACKAGE_FOLDER}${move.from}`);
    }
  });

  it.skipIf(moved)('lists only tracked sources and no destination that exists', () => {
    for (const move of PASS_4B_MOVES) {
      expect(tracked.has(move.from)).toBe(true);
      expect(tracked.has(move.to)).toBe(false);
      expect(existsSync(join(ROOT, move.to))).toBe(false);
    }
  });

  it.skipIf(!moved)('leaves each source gone and each destination tracked once the move has run', () => {
    for (const move of PASS_4B_MOVES) {
      expect([move.from, tracked.has(move.from), existsSync(join(ROOT, move.from))]).toEqual([move.from, false, false]);
      expect([move.to, tracked.has(move.to)]).toEqual([move.to, true]);
    }
  });

  it('has no relative import reaching outside the list, packages/rafa/ and packages/rafa-effort/', () => {
    const resolve = bunResolver(ROOT);
    const escapes: string[] = [];
    for (const move of PASS_4B_MOVES) {
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

  it('leaves the store entry tracked at the root and out of the list and the package', () => {
    const entry = 'src/effort/store/index.ts';
    const parked = `${PACKAGE_FOLDER}${entry}`;

    expect(tracked.has(entry)).toBe(true);
    expect(listed.has(entry)).toBe(false);
    expect(tracked.has(parked)).toBe(false);
    expect(existsSync(join(ROOT, parked))).toBe(false);
  });
});
