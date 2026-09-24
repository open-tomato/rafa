import * as path from 'node:path';

import { describe, expect, test } from 'bun:test';

const CLI = path.join(import.meta.dir, 'cli.ts');
const PROJ = path.join(import.meta.dir, 'fixtures', 'proj');

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function run(...args: string[]): RunResult {
  const proc = Bun.spawnSync(['bun', CLI, ...args], { cwd: PROJ });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe('outline', () => {
  test('lists exported and top-level symbols in line order', () => {
    const r = run('outline', 'src/util.ts');
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines).toContain('2: export interface Chunk');
    expect(lines).toContain('7: export function makeChunk');
    expect(lines).toContain('11: export class ChunkStore');
    expect(lines).toContain('19: const HIDDEN_LIMIT');
    const nums = lines.map((l) => Number(l.split(':')[0]));
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
  });

  test('nests container members but not function internals', () => {
    const r = run('outline', 'src/util.ts');
    expect(r.stdout).toContain('14:   method add');
    // makeChunk returns an object literal; its properties must not leak
    expect(r.stdout).not.toContain('8:');
  });

  test('--json emits structured symbols', () => {
    const r = run('outline', 'src/util.ts', '--json');
    const parsed = JSON.parse(r.stdout);
    const chunk = parsed.symbols.find((s: { name: string }) => s.name === 'Chunk');
    expect(chunk.kind).toBe('interface');
    expect(chunk.exported).toBe(true);
    expect(chunk.children.map((c: { name: string }) => c.name)).toEqual(['text', 'size']);
  });
});

describe('def', () => {
  test('resolves a call site to its declaration', () => {
    // main.ts:3:29 is the makeChunk('hello') call
    const r = run('def', 'src/main.ts:3:29');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('src/util.ts:7:17 function makeChunk');
  });

  test('exits 2 with a message when nothing is at the position', () => {
    const r = run('def', 'src/main.ts:2:1');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('no definition found');
  });
});

describe('refs', () => {
  test('finds references across the tsconfig project with roles', () => {
    // util.ts:7:17 is the makeChunk declaration
    const r = run('refs', 'src/util.ts:7:17');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('src/util.ts:7:17 [def]');
    expect(r.stdout).toContain('src/main.ts:3:29 [use] export const first: Chunk = makeChunk(\'hello\');');
    expect(r.stdout).toContain('src/main.ts:4:10 [use]'); // re-export site
    expect(r.stderr).toContain('5 reference(s)');
  });
});

describe('type', () => {
  test('prints the declared type at a position', () => {
    // main.ts:3:14 is `first`
    const r = run('type', 'src/main.ts:3:14');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('const first: Chunk');
  });

  test('--full expands a type alias', () => {
    // main.ts:6:14 is `maybe`, declared as the MaybeChunk alias
    const r = run('type', 'src/main.ts:6:14', '--full');
    expect(r.stdout).toContain('const maybe: MaybeChunk');
    expect(r.stdout).toContain('expanded: Chunk | null');
  });
});

describe('cli surface', () => {
  test('bad target format fails with usage guidance', () => {
    const r = run('def', 'src/main.ts');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('expected <file>:<line>:<col>');
  });

  test('unknown command fails', () => {
    const r = run('frobnicate', 'x');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('unknown command "frobnicate"');
  });
});
