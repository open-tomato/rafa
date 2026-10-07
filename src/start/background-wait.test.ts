/**
 * Tests for {@link readBackgroundWait}: the negatives first, each an
 * output a finished or a reporting session writes, then the waits. Every
 * negative is paired with a positive that differs from it in the one
 * thing the reader keys on, so a reader answering `null` for everything
 * reddens the positives and one answering a line for everything reddens
 * the negatives.
 */
import { describe, expect, it } from 'bun:test';

import { readBackgroundWait } from './background-wait.js';

/** A fence, kept out of the template literals. */
const FENCE = '```';

/** A readable report block saying `done`. */
const REPORT = [
  `${FENCE}rafa:report`,
  'status: done',
  'feedback: "all of it"',
  'blockers: []',
  FENCE,
].join('\n');

/** The line a session writes when it backgrounds the suite and stops. */
const RUNNING = 'The full suite (`bun test`) is running in the background; I will report once it finishes.';

describe('readBackgroundWait: what is no wait', () => {
  it('answers null for a finished message that uses "background" as a word in prose', () => {
    const output = [
      'Fixed the parser. The background of this bug is an old fence rule.',
      'All gates are green; nothing ran in the background.',
    ].join('\n');

    expect(readBackgroundWait(output)).toBeNull();
  });

  it('answers null for a message that carries a report block, even one naming a wait', () => {
    expect(readBackgroundWait(`${RUNNING}\n\n${REPORT}\n`)).toBeNull();
    // An unreadable block is still a block the session wrote.
    expect(readBackgroundWait(`${RUNNING}\n\n${FENCE}rafa:report\nstatus: done: twice\n${FENCE}\n`))
      .toBeNull();

    // The control: the same line with no block names the wait.
    expect(readBackgroundWait(RUNNING)).toBe(RUNNING);
  });

  it('answers null for an empty output', () => {
    expect(readBackgroundWait('')).toBeNull();
    expect(readBackgroundWait('  \n\n')).toBeNull();
  });

  it('answers null for a wait quoted inside a fence', () => {
    expect(readBackgroundWait(`Here is the log:\n${FENCE}\n${RUNNING}\n${FENCE}\nDone.`)).toBeNull();
  });
});

describe('readBackgroundWait: what is a wait', () => {
  it('answers the line saying a command is running in the background', () => {
    const output = `Edits are in.\n\n  ${RUNNING}  \n`;

    expect(readBackgroundWait(output)).toBe(RUNNING);
  });

  it('answers the line saying it will wait for the notification', () => {
    const line = 'Started `bun test` and I will wait for the notification before writing the report.';

    expect(readBackgroundWait(`Work is staged.\n${line}`)).toBe(line);
    expect(readBackgroundWait('Waiting on the completion notification.'))
      .toBe('Waiting on the completion notification.');
  });

  it('answers the line mentioning run_in_background', () => {
    const line = 'Launched `bun test` with `run_in_background: true`.';

    expect(readBackgroundWait(`Done editing.\n${line}\nMore soon.`)).toBe(line);
  });

  it('answers the first waiting line, capped to a quotable length', () => {
    const long = `${'x'.repeat(300)} running in the background`;
    const answered = readBackgroundWait(`${RUNNING}\n${long}`);
    const cappedLong = readBackgroundWait(long);

    expect(answered).toBe(RUNNING);
    expect(cappedLong?.length).toBe(200);
    expect(cappedLong?.endsWith('…')).toBe(true);
  });
});
