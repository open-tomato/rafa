/**
 * The facade-subpaths sweep: a non-test file outside the six facade
 * folders (`packages/rafa-<name>/` for board, effort, inventory, pr,
 * release and run) takes a facade by its name or by its `commands` entry,
 * never by any other subpath.
 *
 * A facade's `"./*"` export, which maps `@open-tomato/rafa-<name>/<path>`
 * onto `src/<path>.ts` of the package, exists for the tests outside the
 * package: they take names the facade's `index.ts` does not export (a
 * reader's internals, a fixture builder), and a file that moved into the
 * package keeps them reachable through its subpath. A non-test file has
 * the facade's name for what the package offers, so a subpath import there
 * reaches past the facade into a file the package may move or rename. Each
 * later move's outside tests join the count of test files on a subpath.
 *
 * The files read are the code files `git ls-files` holds outside the
 * facade folders; those `classifyFile` of `scripts/survey/files.ts` reads
 * as `test` or `test-support` are set aside from the rule and counted. The
 * counts are printed once, at load, so a read that found nothing cannot
 * pass as a clean one, and a planted text holding a subpath import is held
 * to be named, so the check could fail.
 *
 * Two files are excepted, by name, from the rule, and only for a dynamic
 * `import()` of a subpath (see {@link LAZY_SUBPATH_FILES}): each is a CLI
 * command module that loads one board command module lazily, which neither
 * the facade nor its `commands` entry can carry without loading it with
 * them. A static subpath import in either file is still refused, as is the
 * same dynamic import in any other file; planted controls hold both. The
 * exception names files, not a folder or a pattern, and a third case goes
 * to the person before it joins the list.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import ts from 'typescript';

import { classifyFile } from '../../scripts/survey/files.js';

import { SWEEP_TIMEOUT } from './sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The six facades, by the name after `rafa-`. */
const FACADE_NAMES: readonly string[] = ['board', 'effort', 'inventory', 'pr', 'release', 'run'];

/** The one subpath a non-test file may take a facade by. */
const ALLOWED_SUBPATH = 'commands';

/**
 * The files that may take a facade subpath by a dynamic `import()`, each
 * with its reason. Nothing else is excepted: a static import or an
 * `export … from` of a subpath stays refused here, and no other file may
 * load a subpath at all. A third file goes to the person, not onto this
 * list.
 */
const LAZY_SUBPATH_FILES: ReadonlyMap<string, string> = new Map([
  // Loads board's `issue list` command module (`runIssueList`) when the
  // command runs; the facade cannot export it without loading it with them.
  ['src/commands/roadmap.ts', 'loads the issue list command module lazily'],
  // Loads board's `issue ready` command module (`runIssueReady`) when the
  // offer runs; the facade exports it by type only, to keep the roster lazy.
  ['src/commands/plan/ready-offer.ts', 'loads the issue ready command module lazily'],
]);

const CODE_EXTENSION = /\.(?:ts|tsx|mts|js|mjs)$/;

/** A bare facade specifier: its facade name, then an optional subpath. */
const FACADE_SPECIFIER = new RegExp(`^@open-tomato/rafa-(${FACADE_NAMES.join('|')})(?:/(.+))?$`);

/** One facade import of a file, at its 1-based line. */
interface FacadeImport {
  /** The line the specifier stands on. */
  readonly line: number;
  /** The specifier as written. */
  readonly specifier: string;
  /** The part after the facade's name, or `undefined` for the name alone. */
  readonly subpath: string | undefined;
  /** Whether the specifier is the argument of a dynamic `import()`. */
  readonly dynamic: boolean;
}

/**
 * The start offsets of the string specifiers a text passes to a dynamic
 * `import()`, read off its syntax tree.
 *
 * @param text - A source text.
 * @returns The offset each such specifier's opening quote stands at.
 */
function dynamicImportStarts(text: string): ReadonlySet<number> {
  const source = ts.createSourceFile('read.ts', text, ts.ScriptTarget.Latest, true);
  const starts = new Set<number>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument !== undefined && ts.isStringLiteralLike(argument)) {
        starts.add(argument.getStart(source));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return starts;
}

/**
 * The facade imports of a text: static, `import type`, `export … from`
 * and dynamic `import()`, read by the TypeScript pre-processor so a
 * specifier in a comment is not one.
 *
 * @param text - A source text.
 * @returns Each facade import, in source order.
 */
function facadeImports(text: string): FacadeImport[] {
  const { importedFiles } = ts.preProcessFile(text, true, true);
  const dynamicStarts = dynamicImportStarts(text);
  const found: FacadeImport[] = [];
  for (const { fileName, pos } of importedFiles) {
    const match = FACADE_SPECIFIER.exec(fileName);
    if (match === null) {
      continue;
    }
    const line = text.slice(0, pos).split('\n').length;
    // The pre-processor's offset is the specifier's opening quote.
    const dynamic = dynamicStarts.has(pos);
    found.push({ dynamic, line, specifier: fileName, subpath: match[2] });
  }
  return found;
}

/**
 * The refusals of one non-test file: each facade import on a subpath other
 * than `commands`, as `<file>:<line>: <specifier>`, but for a dynamic
 * `import()` in a file of {@link LAZY_SUBPATH_FILES}.
 *
 * @param path - The file's repository-relative path.
 * @param text - Its text.
 * @returns One line per refused import.
 */
function subpathRefusals(path: string, text: string): string[] {
  return facadeImports(text)
    .filter(({ subpath }) => subpath !== undefined && subpath !== ALLOWED_SUBPATH)
    .filter(({ dynamic }) => !(dynamic && LAZY_SUBPATH_FILES.has(path)))
    .map(({ line, specifier }) => `${path}:${line}: ${specifier}`);
}

/**
 * Whether a path lies inside one of the six facade folders.
 *
 * @param path - A repository-relative path.
 * @returns `true` for a file under `packages/rafa-<name>/`.
 */
function isInFacade(path: string): boolean {
  return FACADE_NAMES.some((name) => path.startsWith(`packages/rafa-${name}/`));
}

/**
 * The code files git tracks outside the facade folders.
 *
 * @returns Their repository-relative paths, sorted.
 * @throws When `git ls-files` cannot run or exits non-zero.
 */
function trackedCodeOutsideFacades(): string[] {
  const result = Bun.spawnSync(['git', 'ls-files', '-z'], { cwd: REPO_ROOT, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ls-files failed (exit ${result.exitCode}): ${result.stderr.toString().trim()}`);
  }
  return result.stdout
    .toString()
    .split('\0')
    .filter((path) => path !== '' && CODE_EXTENSION.test(path) && !isInFacade(path))
    .sort();
}

const read = trackedCodeOutsideFacades();
const texts = new Map(read.map((path) => [path, readFileSync(join(REPO_ROOT, path), 'utf8')]));
const nonTest = read.filter((path) => classifyFile(path) === 'source');
const testFiles = read.filter((path) => classifyFile(path) !== 'source');

/**
 * Whether a read file holds a facade import on a subpath or on the name alone.
 *
 * @param path - A path of the read.
 * @param onSubpath - `true` to look for a subpath import, `false` for the name alone.
 * @returns `true` when the file holds one.
 */
function holdsFacadeImport(path: string, onSubpath: boolean): boolean {
  return facadeImports(texts.get(path) ?? '').some(({ subpath }) => (subpath !== undefined) === onSubpath);
}

const testsOnSubpath = testFiles.filter((path) => holdsFacadeImport(path, true));
const nonTestOnName = nonTest.filter((path) => holdsFacadeImport(path, false));
const refusals = nonTest.flatMap((path) => subpathRefusals(path, texts.get(path) ?? ''));

// Printed once, at load, so an empty read shows in every run's output.
console.log(
  `facade-subpaths: read ${read.length} file(s), ${nonTest.length} non-test; `
  + `${testsOnSubpath.length} test file(s) on a facade subpath, `
  + `${nonTestOnName.length} non-test file(s) on a facade name`,
);

describe('the facade subpaths of the live tree', () => {
  test('control: the read is not empty, and it finds facade imports by name and by subpath', () => {
    expect(nonTest.length).toBeGreaterThan(0);
    expect(nonTestOnName.length).toBeGreaterThan(0);
    expect(testsOnSubpath.length).toBeGreaterThan(0);
  });

  test('no non-test file outside a facade imports a facade subpath other than commands', () => {
    expect(refusals, `take the facade by its name instead: ${refusals.join(', ')}`).toEqual([]);
  });
});

describe('the subpath reading', () => {
  test('control: a planted subpath import is named by its file, line and specifier', () => {
    const planted = [
      'import { a } from \'@open-tomato/rafa-inventory\';',
      'import { b } from \'@open-tomato/rafa-board/commands\';',
      'import type { C } from \'@open-tomato/rafa-inventory/tiers/resolve\';',
      '// import { d } from \'@open-tomato/rafa-pr/merge\';',
      'export { e } from \'@open-tomato/rafa-effort/report\';',
      'const f = await import(\'@open-tomato/rafa-run/loop\');',
      'import { g } from \'@open-tomato/rafa/core/config\';',
    ].join('\n');

    expect(subpathRefusals('src/planted.ts', planted)).toEqual([
      'src/planted.ts:3: @open-tomato/rafa-inventory/tiers/resolve',
      'src/planted.ts:5: @open-tomato/rafa-effort/report',
      'src/planted.ts:6: @open-tomato/rafa-run/loop',
    ]);
  });

  test('the exception names exactly the two lazy loaders, each with its reason', () => {
    expect([...LAZY_SUBPATH_FILES.keys()]).toEqual(['src/commands/roadmap.ts', 'src/commands/plan/ready-offer.ts']);
    for (const reason of LAZY_SUBPATH_FILES.values()) {
      expect(reason).not.toBe('');
    }
  });

  test('a dynamic subpath import in a named file is accepted', () => {
    const planted = [
      'const { runIssueList } = await import(\'@open-tomato/rafa-board/commands/issue/list\');',
      'const { runIssueReady: run } = await import(\'@open-tomato/rafa-board/commands/issue/ready\');',
    ].join('\n');

    expect(subpathRefusals('src/commands/roadmap.ts', planted)).toEqual([]);
    expect(subpathRefusals('src/commands/plan/ready-offer.ts', planted)).toEqual([]);
  });

  test('control: the same dynamic subpath import in a third file is still refused', () => {
    const planted = 'const { runIssueList } = await import(\'@open-tomato/rafa-board/commands/issue/list\');';

    expect(subpathRefusals('src/commands/third.ts', planted)).toEqual([
      'src/commands/third.ts:1: @open-tomato/rafa-board/commands/issue/list',
    ]);
  });

  test('control: a static or re-exported subpath import in a named file is still refused', () => {
    const planted = [
      'import { runIssueList } from \'@open-tomato/rafa-board/commands/issue/list\';',
      'import type { ReadyReport } from \'@open-tomato/rafa-board/commands/issue/ready\';',
      'export { runIssueList } from \'@open-tomato/rafa-board/commands/issue/list\';',
      'const lazy = await import(\'@open-tomato/rafa-board/commands/issue/list\');',
    ].join('\n');

    expect(subpathRefusals('src/commands/roadmap.ts', planted)).toEqual([
      'src/commands/roadmap.ts:1: @open-tomato/rafa-board/commands/issue/list',
      'src/commands/roadmap.ts:2: @open-tomato/rafa-board/commands/issue/ready',
      'src/commands/roadmap.ts:3: @open-tomato/rafa-board/commands/issue/list',
    ]);
  });
});
