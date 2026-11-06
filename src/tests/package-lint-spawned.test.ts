/**
 * `bunx eslint --no-warn-ignored -f json <file>` run from the directory of
 * each workspace member, on one file that member's lint covers, exits 0 and
 * reports that file, and the same run on a copy of a package with a planted
 * `import/order` violation in `src/planted-order.ts` exits 1 naming the rule.
 * This proves each member's lint config loads and runs; CI's root
 * `bunx eslint .` (`.github/workflows/verify.yml` line 37) proves every
 * package clean. The scratch copy lives under the gitignored `.tmp/` so Node
 * resolution finds the root's `node_modules`, as
 * `packages/rafa-run/src/start/lint-step.packages.test.ts` does.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

const ROOT = resolve(import.meta.dir, '..', '..');
const PACKAGES_DIR = join(ROOT, 'packages');
const SYNC_SERVICE = 'rafa-sync-service';
const LINT_TIMEOUT_MS = 120_000;

interface LintRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const memberDirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && Bun.file(join(PACKAGES_DIR, entry.name, 'package.json')).size > 0)
  .map((entry) => entry.name)
  .sort();

/**
 * One file a member's lint covers, relative to `dir`: the first `*.ts` under
 * `src/` in sorted order, else `index.ts`, else the first root `*.test.ts`.
 */
function lintTarget(dir: string): string {
  const srcDir = join(dir, 'src');
  const underSrc = existsSync(srcDir)
    ? readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
      .filter((path) => path.endsWith('.ts') && !path.split('/').includes('node_modules'))
      .sort()
    : [];
  if (underSrc[0] !== undefined) return join('src', underSrc[0]);
  if (existsSync(join(dir, 'index.ts'))) return 'index.ts';
  const rootTest = readdirSync(dir)
    .filter((path) => path.endsWith('.test.ts'))
    .sort()[0];
  if (rootTest === undefined) throw new Error(`no lint target in ${dir}`);
  return rootTest;
}

/** Runs `bunx eslint --no-warn-ignored -f json <file>` in `cwd`; the JSON report is on stdout. */
async function lintIn(cwd: string, file: string): Promise<LintRun> {
  const proc = Bun.spawn(['bunx', 'eslint', '--no-warn-ignored', '-f', 'json', file], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('bunx eslint on one file from each workspace member', () => {
  it('finds the eleven workspace members', () => {
    expect(memberDirs).toEqual(['eslint-config', 'rafa', 'rafa-board', 'rafa-effort', 'rafa-hub', 'rafa-inventory', 'rafa-pr', 'rafa-release', 'rafa-run', 'rafa-sync-service', 'typescript-config']);
  });

  for (const name of memberDirs) {
    it(`exits 0 and lints its file in packages/${name}`, async () => {
      const dir = join(PACKAGES_DIR, name);
      const run = await lintIn(dir, lintTarget(dir));
      const context = `stderr: ${run.stderr}\nstdout: ${run.stdout.slice(0, 2000)}`;
      expect(run.exitCode, context).toBe(0);
      const report = JSON.parse(run.stdout) as unknown[];
      expect(report.length, context).toBeGreaterThan(0);
    }, LINT_TIMEOUT_MS);
  }
});

describe('bunx eslint on the planted file of a copy of a package', () => {
  it('exits 1 naming import/order', async () => {
    mkdirSync(join(ROOT, '.tmp'), { recursive: true });
    const scratch = mkdtempSync(join(ROOT, '.tmp', 'package-lint-'));
    scratchDirs.push(scratch);
    const copy = join(scratch, SYNC_SERVICE);
    cpSync(join(PACKAGES_DIR, SYNC_SERVICE), copy, {
      recursive: true,
      filter: (source) => !source.split('/').includes('node_modules'),
    });
    const planted = join(copy, 'src', 'planted-order.ts');
    mkdirSync(dirname(planted), { recursive: true });
    writeFileSync(planted, 'import { helper } from \'./state.js\';\nimport { join } from \'node:path\';\n\nexport const planted = [helper, join];\n');

    const run = await lintIn(copy, join('src', 'planted-order.ts'));
    const context = `stderr: ${run.stderr}\nstdout: ${run.stdout.slice(0, 2000)}`;
    expect(run.exitCode, context).toBe(1);
    const ruleIds = (JSON.parse(run.stdout) as { messages: { ruleId: string | null }[] }[])
      .flatMap((file) => file.messages.map((message) => message.ruleId));
    expect(ruleIds, context).toContain('import/order');
  }, LINT_TIMEOUT_MS);
});
