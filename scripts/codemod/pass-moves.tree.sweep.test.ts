/**
 * The pass-moves codemod under `--dry-run` over the live tree, with the
 * pass-1 move list (#808), held to the lists the plan read on its base so
 * the move task starts from numbers it has seen. The printed counts go to
 * the log.
 *
 * The plan's Description counts seventeen parked tests: those of the
 * listed files' own stems. Step 1 also moves the five colocated tests
 * whose names open with a listed stem (`record-composition.test.ts`,
 * `config-schema-features-integration.test.ts`,
 * `hop-record.integration.test.ts`, `position.integration.test.ts`,
 * `scope-fallback.test.ts`), and step 2 reads them the same way, so
 * twenty-two park.
 *
 * Once the move has run, every listed `to` exists and the codemod refuses
 * the tree: the case then holds that refusal instead.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, setDefaultTimeout } from 'bun:test';

import { SWEEP_TIMEOUT } from '../../src/tests/sweep-timeout';

import { PASS_1_MOVES } from './moves/pass-1';
import { main } from './pass-moves';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LIST = '--list=scripts/codemod/moves/pass-1.ts';
const TIMEOUT_MS = 120_000;

/** Whether the move has run on this tree. */
const moved = PASS_1_MOVES.every((move) => existsSync(join(REPO_ROOT, move.to)));

/** The parked tests, by path before the move: the Description's seventeen and the five colocated ones. */
const PARKED: readonly string[] = [
  'src/adapters/logger/active.test.ts',
  'src/adapters/logger/console.test.ts',
  'src/adapters/logger/contract.test.ts',
  'src/bugs/record-composition.test.ts',
  'src/bugs/record.test.ts',
  'src/bugs/stack-path.test.ts',
  'src/commands/plan/plan-files.test.ts',
  'src/config-schema-bugs.test.ts',
  'src/config-schema-errors.test.ts',
  'src/config-schema-features-integration.test.ts',
  'src/config-schema-logger.test.ts',
  'src/modules/load.test.ts',
  'src/next/hop-record.integration.test.ts',
  'src/plan/doc-task.test.ts',
  'src/project/package-of.test.ts',
  'src/project/position.integration.test.ts',
  'src/project/scope-fallback.test.ts',
  'src/project/scope.test.ts',
  'src/project/worktree-root.test.ts',
  'src/utils/git.test.ts',
  'src/utils/progress.test.ts',
  'src/utils/tracker.test.ts',
];

/** The files outside the move whose specifiers step 3 rewrites: 279 when written, held within five per cent. */
const IMPORTERS = { reading: 279, tolerance: 14 };

function git(args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: REPO_ROOT, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

/** The items under one printed section, by its title before the count. */
function sectionItems(out: readonly string[], title: string): readonly string[] {
  const start = out.findIndex((line) => line.startsWith(`${title} (`));
  if (start === -1) {
    return [];
  }
  const end = out.findIndex((line, index) => index > start && !line.startsWith('  '));
  return out.slice(start + 1, end === -1
    ? undefined
    : end).map((line) => line.trim());
}

async function dryRun(): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main([LIST, '--dry-run'], REPO_ROOT, { err: (line) => err.push(line), out: (line) => out.push(line) });
  return { code, err, out };
}

describe('the pass-moves codemod under --dry-run over the live tree', () => {
  it.skipIf(!moved)('refuses the tree once the move has run', async () => {
    const result = await dryRun();

    expect(result.code).toBe(2);
    expect(result.out.at(-1)).toBe('dry run, nothing written.');
    expect(sectionItems(result.out, 'refused').length).toBeGreaterThanOrEqual(PASS_1_MOVES.length);
  }, TIMEOUT_MS);

  it.skipIf(moved)('prints 36 moves, the parked list and the importer count, and writes nothing', async () => {
    // Arrange
    const status = git(['status', '--porcelain']);

    // Act
    const result = await dryRun();

    // Assert
    console.log(result.out.filter((line) => !line.startsWith('  ')).join('\n'));
    expect(git(['status', '--porcelain'])).toBe(status);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.out).toContain(`1. moved into the package (${PASS_1_MOVES.length})`);
    expect(sectionItems(result.out, '1. moved into the package')).toEqual(PASS_1_MOVES.map((move) => `${move.from} -> ${move.to}`));
    expect(sectionItems(result.out, '2. parked tests').map((line) => line.split(' -> ')[0])).toEqual([...PARKED]);
    expect(sectionItems(result.out, 'refused')).toEqual([]);
    const importers = /^3\. importers rewritten: \d+ specifier\(s\) in (\d+) file\(s\)/.exec(result.out.find((line) => line.startsWith('3. importers')) ?? '');
    const count = Number(importers?.[1]);
    expect(Math.abs(count - IMPORTERS.reading), `importers: ${count}, read ${IMPORTERS.reading} ± ${IMPORTERS.tolerance}`)
      .toBeLessThanOrEqual(IMPORTERS.tolerance);
    expect(result.out.at(-1)).toBe('dry run, nothing written.');
  }, TIMEOUT_MS);
});
