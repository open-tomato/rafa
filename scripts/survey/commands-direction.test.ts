import type { CommandsEdge } from './commands-direction';
import type { ResolveImport } from './import-graph';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { COMMANDS_FOLDER, edgeLine, EXEMPT_IMPORTERS, readCommandsEdges } from './commands-direction';
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

/** Reads the edges of a planted tree, every file in `sources` handed in. */
function edgesOf(sources: Readonly<Record<string, string>>): readonly CommandsEdge[] {
  return readCommandsEdges({
    files: Object.keys(sources),
    resolve: resolveByPath,
    sources: new Map(Object.entries(sources)),
  }).edges;
}

const SHOW_EDGE: CommandsEdge = { from: 'src/board/place', to: 'src/commands/epic/show' };

describe('readCommandsEdges', () => {
  it('answers a static import into src/commands/ as one edge with no extension on either path', () => {
    const edges = edgesOf({
      'src/board/place.ts': 'import { firstNowEpic } from \'../commands/epic/show.js\';\n',
    });

    expect(edges).toEqual([SHOW_EDGE]);
  });

  it('answers an import type, an export from and a dynamic import() alike', () => {
    const edges = edgesOf({
      'src/board/dynamic.ts': 'export const load = async () => import(\'../commands/index.js\');\n',
      'src/board/reexport.ts': 'export { run } from \'../commands/next.js\';\nexport * from \'../commands/status.js\';\n',
      'src/board/typed.ts': 'import type { DoctorRow } from \'../commands/doctor.js\';\n',
    });

    expect(edges.map(edgeLine)).toEqual([
      'src/board/dynamic -> src/commands/index',
      'src/board/reexport -> src/commands/next',
      'src/board/reexport -> src/commands/status',
      'src/board/typed -> src/commands/doctor',
    ]);
  });

  it('answers a multi-line import, and a side-effect import with no binding', () => {
    const edges = edgesOf({
      'src/loop/run.ts': 'import {\n  a,\n  b,\n} from \'../commands/loop/start.js\';\nimport \'../commands/register.js\';\n',
    });

    expect(edges.map(edgeLine)).toEqual([
      'src/loop/run -> src/commands/loop/start',
      'src/loop/run -> src/commands/register',
    ]);
  });

  it('answers two imports of one module from one file as one edge', () => {
    const edges = edgesOf({
      'src/board/place.ts': [
        'import type { Epic } from \'../commands/epic/show.js\';',
        'import { firstNowEpic } from \'../commands/epic/show.js\';',
        '',
      ].join('\n'),
    });

    expect(edges).toEqual([SHOW_EDGE]);
  });

  it('answers nothing for an import that stays outside src/commands/, a package, or a folder that only starts alike', () => {
    const edges = edgesOf({
      'src/board/place.ts': [
        'import { rows } from \'./rows.js\';',
        'import { join } from \'node:path\';',
        'import { helper } from \'../commands-shared/helper.js\';',
        '',
      ].join('\n'),
    });

    expect(edges).toEqual([]);
  });

  it('answers nothing for a specifier written in a comment or a string', () => {
    const edges = edgesOf({
      'src/board/place.ts': [
        '// import { firstNowEpic } from \'../commands/epic/show.js\';',
        '/* export * from \'../commands/status.js\'; */',
        'export const hint = \'import("../commands/index.js")\';',
        '',
      ].join('\n'),
    });

    expect(edges).toEqual([]);
  });

  it('reads no file under src/commands/ itself', () => {
    const reading = readCommandsEdges({
      files: ['src/commands/epic/show.ts'],
      resolve: resolveByPath,
      sources: new Map([['src/commands/epic/show.ts', 'import { doctor } from \'../doctor.js\';\n']]),
    });

    expect(reading).toEqual({ edges: [], exempt: [], missing: [], read: [] });
  });

  it('reads no test file, a sweep included, and reads a test-support file', () => {
    const importing = 'import { run } from \'../commands/next.js\';\n';

    const reading = readCommandsEdges({
      files: ['src/next/state.test.ts', 'src/tests/commands.sweep.test.ts', 'src/tests/cli-capture.ts'],
      resolve: resolveByPath,
      sources: new Map([
        ['src/next/state.test.ts', importing],
        ['src/tests/commands.sweep.test.ts', importing],
        ['src/tests/cli-capture.ts', importing],
      ]),
    });

    expect(reading.read).toEqual(['src/tests/cli-capture.ts']);
    expect(reading.edges.map(edgeLine)).toEqual(['src/tests/cli-capture -> src/commands/next']);
  });

  it('leaves src/rafa.ts and src/plan.ts unread, exempt by name, and names them', () => {
    const reading = readCommandsEdges({
      files: ['src/rafa.ts', 'src/plan.ts', 'src/index.ts'],
      resolve: resolveByPath,
      sources: new Map([
        ['src/rafa.ts', 'import { coreRoster } from \'./commands/index.js\';\n'],
        ['src/plan.ts', 'import { expectNoArgument } from \'./commands/plan/plan-files.js\';\n'],
        ['src/index.ts', 'export { coreRoster } from \'./commands/index.js\';\n'],
      ]),
    });

    expect(EXEMPT_IMPORTERS).toEqual(['src/plan.ts', 'src/rafa.ts']);
    expect(reading.exempt).toEqual(['src/plan.ts', 'src/rafa.ts']);
    expect(reading.read).toEqual(['src/index.ts']);
    expect(reading.edges.map(edgeLine)).toEqual(['src/index -> src/commands/index']);
  });

  it('exempts by the whole path only: another rafa.ts or plan.ts is read', () => {
    const edges = edgesOf({
      'packages/rafa-hub/src/rafa.ts': 'import { coreRoster } from \'../../../src/commands/index.js\';\n',
      'src/plan/plan.ts': 'import { create } from \'../commands/plan/create.js\';\n',
    });

    expect(edges.map(edgeLine)).toEqual([
      'packages/rafa-hub/src/rafa -> src/commands/index',
      'src/plan/plan -> src/commands/plan/create',
    ]);
  });

  it('names a covered file with no source text under missing, and counts it as not read', () => {
    const reading = readCommandsEdges({
      files: ['src/board/place.ts', 'src/board/rows.ts'],
      resolve: resolveByPath,
      sources: new Map([['src/board/rows.ts', '']]),
    });

    expect(reading.missing).toEqual(['src/board/place.ts']);
    expect(reading.read).toEqual(['src/board/rows.ts']);
  });

  it('answers the edges sorted by line and the files read sorted, whatever order the files arrive in', () => {
    const sources = new Map([
      ['src/z.ts', 'import \'./commands/a.js\';\n'],
      ['src/a.ts', 'import \'./commands/z.js\';\nimport \'./commands/b.js\';\n'],
    ]);

    const reading = readCommandsEdges({ files: ['src/z.ts', 'src/a.ts', 'src/z.ts'], resolve: resolveByPath, sources });

    expect(reading.read).toEqual(['src/a.ts', 'src/z.ts']);
    expect(reading.edges.map(edgeLine)).toEqual([
      'src/a -> src/commands/b',
      'src/a -> src/commands/z',
      'src/z -> src/commands/a',
    ]);
  });

  it('adds no edge for a specifier the resolver cannot reach', () => {
    const reading = readCommandsEdges({
      files: ['src/board/place.ts'],
      resolve: () => undefined,
      sources: new Map([['src/board/place.ts', 'import { firstNowEpic } from \'../commands/epic/show.js\';\n']]),
    });

    expect(reading.edges).toEqual([]);
    expect(reading.read).toEqual(['src/board/place.ts']);
  });

  it('reads a planted tree through bunResolver, a folder import reaching its index included', () => {
    const root = mkdtempSync(join(tmpdir(), 'survey-commands-direction-'));
    const planted: Readonly<Record<string, string>> = {
      'src/board/place.ts': 'import { firstNowEpic } from \'../commands/epic/show.js\';\nimport { rows } from \'./rows.js\';\n',
      'src/board/rows.ts': 'export const rows = 1;\n',
      'src/commands/epic/show.ts': 'export const firstNowEpic = 1;\n',
      'src/commands/index.ts': 'export const coreRoster = 1;\n',
      'src/index.ts': 'export { coreRoster } from \'./commands\';\n',
    };
    try {
      for (const [path, text] of Object.entries(planted)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
      }

      const reading = readCommandsEdges({
        files: Object.keys(planted),
        resolve: bunResolver(root),
        sources: new Map(Object.entries(planted)),
      });

      expect(reading.edges.map(edgeLine)).toEqual([
        'src/board/place -> src/commands/epic/show',
        'src/index -> src/commands/index',
      ]);
      expect(reading.read).toEqual(['src/board/place.ts', 'src/board/rows.ts', 'src/index.ts']);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe('edgeLine', () => {
  it('spells an edge as `<importer path> -> <module path under src/commands/>`', () => {
    expect(edgeLine(SHOW_EDGE)).toBe('src/board/place -> src/commands/epic/show');
    expect(SHOW_EDGE.to.startsWith(COMMANDS_FOLDER)).toBe(true);
  });
});
