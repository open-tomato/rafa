/**
 * Tests for the spec-review parser (`src/board/spec-review.ts`): the
 * four readings a plan session's captured output answers, which block
 * of several is read, how the verdict is matched, what becomes of a
 * gap that cannot be read, and whether a gap is read as blocking.
 *
 * The parser is pure: a string in, a reading out. The drift guard is
 * what reaches outside it, reading `src/plan-prompt.md`, because two
 * things are only right while the prompt asks for them: WHICH block is
 * read, and the two fields a gap carries beside `heading` and `what`.
 * No case plants a seam, reaches a home directory or spawns a session.
 *
 * A gate like this passes for the wrong reason in two opposite ways,
 * and both have a case here:
 *
 *  - A parser answering NOT-READY for everything satisfies three of the
 *    four answers. So {@link readyOutput} is asserted to answer `ready`
 *    with `ready` true and no gap, and every negative case is built by
 *    breaking exactly one thing in that same output.
 *  - A parser answering READY for everything satisfies the fourth. So
 *    each of `not-ready`, `absent` and `malformed` asserts `ready`
 *    false as well as its own answer, since `ready` is what the gate
 *    acts on and the answer is only what an operator reads.
 *
 * Thirteen mutations of `spec-review.ts` were driven against this file
 * on 2026-09-20, one at a time, the module restored from a scratch copy
 * and verified by `shasum` after each. 24 pass either side — the 24
 * cases the file held that day, before `blocking` and `assumption` were
 * read — and each count below is that run's own, not re-measured since:
 *
 *  - `parseSpecReview` answering a ready reading for every input: 18
 *    fail.
 *  - `unreadable` answering `ready: true`, so a session that returned
 *    nothing readable plans anyway: 4 fail, the four cases that assert
 *    `ready` beside the answer. The other absent and malformed cases
 *    read the answer alone, which is why those four are written.
 *  - the absent branch answering `malformed`, so a missing block and an
 *    unreadable one read alike: 3 fail. They are separate answers
 *    because a session that wrote no block and one that wrote a broken
 *    block are different things to diagnose.
 *  - the unclosed-block check dropped, so a truncated block is parsed:
 *    1 fail.
 *  - the mapping check dropped, so a null body reaches the verdict
 *    read: 1 fail. That mutation makes the parser THROW, which the
 *    empty-body case catches; a list body still answers malformed at
 *    the verdict, one step later.
 *  - an unreadable verdict defaulting to not-ready rather than
 *    malformed: 2 fail. Both cases assert the ANSWER, not just `ready`,
 *    because a misspelled verdict and a judged one reach the same gate
 *    and read differently in a log.
 *  - the verdict normalisation dropped for an exact match: 1 fail, the
 *    dressed verdict.
 *  - the FIRST `rafa:spec-review` block read instead of the last: 2
 *    fail, the output whose real review follows a quoted format and the
 *    one whose second block revises the first.
 *  - `readGaps` answering an empty list always: 6 fail.
 *  - the {@link UNNAMED_GAP} fallback dropped, so a not-ready verdict
 *    can carry nothing to post: 2 fail.
 *  - a gap whose `what` is unusable kept rather than dropped: 1 fail.
 *  - a gap whose `heading` is unusable dropped rather than filed under
 *    {@link REVIEW_HEADING}: 1 fail.
 *  - every issue's `field` renamed, standing for an issue recorded in
 *    the wrong place: 3 fail.
 *
 * Four more mutations were driven on 2026-09-22, for `blocking` and
 * `assumption`, the same way: 34 pass either side, and each fails
 * exactly the two cases named:
 *
 *  - an unreadable `blocking` read as NON-blocking rather than
 *    blocking, which is the direction that would let a plan stand over
 *    a question nobody answered: the absent-`blocking` case and the
 *    neither-true-nor-false one.
 *  - `blocking` read leniently, as `Boolean(value)` with nothing
 *    reported, the leniency the verdict gets: the same two. They assert
 *    the issue's `field` as well as the flag, which is what separates a
 *    value read for its truthiness from one refused.
 *  - the fallback dropped for a non-blocking gap that names no
 *    assumption, so it stays non-blocking with nothing to plan under:
 *    the missing-assumption case and the blank-assumption one.
 *  - `assumption` never read, always null: the case reading a blocking
 *    gap beside a non-blocking one, and the case keeping an assumption
 *    written beside a blocking gap.
 *
 * The drift guard is not one of those seventeen: no mutation of the
 * module can redden it, since what it reads is the prompt. Its controls
 * are the cases beside it, one rewriting the prompt's ask back to the
 * opening one this parser was written for before 2026-09-20, the other
 * back to the `{heading, what}` gap it read before 2026-09-22, each
 * asserting the guard it belongs to answers false while the other still
 * answers true.
 *
 * Both guards match SUBSTRINGS of the prompt, so rewrapping a prompt
 * sentence across a line break reddens them: that is how the widened
 * ask was first written, and the guard caught it. A prompt edit keeps
 * each quoted clause on one line.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'bun:test';

import {
  MISSING_REVIEW_GAP,
  parseSpecReview,
  REVIEW_HEADING,
  SPEC_REVIEW_ANSWERS,
  SPEC_REVIEW_VERDICTS,
  UNNAMED_GAP,
} from './spec-review.js';

/** A session output whose review block holds `body`, with prose around it. */
function outputWith(body: string): string {
  return `I read the spec before planning.\n\n\`\`\`rafa:spec-review\n${body}\n\`\`\`\n\n`
    + 'Then the plan follows.\n';
}

/** The output of a session that judged the spec ready; every case breaks this one. */
const readyOutput = outputWith('verdict: ready\ngaps: []');

/** The plan prompt as shipped, read for the ask this parser depends on. */
const PLAN_PROMPT = readFileSync(new URL('../plan-prompt.md', import.meta.url), 'utf8');

/** The fence the prompt names the block by. */
const SPEC_REVIEW_FENCE = 'rafa:spec-review';

/** The clause placing the block at the end of the session's final message. */
const ASK_AT_END = 'END of your final message as a';

/** The sentence spelling out that nothing follows the block. */
const ASK_IS_LAST = 'The block is the LAST thing you write';

/** The clause asking every gap for the flag the parser reads it by. */
const ASK_BLOCKING = '`blocking: true` or `blocking: false`';

/** The clause asking a non-blocking gap for the assumption to plan under. */
const ASK_ASSUMPTION = 'carries the `assumption:` you would plan under';

/** The sentence telling the session which gaps are blocking. */
const ASK_WHEN_BLOCKING = 'A gap is blocking when guessing wrong';

/** True when `prompt` asks for the review block at the end of the final message. */
function asksForTheBlockLast(prompt: string): boolean {
  return prompt.includes(SPEC_REVIEW_FENCE)
    && prompt.includes(ASK_AT_END)
    && prompt.includes(ASK_IS_LAST);
}

/**
 * True when `prompt` asks each gap for both fields this parser reads
 * beside `heading` and `what`, and says when a gap is blocking.
 */
function asksForBlockingAndAssumption(prompt: string): boolean {
  return prompt.includes(ASK_BLOCKING)
    && prompt.includes(ASK_ASSUMPTION)
    && prompt.includes(ASK_WHEN_BLOCKING);
}

/** Every gap of `output` as `<heading>: <what>`, in the order it answers them. */
function gapsIn(output: string): readonly string[] {
  return parseSpecReview(output).gaps.map((gap) => `${gap.heading}: ${gap.what}`);
}

describe('the two words a verdict is spelled with', () => {
  it('are the spec names, and the four answers carry them plus the two failures', () => {
    expect(SPEC_REVIEW_VERDICTS).toEqual(['ready', 'not-ready']);
    expect(SPEC_REVIEW_ANSWERS).toEqual(['ready', 'not-ready', 'absent', 'malformed']);
  });
});

describe('a ready verdict', () => {
  it('answers ready, with nothing to post and nothing left unread', () => {
    const reading = parseSpecReview(readyOutput);

    expect(reading.answer).toBe('ready');
    expect(reading.ready).toBe(true);
    expect(reading.gaps).toEqual([]);
    expect(reading.issues).toEqual([]);
  });

  it('names the block it was read from, so a session can be diagnosed', () => {
    const reading = parseSpecReview(readyOutput);

    expect(reading.block?.kind).toBe('spec-review');
    expect(reading.block?.span.first).toBe(3);
    expect(reading.text).toBe('the rafa:spec-review block at line 3 judged the spec ready');
  });

  it('is read through the case and the spacing a session may dress it in', () => {
    expect(parseSpecReview(outputWith('verdict: READY')).ready).toBe(true);
    expect(parseSpecReview(outputWith('verdict: " Ready "')).ready).toBe(true);
    expect(parseSpecReview(outputWith('verdict: Not_Ready')).answer).toBe('not-ready');
    expect(parseSpecReview(outputWith('verdict: "NOT READY"')).answer).toBe('not-ready');
  });

  it('is read from the LAST block, not an earlier one quoting the format', () => {
    const drafted = '```rafa:spec-review\nverdict: not-ready\n```\n\n'
      + 'That was the format; here is the review.\n\n'
      + readyOutput;

    expect(parseSpecReview(drafted).answer).toBe('ready');
  });

  it('gives way to a not-ready block written after it, which the session meant', () => {
    const revised = `${readyOutput}\n\`\`\`rafa:spec-review\nverdict: not-ready\n\`\`\`\n`;
    const reading = parseSpecReview(revised);

    expect(reading.answer).toBe('not-ready');
    expect(reading.ready).toBe(false);
  });

  it('carries whatever gaps a ready verdict still names, without refusing it', () => {
    const body = 'verdict: ready\ngaps:\n  - heading: "Design"\n    what: "one name is odd"\n'
      + '    blocking: false\n    assumption: "the name in the spec is the one that ships"';

    expect(parseSpecReview(outputWith(body)).ready).toBe(true);
    expect(gapsIn(outputWith(body))).toEqual(['Design: one name is odd']);
  });
});

describe('a not-ready verdict', () => {
  it('answers not-ready, carrying every gap the session named, in order', () => {
    const body = 'verdict: not-ready\ngaps:\n'
      + '  - heading: "Definition of done"\n'
      + '    what: "no item says how the merge clean-up is verified"\n'
      + '    blocking: true\n'
      + '  - heading: "Tasks the plan must carry"\n'
      + '    what: "the third task names no file"\n'
      + '    blocking: true';
    const reading = parseSpecReview(outputWith(body));

    expect(reading.answer).toBe('not-ready');
    expect(reading.ready).toBe(false);
    expect(reading.issues).toEqual([]);
    expect(reading.gaps).toEqual([
      {
        heading: 'Definition of done',
        what: 'no item says how the merge clean-up is verified',
        blocking: true,
        assumption: null,
      },
      {
        heading: 'Tasks the plan must carry',
        what: 'the third task names no file',
        blocking: true,
        assumption: null,
      },
    ]);
    expect(reading.text).toBe(
      'the rafa:spec-review block at line 3 judged the spec not ready, naming 2 gaps',
    );
  });

  it('is given a gap of its own when the session named none to post', () => {
    const reading = parseSpecReview(outputWith('verdict: not-ready\ngaps: []'));

    expect(reading.answer).toBe('not-ready');
    expect(reading.ready).toBe(false);
    expect(reading.gaps).toEqual([UNNAMED_GAP]);
    expect(reading.text).toBe(
      'the rafa:spec-review block at line 3 judged the spec not ready, naming 1 gap',
    );
  });

  it('drops a gap that says nothing, and reports where it was written', () => {
    const body = 'verdict: not-ready\ngaps:\n'
      + '  - heading: "Design"\n'
      + '  - "Design is thin"\n'
      + '  - heading: "Design"\n'
      + '    what: "the store port is not named"\n'
      + '    blocking: true';
    const reading = parseSpecReview(outputWith(body));

    expect(reading.gaps).toEqual([
      { heading: 'Design', what: 'the store port is not named', blocking: true, assumption: null },
    ]);
    expect(reading.issues.map((issue) => issue.field)).toEqual(['gaps[0].what', 'gaps[1]']);
  });

  it('files a gap with no usable heading under the review, rather than losing it', () => {
    const body = 'verdict: not-ready\ngaps:\n  - what: "nothing says what is verified"\n'
      + '    blocking: true';
    const reading = parseSpecReview(outputWith(body));

    expect(reading.gaps).toEqual([
      { heading: REVIEW_HEADING, what: 'nothing says what is verified', blocking: true, assumption: null },
    ]);
    expect(reading.issues.map((issue) => issue.field)).toEqual(['gaps[0].heading']);
  });

  it('reads no gap from a gaps key that is not a list, and reports it', () => {
    const reading = parseSpecReview(outputWith('verdict: not-ready\ngaps: several'));

    expect(reading.gaps).toEqual([UNNAMED_GAP]);
    expect(reading.issues.map((issue) => issue.field)).toEqual(['gaps']);
  });

  it('ignores a key it does not know, so a later phase does not break this one', () => {
    const body = 'verdict: not-ready\nconfidence: low\ngaps:\n'
      + '  - heading: "Design"\n    what: "thin"\n    blocking: true\n      \n';
    const reading = parseSpecReview(outputWith(body.trimEnd()));

    expect(reading.answer).toBe('not-ready');
    expect(reading.issues).toEqual([]);
    expect(gapsIn(outputWith(body.trimEnd()))).toEqual(['Design: thin']);
  });
});

describe('the blocking flag on a gap and the assumption beside it', () => {
  it('reads a blocking gap and a non-blocking one, each as the session wrote it', () => {
    const body = 'verdict: not-ready\ngaps:\n'
      + '  - heading: "Definition of done"\n'
      + '    what: "no item says how the clean-up is shown"\n'
      + '    blocking: true\n'
      + '  - heading: "Design"\n'
      + '    what: "the store backend is not named"\n'
      + '    blocking: false\n'
      + '    assumption: "the SQLite backend, as every other command reads"';
    const reading = parseSpecReview(outputWith(body));

    expect(reading.issues).toEqual([]);
    expect(reading.gaps).toEqual([
      {
        heading: 'Definition of done',
        what: 'no item says how the clean-up is shown',
        blocking: true,
        assumption: null,
      },
      {
        heading: 'Design',
        what: 'the store backend is not named',
        blocking: false,
        assumption: 'the SQLite backend, as every other command reads',
      },
    ]);
  });

  it('reads a gap that names no blocking as blocking, and reports where it was written', () => {
    const body = 'verdict: not-ready\ngaps:\n'
      + '  - heading: "Design"\n    what: "the store backend is not named"';
    const reading = parseSpecReview(outputWith(body));

    expect(reading.gaps).toEqual([
      {
        heading: 'Design',
        what: 'the store backend is not named',
        blocking: true,
        assumption: null,
      },
    ]);
    expect(reading.issues.map((issue) => issue.field)).toEqual(['gaps[0].blocking']);
    expect(reading.issues[0]?.text).toBe(
      'gaps[0].blocking is nothing, not true or false; the gap is read as blocking',
    );
  });

  it('reads a blocking that is neither true nor false as blocking, however it is spelled', () => {
    const gap = (blocking: string): string => 'verdict: not-ready\ngaps:\n'
      + `  - heading: "Design"\n    what: "the backend is not named"\n    blocking: ${blocking}`;

    expect(parseSpecReview(outputWith(gap('"false"'))).gaps[0]?.blocking).toBe(true);
    expect(parseSpecReview(outputWith(gap('maybe'))).gaps[0]?.blocking).toBe(true);
    expect(parseSpecReview(outputWith(gap('0'))).gaps[0]?.blocking).toBe(true);
    expect(parseSpecReview(outputWith(gap('maybe'))).issues[0]?.text).toBe(
      'gaps[0].blocking is "maybe", not true or false; the gap is read as blocking',
    );
    expect(parseSpecReview(outputWith(gap('0'))).issues.map((issue) => issue.field))
      .toEqual(['gaps[0].blocking']);
  });

  it('reads a non-blocking gap that names no assumption as blocking, rather than guessing one', () => {
    const body = 'verdict: not-ready\ngaps:\n'
      + '  - heading: "Design"\n    what: "the store backend is not named"\n    blocking: false';
    const reading = parseSpecReview(outputWith(body));

    expect(reading.gaps).toEqual([
      {
        heading: 'Design',
        what: 'the store backend is not named',
        blocking: true,
        assumption: null,
      },
    ]);
    expect(reading.issues.map((issue) => issue.field)).toEqual(['gaps[0].assumption']);
    expect(reading.issues[0]?.text).toBe(
      'gaps[0].assumption is nothing, not what a non-blocking gap would be planned under; '
        + 'the gap is read as blocking',
    );
  });

  it('reads a blank assumption the same way, so no plan opens under an empty line', () => {
    const body = 'verdict: not-ready\ngaps:\n'
      + '  - heading: "Design"\n    what: "the backend is not named"\n'
      + '    blocking: false\n    assumption: "   "';
    const reading = parseSpecReview(outputWith(body));

    expect(reading.gaps[0]?.blocking).toBe(true);
    expect(reading.gaps[0]?.assumption).toBeNull();
    expect(reading.issues.map((issue) => issue.field)).toEqual(['gaps[0].assumption']);
  });

  it('keeps an assumption written beside a blocking gap, rather than dropping it', () => {
    const body = 'verdict: not-ready\ngaps:\n'
      + '  - heading: "Design"\n    what: "the backend is not named"\n'
      + '    blocking: true\n    assumption: "the SQLite backend"';
    const reading = parseSpecReview(outputWith(body));

    expect(reading.issues).toEqual([]);
    expect(reading.gaps[0]?.blocking).toBe(true);
    expect(reading.gaps[0]?.assumption).toBe('the SQLite backend');
  });

  it('refuses both gaps a reading of its own with the same flag, so neither plans itself', () => {
    expect(MISSING_REVIEW_GAP.blocking).toBe(true);
    expect(MISSING_REVIEW_GAP.assumption).toBeNull();
    expect(UNNAMED_GAP.blocking).toBe(true);
    expect(UNNAMED_GAP.assumption).toBeNull();
  });
});

describe('an absent block', () => {
  it('answers absent and not ready, with the gap the spec names', () => {
    const reading = parseSpecReview('Here is the plan. No review was written.\n');

    expect(reading.answer).toBe('absent');
    expect(reading.ready).toBe(false);
    expect(reading.gaps).toEqual([MISSING_REVIEW_GAP]);
    expect(reading.gaps[0]?.what).toBe('the review block was not returned');
    expect(reading.block).toBeNull();
    expect(reading.text).toBe('the session output holds no rafa:spec-review block');
  });

  it('is the answer for an empty output and for a block of another kind', () => {
    expect(parseSpecReview('').answer).toBe('absent');
    expect(parseSpecReview('```rafa:plan\nstub: rafa-20\n```\n').answer).toBe('absent');
  });

  it('is the answer when the only block sits inside a longer fence, quoting it', () => {
    const quoting = '````markdown\n```rafa:spec-review\nverdict: ready\n```\n````\n';

    expect(parseSpecReview(quoting).answer).toBe('absent');
  });
});

describe('a malformed block', () => {
  it('answers malformed and not ready when the body is not YAML', () => {
    const reading = parseSpecReview(outputWith('verdict: [not-ready'));

    expect(reading.answer).toBe('malformed');
    expect(reading.ready).toBe(false);
    expect(reading.gaps).toEqual([MISSING_REVIEW_GAP]);
    expect(reading.block?.body).toBe('verdict: [not-ready');
    expect(reading.text).toContain('the rafa:spec-review block at line 3 is not valid YAML');
  });

  it('answers malformed for a body that parses to no mapping of fields', () => {
    expect(parseSpecReview(outputWith('- ready')).answer).toBe('malformed');
    expect(parseSpecReview(outputWith('')).answer).toBe('malformed');
    expect(parseSpecReview(outputWith('')).text).toContain('not a mapping of verdict and gaps');
  });

  it('answers malformed for a verdict that is neither word, rather than judging it', () => {
    const reading = parseSpecReview(outputWith('verdict: maybe\ngaps: []'));

    expect(reading.answer).toBe('malformed');
    expect(reading.ready).toBe(false);
    expect(reading.text).toContain('has a verdict of "maybe", not one of ready, not-ready');
  });

  it('answers malformed for a missing verdict, however many gaps sit beside it', () => {
    const body = 'gaps:\n  - heading: "Design"\n    what: "thin"';
    const reading = parseSpecReview(outputWith(body));

    expect(reading.answer).toBe('malformed');
    expect(reading.gaps).toEqual([MISSING_REVIEW_GAP]);
    expect(reading.text).toContain('has a verdict of nothing');
  });

  it('answers malformed for a block the session never closed, and does not read it', () => {
    const cut = 'I read the spec.\n\n```rafa:spec-review\nverdict: ready\n';
    const reading = parseSpecReview(cut);

    expect(reading.answer).toBe('malformed');
    expect(reading.ready).toBe(false);
    expect(reading.block?.closed).toBe(false);
    expect(reading.text).toContain('is never closed');
  });
});

describe('the drift guard between the prompt and this parser', () => {
  it('finds the plan prompt asking for the block at the END of the final message', () => {
    expect(asksForTheBlockLast(PLAN_PROMPT)).toBe(true);
  });

  it('proves that guard fails on a prompt asking for the block first', () => {
    const opening = PLAN_PROMPT.replace(ASK_AT_END, 'open your answer with a')
      .replace(ASK_IS_LAST, 'The block is the FIRST thing you write');

    expect(asksForTheBlockLast(opening)).toBe(false);
    expect(opening).toContain(SPEC_REVIEW_FENCE);
  });

  it('finds no ask left in the prompt for a block that opens the answer', () => {
    expect(PLAN_PROMPT).not.toContain('open your answer with');
  });

  it('finds the prompt asking each gap for blocking, and a non-blocking one for its assumption', () => {
    expect(asksForBlockingAndAssumption(PLAN_PROMPT)).toBe(true);
  });

  it('proves that guard fails on the narrower ask of a heading and a what alone', () => {
    const narrow = PLAN_PROMPT.replace(ASK_BLOCKING, 'nothing else')
      .replace(ASK_ASSUMPTION, 'carries no more')
      .replace(ASK_WHEN_BLOCKING, 'Judge the spec as a whole');

    expect(asksForBlockingAndAssumption(narrow)).toBe(false);
    expect(narrow).toContain(SPEC_REVIEW_FENCE);
    expect(asksForTheBlockLast(narrow)).toBe(true);
  });

  it('finds no ask left in the prompt for the gap shape this parser outgrew', () => {
    expect(PLAN_PROMPT).not.toContain('`{heading, what}` gaps');
  });
});
