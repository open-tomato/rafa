/**
 * Tests for the readiness gate around a `plan create` session
 * (`src/commands/plan/review-gate.ts`): which rejections carry a review
 * the gate acts on, what a rejection ends the command with, and what
 * the plan an answer carried is weighed and stamped with.
 *
 * The enforcement itself is `src/board/gate.ts`'s and its own suite
 * drives every verdict; the records are `./plan-record.ts`'s. What is
 * measured here is the wiring between them, which nothing else sees:
 * that a rejection is weighed BEFORE its own message is thrown, that
 * `--skip-review` bypasses that weighing, and that an answer is weighed
 * over the paths the PLANNER named rather than the ones this command
 * spelled before the session ran.
 *
 * Every case plants a project root of its own and drives a planter that
 * answers or rejects as the case names, so nothing spawns a session.
 * The gate's own issue is null throughout: a board write is
 * `src/board/gate.test.ts`'s subject, and a route with no issue reaches
 * every standing this module has to tell apart.
 *
 * ## What would pass while wrong
 *
 * The gate reads the plan off a path, and both paths name a plan in the
 * ordinary run: the base this command spelled and the one the planner
 * answered with are the same file. So the case that separates them
 * plants the plan ONLY where the planner says it is and leaves the
 * base pointing at a name with no file behind it. Weighing the base
 * would find no plan and refuse with exit 3; weighing the planner's own
 * finds the plan, answers `unread` and records `review: missing`.
 *
 * Measured on 2026-09-21, the module restored from a scratch copy and
 * verified with `shasum -c`: the planner's two paths dropped from what
 * {@link settleReview} hands the gate left 12 pass and 1 fail against
 * 13 pass either side, and the case that reddened was that one.
 */
import type { GateBase } from './review-gate.js';
import type { GeneratedPlan, Planner } from '../../ports/index.js';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../../adapters/output/active.js';
import { ClaudePlannerError } from '../../adapters/planner/claude.js';
import { SPEC_NOT_READY_EXIT } from '../../board/gate.js';
import { REVIEW_MISSING_LINE, REVIEW_SKIPPED_LINE } from '../../board/review-stamp.js';
import { parseSpecReview } from '../../board/spec-review.js';
import { CommandExit } from '../../cli/command.js';
import { sinkOutput } from '../../tests/output-sinks.js';

import { generateOrExit, rejectedReview, settleReview } from './review-gate.js';

/** A scratch directory of this file's own. */
const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-review-gate-'));

/** Where a planted plan sits under a project root, as the command spells it. */
const PLAN_PATH = join('.rafa', 'plans', 'PLAN-rafa-63.md');

/** The prerequisites file beside it, written by no case here. */
const PREREQUISITES_PATH = join('.rafa', 'plans', 'PREREQUISITES-rafa-63.md');

/** The ordinary plan a session writes, which `plan validate`'s reader reads as written. */
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

/** A session output carrying a verdict that judged the spec not ready. */
const NOT_READY_OUTPUT = [
  'I read the spec first.',
  '',
  '```rafa:spec-review',
  'verdict: not-ready',
  'gaps:',
  '  - heading: "Definition of done"',
  '    what: "no item says how the merge clean-up is verified"',
  '```',
  '',
].join('\n');

/** The verdict that judged the spec not ready, as the planner carries it back. */
const NOT_READY = parseSpecReview(NOT_READY_OUTPUT);

/** A session that answered without a review block of any kind. */
const ABSENT = parseSpecReview('I wrote the plan and stopped.');

/** A session that judged the spec ready. */
const READY = parseSpecReview('```rafa:spec-review\nverdict: ready\n```\n');

let planted = 0;

/** What one case read off the active output. */
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

/** The gate as `plan create` builds it before the session runs. */
function gateOf(repoRoot: string, planPath: string = PLAN_PATH): GateBase {
  return {
    source: 'issue #63',
    repoRoot,
    planPath,
    prerequisitesPath: PREREQUISITES_PATH,
    issue: null,
    comment: true,
  };
}

/** A planner that answers `plan`, recording the requests it was handed. */
function answering(plan: GeneratedPlan): { planner: Planner; asked: () => number } {
  let asked = 0;
  const planner: Planner = {
    create: () => {
      asked += 1;
      return Promise.resolve(plan);
    },
  };
  return { planner, asked: () => asked };
}

/** A planner that rejects with `error`. */
function rejecting(error: unknown): Planner {
  return { create: () => Promise.reject(error) };
}

/** What a thrown `CommandExit` carried. */
async function refusal(run: () => Promise<unknown>): Promise<CommandExit> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a CommandExit, and the call answered instead');
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

describe('the review a rejection carries', () => {
  it('answers the reading of a session that judged the spec not ready', () => {
    const error = new ClaudePlannerError('the plan was not created.', 1, NOT_READY);

    expect(rejectedReview(error)).toBe(NOT_READY);
  });

  it('answers undefined for a session whose review could not be read', () => {
    const error = new ClaudePlannerError('Plan generation failed (exit 7).', 7, ABSENT);

    expect(rejectedReview(error)).toBeUndefined();
  });

  it('answers undefined for a rejection that carried no review, and for any other error', () => {
    const noReview = new ClaudePlannerError('the planner refused before any session ran.', 1);

    expect(rejectedReview(noReview)).toBeUndefined();
    expect(rejectedReview(new Error('the planner is unreachable'))).toBeUndefined();
  });
});

describe('generateOrExit', () => {
  it('answers the plan the planner generated, asking it once', async () => {
    const generated: GeneratedPlan = { planPath: PLAN_PATH, prerequisitesPath: null, review: READY };
    const { planner, asked } = answering(generated);

    const answer = await generateOrExit(planner, { specPath: 'spec.md', stub: 'rafa-63' }, gateOf(plant()), false);

    expect(answer).toBe(generated);
    expect(asked()).toBe(1);
  });

  it('throws the rejection message at exit code 1 for an error the planner did not shape', async () => {
    const thrown = await refusal(() => generateOrExit(
      rejecting(new Error('the planner is unreachable')),
      { specPath: 'spec.md', stub: 'rafa-63' },
      gateOf(plant()),
      false,
    ));

    expect(thrown.exitCode).toBe(1);
    expect(thrown.message).toBe('\n❌ the planner is unreachable');
  });

  it('keeps a failed session own exit code, since its unread review is no verdict', async () => {
    const thrown = await refusal(() => generateOrExit(
      rejecting(new ClaudePlannerError('Plan generation failed (exit 7).', 7, ABSENT)),
      { specPath: 'spec.md', stub: 'rafa-63' },
      gateOf(plant()),
      false,
    ));

    expect(thrown.exitCode).toBe(7);
    expect(thrown.message).toBe('\n❌ Plan generation failed (exit 7).');
  });

  it('ends with the gate on a rejection whose review judged the spec not ready', async () => {
    const thrown = await refusal(() => generateOrExit(
      rejecting(new ClaudePlannerError('the plan was not created.', 1, NOT_READY)),
      { specPath: 'spec.md', stub: 'rafa-63' },
      gateOf(plant()),
      false,
    ));

    expect(thrown.exitCode).toBe(SPEC_NOT_READY_EXIT);
    expect(thrown.message).toContain('Definition of done');
  });

  it('bypasses that gate under --skip-review, ending with the rejection own message', async () => {
    const thrown = await refusal(() => generateOrExit(
      rejecting(new ClaudePlannerError('the plan was not created.', 1, NOT_READY)),
      { specPath: 'spec.md', stub: 'rafa-63' },
      gateOf(plant()),
      true,
    ));

    expect(thrown.exitCode).toBe(1);
    expect(thrown.message).toBe('\n❌ the plan was not created.');
  });
});

describe('settleReview', () => {
  it('records review: skipped and runs no gate under --skip-review', async () => {
    const repoRoot = plant();
    const generated: GeneratedPlan = { planPath: PLAN_PATH, prerequisitesPath: null, review: NOT_READY };

    await settleReview(gateOf(repoRoot), generated, true);

    expect(planAt(repoRoot)).toContain(REVIEW_SKIPPED_LINE);
    expect(lines.warn).toEqual([]);
  });

  it('records review: missing on a plan an unread review left standing', async () => {
    const repoRoot = plant();
    const generated: GeneratedPlan = { planPath: PLAN_PATH, prerequisitesPath: null, review: ABSENT };

    await settleReview(gateOf(repoRoot), generated, false);

    expect(planAt(repoRoot)).toContain(REVIEW_MISSING_LINE);
    expect(lines.warn).toHaveLength(1);
  });

  it('weighs the plan the planner named, not the one the command spelled', async () => {
    const repoRoot = plant();
    const base = gateOf(repoRoot, join('.rafa', 'plans', 'PLAN-never-written.md'));
    const generated: GeneratedPlan = { planPath: PLAN_PATH, prerequisitesPath: null, review: ABSENT };

    await settleReview(base, generated, false);

    expect(planAt(repoRoot)).toContain(REVIEW_MISSING_LINE);
  });

  it('records nothing on a verdict that judged the spec ready', async () => {
    const repoRoot = plant();
    const generated: GeneratedPlan = { planPath: PLAN_PATH, prerequisitesPath: null, review: READY };

    await settleReview(gateOf(repoRoot), generated, false);

    expect(planAt(repoRoot)).toBe(PLAN);
    expect(lines.info).toEqual([]);
    expect(lines.warn).toEqual([]);
  });

  it('refuses at exit 3 when the verdict judged the spec not ready', async () => {
    const repoRoot = plant();
    const generated: GeneratedPlan = { planPath: PLAN_PATH, prerequisitesPath: null, review: NOT_READY };

    const thrown = await refusal(() => settleReview(gateOf(repoRoot), generated, false));

    expect(thrown.exitCode).toBe(SPEC_NOT_READY_EXIT);
    expect(thrown.message).toContain('Definition of done');
  });
});
