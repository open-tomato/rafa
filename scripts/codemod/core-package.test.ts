/**
 * The core-package codemod over a planted git repository: a tree shaped
 * as rafa's is before the move, read back after each run. The lists of
 * where core is are handed in as they stand before the move, so these
 * cases hold whether or not `core-moves.ts` has been flipped.
 */
import type { CoreLists, CorePackagePlan } from './core-package';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  applyCorePackage,
  BUILD_ENTRIES,
  CorePackageError,
  coreSubpath,
  main,
  packagePath,
  parkedPath,
  planCorePackage,
  readCorePackage,
  reportLines,
  rewritePathToken,
  USAGE,
} from './core-package';

/** Where core is before the move, as `core-moves.ts` spells it then. */
const BEFORE: CoreLists = {
  folders: ['src/core/', 'src/effort/store/', 'src/ports/'],
  named: ['src/report/parse.ts', 'src/report/record.ts', 'src/schema/project-id.ts', 'src/schema/tiers.ts'],
};

function lines(...text: readonly string[]): string {
  return `${text.join('\n')}\n`;
}

const CLUSTER_MAP = {
  base: 'abc1234',
  clusters: { 'src/app.ts': 'c1', 'src/core/plan/parse.ts': 'c2', 'src/effort/store/rows.ts': 'c2' },
  outside: ['src/ports/index.ts'],
};

const CORE_LOCATION_TEXT = lines(
  'export const CORE_SOURCE = \'packages/rafa/src/\';',
  'export const CORE_FOLDERS: readonly string[] = [\'src/core/\', \'src/effort/store/\', \'src/ports/\'];',
  'export const CORE_NAMED_FILES: readonly string[] = [',
  '  \'src/report/parse.ts\',',
  '];',
);

const APP_TEXT = lines(
  '// The parser lives in src/core/plan/parse.ts, tested by src/core/plan/parse.test.ts.',
  'import type { Port } from \'./ports/index.js\';',
  '',
  'import { parsePlan } from \'./core/plan/index.js\';',
  'import { rows } from \'./effort/store.js\';',
  'import { blockerComment, findNextTask } from \'./utils/tracker.js\';',
  '',
  'declare module \'./core/plan/index.js\' {',
  '  interface PlanExtra { readonly extra: string }',
  '}',
  '',
  'export const BARREL = \'src/effort/store/index.ts\';',
  'export const KEPT = [\'packages/rafa/src/core/\', \'src/effort/store.ts\', \'dist/src/core/x.ts\'];',
  'export const loaded = [parsePlan, rows, blockerComment, findNextTask, import(\'./core/plan/parse.js\'), require(\'./schema/tiers.js\')];',
  'export type Seen = Port;',
);

const TRACKER_TEXT = lines(
  'import { blockerComment } from \'../core/plan/index.js\';',
  '',
  '/*',
  ' * The blocker comment moved to src/core/plan/blocker-comment.ts; it is',
  ' * re-exported here until #1090 removes it.',
  ' */',
  'export { blockerComment } from \'../core/plan/index.js\';',
  '',
  'export function findNextTask(): string {',
  '  return blockerComment;',
  '}',
);

/** The tracked files of the planted tree, by path. */
const TREE: Readonly<Record<string, string>> = {
  '.gitignore': 'node_modules/\n',
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      baseUrl: '.',
      paths: { '@open-tomato/rafa/ports': ['./src/ports/index.ts'], '@open-tomato/rafa/store': ['./src/effort/store/index.ts'] },
    },
  }),
  'context/source.md': 'Core is `src/core/`, the store `src/effort/store` and `src/report/parse.ts`; the parser\'s test is `src/core/plan/parse.test.ts`.\n',
  'docs/survey/README.md': 'Core was src/core/.\n',
  'docs/survey/cluster-map.json': `${JSON.stringify(CLUSTER_MAP, null, 2)}\n`,
  'packages/hub/src/main.ts': lines('import { rows } from \'@open-tomato/rafa/store\';', '', 'export const hubRows = rows;'),
  'scripts/survey/core-moves.ts': CORE_LOCATION_TEXT,
  'scripts/survey/cut-table.ts': 'export const CORE_RULE = { folders: [\'src/core/\'] };\n',
  'scripts/uses-core.ts': lines('import { rows } from \'../src/effort/store/rows.js\';', '', 'export const used = rows;'),
  'src/app.ts': APP_TEXT,
  'src/core/plan/blocker-comment.ts': 'export const blockerComment = \'blocked\';\n',
  'src/core/plan/index.ts': lines('export { blockerComment } from \'./blocker-comment.js\';', 'export { parsePlan } from \'./parse.js\';'),
  'src/core/plan/parse.test.ts': lines(
    'import { parsePlan } from \'./parse.js\';',
    'import { findNextTask } from \'../../utils/tracker.js\';',
    '',
    'const FIXTURE = new URL(\'./testdata/real-plan.md\', import.meta.url);',
    'export const read = [parsePlan, findNextTask, FIXTURE];',
  ),
  'src/core/plan/parse.ts': lines('/** Reads a plan; its barrel is src/core/plan/index.ts. */', 'export const parsePlan = \'plan\';'),
  'src/core/plan/testdata/real-plan.md': 'A frozen plan naming src/core/.\n',
  'src/effort/store.ts': lines('/** The rows at their old path (#1090). */', 'export { rows } from \'./store/rows.js\';'),
  'src/effort/store/index.ts': 'export { rows } from \'./rows.js\';\n',
  'src/effort/store/rows.lock.json': '{"rows":1}\n',
  'src/effort/store/rows.test.ts': lines(
    'import { rows } from \'./rows.js\';',
    'import { parsePlan } from \'../../utils/declaration.js\';',
    '',
    'export const both = [rows, parsePlan];',
  ),
  'src/effort/store/rows.ts': 'export const rows = 1;\n',
  'src/ports/index.ts': 'export type { Port } from \'./port.js\';\n',
  'src/ports/port.ts': 'export type Port = string;\n',
  'src/report/lessons.test.ts': lines('import { lessons } from \'./lessons.js\';', '', 'export const read = lessons;'),
  'src/report/lessons.ts': 'export const lessons = 1;\n',
  'src/report/parse-live.test.ts': lines('import { parseReport } from \'./parse.js\';', '', 'export const live = parseReport;'),
  'src/report/parse.test.ts': lines('import { parseReport } from \'./parse.js\';', '', 'export const read = parseReport;'),
  'src/report/parse.ts': 'export const parseReport = 1;\n',
  'src/schema/tiers.test.ts': lines(
    'import { tiers } from \'./tiers.js\';',
    'import { helper } from \'../tests/helper.js\';',
    '',
    'export const both = [tiers, helper];',
  ),
  'src/schema/tiers.ts': 'export const tiers = 1;\n',
  'src/tests/helper.ts': 'export const helper = 1;\n',
  'src/utils/declaration.ts': lines(
    '/**',
    ' * The declaration parser, read at its old path until #1090 removes it.',
    ' */',
    'export { parsePlan } from \'../core/plan/index.js\';',
  ),
  'src/utils/tracker.ts': TRACKER_TEXT,
  'src/uses-tracker.ts': lines('import { findNextTask } from \'./utils/tracker.js\';', '', 'export const next = findNextTask;'),
};

/** A file git does not track yet: the move carries it by a rename. */
const UNTRACKED: Readonly<Record<string, string>> = { 'src/core/plan/draft.ts': 'export const draft = 1;\n' };

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

/** Plants the tree in a new git repository, its files staged, the untracked one not. */
function plant(extra: Readonly<Record<string, string>> = {}): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'core-package-')));
  roots.push(root);
  git(root, ['init', '-q']);
  write(root, { ...TREE, ...extra });
  git(root, ['add', '-A']);
  write(root, UNTRACKED);
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

function run(argv: readonly string[]): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, '/', { err: (line) => err.push(line), out: (line) => out.push(line) }, BEFORE);
  return { code, err, out };
}

describe('coreSubpath', () => {
  it.each([
    ['src/core/config/index.ts', '@open-tomato/rafa/core/config'],
    ['src/core/config/load.ts', '@open-tomato/rafa/core/config/load'],
    ['src/core/config/sections.ts', '@open-tomato/rafa/core/config/sections'],
    ['src/core/config/config-schema.ts', '@open-tomato/rafa/core/config/config-schema'],
    ['src/core/plan/block-reader.ts', '@open-tomato/rafa/core/plan/block-reader'],
    ['src/effort/store/index.ts', '@open-tomato/rafa/store'],
    ['src/effort/store/sqlite.ts', '@open-tomato/rafa/store/sqlite'],
    ['src/effort/store/testdata/store-rows.ts', '@open-tomato/rafa/store/testdata/store-rows'],
    ['src/effort/store/migrations.lock.json', '@open-tomato/rafa/store/migrations.lock.json'],
    ['src/ports/index.ts', '@open-tomato/rafa/ports'],
    ['src/ports/log-level.ts', '@open-tomato/rafa/ports/log-level'],
    ['src/report/parse.ts', '@open-tomato/rafa/report/parse'],
    ['src/schema/project-id.ts', '@open-tomato/rafa/schema/project-id'],
  ])('spells %s as %s', (path, expected) => {
    expect(coreSubpath(path)).toBe(expected);
  });
});

describe('packagePath and parkedPath', () => {
  it('keeps the path below src/ under the package and under the parked folder', () => {
    expect(packagePath('src/core/plan/parse.ts')).toBe('packages/rafa/src/core/plan/parse.ts');
    expect(parkedPath('src/effort/store/settings.test.ts')).toBe('src/tests/core-coupled/effort/store/settings.test.ts');
  });
});

describe('rewritePathToken', () => {
  const finals = new Map([['src/core/config/config.test.ts', 'src/tests/core-coupled/core/config/config.test.ts']]);

  it.each([
    ['a parked test by its full path', 'src/core/config/config.test.ts', 'src/tests/core-coupled/core/config/config.test.ts'],
    ['a file under a core folder', 'src/core/config/index.ts', 'packages/rafa/src/core/config/index.ts'],
    ['a core folder without its closing /', 'src/effort/store', 'packages/rafa/src/effort/store'],
    ['a glob under a core folder', 'src/ports/*.ts', 'packages/rafa/src/ports/*.ts'],
  ])('rewrites %s', (_name, token, expected) => {
    expect(rewritePathToken(token, finals, BEFORE.folders)).toBe(expected);
  });

  it.each([
    ['a sibling of a core folder', 'src/effort/store.ts'],
    ['a root file', 'src/config-registry.ts'],
    ['a folder whose name opens like a core folder', 'src/core-coupled/x.ts'],
  ])('leaves %s', (_name, token) => {
    expect(rewritePathToken(token, finals, BEFORE.folders)).toBeUndefined();
  });
});

describe('planCorePackage', () => {
  it('refuses to plan a core that is already its package', () => {
    expect(() => planCorePackage({ files: [], folders: ['packages/rafa/src/'], named: [], resolve: () => undefined, sources: new Map() }))
      .toThrow(CorePackageError);
  });
});

describe('the codemod under --dry-run, over a planted tree', () => {
  it('prints each list with its count and changes nothing', () => {
    // Arrange
    const root = plant();
    const before = snapshot(root);
    const status = git(root, ['status', '--porcelain']);

    // Act
    const result = run(['--dry-run', root]);

    // Assert
    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);
    expect(snapshot(root)).toEqual(before);
    expect(git(root, ['status', '--porcelain'])).toBe(status);
    expect(result.out).toContain('1. moved into the package (15)');
    expect(result.out).toContain('2. parked tests (2)');
    expect(result.out).toContain('3. deleted re-export files (2)');
    expect(result.out).toContain('8. constants flipped (2)');
    expect(result.out.at(-1)).toBe('dry run, nothing written.');
  });
});

describe('the codemod over a planted tree', () => {
  const root = plant();
  const plan: CorePackagePlan = readCorePackage(root, BEFORE);
  applyCorePackage(root, plan);
  const tracked = git(root, ['ls-files']).split('\n');

  it('reads the lists of all eight steps', () => {
    expect(plan.refusals).toEqual([]);
    expect(plan.parked.map((test) => [test.from, test.couplings])).toEqual([
      ['src/core/plan/parse.test.ts', ['src/utils/tracker.ts']],
      ['src/schema/tiers.test.ts', ['src/tests/helper.ts']],
    ]);
    expect(plan.deleted).toEqual(['src/effort/store.ts', 'src/utils/declaration.ts']);
    expect(plan.trimmed).toEqual(['src/utils/tracker.ts']);
    expect(plan.reach).toEqual({ files: 4, specifiers: 9, spelled: 1 });
    expect(plan.ownSpecifiers.map((item) => [item.file, item.from, item.to])).toEqual([
      ['src/core/plan/parse.test.ts', '../../utils/tracker.js', '../../../../utils/tracker.js'],
      ['src/effort/store/rows.test.ts', '../../utils/declaration.js', '../../core/plan/index.js'],
      ['src/schema/tiers.test.ts', '../tests/helper.js', '../../helper.js'],
    ]);
    expect(plan.entries).toEqual(BUILD_ENTRIES.map((entry) => entry.path));
    expect(plan.flipped).toEqual(['CORE_FOLDERS', 'CORE_NAMED_FILES']);
    expect(plan.pathReads.map((note) => [note.file, note.line])).toEqual([['src/core/plan/parse.test.ts', 4]]);
    expect(plan.unread).toEqual([]);
  });

  it('1. moves the core folders, the named files and their colocated tests, data and untracked files included', () => {
    for (const path of [
      'src/core/plan/blocker-comment.ts',
      'src/core/plan/draft.ts',
      'src/core/plan/testdata/real-plan.md',
      'src/effort/store/rows.lock.json',
      'src/effort/store/rows.test.ts',
      'src/ports/port.ts',
      'src/report/parse-live.test.ts',
      'src/report/parse.test.ts',
      'src/report/parse.ts',
      'src/schema/tiers.ts',
    ]) {
      expect(existsSync(join(root, packagePath(path)))).toBe(true);
      expect(existsSync(join(root, path))).toBe(false);
    }
    expect(tracked).toContain('packages/rafa/src/core/plan/parse.ts');
    expect(tracked).not.toContain('src/core/plan/parse.ts');
    expect(existsSync(join(root, 'src/core'))).toBe(false);
    expect(read(root, 'packages/rafa/src/core/plan/testdata/real-plan.md')).toBe(TREE['src/core/plan/testdata/real-plan.md']!);
  });

  it('1. leaves a test of a root file in its folder', () => {
    expect(read(root, 'src/report/lessons.test.ts')).toBe(TREE['src/report/lessons.test.ts']!);
    expect(existsSync(join(root, 'src/report/lessons.ts'))).toBe(true);
  });

  it('2 and 5. parks a coupled test, its core imports on subpaths and its root imports from its new folder', () => {
    expect(existsSync(join(root, 'src/core/plan/parse.test.ts'))).toBe(false);
    expect(tracked).toContain('src/tests/core-coupled/core/plan/parse.test.ts');
    expect(read(root, 'src/tests/core-coupled/core/plan/parse.test.ts')).toBe(lines(
      'import { parsePlan } from \'@open-tomato/rafa/core/plan/parse\';',
      'import { findNextTask } from \'../../../../utils/tracker.js\';',
      '',
      'const FIXTURE = new URL(\'./testdata/real-plan.md\', import.meta.url);',
      'export const read = [parsePlan, findNextTask, FIXTURE];',
    ));
    expect(read(root, 'src/tests/core-coupled/schema/tiers.test.ts')).toBe(lines(
      'import { tiers } from \'@open-tomato/rafa/schema/tiers\';',
      'import { helper } from \'../../helper.js\';',
      '',
      'export const both = [tiers, helper];',
    ));
  });

  it('3. deletes the re-export files and trims the tracker\'s block', () => {
    expect(existsSync(join(root, 'src/utils/declaration.ts'))).toBe(false);
    expect(existsSync(join(root, 'src/effort/store.ts'))).toBe(false);
    expect(tracked).not.toContain('src/utils/declaration.ts');
    expect(read(root, 'src/utils/tracker.ts')).toBe(lines(
      'import { blockerComment } from \'@open-tomato/rafa/core/plan\';',
      '',
      'export function findNextTask(): string {',
      '  return blockerComment;',
      '}',
    ));
  });

  it('4 and 7. rewrites every kind of specifier into core to its subpath, splits a block import, and the core paths in comments and strings', () => {
    expect(read(root, 'src/app.ts')).toBe(lines(
      '// The parser lives in packages/rafa/src/core/plan/parse.ts, tested by src/tests/core-coupled/core/plan/parse.test.ts.',
      'import type { Port } from \'@open-tomato/rafa/ports\';',
      '',
      'import { parsePlan } from \'@open-tomato/rafa/core/plan\';',
      'import { rows } from \'@open-tomato/rafa/store/rows\';',
      'import { findNextTask } from \'./utils/tracker.js\';',
      'import { blockerComment } from \'@open-tomato/rafa/core/plan\';',
      '',
      'declare module \'@open-tomato/rafa/core/plan\' {',
      '  interface PlanExtra { readonly extra: string }',
      '}',
      '',
      'export const BARREL = \'packages/rafa/src/effort/store/index.ts\';',
      'export const KEPT = [\'packages/rafa/src/core/\', \'src/effort/store.ts\', \'dist/src/core/x.ts\'];',
      'export const loaded = [parsePlan, rows, blockerComment, findNextTask, import(\'@open-tomato/rafa/core/plan/parse\'), require(\'@open-tomato/rafa/schema/tiers\')];',
      'export type Seen = Port;',
    ));
    expect(read(root, 'scripts/uses-core.ts')).toBe(lines('import { rows } from \'@open-tomato/rafa/store/rows\';', '', 'export const used = rows;'));
  });

  it('4. leaves a specifier already spelled by subpath and one of the tracker\'s own names', () => {
    expect(read(root, 'packages/hub/src/main.ts')).toBe(TREE['packages/hub/src/main.ts']!);
    expect(read(root, 'src/uses-tracker.ts')).toBe(TREE['src/uses-tracker.ts']!);
  });

  it('5. points a moved test that named a root re-export at the core file it named', () => {
    expect(read(root, 'packages/rafa/src/effort/store/rows.test.ts')).toBe(lines(
      'import { rows } from \'./rows.js\';',
      'import { parsePlan } from \'../../core/plan/index.js\';',
      '',
      'export const both = [rows, parsePlan];',
    ));
  });

  it('6. writes the two one-line build entries at the old barrel paths', () => {
    for (const entry of BUILD_ENTRIES) {
      const code = read(root, entry.path).split('\n')
        .filter((line) => line !== '' && !line.startsWith('/**') && !line.startsWith(' *'));
      expect(code).toEqual([`export * from '@open-tomato/rafa/${entry.subpath}';`]);
    }
  });

  it('7. renames the cluster map\'s paths in place and rewrites prose, leaving the survey record and the hand-edited tables', () => {
    expect(JSON.parse(read(root, 'docs/survey/cluster-map.json'))).toEqual({
      base: 'abc1234',
      clusters: { 'src/app.ts': 'c1', 'packages/rafa/src/core/plan/parse.ts': 'c2', 'packages/rafa/src/effort/store/rows.ts': 'c2' },
      outside: ['packages/rafa/src/ports/index.ts'],
    });
    expect(read(root, 'context/source.md')).toBe(
      'Core is `packages/rafa/src/core/`, the store `packages/rafa/src/effort/store` and `packages/rafa/src/report/parse.ts`; '
      + 'the parser\'s test is `src/tests/core-coupled/core/plan/parse.test.ts`.\n',
    );
    expect(read(root, 'packages/rafa/src/core/plan/parse.ts')).toContain('its barrel is packages/rafa/src/core/plan/index.ts.');
    expect(read(root, 'docs/survey/README.md')).toBe(TREE['docs/survey/README.md']!);
    expect(read(root, 'scripts/survey/cut-table.ts')).toBe(TREE['scripts/survey/cut-table.ts']!);
  });

  it('8. flips CORE_FOLDERS and CORE_NAMED_FILES', () => {
    expect(read(root, 'scripts/survey/core-moves.ts')).toBe(lines(
      'export const CORE_SOURCE = \'packages/rafa/src/\';',
      'export const CORE_FOLDERS: readonly string[] = [CORE_SOURCE];',
      'export const CORE_NAMED_FILES: readonly string[] = [];',
    ));
  });

  it('prints the written count after a run', () => {
    expect(reportLines(plan, false).at(-1)).toBe(`wrote ${plan.writes.size} file(s).`);
  });

  it('refuses a second run: core is its package now', () => {
    const result = run([root]);
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('core is already its package');
  });
});

describe('the codemod\'s refusals and command line', () => {
  it('writes nothing and exits 2 when a re-export names two core files', () => {
    // Arrange
    const root = plant({ 'src/two.ts': lines('/** Old path (#1090). */', 'export { rows } from \'./effort/store/rows.js\';', 'export { parsePlan } from \'./core/plan/parse.js\';') });
    const before = snapshot(root);

    // Act
    const result = run([root]);

    // Assert
    expect(result.code).toBe(2);
    expect(result.out).toContain('  src/two.ts:2 re-exports more than one core file, or `*`');
    expect(result.out.at(-1)).toBe('refused, nothing written.');
    expect(snapshot(root)).toEqual(before);
  });

  it.each([
    ['an unknown flag', ['--force']],
    ['two roots', ['a', 'b']],
  ])('answers the usage line and exit 2 for %s', (_name, argv) => {
    const result = run(argv);
    expect(result.code).toBe(2);
    expect(result.err).toEqual([USAGE]);
  });
});
