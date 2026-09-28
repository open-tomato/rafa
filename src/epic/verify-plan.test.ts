/**
 * Tests for the verification planner: cutting an epic's criteria into
 * numbered criteria, building the planning prompt from them, finding the
 * shipped template, and reading the `rafa:verify` answer into one verdict
 * per criterion. Every answer is a literal string; nothing starts a
 * session. The template's own example block is parsed as the control that
 * the prompt asks for the shape the parser reads.
 */
import type { EpicCriterion, VerifyPlanPresent, VerifyPlanReading } from './verify-plan.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { CRITERIA_PLACEHOLDERS, PLACEHOLDER_REASON } from '../board/epic-template.js';
import { readRafaBlocks } from '../plan/blocks.js';

import {
  buildVerifyPrompt,
  criteriaToAsk,
  parseVerifyPlan,
  readVerifyPrompt,
  SKIPPED_REASON,
  splitCriteria,
  VERIFY_BLOCK_FENCE,
  VERIFY_PROMPT_FILE,
  VERIFY_PROMPT_PREFIX,
  VERIFY_PROMPT_SLOTS,
  verifyPromptCandidates,
} from './verify-plan.js';

const PLACEHOLDER = CRITERIA_PLACEHOLDERS[0] ?? '';

/** Epic #252's criteria section, as `readEpicBody` answers it. */
const EPIC_252 = [
  '- The roadmap is a board of epics. `rafa roadmap` shows the epics with their state and progress, and `rafa epics` shows one epic\'s issues.',
  '- A project can hold several boards; `rafa switch` moves between them and their epics, and `rafa status` says where you stand.',
  '- Every change to an epic is a command that leaves a trail, and an epic closes only through a gate that checks its acceptance criteria.',
].join('\n');

/** Three criteria, the middle one a placeholder. */
const WITH_PLACEHOLDER = splitCriteria(['- `rafa roadmap` lists epics.', PLACEHOLDER, '- `rafa epics` lists issues.'].join('\n'));

/** Three plain criteria. */
const THREE = splitCriteria(['- one', '- two', '- three'].join('\n'));

const scratch = mkdtempSync(join(tmpdir(), 'rafa-verify-plan-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** `body` fenced as the session's answer, after some prose. */
function answer(body: string, fence = VERIFY_BLOCK_FENCE): string {
  return `I read the repository.\n\n\`\`\`${fence}\n${body}\n\`\`\`\n`;
}

/** The reading, asserted present. */
function present(reading: VerifyPlanReading): VerifyPlanPresent {
  if (!reading.present) throw new Error(`expected a plan, got ${reading.reason}: ${reading.text}`);
  return reading;
}

/** Each verdict as `<number> <kind> <check or reason>`, for one-line assertions. */
function summary(reading: VerifyPlanReading): string[] {
  return present(reading).verdicts.map((verdict) => (verdict.kind === 'check'
    ? `${String(verdict.criterion.number)} check ${verdict.check}`
    : `${String(verdict.criterion.number)} ${verdict.source} ${verdict.reason}`));
}

describe('splitCriteria', () => {
  it('answers nothing for null criteria', () => {
    expect(splitCriteria(null)).toEqual([]);
  });

  it('cuts one criterion per top-level list item, numbered in the order written', () => {
    const criteria = splitCriteria(EPIC_252);

    expect(criteria.map((criterion) => criterion.number)).toEqual([1, 2, 3]);
    expect(criteria.map((criterion) => criterion.text)).toEqual(EPIC_252.split('\n'));
    expect(criteria.every((criterion) => !criterion.placeholder)).toBe(true);
  });

  it('keeps continuation lines, a nested list and a fenced example with the item they follow', () => {
    const section = [
      '- `rafa epic close` refuses while a member is open,',
      '  naming each open member:',
      '  - by number',
      '  - by title',
      '```text',
      '- not an item: quoted output',
      '',
      'nor a paragraph',
      '```',
      '* `rafa epic move` keeps the issue.',
    ].join('\n');

    const criteria = splitCriteria(section);

    expect(criteria.map((criterion) => criterion.text)).toEqual([
      section.split('\n').slice(0, 9)
        .join('\n'),
      '* `rafa epic move` keeps the issue.',
    ]);
  });

  it('reads numbered items with either marker and a CRLF section like its LF twin', () => {
    const lf = ['1. first', '2) second', '10. tenth'].join('\n');
    const crlf = lf.replaceAll('\n', '\r\n');

    expect(splitCriteria(lf).map((criterion) => criterion.text)).toEqual(['1. first', '2) second', '10. tenth']);
    expect(splitCriteria(crlf)).toEqual(splitCriteria(lf));
  });

  it('keeps a lead-in and a trailing paragraph as criteria of their own rather than dropping them', () => {
    const section = [
      'Done when:',
      '',
      '- the gate refuses an open member',
      '  and names it',
      '',
      'The board looks calm.',
      'Nobody is surprised.',
    ].join('\n');

    expect(splitCriteria(section).map((criterion) => criterion.text)).toEqual([
      'Done when:',
      '- the gate refuses an open member\n  and names it',
      'The board looks calm.\nNobody is surprised.',
    ]);
  });

  it('takes the first item\'s indentation as the top level, for a list indented under a lead-in', () => {
    const section = ['Done when:', '  - one', '    - one, nested', '  - two'].join('\n');

    expect(splitCriteria(section).map((criterion) => criterion.text)).toEqual([
      'Done when:',
      '- one\n    - one, nested',
      '- two',
    ]);
  });

  it('keeps an indented paragraph after a blank line with the item above it', () => {
    const section = ['- the gate refuses', '', '  with exit 2', '- the cost prints'].join('\n');

    expect(splitCriteria(section).map((criterion) => criterion.text)).toEqual([
      '- the gate refuses\n\n  with exit 2',
      '- the cost prints',
    ]);
  });

  it('marks the template\'s placeholder and leaves an edited one as the author\'s criterion', () => {
    const criteria = splitCriteria([PLACEHOLDER, `${PLACEHOLDER} Edited.`].join('\n'));

    expect(criteria.map((criterion) => criterion.placeholder)).toEqual([true, false]);
    expect(criteriaToAsk(criteria).map((criterion) => criterion.number)).toEqual([2]);
  });

  it('asks about every criterion but the placeholders, numbers kept', () => {
    expect(criteriaToAsk(WITH_PLACEHOLDER).map((criterion) => criterion.number)).toEqual([1, 3]);
    expect(criteriaToAsk(splitCriteria(PLACEHOLDER))).toEqual([]);
  });
});

describe('readVerifyPrompt', () => {
  it('finds src/epic-verify-prompt.md from this module\'s own directory in a checkout', () => {
    const here = dirname(fileURLToPath(import.meta.url));

    expect(verifyPromptCandidates(here)).toEqual([join(here, VERIFY_PROMPT_FILE), join(dirname(here), VERIFY_PROMPT_FILE)]);
    expect(readVerifyPrompt().split('\n')[0]).toBe(VERIFY_PROMPT_PREFIX);
  });

  it('reads the copy beside the module before the one in its parent', () => {
    const moduleDir = join(scratch, 'both', 'dist');
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(join(moduleDir, VERIFY_PROMPT_FILE), 'beside\n');
    writeFileSync(join(dirname(moduleDir), VERIFY_PROMPT_FILE), 'parent\n');

    expect(readVerifyPrompt(moduleDir)).toBe('beside\n');
  });

  it('reads the parent\'s copy when none sits beside the module', () => {
    const moduleDir = join(scratch, 'parent', 'epic');
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(join(dirname(moduleDir), VERIFY_PROMPT_FILE), 'parent\n');

    expect(readVerifyPrompt(moduleDir)).toBe('parent\n');
  });

  it('throws naming both paths when neither holds the prompt', () => {
    const moduleDir = join(scratch, 'neither', 'epic');
    mkdirSync(moduleDir, { recursive: true });

    expect(() => readVerifyPrompt(moduleDir)).toThrow(
      `no file at ${join(moduleDir, VERIFY_PROMPT_FILE)} or ${join(dirname(moduleDir), VERIFY_PROMPT_FILE)}`,
    );
  });
});

describe('buildVerifyPrompt', () => {
  const template = readVerifyPrompt();

  it('fills every slot of the shipped template', () => {
    const prompt = buildVerifyPrompt(template, { epic: 252, title: 'Epics and boards', criteria: splitCriteria(EPIC_252) });

    expect(prompt.split('\n')[0]).toBe(VERIFY_PROMPT_PREFIX);
    expect(prompt).toContain('Epic #252, "Epics and boards", is being closed.');
    expect(VERIFY_PROMPT_SLOTS.filter((slot) => prompt.includes(`{${slot}}`))).toEqual([]);
  });

  it('renders each asked criterion under its number inside a text fence, placeholders left out', () => {
    const prompt = buildVerifyPrompt(template, { epic: 7, title: 'x', criteria: WITH_PLACEHOLDER });

    expect(prompt).toContain('### Criterion 1\n\n```text\n- `rafa roadmap` lists epics.\n```\n\n### Criterion 3\n\n```text\n- `rafa epics` lists issues.\n```');
    expect(prompt).not.toContain('### Criterion 2');
    expect(prompt).not.toContain(PLACEHOLDER);
  });

  it('fences a criterion holding a fence with a longer one, so it cannot close early', () => {
    const criteria = splitCriteria('- prints:\n  ```text\n  ok\n  ```');
    const prompt = buildVerifyPrompt(template, { epic: 7, title: 'x', criteria });

    expect(prompt).toContain('````text\n- prints:\n  ```text\n  ok\n  ```\n````');
  });

  it('inserts a dollar pattern and a slot name inside a criterion verbatim', () => {
    const criteria = splitCriteria('- costs $& and says {CRITERIA} and {EPIC_TITLE}');
    const prompt = buildVerifyPrompt(template, { epic: 7, title: 'x', criteria });

    expect(prompt).toContain('- costs $& and says {CRITERIA} and {EPIC_TITLE}\n');
  });

  it('collapses a title onto one line', () => {
    const prompt = buildVerifyPrompt(template, { epic: 7, title: ' Two\nlines\t here ', criteria: THREE });

    expect(prompt).toContain('Epic #7, "Two lines here", is being closed.');
  });

  it('throws naming a slot the template does not carry', () => {
    const edited = template.replace('{CRITERIA}', '');

    expect(() => buildVerifyPrompt(edited, { epic: 7, title: 'x', criteria: THREE })).toThrow('no {CRITERIA} slot');
  });

  it('shows an example block the parser reads, one check and one uncheckable', () => {
    const example = readRafaBlocks(template).filter((block) => block.kind === 'verify');

    expect(example).toHaveLength(1);
    const reading = parseVerifyPlan(template, splitCriteria('- one\n- two'));
    expect(present(reading).issues).toEqual([]);
    expect(present(reading).verdicts.map((verdict) => (verdict.kind === 'uncheckable'
      ? verdict.source
      : verdict.kind))).toEqual(['check', 'answer']);
  });
});

describe('parseVerifyPlan', () => {
  it('reads one check or one uncheckable reason per criterion, trimmed, in the criteria\'s order', () => {
    const output = answer([
      'criteria:',
      '  - criterion: 3',
      '    check: "  Run `rafa roadmap`; it prints the board.  "',
      '  - criterion: 1',
      '    check: "Read src/board/epics.ts for readEpics."',
      '  - criterion: 2',
      '    uncheckable: "It names a feeling."',
    ].join('\n'));

    const reading = parseVerifyPlan(output, THREE);

    expect(summary(reading)).toEqual([
      '1 check Read src/board/epics.ts for readEpics.',
      '2 answer It names a feeling.',
      '3 check Run `rafa roadmap`; it prints the board.',
    ]);
    expect(present(reading).issues).toEqual([]);
    expect(present(reading).verdicts.map((verdict) => verdict.criterion)).toEqual([...THREE]);
  });

  it('reports a criterion the answer skipped as uncheckable', () => {
    const output = answer('criteria:\n  - criterion: 1\n    check: "a"\n  - criterion: 3\n    check: "c"');

    expect(summary(parseVerifyPlan(output, THREE))).toEqual(['1 check a', `2 skipped ${SKIPPED_REASON}`, '3 check c']);
  });

  it('reports every criterion skipped when criteria is absent or null', () => {
    const skipped = THREE.map((criterion) => `${String(criterion.number)} skipped ${SKIPPED_REASON}`);

    expect(summary(parseVerifyPlan(answer('note: "nothing"'), THREE))).toEqual(skipped);
    expect(summary(parseVerifyPlan(answer('criteria: null'), THREE))).toEqual(skipped);
    expect(summary(parseVerifyPlan(answer('criteria: []'), THREE))).toEqual(skipped);
  });

  it('answers a placeholder as uncheckable without asking, and drops an entry naming it', () => {
    const output = answer([
      'criteria:',
      '  - criterion: 1',
      '    check: "a"',
      '  - criterion: 2',
      '    check: "the placeholder holds"',
      '  - criterion: 3',
      '    check: "c"',
    ].join('\n'));

    const reading = parseVerifyPlan(output, WITH_PLACEHOLDER);

    expect(summary(reading)).toEqual(['1 check a', `2 placeholder ${PLACEHOLDER_REASON}`, '3 check c']);
    expect(present(reading).issues).toEqual([
      { field: 'criteria[1]', text: 'criteria[1].criterion 2 is no criterion the plan was asked about; dropped' },
    ]);
  });

  it('drops an entry carrying both answers or neither, and says why on its criterion', () => {
    const output = answer([
      'criteria:',
      '  - criterion: 1',
      '    check: "a"',
      '    uncheckable: "b"',
      '  - criterion: 2',
      '    why: "no answer key"',
      '  - criterion: 3',
      '    check: "   "',
    ].join('\n'));

    const reading = parseVerifyPlan(output, THREE);

    expect(summary(reading)).toEqual([
      `1 skipped ${SKIPPED_REASON}: its entry was dropped, as criteria[0] carries both check and uncheckable`,
      `2 skipped ${SKIPPED_REASON}: its entry was dropped, as criteria[1] carries neither check and uncheckable`,
      `3 skipped ${SKIPPED_REASON}: its entry was dropped, as criteria[2].check is "   ", not a non-blank string`,
    ]);
    expect(present(reading).issues.map((issue) => issue.field)).toEqual(['criteria[0]', 'criteria[1]', 'criteria[2]']);
  });

  it('refuses a quoted, fractional or unknown criterion number and a non-mapping entry, keeping the rest', () => {
    const output = answer([
      'criteria:',
      '  - criterion: "1"',
      '    check: "quoted"',
      '  - criterion: 1.5',
      '    check: "fraction"',
      '  - criterion: 9',
      '    check: "unknown"',
      '  - "just a string"',
      '  - criterion: 2',
      '    check: "kept"',
    ].join('\n'));

    const reading = parseVerifyPlan(output, THREE);

    expect(summary(reading)).toEqual([`1 skipped ${SKIPPED_REASON}`, '2 check kept', `3 skipped ${SKIPPED_REASON}`]);
    expect(present(reading).issues.map((issue) => issue.text)).toEqual([
      'criteria[0].criterion is "1", not a criterion number from 1; dropped',
      'criteria[1].criterion is the number 1.5, not a criterion number from 1; dropped',
      'criteria[2].criterion 9 is no criterion the plan was asked about; dropped',
      'criteria[3] is "just a string", not a mapping; dropped',
    ]);
  });

  it('keeps the first of two entries answering one criterion', () => {
    const output = answer('criteria:\n  - criterion: 1\n    check: "first"\n  - criterion: 1\n    uncheckable: "second"');

    const reading = parseVerifyPlan(output, THREE.slice(0, 1));

    expect(summary(reading)).toEqual(['1 check first']);
    expect(present(reading).issues).toEqual([
      { field: 'criteria[1]', text: 'criteria[1] answers criterion 1 a second time; dropped' },
    ]);
  });

  it('ignores keys it does not know, at either level', () => {
    const output = answer('summary: "fine"\ncriteria:\n  - criterion: 1\n    check: "a"\n    confidence: high');

    expect(summary(parseVerifyPlan(output, THREE.slice(0, 1)))).toEqual(['1 check a']);
  });

  it('reads the last rafa:verify block, ignoring an earlier draft and blocks of other kinds', () => {
    const output = [
      answer('criteria:\n  - criterion: 1\n    check: "draft"'),
      answer('criteria:\n  - criterion: 1\n    check: "final"'),
      answer('status: done', 'rafa:report'),
    ].join('\n');

    expect(summary(parseVerifyPlan(output, THREE.slice(0, 1)))).toEqual(['1 check final']);
  });

  it('answers no-block for an output without a rafa:verify block', () => {
    const reading = parseVerifyPlan(answer('status: done', 'rafa:report'), THREE);

    expect(reading).toEqual({
      present: false,
      reason: 'no-block',
      block: null,
      text: 'the session output holds no rafa:verify block',
    });
  });

  it('answers unclosed-block for a last block never closed, not the earlier one', () => {
    const output = `${answer('criteria:\n  - criterion: 1\n    check: "a"')}\n\`\`\`rafa:verify\ncriteria:\n  - criterion: 1\n`;

    const reading = parseVerifyPlan(output, THREE);

    expect(reading.present).toBe(false);
    expect(reading.present
      ? null
      : reading.reason).toBe('unclosed-block');
  });

  it.each([
    ['a value holding an unquoted colon', 'criteria:\n  - criterion: 1\n    check: run it: then read', 'is not valid YAML'],
    ['a scalar body', 'just words', 'holds "just words", not a mapping'],
    ['a list body', '- criterion: 1', 'holds a list, not a mapping'],
    ['criteria as a mapping', 'criteria:\n  criterion: 1', 'has criteria a mapping, not a list'],
  ])('answers malformed-block for %s', (_name, body, text) => {
    const reading = parseVerifyPlan(answer(body), THREE);

    expect(reading.present).toBe(false);
    expect(reading.present
      ? null
      : reading.reason).toBe('malformed-block');
    expect(reading.present
      ? ''
      : reading.text).toContain(text);
  });

  it('answers one verdict per criterion for an empty criteria list, and nothing else', () => {
    const none: readonly EpicCriterion[] = [];

    expect(present(parseVerifyPlan(answer('criteria: []'), none)).verdicts).toEqual([]);
  });
});
