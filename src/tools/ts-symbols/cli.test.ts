import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

const CLI = path.join(import.meta.dir, 'cli.ts');
const PROJ = path.join(import.meta.dir, 'fixtures', 'proj');

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runIn(cwd: string, ...args: string[]): RunResult {
  const proc = Bun.spawnSync(['bun', CLI, ...args], { cwd });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function run(...args: string[]): RunResult {
  return runIn(PROJ, ...args);
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

// These projects live under the OS temp directory, never inside this
// repository: from there, a walk up would reach rafa's own node_modules.
describe('typescript from the project root', () => {
  const planted: string[] = [];
  const REAL_TYPESCRIPT = path.dirname(Bun.resolveSync('typescript/package.json', import.meta.dir));
  const MARKER = 'fixture typescript loaded';

  afterEach(() => {
    for (const dir of planted.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A copy of fixtures/proj with a package.json that depends on nothing. */
  function plantProject(): string {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ts-symbols-')));
    planted.push(root);
    cpSync(PROJ, root, { recursive: true });
    writeFileSync(path.join(root, 'package.json'), '{ "name": "no-typescript", "private": true }\n');
    return root;
  }

  /** Give `root` a typescript of its own that announces itself on stderr. */
  function plantTypeScript(root: string): void {
    const directory = path.join(root, 'node_modules', 'typescript');
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), '{ "name": "typescript", "main": "./index.js" }\n');
    writeFileSync(
      path.join(directory, 'index.js'),
      `process.stderr.write(${JSON.stringify(`${MARKER}\n`)});\nmodule.exports = require(${JSON.stringify(REAL_TYPESCRIPT)});\n`,
    );
  }

  test('exits 3 naming the root when the project has no typescript', () => {
    const root = plantProject();
    const r = runIn(root, 'outline', 'src/util.ts');
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain(`no typescript under ${root}: add it to the project`);
    expect(r.stdout).toBe('');
  });

  test('answers help without a typescript to load', () => {
    const r = runIn(plantProject(), 'help');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('usage: ts-symbols');
  });

  test('loads the project\'s own typescript rather than rafa\'s', () => {
    const root = plantProject();
    plantTypeScript(root);
    const r = runIn(root, 'outline', 'src/util.ts');
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain(MARKER);
    expect(r.stdout).toContain('7: export function makeChunk');
  });

  test('walks up to the project\'s node_modules from a subdirectory', () => {
    const root = plantProject();
    plantTypeScript(root);
    const r = runIn(path.join(root, 'src'), 'def', 'main.ts:3:29');
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain(MARKER);
    expect(r.stdout).toContain('util.ts:7:17 function makeChunk');
  });
});
