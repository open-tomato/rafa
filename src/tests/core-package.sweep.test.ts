/**
 * The two-names sweep: holds the import names of core's workspace package
 * (#1090) against the live tree, in two halves.
 *
 * The outside half: every specifier opening with `@open-tomato/rafa/` in
 * a code file outside core, resolved by `Bun.resolveSync` from the
 * importer's folder as `bunResolver` of `scripts/survey/import-graph.ts`
 * does, lands on a file `isCoreFile` of `scripts/survey/core-moves.ts`
 * holds. One that resolves elsewhere, or to nothing, fails naming the
 * importer, the specifier and where it landed.
 *
 * The inside half: every specifier of a code file `isCoreFile` holds,
 * relative or bare, lands on a file `isCoreFile` holds, or outside the
 * repository (a package, a `node:` or `bun:` builtin). A bare
 * `@open-tomato/rafa/` specifier inside core fails even when it would
 * land inside.
 *
 * Both read the files `git add -A` would commit, as the barrels sweep
 * does, and print their counts at load time so an empty read cannot pass.
 * A planted tree holds a control for each failure.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';

import { isCodeFile } from '../../scripts/survey/core-barrels.js';
import { CORE_FOLDERS, CORE_SOURCE, isCoreFile } from '../../scripts/survey/core-moves.js';
import { bunResolver, textImports } from '../../scripts/survey/import-graph.js';

import { SWEEP_TIMEOUT } from './sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The prefix of a specifier that names core by its package. */
const PACKAGE_PREFIX = '@open-tomato/rafa/';

/** One specifier that breaks the rule, with where it landed. */
interface Violation {
  readonly from: string;
  readonly landed: string;
  readonly specifier: string;
}

/** What one reading of a file set found. */
interface Reading {
  readonly insideRead: number;
  readonly outsideRead: number;
  readonly outsideSpecifiers: number;
  readonly insideViolations: readonly Violation[];
  readonly outsideViolations: readonly Violation[];
}

/** The inputs of {@link readTwoNames}. */
interface ReadInput {
  readonly files: readonly string[];
  readonly isCore: (path: string) => boolean;
  readonly resolve: (specifier: string, from: string) => string | undefined;
  readonly sources: ReadonlyMap<string, string>;
}

/**
 * The code files a commit of the working tree would hold: tracked or
 * untracked and not ignored, and present on disk.
 *
 * @returns Their repository-relative paths, in git's order.
 * @throws When `git ls-files` exits non-zero.
 */
function committableCodeFiles(): string[] {
  const result = Bun.spawnSync(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: REPO_ROOT,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ls-files failed in ${REPO_ROOT} (exit ${result.exitCode}): ${result.stderr.toString().trim()}`);
  }
  return result.stdout
    .toString()
    .split('\0')
    .filter((path) => path !== '' && isCodeFile(path) && existsSync(join(REPO_ROOT, path)));
}

/**
 * Whether a resolved location is outside the repository: a builtin, an
 * absolute path the resolver did not bring under the root, or a package
 * folder.
 *
 * @param landed - What the resolver answered.
 * @returns `true` when it is not a file of the repository.
 */
function isOutsideRepository(landed: string): boolean {
  return landed.startsWith('/') || landed.includes('node_modules/') || /^[a-z]+:/.test(landed);
}

/**
 * Reads both halves over a file set. Pure over its input.
 *
 * @param input - The files, their texts, the core predicate and a resolver.
 * @returns The counts and the violations of each half, each sorted.
 */
function readTwoNames(input: ReadInput): Reading {
  const outsideViolations: Violation[] = [];
  const insideViolations: Violation[] = [];
  let insideRead = 0;
  let outsideRead = 0;
  let outsideSpecifiers = 0;
  for (const from of [...new Set(input.files)].sort()) {
    const text = input.sources.get(from);
    if (text === undefined) {
      continue;
    }
    const specifiers = textImports(text);
    if (input.isCore(from)) {
      insideRead += 1;
      for (const specifier of specifiers) {
        const landed = input.resolve(specifier, from);
        if (specifier.startsWith(PACKAGE_PREFIX)) {
          insideViolations.push({ from, landed: landed ?? '(nothing)', specifier });
        } else if (landed === undefined) {
          if (specifier.startsWith('.')) {
            insideViolations.push({ from, landed: '(nothing)', specifier });
          }
        } else if (!isOutsideRepository(landed) && !input.isCore(landed)) {
          insideViolations.push({ from, landed, specifier });
        }
      }
      continue;
    }
    outsideRead += 1;
    for (const specifier of specifiers.filter((name) => name.startsWith(PACKAGE_PREFIX))) {
      outsideSpecifiers += 1;
      const landed = input.resolve(specifier, from);
      if (landed === undefined || isOutsideRepository(landed) || !input.isCore(landed)) {
        outsideViolations.push({ from, landed: landed ?? '(nothing)', specifier });
      }
    }
  }
  return { insideRead, insideViolations, outsideRead, outsideSpecifiers, outsideViolations };
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

const files = committableCodeFiles();
const sources = new Map<string, string>();
for (const path of files) {
  sources.set(path, readFileSync(join(REPO_ROOT, path), 'utf8'));
}

const live = readTwoNames({ files, isCore: (path) => isCoreFile(path), resolve: bunResolver(REPO_ROOT), sources });

console.log(
  `core-package: read ${live.outsideRead} file(s) outside core (${live.outsideSpecifiers} '${PACKAGE_PREFIX}' specifier(s)) `
  + `and ${live.insideRead} inside it; ${live.outsideViolations.length} outside and ${live.insideViolations.length} inside violation(s)`,
);

/**
 * Whether core is its workspace package yet. Until the move, core's folders
 * hold colocated tests that import files above core, and two files that
 * read the root `package.json`; the codemod parks the tests and the move
 * task rewrites the rest, so the inside half has nothing to hold before it.
 * It switches itself on with `CORE_FOLDERS` naming `CORE_SOURCE`.
 */
const coreIsPackage = CORE_FOLDERS.includes(CORE_SOURCE);

const planted: string[] = [];

/**
 * Plants a tree of files under a fresh folder and reads it with a planted
 * core of `core/`, whose package name resolves by a `paths` map.
 *
 * @param tree - File text by path under the tree.
 * @returns The reading.
 */
function readPlanted(tree: Readonly<Record<string, string>>): Reading {
  const root = mkdtempSync(join(tmpdir(), 'core-package-sweep-'));
  planted.push(root);
  const written = new Map<string, string>();
  for (const [path, text] of Object.entries({
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { [`${PACKAGE_PREFIX}*`]: ['./core/*'] } } }),
    ...tree,
  })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
    written.set(path, text);
  }
  return readTwoNames({
    files: [...written.keys()].filter(isCodeFile),
    isCore: (path) => isCoreFile(path, ['core/'], []),
    resolve: bunResolver(root),
    sources: written,
  });
}

afterAll(() => {
  for (const root of planted) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('the core-package sweep', () => {
  it('reads files on both sides, proving the scan is not vacuous', () => {
    expect(live.outsideRead).toBeGreaterThan(0);
    expect(live.insideRead).toBeGreaterThan(0);
  });

  it('lands every @open-tomato/rafa/ specifier outside core on a core file', () => {
    const lines = live.outsideViolations.map((violation) => violationLine(violation));
    expect(lines, `specifier(s) of the package name that do not land in core:\n${lines.join('\n')}`).toEqual([]);
  });

  it('keeps every specifier inside core inside core or outside the repository, and none bare', () => {
    if (!coreIsPackage) {
      // Core is not its package yet: the move task switches this half on.
      expect(live.insideRead).toBeGreaterThan(0);
      return;
    }
    const lines = live.insideViolations.map((violation) => violationLine(violation));
    expect(lines, `specifier(s) inside core that break the rule:\n${lines.join('\n')}`).toEqual([]);
  });
});

describe('the planted-tree controls', () => {
  it('passes a tree that follows both rules', () => {
    const reading = readPlanted({
      'app/main.ts': `import { a } from '${PACKAGE_PREFIX}a';\nimport { x } from 'bun:test';\n`,
      'core/a.ts': 'import { b } from \'./b.js\';\nimport { f } from \'node:fs\';\nexport const a = 1;\n',
      'core/b.ts': 'export const b = 1;\n',
    });
    expect(reading.outsideViolations).toEqual([]);
    expect(reading.insideViolations).toEqual([]);
    expect(reading.outsideSpecifiers).toBe(1);
    expect(reading.insideRead).toBe(2);
  });

  it('fails an outside specifier that resolves to a file outside core', () => {
    const reading = readPlanted({
      'app/main.ts': `import { a } from '${PACKAGE_PREFIX}../app/other';\n`,
      'app/other.ts': 'export const a = 1;\n',
      'core/a.ts': 'export const a = 1;\n',
    });
    expect(reading.outsideViolations.map((violation) => violation.from)).toEqual(['app/main.ts']);
  });

  it('fails an outside specifier that resolves to nothing', () => {
    const reading = readPlanted({
      'app/main.ts': `import { a } from '${PACKAGE_PREFIX}missing';\n`,
      'core/a.ts': 'export const a = 1;\n',
    });
    expect(reading.outsideViolations).toEqual([
      { from: 'app/main.ts', landed: '(nothing)', specifier: `${PACKAGE_PREFIX}missing` },
    ]);
  });

  it('fails an inside relative specifier that lands outside core', () => {
    const reading = readPlanted({
      'app/util.ts': 'export const u = 1;\n',
      'core/a.ts': 'import { u } from \'../app/util.js\';\nexport const a = u;\n',
    });
    expect(reading.insideViolations).toEqual([
      { from: 'core/a.ts', landed: 'app/util.ts', specifier: '../app/util.js' },
    ]);
  });

  it('fails an inside relative specifier that resolves to nothing', () => {
    const reading = readPlanted({
      'core/a.ts': 'import { u } from \'./gone.js\';\nexport const a = u;\n',
    });
    expect(reading.insideViolations).toEqual([
      { from: 'core/a.ts', landed: '(nothing)', specifier: './gone.js' },
    ]);
  });

  it('fails a bare package-name specifier inside core even when it lands inside', () => {
    const reading = readPlanted({
      'core/a.ts': `import { b } from '${PACKAGE_PREFIX}b';\nexport const a = b;\n`,
      'core/b.ts': 'export const b = 1;\n',
    });
    expect(reading.insideViolations).toEqual([
      { from: 'core/a.ts', landed: 'core/b.ts', specifier: `${PACKAGE_PREFIX}b` },
    ]);
  });
});
