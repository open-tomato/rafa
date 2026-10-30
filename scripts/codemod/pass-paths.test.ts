/**
 * The paths a code line builds, read for step 6 of the pass-moves codemod:
 * from `import.meta`, from a folder constant, and as a relative string
 * that is no import specifier.
 */
import type { BuiltPath, BuiltPathsOptions } from './pass-paths';

import { describe, expect, it } from 'bun:test';

import { builtPaths, codeForms, namedImports, pathTree, shiftedPath } from './pass-paths';

function lines(...text: readonly string[]): string {
  return `${text.join('\n')}\n`;
}

const NO_SPECIFIER: BuiltPathsOptions = { isSpecifier: () => false };

/** The paths each line builds, by line number. */
function read(file: string, text: string, options: BuiltPathsOptions = NO_SPECIFIER): readonly (readonly [number, readonly string[]])[] {
  return builtPaths(file, text, options).lines.map((line) => [line.line, line.paths.map((item) => item.path)] as const);
}

describe('builtPaths', () => {
  it('reads a path joined onto a folder constant bound from import.meta', () => {
    const text = lines(
      'const SRC_DIR = fileURLToPath(new URL(\'.\', import.meta.url));',
      'const probe = `import { x } from ${JSON.stringify(join(SRC_DIR, \'cli\', \'registry.ts\'))};`;',
    );

    expect(read('src/plan.test.ts', text)).toEqual([[1, ['src']], [2, ['src/cli/registry.ts']]]);
  });

  it('reads a constant bound with no path literal as the file\'s folder, and one constant built on another', () => {
    const text = lines(
      'const HERE = dirname(fileURLToPath(import.meta.url));',
      'const ROOT = join(HERE, \'..\', \'..\');',
      'const MODULE = join(ROOT, \'board\', \'epics.ts\');',
    );

    expect(read('src/commands/board/x.test.ts', text)).toEqual([[2, ['src']], [3, ['src/board/epics.ts']]]);
  });

  it('reads a relative string from the file\'s folder, a table row included', () => {
    const text = lines(
      'const DECLARED = [',
      '  [\'../issue/list.js\', ISSUE_LIST],',
      '];',
      'const probe = moduleUrl(\'../tests/output-sinks.ts\');',
    );

    expect(read('src/commands/board/x.test.ts', text)).toEqual([
      [2, ['src/commands/issue/list.js']],
      [4, ['src/commands/tests/output-sinks.ts']],
    ]);
  });

  it('leaves an import specifier, a comment and a line that builds no path', () => {
    const text = lines(
      'import { list } from \'../issue/list.js\';',
      '// Reads \'../issue/show.js\' by hand.',
      ' * and \'./sync.js\' in a doc line.',
      'const name = \'list\';',
    );
    const options = { isSpecifier: (line: number, literal: string): boolean => line === 1 && literal === '../issue/list.js' };

    expect(read('src/commands/board/x.test.ts', text, options)).toEqual([]);
  });

  it('reads a literal the specifier test does not name, so the test decides each one', () => {
    const text = lines('import { list } from \'../issue/list.js\';');

    expect(read('src/commands/board/x.test.ts', text)).toEqual([[1, ['src/commands/issue/list.js']]]);
  });

  it('reads an imported folder constant from the module that exports it, anchored there', () => {
    const helper = 'src/tests/next-chain-fixtures.ts';
    const imported = new Map<string, BuiltPath>([['SRC_DIR', { anchor: helper, path: 'src' }]]);
    const text = lines('const probe = join(SRC_DIR, \'cli\', \'registry.ts\');');

    const found = builtPaths('src/tests/next-loop.test.ts', text, { ...NO_SPECIFIER, imported }).lines;

    expect(found.map((line) => line.paths)).toEqual([[{ anchor: helper, path: 'src/cli/registry.ts' }]]);
  });

  it('exports the folder constants an export binds, and no other', () => {
    const text = lines(
      'export const SRC_DIR = join(import.meta.dir, \'..\');',
      'const LOCAL = join(import.meta.dir, \'fixtures\');',
    );

    const { exported } = builtPaths('src/tests/next-chain-fixtures.ts', text, NO_SPECIFIER);

    expect([...exported]).toEqual([['SRC_DIR', { anchor: 'src/tests/next-chain-fixtures.ts', path: 'src' }]]);
  });

  it('reads a name only where it stands alone, not inside a longer name or after a dot', () => {
    const text = lines(
      'const DIR = import.meta.dir;',
      'const a = join(OTHER_DIR, \'x.ts\');',
      'const b = join(config.DIR, \'y.ts\');',
    );

    expect(read('src/x.test.ts', text)).toEqual([]);
  });
});

describe('namedImports', () => {
  it('reads each binding across lines with its specifier, renames and type bindings apart', () => {
    const text = lines(
      'import {',
      '  SRC_DIR, type Scratch, git as runGit,',
      '} from \'./next-chain-fixtures.js\';',
      'import type { Only } from \'./types.js\';',
    );

    expect(namedImports(text)).toEqual([
      { local: 'SRC_DIR', name: 'SRC_DIR', specifier: './next-chain-fixtures.js' },
      { local: 'runGit', name: 'git', specifier: './next-chain-fixtures.js' },
      { local: 'Only', name: 'Only', specifier: './types.js' },
    ]);
  });
});

describe('codeForms', () => {
  it.each([
    ['a .js specifier form', 'src/a.js', ['src/a.js', 'src/a.ts']],
    ['a .mjs form', 'src/a.mjs', ['src/a.mjs', 'src/a.mts']],
    ['a .ts path', 'src/a.ts', ['src/a.ts']],
    ['a folder', 'src/board', ['src/board']],
  ])('reads %s', (_name, path, expected) => {
    expect(codeForms(path)).toEqual(expected);
  });
});

describe('shiftedPath', () => {
  it('reads the same way from the file\'s new folder', () => {
    expect(shiftedPath('src/board/x.test.ts', 'packages/rafa-board/src/board/x.test.ts', 'src/plan-prompt.md'))
      .toBe('packages/rafa-board/src/plan-prompt.md');
  });

  it('leaves a path built by a file that does not move', () => {
    expect(shiftedPath('src/plan.test.ts', 'src/plan.test.ts', 'src/cli/registry.ts')).toBe('src/cli/registry.ts');
  });
});

describe('pathTree', () => {
  it('holds every file and every folder above one', () => {
    expect([...pathTree(['src/board/a.ts', 'src/board/b.ts', 'README.md'])].sort()).toEqual(['README.md', 'src', 'src/board', 'src/board/a.ts', 'src/board/b.ts']);
  });
});
