/**
 * Tests for the blocked-issue reading (`doctor-blocked.ts`): the two
 * `gh` commands it sends, the faults it names, the ids it refuses to
 * call unknown, and the lines `rafa doctor` prints for them.
 *
 * Every case drives a recorded runner of its own, one that answers the
 * two listings from a literal board and fails every other command, so
 * no case reaches GitHub, spawns `gh`, or reads a repository. The
 * argument lists are kept, which is how the cases about the SECOND
 * command hold that it was or was not sent.
 *
 * ## The controls
 *
 * Three readings here could pass while wrong, and each is paired:
 *
 *  - The unknown-id case runs one board twice, once where the named id
 *    is on the board and once where it is not, and holds the fault
 *    against no fault. Without the pair, a reader that called every id
 *    unknown would look correct on the first half alone.
 *  - The truncation case runs the same named id against a board
 *    answering the listing's own limit and against one answering fewer,
 *    and holds `unchecked` against a reported fault. A reader that
 *    ignored the limit would report a real issue as unknown.
 *  - The second-command case pairs a board whose line names ids with
 *    one whose line names none, and holds two commands against one.
 *
 * ## Mutations driven
 *
 * Two mutations of `./doctor-blocked.ts` were driven against these
 * cases on 2026-09-21, the file run alone on a baseline of 20 pass and
 * restored from a scratch copy verified by sha256: the full-listing
 * guard dropped, so a board answering its own limit reports an id it
 * never read, reddened 2 cases; the `known` set dropped from the final
 * reading, so no id is ever checked, reddened 3.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { SPEC_BLOCKED_LABEL } from '../board/blocked.js';

import {
  BLOCKED_HEADING,
  BLOCKED_LIST_LIMIT,
  KNOWN_LIST_LIMIT,
  readBlockedIssues,
  renderBlockedIssues,
} from './doctor-blocked.js';

/** One open issue labelled `spec:blocked`, as the listing answers it. */
interface BlockedIssue {
  readonly number: number;
  readonly body: string;
}

/** What a case's runner answers. */
interface FakeBoard {
  /** The open issues labelled `spec:blocked`, with their bodies. */
  readonly blocked?: readonly BlockedIssue[];
  /** Every issue number the board holds, open and closed. */
  readonly known?: readonly number[];
  /** What the blocked listing answers instead, when the case is about a refusal. */
  readonly blockedResult?: GhResult;
  /** What the board listing answers instead, when the case is about a refusal. */
  readonly knownResult?: GhResult;
}

/** A runner over `board`, and the argument lists it was handed. */
function fakeGh(board: FakeBoard = {}): { run: GhRunner; calls: () => readonly (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });
  const run: GhRunner = (args) => {
    calls.push(args);
    if (args.includes('--label')) {
      return board.blockedResult === undefined
        ? ok(JSON.stringify(board.blocked ?? []))
        : Promise.resolve(board.blockedResult);
    }
    if (args.includes('--state') && args.includes('all')) {
      return board.knownResult === undefined
        ? ok(JSON.stringify((board.known ?? []).map((number) => ({ number }))))
        : Promise.resolve(board.knownResult);
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` });
  };
  return { run, calls: () => calls };
}

/** A body holding `lines`, each on its own line. */
function body(...lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

/** The report of `board`, read through a runner of its own. */
async function report(board: FakeBoard): ReturnType<typeof readBlockedIssues> {
  return readBlockedIssues({ gh: fakeGh(board).run });
}

describe('the commands it sends', () => {
  it('lists the open issues carrying the label, asking for their bodies', async () => {
    const gh = fakeGh();

    await readBlockedIssues({ gh: gh.run });

    expect(gh.calls()).toEqual([[
      'issue', 'list',
      '--state', 'open',
      '--label', SPEC_BLOCKED_LABEL,
      '--limit', String(BLOCKED_LIST_LIMIT),
      '--json', 'number,body',
    ]]);
  });

  it('lists the board only once a line named ids, where a line naming none costs one command', async () => {
    const naming = fakeGh({ blocked: [{ number: 12, body: body('Blocked by: #24') }], known: [12, 24] });
    const none = fakeGh({ blocked: [{ number: 12, body: body('Blocked by: the API work') }] });

    await readBlockedIssues({ gh: naming.run });
    await readBlockedIssues({ gh: none.run });

    expect(naming.calls().map((args) => args.join(' '))).toEqual([
      `issue list --state open --label ${SPEC_BLOCKED_LABEL} --limit ${String(BLOCKED_LIST_LIMIT)} --json number,body`,
      `issue list --state all --limit ${String(KNOWN_LIST_LIMIT)} --json number`,
    ]);
    expect(none.calls().length).toBe(1);
  });

  it('sends nothing more for a board with no issue carrying the label', async () => {
    const gh = fakeGh({ blocked: [] });

    const read = await readBlockedIssues({ gh: gh.run });

    expect(read.readings).toEqual([]);
    expect(read.faults).toEqual([]);
    expect(gh.calls().length).toBe(1);
  });
});

describe('the faults it names', () => {
  it('reports an issue whose body carries no Blocked by line', async () => {
    const read = await report({ blocked: [{ number: 12, body: body('## What you get', '', 'The state reader.') }] });

    expect(read.readings.map((one) => one.kind)).toEqual(['no-line']);
    expect(read.faults).toEqual([
      `#12 is labelled ${SPEC_BLOCKED_LABEL} and its body carries no "Blocked by:" line;`
        + ` name them as "Blocked by: #24 #26", or take the ${SPEC_BLOCKED_LABEL} label off`,
    ]);
  });

  it('reports a line naming no issue, quoting what it said', async () => {
    const read = await report({ blocked: [{ number: 12, body: body('Blocked by: the API work') }] });

    expect(read.readings.map((one) => one.kind)).toEqual(['no-ids']);
    expect(read.faults[0]).toContain('has a "Blocked by:" line on line 1 naming no issue: "the API work"');
  });

  it('reports a line naming the issue it sits in', async () => {
    const read = await report({ blocked: [{ number: 12, body: body('Blocked by: #12 #24') }], known: [12, 24] });

    expect(read.readings.map((one) => one.kind)).toEqual(['self-reference']);
    expect(read.faults[0]).toContain('naming itself');
  });

  it('names every faulted issue in board order, and leaves out the one that reads', async () => {
    const read = await report({
      blocked: [
        { number: 12, body: body('Blocked by: #24') },
        { number: 13, body: body('nothing here') },
        { number: 14, body: body('Blocked by: none of them') },
      ],
      known: [12, 13, 14, 24],
    });

    expect(read.readings.map((one) => one.issue)).toEqual([12, 13, 14]);
    expect(read.faults.map((fault) => fault.slice(0, 3))).toEqual(['#13', '#14']);
    expect(read.problem).toBe(null);
    expect(read.unchecked).toBe(null);
  });
});

describe('an id the board has no issue for', () => {
  it('is reported, where the same id on the board is not', async () => {
    const blocked = [{ number: 12, body: body('Blocked by: #900') }];

    const read = await report({ blocked, known: [12, 24] });
    const control = await report({ blocked, known: [12, 900] });

    expect(read.readings.map((one) => one.kind)).toEqual(['unknown-issue']);
    expect(read.faults[0]).toContain('naming #900, which the board has no issue for');
    expect(control.readings.map((one) => one.kind)).toEqual(['blocked']);
    expect(control.faults).toEqual([]);
  });

  it('counts a closed issue as one the board has, since closing is what clears a blocker', async () => {
    const read = await report({ blocked: [{ number: 12, body: body('Blocked by: #24') }], known: [12, 24] });

    expect(read.readings[0]?.kind).toBe('blocked');
    expect(read.readings[0]?.blockers).toEqual([24]);
  });

  it('is not reported when the board listing came back full, where a shorter one reports it', async () => {
    const blocked = [{ number: 12, body: body('Blocked by: #900') }];
    const full = Array.from({ length: KNOWN_LIST_LIMIT }, (_unused, index) => index + 1);

    const read = await report({ blocked, known: full });
    const control = await report({ blocked, known: full.slice(0, -1) });

    expect(read.faults).toEqual([]);
    expect(read.unchecked).toBe(
      `the board answered the ${String(KNOWN_LIST_LIMIT)} issues the listing asked for and may hold more,`
        + ' so no blocker id was checked against it',
    );
    expect(control.faults[0]).toContain('which the board has no issue for');
    expect(control.unchecked).toBe(null);
  });

  it('is not reported when the board listing failed, while the faults the bodies alone decide still are', async () => {
    const read = await report({
      blocked: [
        { number: 12, body: body('Blocked by: #900') },
        { number: 13, body: body('no line at all') },
      ],
      knownResult: { ok: false, stdout: '', stderr: 'HTTP 502: Bad gateway' },
    });

    expect(read.faults.map((fault) => fault.slice(0, 3))).toEqual(['#13']);
    expect(read.unchecked).toBe(
      `board blocked: gh issue list --state all --limit ${String(KNOWN_LIST_LIMIT)} --json number`
        + ' failed: HTTP 502: Bad gateway, so no blocker id was checked against the board',
    );
  });
});

describe('a reading that could not be made', () => {
  it('comes back as the problem, naming the command and what gh wrote', async () => {
    const read = await report({ blockedResult: { ok: false, stdout: '', stderr: 'HTTP 401: Bad credentials' } });

    expect(read.readings).toEqual([]);
    expect(read.problem).toBe(
      `board blocked: gh issue list --state open --label ${SPEC_BLOCKED_LABEL}`
        + ` --limit ${String(BLOCKED_LIST_LIMIT)} --json number,body failed: HTTP 401: Bad credentials`,
    );
  });

  it('comes back as the problem for an answer that is not JSON', async () => {
    const read = await report({ blockedResult: { ok: true, stdout: 'not json', stderr: '' } });

    expect(read.problem).toContain('wrote output that is not JSON');
  });

  it('comes back as the problem for a row carrying no body', async () => {
    const read = await report({ blockedResult: { ok: true, stdout: '[{"number":12}]', stderr: '' } });

    expect(read.problem).toContain('answered issue 0.body as undefined, expected a string');
  });

  it('comes back as the problem for an answer that is not a list', async () => {
    const read = await report({ blockedResult: { ok: true, stdout: '{"number":12}', stderr: '' } });

    expect(read.problem).toContain('expected a list of issues');
  });
});

describe('the lines it prints', () => {
  it('names every fault under the heading', async () => {
    const read = await report({
      blocked: [
        { number: 12, body: body('nothing here') },
        { number: 13, body: body('Blocked by: #900') },
      ],
      known: [12, 13],
    });

    const printed = renderBlockedIssues(read);

    expect(printed[0]).toBe(BLOCKED_HEADING);
    expect(printed.length).toBe(3);
    expect(printed[1]).toStartWith('  #12 is labelled ');
    expect(printed[2]).toStartWith('  #13 has a ');
  });

  it('says what was read when every line reads, naming each blocker once', async () => {
    const read = await report({
      blocked: [
        { number: 12, body: body('Blocked by: #24') },
        { number: 13, body: body('Blocked by: #24 #26') },
      ],
      known: [12, 13, 24, 26],
    });

    expect(renderBlockedIssues(read)).toEqual([
      BLOCKED_HEADING,
      `  2 issues labelled ${SPEC_BLOCKED_LABEL}, naming 2 blockers this run could read`,
    ]);
  });

  it('ends on the line saying no id was checked, under the faults the bodies decided', async () => {
    const read = await report({
      blocked: [{ number: 12, body: body('Blocked by: #900') }],
      known: Array.from({ length: KNOWN_LIST_LIMIT }, (_unused, index) => index + 1),
    });

    const printed = renderBlockedIssues(read);

    expect(printed[0]).toBe(BLOCKED_HEADING);
    expect(printed[printed.length - 1]).toStartWith('  the board answered the ');
  });

  it('prints the problem under the heading for a reading that could not be made', async () => {
    const read = await report({ blockedResult: { ok: false, stdout: '', stderr: 'HTTP 401: Bad credentials' } });

    expect(renderBlockedIssues(read)).toEqual([
      BLOCKED_HEADING,
      `  the issues labelled ${SPEC_BLOCKED_LABEL} could not be read: ${read.problem ?? ''}`,
    ]);
  });

  it('prints nothing for a board with no issue carrying the label, and nothing for a project with no board', async () => {
    const read = await report({ blocked: [] });

    expect(renderBlockedIssues(read)).toEqual([]);
    expect(renderBlockedIssues(null)).toEqual([]);
  });
});
