/**
 * Tests for the three review stamps (`src/board/review-stamp.ts`): where
 * the line lands, what it replaces, which plans it leaves alone, and
 * the assumptions section the gate opens a plan with beside the
 * `assumed` line.
 *
 * The section's text is pinned HERE and nowhere else: `./gate.test.ts`
 * drives the same section through a file and asserts its heading, its
 * items and the plan below it, so a reworded preamble moves one
 * expectation rather than two.
 *
 * Every case is a pure call over a literal plan; nothing here touches a
 * file. The assertions are on the WHOLE text rather than on a substring
 * wherever a byte outside the block could move, because the one failure
 * a stamp can hide is reformatting the plan around the line it added:
 * a case asserting only that `review: skipped` is in there would pass
 * over a rewritten document.
 *
 * The round trip is asserted too, through `parsePlan`: the field is not
 * one of `PLAN_HEADER_FIELDS`, so what the reader must do with it is
 * keep it as an extra, and a stamp the reader refused would be a record
 * nothing can read. All three values are round-tripped, `skipped`, the
 * `missing` the gate's unread reading leaves behind and the `assumed`
 * it writes over a review of none but non-blocking gaps, because each
 * is written bare and the reader has to hand back the word and not a
 * retyped value.
 *
 * `stampReviewMissing`'s and `stampReviewAssumed`'s own cases are the
 * ones where each must differ from `stampReviewSkipped` — the value it
 * writes, and the value it replaces — rather than the whole file over
 * again: all three go through `stampPlanField`, whose placing is held
 * by the cases above and by `./plan-field.test.ts`.
 *
 * One mutation of `review-stamp.ts` was driven on 2026-09-19 over
 * `env -u CLAUDECODE bun test src/board/ src/plan.test.ts`, the module
 * restored from a scratch copy and verified with `shasum -c`: the line
 * inserted under the OPENING fence rather than above the closing one
 * left 192 pass and 5 fail against 197 pass either side — the four
 * cases here that assert the whole text (the insert, the CRLF plan, the
 * nested key and the second block) and the `--skip-review` case in
 * `src/plan.test.ts`.
 */
import type { SpecReviewGap } from './spec-review.js';

import { describe, expect, it } from 'bun:test';

import { parsePlan } from '../plan/parse.js';

import {
  ASSUMPTIONS_HEADING,
  assumptionsHeading,
  REVIEW_ASSUMED_LINE,
  REVIEW_MISSING_LINE,
  REVIEW_SKIPPED_LINE,
  stampReviewAssumed,
  stampReviewMissing,
  stampReviewSkipped,
} from './review-stamp.js';

/** A plan document holding `lines`, each on its own line. */
function doc(...lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

/** The ordinary plan a session writes: a title, the header block, a task. */
const PLAN = doc(
  '# Plan: rafa-20',
  '',
  '```rafa:plan',
  'stub: rafa-20',
  'spec: .specs/rafa-20.md',
  '```',
  '',
  '- [ ] Do the thing',
);

/** One gap the planner planned under, as `./spec-review.ts` answers one. */
const ASSUMED_GAP: SpecReviewGap = {
  heading: 'Design',
  what: 'the store backend is not named',
  blocking: false,
  assumption: 'the SQLite backend, as every other command reads',
};

/** A gap nothing was planned under, as a blocking one comes back. */
const BLOCKING_GAP: SpecReviewGap = {
  heading: 'Definition of done',
  what: 'no item says how the merge clean-up is verified',
  blocking: true,
  assumption: null,
};

describe('stampReviewSkipped', () => {
  it('inserts the line above the closing fence and leaves every other byte alone', () => {
    const stamp = stampReviewSkipped(PLAN);

    expect(stamp.answer).toBe('inserted');
    expect(stamp.recorded).toBe(true);
    expect(stamp.text).toBe(doc(
      '# Plan: rafa-20',
      '',
      '```rafa:plan',
      'stub: rafa-20',
      'spec: .specs/rafa-20.md',
      'review: skipped',
      '```',
      '',
      '- [ ] Do the thing',
    ));
    expect(stamp.note).toContain('line 6');
  });

  it('records a field the plan reader keeps as an extra, beside the fields it reads', () => {
    const model = parsePlan(stampReviewSkipped(PLAN).text);

    expect(model.header.stub).toBe('rafa-20');
    expect(model.header.extras).toEqual([{ key: 'review', value: 'skipped' }]);
    expect(model.issues).toEqual([]);
  });

  it('replaces a review field the block already carries', () => {
    const planned = doc('```rafa:plan', 'review: read', 'stub: rafa-20', '```');

    const stamp = stampReviewSkipped(planned);

    expect(stamp.answer).toBe('replaced');
    expect(stamp.text).toBe(doc('```rafa:plan', REVIEW_SKIPPED_LINE, 'stub: rafa-20', '```'));
  });

  it('changes no byte of a plan that already records it', () => {
    const planned = doc('```rafa:plan', 'stub: rafa-20', 'review: skipped', '```');

    const stamp = stampReviewSkipped(planned);

    expect(stamp).toMatchObject({ answer: 'unchanged', recorded: true, text: planned });
  });

  it('keeps the fence indentation, and the carriage return a CRLF plan ends its lines with', () => {
    const indented = '  ```rafa:plan\r\n  stub: rafa-20\r\n  ```\r\n';

    const stamp = stampReviewSkipped(indented);

    expect(stamp.text).toBe('  ```rafa:plan\r\n  stub: rafa-20\r\n  review: skipped\r\n  ```\r\n');
  });

  it('does not take a review key nested under another field for the field', () => {
    const nested = doc('```rafa:plan', 'stub: rafa-20', 'notes:', '  review: read', '```');

    const stamp = stampReviewSkipped(nested);

    expect(stamp.answer).toBe('inserted');
    expect(stamp.text).toBe(doc('```rafa:plan', 'stub: rafa-20', 'notes:', '  review: read', 'review: skipped', '```'));
  });

  it('records nothing in a plan with no rafa:plan block, or one that is never closed', () => {
    const headerless = doc('# Plan: rafa-20', '', '- [ ] Do the thing');
    const unclosed = doc('# Plan: rafa-20', '```rafa:plan', 'stub: rafa-20');

    const none = stampReviewSkipped(headerless);
    const open = stampReviewSkipped(unclosed);

    expect(none).toMatchObject({ answer: 'no-block', recorded: false, text: headerless });
    expect(none.note).toContain('no rafa:plan block');
    expect(open).toMatchObject({ answer: 'unclosed-block', recorded: false, text: unclosed });
    expect(open.note).toContain('line 2');
    // The control: the same function records in a plan that carries one.
    expect(stampReviewSkipped(PLAN).recorded).toBe(true);
  });

  it('records in the first rafa:plan block, the one the plan reader reads', () => {
    const twice = doc('```rafa:plan', 'stub: first', '```', '```rafa:plan', 'stub: second', '```');

    expect(stampReviewSkipped(twice).text).toBe(doc(
      '```rafa:plan',
      'stub: first',
      REVIEW_SKIPPED_LINE,
      '```',
      '```rafa:plan',
      'stub: second',
      '```',
    ));
  });
});

describe('stampReviewMissing', () => {
  it('writes the missing line where the skipped stamp writes its own', () => {
    const stamp = stampReviewMissing(PLAN);

    expect(stamp.answer).toBe('inserted');
    expect(stamp.text).toBe(doc(
      '# Plan: rafa-20',
      '',
      '```rafa:plan',
      'stub: rafa-20',
      'spec: .specs/rafa-20.md',
      REVIEW_MISSING_LINE,
      '```',
      '',
      '- [ ] Do the thing',
    ));
    expect(REVIEW_MISSING_LINE).toBe('review: missing');
  });

  it('records a word the plan reader hands back as written, beside the fields it reads', () => {
    const model = parsePlan(stampReviewMissing(PLAN).text);

    expect(model.header.stub).toBe('rafa-20');
    expect(model.header.extras).toEqual([{ key: 'review', value: 'missing' }]);
    expect(model.issues).toEqual([]);
  });

  it('replaces a review the block already carries, the skipped one included', () => {
    const skipped = stampReviewSkipped(PLAN).text;

    const stamp = stampReviewMissing(skipped);

    expect(stamp.answer).toBe('replaced');
    expect(stamp.text).toBe(stampReviewMissing(PLAN).text);
  });

  it('records nothing in the plan a session wrote with no rafa:plan block, which is what the gate warns on', () => {
    const headerless = 'written anyway\n';

    const stamp = stampReviewMissing(headerless);

    expect(stamp).toMatchObject({ answer: 'no-block', recorded: false, text: headerless });
    expect(stamp.note).toContain('no rafa:plan block');
  });
});

describe('stampReviewAssumed', () => {
  it('writes the assumed line where the skipped stamp writes its own', () => {
    const stamp = stampReviewAssumed(PLAN);

    expect(stamp.answer).toBe('inserted');
    expect(stamp.text).toBe(doc(
      '# Plan: rafa-20',
      '',
      '```rafa:plan',
      'stub: rafa-20',
      'spec: .specs/rafa-20.md',
      REVIEW_ASSUMED_LINE,
      '```',
      '',
      '- [ ] Do the thing',
    ));
    expect(REVIEW_ASSUMED_LINE).toBe('review: assumed');
  });

  it('records a word the plan reader hands back as written, beside the fields it reads', () => {
    const model = parsePlan(stampReviewAssumed(PLAN).text);

    expect(model.header.stub).toBe('rafa-20');
    expect(model.header.extras).toEqual([{ key: 'review', value: 'assumed' }]);
    expect(model.issues).toEqual([]);
  });

  it('replaces a review the block already carries, the missing one included', () => {
    const missing = stampReviewMissing(PLAN).text;

    const stamp = stampReviewAssumed(missing);

    expect(stamp.answer).toBe('replaced');
    expect(stamp.text).toBe(stampReviewAssumed(PLAN).text);
  });

  it('records nothing in a plan with no rafa:plan block', () => {
    const headerless = 'written anyway\n';

    const stamp = stampReviewAssumed(headerless);

    expect(stamp).toMatchObject({ answer: 'no-block', recorded: false, text: headerless });
    expect(stamp.note).toContain('no rafa:plan block');
    // The control: the same function records in a plan that carries one.
    expect(stampReviewAssumed(PLAN).recorded).toBe(true);
  });
});

describe('assumptionsHeading', () => {
  it('opens with the heading and carries one item per gap with the assumption under it', () => {
    const section = assumptionsHeading([ASSUMED_GAP]);

    expect(section).toBe(doc(
      ASSUMPTIONS_HEADING,
      '',
      'The spec review found gaps, none of them blocking, so this plan was',
      'written under the assumptions below. Each names the gap it was',
      'written for; closing that gap in the spec is what replaces the guess.',
      '',
      '- **Design** — the store backend is not named',
      '  - Planned under: the SQLite backend, as every other command reads',
      '',
    ));
  });

  it('ends on a blank line, so the plan it opens reads exactly as it did', () => {
    const opened = `${assumptionsHeading([ASSUMED_GAP])}${PLAN}`;
    const model = parsePlan(opened);

    expect(opened.split('\n')[0]).toBe(ASSUMPTIONS_HEADING);
    expect(opened.endsWith(PLAN)).toBe(true);
    expect(model.issues).toEqual([]);
    expect(model.header.stub).toBe('rafa-20');
    expect(model.tasks.map((task) => task.text)).toEqual(['Do the thing']);
    expect(model.stages).toEqual([]);
  });

  it('collapses an assumption a model wrote over several lines onto its item', () => {
    const folded: SpecReviewGap = {
      ...ASSUMED_GAP,
      assumption: 'the SQLite backend,\nas every  other\ncommand reads\n',
    };

    const section = assumptionsHeading([folded]);

    expect(section).toContain('  - Planned under: the SQLite backend, as every other command reads\n');
    expect(section.split('\n').filter((line) => line.startsWith('  - '))).toHaveLength(1);
  });

  it('leaves out a gap naming no assumption, which is a section the gap contributes none to', () => {
    const section = assumptionsHeading([BLOCKING_GAP, ASSUMED_GAP]);

    expect(section).not.toContain(BLOCKING_GAP.what);
    expect(section).toContain('- **Design** — the store backend is not named');
    expect(section.split('\n').filter((line) => line.startsWith('- **'))).toHaveLength(1);
  });

  it('refuses a gap list naming no assumption at all, which is no section to open a plan with', () => {
    expect(() => assumptionsHeading([BLOCKING_GAP])).toThrow(TypeError);
    expect(() => assumptionsHeading([])).toThrow(TypeError);
    // The control: the same call over a gap that named one answers a section.
    expect(assumptionsHeading([ASSUMED_GAP])).toContain(ASSUMPTIONS_HEADING);
  });
});
