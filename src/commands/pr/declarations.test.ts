/**
 * The `pr` declarations: `declarations.ts` imports no module under
 * `src/`, only the core entries; `pr wait`'s `--timeout` description
 * spells core's `DEFAULT_CI_TIMEOUT_MIN`; and `pr wait`, `pr merge` and
 * `pr triage` declare core's `HINT_FLAG_SPEC` itself, not a copy.
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

import { DEFAULT_CI_TIMEOUT_MIN, HINT_FLAG_SPEC } from '@open-tomato/rafa/core/command';

import {
  MERGE_DANGEROUS_PHRASES,
  PR_MERGE_DECLARATION,
  PR_SUBJECT,
  PR_TRIAGE_DECLARATION,
  PR_WAIT_DECLARATION,
  WAIT_TIMEOUT_FLAG,
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
      'import type { PrSeams } from \'./pr-context.js\';',
      'import { endingWith } from \'../../next/ending.js\';',
    ].join('\n');

    expect(underSrc(readImports(planted, HERE))).toEqual(['./pr-context.js', '../../next/ending.js']);
  });
});

describe('the values declarations.ts declares and copies', () => {
  it('declares HINT_FLAG_SPEC itself on pr wait, pr merge and pr triage, and an equal copy would not pass', () => {
    const declarations = [PR_WAIT_DECLARATION, PR_MERGE_DECLARATION, PR_TRIAGE_DECLARATION];
    const copy = Object.freeze({ ...HINT_FLAG_SPEC });

    expect(declarations.map((declaration) => declaration.flags.includes(HINT_FLAG_SPEC))).toEqual([true, true, true]);
    expect(declarations.map((declaration) => declaration.flags.includes(copy))).toEqual([false, false, false]);
  });

  it('spells the loop\'s own CI deadline in pr wait\'s --timeout description', () => {
    const timeout = PR_WAIT_DECLARATION.flags.find((flag) => flag.name === WAIT_TIMEOUT_FLAG);

    expect(timeout?.description).toBe(
      `How many minutes to wait before giving up. ${DEFAULT_CI_TIMEOUT_MIN} when it is left out.`,
    );
    expect(timeout?.description).not.toContain(`${DEFAULT_CI_TIMEOUT_MIN + 1} when`);
  });
});

describe('the pr declarations', () => {
  it('puts pr merge\'s dangerous phrases on its declaration', () => {
    expect(PR_MERGE_DECLARATION.dangerous).toBe(MERGE_DANGEROUS_PHRASES);
    expect(Object.keys(MERGE_DANGEROUS_PHRASES)).toEqual(['dangerous.acceptVersionCollision']);
  });

  it('puts pr triage\'s spends on its declaration', () => {
    expect(PR_TRIAGE_DECLARATION.spends).toEqual({ when: 'with', flag: '--resolve', what: 'runs a small fixed plan through the loop' });
  });

  it('names the pr subject', () => {
    expect(PR_SUBJECT.name).toBe('pr');
    expect(Object.isFrozen(PR_SUBJECT)).toBe(true);
  });
});
