/**
 * The report ask, answered by a real `claude -p` session rather than by
 * a hand-built fixture.
 *
 * `report-ask.test.ts` pins that the ask reaches a task prompt intact.
 * It never shows that prompt to a model, so whether a session actually
 * answers it with a block `parseReport` reads was left as the next
 * task's live capture — this file is that capture, read back.
 *
 * ## Where the fixture comes from
 *
 * `src/tests/fixtures/report-ask-prompt.txt` and
 * `report-ask-output.txt` are frozen once, not rebuilt on every run.
 * The prompt is exactly what {@link capturePrompt} builds:
 * `buildTaskPrompt` over the real `src/PROMPT.md`, {@link LIVE_TASK} and
 * {@link LIVE_PLAN}. The output is the raw stdout a real
 * `claude -p --dangerously-skip-permissions` session answered for that
 * prompt, run in a scratch directory outside this repository — so the
 * session has nothing of this checkout's own to read or edit — holding
 * one planted file, {@link GOTCHA_FILE}, whose content is a small,
 * self-contained gotcha for the task to notice and report on.
 * `src/report/testdata/live-session-report.txt` was captured the same
 * way, from a hand-written prompt; this fixture is the first captured
 * from a prompt this codebase itself builds.
 *
 * Recapturing is opt-in: with `RAFA_RECAPTURE_REPORT_FIXTURE` unset,
 * this file spawns nothing and reads the two fixtures as they are on
 * disk. Set to `1`, it runs the live session first and overwrites both
 * fixtures with what that run produced, before any case reads them —
 * so a run that recaptures and a run that does not read the exact same
 * two files by the time the cases below see them.
 *
 * ## What is pinned, and what is not
 *
 * The frozen prompt is checked for the ask alone: the `rafa:report`
 * fence and all six field names, the same reading
 * `report-ask.test.ts` takes of a prompt built by hand. It is NOT
 * checked against a freshly built `capturePrompt()`, because
 * `src/PROMPT.md` is free to change after this fixture was captured —
 * that is exactly why the fixture is frozen rather than rebuilt, and an
 * equality check here would turn every unrelated `PROMPT.md` edit into
 * a failure this file exists to avoid.
 *
 * The frozen output is read through the real `parseReport`, the same
 * function `report/record.ts` calls on a task session's stdout. Only
 * two things are asked of it: a `status` and at least one finding. What
 * exactly the model wrote — which finding kind, how many findings,
 * whether every field is quoted — is a fact about one session on one
 * day, not a contract this suite can hold a live model to on every run.
 *
 * The absence case answers the other half: an output that answers
 * `present` with a report is not, on its own, evidence that a report
 * missing entirely is read as `no-block` rather than as some other
 * absence reason. `cutReportBlock` removes the fixture's own
 * `rafa:report` block, fences included, by the line span
 * `readRafaBlocks` gives it, leaving the same session's prose with no
 * block at all — the near miss `parseReport`'s own suite always pairs a
 * refusal with, here taken from a real session's prose instead of a
 * hand-built one.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { readRafaBlocks } from '../plan/blocks.js';
import { parseReport } from '../report/parse.js';
import { buildTaskPrompt } from '../start/dispatch.js';
import { CLAUDE_BASE_ARGS, CLAUDE_BIN } from '../utils/claude.js';

/** `src/PROMPT.md`, the file `buildTaskPrompt` places in every task prompt. */
const PROMPT_FILE = readFileSync(fileURLToPath(new URL('../PROMPT.md', import.meta.url)), 'utf8');

/** Where the two frozen fixtures live. */
const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const PROMPT_FIXTURE = join(FIXTURES_DIR, 'report-ask-prompt.txt');
const OUTPUT_FIXTURE = join(FIXTURES_DIR, 'report-ask-output.txt');

/** Set to `1` to run the live session again and refreeze both fixtures. */
const RECAPTURE_ENV = 'RAFA_RECAPTURE_REPORT_FIXTURE';

/** The fence the ask names, read the same way `report-ask.test.ts` does. */
const REPORT_FENCE = 'rafa:report';

/** The kind `readRafaBlocks` gives that fence: its info string less `rafa:`. */
const REPORT_KIND = 'report';

/** The six fields the ask asks for. */
const REPORT_FIELDS = ['status', 'feedback', 'findings', 'skills_used', 'blockers', 'out_of_scope_bugs'];

/** The planted file's name, read by the live session and by nothing else. */
const GOTCHA_FILE = 'planted-gotcha.md';

/** The task sentence the live session was dispatched with. */
const LIVE_TASK = `Read ${GOTCHA_FILE} in your current directory `
  + 'and report the gotcha it describes as one finding.';

/** A small, self-contained gotcha for the live session to notice and report. */
const GOTCHA_CONTENT = [
  '# A planted gotcha',
  '',
  'Calling `.slice()` on a Node.js `Buffer` returns a VIEW onto the same',
  'underlying memory, not a copy: writing through the slice mutates the',
  'bytes of the buffer it was sliced from as well.',
  '',
].join('\n');

/** A plan naming the live task and nothing else. */
const LIVE_PLAN = ['# Plan: a live report-ask capture', '', `- [ ] ${LIVE_TASK}`, ''].join('\n');

/** The prompt a live session is captured from: `buildTaskPrompt` over the real file. */
function capturePrompt(): string {
  return buildTaskPrompt(LIVE_TASK, PROMPT_FILE, LIVE_PLAN);
}

/**
 * Every name of the ask that `prompt` does not carry: the fence and all
 * six fields when no `rafa:report` block opens a line, otherwise each
 * field the last such block writes no top-level key for. The same
 * reading `report-ask.test.ts` takes; kept here rather than imported so
 * this file's own pin does not depend on that file staying a module
 * with an export to reach into.
 */
function missingAskNames(prompt: string): string[] {
  const block = readRafaBlocks(prompt)
    .filter((candidate) => candidate.kind === REPORT_KIND)
    .at(-1);
  if (block === undefined) return [REPORT_FENCE, ...REPORT_FIELDS];

  const keys = block.body.split('\n').map((line) => /^([a-z_]+):/.exec(line)?.[1]);
  return REPORT_FIELDS.filter((field) => !keys.includes(field));
}

/**
 * `output` with its last `rafa:report` block removed, fences included,
 * by the line span `readRafaBlocks` gives it. Throws when `output`
 * carries no such block, since that would make the absence case
 * vacuous rather than a genuine near miss of the presence case.
 */
function cutReportBlock(output: string): string {
  const block = readRafaBlocks(output)
    .filter((candidate) => candidate.kind === REPORT_KIND)
    .at(-1);
  if (block === undefined) throw new Error('the fixture output holds no rafa:report block to cut');

  const lines = output.split('\n');
  return [...lines.slice(0, block.span.first - 1), ...lines.slice(block.span.last)].join('\n');
}

/**
 * Runs the live session once: plants {@link GOTCHA_FILE} in a fresh
 * scratch directory outside this repository, pipes {@link capturePrompt}
 * to a real `claude -p --dangerously-skip-permissions` with that
 * directory as its cwd, and freezes the prompt and the session's raw
 * stdout as the two fixtures. The scratch directory is removed after,
 * whatever the session left in it.
 */
async function recaptureFixture(): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'rafa-report-ask-live-'));
  try {
    writeFileSync(join(scratch, GOTCHA_FILE), GOTCHA_CONTENT, 'utf8');
    const prompt = capturePrompt();

    const proc = Bun.spawn([CLAUDE_BIN, ...CLAUDE_BASE_ARGS], {
      cwd: scratch,
      stdin: new TextEncoder().encode(prompt),
      stdout: 'pipe',
      stderr: 'inherit',
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) throw new Error(`the live capture session exited ${exitCode}`);

    mkdirSync(FIXTURES_DIR, { recursive: true });
    writeFileSync(PROMPT_FIXTURE, prompt, 'utf8');
    writeFileSync(OUTPUT_FIXTURE, output, 'utf8');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.env[RECAPTURE_ENV] === '1') {
  await recaptureFixture();
}

/** The frozen prompt: `capturePrompt()`'s output on the day of the capture. */
const FROZEN_PROMPT = readFileSync(PROMPT_FIXTURE, 'utf8');

/** The frozen session output: raw stdout from that capture. */
const FROZEN_OUTPUT = readFileSync(OUTPUT_FIXTURE, 'utf8');

describe('the frozen report-ask prompt', () => {
  it('carries the rafa:report fence and all six field names', () => {
    expect(missingAskNames(FROZEN_PROMPT)).toEqual([]);
  });
});

describe('the frozen session output, read through parseReport', () => {
  const reading = parseReport(FROZEN_OUTPUT);

  it('is read as a report, with a status and at least one finding', () => {
    if (!reading.present) throw new Error(`expected a report, got ${reading.reason}: ${reading.text}`);

    expect(reading.report.status).not.toBeNull();
    expect(reading.report.findings.length).toBeGreaterThan(0);
  });

  it('answers the no-block absence once its rafa:report block is cut', () => {
    const cut = cutReportBlock(FROZEN_OUTPUT);
    const cutReading = parseReport(cut);

    expect(cutReading.present).toBe(false);
    if (cutReading.present) throw new Error('unreachable: present was just asserted false');
    expect(cutReading.reason).toBe('no-block');
    expect(cutReading.block).toBeNull();
  });
});
