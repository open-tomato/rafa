/**
 * Tests for the spec-review parser (`src/board/spec-review.ts`): the
 * four readings a plan session's captured output answers, which block
 * of several is read, how the verdict is matched, and what becomes of a
 * gap that cannot be read.
 *
 * The parser is pure: a string in, a reading out. No case plants a
 * seam, opens a file, reaches a home directory or spawns a session.
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
 * on 2026-09-19, one at a time, the module restored from a scratch copy
 * and verified with `shasum -c` after each. 20 pass either side, and
 * each count below is that run's own:
 *
 *  - `parseSpecReview` answering a ready reading for every input: 17
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
 *  - the LAST `rafa:spec-review` block read instead of the first: 1
 *    fail, the output with a second block quoting the format.
 *  - `readGaps` answering an empty list always: 6 fail.
 *  - the {@link UNNAMED_GAP} fallback dropped, so a not-ready verdict
 *    can carry nothing to post: 2 fail.
 *  - a gap whose `what` is unusable kept rather than dropped: 1 fail.
 *  - a gap whose `heading` is unusable dropped rather than filed under
 *    {@link REVIEW_HEADING}: 1 fail.
 *  - every issue's `field` renamed, standing for an issue recorded in
 *    the wrong place: 3 fail.
 */
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

  it('is read from the FIRST block, not a later one quoting the format', () => {
    const quoted = `${readyOutput}\n\`\`\`rafa:spec-review\nverdict: not-ready\n\`\`\`\n`;

    expect(parseSpecReview(quoted).answer).toBe('ready');
  });

  it('carries whatever gaps a ready verdict still names, without refusing it', () => {
    const body = 'verdict: ready\ngaps:\n  - heading: "Design"\n    what: "one name is odd"';

    expect(parseSpecReview(outputWith(body)).ready).toBe(true);
    expect(gapsIn(outputWith(body))).toEqual(['Design: one name is odd']);
  });
});

describe('a not-ready verdict', () => {
  it('answers not-ready, carrying every gap the session named, in order', () => {
    const body = 'verdict: not-ready\ngaps:\n'
      + '  - heading: "Definition of done"\n'
      + '    what: "no item says how the merge clean-up is verified"\n'
      + '  - heading: "Tasks the plan must carry"\n'
      + '    what: "the third task names no file"';
    const reading = parseSpecReview(outputWith(body));

    expect(reading.answer).toBe('not-ready');
    expect(reading.ready).toBe(false);
    expect(reading.issues).toEqual([]);
    expect(reading.gaps).toEqual([
      { heading: 'Definition of done', what: 'no item says how the merge clean-up is verified' },
      { heading: 'Tasks the plan must carry', what: 'the third task names no file' },
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
      + '    what: "the store port is not named"';
    const reading = parseSpecReview(outputWith(body));

    expect(reading.gaps).toEqual([{ heading: 'Design', what: 'the store port is not named' }]);
    expect(reading.issues.map((issue) => issue.field)).toEqual(['gaps[0].what', 'gaps[1]']);
  });

  it('files a gap with no usable heading under the review, rather than losing it', () => {
    const body = 'verdict: not-ready\ngaps:\n  - what: "nothing says what is verified"';
    const reading = parseSpecReview(outputWith(body));

    expect(reading.gaps).toEqual([
      { heading: REVIEW_HEADING, what: 'nothing says what is verified' },
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
      + '  - heading: "Design"\n    what: "thin"\n      \n';
    const reading = parseSpecReview(outputWith(body.trimEnd()));

    expect(reading.answer).toBe('not-ready');
    expect(reading.issues).toEqual([]);
    expect(gapsIn(outputWith(body.trimEnd()))).toEqual(['Design: thin']);
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
