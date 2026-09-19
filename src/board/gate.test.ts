/**
 * Tests for the readiness gate's enforcing half (`src/board/gate.ts`):
 * the two flags read off a command line, the files a not-ready verdict
 * removes, what it publishes on the issue, and the exit code and message
 * it refuses with.
 *
 * Each case builds its review through `parseSpecReview` over a literal
 * block rather than by hand, so the readings driven here are the ones a
 * session's output actually answers: a reading assembled in the test
 * could pass a `ready` false the parser never produces. The board is a
 * fake recording its calls, and the files sit in this file's own
 * temporary directory, so no case reaches GitHub, spawns `gh` or writes
 * outside `tmpdir`.
 *
 * A gate is the shape of module that passes while wrong most easily,
 * because every case that asserts a refusal is also satisfied by one
 * that refuses EVERYTHING. So the refusal cases sit beside the two
 * readings that must be let through — a ready verdict, and the absent
 * review of a planner that judged nothing — over the same files and the
 * same board, and those two assert that no file was removed and no
 * command sent.
 *
 * Five mutations of `gate.ts` were driven on 2026-09-19, one at a time
 * over `env -u CLAUDECODE bun test src/board/ src/plan.test.ts`, the
 * module restored from a scratch copy and verified with `shasum -c`
 * after each. 197 pass either side, and each count is that run's own:
 *
 *  - the removal skipped, the mutation this module exists to prevent:
 *    5 fail, the four cases here that assert a file is gone — both
 *    files, the plan alone, the spec off a file and the active-output
 *    one — and the `not-ready` case in `src/plan.test.ts`.
 *  - the two labels swapped the other way round: 1 fail, the case that
 *    asserts the call.
 *  - `SPEC_NOT_READY_EXIT` at 2: 2 fail, both `src/plan.test.ts` cases
 *    that spell 3 as a literal. No case here saw it, because each
 *    asserts against the constant — which is why the command's own
 *    cases spell the number.
 *  - `--no-comment` ignored, so the gaps are posted anyway: 1 fail, the
 *    `--no-comment` case.
 *  - a ready verdict enforced along with the rest: 1 fail, the ready
 *    case.
 */
import type { IssueBoard } from './issue-board.js';
import type { SpecReviewReading } from './spec-review.js';

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { sinkOutput } from '../tests/output-sinks.js';

import {
  enforceSpecReview,
  NO_COMMENT_FLAG,
  readGateFlags,
  SKIP_REVIEW_FLAG,
  SPEC_NEEDS_WORK_LABEL,
  SPEC_NOT_READY_EXIT,
} from './gate.js';
import { SPEC_READY_LABEL } from './readiness.js';
import { SPEC_REVIEW_MARKER } from './review-comment.js';
import { parseSpecReview } from './spec-review.js';

/** The plan path every case names, as a planner names one. */
const PLAN_PATH = '.rafa/plans/PLAN-rafa-20.md';

/** The prerequisites path beside it. */
const PREREQUISITES_PATH = '.rafa/plans/PREREQUISITES-rafa-20.md';

/** What the refusal calls the spec in the cases that have no issue. */
const SOURCE = '.specs/rafa-20.md';

/** A session output holding a `rafa:spec-review` block of `lines`. */
function reviewOf(...lines: readonly string[]): SpecReviewReading {
  return parseSpecReview(['I read the spec first.', '', '```rafa:spec-review', ...lines, '```', ''].join('\n'));
}

/** A verdict naming two gaps. */
const NOT_READY = reviewOf(
  'verdict: not-ready',
  'gaps:',
  '  - heading: "Definition of done"',
  '    what: "no item says how the merge clean-up is verified"',
  '  - heading: "Tasks the plan must carry"',
  '    what: "the third task does not name what it changes"',
);

/** A verdict that lets the plan stand. */
const READY = reviewOf('verdict: ready');

/** The lines an enforcement wrote, by level. */
interface Lines {
  readonly info: string[];
  readonly warn: string[];
}

/** An Output keeping the lines it is handed. */
function capture(): { lines: Lines; output: ReturnType<typeof sinkOutput> } {
  const lines: Lines = { info: [], warn: [] };
  return {
    lines,
    output: sinkOutput({
      info: (message) => {
        lines.info.push(message);
      },
      warn: (message) => {
        lines.warn.push(message);
      },
    }),
  };
}

/** One call the fake board took, as `member(args)`. */
type BoardCall = readonly [string, ...unknown[]];

/** What a fake board does when it is asked to write. */
interface BoardFaults {
  readonly comment?: string;
  readonly labels?: string;
}

/** A board recording its calls, failing where `faults` says so. */
function fakeBoard(marker: boolean, faults: BoardFaults = {}): { board: IssueBoard; calls: BoardCall[] } {
  const calls: BoardCall[] = [];
  const board: IssueBoard = {
    comments: (issue) => {
      calls.push(['comments', issue]);
      return Promise.resolve(marker
        ? [{ id: '42', body: `${SPEC_REVIEW_MARKER}\nolder gaps`, author: 'rafa-bot' }]
        : []);
    },
    comment: (issue, body) => {
      calls.push(['comment', issue, body]);
      return faults.comment === undefined
        ? Promise.resolve({ id: '99', body, author: 'rafa-bot' })
        : Promise.reject(new Error(faults.comment));
    },
    editComment: (id, body) => {
      calls.push(['editComment', id, body]);
      return Promise.resolve({ id, body, author: 'rafa-bot' });
    },
    swapLabels: (issue, removed, added) => {
      calls.push(['swapLabels', issue, removed, added]);
      return faults.labels === undefined
        ? Promise.resolve()
        : Promise.reject(new Error(faults.labels));
    },
  };
  return { board, calls };
}

let tempDir = '';
let planted = 0;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-board-gate-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
  setActiveOutput(null);
});

/** A repository root holding the plan and, when asked, the prerequisites file. */
function plantRepo(files: readonly string[] = [PLAN_PATH, PREREQUISITES_PATH]): string {
  planted += 1;
  const root = join(tempDir, `run-${String(planted)}`);
  mkdirSync(join(root, '.rafa', 'plans'), { recursive: true });
  for (const file of files) writeFileSync(join(root, file), 'written anyway\n', 'utf8');
  return root;
}

/** The `CommandExit` a run refused with; fails the case when it let the review through. */
async function refusalOf(run: Promise<void>): Promise<CommandExit> {
  try {
    await run;
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('the gate let the review through, where this case expects a refusal');
}

describe('readGateFlags', () => {
  it('reads neither flag off a line that names neither', () => {
    expect(readGateFlags(['--spec=x.md', '--no-progress'])).toEqual({ skipReview: false, comment: true });
  });

  it('reads both, and neither off a word that only starts like one', () => {
    expect(readGateFlags(['--spec=x.md', SKIP_REVIEW_FLAG, NO_COMMENT_FLAG]))
      .toEqual({ skipReview: true, comment: false });
    expect(readGateFlags(['--skip-reviewer', '--no-comments'])).toEqual({ skipReview: false, comment: true });
  });
});

describe('enforceSpecReview lets through', () => {
  it('a ready verdict, removing no file and sending no command', async () => {
    const root = plantRepo();
    const { board, calls } = fakeBoard(false);
    const { lines, output } = capture();

    await enforceSpecReview({
      review: READY,
      source: 'issue #20',
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board },
      comment: true,
      output,
    });

    expect(existsSync(join(root, PLAN_PATH))).toBe(true);
    expect(calls).toEqual([]);
    expect(lines).toEqual({ info: [], warn: [] });
  });

  it('a planner that judged nothing, which is what an optional review means', async () => {
    const root = plantRepo();
    const { board, calls } = fakeBoard(false);

    await enforceSpecReview({
      review: undefined,
      source: 'issue #20',
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board },
      comment: true,
      output: capture().output,
    });

    expect(existsSync(join(root, PLAN_PATH))).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('enforceSpecReview on a not-ready verdict', () => {
  it('removes both files, posts the gaps, swaps the labels and exits 3', async () => {
    const root = plantRepo();
    const { board, calls } = fakeBoard(false);
    const { lines, output } = capture();

    const refusal = await refusalOf(enforceSpecReview({
      review: NOT_READY,
      source: 'issue #20',
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board },
      comment: true,
      output,
    }));

    expect(existsSync(join(root, PLAN_PATH))).toBe(false);
    expect(existsSync(join(root, PREREQUISITES_PATH))).toBe(false);
    expect(calls.map((call) => call[0])).toEqual(['comments', 'comment', 'swapLabels']);
    expect(calls[2]).toEqual(['swapLabels', 20, SPEC_READY_LABEL, SPEC_NEEDS_WORK_LABEL]);
    expect(String(calls[1]?.[2])).toContain('no item says how the merge clean-up is verified');
    expect(refusal.exitCode).toBe(SPEC_NOT_READY_EXIT);
    expect(refusal.message).toContain('issue #20 is not ready to plan from');
    expect(refusal.message).toContain('"Definition of done": no item says how the merge clean-up is verified');
    expect(refusal.message).toContain('"Tasks the plan must carry": the third task does not name what it changes');
    expect(refusal.message).toContain(`label the issue ${SPEC_READY_LABEL} again`);
    expect(lines.info).toEqual([
      `🗑  Removed ${PLAN_PATH}: the planner judged the spec not ready, so no plan stands.`,
      `🗑  Removed ${PREREQUISITES_PATH}: the planner judged the spec not ready, so no plan stands.`,
      '💬 Posted the review comment on issue #20.',
      `🏷  Swapped ${SPEC_READY_LABEL} for ${SPEC_NEEDS_WORK_LABEL} on issue #20.`,
    ]);
    expect(lines.warn).toEqual([]);
  });

  it('edits the marker comment a rerun finds, rather than posting beside it', async () => {
    const { board, calls } = fakeBoard(true);
    const { lines, output } = capture();

    await refusalOf(enforceSpecReview({
      review: NOT_READY,
      source: 'issue #20',
      repoRoot: plantRepo([]),
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board },
      comment: true,
      output,
    }));

    expect(calls.map((call) => call[0])).toEqual(['comments', 'editComment', 'swapLabels']);
    expect(calls[1]?.[1]).toBe('42');
    expect(lines.info).toContain('💬 Edited the review comment on issue #20.');
  });

  it('removes what the session wrote even when it wrote only the plan', async () => {
    const root = plantRepo([PLAN_PATH]);
    const { lines, output } = capture();

    await refusalOf(enforceSpecReview({
      review: NOT_READY,
      source: 'issue #20',
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board: fakeBoard(false).board },
      comment: true,
      output,
    }));

    expect(existsSync(join(root, PLAN_PATH))).toBe(false);
    expect(lines.info.filter((line) => line.startsWith('🗑'))).toHaveLength(1);
  });

  it('writes no comment under --no-comment, and still swaps the labels', async () => {
    const { board, calls } = fakeBoard(false);
    const { lines, output } = capture();

    const refusal = await refusalOf(enforceSpecReview({
      review: NOT_READY,
      source: 'issue #20',
      repoRoot: plantRepo([]),
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board },
      comment: false,
      output,
    }));

    expect(calls.map((call) => call[0])).toEqual(['swapLabels']);
    expect(lines.info).toContain(`💬 ${NO_COMMENT_FLAG}: the gaps were not posted on issue #20.`);
    expect(refusal.message).toContain('"Definition of done"');
  });

  it('sends no command for a spec off a file, which has no issue and no labels to move', async () => {
    const root = plantRepo();
    const { lines, output } = capture();

    const refusal = await refusalOf(enforceSpecReview({
      review: NOT_READY,
      source: SOURCE,
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: null,
      comment: true,
      output,
    }));

    expect(existsSync(join(root, PLAN_PATH))).toBe(false);
    expect(lines.info.filter((line) => !line.startsWith('🗑'))).toEqual([]);
    expect(refusal.message).toContain(`❌ ${SOURCE} is not ready to plan from`);
    expect(refusal.message).toContain('Close the gaps in the spec, then plan from it again.');
    expect(refusal.message).not.toContain(SPEC_READY_LABEL);
  });

  it('refuses an absent review with the gap the parser names, since nobody judged the spec', async () => {
    const absent = parseSpecReview('I wrote the plan.\n');
    const { lines, output } = capture();

    const refusal = await refusalOf(enforceSpecReview({
      review: absent,
      source: 'issue #20',
      repoRoot: plantRepo([]),
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: null,
      comment: true,
      output,
    }));

    expect(absent.answer).toBe('absent');
    expect(refusal.exitCode).toBe(SPEC_NOT_READY_EXIT);
    expect(refusal.message).toContain('the review block was not returned');
    expect(lines.warn).toEqual([]);
  });
});

describe('enforceSpecReview when a board write fails', () => {
  it('warns about the comment, swaps the labels anyway and keeps exit 3', async () => {
    const { board, calls } = fakeBoard(false, { comment: 'gh: 403 Forbidden' });
    const { lines, output } = capture();

    const refusal = await refusalOf(enforceSpecReview({
      review: NOT_READY,
      source: 'issue #20',
      repoRoot: plantRepo([]),
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board },
      comment: true,
      output,
    }));

    expect(calls.map((call) => call[0])).toEqual(['comments', 'comment', 'swapLabels']);
    expect(lines.warn).toEqual(['the review comment on issue #20 was not written: gh: 403 Forbidden']);
    expect(refusal.exitCode).toBe(SPEC_NOT_READY_EXIT);
  });

  it('warns about the labels and keeps exit 3', async () => {
    const { board } = fakeBoard(false, { labels: 'gh: could not add label' });
    const { lines, output } = capture();

    const refusal = await refusalOf(enforceSpecReview({
      review: NOT_READY,
      source: 'issue #20',
      repoRoot: plantRepo([]),
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board },
      comment: true,
      output,
    }));

    expect(lines.warn).toEqual([
      `${SPEC_READY_LABEL} was not swapped for ${SPEC_NEEDS_WORK_LABEL} on issue #20: gh: could not add label`,
    ]);
    expect(refusal.exitCode).toBe(SPEC_NOT_READY_EXIT);
  });
});

describe('enforceSpecReview writes through the active output', () => {
  it('when the caller hands it none', async () => {
    const lines: string[] = [];
    setActiveOutput(sinkOutput({
      info: (message) => {
        lines.push(message);
      },
    }));

    await refusalOf(enforceSpecReview({
      review: NOT_READY,
      source: SOURCE,
      repoRoot: plantRepo([PLAN_PATH]),
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: null,
      comment: true,
    }));
    setActiveOutput(null);

    expect(lines).toEqual([`🗑  Removed ${PLAN_PATH}: the planner judged the spec not ready, so no plan stands.`]);
  });
});
