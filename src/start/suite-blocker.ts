/**
 * What a red suite step writes on the tracker (`suite-step.ts`): the
 * blocker text and the write itself.
 *
 * {@link blockerText} names each new failing test file with its count,
 * the command running them (`bun test <files>`), and the errors or the
 * missing summary when those made the step red. {@link blockNextOpenTask}
 * writes that text on the next open task, the line `findNextTask`
 * answers after the commit (`utils/tracker.ts`), through
 * `writeTrackerBlocker`, which marks it `[BLOCKED]`; with no open task
 * left it writes nothing and answers null.
 */
import type { SuiteFailure, SuiteResult } from '../suite/run.js';

import { readFileSync } from 'node:fs';

import { findNextTask, writeTrackerBlocker } from '../utils/tracker.js';

/** A step's failures split against the baseline, and what else can make it red. */
export interface StepVerdict {
  readonly fresh: readonly SuiteFailure[];
  readonly known: readonly SuiteFailure[];
  readonly newErrors: number;
  /** True when Bun exited nonzero and printed no summary. */
  readonly unreported: boolean;
}

/** Each file among `failures` and how many of its tests failed, in first-seen order. */
function failingFiles(failures: readonly SuiteFailure[]): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>();
  for (const failure of failures) counts.set(failure.file, (counts.get(failure.file) ?? 0) + 1);
  return [...counts.entries()];
}

/**
 * The blocker a red step writes: the new failing files with their
 * counts and the command running them, then the errors or the missing
 * summary when those made it red. `label` names the step.
 */
export function blockerText(label: string, result: Pick<SuiteResult, 'exitCode'>, verdict: StepVerdict): string {
  const files = failingFiles(verdict.fresh);
  const parts = [`The runner's ${label} found failures the suite baseline does not hold.`];
  if (files.length > 0) {
    const named = files.map(([file, count]) => `${file} (${count} ${count === 1
      ? 'test'
      : 'tests'})`);
    parts.push(`New failing test files: ${named.join(', ')}. Run bun test ${files.map(([file]) => file).join(' ')} and make them pass.`);
  }
  if (verdict.newErrors > 0) {
    parts.push(`${verdict.newErrors} more error(s) outside any test than the baseline: a test file that throws while it loads, which the JUnit report names no file for.`);
  }
  if (verdict.unreported) parts.push(`bun test exited ${result.exitCode} and printed no summary line.`);
  return parts.join(' ');
}

/** Writes `text` on the next open task, answering its line, or null when none is left. */
export function blockNextOpenTask(trackerPath: string, text: string): number | null {
  const next = findNextTask(readFileSync(trackerPath, 'utf8'));
  if (next === null) return null;
  return writeTrackerBlocker(trackerPath, next.lineNum, text)
    ? next.lineNum
    : null;
}
