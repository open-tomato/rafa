/**
 * Tests for the project's runner opened retrying (`./project-runner.ts`):
 * the line and the event a retry is reported as, the reporter in each
 * mode, the two config keys the runner is opened with, and that a runner
 * opened twice retries once.
 *
 * The classes and the waits are `./retry.test.ts`'s; here every failure
 * is the measured `operation timed out` unless a case says otherwise.
 *
 * ## The controls
 *
 *  - Each "retried" reading sits beside the same runner with
 *    `retries: false`, which sends the call once and answers the planted
 *    failure, so the count of calls is the wrapper's doing.
 *  - The reopen case's count, three calls for two retries, is held
 *    against nine: the count a runner wrapped twice would send.
 *  - The json reporter's case reads the same notice in text mode, so the
 *    mode alone picks the line or the event.
 */
import type { RetryNotice } from './retry.js';
import type { CliEvent } from '../../ports/index.js';

import { afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../../adapters/output/active.js';
import { sinkOutput } from '../../tests/output-sinks.js';

import {
  activeRetryReport,
  commandRetrySeams,
  openProjectRunner,
  RETRY_EVENT,
  retryEvent,
  retryLine,
  retryReporter,
} from './project-runner.js';
import { answeringGh, flakyGh, recordRetries, TIMED_OUT_STDERR } from './retry-fake.js';

/** The retry of the first live run: issue #725, the first of three. */
const NOTICE: RetryNotice = {
  attempt: 1,
  of: 3,
  reason: 'operation timed out',
  subject: '#725',
  number: 725,
  waitMs: 2000,
  args: ['api', 'graphql', '-F', 'number=725'],
};

/** The defaults of the two keys: 3 retries from a 2 s wait. */
const DEFAULTS = { boardProjectRetries: 3, boardProjectRetryWaitSeconds: 2 } as const;

/** The call of issue #725, as a facts read carries it. */
const CALL_725 = ['api', 'graphql', '-F', 'number=725'];

/** The stamp every event of these cases carries. */
const NOW = new Date('2026-10-08T12:00:00.000Z');

afterEach(() => {
  setActiveOutput(null);
});

/** Lines and events written to an output, by kind. */
interface Captured {
  readonly info: string[];
  readonly warn: string[];
  readonly events: CliEvent[];
}

/** An output capturing what `retryReporter` writes. */
function capture(): { readonly captured: Captured; readonly output: ReturnType<typeof sinkOutput> } {
  const captured: Captured = { info: [], warn: [], events: [] };
  const output = sinkOutput({
    info: (line) => captured.info.push(line),
    warn: (line) => captured.warn.push(line),
    event: (event) => captured.events.push(event),
  });
  return { captured, output };
}

describe('retryLine and retryEvent', () => {
  it('spells the retry as the spec has it: retrying #725 (1 of 3): operation timed out', () => {
    expect(retryLine(NOTICE)).toBe('retrying #725 (1 of 3): operation timed out');
  });

  it('names what the call reads when it carries no issue', () => {
    expect(retryLine({ ...NOTICE, subject: 'repository', number: undefined, attempt: 2 })).toBe('retrying repository (2 of 3): operation timed out');
  });

  it('makes one named retry event whose summary is the line and whose data holds the retry', () => {
    expect(retryEvent(NOTICE, NOW)).toEqual({
      type: 'event',
      name: RETRY_EVENT,
      summary: 'retrying #725 (1 of 3): operation timed out',
      data: { attempt: 1, of: 3, reason: 'operation timed out', subject: '#725', number: 725, waitMs: 2000 },
      ts: '2026-10-08T12:00:00.000Z',
    });
    expect(RETRY_EVENT).toBe('retry');
  });

  it('writes a null number into the event of a call that names no issue', () => {
    expect(retryEvent({ ...NOTICE, subject: 'repository', number: undefined }, NOW).data['number']).toBe(null);
  });
});

describe('retryReporter', () => {
  it('writes one info line in text mode, with no warn prefix and no event', () => {
    const { captured, output } = capture();

    retryReporter(output, 'text', () => NOW)(NOTICE);

    expect(captured).toEqual({ info: ['retrying #725 (1 of 3): operation timed out'], warn: [], events: [] });
  });

  it('writes one retry event in json mode, and no line', () => {
    const { captured, output } = capture();

    retryReporter(output, 'json', () => NOW)(NOTICE);

    expect(captured).toEqual({ info: [], warn: [], events: [retryEvent(NOTICE, NOW)] });
  });

  it('reports to the output active at the retry, in its mode, when no reporter is handed', () => {
    const { captured, output } = capture();
    setActiveOutput(output, 'json');

    activeRetryReport(NOTICE);

    expect(captured.events.map((event) => event.type === 'event' && event.name)).toEqual([RETRY_EVENT]);
  });
});

describe('openProjectRunner', () => {
  it('sends a timed-out call again with the two keys off the config, and answers the call that went through', async () => {
    const flaky = flakyGh(answeringGh('{}'), [TIMED_OUT_STDERR, TIMED_OUT_STDERR]);
    const recorder = recordRetries();

    const result = await openProjectRunner(flaky.gh, DEFAULTS, recorder.seams)(CALL_725);

    expect(result.ok).toBe(true);
    expect(flaky.sent().length).toBe(3);
    expect(recorder.waits()).toEqual([2000, 4000]);
    expect(recorder.notices().map(retryLine)).toEqual([
      'retrying #725 (1 of 3): operation timed out',
      'retrying #725 (2 of 3): operation timed out',
    ]);
  });

  it('control: with retries false the same runner sends the call once and answers the failure', async () => {
    const flaky = flakyGh(answeringGh('{}'), [TIMED_OUT_STDERR, TIMED_OUT_STDERR]);
    const recorder = recordRetries();

    const result = await openProjectRunner(flaky.gh, { ...DEFAULTS, boardProjectRetries: false }, recorder.seams)(CALL_725);

    expect([result.ok, flaky.sent().length, recorder.notices().length]).toEqual([false, 1, 0]);
  });

  it('sends a NOT_FOUND once, reporting no retry', async () => {
    const flaky = flakyGh(answeringGh('{}'), ['GraphQL: Could not resolve to an Issue with the number of 725. (NOT_FOUND)\n']);
    const recorder = recordRetries();

    const result = await openProjectRunner(flaky.gh, DEFAULTS, recorder.seams)(CALL_725);

    expect([result.ok, flaky.sent().length, recorder.notices().length]).toEqual([false, 1, 0]);
  });

  it('hands a runner it opened back unchanged, so a call reopened is retried retries times and not that squared', async () => {
    const failures = Array.from({ length: 10 }, () => TIMED_OUT_STDERR);
    const flaky = flakyGh(answeringGh('{}'), failures);
    const recorder = recordRetries();
    const config = { boardProjectRetries: 2, boardProjectRetryWaitSeconds: 1 };
    const opened = openProjectRunner(flaky.gh, config, recorder.seams);

    const reopened = openProjectRunner(opened, config, recorder.seams);
    const result = await reopened(CALL_725);

    expect(reopened).toBe(opened);
    expect(result.ok).toBe(false);
    expect(flaky.sent().length).toBe(3);
  });

  it('reports to the active output when no reporter is handed', async () => {
    const { captured, output } = capture();
    setActiveOutput(output, 'text');
    const flaky = flakyGh(answeringGh('{}'), [TIMED_OUT_STDERR]);

    await openProjectRunner(flaky.gh, DEFAULTS, { sleep: () => Promise.resolve() })(CALL_725);

    expect(captured.info).toEqual(['retrying #725 (1 of 3): operation timed out']);
  });

  it('refuses a retry count the config schema would refuse when it is opened', () => {
    expect(() => openProjectRunner(answeringGh('{}'), { boardProjectRetries: 0, boardProjectRetryWaitSeconds: 2 })).toThrow(RangeError);
  });
});

describe('commandRetrySeams', () => {
  it('reports to the command output in its mode and waits through the sleep handed', async () => {
    const { captured, output } = capture();
    const waits: number[] = [];
    const seams = commandRetrySeams(output, 'text', (ms) => {
      waits.push(ms);
      return Promise.resolve();
    });
    const flaky = flakyGh(answeringGh('{}'), [TIMED_OUT_STDERR]);

    await openProjectRunner(flaky.gh, DEFAULTS, seams)(CALL_725);

    expect([captured.info, waits]).toEqual([['retrying #725 (1 of 3): operation timed out'], [2000]]);
  });

  it('leaves the sleep out when none is handed, so the opener waits through Bun.sleep', () => {
    const { output } = capture();

    expect(Object.keys(commandRetrySeams(output, 'json'))).toEqual(['onRetry']);
  });
});
