/**
 * An integration test over the readiness gate: checks 1, 2 and 3
 * composed together, in the order `.specs/rafa-20-pr-commands.md` runs
 * them, and the enforcement check 3's verdict drives.
 *
 * `src/board/readiness.test.ts`, `src/board/spec-review.test.ts` and
 * `src/board/gate.test.ts` each drive their own module in isolation,
 * with a mutation record proving each catches the failure it exists
 * for. This file drives none of that again. It exists because the gate
 * is three modules a caller composes — `plan create` wires the label
 * check, the completeness check and check 3 together over
 * `src/board/plan-spec.ts` — and a suite that only
 * ever calls each alone would not catch the seam BETWEEN them: a gap
 * shape `findReadinessGaps` answers that `enforceSpecReview` does not
 * know how to post, or a `SpecReviewReading` `parseSpecReview` answers
 * that the message-building in `readiness.ts` was written for instead.
 *
 * Each case plays one issue through the checks in order:
 *
 *   1. `requireSpecReadyLabel` — the label check
 *   2. `requireCompleteSpec` / `findReadinessGaps` — the code check,
 *      one planted issue body per gap kind
 *   3. `parseSpecReview` — the planner session's own answer, read off a
 *      planted session output, one per reading
 *   4. `enforceSpecReview` — what a `not-ready` reading (or `--skip-review`
 *      bypassing it) does to a plan a session wrote anyway: moved into
 *      `rejected/`, commented on, its labels swapped
 *
 * No case here reaches GitHub or spawns `gh` or `claude`: the board is
 * a fake recording its calls, exactly as `gate.test.ts`'s is, and the
 * plan and prerequisites files a not-ready run moves aside sit under this
 * file's own temporary directory.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { IssueBoard } from '../board/issue-board.js';
import type { SpecIssue } from '../board/issue.js';
import type { ReadinessGap } from '../board/readiness.js';
import type { SpecReviewReading } from '../board/spec-review.js';
import type { GitRunner } from '../pr/git.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  enforceSpecReview,
  readGateFlags,
  rejectedPath,
  SKIP_REVIEW_FLAG,
  SPEC_NEEDS_WORK_LABEL,
  SPEC_NOT_READY_EXIT,
} from '../board/gate.js';
import { ISSUE_VIEW_FIELDS, SPEC_LABEL } from '../board/issue.js';
import { specPath } from '../board/naming.js';
import { resolvePlanSpec } from '../board/plan-spec.js';
import {
  findReadinessGaps,
  READINESS_REFUSAL_EXIT,
  requireCompleteSpec,
  requireSpecReadyLabel,
  SPEC_READY_LABEL,
  TEMPLATE_HEADINGS,
} from '../board/readiness.js';
import { REVIEW_SKIPPED_LINE, stampReviewSkipped } from '../board/review-stamp.js';
import { parseSpecReview, SPEC_REVIEW_ANSWERS } from '../board/spec-review.js';
import { CommandExit } from '../cli/command.js';

import { sinkOutput } from './output-sinks.js';

/** The plan path a planner names for issue #31; the caller's spelling, as `gate.ts` takes one. */
const PLAN_PATH = '.rafa/plans/PLAN-rafa-31.md';

/** The prerequisites file beside it. */
const PREREQUISITES_PATH = '.rafa/plans/PREREQUISITES-rafa-31.md';

/**
 * A complete issue body, one section per template heading, in template
 * order — the issue a `requireCompleteSpec` call lets through to check
 * 3. Every case below plants a copy of this with exactly one thing
 * broken, so the gap the check answers is the gap that case is named
 * for and nothing else.
 */
const SECTIONS: readonly (readonly [string, string])[] = [
  ['What you get', 'A gate that will not pay for a session over an unfinished issue.'],
  ['Starting position', 'The issue carries no label and no plan yet.'],
  ['Design', 'The three checks run in order and stop at the first refusal.'],
  ['What can go wrong', 'A check that refuses the issue describing itself.'],
  ['Tasks the plan must carry', '- add the label check\n- add the code check'],
  ['Definition of done', '- an issue missing a section is refused before any session runs'],
];

/**
 * {@link SECTIONS} with `changes` applied by heading: a string (empty
 * string included) replaces that section's content, and `null` drops
 * the heading whole.
 */
function issueBody(changes: Readonly<Record<string, string | null>> = {}): string {
  const parts: string[] = [];
  for (const [heading, content] of SECTIONS) {
    const given = changes[heading];
    if (given === null) continue;
    parts.push(`## ${heading}\n\n${given ?? content}\n`);
  }
  return parts.join('\n');
}

/** The one gap a body carries; fails loudly when it holds none or several. */
function onlyGap(body: string): ReadinessGap {
  const gaps = findReadinessGaps(body);
  expect(gaps).toHaveLength(1);
  return gaps[0] as ReadinessGap;
}

/** What a synchronous refusal throws; fails the case when it throws nothing. */
function thrownBy(run: () => void): CommandExit {
  try {
    run();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('the check let the issue through, where this case expects a refusal');
}

/** What an asynchronous refusal throws; fails the case when it resolves. */
async function asyncThrownBy(run: Promise<void>): Promise<CommandExit> {
  try {
    await run;
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('the gate let the review through, where this case expects a refusal');
}

/** A session output holding one `rafa:spec-review` block of `lines`. */
function reviewOutput(...lines: readonly string[]): string {
  return ['I read the issue first.', '', '```rafa:spec-review', ...lines, '```', ''].join('\n');
}

/** A verdict naming the two gaps the code check itself would have caught, had it not judged the issue complete. */
const NOT_READY_OUTPUT = reviewOutput(
  'verdict: not-ready',
  'gaps:',
  '  - heading: "Definition of done"',
  '    what: "no item says how the label swap is verified"',
  '  - heading: "Tasks the plan must carry"',
  '    what: "the second task does not name what file it adds the check to"',
);

/** A verdict that lets the issue's plan stand. */
const READY_OUTPUT = reviewOutput('verdict: ready');

/** No block at all: a session that answered without judging the issue. */
const ABSENT_OUTPUT = 'I wrote the plan straight away.\n';

/** A block opened and never closed: a session that was cut off mid-answer. */
const MALFORMED_OUTPUT = [
  'I read the issue first.',
  '',
  '```rafa:spec-review',
  'verdict: not-ready',
].join('\n');

/** One call a fake board took, as `member(args)`. */
type BoardCall = readonly [string, ...unknown[]];

/** A board recording every call it takes, posting or editing nothing that fails. */
function fakeBoard(): { board: IssueBoard; calls: BoardCall[] } {
  const calls: BoardCall[] = [];
  const board: IssueBoard = {
    comments: (issue) => {
      calls.push(['comments', issue]);
      return Promise.resolve([]);
    },
    comment: (issue, body) => {
      calls.push(['comment', issue, body]);
      return Promise.resolve({ id: '99', body, author: 'rafa-bot' });
    },
    editComment: (id, body) => {
      calls.push(['editComment', id, body]);
      return Promise.resolve({ id, body, author: 'rafa-bot' });
    },
    swapLabels: (issue, removed, added) => {
      calls.push(['swapLabels', issue, removed, added]);
      return Promise.resolve();
    },
    removeLabel: (issue, label) => {
      calls.push(['removeLabel', issue, label]);
      return Promise.resolve();
    },
  };
  return { board, calls };
}

/** The lines an `enforceSpecReview` run wrote, by level. */
interface CapturedLines {
  readonly info: string[];
  readonly warn: string[];
}

/** An Output that keeps what it is handed, and the sink built from it. */
function capture(): { lines: CapturedLines; output: ReturnType<typeof sinkOutput> } {
  const lines: CapturedLines = { info: [], warn: [] };
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

let tempDir = '';
let planted = 0;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-readiness-gate-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** A repository root holding `files`, planted under its own run directory. */
function plantRepo(files: readonly string[]): string {
  planted += 1;
  const root = join(tempDir, `run-${String(planted)}`);
  mkdirSync(join(root, '.rafa', 'plans'), { recursive: true });
  for (const file of files) writeFileSync(join(root, file), 'written by the planner session\n', 'utf8');
  return root;
}

describe('the label refusal', () => {
  it('refuses issue #31 with no spec:ready label, and lets it through once labelled', () => {
    const refusal = thrownBy(() => {
      requireSpecReadyLabel(31, ['type:spec', 'module:board']);
    });

    expect(refusal.exitCode).toBe(2);
    expect(refusal.message).toBe('issue #31 is not marked spec:ready');

    expect(requireSpecReadyLabel(31, ['type:spec', SPEC_READY_LABEL])).toBeUndefined();
  });
});

describe('one planted issue per code gap', () => {
  it('answers no gap for the complete issue, which is what lets it reach check 3', () => {
    expect(findReadinessGaps(issueBody())).toEqual([]);
    expect(requireCompleteSpec('issue #31', issueBody())).toBeUndefined();
  });

  it('names a missing heading on the issue that dropped "What can go wrong" whole', () => {
    const body = issueBody({ 'What can go wrong': null });
    const gap = onlyGap(body);
    expect(gap.kind).toBe('missing-heading');
    expect(gap.heading).toBe('What can go wrong');

    const refusal = thrownBy(() => {
      requireCompleteSpec('issue #31', body);
    });
    expect(refusal.exitCode).toBe(READINESS_REFUSAL_EXIT);
    expect(refusal.message).toContain('"What can go wrong" is missing');
  });

  it('names an empty heading on the issue that left "Design" blank', () => {
    const body = issueBody({ Design: '' });
    const gap = onlyGap(body);
    expect(gap.kind).toBe('empty-heading');
    expect(gap.heading).toBe('Design');

    const refusal = thrownBy(() => {
      requireCompleteSpec('issue #31', body);
    });
    expect(refusal.message).toContain('"Design" is empty');
  });

  it('names a missing list item on the issue that wrote "Definition of done" as prose', () => {
    const body = issueBody({ 'Definition of done': 'This is done once the tests pass.' });
    const gap = onlyGap(body);
    expect(gap.kind).toBe('no-list-item');
    expect(gap.heading).toBe('Definition of done');

    const refusal = thrownBy(() => {
      requireCompleteSpec('issue #31', body);
    });
    expect(refusal.message).toContain('"Definition of done" holds no list item');
  });

  it('names a placeholder on the issue that left a TODO in "Starting position"', () => {
    const body = issueBody({ 'Starting position': 'TODO: describe where the issue starts from.' });
    const gap = onlyGap(body);
    expect(gap.kind).toBe('placeholder');
    expect(gap.heading).toBe('Starting position');

    const refusal = thrownBy(() => {
      requireCompleteSpec('issue #31', body);
    });
    expect(refusal.message).toContain('"Starting position" holds the placeholder TODO');
  });

  it('plants every template heading, so a gap this suite never breaks is still covered by name', () => {
    expect(SECTIONS.map(([heading]) => heading)).toEqual([...TEMPLATE_HEADINGS]);
  });
});

describe('the completeness check reached through plan create itself', () => {
  /** Where `resolvePlanSpec` writes the snapshot a plan is later generated from — never reached once check 2 refuses. */
  const SPECS_DIR = 'specs';

  /** A `gh` runner answering `issue view 31` with `body`, labelled `spec:ready` — the label check clears, so the completeness check is the one this suite means to reach. */
  function ghOver(body: string): GhRunner {
    return (args): Promise<GhResult> => {
      if (args[0] === 'issue' && args[1] === 'view' && args[2] === '31') {
        const issue: SpecIssue = { number: 31, title: 'Issue 31', body, state: 'OPEN', labels: [SPEC_LABEL, SPEC_READY_LABEL], author: 'octocat' };
        return Promise.resolve({
          ok: true,
          stdout: JSON.stringify({
            number: issue.number,
            title: issue.title,
            body: issue.body,
            state: issue.state,
            labels: issue.labels.map((name) => ({ name })),
            author: { login: issue.author },
          }),
          stderr: '',
        });
      }
      return Promise.resolve({ ok: false, stdout: '', stderr: `no planted answer for ${args.join(' ')} (${ISSUE_VIEW_FIELDS})` });
    };
  }

  /** No branch ever claims the issue; `resolvePlanSpec`'s `--issue` route never asks it. */
  const noBranches: GitRunner = () => ({ ok: true, stdout: '', stderr: '' });

  /** Runs `resolvePlanSpec` for issue #31 over `body`, in its own root. */
  function planFrom(root: string, body: string): ReturnType<typeof resolvePlanSpec> {
    return resolvePlanSpec({
      request: { kind: 'issue', issue: 31 },
      refresh: false,
      dryRun: false,
      repoRoot: root,
      specsDir: SPECS_DIR,
      roadmapIssue: null,
      // Check 0 runs ahead of check 2 (`src/board/plan-spec.ts`), and
      // this suite is check 2's: the allow-list clears the author
      // without a permission lookup, so the planted `gh` answers the
      // one read the case is about and refuses every other command.
      trustedAuthors: ['octocat'],
      findSpec: (spec) => spec,
      gh: ghOver(body),
      git: noBranches,
      output: sinkOutput({}),
    });
  }

  it('writes no plan file and refuses naming the heading, over an issue whose "Definition of done" holds no list item — a control over the complete issue reaches the planner instead', async () => {
    const root = plantRepo([]);
    const broken = issueBody({ 'Definition of done': 'This is done once the tests pass.' });
    const snapshot = join(root, specPath(SPECS_DIR, 31, 'Issue 31'));

    const refused = await asyncThrownBy(planFrom(root, broken).then(() => undefined));

    expect(refused.exitCode).toBe(READINESS_REFUSAL_EXIT);
    expect(refused.message).toContain('"Definition of done" holds no list item');
    // No spec is snapshotted, so the planner is never handed a spec to
    // write `.rafa/plans/PLAN-<stub>.md` from — the plan `plan create`
    // would otherwise write.
    expect(existsSync(snapshot)).toBe(false);
    expect(existsSync(join(root, PLAN_PATH))).toBe(false);

    // The control: the same call over the complete issue snapshots the
    // spec and reaches the planner instead of a refusal.
    const resolved = await planFrom(root, issueBody());
    expect(resolved.outcome).toBe('spec');
    expect(existsSync(snapshot)).toBe(true);
  });
});

describe('the parser\'s four answers', () => {
  it('reads ready, not-ready, absent and malformed off four planted session outputs', () => {
    const ready = parseSpecReview(READY_OUTPUT);
    expect(ready.answer).toBe('ready');
    expect(ready.ready).toBe(true);
    expect(ready.gaps).toEqual([]);

    const notReady = parseSpecReview(NOT_READY_OUTPUT);
    expect(notReady.answer).toBe('not-ready');
    expect(notReady.ready).toBe(false);
    expect(notReady.gaps.map((gap) => gap.heading)).toEqual(['Definition of done', 'Tasks the plan must carry']);

    const absent = parseSpecReview(ABSENT_OUTPUT);
    expect(absent.answer).toBe('absent');
    expect(absent.ready).toBe(false);

    const malformed = parseSpecReview(MALFORMED_OUTPUT);
    expect(malformed.answer).toBe('malformed');
    expect(malformed.ready).toBe(false);

    expect([ready, notReady, absent, malformed].map((reading) => reading.answer))
      .toEqual([...SPEC_REVIEW_ANSWERS]);
  });
});

describe('a not-ready verdict on a plan the session wrote anyway', () => {
  it('moves the plan and the prerequisites aside, posts the comment and swaps the labels', async () => {
    const root = plantRepo([PLAN_PATH, PREREQUISITES_PATH]);
    const { board, calls } = fakeBoard();
    const { lines, output } = capture();
    const review: SpecReviewReading = parseSpecReview(NOT_READY_OUTPUT);

    const refusal = await asyncThrownBy(enforceSpecReview({
      review,
      source: 'issue #31',
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 31, board },
      comment: true,
      output,
    }));

    expect(refusal.exitCode).toBe(SPEC_NOT_READY_EXIT);
    expect(refusal.exitCode).toBe(3);
    expect(existsSync(join(root, PLAN_PATH))).toBe(false);
    expect(existsSync(join(root, PREREQUISITES_PATH))).toBe(false);

    expect(calls.map((call) => call[0])).toEqual(['comments', 'comment', 'swapLabels']);
    expect(String(calls[1]?.[2])).toContain('no item says how the label swap is verified');
    expect(calls[2]).toEqual(['swapLabels', 31, SPEC_READY_LABEL, SPEC_NEEDS_WORK_LABEL]);

    expect(lines.info).toEqual([
      `🗃  Moved ${PLAN_PATH} to ${rejectedPath(PLAN_PATH)}: `
        + 'the planner judged the spec not ready, so no plan stands.',
      `🗃  Moved ${PREREQUISITES_PATH} to ${rejectedPath(PREREQUISITES_PATH)}: `
        + 'the planner judged the spec not ready, so no plan stands.',
      '💬 Posted the review comment on issue #31.',
      `🏷  Swapped ${SPEC_READY_LABEL} for ${SPEC_NEEDS_WORK_LABEL} on issue #31.`,
    ]);
    expect(lines.warn).toEqual([]);
  });

  it('lets a ready verdict on the same issue stand, removing nothing and calling the board never', async () => {
    const root = plantRepo([PLAN_PATH, PREREQUISITES_PATH]);
    const { board, calls } = fakeBoard();
    const { output } = capture();

    await enforceSpecReview({
      review: parseSpecReview(READY_OUTPUT),
      source: 'issue #31',
      repoRoot: root,
      planPath: PLAN_PATH,
      prerequisitesPath: PREREQUISITES_PATH,
      issue: { number: 31, board },
      comment: true,
      output,
    });

    expect(existsSync(join(root, PLAN_PATH))).toBe(true);
    expect(existsSync(join(root, PREREQUISITES_PATH))).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('--skip-review', () => {
  it('reads the flag off the command line', () => {
    expect(readGateFlags(['--spec=issue-31.md', SKIP_REVIEW_FLAG]).skipReview).toBe(true);
    expect(readGateFlags(['--spec=issue-31.md']).skipReview).toBe(false);
  });

  it('bypasses the gate entirely, so the plan stands and the board takes no call', async () => {
    const root = plantRepo([]);
    const planFile = join(root, PLAN_PATH);
    writeFileSync(planFile, ['```rafa:plan', 'stub: rafa-31', '```', ''].join('\n'), 'utf8');
    const { board, calls } = fakeBoard();

    const flags = readGateFlags(['--spec=issue-31.md', SKIP_REVIEW_FLAG]);
    expect(flags.skipReview).toBe(true);

    // What `flags.skipReview` means to the caller: `enforceSpecReview` is
    // never reached, however the session's own `rafa:spec-review` block
    // read — a not-ready reading included, planted here to show the
    // bypass holds even then — and the plan is stamped instead.
    const review = parseSpecReview(NOT_READY_OUTPUT);
    expect(review.ready).toBe(false);
    if (!flags.skipReview) {
      await enforceSpecReview({
        review,
        source: 'issue #31',
        repoRoot: root,
        planPath: PLAN_PATH,
        prerequisitesPath: PREREQUISITES_PATH,
        issue: { number: 31, board },
        comment: true,
      });
    } else {
      const stamp = stampReviewSkipped(readFileSync(planFile, 'utf8'));
      expect(stamp.recorded).toBe(true);
      writeFileSync(planFile, stamp.text, 'utf8');
    }

    expect(existsSync(planFile)).toBe(true);
    expect(readFileSync(planFile, 'utf8')).toContain(REVIEW_SKIPPED_LINE);
    expect(calls).toEqual([]);
  });
});
