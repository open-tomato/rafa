/**
 * Tests for the failing-log evidence (`src/pr/triage/evidence.ts`).
 *
 * The module is pure over one string, so nothing here spawns `gh`,
 * reaches a network or reads a file. What the cases are built on
 * instead is CAPTURED TEXT: every constant below whose name opens with
 * `CAPTURED_` is a line of a real `gh run view <id> --log-failed`,
 * copied byte for byte off a capture taken on gh 2.100.0 on
 * 2026-09-18, with only its two tab separators, its byte order mark and
 * its apostrophes written as source escapes so this file carries no raw
 * control byte. The line numbers name where each came from, so a reader
 * who doubts a claim can take the same capture again.
 *
 * Two captures: `cli/cli` run 34857793347 (651 lines, job `detection`)
 * and run 34978884017 (5413 lines, job `Dependabot`). Neither `gh` nor
 * GitHub is under test here — the module is — but a reader built on an
 * invented shape would pass its own invention, which is why the shape
 * cases quote lines nobody here wrote.
 *
 * The bulk cases, where 40 lines have to be told from 60, go through
 * `logFailedText` in `../gh-fake-shapes.ts` rather than through a
 * literal of this file's own. That is deliberate: the fake's renderer
 * and this reader are the two halves of the same recorded shape, and a
 * case that drove a private renderer could not notice the two drifting
 * apart.
 *
 * Every reading that could pass by accident is paired with a control:
 * the step of the FIRST error beside the assertion that the log really
 * does carry a later error under a DIFFERENT step, the named step
 * column beside the `UNKNOWN STEP` placeholder, the fallback with no
 * error line beside the same log once an error is added, and the
 * stripped line beside the raw one it was stripped from.
 *
 * Six mutations of `evidence.ts` were driven against this file on
 * 2026-09-18, one at a time, the module restored from a scratch copy
 * and verified with `shasum -c` after each, 22 pass either side:
 *
 *  - the `UNKNOWN STEP` placeholder read as a step name, so the column
 *    always names a step: 6 fail, every case that reads a step out of
 *    the captured run among them, because the placeholder would then be
 *    the answer everywhere a real name is missing.
 *  - the LAST error deciding the step rather than the first: 1 fail,
 *    the captured two-failure case, which is the only reading in the
 *    file that can tell the two apart and the reason that case quotes
 *    both errors rather than one.
 *  - the per-line timestamp left on the message: 11 fail, half the
 *    file, since every expected text is the stripped one.
 *  - the head kept instead of the tail: 2 fail, the default cap and the
 *    caller cap. The under-cap case passes either way, which is why the
 *    cap is measured on a capture longer than it and not on that one.
 *  - the colour strip dropped: 2 fail, the captured caret sequence and
 *    the real escape one.
 *  - the byte order mark left in place: 1 fail, the captured job first
 *    line, the only line in the file that carries one.
 */
import { describe, expect, it } from 'bun:test';

import { logFailedText } from '../gh-fake-shapes.js';

import {
  ERROR_PREFIX,
  FAILED_LOG_TAIL_LINES,
  GROUP_STEP_PREFIX,
  parseFailedLog,
  parseFailedLogLine,
  readFailedLog,
  readFailedStep,
  readJobs,
  UNKNOWN_STEP,
} from './evidence.js';

/** Line 396 of `cli/cli` run 34857793347: the step that failed first. */
const CAPTURED_FIRST_GROUP = 'detection\tUNKNOWN STEP\t2026-09-14T14:54:18.7979054Z '
  + '##[group]Run bash "${RUNNER_TEMP}/gh-aw/actions/install_awf_binary.sh" v0.28.7 --rootless';

/** Line 397 of the same run: the runner echoing that command in colour. */
const CAPTURED_COLOUR = 'detection\tUNKNOWN STEP\t2026-09-14T14:54:18.7979736Z '
  + '^[[36;1mbash "${RUNNER_TEMP}/gh-aw/actions/install_awf_binary.sh" v0.28.7 --rootless^[[0m';

/** Line 415: the first error, the download having failed six times. */
const CAPTURED_FIRST_ERROR = 'detection\tUNKNOWN STEP\t2026-09-14T14:55:19.9933835Z '
  + '##[error]Process completed with exit code 22.';

/** Line 416: the step after it, which ran a binary the first never installed. */
const CAPTURED_SECOND_GROUP = 'detection\tUNKNOWN STEP\t2026-09-14T14:55:19.9987225Z '
  + '##[group]Run bash "${RUNNER_TEMP}/gh-aw/actions/install_threat_detect_binary.sh" v0.4.12';

/** Line 516: that step failing in turn, the first error being its cause. */
const CAPTURED_SECOND_ERROR = 'detection\tUNKNOWN STEP\t2026-09-14T14:55:30.8734767Z '
  + '##[error]Process completed with exit code 127.';

/** Line 352: a continuation line, one of the 31 that carry no timestamp. */
const CAPTURED_CONTINUATION = 'detection\tUNKNOWN STEP\t'
  + 'const actionsDir = path.join(process.env.RUNNER_TEMP, \'gh-aw\', \'actions\');';

/** Line 1 of run 34978884017: a job first line, opening with a byte order mark. */
const CAPTURED_BOM_LINE = 'Dependabot\tUNKNOWN STEP\t\ufeff2026-09-15T14:01:58.5384418Z '
  + 'Current runner version: \'2.337.0\'';

/** The command of the step the first captured error falls under. */
const FIRST_STEP = 'bash "${RUNNER_TEMP}/gh-aw/actions/install_awf_binary.sh" v0.28.7 --rootless';

/** The command of the step the second one falls under. */
const SECOND_STEP = 'bash "${RUNNER_TEMP}/gh-aw/actions/install_threat_detect_binary.sh" v0.4.12';

/** The captured lines of the two failures, in their captured order, as one capture. */
const CAPTURED_TWO_FAILURES = [
  CAPTURED_FIRST_GROUP,
  CAPTURED_COLOUR,
  CAPTURED_FIRST_ERROR,
  CAPTURED_SECOND_GROUP,
  CAPTURED_SECOND_ERROR,
].join('\n') + '\n';

/** A log of `count` numbered lines in the recorded shape, from the fake renderer. */
function bulkLog(count: number, job = 'gates'): string {
  return logFailedText(job, Array.from({ length: count }, (_, index) => `line ${index + 1}`));
}

/** The same shape with a step column a provider filled in. */
function namedStepLine(step: string, text: string): string {
  return `job\t${step}\t2026-09-18T11:30:00Z ${text}`;
}

describe('the captured line shape', () => {
  it('splits a captured line into its job, its step column and its message', () => {
    const line = parseFailedLogLine(CAPTURED_FIRST_ERROR);
    expect(line.job).toBe('detection');
    expect(line.step).toBeUndefined();
    expect(line.text).toBe('##[error]Process completed with exit code 22.');
  });

  it('reads the placeholder as no step, where a filled column is a step', () => {
    expect(parseFailedLogLine(namedStepLine(UNKNOWN_STEP, 'x')).step).toBeUndefined();
    expect(parseFailedLogLine(namedStepLine('Run the gates', 'x')).step).toBe('Run the gates');
    expect(parseFailedLogLine(namedStepLine('', 'x')).step).toBeUndefined();
  });

  it('strips the byte order mark a job first line opens with', () => {
    expect(CAPTURED_BOM_LINE).toContain('\ufeff');
    expect(parseFailedLogLine(CAPTURED_BOM_LINE).text)
      .toBe('Current runner version: \'2.337.0\'');
  });

  it('strips the literal caret colour sequences the capture carried', () => {
    expect(CAPTURED_COLOUR).toContain('^[[36;1m');
    expect(parseFailedLogLine(CAPTURED_COLOUR).text).toBe(FIRST_STEP);
  });

  it('strips a real escape colour sequence too', () => {
    const coloured = namedStepLine(UNKNOWN_STEP, `${String.fromCharCode(0x1B)}[31mred${String.fromCharCode(0x1B)}[0m`);
    expect(parseFailedLogLine(coloured).text).toBe('red');
  });

  it('keeps a continuation line that carries no timestamp', () => {
    expect(parseFailedLogLine(CAPTURED_CONTINUATION).text)
      .toBe('const actionsDir = path.join(process.env.RUNNER_TEMP, \'gh-aw\', \'actions\');');
  });

  it('keeps a line that is not in the column shape whole, naming no job', () => {
    const line = parseFailedLogLine('failed to get run log: log not found');
    expect(line.job).toBeUndefined();
    expect(line.step).toBeUndefined();
    expect(line.text).toBe('failed to get run log: log not found');
  });

  it('splits on the first two tabs, so a message keeping a tab stays whole', () => {
    const line = parseFailedLogLine('gates\tUNKNOWN STEP\t2026-09-18T11:30:00Z a\tb');
    expect(line.job).toBe('gates');
    expect(line.text).toBe('a\tb');
  });

  it('drops the trailing empty line a capture ends on and keeps the ones inside', () => {
    const lines = parseFailedLog('gates\tUNKNOWN STEP\t2026-09-18T11:30:00Z one\n\ngates\tUNKNOWN STEP\t2026-09-18T11:30:00Z two\n\n\n');
    expect(lines.map((line) => line.text)).toEqual(['one', '', 'two']);
  });
});

describe('the failing step', () => {
  it('answers the step of the first captured error and not the later one', () => {
    const step = readFailedStep(parseFailedLog(CAPTURED_TWO_FAILURES));
    expect(step).toEqual({ name: FIRST_STEP, source: 'group-marker' });
    // The control: the capture really does carry a later error under a
    // different step, so the reading could have come out the other way.
    expect(CAPTURED_TWO_FAILURES).toContain(`${GROUP_STEP_PREFIX}${SECOND_STEP}`);
    expect(CAPTURED_TWO_FAILURES.indexOf(CAPTURED_SECOND_ERROR))
      .toBeGreaterThan(CAPTURED_TWO_FAILURES.indexOf(CAPTURED_SECOND_GROUP));
  });

  it('prefers a step column the provider filled over the group it would infer', () => {
    const log = [
      namedStepLine(UNKNOWN_STEP, `${GROUP_STEP_PREFIX}bun install`),
      namedStepLine('Install dependencies', `${ERROR_PREFIX}Process completed with exit code 1.`),
    ].join('\n');
    expect(readFailedStep(parseFailedLog(log)))
      .toEqual({ name: 'Install dependencies', source: 'step-column' });
  });

  it('falls back to the last group head when no line reports an error', () => {
    const heads = [
      `${GROUP_STEP_PREFIX}bun install --frozen-lockfile`,
      'some output',
      `${GROUP_STEP_PREFIX}bun test`,
      'more output',
    ];
    expect(readFailedStep(parseFailedLog(logFailedText('gates', heads))))
      .toEqual({ name: 'bun test', source: 'group-marker' });
    // The control: an error under the first step moves the answer back to it.
    const withError = [...heads.slice(0, 2), `${ERROR_PREFIX}Process completed with exit code 1.`, ...heads.slice(2)];
    expect(readFailedStep(parseFailedLog(logFailedText('gates', withError))))
      .toEqual({ name: 'bun install --frozen-lockfile', source: 'group-marker' });
  });

  it('falls back to a named step column when no error line and no group head', () => {
    const log = [namedStepLine('Run tests', 'nothing else to go on')].join('\n');
    expect(readFailedStep(parseFailedLog(log)))
      .toEqual({ name: 'Run tests', source: 'step-column' });
  });

  it('answers no step when nothing in the capture names one', () => {
    expect(readFailedStep(parseFailedLog(bulkLog(3)))).toBeUndefined();
    expect(readFailedStep(parseFailedLog(''))).toBeUndefined();
  });

  it('ignores a group that is not a step head', () => {
    const log = logFailedText('gates', [
      '##[group]Runner Image Provisioner',
      `${ERROR_PREFIX}Process completed with exit code 1.`,
    ]);
    expect(readFailedStep(parseFailedLog(log))).toBeUndefined();
  });
});

describe('the tail', () => {
  it('caps at forty lines, keeping the last of them and counting what it dropped', () => {
    expect(FAILED_LOG_TAIL_LINES).toBe(40);
    const evidence = readFailedLog(bulkLog(60));
    expect(evidence.total).toBe(60);
    expect(evidence.lines).toHaveLength(40);
    expect(evidence.omitted).toBe(20);
    expect(evidence.lines[0]).toBe('line 21');
    expect(evidence.lines.at(-1)).toBe('line 60');
  });

  it('keeps every line of a capture under the cap and drops nothing', () => {
    const evidence = readFailedLog(bulkLog(5));
    expect(evidence.lines).toEqual(['line 1', 'line 2', 'line 3', 'line 4', 'line 5']);
    expect(evidence.omitted).toBe(0);
    expect(evidence.total).toBe(5);
  });

  it('honours a caller cap', () => {
    const evidence = readFailedLog(bulkLog(60), { maxLines: 3 });
    expect(evidence.lines).toEqual(['line 58', 'line 59', 'line 60']);
    expect(evidence.omitted).toBe(57);
  });

  it('refuses a cap that is not a positive whole number', () => {
    for (const [maxLines, quoted] of [[0, '0'], [-1, '-1'], [1.5, '1.5'], [Number.NaN, 'NaN']] as const) {
      expect(() => readFailedLog(bulkLog(2), { maxLines })).toThrow(
        `pr triage evidence: readFailedLog refused a line cap ${quoted},`
          + ' expected a positive whole number',
      );
    }
  });

  it('reads the empty string the port answers for a dropped log as no evidence', () => {
    expect(readFailedLog('')).toEqual({
      jobs: [], step: undefined, lines: [], omitted: 0, total: 0,
    });
  });
});

describe('the jobs a capture covers', () => {
  it('names each job once, in the order it first appears', () => {
    const log = `${bulkLog(2, 'lint')}${bulkLog(2, 'test')}${bulkLog(1, 'lint')}`;
    expect(readJobs(parseFailedLog(log))).toEqual(['lint', 'test']);
  });

  it('names the job of the captured run, and none for a log with no columns', () => {
    expect(readFailedLog(CAPTURED_TWO_FAILURES).jobs).toEqual(['detection']);
    expect(readFailedLog('no columns here').jobs).toEqual([]);
  });
});
