import type { CoreImport, CoreImports } from './core-barrels';
import type { ResolveImport } from './import-graph';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { deepImportLine, importLine, isCodeFile, readCoreImports, subjectBarrels } from './core-barrels';
import { barrelPaths, CORE_FOLDER } from './core-moves';
import { bunResolver } from './import-graph';

/**
 * A resolver over paths alone: a relative `.js` specifier reaches the
 * `.ts` file beside it, anything else reaches nothing.
 */
const resolveByPath: ResolveImport = (specifier, from) => {
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  return posix.join(posix.dirname(from), specifier).replace(/\.js$/, '.ts');
};

/** Reads a planted tree, every file in `sources` handed in, against the barrels of `core-moves.ts`. */
function readingOf(sources: Readonly<Record<string, string>>): CoreImports {
  return readCoreImports({
    files: Object.keys(sources),
    resolve: resolveByPath,
    sources: new Map(Object.entries(sources)),
  });
}

/** The deep imports of a planted tree, one line each. */
function deepLinesOf(sources: Readonly<Record<string, string>>): readonly string[] {
  return readingOf(sources).deep.map(importLine);
}

const LOAD_EDGE: CoreImport = { from: 'src/board/place.ts', to: 'src/core/config/config-load.ts' };

describe('readCoreImports', () => {
  it('answers a static import of a file behind a barrel as one deep import, both paths whole', () => {
    const reading = readingOf({
      'src/board/place.ts': 'import { loadConfig } from \'../core/config/config-load.js\';\n',
    });

    expect(reading.deep).toEqual([LOAD_EDGE]);
    expect(reading.barrel).toEqual([]);
  });

  it('answers an import of a barrel as a barrel import and never a deep one, the second config barrel included', () => {
    const reading = readingOf({
      'src/board/place.ts': [
        'import { loadConfig } from \'../core/config/index.js\';',
        'import { messageOf } from \'../core/config/sections.js\';',
        'import { parsePlan } from \'../core/plan/index.js\';',
        '',
      ].join('\n'),
    });

    expect(reading.deep).toEqual([]);
    expect(reading.barrel.map(importLine)).toEqual([
      'src/board/place.ts -> src/core/config/index.ts',
      'src/board/place.ts -> src/core/config/sections.ts',
      'src/board/place.ts -> src/core/plan/index.ts',
    ]);
  });

  it('tells the barrel from the file it stands in front of, in one folder', () => {
    const reading = readingOf({
      'src/board/place.ts': [
        'import { messageOf } from \'../core/config/sections.js\';',
        'import { configError } from \'../core/config/config-sections.js\';',
        '',
      ].join('\n'),
    });

    expect(reading.barrel.map(importLine)).toEqual(['src/board/place.ts -> src/core/config/sections.ts']);
    expect(reading.deep.map(importLine)).toEqual(['src/board/place.ts -> src/core/config/config-sections.ts']);
  });

  it('answers an import type, an export from, a dynamic import() and a require alike', () => {
    const lines = deepLinesOf({
      'src/board/dynamic.ts': 'export const load = async () => import(\'../core/git/git.js\');\n',
      'src/board/reexport.ts': 'export { commit } from \'../core/git/commit.js\';\nexport * from \'../core/loop/sessions.js\';\n',
      'src/board/required.ts': 'const blocks = require(\'../core/plan/blocks.js\');\n',
      'src/board/typed.ts': 'import type { RafaConfig } from \'../core/config/config.js\';\n',
    });

    expect(lines).toEqual([
      'src/board/dynamic.ts -> src/core/git/git.ts',
      'src/board/reexport.ts -> src/core/git/commit.ts',
      'src/board/reexport.ts -> src/core/loop/sessions.ts',
      'src/board/required.ts -> src/core/plan/blocks.ts',
      'src/board/typed.ts -> src/core/config/config.ts',
    ]);
  });

  it('reads a test file, a sweep, a test-support file, a script, a package file and a root config alike', () => {
    const importing = (prefix: string): string => `import { parsePlan } from '${prefix}core/plan/parse.js';\n`;

    const reading = readingOf({
      'eslint.config.mjs': importing('./src/'),
      'packages/rafa-hub/src/hub.ts': importing('../../../src/'),
      'scripts/snapshot-runtime.ts': importing('../src/'),
      'src/next/state.test.ts': importing('../'),
      'src/tests/cli-capture.ts': importing('../'),
      'src/tests/default-plan-dirs.sweep.test.ts': importing('../'),
    });

    expect(reading.read).toEqual([
      'eslint.config.mjs',
      'packages/rafa-hub/src/hub.ts',
      'scripts/snapshot-runtime.ts',
      'src/next/state.test.ts',
      'src/tests/cli-capture.ts',
      'src/tests/default-plan-dirs.sweep.test.ts',
    ]);
    expect(reading.deep.map((edge) => edge.from)).toEqual([...reading.read]);
    expect(new Set(reading.deep.map((edge) => edge.to))).toEqual(new Set(['src/core/plan/parse.ts']));
  });

  it('reads no file inside src/core/, a sibling import and a colocated test included, and names them', () => {
    const reading = readingOf({
      'src/core/config/config-load.test.ts': 'import { loadConfig } from \'./config-load.js\';\n',
      'src/core/config/config-load.ts': 'import { SETTINGS } from \'./config-schema.js\';\n',
      'src/core/config/index.ts': 'export { loadConfig } from \'./config-load.js\';\n',
      'src/core/plan/parse.ts': 'import { readGit } from \'../git/git.js\';\n',
    });

    expect(reading).toEqual({
      barrel: [],
      deep: [],
      inside: [
        'src/core/config/config-load.test.ts',
        'src/core/config/config-load.ts',
        'src/core/config/index.ts',
        'src/core/plan/parse.ts',
      ],
      missing: [],
      read: [],
    });
  });

  it('reads no file that is not code, and counts it neither as read nor as missing', () => {
    const reading = readCoreImports({
      files: ['context/source.md', 'docs/survey/cluster-map.json', 'src/board/place.ts', 'src/core/config/notes.md'],
      resolve: resolveByPath,
      sources: new Map([['src/board/place.ts', '']]),
    });

    expect(reading).toEqual({ barrel: [], deep: [], inside: [], missing: [], read: ['src/board/place.ts'] });
  });

  it('answers an index.ts below a subject folder, and one directly in src/core/, as deep: neither is a listed barrel', () => {
    const lines = deepLinesOf({
      'src/board/place.ts': [
        'import { a } from \'../core/config/nested/index.js\';',
        'import { b } from \'../core/index.js\';',
        '',
      ].join('\n'),
    });

    expect(lines).toEqual([
      'src/board/place.ts -> src/core/config/nested/index.ts',
      'src/board/place.ts -> src/core/index.ts',
    ]);
  });

  it('answers nothing for an import that stays outside src/core/, a package, or a folder that only starts alike', () => {
    const reading = readingOf({
      'src/board/place.ts': [
        'import { rows } from \'./rows.js\';',
        'import { join } from \'node:path\';',
        'import { helper } from \'../core-shared/helper.js\';',
        'import { config } from \'../config.js\';',
        '',
      ].join('\n'),
      'src/corelib/reader.ts': 'import { rows } from \'./rows.js\';\n',
    });

    expect(reading.deep).toEqual([]);
    expect(reading.barrel).toEqual([]);
    expect(reading.inside).toEqual([]);
    expect(reading.read).toEqual(['src/board/place.ts', 'src/corelib/reader.ts']);
  });

  it('answers nothing for a specifier written in a comment or a string', () => {
    const lines = deepLinesOf({
      'src/board/place.ts': [
        '// import { loadConfig } from \'../core/config/config-load.js\';',
        '/* export * from \'../core/git/git.js\'; */',
        'export const hint = \'import("../core/plan/parse.js")\';',
        '',
      ].join('\n'),
    });

    expect(lines).toEqual([]);
  });

  it('does not see a mock.module() call, an import() of no string literal, or a path built for a file read', () => {
    const lines = deepLinesOf({
      'src/board/place.test.ts': [
        'mock.module(\'../core/config/config-load.js\', () => ({}));',
        'const name = \'../core/git/git.js\';',
        'export const load = async () => import(name);',
        'export const entry = join(root, \'src/core/plan/parse.ts\');',
        '',
      ].join('\n'),
    });

    expect(lines).toEqual([]);
  });

  it('answers two imports of one file from one importer as one edge', () => {
    const reading = readingOf({
      'src/board/place.ts': [
        'import type { RafaConfig } from \'../core/config/config-load.js\';',
        'import { loadConfig } from \'../core/config/config-load.js\';',
        'import type { Settings } from \'../core/config/index.js\';',
        'import { SETTINGS } from \'../core/config/index.js\';',
        '',
      ].join('\n'),
    });

    expect(reading.deep).toEqual([LOAD_EDGE]);
    expect(reading.barrel).toEqual([{ from: 'src/board/place.ts', to: 'src/core/config/index.ts' }]);
  });

  it('names a covered file with no source text under missing, and counts it as not read', () => {
    const reading = readCoreImports({
      files: ['src/board/place.ts', 'src/board/rows.ts'],
      resolve: resolveByPath,
      sources: new Map([['src/board/rows.ts', '']]),
    });

    expect(reading.missing).toEqual(['src/board/place.ts']);
    expect(reading.read).toEqual(['src/board/rows.ts']);
  });

  it('answers every list sorted and free of duplicates, whatever order the files arrive in', () => {
    const sources = new Map([
      ['src/z.ts', 'import \'./core/git/git.js\';\nimport \'./core/git/index.js\';\n'],
      ['src/a.ts', 'import \'./core/plan/parse.js\';\nimport \'./core/git/commit.js\';\nimport \'./core/adapters/index.js\';\n'],
      ['src/core/git/git.ts', ''],
    ]);

    const reading = readCoreImports({
      files: ['src/z.ts', 'src/core/git/git.ts', 'src/a.ts', 'src/z.ts', 'src/core/git/git.ts'],
      resolve: resolveByPath,
      sources,
    });

    expect(reading.read).toEqual(['src/a.ts', 'src/z.ts']);
    expect(reading.inside).toEqual(['src/core/git/git.ts']);
    expect(reading.deep.map(importLine)).toEqual([
      'src/a.ts -> src/core/git/commit.ts',
      'src/a.ts -> src/core/plan/parse.ts',
      'src/z.ts -> src/core/git/git.ts',
    ]);
    expect(reading.barrel.map(importLine)).toEqual([
      'src/a.ts -> src/core/adapters/index.ts',
      'src/z.ts -> src/core/git/index.ts',
    ]);
  });

  it('adds no edge for a specifier the resolver cannot reach', () => {
    const reading = readCoreImports({
      files: ['src/board/place.ts'],
      resolve: () => undefined,
      sources: new Map([['src/board/place.ts', 'import { loadConfig } from \'../core/config/config-load.js\';\n']]),
    });

    expect(reading.deep).toEqual([]);
    expect(reading.barrel).toEqual([]);
    expect(reading.read).toEqual(['src/board/place.ts']);
  });

  it('holds an import to the barrels handed in, and to those of core-moves.ts when none are', () => {
    const sources = new Map([
      ['src/board/place.ts', 'import \'../core/git/index.js\';\nimport \'../core/git/runner.js\';\n'],
    ]);
    const input = { files: ['src/board/place.ts'], resolve: resolveByPath, sources };

    const planted = readCoreImports({ ...input, barrels: ['src/core/git/runner.ts'] });
    const listed = readCoreImports(input);

    expect(planted.deep.map((edge) => edge.to)).toEqual(['src/core/git/index.ts']);
    expect(planted.barrel.map((edge) => edge.to)).toEqual(['src/core/git/runner.ts']);
    expect(listed.deep.map((edge) => edge.to)).toEqual(['src/core/git/runner.ts']);
    expect(listed.barrel.map((edge) => edge.to)).toEqual(['src/core/git/index.ts']);
  });

  it('answers every file listed under src/core/ as deep when no barrel is handed in: it takes no allow-list', () => {
    const importing = barrelPaths().map((barrel) => `import '../${barrel.replace(/\.ts$/, '.js')}';`);
    const sources = new Map([['src/a.ts', importing.join('\n')]]);

    const reading = readCoreImports({ barrels: [], files: ['src/a.ts'], resolve: resolveByPath, sources });

    expect(reading.barrel).toEqual([]);
    expect(reading.deep.map((edge) => edge.to)).toEqual([...barrelPaths()]);
  });

  it('reads a planted tree through bunResolver, a folder import reaching its barrel included', () => {
    const root = mkdtempSync(join(tmpdir(), 'survey-core-barrels-'));
    const planted: Readonly<Record<string, string>> = {
      'scripts/extract.ts': 'import { messageOf } from \'../src/core/config/config-sections.js\';\n',
      'src/board/place.ts': 'import { loadConfig } from \'../core/config\';\nimport { rows } from \'./rows.js\';\n',
      'src/board/place.test.ts': 'import { loadConfig } from \'../core/config/config-load.js\';\n',
      'src/board/rows.ts': 'import { messageOf } from \'../core/config/sections.js\';\nexport const rows = 1;\n',
      'src/core/config/config-load.ts': 'import { messageOf } from \'./config-sections.js\';\nexport const loadConfig = messageOf;\n',
      'src/core/config/config-sections.ts': 'export const messageOf = 1;\n',
      'src/core/config/index.ts': 'export { loadConfig } from \'./config-load.js\';\n',
      'src/core/config/sections.ts': 'export { messageOf } from \'./config-sections.js\';\n',
    };
    try {
      for (const [path, text] of Object.entries(planted)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
      }

      const reading = readCoreImports({
        files: Object.keys(planted),
        resolve: bunResolver(root),
        sources: new Map(Object.entries(planted)),
      });

      expect(reading.deep.map(importLine)).toEqual([
        'scripts/extract.ts -> src/core/config/config-sections.ts',
        'src/board/place.test.ts -> src/core/config/config-load.ts',
      ]);
      expect(reading.barrel.map(importLine)).toEqual([
        'src/board/place.ts -> src/core/config/index.ts',
        'src/board/rows.ts -> src/core/config/sections.ts',
      ]);
      expect(reading.read).toEqual(['scripts/extract.ts', 'src/board/place.test.ts', 'src/board/place.ts', 'src/board/rows.ts']);
      expect(reading.inside).toHaveLength(4);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe('isCodeFile', () => {
  it('answers a TypeScript or JavaScript file of any module kind as code', () => {
    const code = ['a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs', 'src/a.test.ts', 'types/a.d.ts'];

    expect(code.filter(isCodeFile)).toEqual(code);
  });

  it('answers a data or prose file, and a name that only ends alike, as not code', () => {
    const other = ['a.json', 'a.md', 'a.yaml', 'a.txt', 'a.ts.snap', 'notes', 'ats', 'a.css'];

    expect(other.filter(isCodeFile)).toEqual([]);
  });
});

describe('importLine and deepImportLine', () => {
  it('spells an import as `<importer path> -> <path under src/core/>`', () => {
    expect(importLine(LOAD_EDGE)).toBe('src/board/place.ts -> src/core/config/config-load.ts');
    expect(LOAD_EDGE.to.startsWith(CORE_FOLDER)).toBe(true);
  });

  it('names the barrels of the subject a deep import reaches into', () => {
    expect(deepImportLine(LOAD_EDGE)).toBe(
      'src/board/place.ts -> src/core/config/config-load.ts '
      + '(import src/core/config/index.ts or src/core/config/load.ts or src/core/config/sections.ts)',
    );
    expect(deepImportLine({ from: 'src/a.ts', to: 'src/core/git/hooks/run.ts' })).toBe(
      'src/a.ts -> src/core/git/hooks/run.ts (import src/core/git/index.ts)',
    );
  });

  it('says so when the folder a deep import reaches into has no listed barrel', () => {
    expect(deepImportLine({ from: 'src/a.ts', to: 'src/core/index.ts' })).toBe(
      'src/a.ts -> src/core/index.ts (no barrel is listed for it in scripts/survey/core-moves.ts)',
    );
    expect(deepImportLine(LOAD_EDGE, ['src/core/git/index.ts'])).toBe(
      'src/board/place.ts -> src/core/config/config-load.ts (no barrel is listed for it in scripts/survey/core-moves.ts)',
    );
  });
});

describe('subjectBarrels', () => {
  it('answers the barrels in the subject folder of a path under src/core/, sorted', () => {
    expect(subjectBarrels('src/core/config/config-load.ts')).toEqual([
      'src/core/config/index.ts',
      'src/core/config/load.ts',
      'src/core/config/sections.ts',
    ]);
    expect(subjectBarrels('src/core/plan/deep/er/file.ts')).toEqual(['src/core/plan/index.ts']);
  });

  it('answers none for a path directly in src/core/, a folder with no barrel, or a path outside it', () => {
    expect(subjectBarrels('src/core/index.ts')).toEqual([]);
    expect(subjectBarrels('src/core/unlisted/file.ts')).toEqual([]);
    expect(subjectBarrels('src/plan/index.ts')).toEqual([]);
  });
});
