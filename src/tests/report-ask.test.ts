/**
 * The report ask: the paragraph `src/PROMPT.md` ends with, read through
 * the prompt a task session is actually handed.
 *
 * `buildTaskPrompt` (`start/dispatch.ts`) places `PROMPT.md` below the
 * two task lines and above the plan text, so the ask travels in every
 * task prompt. Without it no session writes a `rafa:report` block, and
 * `report/record.ts` stores every one as a `no-block` absence.
 *
 * The pin is on the prompt, not on the file: the real `src/PROMPT.md`
 * goes through `buildTaskPrompt` beside a task and a plan that name no
 * fence and no field, and the prompt must hold a `rafa:report` fence, as
 * `readRafaBlocks` finds one, whose example writes each of the six report
 * fields as a top-level key.
 *
 * Its control is the same assertion over the file's two original
 * paragraphs, the injection sentence and the staging sentence, which are
 * everything above the ask. It reddens with all seven names missing, so
 * each one is owed to the ask and none to the task lines, the plan or
 * the paragraphs the file already held.
 *
 * The example is also read by `parseReport`, because a literal copy of
 * the spec's example would not be: `done | blocked` is a choice, and as a
 * value it is outside the set the parser accepts. Its control writes that
 * choice back into the example, and the same reading reports the field.
 *
 * ## Mutations
 *
 * Ten mutations were driven against this file alone, one run each, with
 * the unmutated files green before and after them and both restored
 * byte-identical (sha256). Every one reddened at least one of its 4
 * cases. Seven were of `src/PROMPT.md`: the file put back to its two
 * original paragraphs (the pin and both example cases red), the
 * `skills_used` key dropped from the example (the pin alone), the fence
 * renamed `yaml` (the pin and both example cases), the example's `status`
 * or its `kind` written as the spec's choice (both example cases, each),
 * an `artifact` left unquoted and opening with a backtick (both example
 * cases), and the ask moved above the two paragraphs (the control alone).
 * Three were of this file: the control built over the whole file and the
 * shared assertion made vacuous (the control alone, each), and the plan
 * text replaced by `PROMPT.md` (the control and the literal-choice case).
 */
import type { ReportPresent } from '../report/parse.js';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { readRafaBlocks } from '../plan/blocks.js';
import { parseReport } from '../report/parse.js';
import { buildTaskPrompt } from '../start/dispatch.js';

/** `src/PROMPT.md`, the file the build copies and the loop reads. */
const PROMPT_FILE = readFileSync(fileURLToPath(new URL('../PROMPT.md', import.meta.url)), 'utf8');

/** The fence the ask names. */
const REPORT_FENCE = 'rafa:report';

/** The kind `readRafaBlocks` gives that fence: its info string less `rafa:`. */
const REPORT_KIND = 'report';

/** The six fields a report is asked for, spelled here rather than read off the parser. */
const REPORT_FIELDS = ['status', 'feedback', 'findings', 'skills_used', 'blockers', 'out_of_scope_bugs'];

/** A task sentence naming no fence and no field. */
const TASK = 'Add a probe module';

/** A plan naming no fence and no field. */
const PLAN = '# Plan: a probe\n\n- [ ] Add a probe module\n';

/** The prompt a task session is handed with `promptContent` as its `PROMPT.md`. */
function taskPrompt(promptContent: string): string {
  return buildTaskPrompt(TASK, promptContent, PLAN);
}

/**
 * Every name of the ask that `prompt` does not carry: the fence and all
 * six fields when no `rafa:report` block opens a line, otherwise each
 * field the last such block writes no top-level key for.
 */
function missingAskNames(prompt: string): string[] {
  const block = readRafaBlocks(prompt)
    .filter((candidate) => candidate.kind === REPORT_KIND)
    .at(-1);
  if (block === undefined) return [REPORT_FENCE, ...REPORT_FIELDS];

  const keys = block.body.split('\n').map((line) => /^([a-z_]+):/.exec(line)?.[1]);
  return REPORT_FIELDS.filter((field) => !keys.includes(field));
}

/** The assertion the pin and its control share: `prompt` carries the whole ask. */
function expectAsk(prompt: string): void {
  expect(missingAskNames(prompt)).toEqual([]);
}

/** The report `parseReport` reads out of the task prompt built over `promptContent`. */
function readExample(promptContent: string): ReportPresent {
  const reading = parseReport(taskPrompt(promptContent));
  if (!reading.present) throw new Error(`no report was read: ${reading.text}`);
  return reading;
}

describe('the report ask in src/PROMPT.md', () => {
  it('reaches the task prompt with the rafa:report fence and all six field names', () => {
    expectAsk(taskPrompt(PROMPT_FILE));
  });

  it('reddens the same assertion over the two original paragraphs alone', () => {
    const [injection, staging] = PROMPT_FILE.split('\n\n');

    expect(injection).toStartWith('We shared as much of the plan as this run is configured to share');
    expect(staging).toStartWith('Do not stage or commit anything');

    const original = taskPrompt(`${injection}\n\n${staging}\n`);

    expect(() => expectAsk(original)).toThrow();
    expect(missingAskNames(original)).toEqual([REPORT_FENCE, ...REPORT_FIELDS]);
  });

  it('writes an example parseReport reads with no issue', () => {
    const reading = readExample(PROMPT_FILE);

    expect(reading.issues).toEqual([]);
    expect(reading.report.status).toBe('done');
    expect(reading.report.findings).toHaveLength(1);
  });

  it('reports the status of an example that copies the spec choice literally', () => {
    const copied = PROMPT_FILE.replace('\nstatus: done\n', '\nstatus: done | blocked\n');

    expect(copied).not.toBe(PROMPT_FILE);
    expect(readExample(copied).issues.map((issue) => issue.field)).toEqual(['status']);
  });
});
