/**
 * The package's import boundary: the module imports nothing from the hub
 * or from core, only `bun:sqlite`, `node:` builtins, `sqlite-vec` and its
 * own files. The scanner is proven on planted sources first, so a clean
 * package is not a scanner that sees nothing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

const PACKAGE_DIR = join(import.meta.dir, '..');
const SRC_DIR = import.meta.dir;
const ALLOWED_BARE = new Set(['bun:sqlite', 'sqlite-vec']);
const TEST_RUNNER = 'bun:test';

const transpiler = new Bun.Transpiler({ loader: 'ts' });

/** Matches the specifier of a `from '...'` clause, which `scan` omits for type-only imports. */
const FROM_CLAUSE = /\bfrom\s+['"]([^'"]+)['"]/g;

/** Lists the import paths of one source text: `scan` for the runtime ones, a `from` match for the type-only ones it erases. */
function importsOf(source: string): string[] {
  const scanned = transpiler.scan(source).imports.map((entry) => entry.path);
  const fromClauses = [...source.matchAll(FROM_CLAUSE)].map((match) => match[1]!);
  return [...new Set([...scanned, ...fromClauses])];
}

/** Answers a refusal reason for one specifier met in a file at `fromDir`, or null when allowed. */
function refusal(specifier: string, fromDir: string, isTestFile = false): string | null {
  if (specifier.startsWith('.')) {
    const target = join(fromDir, specifier);
    const inside = target === PACKAGE_DIR || target.startsWith(`${PACKAGE_DIR}/`);
    return inside
      ? null
      : `relative path leaves the package: ${specifier}`;
  }
  if (specifier.startsWith('node:') || ALLOWED_BARE.has(specifier)) return null;
  if (specifier === TEST_RUNNER && isTestFile) return null;
  return `import outside the allowed set: ${specifier}`;
}

/** Lists every source file of the package, test files included, by absolute path. */
function sourceFiles(): string[] {
  return [
    join(PACKAGE_DIR, 'index.ts'),
    ...readdirSync(SRC_DIR)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => join(SRC_DIR, name)),
  ];
}

describe('the scanner on planted imports', () => {
  it('refuses an import of @open-tomato/rafa-hub', () => {
    const [path] = importsOf('import { x } from \'@open-tomato/rafa-hub\';');
    expect(refusal(path!, SRC_DIR)).toContain('@open-tomato/rafa-hub');
  });

  it('refuses an import of @open-tomato/rafa/store', () => {
    const [path] = importsOf('import { x } from \'@open-tomato/rafa/store\';');
    expect(refusal(path!, SRC_DIR)).toContain('@open-tomato/rafa/store');
  });

  it('refuses a relative path leaving the package', () => {
    const [path] = importsOf('import { x } from \'../../rafa-hub/src/store/port.js\';');
    expect(refusal(path!, SRC_DIR)).toContain('leaves the package');
  });

  it('refuses a type-only import of a core package', () => {
    const [path] = importsOf('import type { x } from \'@open-tomato/rafa/pr/types\';');
    expect(refusal(path!, SRC_DIR)).not.toBeNull();
  });

  it('allows bun:sqlite, node: builtins, sqlite-vec and a sibling file', () => {
    const paths = importsOf(
      [
        'import { Database } from \'bun:sqlite\';',
        'import { join } from \'node:path\';',
        'import { load } from \'sqlite-vec\';',
        'import { y } from \'./loader.js\';',
      ].join('\n'),
    );
    expect(paths).toHaveLength(4);
    expect(paths.map((path) => refusal(path, SRC_DIR))).toEqual([null, null, null, null]);
  });
});

describe('the package imports', () => {
  it('finds source files to hold', () => {
    expect(sourceFiles().length).toBeGreaterThan(8);
  });

  it('import only bun:sqlite, node: builtins, sqlite-vec and its own files', () => {
    const refused = sourceFiles().flatMap((file) => {
      const dir = join(file, '..');
      return importsOf(readFileSync(file, 'utf8'))
        .map((path) => ({ file, reason: refusal(path, dir, file.endsWith('.test.ts')) }))
        .filter((entry) => entry.reason !== null);
    });
    expect(refused).toEqual([]);
  });
});
