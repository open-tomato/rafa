/**
 * The board-imports sweep: holds board's code files to no import of a
 * file of run, pr, release or the CLI, by value, by type or through a
 * facade (#1336, the fifth decouple item of #808, and pass 4c).
 *
 * Board moves third, and a package may not import a package that moves
 * after it. The files read are the `files` list of the `rafa-board` row
 * of `docs/survey/cut-table.json` and the files `BOARD_NAMED` of
 * `scripts/survey/cut-names.ts` places, less the test files. Each
 * specifier of each file, read by `textImports` (which takes `import type`
 * and `export … from` as it takes a value import) and resolved as the
 * import graph resolves it, `bunResolver` of `scripts/survey/import-graph.ts`,
 * must land on no file of the `rafa-run`, `rafa-pr`, `rafa-release` or
 * `@open-tomato/rafa` row, and on none of the three facades' entry files.
 * A violation is named by its importer, its specifier and its landing.
 *
 * The `@open-tomato/rafa` row is the CLI's: board moves into a package
 * the CLI imports, so an import of a CLI file is refused too. The facade
 * entries come from the three feature rows alone ({@link FACADE_ROWS}),
 * since the CLI has no facade of its own.
 *
 * The count of files read is printed at load time so an empty read cannot
 * pass, and a planted tree holds one control for each failure (a relative
 * value import, a type import, a facade import, a relative import of a
 * CLI file) and one passing control.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';

import { BOARD_NAMED } from '../../scripts/survey/cut-names.js';
import { bunResolver, textImports } from '../../scripts/survey/import-graph.js';

import { SWEEP_TIMEOUT } from './sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The cut table, from the repository root. */
const CUT_TABLE = 'docs/survey/cut-table.json';

/** The feature rows board may not import, each with a facade, by their names in the cut table. */
const FACADE_ROWS: readonly string[] = ['rafa-run', 'rafa-pr', 'rafa-release'];

/** The package rows board may not import: the feature rows and the CLI's, which has no facade. */
const FORBIDDEN_ROWS: readonly string[] = [...FACADE_ROWS, '@open-tomato/rafa'];

/** The entry files of the three facades, which a bare package specifier lands on. */
const FACADE_ENTRIES: readonly string[] = FACADE_ROWS.flatMap((name) => [
  `packages/${name}/index.ts`,
  `packages/${name}/commands.ts`,
]);

/** The code files of a row: a TypeScript or JavaScript file that is no test. */
const CODE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/** One import that breaks the rule, with where it landed. */
interface Violation {
  readonly from: string;
  readonly landed: string;
  readonly specifier: string;
}

/** The inputs of {@link readBoardImports}. */
interface ReadInput {
  readonly forbidden: ReadonlySet<string>;
  readonly files: readonly string[];
  readonly resolve: (specifier: string, from: string) => string | undefined;
  readonly sources: ReadonlyMap<string, string>;
}

/** One row of the cut table. */
interface CutRow {
  readonly files: readonly string[];
  readonly name: string;
}

/**
 * Whether a path is a code file and no test.
 *
 * @param path - A repository-relative path.
 * @returns `true` for a source or test-support code file.
 */
function isBoardCode(path: string): boolean {
  return CODE_FILE.test(path) && !TEST_FILE.test(path);
}

/**
 * Reads the rows of the cut table.
 *
 * @returns The rows by name.
 * @throws When a forbidden row or the board row is missing.
 */
function readRows(): Map<string, CutRow> {
  const table = JSON.parse(readFileSync(join(REPO_ROOT, CUT_TABLE), 'utf8')) as { packages: CutRow[] };
  const rows = new Map(table.packages.map((row) => [row.name, row]));
  for (const name of ['rafa-board', ...FORBIDDEN_ROWS]) {
    if (!rows.has(name)) {
      throw new Error(`${CUT_TABLE} has no row named ${name}`);
    }
  }
  return rows;
}

/**
 * Reads every import of a file set and keeps those landing on a forbidden file.
 * Pure over its input.
 *
 * @param input - The files, their texts, the forbidden set and a resolver.
 * @returns The violations, sorted by importer then specifier.
 */
function readBoardImports(input: ReadInput): Violation[] {
  const violations: Violation[] = [];
  for (const from of [...new Set(input.files)].sort()) {
    const text = input.sources.get(from);
    if (text === undefined) {
      continue;
    }
    for (const specifier of textImports(text)) {
      const landed = input.resolve(specifier, from);
      if (landed !== undefined && input.forbidden.has(landed)) {
        violations.push({ from, landed, specifier });
      }
    }
  }
  return violations;
}

/**
 * One violation as a line: importer, specifier, landing.
 *
 * @param violation - The violation.
 * @returns The line.
 */
function violationLine(violation: Violation): string {
  return `${violation.from} imports '${violation.specifier}', which lands on ${violation.landed}`;
}

const rows = readRows();
const boardFiles = [...new Set([...(rows.get('rafa-board')?.files ?? []), ...BOARD_NAMED])].filter(isBoardCode).sort();
const forbiddenFiles = new Set([
  ...FORBIDDEN_ROWS.flatMap((name) => rows.get(name)?.files ?? []),
  ...FACADE_ENTRIES,
]);
const sources = new Map<string, string>();
for (const path of boardFiles) {
  sources.set(path, readFileSync(join(REPO_ROOT, path), 'utf8'));
}

const live = readBoardImports({ files: boardFiles, forbidden: forbiddenFiles, resolve: bunResolver(REPO_ROOT), sources });

console.log(
  `board-imports: read ${sources.size} board code file(s) against ${forbiddenFiles.size} run, pr, release and CLI file(s); `
  + `${live.length} violation(s)`,
);

const planted: string[] = [];

/**
 * Plants a tree under a fresh folder, with a `node_modules` link for the
 * facade, and reads its `board/` files against its `run/` and `cli/` files
 * and facade.
 *
 * @param tree - File text by path under the tree.
 * @returns The violations.
 */
function readPlanted(tree: Readonly<Record<string, string>>): Violation[] {
  const root = mkdtempSync(join(tmpdir(), 'board-imports-sweep-'));
  planted.push(root);
  const written = new Map<string, string>();
  const all: Record<string, string> = {
    'node_modules/@open-tomato/rafa-run/package.json': JSON.stringify({ main: '../../../facade/index.ts', name: '@open-tomato/rafa-run' }),
    'facade/index.ts': 'export const f = 1;\n',
    'run/a.ts': 'export const a = 1;\nexport type T = number;\n',
    'cli/a.ts': 'export const c = 1;\n',
    'board/ok.ts': 'export const ok = 1;\n',
    ...tree,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
    written.set(path, text);
  }
  return readBoardImports({
    files: [...written.keys()].filter((path) => path.startsWith('board/')),
    forbidden: new Set(['run/a.ts', 'cli/a.ts', 'facade/index.ts']),
    resolve: bunResolver(root),
    sources: written,
  });
}

afterAll(() => {
  for (const root of planted) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('the board-imports sweep', () => {
  it('reads board\'s code files, proving the scan is not vacuous', () => {
    expect(sources.size).toBeGreaterThan(0);
    expect(forbiddenFiles.size).toBeGreaterThan(FACADE_ENTRIES.length);
    expect(boardFiles.every((path) => sources.has(path))).toBe(true);
  });

  it('holds the facade entries to files that exist', () => {
    for (const entry of FACADE_ENTRIES) {
      expect([entry, readFileSync(join(REPO_ROOT, entry), 'utf8').length > 0]).toEqual([entry, true]);
    }
  });

  it('lands no board import on a run, pr, release or CLI file or a facade entry', () => {
    const lines = live.map((violation) => violationLine(violation));
    expect(lines, `board import(s) of run, pr, release or the CLI:\n${lines.join('\n')}`).toEqual([]);
  });
});

describe('the planted-tree controls', () => {
  it('passes a tree whose board file imports only a board file', () => {
    const violations = readPlanted({ 'board/b.ts': 'import { ok } from \'./ok.js\';\nexport const b = ok;\n' });
    expect(violations).toEqual([]);
  });

  it('fails a relative value import of a run file', () => {
    const violations = readPlanted({ 'board/b.ts': 'import { a } from \'../run/a.js\';\nexport const b = a;\n' });
    expect(violations).toEqual([{ from: 'board/b.ts', landed: 'run/a.ts', specifier: '../run/a.js' }]);
  });

  it('fails a type import of a run file', () => {
    const violations = readPlanted({ 'board/b.ts': 'import type { T } from \'../run/a.js\';\nexport type U = T;\n' });
    expect(violations).toEqual([{ from: 'board/b.ts', landed: 'run/a.ts', specifier: '../run/a.js' }]);
  });

  it('fails an import through the facade', () => {
    const violations = readPlanted({
      'board/b.ts': 'import { f } from \'@open-tomato/rafa-run\';\nexport const b = f;\n',
    });
    expect(violations).toEqual([{ from: 'board/b.ts', landed: 'facade/index.ts', specifier: '@open-tomato/rafa-run' }]);
  });

  it('fails a relative import of a CLI file', () => {
    const violations = readPlanted({ 'board/b.ts': 'import { c } from \'../cli/a.js\';\nexport const b = c;\n' });
    expect(violations).toEqual([{ from: 'board/b.ts', landed: 'cli/a.ts', specifier: '../cli/a.js' }]);
  });
});
