/**
 * The commands-entry sweep (#808): holds the roster, `src/commands/index.ts`,
 * to being the one importer of a feature package's commands entry,
 * `@open-tomato/rafa-<name>/commands`.
 *
 * A commands entry re-exports a feature object alone (`BOARD_FEATURE`,
 * `RELEASE_FEATURE`, `PR_FEATURE`, `RUN_FEATURE`), and a feature's index
 * holds the loaders of its lazy command modules. A library entry that
 * reached a commands entry would reach those modules, and the splitting
 * build would write each as a chunk of that entry, which is why the
 * feature left the facade's `index.ts`. So no non-test code file under
 * `src/`, `scripts/` or `packages/` other than the roster imports one.
 *
 * The files read are the code files `git ls-files` lists under those three
 * folders whose kind `classifyFile` of `scripts/survey/files.ts` reads as
 * `source`: a test file and test support are not read, since the facades'
 * tests load their commands entries on purpose. The specifiers of a file
 * are read with `textImports` of `scripts/survey/import-graph.ts`, so a
 * comment naming a commands entry, as the roster's module note does, is no
 * import. The live reading also holds the roster to its four
 * commands-entry imports and the read set to a floor, so a reading that
 * finds nothing cannot pass; the planted controls red on an importer
 * outside the roster, static or dynamic, and leave a test file, test
 * support, a comment and a facade's bare name unread.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, setDefaultTimeout } from 'bun:test';

import { isCodeFile } from '../../scripts/survey/core-barrels.js';
import { classifyFile } from '../../scripts/survey/files.js';
import { textImports } from '../../scripts/survey/import-graph.js';

import { SWEEP_TIMEOUT } from './sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The one file allowed to import a commands entry. */
const ROSTER = 'src/commands/index.ts';

/** The folders whose tracked files the sweep reads. */
const FOLDERS = ['src', 'scripts', 'packages'] as const;

/** A specifier naming a feature package's commands entry. */
const COMMANDS_ENTRY = /^@open-tomato\/rafa-[a-z]+\/commands$/;

/** Fewer files read than this is a listing that went wrong, not a clean tree. */
const READ_FLOOR = 500;

/** One file the sweep is handed: its repository-relative path and its text. */
interface SweptFile {
  readonly path: string;
  readonly text: string;
}

/** Whether the sweep reads a path: a code file of kind `source`, so no test and no test support. */
function isRead(path: string): boolean {
  return isCodeFile(path) && classifyFile(path) === 'source';
}

/**
 * Each import of a commands entry the read files hold. Pure.
 *
 * @param files - The files to read, any of which may be left unread by {@link isRead}.
 * @returns One `<path>: <specifier>` line per import, in file then source order.
 */
function commandsImports(files: readonly SweptFile[]): string[] {
  return files
    .filter((file) => isRead(file.path))
    .flatMap((file) => textImports(file.text)
      .filter((specifier) => COMMANDS_ENTRY.test(specifier))
      .map((specifier) => `${file.path}: ${specifier}`));
}

/** The lines of {@link commandsImports} whose importer is not the roster. */
function outsideRoster(lines: readonly string[]): string[] {
  return lines.filter((line) => !line.startsWith(`${ROSTER}: `));
}

/** The paths git tracks under {@link FOLDERS}, sorted. */
function trackedPaths(): string[] {
  const listing = Bun.spawnSync(['git', 'ls-files', '-z', '--', ...FOLDERS], { cwd: REPO_ROOT, stderr: 'pipe' });
  if (listing.exitCode !== 0) {
    throw new Error(`git ls-files failed (exit ${listing.exitCode}): ${listing.stderr.toString().trim()}`);
  }
  return listing.stdout
    .toString()
    .split('\0')
    .filter((path) => path !== '')
    .sort();
}

const READ = trackedPaths().filter(isRead);
const LINES = commandsImports(READ.map((path) => ({ path, text: readFileSync(join(REPO_ROOT, path), 'utf8') })));

describe('the importers of a commands entry, over the tracked tree', () => {
  it('reads the code files under src/, scripts/ and packages/, the roster among them', () => {
    expect(READ.length).toBeGreaterThan(READ_FLOOR);
    expect(READ).toContain(ROSTER);
    expect(READ.some((path) => path.startsWith('scripts/'))).toBe(true);
    expect(READ.some((path) => path.startsWith('packages/'))).toBe(true);
  });

  it('finds the roster importing the four commands entries, one feature each', () => {
    expect(LINES.filter((line) => line.startsWith(`${ROSTER}: `))).toEqual([
      `${ROSTER}: @open-tomato/rafa-board/commands`,
      `${ROSTER}: @open-tomato/rafa-pr/commands`,
      `${ROSTER}: @open-tomato/rafa-release/commands`,
      `${ROSTER}: @open-tomato/rafa-run/commands`,
    ]);
  });

  it('finds no file outside the roster importing a commands entry', () => {
    expect(outsideRoster(LINES)).toEqual([]);
  });
});

describe('the importers of a commands entry, over planted files', () => {
  it('names a planted importer outside the roster, static and dynamic', () => {
    const planted: SweptFile[] = [
      { path: 'src/plan.ts', text: 'import { PR_FEATURE } from \'@open-tomato/rafa-pr/commands\';\n' },
      { path: 'scripts/x.ts', text: 'const { RUN_FEATURE } = await import(\'@open-tomato/rafa-run/commands\');\n' },
    ];

    expect(outsideRoster(commandsImports(planted))).toEqual([
      'src/plan.ts: @open-tomato/rafa-pr/commands',
      'scripts/x.ts: @open-tomato/rafa-run/commands',
    ]);
  });

  it('does not read a test file or test support, which import a commands entry on purpose', () => {
    const planted: SweptFile[] = [
      { path: 'packages/rafa-pr/index.test.ts', text: 'import { PR_FEATURE } from \'@open-tomato/rafa-pr/commands\';\n' },
      { path: 'src/tests/workspace-world.ts', text: 'import { BOARD_FEATURE } from \'@open-tomato/rafa-board/commands\';\n' },
    ];

    expect(commandsImports(planted)).toEqual([]);
  });

  it('reads no import out of a comment, and none out of a facade\'s bare name', () => {
    const planted: SweptFile[] = [
      { path: 'src/plan.ts', text: '/** The roster takes `PR_FEATURE` from `@open-tomato/rafa-pr/commands`. */\nexport const x = 1;\n' },
      { path: 'src/start.ts', text: 'import { PR_SUBJECT } from \'@open-tomato/rafa-pr\';\n' },
    ];

    expect(commandsImports(planted)).toEqual([]);
  });
});
