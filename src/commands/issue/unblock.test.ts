/**
 * Tests for `rafa issue unblock` (`unblock.ts`): the blockers read off
 * the board, the question it puts, the one label write, the issues it
 * changes nothing for, and the line refusals.
 *
 * Every case drives a recorded `gh` runner of its own, answering the
 * three commands from a literal board and failing every other command,
 * beside a scripted answer and a recording board. So no case reaches
 * GitHub, spawns `gh` or waits on an answer, and the argument lists are
 * kept, which is how the cases about the SECOND command hold that it
 * was or was not sent and the cases about the write hold that nothing
 * was written.
 *
 * ## The controls
 *
 * Four readings here could pass while wrong, and each is paired:
 *
 *  - The removal case runs one board twice, answering the question yes
 *    and then no, and holds the write against no write. Without the
 *    pair, a run that removed the label whatever was answered would
 *    look correct on the first half alone.
 *  - The open-blocker case runs the same body against a board holding
 *    #24 open and against one holding it closed, so "nothing changed"
 *    is held against the run that does change something.
 *  - The half-read board runs the same blocker against a state listing
 *    answering the limit without it and against a shorter one holding
 *    it closed: the label stays on the first and comes off the second.
 *  - The second-command case pairs a body whose line names ids with one
 *    that names none, and holds two commands against one.
 */
import type { UnblockAsk } from './unblock.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { IssueBoard } from '../../board/issue-board.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { SPEC_BLOCKED_LABEL } from '../../board/blocked.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';
import { KNOWN_LIST_LIMIT } from '../doctor-blocked.js';

import { createIssueUnblockCommand, isUnblockFailure, runUnblock, unblockQuestion, UNBLOCK_USAGE } from './unblock.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-unblock-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

/** One issue on a case's board. */
interface FakeIssue {
  readonly labels?: readonly string[];
  readonly body?: string;
  readonly state?: 'OPEN' | 'CLOSED';
}

/** What a case's runner answers. */
interface FakeBoard {
  /** The issues the board holds, by number. */
  readonly issues?: Readonly<Record<string, FakeIssue>>;
  /** What `gh issue view` answers instead, when the case is about a refusal. */
  readonly viewResult?: GhResult;
  /** What the blocked listing answers instead. */
  readonly blockedResult?: GhResult;
  /** What the state listing answers instead. */
  readonly stateResult?: GhResult;
  /** What `gh issue edit` answers instead. */
  readonly editResult?: GhResult;
}

/** An issue as the fake holds it, every field filled in. */
interface HeldIssue {
  readonly number: number;
  readonly body: string;
  readonly state: 'OPEN' | 'CLOSED';
  readonly labels: readonly string[];
}

/** The issues of a board, each field filled in. */
function heldIssues(board: FakeBoard): readonly HeldIssue[] {
  return Object.entries(board.issues ?? {}).map(([number, issue]) => ({
    number: Number(number),
    body: issue.body ?? '',
    state: issue.state ?? 'OPEN',
    labels: issue.labels ?? [],
  }));
}

/** A runner over `board`, and the argument lists it was handed. */
function fakeGh(board: FakeBoard = {}): {
  run: GhRunner;
  calls: () => readonly (readonly string[])[];
  routes: () => readonly string[];
} {
  const calls: (readonly string[])[] = [];
  const held = heldIssues(board);
  const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });

  const run: GhRunner = (args) => {
    calls.push(args);
    const route = args.slice(0, 2).join(' ');
    if (route === 'issue view') {
      if (board.viewResult !== undefined) return Promise.resolve(board.viewResult);
      const found = held.find((issue) => String(issue.number) === args[2]);
      if (found === undefined) return Promise.resolve({ ok: false, stdout: '', stderr: `no issue ${args[2] ?? ''}` });
      return ok(JSON.stringify({
        number: found.number,
        title: `Issue ${String(found.number)}`,
        body: found.body,
        state: found.state,
        labels: found.labels.map((name) => ({ name })),
        author: { login: 'maintainer' },
      }));
    }
    if (route === 'issue edit') {
      return board.editResult === undefined
        ? ok('')
        : Promise.resolve(board.editResult);
    }
    if (args.includes('--label')) {
      if (board.blockedResult !== undefined) return Promise.resolve(board.blockedResult);
      const blocked = held.filter((issue) => issue.state === 'OPEN' && issue.labels.includes(SPEC_BLOCKED_LABEL));
      return ok(JSON.stringify(blocked.map((issue) => ({ number: issue.number, body: issue.body }))));
    }
    if (args.includes('all')) {
      if (board.stateResult !== undefined) return Promise.resolve(board.stateResult);
      return ok(JSON.stringify(held.map((issue) => ({ number: issue.number, state: issue.state }))));
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` });
  };
  return { run, calls: () => calls, routes: () => calls.map((args) => args.slice(0, 2).join(' ')) };
}

/** An answer to each question in turn, then no, recording what was asked. */
function scriptedAsk(answers: readonly boolean[]): { ask: UnblockAsk; asked: () => readonly string[] } {
  const asked: string[] = [];
  const queue = [...answers];
  const ask: UnblockAsk = (question) => {
    asked.push(question);
    return Promise.resolve(queue.shift() ?? false);
  };
  return { ask, asked: () => asked };
}

/** A board recording its removals, which rejects them when `refuseWith` is given. */
function recordingBoard(refuseWith?: string): {
  board: IssueBoard;
  removed: () => readonly string[];
} {
  const removed: string[] = [];
  const unreached = (): never => {
    throw new Error('the unblock run reached a board member it has no business with');
  };
  const board: IssueBoard = {
    comments: unreached,
    comment: unreached,
    editComment: unreached,
    swapLabels: unreached,
    removeLabel: (issue: number, label: string): Promise<void> => {
      if (refuseWith !== undefined) return Promise.reject(new Error(refuseWith));
      removed.push(`#${String(issue)} ${label}`);
      return Promise.resolve();
    },
  };
  return { board, removed: () => removed };
}

/** A body carrying a `Blocked by:` line and a sentence around it. */
function body(line: string): string {
  return `## Spec\n\nSomething to build.\n\n${line}\n`;
}

/** The state listing of a board holding `count` closed issues numbered from `from`. */
function closedRows(count: number, from = 1000): string {
  return JSON.stringify(Array.from({ length: count }, (unused, index) => ({
    number: from + index,
    state: 'CLOSED',
  })));
}

describe('the question', () => {
  it('spells the issue, its blockers and the label the spec spells', () => {
    expect(unblockQuestion(12, [24, 26])).toBe('#12 was blocked by #24 #26, all closed. Remove spec:blocked? [y/N] ');
  });
});

describe('an issue a line names', () => {
  it('asks the question and removes the label when every blocker is closed', async () => {
    const gh = fakeGh({
      issues: {
        12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24 #26') },
        24: { state: 'CLOSED' },
        26: { state: 'CLOSED' },
      },
    });
    const ask = scriptedAsk([true]);
    const board = recordingBoard();

    const report = await runUnblock({ gh: gh.run, issues: [12], ask: ask.ask, board: board.board });

    expect(ask.asked()).toEqual(['#12 was blocked by #24 #26, all closed. Remove spec:blocked? [y/N] ']);
    expect(board.removed()).toEqual(['#12 spec:blocked']);
    expect(report.issues).toEqual([{
      issue: 12,
      status: 'removed',
      blockers: [24, 26],
      open: [],
      unread: [],
      message: 'Removed spec:blocked from #12',
    }]);
    expect([report.problem, report.unchecked]).toEqual([null, null]);
  });

  it('removes nothing when the same board is answered no', async () => {
    const gh = fakeGh({
      issues: {
        12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24 #26') },
        24: { state: 'CLOSED' },
        26: { state: 'CLOSED' },
      },
    });
    const ask = scriptedAsk([false]);
    const board = recordingBoard();

    const report = await runUnblock({ gh: gh.run, issues: [12], ask: ask.ask, board: board.board });

    expect(ask.asked()).toHaveLength(1);
    expect(board.removed()).toEqual([]);
    expect(report.issues[0]).toMatchObject({ issue: 12, status: 'declined', message: '#12 keeps spec:blocked' });
  });

  it('names the open blocker, asks nothing and changes nothing', async () => {
    const gh = fakeGh({
      issues: {
        57: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24 #26') },
        24: { state: 'OPEN' },
        26: { state: 'CLOSED' },
      },
    });
    const ask = scriptedAsk([true]);
    const board = recordingBoard();

    const report = await runUnblock({ gh: gh.run, issues: [57], ask: ask.ask, board: board.board });

    expect(ask.asked()).toEqual([]);
    expect(board.removed()).toEqual([]);
    expect(report.issues).toEqual([{
      issue: 57,
      status: 'waiting',
      blockers: [24, 26],
      open: [24],
      unread: [],
      message: '#57 is blocked by #24 (open), so spec:blocked stays',
    }]);
  });

  it('leaves the label on with no terminal to ask on, naming the command to run', async () => {
    const gh = fakeGh({
      issues: {
        12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') },
        24: { state: 'CLOSED' },
      },
    });
    const board = recordingBoard();

    const report = await runUnblock({ gh: gh.run, issues: [12], ask: null, board: board.board });

    expect(board.removed()).toEqual([]);
    expect(report.issues[0]).toMatchObject({ issue: 12, status: 'unasked' });
    expect(report.issues[0]?.message).toBe('#12 was blocked by #24, all closed; there is no terminal to ask on,'
      + ' so spec:blocked stays. Run rafa issue unblock 12 where an answer can be typed');
  });

  it('says an issue without the label has nothing to unblock, and asks the board for no state', async () => {
    const gh = fakeGh({ issues: { 12: { labels: ['type:spec'], body: body('Blocked by: #24') } } });
    const ask = scriptedAsk([true]);

    const report = await runUnblock({ gh: gh.run, issues: [12], ask: ask.ask, board: recordingBoard().board });

    expect(gh.routes()).toEqual(['issue view']);
    expect(ask.asked()).toEqual([]);
    expect(report.issues[0]).toMatchObject({
      issue: 12,
      status: 'not-blocked',
      message: '#12 is not labelled spec:blocked, so there is nothing to unblock',
    });
  });

  it('reports the issue that could not be read, and reads the next one anyway', async () => {
    const gh = fakeGh({
      issues: {
        13: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') },
        24: { state: 'CLOSED' },
      },
    });
    const ask = scriptedAsk([true]);
    const board = recordingBoard();

    const report = await runUnblock({ gh: gh.run, issues: [12, 13], ask: ask.ask, board: board.board });

    expect(report.issues.map((issue) => [issue.issue, issue.status])).toEqual([[12, 'failed'], [13, 'removed']]);
    expect(report.issues[0]?.message).toContain('#12 could not be read:');
    expect(board.removed()).toEqual(['#13 spec:blocked']);
  });

  it('reports a removal the board refused, and removes nothing', async () => {
    const gh = fakeGh({
      issues: {
        12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') },
        24: { state: 'CLOSED' },
      },
    });
    const board = recordingBoard('gh issue edit 12 --remove-label spec:blocked failed: no such label');

    const report = await runUnblock({ gh: gh.run, issues: [12], ask: scriptedAsk([true]).ask, board: board.board });

    expect(board.removed()).toEqual([]);
    expect(report.issues[0]).toMatchObject({ issue: 12, status: 'failed' });
    expect(report.issues[0]?.message).toBe('spec:blocked could not be removed from #12:'
      + ' gh issue edit 12 --remove-label spec:blocked failed: no such label');
  });
});

describe('a line the run refuses to guess at', () => {
  it('reports a labelled issue with no Blocked by line, and asks the board for no state', async () => {
    const gh = fakeGh({ issues: { 12: { labels: [SPEC_BLOCKED_LABEL], body: '## Spec\n\nSomething to build.\n' } } });
    const ask = scriptedAsk([true]);

    const report = await runUnblock({ gh: gh.run, issues: [12], ask: ask.ask, board: recordingBoard().board });

    expect(gh.routes()).toEqual(['issue view']);
    expect(ask.asked()).toEqual([]);
    expect(report.issues[0]).toMatchObject({ issue: 12, status: 'fault' });
    expect(report.issues[0]?.message).toContain('carries no "Blocked by:" line');
  });

  it('sends the state listing for a line that names ids, and none for one that names none', async () => {
    const named = fakeGh({
      issues: {
        12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') },
        24: { state: 'CLOSED' },
      },
    });
    const unnamed = fakeGh({ issues: { 12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: the API work') } } });

    await runUnblock({ gh: named.run, issues: [12], ask: null, board: recordingBoard().board });
    const loose = await runUnblock({ gh: unnamed.run, issues: [12], ask: null, board: recordingBoard().board });

    expect(named.routes()).toEqual(['issue view', 'issue list']);
    expect(unnamed.routes()).toEqual(['issue view']);
    expect(loose.issues[0]).toMatchObject({ status: 'fault', blockers: [] });
  });

  it('reports an id the board has no issue for, and takes the same id the board holds', async () => {
    const absent = fakeGh({
      issues: {
        12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') },
        26: { state: 'CLOSED' },
      },
    });
    const present = fakeGh({
      issues: {
        12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') },
        24: { state: 'CLOSED' },
      },
    });
    const board = recordingBoard();

    const unknown = await runUnblock({ gh: absent.run, issues: [12], ask: scriptedAsk([true]).ask, board: board.board });
    const known = await runUnblock({ gh: present.run, issues: [12], ask: scriptedAsk([true]).ask, board: board.board });

    expect(unknown.issues[0]).toMatchObject({ status: 'fault' });
    expect(unknown.issues[0]?.message).toContain('naming #24, which the board has no issue for');
    expect(known.issues[0]).toMatchObject({ status: 'removed' });
    expect(board.removed()).toEqual(['#12 spec:blocked']);
  });

  it('reports a line naming the issue it sits in, asking nothing', async () => {
    const gh = fakeGh({
      issues: {
        12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #12 #24') },
        24: { state: 'CLOSED' },
      },
    });
    const ask = scriptedAsk([true]);

    const report = await runUnblock({ gh: gh.run, issues: [12], ask: ask.ask, board: recordingBoard().board });

    expect(ask.asked()).toEqual([]);
    expect(report.issues[0]?.message).toContain('naming itself');
  });
});

describe('--all, over every open blocked issue', () => {
  it('walks the board in order, asking about the cleared issue alone', async () => {
    const gh = fakeGh({
      issues: {
        12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') },
        13: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24 #26') },
        14: { labels: ['type:spec'], body: body('Blocked by: #24') },
        24: { state: 'CLOSED' },
        26: { state: 'OPEN' },
      },
    });
    const ask = scriptedAsk([true]);
    const board = recordingBoard();

    const report = await runUnblock({ gh: gh.run, issues: null, ask: ask.ask, board: board.board });

    expect(gh.routes()).toEqual(['issue list', 'issue list']);
    expect(ask.asked()).toEqual(['#12 was blocked by #24, all closed. Remove spec:blocked? [y/N] ']);
    expect(board.removed()).toEqual(['#12 spec:blocked']);
    expect(report.issues.map((issue) => [issue.issue, issue.status])).toEqual([[12, 'removed'], [13, 'waiting']]);
    expect(report.issues[1]?.message).toBe('#13 is blocked by #26 (open), so spec:blocked stays');
  });

  it('answers no issue and no problem for a board with none labelled', async () => {
    const gh = fakeGh({ issues: { 24: { state: 'CLOSED' } } });

    const report = await runUnblock({ gh: gh.run, issues: null, ask: null, board: recordingBoard().board });

    expect(gh.routes()).toEqual(['issue list']);
    expect(report).toEqual({ issues: [], problem: null, unchecked: null });
  });

  it('carries a blocked listing that failed as the problem, with no outcome', async () => {
    const gh = fakeGh({ blockedResult: { ok: false, stdout: '', stderr: 'gh: not logged in' } });

    const report = await runUnblock({ gh: gh.run, issues: null, ask: null, board: recordingBoard().board });

    expect(report.issues).toEqual([]);
    expect(report.problem).toBe('board unblock: gh issue list --state open --label spec:blocked'
      + ' --limit 100 --json number,body failed: gh: not logged in');
  });
});

describe('naming, the filter the merge-time run passes', () => {
  /** A board carrying three blocked issues, one per blocker, and both blockers closed. */
  function threeBlocked(): ReturnType<typeof fakeGh> {
    return fakeGh({
      issues: {
        12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') },
        13: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #26') },
        14: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24 #26') },
        24: { state: 'CLOSED' },
        26: { state: 'CLOSED' },
      },
    });
  }

  it('keeps the listed issues whose line names one of them, and drops the rest', async () => {
    const gh = threeBlocked();
    const ask = scriptedAsk([true, true]);
    const board = recordingBoard();

    const report = await runUnblock({
      gh: gh.run,
      issues: null,
      naming: [24],
      ask: ask.ask,
      board: board.board,
    });

    expect(report.issues.map((issue) => issue.issue)).toEqual([12, 14]);
    expect(board.removed()).toEqual(['#12 spec:blocked', '#14 spec:blocked']);
  });

  it('keeps every listed issue when it is left out, which is the control for the filter', async () => {
    const gh = threeBlocked();
    const board = recordingBoard();

    const report = await runUnblock({ gh: gh.run, issues: null, ask: null, board: board.board });

    expect(report.issues.map((issue) => issue.issue)).toEqual([12, 13, 14]);
  });

  it('costs one listing and asks nothing when no listed line names one of them', async () => {
    const gh = threeBlocked();
    const ask = scriptedAsk([true]);

    const report = await runUnblock({
      gh: gh.run,
      issues: null,
      naming: [99],
      ask: ask.ask,
      board: recordingBoard().board,
    });

    expect(report).toEqual({ issues: [], problem: null, unchecked: null });
    expect(gh.routes()).toEqual(['issue list']);
    expect(ask.asked()).toEqual([]);
  });

  it('keeps a line naming itself beside one of them, so the fault is reported and never guessed at', async () => {
    const gh = fakeGh({
      issues: {
        12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #12 #24') },
        24: { state: 'CLOSED' },
      },
    });
    const board = recordingBoard();

    const report = await runUnblock({
      gh: gh.run,
      issues: null,
      naming: [24],
      ask: scriptedAsk([true]).ask,
      board: board.board,
    });

    expect(report.issues.map((issue) => issue.status)).toEqual(['fault']);
    expect(board.removed()).toEqual([]);
  });

  it('is ignored where the line named the issues itself', async () => {
    const gh = threeBlocked();
    const board = recordingBoard();

    const report = await runUnblock({
      gh: gh.run,
      issues: [13],
      naming: [24],
      ask: scriptedAsk([true]).ask,
      board: board.board,
    });

    expect(report.issues.map((issue) => [issue.issue, issue.status])).toEqual([[13, 'removed']]);
  });
});

describe('isUnblockFailure', () => {
  it('is true for the two statuses an operator has something to fix about', () => {
    expect([isUnblockFailure('fault'), isUnblockFailure('failed')]).toEqual([true, true]);
  });

  it('is false for every status that is an ordinary outcome', () => {
    const ordinary = ['removed', 'declined', 'unasked', 'waiting', 'not-blocked'] as const;

    expect(ordinary.map((status) => isUnblockFailure(status))).toEqual([false, false, false, false, false]);
  });
});

describe('a board this run could not read whole', () => {
  it('reports the state listing that failed, asking nothing and removing nothing', async () => {
    const gh = fakeGh({
      issues: { 12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') } },
      stateResult: { ok: false, stdout: '', stderr: 'gh: API rate limit exceeded' },
    });
    const ask = scriptedAsk([true]);
    const board = recordingBoard();

    const report = await runUnblock({ gh: gh.run, issues: [12], ask: ask.ask, board: board.board });

    expect([ask.asked(), board.removed()]).toEqual([[], []]);
    expect(report.issues[0]).toMatchObject({ issue: 12, status: 'failed', blockers: [24] });
    expect(report.issues[0]?.message).toContain('API rate limit exceeded');
    expect(report.issues[0]?.message).toContain('so the state of the issues it names was not read');
  });

  it('leaves the label on a blocker the full listing never named, and takes it off a shorter listing', async () => {
    const full = fakeGh({
      issues: { 12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') } },
      stateResult: { ok: true, stdout: closedRows(KNOWN_LIST_LIMIT), stderr: '' },
    });
    const short = fakeGh({
      issues: { 12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') } },
      stateResult: { ok: true, stdout: JSON.stringify([{ number: 24, state: 'CLOSED' }]), stderr: '' },
    });
    const board = recordingBoard();

    const halfRead = await runUnblock({ gh: full.run, issues: [12], ask: scriptedAsk([true]).ask, board: board.board });
    const whole = await runUnblock({ gh: short.run, issues: [12], ask: scriptedAsk([true]).ask, board: board.board });

    expect(halfRead.issues[0]).toMatchObject({
      status: 'waiting',
      unread: [24],
      message: '#12 is blocked by #24 (state not read), so spec:blocked stays',
    });
    expect(halfRead.unchecked).toBe('the board answered the 500 issues the listing asked for and may hold more,'
      + ' so no blocker id was checked against it');
    expect(whole.issues[0]).toMatchObject({ status: 'removed' });
    expect(board.removed()).toEqual(['#12 spec:blocked']);
  });

  it('reads a state it does not know as no state read, and OPEN and CLOSED however gh cases them', async () => {
    const odd = fakeGh({
      issues: { 12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') } },
      stateResult: { ok: true, stdout: JSON.stringify([{ number: 24, state: 'DRAFT' }]), stderr: '' },
    });
    const cased = fakeGh({
      issues: { 12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') } },
      stateResult: { ok: true, stdout: JSON.stringify([{ number: 24, state: 'closed' }]), stderr: '' },
    });

    const unread = await runUnblock({ gh: odd.run, issues: [12], ask: null, board: recordingBoard().board });
    const closed = await runUnblock({ gh: cased.run, issues: [12], ask: null, board: recordingBoard().board });

    expect(unread.issues[0]).toMatchObject({ status: 'waiting', unread: [24] });
    expect(closed.issues[0]).toMatchObject({ status: 'unasked', blockers: [24] });
  });
});

describe('rafa issue unblock, dispatched', () => {
  /** A project of this file's own, one per case. */
  const plant = (): ReturnType<typeof plantProject> => plantProject(mkdtempSync(join(tempBase, 'case-')));

  it('asks through the prompter, writes the removal and sends one gh issue edit', async () => {
    const gh = fakeGh({
      issues: {
        12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') },
        24: { state: 'CLOSED' },
      },
    });
    const asked: string[] = [];
    const command = createIssueUnblockCommand({
      openGh: () => gh.run,
      isTerminal: () => true,
      openPrompter: () => ({
        say: () => undefined,
        ask: (question) => {
          asked.push(question);
          return Promise.resolve('y');
        },
        close: () => undefined,
      }),
    });

    const outcome = await dispatchInProject(['issue', 'unblock', '12'], SUBJECTS, [command], plant());

    expect(outcome).toEqual({ exitCode: 0, stdout: 'Removed spec:blocked from #12\n', stderr: '' });
    expect(asked).toEqual(['#12 was blocked by #24, all closed. Remove spec:blocked? [y/N] ']);
    expect(gh.calls().at(-1)).toEqual(['issue', 'edit', '12', '--remove-label', 'spec:blocked']);
  });

  it('opens no prompter and sends no edit where standard input is no terminal', async () => {
    const gh = fakeGh({
      issues: {
        12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') },
        24: { state: 'CLOSED' },
      },
    });
    const command = createIssueUnblockCommand({
      openGh: () => gh.run,
      isTerminal: () => false,
      openPrompter: () => {
        throw new Error('the run opened a prompter where there is no terminal');
      },
    });

    const outcome = await dispatchInProject(['issue', 'unblock', '12'], SUBJECTS, [command], plant());

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('there is no terminal to ask on, so spec:blocked stays');
    expect(gh.routes()).toEqual(['issue view', 'issue list']);
  });

  it('opens no prompter on a terminal when no issue is asked about', async () => {
    const gh = fakeGh({
      issues: {
        57: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') },
        24: { state: 'OPEN' },
      },
    });
    const command = createIssueUnblockCommand({
      openGh: () => gh.run,
      isTerminal: () => true,
      openPrompter: () => {
        throw new Error('the run opened a prompter with nothing to ask');
      },
    });

    const outcome = await dispatchInProject(['issue', 'unblock', '57'], SUBJECTS, [command], plant());

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: '#57 is blocked by #24 (open), so spec:blocked stays\n',
      stderr: '',
    });
  });

  it('writes a fault at warn and still exits 0', async () => {
    const gh = fakeGh({ issues: { 12: { labels: [SPEC_BLOCKED_LABEL], body: 'No line here.\n' } } });
    const command = createIssueUnblockCommand({ openGh: () => gh.run, isTerminal: () => false });

    const outcome = await dispatchInProject(['issue', 'unblock', '12'], SUBJECTS, [command], plant());

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout.startsWith('warn: #12 is labelled spec:blocked')).toBe(true);
  });

  it('gives each outcome as the data of the one result event in json mode', async () => {
    const gh = fakeGh({
      issues: {
        12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') },
        24: { state: 'OPEN' },
      },
    });
    const command = createIssueUnblockCommand({ openGh: () => gh.run, isTerminal: () => false });

    const outcome = await dispatchInProject(['issue', 'unblock', '--all', '--output=json'], SUBJECTS, [command], plant());
    const events = eventsOf(outcome.stdout);

    expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({
      ok: true,
      data: { problem: null, unchecked: null, issues: [{ issue: 12, status: 'waiting', open: [24] }] },
    });
  });

  it('says so when no open issue carries the label', async () => {
    const gh = fakeGh({ issues: { 24: { state: 'CLOSED' } } });
    const command = createIssueUnblockCommand({ openGh: () => gh.run, isTerminal: () => false });

    const outcome = await dispatchInProject(['issue', 'unblock', '--all'], SUBJECTS, [command], plant());

    expect(outcome).toEqual({ exitCode: 0, stdout: 'No open issue is labelled spec:blocked.\n', stderr: '' });
  });

  it('ends with exit code 1 when the blocked listing failed before any issue was read', async () => {
    const gh = fakeGh({ blockedResult: { ok: false, stdout: '', stderr: 'gh: not logged in' } });
    const command = createIssueUnblockCommand({ openGh: () => gh.run, isTerminal: () => false });

    const outcome = await dispatchInProject(['issue', 'unblock', '--all'], SUBJECTS, [command], plant());

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('gh: not logged in');
    expect(outcome.stdout).toBe('');
  });
});

describe('the line', () => {
  /** What a refused line wrote, dispatched over a runner nobody may reach. */
  async function refuse(words: readonly string[]): Promise<{ exitCode: number | null; stderr: string; sent: number }> {
    const gh = fakeGh();
    const command = createIssueUnblockCommand({
      openGh: () => gh.run,
      isTerminal: () => false,
      openPrompter: () => {
        throw new Error('a refused line opened a prompter');
      },
    });
    const project = plantProject(mkdtempSync(join(tempBase, 'line-')));
    const outcome = await dispatchInProject(['issue', 'unblock', ...words], SUBJECTS, [command], project);
    return { exitCode: outcome.exitCode, stderr: outcome.stderr, sent: gh.calls().length };
  }

  it('refuses a line naming neither an issue nor --all, sending no command', async () => {
    const wanted = '❌ Name an issue number, or pass --all to read every open issue labelled spec:blocked';

    const outcome = await refuse([]);

    expect([outcome.exitCode, outcome.sent]).toEqual([1, 0]);
    expect(outcome.stderr).toBe(`${wanted}\nUsage: ${UNBLOCK_USAGE}\n`);
  });

  it('refuses a line naming an issue and --all at once', async () => {
    const outcome = await refuse(['12', '--all']);

    expect([outcome.exitCode, outcome.sent]).toEqual([1, 0]);
    expect(outcome.stderr).toContain('Name an issue number or pass --all, not both');
  });

  it('refuses a second word, and a word that is no issue number', async () => {
    const two = await refuse(['12', '13']);
    const word = await refuse(['twelve']);

    expect(two.stderr).toContain('Expected at most one issue number, got 2: 12 13');
    expect(word.stderr).toContain('"twelve" is no issue number, which is a whole number from 1');
    expect([two.exitCode, word.exitCode, two.sent, word.sent]).toEqual([1, 1, 0, 0]);
  });

  it('refuses a value given to --all, naming the flag', async () => {
    const outcome = await refuse(['--all=maybe']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('--all takes no value, and read "maybe" as one');
  });
});
