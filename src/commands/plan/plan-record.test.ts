/**
 * Tests for the lines `plan create` records in the plan its session
 * wrote (`src/commands/plan/plan-record.ts`): the three records, the
 * sentence each prints, and the warning a plan that cannot take one
 * gets instead.
 *
 * The stamps themselves are `src/board/plan-field.ts`'s and
 * `src/board/review-stamp.ts`'s, and their own suites drive every shape
 * of `rafa:plan` block there is. What is measured here is the half this
 * module owns: that the file is read and written at the path resolved
 * under the project root, that each record answers with the sentence an
 * operator reads, and that a record which cannot be written warns and
 * refuses nothing.
 *
 * Every case writes under a scratch directory of its own and reads the
 * lines off a sink set with `setActiveOutput`, which is module state, so
 * each case sets `null` after it.
 *
 * ## The case that would pass while wrong
 *
 * A plan already carrying the line is stamped `unchanged`, and this
 * module must not write it back. Nothing on disk could tell a
 * re-written file from an untouched one, since the bytes are equal, so
 * that case makes the file READ-ONLY and holds the record to a clean
 * info line: a write attempted at all would fail and warn instead. Its
 * control is the case beside it, a read-only plan that does NOT yet
 * carry the line, which warns with `EACCES` — so the permission bits
 * are proven to bite.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../../adapters/output/active.js';
import { SKIP_REVIEW_FLAG } from '../../board/gate.js';
import { issueFieldLine } from '../../board/plan-field.js';
import { REVIEW_MISSING_LINE, REVIEW_SKIPPED_LINE } from '../../board/review-stamp.js';
import { sinkOutput } from '../../tests/output-sinks.js';

import { recordMissingReview, recordPlanIssue, recordSkippedReview } from './plan-record.js';

/** A scratch directory of this file's own. */
const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-plan-record-'));

/** Where a planted plan sits under a project root, as the command spells it. */
const PLAN_PATH = join('.rafa', 'plans', 'PLAN-rafa-63.md');

/** The ordinary plan a session writes: a title, the header block, a task. */
const PLAN = [
  '# Plan: rafa-63',
  '',
  '```rafa:plan',
  'stub: rafa-63',
  '```',
  '',
  '- [ ] Do the thing',
  '',
].join('\n');

let planted = 0;

/** What one case reads: the lines of each level, in the order they were written. */
interface Lines {
  readonly info: string[];
  readonly warn: string[];
}

const lines: Lines = { info: [], warn: [] };

/** Plants a project root holding `plan` at {@link PLAN_PATH}, or nothing when it is null. */
function plant(plan: string | null = PLAN): string {
  planted += 1;
  const repoRoot = join(tempRoot, `run-${String(planted)}`);
  mkdirSync(join(repoRoot, '.rafa', 'plans'), { recursive: true });
  if (plan !== null) writeFileSync(join(repoRoot, PLAN_PATH), plan, 'utf8');

  lines.info.length = 0;
  lines.warn.length = 0;
  setActiveOutput(sinkOutput({
    info: (message) => lines.info.push(message),
    warn: (message) => lines.warn.push(message),
  }));
  return repoRoot;
}

/** The plan at {@link PLAN_PATH} under `repoRoot`, as it now stands. */
function planAt(repoRoot: string): string {
  return readFileSync(join(repoRoot, PLAN_PATH), 'utf8');
}

afterEach(() => {
  setActiveOutput(null);
});

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('recordPlanIssue', () => {
  it('records the issue the route planned from, quoted, and says so', () => {
    const repoRoot = plant();

    recordPlanIssue(repoRoot, PLAN_PATH, 63);

    expect(planAt(repoRoot)).toContain('issue: "63"');
    expect(lines.info).toEqual([`🔖 ${PLAN_PATH} records ${issueFieldLine(63)}, the issue it was planned from.`]);
    expect(lines.warn).toEqual([]);
  });

  it('warns and leaves the file alone when the plan holds no rafa:plan block', () => {
    const blockless = '# Plan: rafa-63\n\n- [ ] Do the thing\n';
    const repoRoot = plant(blockless);

    recordPlanIssue(repoRoot, PLAN_PATH, 63);

    expect(planAt(repoRoot)).toBe(blockless);
    expect(lines.info).toEqual([]);
    expect(lines.warn).toHaveLength(1);
    expect(lines.warn[0]).toStartWith(`${PLAN_PATH} does not record ${issueFieldLine(63)}: `);
  });

  it('warns naming the read failure when there is no plan to stamp', () => {
    const repoRoot = plant(null);

    recordPlanIssue(repoRoot, PLAN_PATH, 63);

    expect(lines.info).toEqual([]);
    expect(lines.warn).toHaveLength(1);
    expect(lines.warn[0]).toContain('ENOENT');
  });
});

describe('recordSkippedReview', () => {
  it('records review: skipped in the plan --skip-review kept, and names the flag', () => {
    const repoRoot = plant();

    recordSkippedReview(repoRoot, PLAN_PATH);

    expect(planAt(repoRoot)).toContain(REVIEW_SKIPPED_LINE);
    expect(lines.info).toEqual([
      `⏭  ${SKIP_REVIEW_FLAG}: the spec was not reviewed, and ${PLAN_PATH} records ${REVIEW_SKIPPED_LINE}.`,
    ]);
    expect(lines.warn).toEqual([]);
  });

  it('writes nothing back over a plan that already records the line', () => {
    const recorded = PLAN.replace('stub: rafa-63', `stub: rafa-63\n${REVIEW_SKIPPED_LINE}`);
    const repoRoot = plant(recorded);
    chmodSync(join(repoRoot, PLAN_PATH), 0o444);

    recordSkippedReview(repoRoot, PLAN_PATH);

    expect(planAt(repoRoot)).toBe(recorded);
    expect(lines.warn).toEqual([]);
    expect(lines.info).toHaveLength(1);
  });

  it('warns when the plan cannot be written, which is the control for the case above', () => {
    const repoRoot = plant();
    chmodSync(join(repoRoot, PLAN_PATH), 0o444);

    recordSkippedReview(repoRoot, PLAN_PATH);

    expect(planAt(repoRoot)).toBe(PLAN);
    expect(lines.info).toEqual([]);
    expect(lines.warn).toHaveLength(1);
    expect(lines.warn[0]).toContain('EACCES');
  });
});

describe('recordMissingReview', () => {
  it('records review: missing and says what the session returned', () => {
    const repoRoot = plant();

    recordMissingReview(repoRoot, PLAN_PATH);

    expect(planAt(repoRoot)).toContain(REVIEW_MISSING_LINE);
    expect(lines.info).toEqual([
      `🔍 ${PLAN_PATH} records ${REVIEW_MISSING_LINE}: the session returned no readable rafa:spec-review block.`,
    ]);
    expect(lines.warn).toEqual([]);
  });
});
