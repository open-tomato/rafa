/**
 * Spawned: the `tsc --build` gate over project references, held over a
 * planted two-package tree and the repository's own `tsc`: a reference
 * cycle exits 4 with TS6202, an `import type` of a file outside a composite
 * project's file list exits 1 with TS6307, and the same import declared as
 * a reference exits 0 and writes the declarations under `.tsbuild`.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(60_000);

const REPO_ROOT = join(import.meta.dir, '..', '..');
const TSC = join(REPO_ROOT, 'node_modules', '.bin', 'tsc');

const CYCLE_EXIT = 4;
const ERROR_EXIT = 1;

interface BuildRun {
  readonly exitCode: number;
  readonly output: string;
}

function writeTree(root: string, files: Readonly<Record<string, string>>): void {
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

function composite(references: readonly string[]): string {
  return JSON.stringify({
    compilerOptions: {
      composite: true,
      noEmit: false,
      emitDeclarationOnly: true,
      declaration: true,
      rootDir: 'src',
      outDir: '.tsbuild',
      tsBuildInfoFile: '.tsbuild/tsconfig.tsbuildinfo',
      strict: true,
      module: 'ESNext',
      moduleResolution: 'Bundler',
      target: 'ES2022',
      types: [],
      skipLibCheck: true,
    },
    include: ['src'],
    references: references.map((path) => ({ path })),
  });
}

function build(root: string, project: string): BuildRun {
  const run = Bun.spawnSync([TSC, '--build', project, '--pretty', 'false'], { cwd: root });
  return {
    exitCode: run.exitCode,
    output: `${run.stdout.toString()}${run.stderr.toString()}`,
  };
}

const PACKAGE_A_SOURCE = 'export type A = { readonly a: number };\n';
const PACKAGE_B_SOURCE = 'import type { A } from \'../../a/src/index.ts\';\nexport type B = A;\n';

describe('tsc --build over project references', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'references-gate-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('a reference cycle exits 4 with TS6202', () => {
    writeTree(root, {
      'a/src/index.ts': PACKAGE_A_SOURCE,
      'b/src/index.ts': 'export type B = { readonly b: number };\n',
      'a/tsconfig.json': composite(['../b']),
      'b/tsconfig.json': composite(['../a']),
    });

    const run = build(root, 'a');

    expect({ exitCode: run.exitCode, output: run.output }).toEqual({
      exitCode: CYCLE_EXIT,
      output: expect.stringContaining('TS6202'),
    });
  });

  test('an import type outside the composite file list exits 1 with TS6307', () => {
    writeTree(root, {
      'a/src/index.ts': PACKAGE_A_SOURCE,
      'b/src/index.ts': PACKAGE_B_SOURCE,
      'a/tsconfig.json': composite([]),
      'b/tsconfig.json': composite([]),
    });

    const run = build(root, 'b');

    expect({ exitCode: run.exitCode, output: run.output }).toEqual({
      exitCode: ERROR_EXIT,
      output: expect.stringContaining('TS6307'),
    });
  });

  test('the same import declared as a reference exits 0 and writes .tsbuild declarations', () => {
    writeTree(root, {
      'a/src/index.ts': PACKAGE_A_SOURCE,
      'b/src/index.ts': PACKAGE_B_SOURCE,
      'a/tsconfig.json': composite([]),
      'b/tsconfig.json': composite(['../a']),
    });

    const run = build(root, 'b');

    expect({ exitCode: run.exitCode, output: run.output }).toEqual({ exitCode: 0, output: '' });
    expect(existsSync(join(root, 'a', '.tsbuild', 'index.d.ts'))).toBe(true);
    expect(existsSync(join(root, 'b', '.tsbuild', 'index.d.ts'))).toBe(true);
  });
});
