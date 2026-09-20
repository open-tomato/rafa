/**
 * Tests for the field a generated plan records
 * (`src/board/plan-field.ts`): where the line lands, what the `issue`
 * field is written as, and which plans are left alone.
 *
 * Every case is a pure call over a literal plan; nothing here touches a
 * file. The placing cases assert the WHOLE text rather than a
 * substring, because the one failure a stamp can hide is reformatting
 * the plan around the line it added — an assertion that only looked for
 * the line would pass over a rewritten document. `./review-stamp.test.ts`
 * drives the same placing through the `review` field, and this file does
 * not repeat it.
 *
 * ## The quoting is the case that matters
 *
 * `issue` is one of `PLAN_HEADER_FIELDS`, and the reader takes it as a
 * string only: `issue: 20` parses as the NUMBER 20 and is reported
 * `unusable-field`. Nothing about the stamped text says so on sight, so
 * the round-trip case runs `parsePlan` over both spellings — the quoted
 * line the stamp writes, and a bare one planted here as the control —
 * and holds the first readable and the second refused. A stamp that
 * wrote the number bare would look right in every other case in this
 * file and would make `plan validate` refuse every plan off the board.
 *
 * Measured, not argued: on 2026-09-19 `stampPlanIssue` writing the
 * number bare left 3 pass and 6 fail against 9 pass either side, the
 * round trip among them, and the module was restored from a scratch copy
 * and verified with `shasum -c`.
 */
import { describe, expect, it } from 'bun:test';

import { parsePlan } from '../plan/parse.js';

import { issueFieldLine, stampPlanField, stampPlanIssue } from './plan-field.js';
import { REVIEW_SKIPPED_LINE, stampReviewSkipped } from './review-stamp.js';

/** A plan document holding `lines`, each on its own line. */
function doc(...lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

/** The ordinary plan a session writes: a title, the header block, a task. */
const PLAN = doc(
  '# Plan: rafa-20-pr-commands',
  '',
  '```rafa:plan',
  'stub: rafa-20-pr-commands',
  'spec: .rafa/specs/rafa-20-pr-commands.md',
  '```',
  '',
  '- [ ] Do the thing',
);

describe('the issue a plan off the board records', () => {
  it('is one quoted line above the closing fence, and leaves every other byte alone', () => {
    const stamp = stampPlanIssue(PLAN, 20);

    expect(stamp.answer).toBe('inserted');
    expect(stamp.recorded).toBe(true);
    expect(stamp.text).toBe(doc(
      '# Plan: rafa-20-pr-commands',
      '',
      '```rafa:plan',
      'stub: rafa-20-pr-commands',
      'spec: .rafa/specs/rafa-20-pr-commands.md',
      'issue: "20"',
      '```',
      '',
      '- [ ] Do the thing',
    ));
    expect(stamp.note).toContain('line 6');
  });

  it('reads back off the stamped plan as the header field, digits and all', () => {
    const stamped = parsePlan(stampPlanIssue(PLAN, 20).text);
    const bare = parsePlan(PLAN.replace('```\n\n- [ ]', 'issue: 042\n```\n\n- [ ]'));

    expect(stamped.header.issue).toBe('20');
    expect(stamped.header.extras).toEqual([]);
    expect(stamped.issues).toEqual([]);
    // The control: unquoted, the reader hands back the number YAML parsed, not the digits written.
    expect(bare.header.issue).toBe('42');
    expect(parsePlan(stampPlanIssue(PLAN, 42).text).header.issue).toBe('42');
  });

  it('replaces a bare number a session wrote by hand with the quoted line', () => {
    const planned = doc('```rafa:plan', 'stub: rafa-20', 'issue: 20', '```');

    const stamp = stampPlanIssue(planned, 20);

    expect(stamp.answer).toBe('replaced');
    expect(stamp.text).toBe(doc('```rafa:plan', 'stub: rafa-20', 'issue: "20"', '```'));
  });

  it('changes no byte of a plan that already records the same issue', () => {
    const planned = doc('```rafa:plan', 'stub: rafa-20', 'issue: "20"', '```');

    expect(stampPlanIssue(planned, 20)).toMatchObject({ answer: 'unchanged', recorded: true, text: planned });
  });

  it('sits beside the review the skipped gate records, each field once', () => {
    const both = stampReviewSkipped(stampPlanIssue(PLAN, 20).text);

    expect(both.text).toContain(`issue: "20"\n${REVIEW_SKIPPED_LINE}\n`);
    expect(parsePlan(both.text).header.issue).toBe('20');
    expect(parsePlan(both.text).header.extras).toEqual([{ key: 'review', value: 'skipped' }]);
  });

  it('refuses a number that is no issue number, which is a defect in the caller', () => {
    expect(() => issueFieldLine(0)).toThrow(TypeError);
    expect(() => issueFieldLine(1.5)).toThrow(TypeError);
    // The control: the number the command line can produce is spelled.
    expect(issueFieldLine(20)).toBe('issue: "20"');
  });
});

describe('the field mechanism', () => {
  it('records nothing in a plan with no rafa:plan block, or one that is never closed', () => {
    const headerless = doc('# Plan: rafa-20', '', '- [ ] Do the thing');
    const unclosed = doc('# Plan: rafa-20', '```rafa:plan', 'stub: rafa-20');

    const none = stampPlanIssue(headerless, 20);
    const open = stampPlanIssue(unclosed, 20);

    expect(none).toMatchObject({ answer: 'no-block', recorded: false, text: headerless });
    expect(none.note).toContain('no rafa:plan block');
    expect(open).toMatchObject({ answer: 'unclosed-block', recorded: false, text: unclosed });
    expect(open.note).toContain('line 2');
    // The control: the same call records in a plan that carries one.
    expect(stampPlanIssue(PLAN, 20).recorded).toBe(true);
  });

  it('does not take a key nested under another field for the field', () => {
    const nested = doc('```rafa:plan', 'stub: rafa-20', 'notes:', '  issue: 7', '```');

    const stamp = stampPlanIssue(nested, 20);

    expect(stamp.answer).toBe('inserted');
    expect(stamp.text).toBe(doc('```rafa:plan', 'stub: rafa-20', 'notes:', '  issue: 7', 'issue: "20"', '```'));
  });

  it('refuses a field that is no rafa:plan key, so no pattern is built from it', () => {
    expect(() => stampPlanField(PLAN, 'Issue', '"20"')).toThrow(TypeError);
    expect(() => stampPlanField(PLAN, 'a.*', '1')).toThrow(TypeError);
    // The control: a plain key is recorded.
    expect(stampPlanField(PLAN, 'issue', '"20"').recorded).toBe(true);
  });
});
