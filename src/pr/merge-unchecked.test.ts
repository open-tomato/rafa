/**
 * Composes `readMergeRefusal` (`./merge.ts`) with `readUnchecked`
 * (`./unchecked.ts`) — the two modules `rafa pr merge --skip-checks`
 * reads from before it ever asks anything.
 *
 * Each module is tested alone elsewhere; what neither of those files
 * can hold is the seam between them. `readMergeRefusal` decides whether
 * `--skip-checks` reaches the unchecked question AT ALL (verdict `none`
 * alone; every other verdict refuses first, and `readUnchecked` is never
 * consulted). `readUnchecked` then decides, for a reading that DID reach
 * the question, whether `--yes` may answer it. A regression that let a
 * `red` or `pending` PR through, or one that let `--yes` answer the
 * workflows-exist case, would still pass both modules' own suites in
 * isolation — each would just be handed an input the composed command
 * would never produce — so this file drives the full grid the command
 * actually walks: all four verdicts against zero workflows, one or more
 * workflows, and an unreadable count.
 */
import type { MergeRefusalReading } from './merge.js';

import { describe, expect, test } from 'bun:test';

import { parseWorkingTree, readMergeRefusal } from './merge.js';
import { readUnchecked } from './unchecked.js';

/** A reading that passes every refusal but the checks verdict itself. */
const BASE: MergeRefusalReading = {
  number: 86,
  branch: 'feat/ci-gate',
  base: 'main',
  tree: parseWorkingTree(''),
  merge: { mergeable: 'mergeable', status: 'CLEAN' },
  checks: 'none',
  rows: [],
  skipChecks: true,
  worktrees: [],
  at: '/private/tmp/mergeprobe/main',
};

const VERDICTS = ['none', 'pending', 'red', 'green'] as const;

/** Zero workflows, one or more, and a count that could not be read. */
const WORKFLOW_COUNTS = [0, 3, null] as const;

/**
 * Whether `readMergeRefusal` lets a `--skip-checks` merge of this
 * verdict reach the unchecked question at all: `none` alone.
 */
function reachesQuestion(verdict: (typeof VERDICTS)[number]): boolean {
  return readMergeRefusal({ ...BASE, checks: verdict }) === null;
}

describe('readMergeRefusal composed with readUnchecked', () => {
  for (const verdict of VERDICTS) {
    for (const workflowCount of WORKFLOW_COUNTS) {
      const reached = reachesQuestion(verdict);
      const label = `verdict ${verdict}, ${workflowCount === null
        ? 'an unreadable'
        : workflowCount} workflow count`;

      test(`${label}: reaches the question only for verdict none`, () => {
        expect(reached).toBe(verdict === 'none');
      });

      if (!reached) continue;

      test(`${label}: --yes may answer only when the count read zero`, () => {
        const unchecked = readUnchecked(BASE.number, workflowCount);
        expect(unchecked.yesMayAnswer).toBe(workflowCount === 0);
      });
    }
  }

  test('a red or pending PR never reaches readUnchecked', () => {
    // The workflow count plays no part in the refusal itself — a red or
    // pending verdict is refused before `readUnchecked` is ever called,
    // which is the point of the grid above.
    expect(readMergeRefusal({ ...BASE, checks: 'red' })).not.toBeNull();
    expect(readMergeRefusal({ ...BASE, checks: 'pending' })).not.toBeNull();
  });

  test('a green PR is refused by skipChecks even though it would merge without the flag', () => {
    expect(readMergeRefusal({ ...BASE, checks: 'green' })?.reason).toBe('skip-checks-refused');
    expect(readMergeRefusal({ ...BASE, checks: 'green', skipChecks: false })).toBeNull();
  });

  test('the no-workflow and workflows-exist readings never share a yesMayAnswer', () => {
    expect(reachesQuestion('none')).toBe(true);
    const noWorkflow = readUnchecked(BASE.number, 0);
    const workflowsExist = readUnchecked(BASE.number, 3);
    const unreadable = readUnchecked(BASE.number, null);
    expect(noWorkflow.yesMayAnswer).toBe(true);
    expect(workflowsExist.yesMayAnswer).toBe(false);
    expect(unreadable.yesMayAnswer).toBe(false);
  });
});
