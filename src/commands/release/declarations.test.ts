/**
 * The `release` declarations: `declarations.ts` imports no module under
 * `src/`, only the core entries, and the flags it moved out of
 * `status.ts`, `settle.ts` and `tag.ts` ride on the declarations that
 * spell them.
 *
 * The import reading takes every module specifier `ts.preProcessFile`
 * finds, `import type`, `export … from` and dynamic `import()` among
 * them, and resolves each from the file's own folder. A control runs the
 * same reading over a planted text naming two modules under `src/`, so a
 * reader that matched nothing could not pass for the real file.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import {
  RELEASE_SETTLE_DECLARATION,
  RELEASE_SETTLE_DRY_RUN_FLAG,
  RELEASE_STATUS_DECLARATION,
  RELEASE_STATUS_PLAN_FLAG,
  RELEASE_SUBJECT,
  RELEASE_TAG_DECLARATION,
  RELEASE_TAG_PUSH_FLAG,
} from './declarations.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DECLARATIONS_PATH = join(HERE, 'declarations.ts');
const SRC_DIR = join(HERE, '..', '..') + sep;

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
 * The imports of `imports` that land under `src/`.
 *
 * @param imports - What a file imports.
 * @returns The specifiers resolving to a file under `src/`.
 */
function underSrc(imports: readonly ReadImport[]): readonly string[] {
  return imports.filter(({ resolved }) => resolved.startsWith(SRC_DIR)).map(({ specifier }) => specifier);
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
      'import type { ReleaseSeams } from \'./status.js\';',
      'import { readManifestVersion } from \'../../release/version.js\';',
    ].join('\n');

    expect(underSrc(readImports(planted, HERE))).toEqual(['./status.js', '../../release/version.js']);
  });
});

describe('the release declarations', () => {
  const declarations = [RELEASE_STATUS_DECLARATION, RELEASE_SETTLE_DECLARATION, RELEASE_TAG_DECLARATION];

  it('names the release subject, frozen', () => {
    expect(RELEASE_SUBJECT.name).toBe('release');
    expect(Object.isFrozen(RELEASE_SUBJECT)).toBe(true);
  });

  it('puts each declaration under the release subject, its name the subject and its action', () => {
    expect(declarations.map((declaration) => [declaration.subject, declaration.action, declaration.name])).toEqual([
      ['release', 'status', 'release status'],
      ['release', 'settle', 'release settle'],
      ['release', 'tag', 'release tag'],
    ]);
    expect(declarations.every((declaration) => Object.isFrozen(declaration))).toBe(true);
  });

  it('declares the flags status.ts, settle.ts and tag.ts read on their commands', () => {
    expect(declarations.map((declaration) => declaration.flags.map((flag) => flag.name))).toEqual([
      [RELEASE_STATUS_PLAN_FLAG],
      [RELEASE_SETTLE_DRY_RUN_FLAG],
      [RELEASE_TAG_PUSH_FLAG],
    ]);
    expect([RELEASE_STATUS_PLAN_FLAG, RELEASE_SETTLE_DRY_RUN_FLAG, RELEASE_TAG_PUSH_FLAG]).toEqual(['plan', 'dry-run', 'push']);
  });

  it('declares no spends, since no release command starts a session', () => {
    expect(declarations.map((declaration) => declaration.spends)).toEqual([undefined, undefined, undefined]);
  });
});
