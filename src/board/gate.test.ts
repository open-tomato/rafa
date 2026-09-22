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
 * that refuses EVERYTHING. So the refusal cases sit beside the readings
 * that must be let through — a ready verdict, a planner that judged
 * nothing, and since 2026-09-20 a review the parser could not read over
 * a plan that reads as written — over the same files and the same
 * board, and each of those asserts the standing it answers, that no
 * file was moved and that no command was sent.
 *
 * The four readings a session can leave behind each have their case
 * here: `ready`, `not-ready`, `absent` and `malformed`, the last two
 * both over a plan `plan validate` reads without an issue and over one
 * it does not, which are the two answers an unread review has. A case
 * that asserted only the exit code of the unreadable-plan refusal would
 * be satisfied by a gate that refused every unread review, so each
 * standing case holds the WARNING it wrote and the empty call list
 * beside the files still on disk.
 *
 * `not-ready` has TWO enforcements since 2026-09-22 and both are here.
 * A verdict whose every gap is non-blocking writes the plan, and the
 * cases for it assert what a gate that refused everything could not
 * satisfy: the plan still on disk, its first line the assumptions
 * heading, the review line in its block, the plan below it byte for
 * byte, the comment posted in the body that says a plan was written,
 * and `swapLabels` never called. One blocking gap beside a
 * non-blocking one keeps the refusal, and its case asserts the move,
 * the refusal body and the swap, so a gate that planned under
 * everything fails it. The two are driven from the SAME two gaps, one
 * field apart, which is what says the branch turns on `blocking` and
 * not on anything else about the review.
 *
 * Five mutations of `gate.ts` were driven on 2026-09-19, one at a time
 * over `env -u CLAUDECODE bun test src/board/ src/plan.test.ts`, the
 * module restored from a scratch copy and verified with `shasum -c`
 * after each. 197 pass either side, and each count is that run's own:
 *
 *  - the removal skipped, the mutation this module exists to prevent:
 *    5 fail, the four cases here that assert a file is gone — both
 *    files, the plan alone, the spec off a file and the active-output
 *    one — and the `not-ready` case in `src/plan.test.ts`. The
 *    unreadable-plan case added on 2026-09-20 asserts the same removal
 *    and was not part of that run.
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
 *
 * Two mutations of the unread branch were driven on 2026-09-20 over
 * `env -u CLAUDECODE bun test src/board/gate.test.ts src/plan.test.ts
 * src/board/review-stamp.test.ts
 * src/tests/readiness-gate-integration.test.ts`, the module restored
 * from a scratch copy and verified with `shasum -c` after each. 67 pass
 * either side:
 *
 *  - the `plan validate` reading ignored, so every unread review lets
 *    the plan stand: 65 pass, 2 fail — the unreadable-plan case and the
 *    no-plan case here.
 *  - the unread branch dropped, so an unread review is enforced as a
 *    not-ready verdict was before this change: 61 pass, 6 fail — all
 *    five cases here and the `missing-review` case in
 *    `src/plan.test.ts`.
 *
 * One mutation of the move added on 2026-09-20 was driven over
 * `bun test src/board/gate.test.ts`, the module restored from a scratch
 * copy and verified with `shasum -c`: the rename swapped back for an
 * `rmSync`, so the gate deletes as it used to, fails 3 of the 18 cases
 * here — the byte-for-byte case, the both-files case and the
 * plan-alone case — where 18 pass with the move in place.
 *
 * Four mutations of the assumed path were driven on 2026-09-22, one at
 * a time over `env -u CLAUDECODE bun test src/board/ src/plan.test.ts
 * src/tests/readiness-gate-integration.test.ts`, the module restored
 * from a scratch copy and verified with `shasum -c` after each. 564
 * pass either side:
 *
 *  - the assumed branch dropped, so every `not-ready` verdict is
 *    refused as it was before the change: 559 pass, 5 fail — the five
 *    cases here that plan under a verdict, and not the blocking one.
 *  - every `not-ready` verdict planned under, the mutation the
 *    blocking case exists to catch: 551 pass, 13 fail — that case, the
 *    six refusal cases above it, the two board-write ones, the
 *    active-output one, the two `src/plan.test.ts` cases and the
 *    `src/tests/readiness-gate-integration.test.ts` one.
 *  - the assumptions section left out with the stamp kept: 562 pass, 2
 *    fail — the two cases that read the file the gate wrote back.
 *  - the refusal body posted for a verdict planned under, so the
 *    comment tells the author no plan was written over a plan that
 *    stands: 563 pass, 1 fail — the case that reads the posted body.
 */
import type { IssueBoard } from './issue-board.js';
import type { SpecReviewReading } from './spec-review.js';
import type { BoardTrust } from './trust.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { parsePlan } from '../plan/parse.js';
import { sinkOutput } from '../tests/output-sinks.js';

import {
  enforceSpecReview,
  NO_COMMENT_FLAG,
  readGateFlags,
  rejectedPath,
  SKIP_REVIEW_FLAG,
  SPEC_NEEDS_WORK_LABEL,
  SPEC_NOT_READY_EXIT,
} from './gate.js';
import { SPEC_READY_LABEL } from './readiness.js';
import { SPEC_REVIEW_MARKER } from './review-comment.js';
import { ASSUMPTIONS_HEADING, REVIEW_ASSUMED_LINE } from './review-stamp.js';
import { parseSpecReview } from './spec-review.js';

/**
 * The trust the gate's issue carries, allow-listing the account every
 * fake marker comment here is written by. Its lookup THROWS, so a case
 * that reached one would fail rather than pass quietly: an allow-list
 * hit spends none (`./trust.ts`).
 */
const TRUSTING: BoardTrust = {
  permissions: () => {
    throw new Error('the gate spent a permission lookup on an allow-listed author');
  },
  trustedAuthors: ['rafa-bot'],
  repo: 'open-tomato/rafa',
};

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

/** A verdict naming two gaps, neither of which blocks planning. */
const ASSUMED = reviewOf(
  'verdict: not-ready',
  'gaps:',
  '  - heading: "Design"',
  '    what: "the store backend is not named"',
  '    blocking: false',
  '    assumption: "the SQLite backend, as every other command reads"',
  '  - heading: "Tasks the plan must carry"',
  '    what: "the third task does not name what it changes"',
  '    blocking: false',
  '    assumption: "the task changes the module its name reads on"',
);

/**
 * The same two gaps, one field apart: the second one blocks, and its
 * assumption is written all the same. What the branch turns on is
 * `blocking` and not whether a gap named a guess.
 */
const ONE_BLOCKING = reviewOf(
  'verdict: not-ready',
  'gaps:',
  '  - heading: "Design"',
  '    what: "the store backend is not named"',
  '    blocking: false',
  '    assumption: "the SQLite backend, as every other command reads"',
  '  - heading: "Tasks the plan must carry"',
  '    what: "the third task does not name what it changes"',
  '    blocking: true',
  '    assumption: "the task changes the module its name reads on"',
);

/** A verdict that lets the plan stand. */
const READY = reviewOf('verdict: ready');

/** A session that said nothing about the spec at all. */
const ABSENT = parseSpecReview('I wrote the plan and stopped.\n');

/** A session whose block came back unreadable: a body that is no mapping. */
const MALFORMED = reviewOf('- verdict: ready');

/** A plan `plan validate` reads without an issue, as a session writes one. */
const PLAN_TEXT = [
  '# Plan: rafa-20',
  '',
  '```rafa:plan',
  'stub: rafa-20',
  '```',
  '',
  '- [ ] Do the thing',
  '',
].join('\n');

/** The same plan with its header block left open: two parser issues. */
const UNREADABLE_PLAN_TEXT = ['# Plan: rafa-20', '', '```rafa:plan', 'stub: rafa-20', '', '- [ ] Do the thing', ''].join('\n');

/**
 * The same plan as a verdict planned under leaves it, below the
 * assumptions section: byte for byte the session's own, with the review
 * line recorded above its closing fence.
 */
const ASSUMED_PLAN_TEXT = [
  '# Plan: rafa-20',
  '',
  '```rafa:plan',
  'stub: rafa-20',
  REVIEW_ASSUMED_LINE,
  '```',
  '',
  '- [ ] Do the thing',
  '',
].join('\n');

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
    removeLabel: (issue, label) => {
      calls.push(['removeLabel', issue, label]);
      return Promise.resolve();
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

/** A repository whose plan file holds `text`, with the prerequisites file beside it. */
function plantPlanned(text: string): string {
  const root = plantRepo();
  writeFileSync(join(root, PLAN_PATH), text, 'utf8');
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

    const standing = await enforceSpecReview({
      review: READY,
      source: 'issue #20',
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board, trust: TRUSTING },
      comment: true,
      output,
    });

    expect(standing).toBe('ready');
    expect(existsSync(join(root, PLAN_PATH))).toBe(true);
    expect(calls).toEqual([]);
    expect(lines).toEqual({ info: [], warn: [] });
  });

  it('a planner that judged nothing, which is what an optional review means', async () => {
    const root = plantRepo();
    const { board, calls } = fakeBoard(false);

    const standing = await enforceSpecReview({
      review: undefined,
      source: 'issue #20',
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board, trust: TRUSTING },
      comment: true,
      output: capture().output,
    });

    expect(standing).toBe('unjudged');
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
      issue: { number: 20, board, trust: TRUSTING },
      comment: true,
      output,
    }));

    expect(existsSync(join(root, PLAN_PATH))).toBe(false);
    expect(existsSync(join(root, PREREQUISITES_PATH))).toBe(false);
    expect(existsSync(join(root, rejectedPath(PLAN_PATH)))).toBe(true);
    expect(existsSync(join(root, rejectedPath(PREREQUISITES_PATH)))).toBe(true);
    expect(calls.map((call) => call[0])).toEqual(['comments', 'comment', 'swapLabels']);
    expect(calls[2]).toEqual(['swapLabels', 20, SPEC_READY_LABEL, SPEC_NEEDS_WORK_LABEL]);
    expect(String(calls[1]?.[2])).toContain('no item says how the merge clean-up is verified');
    expect(refusal.exitCode).toBe(SPEC_NOT_READY_EXIT);
    expect(refusal.message).toContain('issue #20 is not ready to plan from');
    expect(refusal.message).toContain('"Definition of done": no item says how the merge clean-up is verified');
    expect(refusal.message).toContain('"Tasks the plan must carry": the third task does not name what it changes');
    expect(refusal.message).toContain(`label the issue ${SPEC_READY_LABEL} again`);
    expect(lines.info).toEqual([
      `🗃  Moved ${PLAN_PATH} to ${rejectedPath(PLAN_PATH)}: `
        + 'the planner judged the spec not ready, so no plan stands.',
      `🗃  Moved ${PREREQUISITES_PATH} to ${rejectedPath(PREREQUISITES_PATH)}: `
        + 'the planner judged the spec not ready, so no plan stands.',
      '💬 Posted the review comment on issue #20.',
      `🏷  Swapped ${SPEC_READY_LABEL} for ${SPEC_NEEDS_WORK_LABEL} on issue #20.`,
    ]);
    expect(lines.warn).toEqual([]);
  });

  it('keeps both files byte for byte under rejected/, because a session costs money', async () => {
    const root = plantRepo([]);
    const planBytes = 'plan written against a refused review\n';
    const prerequisiteBytes = 'prerequisites written beside it\n';
    writeFileSync(join(root, PLAN_PATH), planBytes, 'utf8');
    writeFileSync(join(root, PREREQUISITES_PATH), prerequisiteBytes, 'utf8');

    await refusalOf(enforceSpecReview({
      review: NOT_READY,
      source: SOURCE,
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: null,
      comment: true,
      output: capture().output,
    }));

    expect(rejectedPath(PLAN_PATH)).toBe('.rafa/plans/rejected/PLAN-rafa-20.md');
    expect(readFileSync(join(root, rejectedPath(PLAN_PATH)), 'utf8')).toBe(planBytes);
    expect(readFileSync(join(root, rejectedPath(PREREQUISITES_PATH)), 'utf8')).toBe(prerequisiteBytes);
    expect(existsSync(join(root, PLAN_PATH))).toBe(false);
    expect(existsSync(join(root, PREREQUISITES_PATH))).toBe(false);
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
      issue: { number: 20, board, trust: TRUSTING },
      comment: true,
      output,
    }));

    expect(calls.map((call) => call[0])).toEqual(['comments', 'editComment', 'swapLabels']);
    expect(calls[1]?.[1]).toBe('42');
    expect(lines.info).toContain('💬 Edited the review comment on issue #20.');
  });

  it('moves what the session wrote aside even when it wrote only the plan', async () => {
    const root = plantRepo([PLAN_PATH]);
    const { lines, output } = capture();

    await refusalOf(enforceSpecReview({
      review: NOT_READY,
      source: 'issue #20',
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board: fakeBoard(false).board, trust: TRUSTING },
      comment: true,
      output,
    }));

    expect(existsSync(join(root, PLAN_PATH))).toBe(false);
    expect(existsSync(join(root, rejectedPath(PLAN_PATH)))).toBe(true);
    expect(lines.info.filter((line) => line.startsWith('🗃'))).toHaveLength(1);
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
      issue: { number: 20, board, trust: TRUSTING },
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
    expect(lines.info.filter((line) => !line.startsWith('🗃'))).toEqual([]);
    expect(refusal.message).toContain(`❌ ${SOURCE} is not ready to plan from`);
    expect(refusal.message).toContain('Close the gaps in the spec, then plan from it again.');
    expect(refusal.message).not.toContain(SPEC_READY_LABEL);
  });

});

describe('enforceSpecReview on a not-ready verdict it can plan under', () => {
  it('opens the plan with the assumptions, records the review, posts the gaps and moves no label', async () => {
    const root = plantPlanned(PLAN_TEXT);
    const { board, calls } = fakeBoard(false);
    const { lines, output } = capture();

    const standing = await enforceSpecReview({
      review: ASSUMED,
      source: 'issue #20',
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board, trust: TRUSTING },
      comment: true,
      output,
    });

    // The reading this case is about: a not-ready verdict no gap of
    // which blocks, which is what the plan is written under.
    expect(ASSUMED.answer).toBe('not-ready');
    expect(ASSUMED.gaps.some((gap) => gap.blocking)).toBe(false);
    expect(standing).toBe('assumed');
    expect(existsSync(join(root, PLAN_PATH))).toBe(true);
    expect(existsSync(join(root, PREREQUISITES_PATH))).toBe(true);
    expect(existsSync(join(root, rejectedPath(PLAN_PATH)))).toBe(false);

    const written = readFileSync(join(root, PLAN_PATH), 'utf8');
    expect(written.split('\n')[0]).toBe(ASSUMPTIONS_HEADING);
    expect(written).toContain('- Planned under: the SQLite backend, as every other command reads');
    expect(written).toContain('- Planned under: the task changes the module its name reads on');
    expect(written.endsWith(ASSUMED_PLAN_TEXT)).toBe(true);

    expect(calls.map((call) => call[0])).toEqual(['comments', 'comment']);
    const body = String(calls[1]?.[2]);
    expect(body).toContain('found 2 gaps, none of them blocking');
    expect(body).toContain('- Planned under: the SQLite backend, as every other command reads');
    expect(body).not.toContain('No plan was written.');
    expect(lines.warn).toEqual([
      'the rafa:spec-review block at line 3 judged the spec not ready, naming 2 gaps, none of them blocking;'
        + ` ${PLAN_PATH} is written under the assumptions the review named`,
    ]);
    expect(lines.info).toEqual([
      `🧭 ${PLAN_PATH} opens under the review's assumptions and records ${REVIEW_ASSUMED_LINE}.`,
      '💬 Posted the review comment on issue #20.',
    ]);
  });

  it('leaves the plan it opened reading as written, with the review word among its extras', async () => {
    const root = plantPlanned(PLAN_TEXT);

    await enforceSpecReview({
      review: ASSUMED,
      source: SOURCE,
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: null,
      comment: true,
      output: capture().output,
    });
    const model = parsePlan(readFileSync(join(root, PLAN_PATH), 'utf8'));

    expect(model.issues).toEqual([]);
    expect(model.header.stub).toBe('rafa-20');
    expect(model.header.extras).toEqual([{ key: 'review', value: 'assumed' }]);
    expect(model.tasks.map((task) => task.text)).toEqual(['Do the thing']);
  });

  it('removes the files, posts the gaps and swaps the labels when one gap among them blocks', async () => {
    const root = plantPlanned(PLAN_TEXT);
    const { board, calls } = fakeBoard(false);
    const { lines, output } = capture();

    const refusal = await refusalOf(enforceSpecReview({
      review: ONE_BLOCKING,
      source: 'issue #20',
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board, trust: TRUSTING },
      comment: true,
      output,
    }));

    expect(ONE_BLOCKING.gaps.filter((gap) => gap.blocking)).toHaveLength(1);
    expect(ONE_BLOCKING.gaps.map((gap) => gap.assumption)).toEqual(ASSUMED.gaps.map((gap) => gap.assumption));
    expect(existsSync(join(root, PLAN_PATH))).toBe(false);
    expect(existsSync(join(root, rejectedPath(PLAN_PATH)))).toBe(true);
    expect(calls.map((call) => call[0])).toEqual(['comments', 'comment', 'swapLabels']);
    expect(calls[2]).toEqual(['swapLabels', 20, SPEC_READY_LABEL, SPEC_NEEDS_WORK_LABEL]);
    expect(String(calls[1]?.[2])).toContain('No plan was written.');
    expect(refusal.exitCode).toBe(SPEC_NOT_READY_EXIT);
    expect(refusal.message).toContain('"Tasks the plan must carry": the third task does not name what it changes');
    expect(refusal.message).toContain('"Design": the store backend is not named');
    expect(lines.warn).toEqual([]);
  });

  it('writes the plan and sends no command at all under --no-comment', async () => {
    const root = plantPlanned(PLAN_TEXT);
    const { board, calls } = fakeBoard(false);
    const { lines, output } = capture();

    const standing = await enforceSpecReview({
      review: ASSUMED,
      source: 'issue #20',
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board, trust: TRUSTING },
      comment: false,
      output,
    });

    expect(standing).toBe('assumed');
    expect(calls).toEqual([]);
    expect(readFileSync(join(root, PLAN_PATH), 'utf8')).toContain(REVIEW_ASSUMED_LINE);
    expect(lines.info).toContain(`💬 ${NO_COMMENT_FLAG}: the gaps were not posted on issue #20.`);
  });

  it('warns and stands when the session wrote no plan to open, rather than refusing the verdict', async () => {
    const root = plantRepo([]);
    const { board, calls } = fakeBoard(false);
    const { lines, output } = capture();

    const standing = await enforceSpecReview({
      review: ASSUMED,
      source: 'issue #20',
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board, trust: TRUSTING },
      comment: true,
      output,
    });

    expect(standing).toBe('assumed');
    expect(existsSync(join(root, PLAN_PATH))).toBe(false);
    expect(lines.warn).toContain(
      `${PLAN_PATH} was not opened under the review's assumptions: the session wrote no plan there`,
    );
    // The control: the gaps still went up, so the warning is about the
    // plan alone and not about a path that gave up on the verdict.
    expect(calls.map((call) => call[0])).toEqual(['comments', 'comment']);
  });

  it('opens a plan holding no rafa:plan block anyway, warning that it records no review line', async () => {
    // `plantRepo` writes a line of prose, not a plan: there is no block
    // to stamp, and the assumptions are still what a person reads.
    const root = plantRepo();
    const { lines, output } = capture();

    const standing = await enforceSpecReview({
      review: ASSUMED,
      source: SOURCE,
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: null,
      comment: true,
      output,
    });

    const written = readFileSync(join(root, PLAN_PATH), 'utf8');

    expect(standing).toBe('assumed');
    expect(written.split('\n')[0]).toBe(ASSUMPTIONS_HEADING);
    expect(written.endsWith('written anyway\n')).toBe(true);
    expect(written).not.toContain(REVIEW_ASSUMED_LINE);
    expect(lines.warn.at(-1)).toContain(`records no ${REVIEW_ASSUMED_LINE}`);
    expect(lines.info).toEqual([]);
  });
});

describe('enforceSpecReview on a review it could not read', () => {
  it('lets a plan that reads as written stand on a missing block, with one warning and no board call', async () => {
    const root = plantPlanned(PLAN_TEXT);
    const { board, calls } = fakeBoard(false);
    const { lines, output } = capture();

    const standing = await enforceSpecReview({
      review: ABSENT,
      source: 'issue #20',
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board, trust: TRUSTING },
      comment: true,
      output,
    });

    expect(ABSENT.answer).toBe('absent');
    expect(standing).toBe('unread');
    expect(existsSync(join(root, PLAN_PATH))).toBe(true);
    expect(existsSync(join(root, PREREQUISITES_PATH))).toBe(true);
    expect(calls).toEqual([]);
    expect(lines.warn).toEqual([
      `the session output holds no rafa:spec-review block; ${PLAN_PATH} reads as written, so the plan stands unreviewed`,
    ]);
    expect(lines.info).toEqual([]);
  });

  it('lets one stand on a malformed block the same way, whatever the body held', async () => {
    const root = plantPlanned(PLAN_TEXT);
    const { board, calls } = fakeBoard(false);
    const { lines, output } = capture();

    const standing = await enforceSpecReview({
      review: MALFORMED,
      source: 'issue #20',
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board, trust: TRUSTING },
      comment: true,
      output,
    });

    expect(MALFORMED.answer).toBe('malformed');
    expect(standing).toBe('unread');
    expect(existsSync(join(root, PLAN_PATH))).toBe(true);
    expect(calls).toEqual([]);
    expect(lines.warn).toHaveLength(1);
    expect(lines.warn[0]).toContain('not a mapping of verdict and gaps');
    expect(lines.warn[0]).toContain('so the plan stands unreviewed');
  });

  it('stands on a file the parser finds no issue in, which is all reading as written says', async () => {
    // `plantRepo` writes a line of prose, not a plan: the parser reports
    // nothing about it, so the gate keeps it. What says the file carries
    // no rafa:plan block is the caller's stamp (`./review-stamp.test.ts`).
    const root = plantRepo();
    const { lines, output } = capture();

    const standing = await enforceSpecReview({
      review: ABSENT,
      source: SOURCE,
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: null,
      comment: true,
      output,
    });

    expect(standing).toBe('unread');
    expect(existsSync(join(root, PLAN_PATH))).toBe(true);
    expect(lines.warn).toHaveLength(1);
  });

  it('removes the files and exits 3 when the plan does not read as written, naming every issue', async () => {
    const root = plantPlanned(UNREADABLE_PLAN_TEXT);
    const { board, calls } = fakeBoard(false);
    const { lines, output } = capture();

    const refusal = await refusalOf(enforceSpecReview({
      review: ABSENT,
      source: 'issue #20',
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board, trust: TRUSTING },
      comment: true,
      output,
    }));

    expect(existsSync(join(root, PLAN_PATH))).toBe(false);
    expect(existsSync(join(root, PREREQUISITES_PATH))).toBe(false);
    expect(calls).toEqual([]);
    expect(refusal.exitCode).toBe(SPEC_NOT_READY_EXIT);
    expect(refusal.message).toContain('issue #20: no plan stands');
    expect(refusal.message).toContain('the session output holds no rafa:spec-review block');
    expect(refusal.message).toContain(`${PLAN_PATH}:3: unclosed-block:`);
    expect(refusal.message).toContain('Plan from the spec again.');
    expect(lines.info).toEqual([
      `🗃  Moved ${PLAN_PATH} to ${rejectedPath(PLAN_PATH)}: `
        + 'no review came back and the plan does not read as written, so no plan stands.',
      `🗃  Moved ${PREREQUISITES_PATH} to ${rejectedPath(PREREQUISITES_PATH)}: `
        + 'no review came back and the plan does not read as written, so no plan stands.',
    ]);
    expect(lines.warn).toEqual([]);
  });

  it('refuses a session that wrote no plan at all, naming the path it was told to write', async () => {
    const { board, calls } = fakeBoard(false);
    const { output } = capture();

    const refusal = await refusalOf(enforceSpecReview({
      review: ABSENT,
      source: 'issue #20',
      repoRoot: plantRepo([]),
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 20, board, trust: TRUSTING },
      comment: true,
      output,
    }));

    expect(refusal.exitCode).toBe(SPEC_NOT_READY_EXIT);
    expect(refusal.message).toContain(`${PLAN_PATH}: the session wrote no plan there`);
    expect(calls).toEqual([]);
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
      issue: { number: 20, board, trust: TRUSTING },
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
      issue: { number: 20, board, trust: TRUSTING },
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

    expect(lines).toEqual([
      `🗃  Moved ${PLAN_PATH} to ${rejectedPath(PLAN_PATH)}: `
        + 'the planner judged the spec not ready, so no plan stands.',
    ]);
  });
});
