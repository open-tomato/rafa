/**
 * `bun run lint` run from the directory of each workspace member exits 0 and
 * lints at least one file, and a copy of a package with a planted
 * `import/order` violation exits 1 naming the rule. The scratch copy lives
 * under the gitignored `.tmp/` so Node resolution finds the root's
 * `node_modules`, as `src/start/lint-step.packages.test.ts` does.
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

/** Runs `bun run lint -f json` in `cwd`; the JSON report is on stdout. */
async function lintIn(cwd: string): Promise<LintRun> {
  const proc = Bun.spawn(['bun', 'run', 'lint', '-f', 'json'], { cwd, stdout: 'pipe', stderr: 'pipe' });
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

describe('bun run lint from each workspace member', () => {
  it('finds the seven workspace members', () => {
    expect(memberDirs).toEqual(['eslint-config', 'rafa', 'rafa-effort', 'rafa-hub', 'rafa-inventory', 'rafa-sync-service', 'typescript-config']);
  });

  for (const name of memberDirs) {
    it(`exits 0 and lints at least one file in packages/${name}`, async () => {
      const run = await lintIn(join(PACKAGES_DIR, name));
      const context = `stderr: ${run.stderr}\nstdout: ${run.stdout.slice(0, 2000)}`;
      expect(run.exitCode, context).toBe(0);
      const report = JSON.parse(run.stdout) as unknown[];
      expect(report.length, context).toBeGreaterThan(0);
    }, LINT_TIMEOUT_MS);
  }
});

describe('bun run lint over a copy of a package with a planted violation', () => {
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

    const run = await lintIn(copy);
    const context = `stderr: ${run.stderr}\nstdout: ${run.stdout.slice(0, 2000)}`;
    expect(run.exitCode, context).toBe(1);
    const ruleIds = (JSON.parse(run.stdout) as { messages: { ruleId: string | null }[] }[])
      .flatMap((file) => file.messages.map((message) => message.ruleId));
    expect(ruleIds, context).toContain('import/order');
  }, LINT_TIMEOUT_MS);
});
