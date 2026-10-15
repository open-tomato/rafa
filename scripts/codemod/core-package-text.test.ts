import type { Edit } from './core-package-text';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import {
  applyEdits,
  flipEdits,
  importedName,
  parseSource,
  proseSpans,
  readReexports,
  relativeSpecifier,
  renameClusterMap,
  specifierSites,
  splitDeclaration,
  takenNames,
  tokenEdits,
} from './core-package-text';

function lines(...text: readonly string[]): string {
  return `${text.join('\n')}\n`;
}

/** The text of every specifier a file writes, in source order. */
function specifiersOf(text: string): string[] {
  return specifierSites(parseSource('src/a.ts', text)).map((site) => site.node.text);
}

/** The text of every span step 7 reads in a file. */
function spansOf(text: string): string[] {
  const source = parseSource('src/a.ts', text);
  const positions = new Set(specifierSites(source).map((site) => site.node.getStart(source)));
  return proseSpans(source, positions).map(([pos, end]) => text.slice(pos, end))
    .sort();
}

/** A text with every path token rewritten by a rule that prefixes `new/`. */
function prefixed(text: string): string {
  return applyEdits(text, tokenEdits(text, [0, text.length], (token) => `new/${token}`)) ?? '';
}

/** The first import or export declaration of a text. */
function firstDeclaration(text: string): { source: ts.SourceFile; declaration: ts.ExportDeclaration | ts.ImportDeclaration } {
  const source = parseSource('src/a.ts', text);
  const declaration = source.statements.find((statement) => ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement));
  if (declaration === undefined || !(ts.isImportDeclaration(declaration) || ts.isExportDeclaration(declaration))) {
    throw new Error('no declaration');
  }
  return { declaration, source };
}

describe('relativeSpecifier', () => {
  it.each([
    ['a parked test to a root file, .js kept', 'src/tests/core-coupled/core/config/x.test.ts', 'src/config-registry.ts', '../../config-registry.js', '../../../../config-registry.js'],
    ['a sibling, opening with ./', 'src/tests/core-coupled/x.test.ts', 'src/tests/core-coupled/y.ts', './y.js', './y.js'],
    ['a .ts specifier keeps .ts', 'src/a/b.ts', 'src/c/d.ts', '../c/d.ts', '../c/d.ts'],
    ['an extensionless one drops the extension', 'src/a/b.ts', 'src/c/d.ts', '../c/d', '../c/d'],
    ['an extensionless folder drops /index', 'src/a/b.ts', 'src/core/plan/index.ts', '../core/plan', '../core/plan'],
    ['an extensionless /index keeps it', 'src/a/b.ts', 'src/core/plan/index.ts', '../core/plan/index', '../core/plan/index'],
    ['a data file keeps its extension', 'src/tests/core-coupled/core/command/v.test.ts', 'package.json', '../../../package.json', '../../../../../package.json'],
  ])('spells %s', (_name, from, target, original, expected) => {
    expect(relativeSpecifier(from, target, original)).toBe(expected);
  });
});

describe('tokenEdits', () => {
  it('rewrites a path opening with src/, and one under ../', () => {
    expect(prefixed('see src/core/x.ts and ../src/ports/')).toBe('see new/src/core/x.ts and ../new/src/ports/');
  });

  it('leaves a path whose src/ follows a folder name, a word or a dash', () => {
    const text = 'packages/rafa/src/core/ dist/src/core/ mysrc/core/ a-src/core/';
    expect(prefixed(text)).toBe(text);
  });

  it('keeps a closing period out of the path', () => {
    expect(prefixed('Core is src/core.')).toBe('Core is new/src/core.');
  });

  it('writes nothing for a token the rule declines', () => {
    const text = 'src/core/x.ts';
    expect(tokenEdits(text, [0, text.length], () => undefined)).toEqual([]);
  });

  it('reads only inside the span', () => {
    const text = 'src/a src/b';
    expect(tokenEdits(text, [6, text.length], (token) => `x/${token}`)).toEqual([{ end: 11, pos: 6, text: 'x/src/b' }]);
  });
});

describe('applyEdits', () => {
  it('applies edits handed in any order', () => {
    const edits: Edit[] = [{ end: 1, pos: 0, text: 'A' }, { end: 3, pos: 2, text: 'C' }];
    expect(applyEdits('abc', edits)).toBe('AbC');
  });

  it('answers undefined for two edits of one span', () => {
    expect(applyEdits('abc', [{ end: 2, pos: 0, text: 'x' }, { end: 3, pos: 1, text: 'y' }])).toBeUndefined();
  });
});

describe('specifierSites', () => {
  it('reads every kind of specifier, and no other string', () => {
    const text = lines(
      'import type { A } from \'./type.js\';',
      'import { b } from \'./value.js\';',
      'import \'./side.js\';',
      'export { c } from \'./reexport.js\';',
      'import fs = require(\'./equals.js\');',
      'const d = await import(\'./dynamic.js\');',
      'const e = require(\'./required.js\');',
      'type F = import(\'./type-import.js\').F;',
      'declare module \'./augmented.js\' { interface G { readonly g: string } }',
      'mock.module(\'./mocked.js\', () => ({}));',
      'const h = \'./plain.js\';',
    );
    expect(specifiersOf(text)).toEqual([
      './type.js',
      './value.js',
      './side.js',
      './reexport.js',
      './equals.js',
      './dynamic.js',
      './required.js',
      './type-import.js',
      './augmented.js',
    ]);
  });
});

describe('proseSpans', () => {
  it('reads comments, strings and template parts, each once, and no specifier', () => {
    const text = lines(
      '/** A doc comment. */',
      'import { b } from \'./value.js\';',
      '// A line comment.',
      'export const s = \'a string\';',
      'export const t = `head ${s} tail`;',
      'export const u = f(/* inline */);',
    );
    expect(spansOf(text)).toEqual([
      '\'a string\'',
      '/* inline */',
      '// A line comment.',
      '/** A doc comment. */',
      '`head ${',
      '} tail`',
    ].sort());
  });
});

describe('takenNames and importedName', () => {
  it('answers the named elements of an import, and their names before `as`', () => {
    const { declaration } = firstDeclaration('import { a, b as c } from \'./x.js\';\n');
    expect(takenNames(declaration)?.map(importedName)).toEqual(['a', 'b']);
  });

  it('answers none for a bare import', () => {
    expect(takenNames(firstDeclaration('import \'./x.js\';\n').declaration)).toEqual([]);
  });

  it.each([
    ['a default binding', 'import x from \'./x.js\';\n'],
    ['a namespace binding', 'import * as x from \'./x.js\';\n'],
    ['export *', 'export * from \'./x.js\';\n'],
  ])('answers undefined for %s', (_name, text) => {
    expect(takenNames(firstDeclaration(text).declaration)).toBeUndefined();
  });
});

describe('splitDeclaration', () => {
  it('keeps the other names and moves the block to a line of its own, type and alias kept', () => {
    const { declaration, source } = firstDeclaration('import type { A, B as C, D } from \'./t.js\';\n');
    const block = (takenNames(declaration) ?? []).filter((element) => importedName(element) === 'B');
    expect(splitDeclaration(source, declaration, './t.js', block, '@open-tomato/rafa/core/plan')).toBe(
      'import type { A, D } from \'./t.js\';\nimport type { B as C } from \'@open-tomato/rafa/core/plan\';',
    );
  });

  it('splits an export declaration as an export', () => {
    const { declaration, source } = firstDeclaration('export { a, b } from \'./t.js\';\n');
    const block = (takenNames(declaration) ?? []).filter((element) => importedName(element) === 'a');
    expect(splitDeclaration(source, declaration, './t.js', block, 'x')).toBe('export { b } from \'./t.js\';\nexport { a } from \'x\';');
  });
});

describe('flipEdits', () => {
  it('flips both constants and leaves the rest', () => {
    const text = lines(
      'export const CORE_SOURCE = \'packages/rafa/src/\';',
      'export const CORE_FOLDERS: readonly string[] = [\'src/core/\', \'src/ports/\'];',
      'export const CORE_NAMED_FILES: readonly string[] = [',
      '  \'src/report/parse.ts\',',
      '];',
    );
    const flip = flipEdits(parseSource('scripts/survey/core-moves.ts', text));
    expect(flip.flipped).toEqual(['CORE_FOLDERS', 'CORE_NAMED_FILES']);
    expect(applyEdits(text, flip.edits)).toBe(lines(
      'export const CORE_SOURCE = \'packages/rafa/src/\';',
      'export const CORE_FOLDERS: readonly string[] = [CORE_SOURCE];',
      'export const CORE_NAMED_FILES: readonly string[] = [];',
    ));
  });

  it('finds nothing in a file without them', () => {
    expect(flipEdits(parseSource('x.ts', 'export const A = 1;\n'))).toEqual({ edits: [], flipped: [] });
  });
});

describe('renameClusterMap', () => {
  it('renames keys and outside entries in place, keeping their order and the file\'s format', () => {
    const text = `${JSON.stringify({ base: 'abc', clusters: { 'src/z.ts': 'c1', 'src/core/a.ts': 'c2' }, outside: ['src/ports/index.ts', 'src/y.ts'] }, null, 2)}\n`;
    const finals = new Map([['src/core/a.ts', 'packages/rafa/src/core/a.ts'], ['src/ports/index.ts', 'packages/rafa/src/ports/index.ts']]);
    const renamed = renameClusterMap(text, finals);
    expect(renamed.renamed).toEqual([
      { from: 'src/core/a.ts', to: 'packages/rafa/src/core/a.ts' },
      { from: 'src/ports/index.ts', to: 'packages/rafa/src/ports/index.ts' },
    ]);
    expect(renamed.text).toBe(`${JSON.stringify({
      base: 'abc',
      clusters: { 'src/z.ts': 'c1', 'packages/rafa/src/core/a.ts': 'c2' },
      outside: ['packages/rafa/src/ports/index.ts', 'src/y.ts'],
    }, null, 2)}\n`);
  });

  it('answers the same text when nothing it names moves', () => {
    const text = `${JSON.stringify({ base: 'abc', clusters: { 'src/z.ts': 'c1' }, outside: [] }, null, 2)}\n`;
    expect(renameClusterMap(text, new Map()).text).toBe(text);
  });
});

describe('readReexports', () => {
  const NOTE = '/** Kept until #1090. */\n';
  const resolve = (specifier: string, from: string): string | undefined => {
    const folder = from.slice(0, from.lastIndexOf('/'));
    const joined = `${folder}/${specifier}`.replace(/\/\.\//g, '/');
    const parts: string[] = [];
    for (const part of joined.split('/')) {
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return parts.join('/').replace(/\.js$/, '.ts');
  };
  const isCore = (path: string): boolean => path.startsWith('src/core/');

  function read(files: Readonly<Record<string, string>>): ReturnType<typeof readReexports> {
    return readReexports({ files: Object.keys(files), resolve, sources: new Map(Object.entries(files)) }, isCore);
  }

  it('deletes a file of re-exports into one core file, and names that file', () => {
    const result = read({ 'src/old.ts': `${NOTE}export type { A } from './core/a.js';\nexport { b } from './core/a.js';\n` });
    expect([...result.deleted]).toEqual([['src/old.ts', 'src/core/a.ts']]);
    expect(result.trimmed.size).toBe(0);
    expect(result.refusals).toEqual([]);
  });

  it('trims a file that holds other code, with the block\'s names and one removal per declaration', () => {
    const text = `import { a } from './core/a.js';\n${NOTE}export { a, b as c } from './core/a.js';\n\nexport const d = a;\n`;
    const result = read({ 'src/mixed.ts': text });
    expect(result.deleted.size).toBe(0);
    expect(result.trimmed.get('src/mixed.ts')?.target).toBe('src/core/a.ts');
    expect([...(result.trimmed.get('src/mixed.ts')?.names ?? [])]).toEqual(['a', 'c']);
    expect(applyEdits(text, result.edits.get('src/mixed.ts') ?? [])).toBe('import { a } from \'./core/a.js\';\n\nexport const d = a;\n');
  });

  it('refuses a file that re-exports two core files', () => {
    const result = read({ 'src/two.ts': `${NOTE}export { a } from './core/a.js';\nexport { b } from './core/b.js';\n` });
    expect(result.refusals.map((note) => [note.file, note.line])).toEqual([['src/two.ts', 2]]);
    expect(result.deleted.size).toBe(0);
  });

  it('reads no file without the note, no core file, and none whose re-exports stay outside core', () => {
    const result = read({
      'src/core/inner.ts': `${NOTE}export { a } from './a.js';\n`,
      'src/elsewhere.ts': `${NOTE}export { x } from './x.js';\n`,
      'src/plain.ts': 'export { a } from \'./core/a.js\';\n',
    });
    expect(result.deleted.size + result.trimmed.size + result.refusals.length).toBe(0);
  });
});
