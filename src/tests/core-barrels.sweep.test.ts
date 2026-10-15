/**
 * The core-barrels sweep: holds the import rule of the move of #905
 * against the live tree, not a fixture.
 *
 * The rule: a file outside core imports a barrel that
 * `scripts/survey/core-moves.ts` lists and nothing deeper under
 * `packages/rafa/src/core/`: static, `import type`, `export … from`, dynamic
 * `import()` or `require()`. `scripts/survey/core-barrels.ts`
 * (`readCoreImports`) does the reading; its own unit tests cover it over
 * planted trees. This file is the other half: it runs it over every code
 * file a commit of the working tree would hold, and reddens on any deep
 * import at all. There is no allow-list: a path is allowed by listing it
 * as a barrel in `core-moves.ts`, where a unit test holds the list.
 *
 * The files it reads are the ones `git add -A` would commit: every file
 * git tracks, and every untracked file no ignore rule covers, less a
 * file that is gone from disk. A barrel or an importer written by the
 * task under check is untracked until the loop commits it, so a listing
 * of tracked files alone would pass the task and fail the commit after
 * it. The scope is the whole repository, test files included: `src/`,
 * `scripts/`, `packages/`, and whatever else holds code, less core's own
 * files and its parked tests, the paths `isCoreRead` of `core-moves.ts`
 * holds, which are named and not read.
 *
 * The count and the files read are printed once, at load time, before
 * any assertion runs, so a run that silently read nothing cannot pass by
 * reporting an empty list for the wrong reason. Until a file has moved,
 * `packages/rafa/src/core/` does not exist and zero deep imports is the true reading
 * of a rule nothing can break yet. The third case below is the control
 * that switches itself on with the first move: once `packages/rafa/src/core/` holds a
 * code file, a scan that finds no import of a barrel from outside it is
 * not seeing the folder.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, setDefaultTimeout } from 'bun:test';

import { deepImportLine, isCodeFile, readCoreImports } from '../../scripts/survey/core-barrels.js';
import { CORE_FOLDER, CORE_FOLDERS } from '../../scripts/survey/core-moves.js';
import { bunResolver } from '../../scripts/survey/import-graph.js';

import { SWEEP_TIMEOUT } from './sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

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
 * The lines this sweep prints before it asserts: how many files it read
 * and what it found, then the files by name, so a vacuous run (an empty
 * read set) cannot pass silently.
 *
 * @param reading - What `readCoreImports` answered.
 * @returns The count line and the line of names.
 */
function filesReadLines(reading: ReturnType<typeof readCoreImports>): string {
  const counts = `core-barrels: read ${reading.read.length} file(s) outside core, left ${reading.inside.length} of core's `
    + `(${CORE_FOLDERS.join(', ')}, its named files, its parked tests) unread; `
    + `${reading.barrel.length} import(s) reach a barrel, ${reading.deep.length} reach deeper`;
  return `${counts}\ncore-barrels: files read: ${reading.read.join(', ')}`;
}

const files = committableCodeFiles();
const sources = new Map<string, string>();
for (const path of files) {
  sources.set(path, readFileSync(join(REPO_ROOT, path), 'utf8'));
}

const reading = readCoreImports({ files, resolve: bunResolver(REPO_ROOT), sources });

// Printed once, at load time, so a vacuous run (an empty read set) shows
// up in every test's output rather than only in one of them.
console.log(filesReadLines(reading));

describe('the core-barrels sweep', () => {
  it('reads a non-empty file set across src/, scripts/ and packages/, proving the scan is not vacuous', () => {
    expect(reading.read.length).toBeGreaterThan(0);
    expect(reading.missing).toEqual([]);
    for (const folder of ['src/', 'scripts/', 'packages/']) {
      expect([folder, reading.read.some((path) => path.startsWith(folder))]).toEqual([folder, true]);
    }
    // A test file and this sweep's own library half are both read.
    expect(reading.read).toContain('src/tests/commands-direction.sweep.test.ts');
    expect(reading.read).toContain('scripts/survey/core-barrels.ts');
  });

  it('holds no import from outside core deeper than a barrel of scripts/survey/core-moves.ts', () => {
    const lines = reading.deep.map((edge) => deepImportLine(edge));
    expect(lines, `deep import(s) into ${CORE_FOLDER} from outside it, import the subject's barrel:\n${lines.join('\n')}`).toEqual([]);
  });

  it('reaches a barrel from outside core once the barrels\' folder holds a file, proving the scan sees it', () => {
    const underBarrels = reading.inside.filter((path) => path.startsWith(CORE_FOLDER));
    const seesTheFolder = underBarrels.length === 0 || reading.barrel.length > 0;
    expect(
      seesTheFolder,
      `${underBarrels.length} code file(s) lie under ${CORE_FOLDER} and no import from outside core reaches a barrel: `
      + 'the resolver is not reaching the folder, or the barrels of scripts/survey/core-moves.ts are not the ones written',
    ).toBe(true);
  });
});
