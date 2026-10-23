/**
 * The pass-moves codemod over planted git repositories: a tree shaped as
 * rafa's is before a pass, with core already its package, read back after
 * each run. The move list is planted with the tree, under
 * `scripts/codemod/moves/`, and handed to `main` by `--list=`.
 */
import type { PassMovesPlan } from './pass-moves';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  applyPassMoves,
  CLUSTER_MAP_FILE,
  main,
  metaPaths,
  readPassMoves,
  reportLines,
  rewriteMovedPath,
  USAGE,
} from './pass-moves';

function lines(...text: readonly string[]): string {
  return `${text.join('\n')}\n`;
}

/** The planted move list's path, under the planted root. */
const LIST_PATH = 'scripts/codemod/moves/plant.ts';

/** The planted pass: five files, two folders, a section file at `src/`. */
const MOVES: readonly { readonly from: string; readonly to: string }[] = [
  { from: 'src/config-schema-bugs.ts', to: 'packages/rafa/src/config-schema-bugs.ts' },
  { from: 'src/modules/load.ts', to: 'packages/rafa/src/modules/load.ts' },
  { from: 'src/modules/manifest.ts', to: 'packages/rafa/src/modules/manifest.ts' },
  { from: 'src/utils/git.ts', to: 'packages/rafa/src/utils/git.ts' },
  { from: 'src/utils/tracker.ts', to: 'packages/rafa/src/utils/tracker.ts' },
];

function listText(moves: readonly { readonly from: string; readonly to: string }[]): string {
  return `export const PLANTED_MOVES = ${JSON.stringify(moves, null, 2)};\n`;
}

const CLUSTER_MAP = {
  base: 'abc1234',
  clusters: { 'src/app.ts': 'c1', 'src/utils/tracker.test.ts': 'c2', 'src/utils/tracker.ts': 'c2' },
  outside: ['src/modules/load.ts'],
};

const APP_TEXT = lines(
  '// The tracker lives in src/utils/tracker.ts, tested by src/utils/tracker.test.ts; see src/utils/git too.',
  'import type { Seen } from \'./utils/tracker.js\';',
  '',
  'import { tracker } from \'./utils/tracker.js\';',
  'import { extra } from \'./utils/git-extra.js\';',
  '',
  'export { git } from \'./utils/git.js\';',
  '',
  'declare module \'./config-schema-bugs.js\' {',
  '  interface Extra { readonly extra: string }',
  '}',
  '',
  'export const loaded = [tracker, extra, import(\'./modules/load.js\'), require(\'./utils/git.js\')];',
  'export type Typed = Seen | typeof import(\'./modules/manifest.js\');',
  'export const FIXTURE = \'src/modules/testdata/fixture/sync.ts\';',
  'export const KEPT = [\'packages/rafa/src/utils/tracker.ts\', \'src/utils/git-extra.ts\'];',
);

const TRACKER_TEXT = lines(
  '/** Reads the plan; its sibling is src/utils/git.ts. */',
  'import type { RafaConfig } from \'@open-tomato/rafa/core/config/config-schema\';',
  '',
  'import { sections } from \'@open-tomato/rafa/core/config/sections\';',
  'import { store } from \'@open-tomato/rafa/store\';',
  '',
  'import { git } from \'./git.js\';',
  '',
  'export const tracker = [sections, store, git];',
  'export type Seen = RafaConfig;',
);

const SECTION_TEXT = lines(
  'import { sections } from \'@open-tomato/rafa/core/config/sections\';',
  '',
  'declare module \'@open-tomato/rafa/core/config/config-schema\' {',
  '  interface RafaConfig { readonly bugs?: string }',
  '}',
  '',
  'export const bugs = sections;',
);

/** The tracked files of the planted tree, by path. */
const TREE: Readonly<Record<string, string>> = {
  '.gitignore': 'node_modules/\n',
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      baseUrl: '.',
      paths: {
        '@open-tomato/rafa/store': ['./packages/rafa/src/effort/store/index.ts'],
        '@open-tomato/rafa/*': ['./packages/rafa/src/*'],
      },
    },
  }),
  [LIST_PATH]: listText(MOVES),
  '.claude/skills/x/SKILL.md': 'Reads src/utils/git.ts.\n',
  'AGENTS.md': 'The tracker is src/utils/tracker.ts.\n',
  'README.md': 'See `src/modules/load.ts`.\n',
  'bin.ts': lines('import { git } from \'./src/utils/git.js\';', '', 'export const bin = git;'),
  'context/source.md': lines(
    'The tracker is `src/utils/tracker.ts` (`src/utils/tracker`), its test `src/utils/tracker.test.ts`, its open-tasks test',
    '`src/utils/tracker-open.test.ts`, the fixtures `src/modules/testdata/`; `src/utils/git-extra.ts` stays.',
  ),
  'docs/guide.md': 'See src/utils/git.ts.\n',
  'docs/survey/README.md': 'A dated record: src/utils/git.ts.\n',
  'docs/survey/cut-table.md': '| `src/utils/git.ts` | 1 |\n',
  [CLUSTER_MAP_FILE]: `${JSON.stringify(CLUSTER_MAP, null, 2)}\n`,
  'packages/hub/src/main.ts': lines('import { load } from \'../../../src/modules/load.js\';', '', 'export const hubLoad = load;'),
  'packages/rafa/src/core/config/config-schema.ts': 'export interface RafaConfig { readonly version?: number }\n',
  'packages/rafa/src/core/config/sections.ts': 'export const sections = 1;\n',
  'packages/rafa/src/effort/store/index.ts': 'export const store = 1;\n',
  'scripts/survey/cut-table.test.ts': 'export const PLANTED = \'src/utils/git.ts\';\n',
  'scripts/uses.ts': lines('// Reads src/utils/git.ts.', 'import { git } from \'../src/utils/git.js\';', '', 'export const used = git;'),
  'src/app.ts': APP_TEXT,
  'src/bundled/skill.md': 'Names src/utils/git.ts.\n',
  'src/cli/fixture.test.ts': lines(
    'const FIXTURE = new URL(\'../modules/testdata/fixture\', import.meta.url);',
    'const PROBE = new URL(\'./probe.ts\', import.meta.url);',
    'export const read = [FIXTURE, PROBE];',
  ),
  'src/config-registry.ts': 'export const registry = 1;\n',
  'src/config-schema-bugs.ts': SECTION_TEXT,
  'src/config-schema-bugs.test.ts': lines('import { bugs } from \'./config-schema-bugs.js\';', '', 'export const read = bugs;'),
  'src/feature/fixtures/frozen.ts': '// A capture naming src/utils/git.ts.\nexport const frozen = 1;\n',
  'src/modules/load.test.ts': lines(
    'import { join } from \'node:path\';',
    '',
    'import { registry } from \'../config-registry.js\';',
    '',
    'import { load } from \'./load.js\';',
    '',
    'const DIR = join(import.meta.dir, \'testdata\', \'fixture\');',
    'export const read = [load, registry, DIR];',
  ),
  'src/modules/load.ts': 'export const load = 1;\n',
  'src/modules/manifest.ts': lines('import { load } from \'./load.js\';', '', 'export const manifest = load;'),
  'src/modules/testdata/fixture/escape.ts': lines('import { registry } from \'../../../config-registry.js\';', '', 'export const escaped = registry;'),
  'src/modules/testdata/fixture/package.json': '{"name":"fixture"}\n',
  'src/modules/testdata/fixture/sync.ts': lines('// Loaded from src/modules/testdata/.', 'import { store } from \'@open-tomato/rafa/store\';', '', 'export const sync = store;'),
  'src/tests/core-coupled/core/loop/hop.test.ts': lines('import { git } from \'../../../../utils/git.js\';', '', 'export const read = git;'),
  'src/tests/helper.ts': 'export const helper = 1;\n',
  'src/utils/git-extra.test.ts': lines('import { extra } from \'./git-extra.js\';', '', 'export const read = extra;'),
  'src/utils/git-extra.ts': 'export const extra = 1;\n',
  'src/utils/git.integration.test.ts': lines(
    'import { sections } from \'@open-tomato/rafa/core/config/sections\';',
    '',
    'import { git } from \'./git.js\';',
    '',
    'export const read = [git, sections];',
  ),
  'src/utils/git.ts': '/** The git runner. */\nexport const git = 1;\n',
  'src/utils/testdata/capture.txt': 'stays\n',
  'src/utils/tracker-open.test.ts': lines('import { tracker } from \'./tracker.js\';', '', 'export const read = tracker;'),
  'src/utils/tracker.test.ts': lines(
    'import { join } from \'node:path\';',
    '',
    'import { helper } from \'../tests/helper.js\';',
    '',
    'import { tracker } from \'./tracker.js\';',
    '',
    'const ROOT = join(import.meta.dir, \'..\', \'..\');',
    'export const read = [tracker, helper, ROOT];',
  ),
  'src/utils/tracker.ts': TRACKER_TEXT,
};

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { force: true, recursive: true });
});

function git(root: string, args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function write(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** The identity and signing setting of the planted commit, so it reads no host configuration. */
const COMMIT_CONFIG: readonly string[] = ['-c', 'user.name=rafa test', '-c', 'user.email=rafa@example.test', '-c', 'commit.gpgsign=false'];

/** Plants a tree, the core one unless named, in a new git repository, its files committed. */
function plant(extra: Readonly<Record<string, string>> = {}, tree: Readonly<Record<string, string>> = TREE): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pass-moves-')));
  roots.push(root);
  git(root, ['init', '-q']);
  write(root, { ...tree, ...extra });
  git(root, ['add', '-A']);
  git(root, [...COMMIT_CONFIG, 'commit', '-q', '-m', 'plant']);
  return root;
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

/** Every file on disk under the root but `.git`, with its text. */
function snapshot(root: string): Record<string, string> {
  const files = git(root, ['ls-files', '-z', '--cached', '--others']).split('\0')
    .filter((path) => path !== '' && existsSync(join(root, path)));
  return Object.fromEntries(files.sort().map((path) => [path, read(root, path)]));
}

async function run(argv: readonly string[], cwd = '/'): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, cwd, { err: (line) => err.push(line), out: (line) => out.push(line) });
  return { code, err, out };
}

describe('rewriteMovedPath', () => {
  const finals = new Map([['src/utils/git.ts', 'packages/rafa/src/utils/git.ts']]);
  const folders = [{ from: 'src/modules/testdata/', to: 'packages/rafa/src/modules/testdata/' }];

  it.each([
    ['a moved file by its full path', 'src/utils/git.ts', 'packages/rafa/src/utils/git.ts'],
    ['a file under a moved folder', 'src/modules/testdata/fixture/sync.ts', 'packages/rafa/src/modules/testdata/fixture/sync.ts'],
    ['a moved folder without its closing /', 'src/modules/testdata', 'packages/rafa/src/modules/testdata'],
  ])('rewrites %s', (_name, token, expected) => {
    expect(rewriteMovedPath(token, finals, folders)).toBe(expected);
  });

  it.each([
    ['a sibling whose name opens like a moved file', 'src/utils/git-extra.ts'],
    ['the folder of a moved file', 'src/utils/'],
    ['a folder whose name opens like a moved folder', 'src/modules/testdata-old/x.ts'],
  ])('leaves %s', (_name, token) => {
    expect(rewriteMovedPath(token, finals, folders)).toBeUndefined();
  });
});

describe('metaPaths', () => {
  it.each([
    ['a URL', 'const A = new URL(\'../modules/testdata/fixture\', import.meta.url);', ['src/modules/testdata/fixture']],
    ['a join of segments', 'const B = join(import.meta.dir, \'..\', \'modules\', \'load.ts\');', ['src/modules/load.ts']],
    ['a folder with its closing /', 'const C = new URL(\'./testdata/\', import.meta.url);', ['src/cli/testdata']],
  ])('reads %s', (_name, line, expected) => {
    expect(metaPaths('src/cli/x.test.ts', line)).toEqual(expected);
  });

  it('reads nothing from a line without import.meta, or from an interpolated literal', () => {
    expect(metaPaths('src/cli/x.test.ts', 'const A = new URL(\'../modules/load.ts\', base);')).toEqual([]);
    expect(metaPaths('src/cli/x.test.ts', 'const A = new URL(`./${name}.ts`, import.meta.url);')).toEqual([]);
  });
});

describe('the codemod under --dry-run, over a planted tree', () => {
  it('prints each list with its count and changes nothing', async () => {
    // Arrange
    const root = plant();
    const before = snapshot(root);
    const status = git(root, ['status', '--porcelain']);

    // Act
    const result = await run([`--list=${LIST_PATH}`, '--dry-run'], root);

    // Assert
    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    expect(snapshot(root)).toEqual(before);
    expect(git(root, ['status', '--porcelain'])).toBe(status);
    expect(result.out).toContain('1. moved into the package (5)');
    expect(result.out).toContain('1. colocated tests moved with them (3)');
    expect(result.out).toContain('2. parked tests (2)');
    expect(result.out).toContain('3. importers rewritten: 15 specifier(s) in 5 file(s) outside the move, parked tests apart');
    expect(result.out).toContain('refused (0)');
    expect(result.out.at(-1)).toBe('dry run, nothing written.');
  });

  it('reads the same lists under an explicit --package=rafa as with no flag', async () => {
    // Arrange
    const root = plant();

    // Act
    const bare = await run([`--list=${LIST_PATH}`, '--dry-run'], root);
    const named = await run([`--list=${LIST_PATH}`, '--package=rafa', '--dry-run'], root);

    // Assert
    expect(named.code).toBe(0);
    expect(named.err).toEqual([]);
    expect(named.out).toEqual(bare.out);
    expect(named.out[0]).toBe('the package: packages/rafa/src/, imported as @open-tomato/rafa/');
  });
});

describe('the codemod over a planted tree', () => {
  const root = plant();
  const plan: PassMovesPlan = readPassMoves(root, MOVES, []);
  applyPassMoves(root, plan);
  const tracked = git(root, ['ls-files']).split('\n');

  it('reads the lists of all six steps', () => {
    expect(plan.refusals).toEqual([]);
    expect(plan.moves.map((move) => move.from)).toEqual(MOVES.map((move) => move.from));
    expect(plan.colocated.map((move) => move.from)).toEqual([
      'src/config-schema-bugs.test.ts',
      'src/utils/git.integration.test.ts',
      'src/utils/tracker-open.test.ts',
    ]);
    expect(plan.testdata.map((move) => move.from)).toEqual([
      'src/modules/testdata/fixture/escape.ts',
      'src/modules/testdata/fixture/package.json',
      'src/modules/testdata/fixture/sync.ts',
    ]);
    expect(plan.parked.map((test) => [test.from, test.reaches])).toEqual([
      ['src/modules/load.test.ts', ['src/config-registry.ts']],
      ['src/utils/tracker.test.ts', ['src/tests/helper.ts']],
    ]);
    expect(plan.importers).toBe(5);
    expect(plan.escapes.map((note) => [note.file, note.line])).toEqual([['src/modules/testdata/fixture/escape.ts', 1]]);
    expect(plan.pathReads.map((note) => [note.file, note.line])).toEqual([['src/modules/load.test.ts', 7], ['src/utils/tracker.test.ts', 7]]);
    expect(plan.movedPathReads.map((note) => [note.file, note.line])).toEqual([['src/cli/fixture.test.ts', 1]]);
  });

  it('1. moves the listed files, their colocated tests and the folder\'s testdata/ with git mv', () => {
    for (const path of [
      'config-schema-bugs.test.ts',
      'config-schema-bugs.ts',
      'modules/load.ts',
      'modules/manifest.ts',
      'modules/testdata/fixture/package.json',
      'utils/git.integration.test.ts',
      'utils/git.ts',
      'utils/tracker-open.test.ts',
      'utils/tracker.ts',
    ]) {
      expect(tracked).toContain(`packages/rafa/src/${path}`);
      expect(tracked).not.toContain(`src/${path}`);
      expect(existsSync(join(root, 'src', path))).toBe(false);
    }
    expect(git(root, ['status', '--porcelain'])).toContain('R  src/utils/git.ts -> packages/rafa/src/utils/git.ts');
  });

  it('1. leaves a test with a source of its own, and the testdata/ of a folder not wholly listed', () => {
    expect(read(root, 'src/utils/git-extra.test.ts')).toBe(TREE['src/utils/git-extra.test.ts']!);
    expect(read(root, 'src/utils/testdata/capture.txt')).toBe('stays\n');
  });

  it('2 and 3. parks a coupled test, its moved imports on subpaths and its root imports from its new folder', () => {
    expect(tracked).toContain('src/tests/core-coupled/utils/tracker.test.ts');
    expect(existsSync(join(root, 'src/utils/tracker.test.ts'))).toBe(false);
    expect(read(root, 'src/tests/core-coupled/utils/tracker.test.ts')).toBe(lines(
      'import { join } from \'node:path\';',
      '',
      'import { helper } from \'../../helper.js\';',
      '',
      'import { tracker } from \'@open-tomato/rafa/utils/tracker\';',
      '',
      'const ROOT = join(import.meta.dir, \'..\', \'..\');',
      'export const read = [tracker, helper, ROOT];',
    ));
    expect(read(root, 'src/tests/core-coupled/modules/load.test.ts')).toContain('import { registry } from \'../../../config-registry.js\';');
  });

  it('3. rewrites every kind of specifier of a moved file to its subpath, and the moved paths of comments and strings', () => {
    expect(read(root, 'src/app.ts')).toBe(lines(
      '// The tracker lives in packages/rafa/src/utils/tracker.ts, tested by src/tests/core-coupled/utils/tracker.test.ts; see packages/rafa/src/utils/git too.',
      'import type { Seen } from \'@open-tomato/rafa/utils/tracker\';',
      '',
      'import { tracker } from \'@open-tomato/rafa/utils/tracker\';',
      'import { extra } from \'./utils/git-extra.js\';',
      '',
      'export { git } from \'@open-tomato/rafa/utils/git\';',
      '',
      'declare module \'@open-tomato/rafa/config-schema-bugs\' {',
      '  interface Extra { readonly extra: string }',
      '}',
      '',
      'export const loaded = [tracker, extra, import(\'@open-tomato/rafa/modules/load\'), require(\'@open-tomato/rafa/utils/git\')];',
      'export type Typed = Seen | typeof import(\'@open-tomato/rafa/modules/manifest\');',
      'export const FIXTURE = \'packages/rafa/src/modules/testdata/fixture/sync.ts\';',
      'export const KEPT = [\'packages/rafa/src/utils/tracker.ts\', \'src/utils/git-extra.ts\'];',
    ));
  });

  it('3. rewrites the importers under scripts/, another package\'s src/, the root and the parked folder', () => {
    expect(read(root, 'scripts/uses.ts')).toBe(lines('// Reads packages/rafa/src/utils/git.ts.', 'import { git } from \'@open-tomato/rafa/utils/git\';', '', 'export const used = git;'));
    expect(read(root, 'packages/hub/src/main.ts')).toContain('import { load } from \'@open-tomato/rafa/modules/load\';');
    expect(read(root, 'bin.ts')).toContain('import { git } from \'@open-tomato/rafa/utils/git\';');
    expect(read(root, 'src/tests/core-coupled/core/loop/hop.test.ts')).toContain('import { git } from \'@open-tomato/rafa/utils/git\';');
  });

  it('4. rewrites a moved file\'s bare specifiers to relative paths and keeps a relative one between two moved files', () => {
    expect(read(root, 'packages/rafa/src/utils/tracker.ts')).toBe(lines(
      '/** Reads the plan; its sibling is packages/rafa/src/utils/git.ts. */',
      'import type { RafaConfig } from \'../core/config/config-schema.js\';',
      '',
      'import { sections } from \'../core/config/sections.js\';',
      'import { store } from \'../effort/store/index.js\';',
      '',
      'import { git } from \'./git.js\';',
      '',
      'export const tracker = [sections, store, git];',
      'export type Seen = RafaConfig;',
    ));
    expect(read(root, 'packages/rafa/src/modules/manifest.ts')).toBe(TREE['src/modules/manifest.ts']!);
    expect(read(root, 'packages/rafa/src/utils/git.integration.test.ts')).toContain('import { sections } from \'../core/config/sections.js\';');
  });

  it('4. points a moved section file\'s declare module at the declaring file by its relative path', () => {
    expect(read(root, 'packages/rafa/src/config-schema-bugs.ts')).toBe(lines(
      'import { sections } from \'./core/config/sections.js\';',
      '',
      'declare module \'./core/config/config-schema.js\' {',
      '  interface RafaConfig { readonly bugs?: string }',
      '}',
      '',
      'export const bugs = sections;',
    ));
  });

  it('4. points a moved testdata file at core and at the root file it reaches from its new folder', () => {
    expect(read(root, 'packages/rafa/src/modules/testdata/fixture/sync.ts')).toBe(lines(
      '// Loaded from src/modules/testdata/.',
      'import { store } from \'../../../effort/store/index.js\';',
      '',
      'export const sync = store;',
    ));
    expect(read(root, 'packages/rafa/src/modules/testdata/fixture/escape.ts')).toContain('from \'../../../../../../src/config-registry.js\'');
  });

  it('5. rewrites prose with and without the extension, and renames the cluster map in place', () => {
    expect(read(root, 'context/source.md')).toBe(lines(
      'The tracker is `packages/rafa/src/utils/tracker.ts` (`packages/rafa/src/utils/tracker`), its test `src/tests/core-coupled/utils/tracker.test.ts`, its open-tasks test',
      '`packages/rafa/src/utils/tracker-open.test.ts`, the fixtures `packages/rafa/src/modules/testdata/`; `src/utils/git-extra.ts` stays.',
    ));
    expect(read(root, 'docs/guide.md')).toBe('See packages/rafa/src/utils/git.ts.\n');
    expect(read(root, 'docs/survey/cut-table.md')).toBe('| `packages/rafa/src/utils/git.ts` | 1 |\n');
    expect(read(root, '.claude/skills/x/SKILL.md')).toBe('Reads packages/rafa/src/utils/git.ts.\n');
    expect(read(root, 'AGENTS.md')).toBe('The tracker is packages/rafa/src/utils/tracker.ts.\n');
    expect(read(root, 'README.md')).toBe('See `packages/rafa/src/modules/load.ts`.\n');
    expect(JSON.parse(read(root, CLUSTER_MAP_FILE))).toEqual({
      base: 'abc1234',
      clusters: { 'packages/rafa/src/utils/tracker.ts': 'c2', 'src/app.ts': 'c1', 'src/tests/core-coupled/utils/tracker.test.ts': 'c2' },
      outside: ['packages/rafa/src/modules/load.ts'],
    });
  });

  it('5. leaves the survey record, prose outside its folders, frozen files, the move list and the files left to hand', () => {
    for (const path of [
      'docs/survey/README.md',
      'src/bundled/skill.md',
      'src/feature/fixtures/frozen.ts',
      LIST_PATH,
      'scripts/survey/cut-table.test.ts',
    ]) {
      expect(read(root, path)).toBe(TREE[path]!);
    }
  });

  it('6. leaves the import.meta lines it lists', () => {
    expect(read(root, 'src/cli/fixture.test.ts')).toBe(TREE['src/cli/fixture.test.ts']!);
    expect(read(root, 'src/tests/core-coupled/modules/load.test.ts')).toContain('const DIR = join(import.meta.dir, \'testdata\', \'fixture\');');
  });

  it('prints the written count after a run', () => {
    expect(reportLines(plan, false).at(-1)).toBe(`wrote ${plan.writes.size} file(s).`);
  });

  it('refuses a second run: every from is gone and every to exists', async () => {
    const result = await run([`--list=${LIST_PATH}`, root], root);

    expect(result.code).toBe(2);
    expect(result.out).toContain('  src/utils/git.ts:0 is not tracked');
    expect(result.out).toContain('  src/utils/git.ts:0 moves to packages/rafa/src/utils/git.ts, which exists');
    expect(result.out.at(-1)).toBe('refused, nothing written.');
  });
});

/** A planted `rafa.config.ts` whose default export is `entries`, as `scripts/survey/test-kinds.test.ts` plants one. */
function configText(entries: readonly unknown[]): string {
  return `export default ${JSON.stringify(entries)};\n`;
}

/** A colocated integration test of `src/utils/git.ts`, by the `-integration` name. */
const INTEGRATION_TEST = 'src/utils/git-integration.test.ts';

const INTEGRATION_TEXT = lines('import { git } from \'./git.js\';', '', 'export const read = git;');

/** The section the left tests print under, before its count. */
const LEFT_SECTION = '1. integration tests left at the root, imports rewritten';

describe('the codemod over a tree whose rafa.config.ts names integration globs', () => {
  it('leaves a colocated -integration test at its path, its import on the subpath, and lists it', async () => {
    // Arrange
    const root = plant({
      [INTEGRATION_TEST]: INTEGRATION_TEXT,
      'rafa.config.ts': configText([{ tests: { integration: ['**/*-integration.test.ts'] } }]),
    });
    expect(existsSync(join(root, '.rafa'))).toBe(false);

    // Act
    const result = await run([`--list=${LIST_PATH}`], root);

    // Assert
    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.out).toContain(`${LEFT_SECTION} (1)`);
    expect(result.out).toContain(`  ${INTEGRATION_TEST}`);
    expect(read(root, INTEGRATION_TEST)).toBe(lines('import { git } from \'@open-tomato/rafa/utils/git\';', '', 'export const read = git;'));
    expect(git(root, ['ls-files'])).toContain(INTEGRATION_TEST);
    expect(existsSync(join(root, 'packages/rafa/src/utils/git-integration.test.ts'))).toBe(false);
  });

  it('still moves a unit test with its listed file, and a .integration name the glob does not match', async () => {
    // Arrange
    const root = plant({
      [INTEGRATION_TEST]: INTEGRATION_TEXT,
      'rafa.config.ts': configText([{ tests: { integration: ['**/*-integration.test.ts'] } }]),
    });

    // Act
    const result = await run([`--list=${LIST_PATH}`], root);

    // Assert
    expect(result.code).toBe(0);
    expect(result.out).toContain('1. colocated tests moved with them (3)');
    expect(result.out).toContain('  src/utils/tracker-open.test.ts -> packages/rafa/src/utils/tracker-open.test.ts');
    expect(result.out).toContain('  src/utils/git.integration.test.ts -> packages/rafa/src/utils/git.integration.test.ts');
    expect(existsSync(join(root, 'packages/rafa/src/utils/tracker-open.test.ts'))).toBe(true);
    expect(existsSync(join(root, 'src/utils/tracker-open.test.ts'))).toBe(false);
  });

  it('reads the globs from the rafa.config.ts alone: without it the -integration test moves', async () => {
    // Arrange
    const withFile = plant({
      [INTEGRATION_TEST]: INTEGRATION_TEXT,
      'rafa.config.ts': configText([{ tests: { integration: ['**/*-integration.test.ts'] } }]),
    });
    const without = plant({ [INTEGRATION_TEST]: INTEGRATION_TEXT });
    expect(existsSync(join(without, 'rafa.config.ts'))).toBe(false);
    expect(existsSync(join(without, '.rafa'))).toBe(false);

    // Act
    const listed = await run([`--list=${LIST_PATH}`, '--dry-run'], withFile);
    const moved = await run([`--list=${LIST_PATH}`, '--dry-run'], without);

    // Assert
    expect(listed.code).toBe(0);
    expect(listed.out).toContain(`${LEFT_SECTION} (1)`);
    expect(listed.out).toContain(`  ${INTEGRATION_TEST}`);
    expect(moved.code).toBe(0);
    expect(moved.out).toContain(`${LEFT_SECTION} (0)`);
    expect(moved.out).toContain('1. colocated tests moved with them (4)');
    expect(moved.out).toContain(`  ${INTEGRATION_TEST} -> packages/rafa/src/utils/git-integration.test.ts`);
  });

  it('reads the escalation template a rafa.config.ts names, leaving both integration names', async () => {
    // Arrange
    const root = plant({ [INTEGRATION_TEST]: INTEGRATION_TEXT, 'rafa.config.ts': configText([{ templates: ['escalation'] }]) });

    // Act
    const result = await run([`--list=${LIST_PATH}`, '--dry-run'], root);

    // Assert
    expect(result.code).toBe(0);
    expect(result.out).toContain(`${LEFT_SECTION} (2)`);
    expect(result.out).toContain(`  ${INTEGRATION_TEST}`);
    expect(result.out).toContain('  src/utils/git.integration.test.ts');
    expect(result.out).toContain('1. colocated tests moved with them (2)');
  });
});

describe('the codemod\'s refusals', () => {
  it.each([
    [
      'a from that is not tracked',
      { 'src/untracked.ts': 'export const u = 1;\n' },
      [{ from: 'src/untracked.ts', to: 'packages/rafa/src/untracked.ts' }],
      '  src/untracked.ts:0 is not tracked',
    ],
    [
      'a to that exists',
      { 'packages/rafa/src/utils/git.ts': 'export const git = 2;\n' },
      [],
      '  src/utils/git.ts:0 moves to packages/rafa/src/utils/git.ts, which exists',
    ],
    [
      'a to outside the package',
      {},
      [{ from: 'src/config-registry.ts', to: 'packages/hub/src/config-registry.ts' }],
      '  src/config-registry.ts:0 moves to packages/hub/src/config-registry.ts, outside packages/rafa/src/',
    ],
    [
      'a listed file whose relative specifier resolves outside the list and the package',
      { 'src/utils/progress.ts': 'import { registry } from \'../config-registry.js\';\nexport const p = registry;\n' },
      [{ from: 'src/utils/progress.ts', to: 'packages/rafa/src/utils/progress.ts' }],
      '  src/utils/progress.ts:1 \'../config-registry.js\' resolves to src/config-registry.ts, outside the move and the package',
    ],
    [
      'a listed file whose relative specifier resolves to nothing',
      { 'src/utils/progress.ts': 'import { gone } from \'./gone.js\';\nexport const p = gone;\n' },
      [{ from: 'src/utils/progress.ts', to: 'packages/rafa/src/utils/progress.ts' }],
      '  src/utils/progress.ts:1 \'./gone.js\' resolves to nothing, outside the move and the package',
    ],
  ])('writes nothing and exits 2 for %s', async (_name, extra, more, refusal) => {
    // Arrange
    const root = plant(extra);
    if (_name === 'a from that is not tracked') {
      git(root, ['rm', '-q', '--cached', 'src/untracked.ts']);
    }
    write(root, { [LIST_PATH]: listText([...MOVES, ...more]) });
    const before = snapshot(root);

    // Act
    const result = await run([`--list=${LIST_PATH}`], root);

    // Assert
    expect(result.code).toBe(2);
    expect(result.out).toContain(refusal);
    expect(result.out.at(-1)).toBe('refused, nothing written.');
    expect(snapshot(root)).toEqual(before);
  });

  it('refuses a tracked from that is gone from disk, and a path listed twice', async () => {
    // Arrange
    const root = plant();
    unlinkSync(join(root, 'src/config-registry.ts'));
    write(root, { [LIST_PATH]: listText([...MOVES, { from: 'src/config-registry.ts', to: 'packages/rafa/src/utils/git.ts' }]) });

    // Act
    const result = await run([`--list=${LIST_PATH}`], root);

    // Assert
    expect(result.code).toBe(2);
    expect(result.out).toContain('  src/config-registry.ts:0 is not on disk');
    expect(result.out).toContain('  src/config-registry.ts:0 lists packages/rafa/src/utils/git.ts twice');
  });
});

describe('the codemod\'s command line', () => {
  it.each([
    ['no --list', ['--dry-run']],
    ['an empty --list', ['--list=']],
    ['two lists', ['--list=a.ts', '--list=b.ts']],
    ['an unknown flag', ['--list=a.ts', '--force']],
    ['two roots', ['--list=a.ts', 'a', 'b']],
    ['a --package with no value', ['--list=a.ts', '--package=']],
    ['a --package with no =', ['--list=a.ts', '--package']],
    ['two packages', ['--list=a.ts', '--package=rafa-inventory', '--package=rafa-effort']],
  ])('answers the usage line and exit 2 for %s', async (_name, argv) => {
    const result = await run(argv);

    expect(result.code).toBe(2);
    expect(result.err).toEqual([USAGE]);
  });

  it('exits 2 naming a list that exports no array of moves', async () => {
    // Arrange
    const root = plant({ 'scripts/codemod/moves/empty.ts': 'export const NONE = 1;\n' });

    // Act
    const result = await run(['--list=scripts/codemod/moves/empty.ts', '--dry-run'], root);

    // Assert
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('exports 0 arrays of FileMove');
  });

  it.each([
    ['no workspace member', 'rafa-nowhere', '--package=rafa-nowhere names no workspace member: packages/rafa-nowhere/package.json is absent'],
    ['no rafa-<name> package', 'inventory', '--package=inventory names no rafa-<name> package'],
  ])('exits 2 naming a --package that is %s, and writes nothing', async (_name, name, message) => {
    // Arrange
    const root = plant();
    const before = snapshot(root);

    // Act
    const result = await run([`--list=${LIST_PATH}`, `--package=${name}`], root);

    // Assert
    expect(result.code).toBe(2);
    expect(result.err).toEqual([message]);
    expect(result.out).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });

  it('exits 2 naming a list that cannot load', async () => {
    const result = await run(['--list=/nowhere/list.ts', '--dry-run']);

    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('cannot load the move list /nowhere/list.ts');
  });
});

/** The planted feature move's list path, under the planted root. */
const FEATURE_LIST_PATH = 'scripts/codemod/moves/plant-feature.ts';

/** The planted feature move: two files of two folders into `rafa-inventory`. */
const FEATURE_MOVES: readonly { readonly from: string; readonly to: string }[] = [
  { from: 'src/learning/learn.ts', to: 'packages/rafa-inventory/src/learning/learn.ts' },
  { from: 'src/tiers/tier.ts', to: 'packages/rafa-inventory/src/tiers/tier.ts' },
];

const LEARN_TEXT = lines(
  '/** Learns from the tier of src/tiers/tier.ts. */',
  'import { sections } from \'@open-tomato/rafa/core/config/sections\';',
  '',
  'import { tier } from \'../tiers/tier.js\';',
  '',
  'export const learn = [sections, tier];',
);

/** The coupled test, its core import spelled with the `/index` core's subpath drops, so a kept text reads apart from a rewritten one. */
const COUPLED_TEXT = lines(
  'import { join } from \'node:path\';',
  '',
  'import { sections } from \'@open-tomato/rafa/core/config/index\';',
  '',
  'import { registry } from \'../config-registry.js\';',
  '',
  'import { tier } from \'./tier.js\';',
  '',
  'const CORPUS = join(import.meta.dir, \'testdata\', \'corpus\');',
  'export const read = [sections, registry, tier, CORPUS];',
);

/** The tracked files of the planted tree with a feature package, by path. */
const FEATURE_TREE: Readonly<Record<string, string>> = {
  '.gitignore': 'node_modules/\n',
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      baseUrl: '.',
      paths: {
        '@open-tomato/rafa-inventory': ['./packages/rafa-inventory/index.ts'],
        '@open-tomato/rafa/*': ['./packages/rafa/src/*'],
      },
    },
  }),
  [FEATURE_LIST_PATH]: listText(FEATURE_MOVES),
  'context/source.md': lines(
    'Learning is `src/learning/learn.ts`, its tier `src/tiers/tier.ts`, tested by `src/tiers/tier.test.ts`',
    'over `src/tiers/testdata/`; `src/commands/browse.ts` stays.',
  ),
  'packages/rafa/src/core/config/index.ts': 'export { sections } from \'./sections.js\';\n',
  'packages/rafa/src/core/config/sections.ts': 'export const sections = 1;\n',
  'packages/rafa-effort/index.ts': lines('export { tier } from \'../../src/tiers/tier.js\';'),
  'packages/rafa-effort/package.json': '{"name":"@open-tomato/rafa-effort"}\n',
  'packages/rafa-inventory/commands.ts': lines('import { tier } from \'../../src/tiers/tier.js\';', '', 'export const commands = [tier];'),
  'packages/rafa-inventory/index.test.ts': lines(
    'import { learn } from \'../../src/learning/learn.js\';',
    '',
    'import { learn as entry } from \'./index.js\';',
    '',
    'export const read = learn === entry;',
  ),
  'packages/rafa-inventory/index.ts': lines(
    '/** The facade over src/learning/learn.ts. */',
    'export { learn } from \'../../src/learning/learn.js\';',
    'export { tier } from \'../../src/tiers/tier.js\';',
  ),
  'packages/rafa-inventory/package.json': '{"name":"@open-tomato/rafa-inventory"}\n',
  'src/commands/browse.ts': lines('import { learn } from \'@open-tomato/rafa-inventory\';', '', 'export const browse = learn;'),
  'src/commands/learn.test.ts': lines('import { learn } from \'../learning/learn.js\';', '', 'export const read = learn;'),
  'src/config-registry.ts': 'export const registry = 1;\n',
  'src/learning/learn.test.ts': lines(
    'import { sections } from \'@open-tomato/rafa/core/config/sections\';',
    '',
    'import { learn } from \'./learn.js\';',
    '',
    'export const read = [sections, learn];',
  ),
  'src/learning/learn.ts': LEARN_TEXT,
  'src/tiers/testdata/corpus/SKILL.md': 'A skill naming src/tiers/tier.ts.\n',
  'src/tiers/tier.test.ts': COUPLED_TEXT,
  'src/tiers/tier.ts': 'export const tier = 1;\n',
};

describe('the codemod under --package=rafa-inventory, over a planted tree', () => {
  const root = plant({}, FEATURE_TREE);
  const before = snapshot(root);
  const dry = run([`--list=${FEATURE_LIST_PATH}`, '--package=rafa-inventory', '--dry-run'], root);
  const result = dry.then(async (printed) => ({ printed, written: await run([`--list=${FEATURE_LIST_PATH}`, '--package=rafa-inventory'], root) }));

  it('prints the lists under --dry-run and changes nothing', async () => {
    const { printed } = await result;

    expect(printed.err).toEqual([]);
    expect(printed.code).toBe(0);
    expect(printed.out[0]).toBe('the package: packages/rafa-inventory/src/, imported as @open-tomato/rafa-inventory/');
    expect(printed.out).toContain('1. moved into the package (2)');
    expect(printed.out).toContain('3. importers rewritten: 8 specifier(s) in 5 file(s) outside the move, parked tests apart');
    expect(printed.out).toContain('4. moved files\' own specifiers rewritten (0)');
    expect(printed.out).toContain('refused (0)');
    expect(printed.out).toContain('  src/tiers/tier.test.ts:9 const CORPUS = join(import.meta.dir, \'testdata\', \'corpus\');');
    expect(printed.out.at(-1)).toBe('dry run, nothing written.');
    expect(Object.keys(before)).toContain('src/learning/learn.ts');
  });

  it('1. moves the listed files, their colocated test and the folder\'s testdata/ under the package\'s src/', async () => {
    const { written } = await result;
    const tracked = git(root, ['ls-files']).split('\n');

    expect(written.err).toEqual([]);
    expect(written.code).toBe(0);
    expect(written.out).toContain('  src/learning/learn.ts -> packages/rafa-inventory/src/learning/learn.ts');
    expect(written.out).toContain('  src/learning/learn.test.ts -> packages/rafa-inventory/src/learning/learn.test.ts');
    expect(written.out).toContain('  src/tiers/testdata/corpus/SKILL.md -> packages/rafa-inventory/src/tiers/testdata/corpus/SKILL.md');
    for (const path of ['learning/learn.ts', 'learning/learn.test.ts', 'tiers/tier.ts', 'tiers/testdata/corpus/SKILL.md']) {
      expect(tracked).toContain(`packages/rafa-inventory/src/${path}`);
      expect(existsSync(join(root, 'src', path))).toBe(false);
    }
    expect(read(root, 'packages/rafa-inventory/src/tiers/testdata/corpus/SKILL.md')).toBe(FEATURE_TREE['src/tiers/testdata/corpus/SKILL.md']!);
  });

  it('2 and 3. parks the coupled test under src/tests/inventory-coupled/, its README row relative to that folder', async () => {
    const { written } = await result;

    expect(written.out).toContain('  src/tiers/tier.test.ts -> src/tests/inventory-coupled/tiers/tier.test.ts');
    expect(written.out).toContain('  | `tiers/tier.test.ts` | `src/config-registry.ts` |');
    expect(existsSync(join(root, 'src/tiers/tier.test.ts'))).toBe(false);
    expect(read(root, 'src/tests/inventory-coupled/tiers/tier.test.ts')).toBe(lines(
      'import { join } from \'node:path\';',
      '',
      'import { sections } from \'@open-tomato/rafa/core/config/index\';',
      '',
      'import { registry } from \'../../../config-registry.js\';',
      '',
      'import { tier } from \'@open-tomato/rafa-inventory/tiers/tier\';',
      '',
      'const CORPUS = join(import.meta.dir, \'testdata\', \'corpus\');',
      'export const read = [sections, registry, tier, CORPUS];',
    ));
  });

  it('3. rewrites an importing test outside the move and another package\'s facade to the subpath', async () => {
    await result;

    expect(read(root, 'src/commands/learn.test.ts')).toBe(lines('import { learn } from \'@open-tomato/rafa-inventory/learning/learn\';', '', 'export const read = learn;'));
    expect(read(root, 'packages/rafa-effort/index.ts')).toBe(lines('export { tier } from \'@open-tomato/rafa-inventory/tiers/tier\';'));
    expect(read(root, 'src/commands/browse.ts')).toBe(FEATURE_TREE['src/commands/browse.ts']!);
  });

  it('3. rewrites the package\'s facade, its commands.ts and its index.test.ts to the relative path into src/', async () => {
    await result;

    expect(read(root, 'packages/rafa-inventory/index.ts')).toBe(lines(
      '/** The facade over packages/rafa-inventory/src/learning/learn.ts. */',
      'export { learn } from \'./src/learning/learn.js\';',
      'export { tier } from \'./src/tiers/tier.js\';',
    ));
    expect(read(root, 'packages/rafa-inventory/commands.ts')).toContain('import { tier } from \'./src/tiers/tier.js\';');
    expect(read(root, 'packages/rafa-inventory/index.test.ts')).toBe(lines(
      'import { learn } from \'./src/learning/learn.js\';',
      '',
      'import { learn as entry } from \'./index.js\';',
      '',
      'export const read = learn === entry;',
    ));
  });

  it('4. keeps a moved file\'s bare core specifier and its relative one to a second moved file', async () => {
    await result;

    expect(read(root, 'packages/rafa-inventory/src/learning/learn.ts')).toBe(lines(
      '/** Learns from the tier of packages/rafa-inventory/src/tiers/tier.ts. */',
      'import { sections } from \'@open-tomato/rafa/core/config/sections\';',
      '',
      'import { tier } from \'../tiers/tier.js\';',
      '',
      'export const learn = [sections, tier];',
    ));
    expect(read(root, 'packages/rafa-inventory/src/learning/learn.test.ts')).toBe(FEATURE_TREE['src/learning/learn.test.ts']!);
  });

  it('5. rewrites the moved and parked paths in prose', async () => {
    await result;

    expect(read(root, 'context/source.md')).toBe(lines(
      'Learning is `packages/rafa-inventory/src/learning/learn.ts`, its tier `packages/rafa-inventory/src/tiers/tier.ts`, tested by `src/tests/inventory-coupled/tiers/tier.test.ts`',
      'over `packages/rafa-inventory/src/tiers/testdata/`; `src/commands/browse.ts` stays.',
    ));
  });
});

describe('the codemod\'s refusals under --package=rafa-inventory', () => {
  it.each([
    [
      'a to outside the package\'s source',
      {},
      [{ from: 'src/config-registry.ts', to: 'packages/rafa/src/config-registry.ts' }],
      '  src/config-registry.ts:0 moves to packages/rafa/src/config-registry.ts, outside packages/rafa-inventory/src/',
    ],
    [
      'a listed file whose relative specifier resolves outside the list and the package',
      { 'src/tiers/rank.ts': 'import { registry } from \'../config-registry.js\';\nexport const rank = registry;\n' },
      [{ from: 'src/tiers/rank.ts', to: 'packages/rafa-inventory/src/tiers/rank.ts' }],
      '  src/tiers/rank.ts:1 \'../config-registry.js\' resolves to src/config-registry.ts, outside the move and the package',
    ],
  ])('writes nothing and exits 2 for %s', async (_name, extra, more, refusal) => {
    // Arrange
    const root = plant(extra, FEATURE_TREE);
    write(root, { [FEATURE_LIST_PATH]: listText([...FEATURE_MOVES, ...more]) });
    const before = snapshot(root);

    // Act
    const result = await run([`--list=${FEATURE_LIST_PATH}`, '--package=rafa-inventory'], root);

    // Assert
    expect(result.code).toBe(2);
    expect(result.out).toContain(refusal);
    expect(result.out.at(-1)).toBe('refused, nothing written.');
    expect(snapshot(root)).toEqual(before);
  });
});
