import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { realNodeModules } from './real-node-modules.js';

/**
 * `bun test --changed` follows a `paths`-mapped import from the root and from
 * `packages/rafa-hub` into core's source. A scratch worktree of `HEAD` gets
 * the repository's `node_modules` linked in and one exported constant
 * appended to a store file under `packages/rafa/src/`; the run is given two
 * test files, one in the root that imports the store barrel and one in the
 * hub package, and must keep both. The control runs the same command with no
 * change and must keep neither.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CHECKOUT = REPO_ROOT;
const EDITED = 'packages/rafa/src/effort/store/schema-plan.ts';
const ROOT_TEST = 'src/index.test.ts';
const HUB_TEST = 'packages/rafa-hub/src/core-subpaths.test.ts';
const SCRATCH_TIMEOUT_MS = 120_000;

let tempBase = '';
let worktree = '';

function git(args: string[], cwd: string): void {
  const run = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`);
}

/** Runs `bun test --changed` over the two files; returns the files the JUnit report names. */
function selected(name: string): { exitCode: number; files: string[] } {
  const junit = join(tempBase, `${name}.xml`);
  const run = Bun.spawnSync(
    ['env', '-u', 'CLAUDECODE', 'bun', 'test', '--changed', ROOT_TEST, HUB_TEST, '--reporter=junit', `--reporter-outfile=${junit}`],
    { cwd: worktree, stdout: 'pipe', stderr: 'pipe' },
  );
  const xml = existsSync(junit)
    ? readFileSync(junit, 'utf8')
    : '';
  const files = [...xml.matchAll(/<testsuite [^>]*file="([^"]+)"/g)].map((m) => m[1] ?? '');
  return { exitCode: run.exitCode, files };
}

/**
 * Links the repository's `node_modules` into the scratch worktree, with the
 * `@open-tomato` workspace links pointing at the worktree's own packages: a
 * single directory link would resolve `@open-tomato/rafa-effort` to the
 * checkout's copy and load every facade module twice.
 */
function linkNodeModules(real: string, target: string): void {
  mkdirSync(join(target, 'node_modules'));
  for (const entry of readdirSync(real)) {
    if (entry === '@open-tomato') continue;
    symlinkSync(join(real, entry), join(target, 'node_modules', entry));
  }
  const scopeDir = join(target, 'node_modules', '@open-tomato');
  mkdirSync(scopeDir);
  for (const entry of readdirSync(join(real, '@open-tomato'))) {
    const link = join(real, '@open-tomato', entry);
    const linkTarget = lstatSync(link).isSymbolicLink()
      ? readlinkSync(link)
      : link;
    const isWorkspace = linkTarget.startsWith('../../packages/');
    symlinkSync(isWorkspace
      ? linkTarget
      : realpathSync(link), join(scopeDir, entry));
  }
}

beforeAll(() => {
  tempBase = mkdtempSync(join(tmpdir(), 'rafa-core-changed-'));
  worktree = join(tempBase, 'wt');
  git(['worktree', 'add', '--detach', worktree, 'HEAD'], REPO_ROOT);
  linkNodeModules(realNodeModules(), worktree);
}, SCRATCH_TIMEOUT_MS);

afterAll(() => {
  if (worktree !== '') Bun.spawnSync(['git', 'worktree', 'remove', '--force', worktree], { cwd: CHECKOUT });
  if (tempBase !== '') rmSync(tempBase, { recursive: true, force: true });
});

describe('bun test --changed over an edit under packages/rafa/src/', () => {
  test('selects neither file when nothing changed', () => {
    const { files } = selected('control');

    expect(files.some((f) => f.endsWith(ROOT_TEST))).toBe(false);
    expect(files.some((f) => f.endsWith(HUB_TEST))).toBe(false);
  }, SCRATCH_TIMEOUT_MS);

  test('selects a root test file and a rafa-hub test file after the edit', () => {
    appendFileSync(join(worktree, EDITED), '\nexport const CHANGED_PROBE: number = 1;\n');

    const { exitCode, files } = selected('edited');

    expect(files.some((f) => f.endsWith(ROOT_TEST))).toBe(true);
    expect(files.some((f) => f.endsWith(HUB_TEST))).toBe(true);
    expect(exitCode).toBe(0);
  }, SCRATCH_TIMEOUT_MS);
});
