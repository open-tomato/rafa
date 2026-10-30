import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Runs git in a scratch repository, fails the test on a non-zero exit, and returns what it printed. */
export function git(root: string, args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${result.exitCode}: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

/** Writes `text` at `path` under `root`, making its folders. */
export function plant(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** The git options a scratch commit is made under, whatever the machine's own configuration. */
export const IDENTITY: readonly string[] = ['-c', 'user.name=survey', '-c', 'user.email=survey@example.invalid', '-c', 'commit.gpgsign=false'];

/** The map a scratch repository of the record and the guard is read by. */
export const SCRATCH_MAP = 'docs/survey/cut-table.json';

/**
 * A scratch repository's files in scope: the bin, a test of its own unit,
 * and a second unit no test reaches yet.
 */
export const SCRATCH_FILES: Readonly<Record<string, string>> = {
  'src/a/one.test.ts': 'import { expect, it } from \'bun:test\';\nimport { x } from \'../deep/x.js\';\n'
    + 'it(\'x\', () => expect(x).toBe(1));\n',
  'src/deep/x.ts': 'export const x = 1;\n',
  'src/far/y.ts': 'export const y = 2;\n',
  'src/rafa.ts': 'import { x } from \'./deep/x.js\';\nexport const bin = x;\n',
};

/**
 * The cut table the scratch repositories plant: the bin, its test and
 * `fresh.test.ts`, listed before it is written, in `@scratch/cli`, and
 * `y.ts` alone in `@scratch/far`. `untracked.test.ts`, `stray.test.ts`
 * and `stray/z.ts` are listed nowhere; the two under `src/stray/` stay
 * unplaced, since no listed file sits beside them and no row names a
 * folder.
 */
export const SCRATCH_TABLE: string = `${JSON.stringify({
  packages: [
    { files: ['src/a/fresh.test.ts', 'src/a/one.test.ts', 'src/deep/x.ts', 'src/rafa.ts'], name: '@scratch/cli' },
    { files: ['src/far/y.ts'], name: '@scratch/far' },
  ],
  unassigned: [],
}, null, 2)}\n`;

/**
 * Plants a scratch repository of the record and the guard: the files in
 * scope, the cut table, a root manifest with no workspace member, and a
 * file out of scope, all staged and none committed.
 *
 * @param prefix - The temp folder's prefix.
 * @param files - The files in scope, by path; the unit test and its sources unless handed.
 * @param table - The cut table's text; {@link SCRATCH_TABLE} unless handed.
 * @returns The repository's root.
 */
export function plantScratch(prefix: string, files: Readonly<Record<string, string>> = SCRATCH_FILES, table: string = SCRATCH_TABLE): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  git(root, ['init', '--quiet']);
  for (const [path, text] of Object.entries(files)) {
    plant(root, path, text);
  }
  plant(root, SCRATCH_MAP, table);
  plant(root, 'package.json', '{ "name": "scratch", "private": true, "workspaces": [] }\n');
  plant(root, 'README.md', 'A file out of scope.\n');
  git(root, ['add', '-A']);
  return root;
}

/** The record mode of a scratch repository, its map passed relative to the root. */
export const RECORD_MODE: { readonly baseline: true; readonly map: string } = { baseline: true, map: SCRATCH_MAP };

/** Runs the script itself in `root` with `args`, and returns its exit code and what it printed. */
export function runScript(root: string, args: readonly string[]): { exitCode: number; stderr: string; stdout: string } {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, 'test-index.ts'), ...args], {
    cwd: root,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  return { exitCode: result.exitCode, stderr: result.stderr.toString(), stdout: result.stdout.toString() };
}

/**
 * Runs the guard in `root` against `record`.
 *
 * @param root - The scratch repository's root.
 * @param record - The record's path.
 * @param map - The cut table's path; {@link SCRATCH_MAP} unless handed.
 * @returns The exit code and what the guard printed.
 */
export function runGuard(root: string, record: string, map: string = SCRATCH_MAP): { exitCode: number; stderr: string; stdout: string } {
  return runScript(root, [`--against=${record}`, `--map=${map}`]);
}
