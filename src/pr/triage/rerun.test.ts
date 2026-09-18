/**
 * Tests for the re-run readings (`src/pr/triage/rerun.ts`): what a
 * second `rafa pr triage` over the same pull request decides from the
 * comment already on it and the head and checks as they stand now.
 *
 * The module is pure, so every case here is a direct call over
 * literals: a comment body composed from the real
 * {@link writeTriageBlock}, a head, and rows. Nothing spawns a process
 * or reaches GitHub, and nothing reads a clock.
 *
 * Each of the four readings has its own case, and the decision set is
 * held closed from both ends the way `classify.test.ts` holds the class
 * set: {@link EVERY_DECISION} labels one input per decision, and the
 * closed-set case asserts the decisions it produced are exactly
 * `RERUN_DECISIONS`. A fifth reading added to the module without a case
 * here reddens that assertion rather than passing unmeasured.
 *
 * Three readings carry a control, because each could pass while wrong:
 *
 *   - `already-assessed` is the reading that STOPS a run, so its case
 *     is paired with the same stored comment against a moved head,
 *     which must not read that way. A comparison stuck at true would
 *     pass one and fail the other.
 *   - A stored head the block reader refused (an unquoted sha of digits
 *     alone, which YAML retypes as a number) must read as MOVED. Its
 *     control is the same sha stored QUOTED at the same head, which
 *     does read as `already-assessed` — so the case measures the refusal
 *     and not merely that some digits somewhere failed to match.
 *   - `pending` needs a stored comment, and its control is the same
 *     pending rows with no comment at all, which must reach `assess` so
 *     that a first run over a running pull request still produces the
 *     `pending` CLASS through the classifier.
 *
 * Eleven mutations of `rerun.ts` were driven on 2026-09-18, one at a
 * time, over this file. 19 pass either side, and the module was
 * restored from a scratch copy and verified with `shasum -c` after
 * each. Each line below is the run's own count, not a prediction:
 *
 *   - `isSameHead` answering true whatever it was handed: 12 fail,
 *     including the moved-head control and all three closed-set cases,
 *     which collapse onto `already-assessed`.
 *   - `isSameHead` answering true for a NULL stored head: 3 fail, the
 *     unreadable-head case, the no-block case and the direct case. Not
 *     the moved-head control, whose stored head reads clean and simply
 *     differs — which is why both controls are here.
 *   - `isSameHead` dropping the prefix rule, and separately dropping
 *     its length floor: 1 fail each, the abbreviation case, once per
 *     half.
 *   - `decide` asking the green question before the stored head: 1
 *     fail, the green-at-the-stored-head case. The closed-set cases do
 *     NOT catch it, because their `already-assessed` input is red.
 *   - `decide` answering `pending` without a stored comment: 1 fail,
 *     the first-run control.
 *   - `writeFor` ignoring `noComment`: 1 fail, the `--no-comment` case.
 *   - `writeFor` swapping `post` and `edit`: 3 fail.
 *   - `assesses` fixed at false: 4 fail, including the closed-set case
 *     that reads it per decision.
 *   - `storedTime` always taking the comment's clock: 2 fail, the
 *     already-assessed case and the pending case, which is the reading
 *     that shows the old triage's own time.
 *   - the green headline reused for `assess`: 3 fail, all three assess
 *     cases.
 */
import type { RerunDecision, RerunInput } from './rerun.js';
import type { CheckRow } from '../checks.js';
import type { PullRequestComment } from '../types.js';

import { describe, expect, it } from 'bun:test';

import { TRIAGE_BLOCK_FENCE, TRIAGE_MARKER, writeTriageBlock } from './comment.js';
import {
  isRerunDecision,
  isSameHead,
  readTriageRerun,
  RERUN_DECISIONS,
  SHORT_HEAD_LENGTH,
} from './rerun.js';

/** The fence a triage block opens with, spelled in parts so this file carries no block of its own. */
const FENCE = '```';

/** The head a stored triage was pinned to, as rafa writes one. */
const STORED_HEAD = '9f2c1ab4e7d0c3b5a6f8091d2e3c4b5a6f708192';

/** A different head, as a push produces one. */
const MOVED_HEAD = '3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60';

/** A head of digits alone, which unquoted YAML reads back as a number. */
const DIGIT_HEAD = '1234567890123456789012345678901234567890';

/** When the stored triage was made, as its block records it. */
const STORED_AT = '2026-09-17T09:30:00Z';

/** When the comment carrying it was last edited, which is a different clock. */
const COMMENT_AT = '2026-09-17T09:30:04Z';

/** One check row. */
function row(name: string, state: string, outcome: CheckRow['outcome']): CheckRow {
  return { name, state, link: `https://ci.example/${name}`, outcome };
}

/** Rows that have all passed. */
const GREEN_ROWS: readonly CheckRow[] = [row('gates', 'SUCCESS', 'pass')];

/** Rows with a failure in them. */
const RED_ROWS: readonly CheckRow[] = [
  row('gates', 'FAILURE', 'fail'),
  row('build', 'SUCCESS', 'pass'),
];

/** Rows with a run still in flight. */
const PENDING_ROWS: readonly CheckRow[] = [
  row('gates', 'IN_PROGRESS', 'pending'),
  row('build', 'SUCCESS', 'pass'),
];

/** A comment body carrying the marker and a `rafa:triage` block at `head`. */
function storedBody(head: string): string {
  const block = writeTriageBlock({
    head,
    at: STORED_AT,
    triageClass: 'ci-test',
    simple: false,
    attempts: 0,
    files: [],
  });
  return [
    TRIAGE_MARKER,
    '**rafa triage**: `ci-test`, not simple, not resolved',
    '',
    `${FENCE}${TRIAGE_BLOCK_FENCE}`,
    block,
    FENCE,
    '',
  ].join('\n');
}

/** The stored triage comment, its body given. */
function comment(body: string): PullRequestComment {
  return {
    id: 'IC_kwDOA1',
    author: { login: 'rafa-bot', isBot: true },
    body,
    updatedAt: COMMENT_AT,
    url: 'https://github.com/open-tomato/rafa/pull/21#issuecomment-1',
  };
}

/** The stored triage comment pinned to `head`. */
function storedAt(head: string): PullRequestComment {
  return comment(storedBody(head));
}

/** One re-run input: a stored triage at the stored head, red, unless a case says otherwise. */
function input(overrides: Partial<RerunInput> = {}): RerunInput {
  return {
    comment: storedAt(STORED_HEAD),
    head: STORED_HEAD,
    rows: RED_ROWS,
    ...overrides,
  };
}

/** The decision one input reads as. */
function decisionOf(one: RerunInput): RerunDecision {
  return readTriageRerun(one).decision;
}

/**
 * One input per decision, each labelled with the decision it must
 * produce. The closed-set case reads this from both ends.
 */
const EVERY_DECISION: readonly (readonly [RerunDecision, RerunInput])[] = [
  ['already-assessed', input()],
  ['pending', input({ head: MOVED_HEAD, rows: PENDING_ROWS })],
  ['assess', input({ head: MOVED_HEAD })],
  ['green', input({ head: MOVED_HEAD, rows: GREEN_ROWS })],
];

describe('the decision set', () => {
  it('provokes every decision the module declares, and no decision it does not', () => {
    const produced = EVERY_DECISION.map(([, one]) => decisionOf(one));

    expect([...new Set(produced)].sort()).toEqual([...RERUN_DECISIONS].sort());
    expect(produced.every((one) => isRerunDecision(one))).toBe(true);
  });

  it('reaches from each labelled input exactly the decision it is labelled with', () => {
    for (const [expected, one] of EVERY_DECISION) expect(decisionOf(one)).toBe(expected);
  });

  it('gives every decision a headline, and assesses only where it said it would', () => {
    for (const [expected, one] of EVERY_DECISION) {
      const read = readTriageRerun(one);

      expect(read.headline.length).toBeGreaterThan(0);
      expect(read.assesses).toBe(expected === 'assess');
      expect(read.write === 'none').toBe(expected !== 'assess');
    }
  });
});

describe('a stored triage at the pull requests own head', () => {
  it('assesses nothing, writes nothing, and says when it was assessed', () => {
    const read = readTriageRerun(input());

    expect(read.decision).toBe('already-assessed');
    expect(read.assesses).toBe(false);
    expect(read.write).toBe('none');
    expect(read.sameHead).toBe(true);
    expect(read.storedAt).toBe(STORED_AT);
    expect(read.headline).toContain(`already assessed at ${STORED_AT}`);
    expect(read.block?.class).toBe('ci-test');
    expect(read.problems).toEqual([]);
  });

  it('does not read that way once the head has moved, from the same stored comment', () => {
    const read = readTriageRerun(input({ head: MOVED_HEAD }));

    expect(read.decision).not.toBe('already-assessed');
    expect(read.sameHead).toBe(false);
  });

  it('outranks green, so a re-run at the stored head shows the stored triage', () => {
    const read = readTriageRerun(input({ rows: GREEN_ROWS }));

    expect(read.decision).toBe('already-assessed');
    expect(read.verdict).toBe('green');
    expect(read.assesses).toBe(false);
  });

  it('falls back to the comments own time when the block records none', () => {
    const body = storedBody(STORED_HEAD).replace(`at: "${STORED_AT}"\n`, '');
    const read = readTriageRerun(input({ comment: comment(body) }));

    expect(read.decision).toBe('already-assessed');
    expect(read.storedAt).toBe(COMMENT_AT);
    expect(read.problems).toEqual([]);
  });
});

describe('a moved head with a check still running', () => {
  it('assesses nothing, writes nothing, and stands on the stored triage', () => {
    const read = readTriageRerun(input({ head: MOVED_HEAD, rows: PENDING_ROWS }));

    expect(read.decision).toBe('pending');
    expect(read.assesses).toBe(false);
    expect(read.write).toBe('none');
    expect(read.verdict).toBe('pending');
    expect(read.comment?.id).toBe('IC_kwDOA1');
    expect(read.headline).toContain('1 check of 2 still running');
    expect(read.headline).toContain(STORED_AT);
  });

  it('is not reached with no stored triage, so a first run still assesses', () => {
    const read = readTriageRerun(input({ comment: null, head: MOVED_HEAD, rows: PENDING_ROWS }));

    expect(read.decision).toBe('assess');
    expect(read.assesses).toBe(true);
    expect(read.write).toBe('post');
    expect(read.verdict).toBe('pending');
    expect(read.storedAt).toBeNull();
  });
});

describe('a moved head with nothing pending and no green', () => {
  it('assesses again and edits the comment that is already there', () => {
    const read = readTriageRerun(input({ head: MOVED_HEAD }));

    expect(read.decision).toBe('assess');
    expect(read.assesses).toBe(true);
    expect(read.write).toBe('edit');
    expect(read.verdict).toBe('red');
    expect(read.headline).toContain('assessing again');
    expect(read.headline).toContain('editing the triage comment');
  });

  it('assesses a conflicting pull request, which reports no checks at all', () => {
    const read = readTriageRerun(input({ head: MOVED_HEAD, rows: [] }));

    expect(read.decision).toBe('assess');
    expect(read.verdict).toBe('none');
    expect(read.headline).toContain('reports no checks at all');
  });

  it('assesses but writes nothing under --no-comment, still reading the stored comment', () => {
    const read = readTriageRerun(input({ head: MOVED_HEAD, noComment: true }));

    expect(read.decision).toBe('assess');
    expect(read.assesses).toBe(true);
    expect(read.write).toBe('none');
    expect(read.block?.head).toBe(STORED_HEAD);
    expect(read.headline).toContain('writing no comment');
  });
});

describe('a green pull request', () => {
  it('says green, assesses nothing and leaves a pull request with no comment uncommented', () => {
    const read = readTriageRerun(input({ comment: null, head: MOVED_HEAD, rows: GREEN_ROWS }));

    expect(read.decision).toBe('green');
    expect(read.assesses).toBe(false);
    expect(read.write).toBe('none');
    expect(read.block).toBeNull();
    expect(read.headline).toContain('is green');
    expect(read.headline).toContain('1 check');
  });
});

describe('the stored head', () => {
  it('reads an unusable head as moved, and names what was wrong with it', () => {
    const unquoted = storedBody(DIGIT_HEAD).replace(`head: "${DIGIT_HEAD}"`, `head: ${DIGIT_HEAD}`);
    const read = readTriageRerun(input({ comment: comment(unquoted), head: DIGIT_HEAD }));

    expect(read.decision).toBe('assess');
    expect(read.sameHead).toBe(false);
    expect(read.block?.head).toBeNull();
    expect(read.problems.join('\n')).toContain('head is');
  });

  it('reads the same sha stored quoted as the same head, which is the control', () => {
    const read = readTriageRerun(input({ comment: storedAt(DIGIT_HEAD), head: DIGIT_HEAD }));

    expect(read.decision).toBe('already-assessed');
    expect(read.block?.head).toBe(DIGIT_HEAD);
    expect(read.problems).toEqual([]);
  });

  it('reads a comment with no triage block at all as moved, and says so', () => {
    const read = readTriageRerun(input({ comment: comment(`${TRIAGE_MARKER}\nassessed by hand\n`) }));

    expect(read.decision).toBe('assess');
    expect(read.block).toBeNull();
    expect(read.problems.length).toBe(1);
    expect(read.write).toBe('edit');
  });

  it('counts an abbreviation from the length floor up, and nothing shorter', () => {
    const long = STORED_HEAD.slice(0, SHORT_HEAD_LENGTH);
    const short = STORED_HEAD.slice(0, SHORT_HEAD_LENGTH - 1);

    expect(isSameHead(long, STORED_HEAD)).toBe(true);
    expect(isSameHead(short, STORED_HEAD)).toBe(false);
    expect(decisionOf(input({ comment: storedAt(long) }))).toBe('already-assessed');
    expect(decisionOf(input({ comment: storedAt(short) }))).toBe('assess');
  });

  it('folds case, and refuses a null, an empty and a non-prefix head', () => {
    expect(isSameHead(STORED_HEAD.toUpperCase(), STORED_HEAD)).toBe(true);
    expect(isSameHead(` ${STORED_HEAD} `, STORED_HEAD)).toBe(true);
    expect(isSameHead(null, STORED_HEAD)).toBe(false);
    expect(isSameHead('   ', STORED_HEAD)).toBe(false);
    expect(isSameHead(MOVED_HEAD, STORED_HEAD)).toBe(false);
    expect(isSameHead(STORED_HEAD, '')).toBe(false);
  });
});

describe('the decision vocabulary', () => {
  it('is frozen, and recognises its own words and no others', () => {
    expect(Object.isFrozen(RERUN_DECISIONS)).toBe(true);
    expect(RERUN_DECISIONS.every((one) => isRerunDecision(one))).toBe(true);
    expect(isRerunDecision('assessed')).toBe(false);
    expect(isRerunDecision(2)).toBe(false);
  });
});
