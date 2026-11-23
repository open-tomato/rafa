import type { AppendRun, AppendStep, RecurrenceAppend } from './recurrence-append.js';
import type { EditableIssue, IssueRef, Tracker } from '@open-tomato/rafa/ports';

import { describe, expect, test } from 'bun:test';

import { recurrenceAddition } from './issue-text.js';
import { appendAfterComment } from './recurrence-append.js';

const REF: IssueRef = { opt: 7, kind: 'local', externalId: '7', url: null };
const REASON = 'recurrence (plan p, task 3)';
const SECRET = 'hunter2';

/** Takes out the fixture's one secret, as a run's redactor would. */
const redact = (text: string): string => text.replaceAll(SECRET, '[redacted]');

/** A tracker whose only working call is `editable`; every other call throws. */
function trackerWith(editable?: (ref: IssueRef) => Promise<EditableIssue>): Tracker {
  const unused = (): never => {
    throw new Error('not called by the append');
  };
  return {
    kind: 'local',
    capabilities: unused,
    preflight: unused,
    find: unused,
    get: unused,
    create: unused,
    comment: unused,
    transition: unused,
    ...editable === undefined
      ? {}
      : { editable },
  };
}

/** An issue whose body is `body`. */
function issueWith(body: string): EditableIssue {
  return { ref: REF, title: 'a bug', body, open: true, labels: [], author: '' };
}

interface SeamCall {
  readonly ref: IssueRef;
  readonly reason: string;
  readonly text: string;
}

/** A seam answering `answer`, recording each call. */
function seamOf(answer: () => Promise<RecurrenceAppend>): { readonly step: AppendStep; readonly calls: SeamCall[] } {
  const calls: SeamCall[] = [];
  const step: AppendStep = {
    reason: REASON,
    update: (ref, reason, text) => {
      calls.push({ ref, reason, text });
      return answer();
    },
  };
  return { step, calls };
}

function runOf(tracker: Tracker, append: AppendStep | null, reproduce: string | null): AppendRun {
  return { route: { channel: 'public', tracker, append }, filing: { reproduce }, redact };
}

const APPENDED = async (): Promise<RecurrenceAppend> => ({ outcome: 'appended', problem: null });

describe('appendAfterComment', () => {
  test('calls the seam with the reason and the fenced, redacted text, and answers its outcome', async () => {
    const { step, calls } = seamOf(APPENDED);
    const tracker = trackerWith(async () => issueWith('the body'));

    const answered = await appendAfterComment(runOf(tracker, step, `run it with ${SECRET}`), REF);

    expect(answered).toEqual({ outcome: 'appended', problem: null });
    expect(calls).toEqual([{ ref: REF, reason: REASON, text: recurrenceAddition(`run it with ${SECRET}`, redact) }]);
    expect(calls[0]?.text).not.toContain(SECRET);
  });

  test('answers held and leaves the seam uncalled when the body holds the redacted text', async () => {
    const { step, calls } = seamOf(APPENDED);
    const tracker = trackerWith(async () => issueWith('steps:\r\nrun it with [redacted]\r\n'));

    expect(await appendAfterComment(runOf(tracker, step, `run it with ${SECRET}`), REF))
      .toEqual({ outcome: 'held', problem: null });
    expect(calls).toEqual([]);
  });

  test('tries nothing without a seam, a reproduce text of its own or an editable tracker', async () => {
    const { step, calls } = seamOf(APPENDED);
    const editable = trackerWith(async () => issueWith('the body'));

    expect(await appendAfterComment(runOf(editable, null, 'run it'), REF)).toBeNull();
    expect(await appendAfterComment(runOf(editable, step, null), REF)).toBeNull();
    expect(await appendAfterComment(runOf(trackerWith(), step, 'run it'), REF)).toBeNull();
    expect(calls).toEqual([]);
  });

  test('answers failed, redacted, when the body read rejects', async () => {
    const { step, calls } = seamOf(APPENDED);
    const tracker = trackerWith(async () => {
      throw new Error(`denied for ${SECRET}`);
    });

    expect(await appendAfterComment(runOf(tracker, step, 'run it'), REF))
      .toEqual({ outcome: 'failed', problem: 'the public tracker editable failed: denied for [redacted]' });
    expect(calls).toEqual([]);
  });

  test('answers failed, redacted, when the seam rejects', async () => {
    const { step } = seamOf(async () => {
      throw new Error(`write refused for ${SECRET}`);
    });
    const tracker = trackerWith(async () => issueWith('the body'));

    expect(await appendAfterComment(runOf(tracker, step, 'run it'), REF))
      .toEqual({ outcome: 'failed', problem: 'the recurrence append failed: write refused for [redacted]' });
  });

  test('keeps the seam outcome and redacts the problem it names', async () => {
    const { step } = seamOf(async () => ({ outcome: 'refused', problem: `planned with ${SECRET}` }));
    const tracker = trackerWith(async () => issueWith('the body'));

    expect(await appendAfterComment(runOf(tracker, step, 'run it'), REF))
      .toEqual({ outcome: 'refused', problem: 'planned with [redacted]' });
  });
});
