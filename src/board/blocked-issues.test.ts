/**
 * Tests for the blocked issues of a board (`board/blocked-issues.ts`):
 * the report `readBlockedIssues` answers, held as data.
 *
 * Every case drives a recorded runner of its own, answering the two
 * listings from a literal board and failing every other command, so no
 * case reaches GitHub or spawns `gh`. The sentences of each fault, the
 * exact argument lists and the lines `rafa doctor` prints for a report
 * are covered by `commands/doctor-blocked.test.ts`, which drives the
 * reading and its lines together; these cases hold what a caller
 * outside `src/commands/` reads off the report.
 *
 * Each reading sits beside its control: a board whose line names ids
 * beside one whose line names none (two commands against one), a
 * numbers listing answering its own limit beside one answering fewer
 * (`unchecked` against a reported fault), and a listing that failed
 * beside one that answered (`problem` against null).
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { BLOCKED_LIST_LIMIT, KNOWN_LIST_LIMIT, readBlockedIssues } from './blocked-issues.js';

/** What a case's runner answers. */
interface FakeBoard {
  /** The open issues labelled `spec:blocked`, with their bodies. */
  readonly blocked: readonly { number: number; body: string }[];
  /** Every issue number the board holds, open and closed. */
  readonly known: readonly number[];
  /** What the blocked listing answers instead, when the case is about a refusal. */
  readonly blockedResult?: GhResult;
}

/** A runner over `board`, and the argument lists it was handed. */
function fakeGh(board: FakeBoard): { run: GhRunner; calls: () => readonly (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });
  const run: GhRunner = (args) => {
    calls.push(args);
    if (args.includes('--label')) {
      return board.blockedResult === undefined
        ? ok(JSON.stringify(board.blocked))
        : Promise.resolve(board.blockedResult);
    }
    if (args.includes('--state') && args.includes('all')) {
      return ok(JSON.stringify(board.known.map((number) => ({ number }))));
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` });
  };
  return { run, calls: () => calls };
}

/** The first `count` issue numbers of a board. */
function numbers(count: number): readonly number[] {
  return Array.from({ length: count }, (_unused, index) => index + 1);
}

describe('the report of a board', () => {
  it('reads every listed issue in the board\'s order, with one fault per unreadable line', async () => {
    const gh = fakeGh({
      blocked: [
        { number: 12, body: 'Blocked by: #3\n' },
        { number: 9, body: 'No line here.\n' },
      ],
      known: [3, 9, 12],
    });

    const read = await readBlockedIssues({ gh: gh.run });

    expect(read.readings.map((reading) => [reading.issue, reading.kind])).toEqual([[12, 'blocked'], [9, 'no-line']]);
    expect(read.readings[0]?.blockers).toEqual([3]);
    expect(read.faults).toHaveLength(1);
    expect(read.faults[0]).toStartWith('#9 ');
    expect(read.problem).toBeNull();
    expect(read.unchecked).toBeNull();
    expect(Object.isFrozen(read)).toBe(true);
  });

  it('sends the numbers listing only when a line named ids', async () => {
    const naming = fakeGh({ blocked: [{ number: 12, body: 'Blocked by: #3\n' }], known: [3, 12] });
    const none = fakeGh({ blocked: [{ number: 12, body: 'No line here.\n' }], known: [3, 12] });

    await readBlockedIssues({ gh: naming.run });
    await readBlockedIssues({ gh: none.run });

    expect(naming.calls()).toHaveLength(2);
    expect(none.calls()).toHaveLength(1);
    expect(naming.calls()[0]).toContain(String(BLOCKED_LIST_LIMIT));
    expect(naming.calls()[1]).toContain(String(KNOWN_LIST_LIMIT));
  });
});

describe('an id the board has no issue for', () => {
  const blocked = [{ number: 2, body: `Blocked by: #${String(KNOWN_LIST_LIMIT + 400)}\n` }];

  it('is a fault when the whole board was read, and unchecked when the listing came back full', async () => {
    const whole = await readBlockedIssues({ gh: fakeGh({ blocked, known: numbers(KNOWN_LIST_LIMIT - 1) }).run });
    const full = await readBlockedIssues({ gh: fakeGh({ blocked, known: numbers(KNOWN_LIST_LIMIT) }).run });

    expect(whole.faults).toHaveLength(1);
    expect(whole.unchecked).toBeNull();
    expect(full.faults).toEqual([]);
    expect(full.unchecked).toContain('no blocker id was checked');
  });
});

describe('a listing that failed', () => {
  it('answers the failure as the problem, with no reading, and does not reject', async () => {
    const failed = fakeGh({
      blocked: [],
      known: [],
      blockedResult: { ok: false, stdout: '', stderr: 'HTTP 401: Bad credentials' },
    });
    const answered = fakeGh({ blocked: [], known: [] });

    const problem = await readBlockedIssues({ gh: failed.run });
    const clean = await readBlockedIssues({ gh: answered.run });

    expect(problem.readings).toEqual([]);
    expect(problem.problem).toStartWith('board blocked: gh issue list --state open');
    expect(problem.problem).toEndWith('failed: HTTP 401: Bad credentials');
    expect(clean.problem).toBeNull();
  });
});
