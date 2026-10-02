import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'bun:test';

import { LIVE_PARITY_ENV, LIVE_PARITY_OFF_REASON } from './parity-fixture.js';

const STAGE_TEST_FILES = [
  './src/tests/parity-lineage.test.ts',
  './src/tests/parity-differential.test.ts',
  './src/plan/parse.test.ts',
  './src/effort/store/migrations.test.ts',
];

const NESTED_RUN_TIMEOUT_MS = 120_000;

test(
  'the stage\'s four test files run with zero failures and the parity skip reason when RAFA_LIVE_PARITY is unset',
  async () => {
    // Arrange: a junit report names every skipped case, which the plain
    // reporter does not print under an agent session.
    const scratch = await mkdtemp(join(tmpdir(), 'rafa-stage-green-'));
    const reportPath = join(scratch, 'junit.xml');
    const inheritedEnv = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name !== LIVE_PARITY_ENV),
    );
    try {
      // Act
      const child = Bun.spawn(
        [process.execPath, 'test', ...STAGE_TEST_FILES, '--reporter=junit', `--reporter-outfile=${reportPath}`],
        { env: inheritedEnv, stdout: 'pipe', stderr: 'pipe' },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      const report = await readFile(reportPath, 'utf8');

      // Assert
      expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
      const failures = [...report.matchAll(/\bfailures="(\d+)"/g)].map((m) => Number(m[1]));
      expect(failures.length).toBeGreaterThan(0);
      expect(failures.every((count) => count === 0)).toBe(true);
      expect(report).toContain(LIVE_PARITY_OFF_REASON.split(' to run')[0]);
      expect(report).toContain('<skipped');
      expect(`${stdout}\n${stderr}`).toContain(' 0 fail');
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  NESTED_RUN_TIMEOUT_MS,
);
