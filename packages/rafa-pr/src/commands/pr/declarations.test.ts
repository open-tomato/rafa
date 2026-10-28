/**
 * The `pr` declarations: `declarations.ts` imports no module under
 * `src/`, pr's or the root's, only the core entries.
 *
 * The import reading takes every module specifier `ts.preProcessFile`
 * finds, `import type`, `export … from` and dynamic `import()` among
 * them, and resolves each from the file's own folder. A control runs the
 * same reading over a planted text naming two modules under `src/`, one
 * in pr's package and one at the root, so a reader that matched nothing
 * could not pass for the real file.
 *
 * The cases over the declarations' values are in
 * `declarations-integration.test.ts` beside this file.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const DECLARATIONS_PATH = join(HERE, 'declarations.ts');
/** Pr's `src/`, where this file lives since pass 4e. */
const SRC_DIR = join(HERE, '..', '..') + sep;

/** The root's `src/`, five folders up from here. */
const ROOT_SRC_DIR = join(HERE, '..', '..', '..', '..', '..', 'src') + sep;

/** The prefix every specifier of a declaration module starts with. */
const CORE_PREFIX = '@open-tomato/rafa/core/';

/** One import a file holds: what it names, and the file it resolves to. */
interface ReadImport {
  readonly specifier: string;
  readonly resolved: string;
}

/**
 * Every module a source text imports, resolved from `from`.
 *
 * @param text - The source text.
 * @param from - The folder its relative specifiers resolve from.
 * @returns Each specifier with the file it resolves to.
 */
function readImports(text: string, from: string): readonly ReadImport[] {
  return ts.preProcessFile(text, true, true).importedFiles.map(({ fileName }) => ({
    specifier: fileName,
    resolved: Bun.resolveSync(fileName, from),
  }));
}

/**
 * The imports of `imports` that land under pr's `src/` or the root's.
 *
 * @param imports - What a file imports.
 * @returns The specifiers resolving to a file under either `src/`.
 */
function underSrc(imports: readonly ReadImport[]): readonly string[] {
  return imports
    .filter(({ resolved }) => resolved.startsWith(SRC_DIR) || resolved.startsWith(ROOT_SRC_DIR))
    .map(({ specifier }) => specifier);
}

describe('what declarations.ts imports', () => {
  const imports = readImports(readFileSync(DECLARATIONS_PATH, 'utf8'), HERE);

  it('imports no module under src/', () => {
    expect(imports.length).toBeGreaterThan(0);
    expect(underSrc(imports)).toEqual([]);
  });

  it('imports from the core entries alone', () => {
    expect(imports.map(({ specifier }) => specifier).filter((specifier) => !specifier.startsWith(CORE_PREFIX)))
      .toEqual([]);
  });

  it('reads a planted import of a module under src/ as one, the control', () => {
    const planted = [
      'import type { RafaCommand } from \'@open-tomato/rafa/core/command\';',
      'import type { PrSeams } from \'./pr-context.js\';',
      'import { rafa } from \'../../../../../src/rafa.js\';',
    ].join('\n');

    expect(underSrc(readImports(planted, HERE))).toEqual(['./pr-context.js', '../../../../../src/rafa.js']);
  });
});
