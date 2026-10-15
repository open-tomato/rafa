/**
 * The core-package codemod under `--dry-run` over the live tree, held to
 * the readings the plan of #1090 took by hand at `ec376a8`, each within a
 * stated tolerance, so the move task starts from numbers it has seen. The
 * counts are printed at load.
 *
 * Once the move has run, `core-moves.ts` names `CORE_SOURCE` and the
 * codemod refuses the tree: the case then holds that refusal instead.
 */
import type { CorePackagePlan } from './core-package';

import { fileURLToPath } from 'node:url';

import { describe, expect, it, setDefaultTimeout } from 'bun:test';

import { SWEEP_TIMEOUT } from '../../src/tests/sweep-timeout';
import { CORE_FOLDERS, CORE_SOURCE } from '../survey/core-moves';
import { classifyFile } from '../survey/files';

import { CorePackageError, readCorePackage, reportLines } from './core-package';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TIMEOUT_MS = 120_000;

/** Whether the move has run on this tree. */
const moved = CORE_FOLDERS.includes(CORE_SOURCE);

/** One reading of the plan's Description and how far the codemod's count may stray from it. */
interface Reading {
  readonly name: string;
  /** The count the Description reads. */
  readonly reading: number;
  /** The largest difference the case accepts. */
  readonly tolerance: number;
  readonly count: (plan: CorePackagePlan) => number;
}

function git(args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: REPO_ROOT, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function mentionsIn(plan: CorePackagePlan, keep: (file: string) => boolean): number {
  return plan.mentions.filter((item) => keep(item.file)).reduce((sum, item) => sum + item.count, 0);
}

/**
 * The readings, with the count at the time of writing in each comment.
 * Five per cent is the tolerance of a count over the whole tree, which
 * any task may move by a few; a count of one folder or one list takes a
 * few files either way.
 */
const READINGS: readonly Reading[] = [
  // 2,877 when written.
  { count: (plan) => plan.reach.specifiers, name: 'specifiers into core from outside it', reading: 2802, tolerance: 140 },
  // 1,112 when written.
  { count: (plan) => plan.reach.files, name: 'files holding them', reading: 1116, tolerance: 56 },
  // 43 when written: the two services' imports.
  { count: (plan) => plan.reach.spelled, name: 'specifiers already spelled @open-tomato/rafa/', reading: 43, tolerance: 3 },
  // 116 when written, the cut table's count.
  {
    count: (plan) => [...plan.moves, ...plan.parked].filter((move) => classifyFile(move.from) === 'test').length,
    name: 'test files under core',
    reading: 116,
    tolerance: 3,
  },
  // 31 when written: the Description's 28 held `dispatches.test.ts`, which
  // moves once its re-export import reads the core file, and left out
  // `version.test.ts` and `identity.test.ts`, which read the root's `package.json`.
  { count: (plan) => plan.parked.length, name: 'parked tests', reading: 28, tolerance: 4 },
  // 90 when written.
  {
    count: (plan) => plan.clusterKeys.filter((move) => /^src\/(?:core|effort\/store|ports)\//.test(move.from)).length,
    name: 'cluster-map keys under the three core folders',
    reading: 90,
    tolerance: 3,
  },
  // 126 when written.
  { count: (plan) => mentionsIn(plan, (file) => file.startsWith('context/')), name: 'core paths in context/ pages', reading: 123, tolerance: 6 },
  // 10 when written.
  {
    count: (plan) => mentionsIn(plan, (file) => file === 'src/bundled/skills/dev-planner/SKILL.md'),
    name: 'core paths in the dev-planner skill',
    reading: 10,
    tolerance: 3,
  },
  // 151 when written. The Description's 164 held the twelve re-export
  // files, which step 3 deletes rather than rewrites: the reading is 152.
  {
    count: (plan) => {
      const core = new Set([...plan.moves, ...plan.parked].map((move) => move.from));
      return plan.mentions.filter((item) => !item.file.endsWith('.md') && !core.has(item.file)).length;
    },
    name: 'code files outside core naming a core path, less the re-export files',
    reading: 164 - 12,
    tolerance: 8,
  },
];

const DELETED: readonly string[] = [
  'src/adapters/output/stream.ts',
  'src/adapters/output/text.ts',
  'src/cli/core/types.ts',
  'src/cli/running.ts',
  'src/cli/spends.ts',
  'src/effort/store.ts',
  'src/loop/session-record-parse.ts',
  'src/runtime/identity.ts',
  'src/triage/machine-fault.ts',
  'src/utils/declaration.ts',
  'src/utils/plan-stamp.ts',
  'src/utils/session-env.ts',
];

describe('the core-package codemod under --dry-run over the live tree', () => {
  it.skipIf(!moved)('refuses the tree once the move has run', () => {
    expect(() => readCorePackage(REPO_ROOT)).toThrow(CorePackageError);
  });

  it.skipIf(moved)('reads the lists of the Description within their tolerance, and writes nothing', () => {
    // Arrange
    const status = git(['status', '--porcelain']);

    // Act
    const plan = readCorePackage(REPO_ROOT);

    // Assert
    console.log(reportLines(plan, true).filter((line) => !line.startsWith('  '))
      .join('\n'));
    const readings = READINGS.map((item) => ({ count: item.count(plan), name: item.name, reading: item.reading, tolerance: item.tolerance }));
    console.log(readings.map((item) => `${item.name}: ${item.count} (Description ${item.reading} ± ${item.tolerance})`).join('\n'));
    expect(git(['status', '--porcelain'])).toBe(status);
    expect(plan.refusals).toEqual([]);
    expect(plan.deleted).toEqual(DELETED);
    expect(plan.trimmed).toEqual(['src/utils/tracker.ts']);
    expect(plan.flipped).toEqual(['CORE_FOLDERS', 'CORE_NAMED_FILES']);
    expect(plan.entries).toEqual(['src/effort/store/index.ts', 'src/ports/index.ts']);
    for (const item of readings) {
      expect(Math.abs(item.count - item.reading), `${item.name}: ${item.count}, Description ${item.reading} ± ${item.tolerance}`)
        .toBeLessThanOrEqual(item.tolerance);
    }
  }, TIMEOUT_MS);
});
