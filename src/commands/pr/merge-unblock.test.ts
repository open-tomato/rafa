/**
 * Tests for the unblock reading `rafa pr merge` ends with
 * (`src/commands/pr/merge-unblock.ts`): whether there is anything to
 * read at all, which open blocked issues a merge considers, and that
 * nothing on the way out throws.
 *
 * Every case drives a `gh` runner of its own over a literal board,
 * routing on the argument list and keeping every call, so no case
 * spawns a process or reaches GitHub. What the reading itself decides
 * — the state of each blocker, the question, the one write — is
 * `src/commands/issue/unblock.test.ts`'s; what is measured here is the
 * calls SENT, the issues SELECTED and the LEVEL each line came out at,
 * because the ways this module passes while wrong are by spending a
 * listing on a merge that unblocks nothing, by touching an issue this
 * merge has nothing to do with, and by failing a merge that is already
 * done.
 *
 * ## The controls
 *
 * Three readings here could pass while wrong, and each is paired:
 *
 *  - The selection case runs one board against a body closing #24 and
 *    against a body closing #26, and holds each answer against the
 *    other. Without the pair, a run that considered every blocked
 *    issue whatever the merge closed would look correct on either half
 *    alone.
 *  - The silence case pairs a body that closes no issue with one that
 *    does, and holds no call against one.
 *  - Each warning case asserts the exit of the reading AND that the
 *    board recorded no removal, so "it warned" is never read off the
 *    message alone.
 */
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { UnblockAsk } from '../issue/unblock.js';

import { describe, expect, it } from 'bun:test';

import { SPEC_BLOCKED_LABEL } from '../../board/blocked.js';

import { unblockAfterMerge, unblockProblemLine, unblockWarningLine } from './merge-unblock.js';

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
  /** What the blocked listing answers instead. */
  readonly blockedResult?: GhResult;
  /** What the state listing answers instead. */
  readonly stateResult?: GhResult;
  /** What `gh issue edit` answers instead. */
  readonly editResult?: GhResult;
}

/** A runner over `board`, the label removals it took, and the routes it was handed. */
interface FakeGh {
  readonly run: GhRunner;
  /** Each command, the first two words joined, in order. */
  readonly routes: () => readonly string[];
  /** `#<n> <label>` per removal the board took. */
  readonly removed: () => readonly string[];
}

/** A runner answering the two listings and the removal from a literal board. */
function fakeGh(board: FakeBoard = {}): FakeGh {
  const routes: string[] = [];
  const removed: string[] = [];
  const held = Object.entries(board.issues ?? {}).map(([number, issue]) => ({
    number: Number(number),
    body: issue.body ?? '',
    state: issue.state ?? 'OPEN',
    labels: issue.labels ?? [],
  }));
  const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });

  const run: GhRunner = (args) => {
    routes.push(args.slice(0, 2).join(' '));
    if (args.slice(0, 2).join(' ') === 'issue edit') {
      if (board.editResult !== undefined) return Promise.resolve(board.editResult);
      removed.push(`#${args[2] ?? ''} ${args[4] ?? ''}`);
      return ok('');
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
  return { run, routes: () => routes, removed: () => removed };
}

/** Where the two kinds of line land, kept apart and in order. */
interface Sink {
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
  readonly infos: () => readonly string[];
  readonly warnings: () => readonly string[];
}

/** A sink keeping every line at each level. */
function sink(): Sink {
  const infos: string[] = [];
  const warnings: string[] = [];
  return {
    info: (message: string): void => void infos.push(message),
    warn: (message: string): void => void warnings.push(message),
    infos: () => infos,
    warnings: () => warnings,
  };
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

/** A body carrying a `Blocked by:` line and a sentence around it. */
function body(line: string): string {
  return `## Spec\n\nSomething to build.\n\n${line}\n`;
}

/** A board where #24 and #26 are closed and one open issue waits on each. */
function twoWaiting(): FakeGh {
  return fakeGh({
    issues: {
      12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') },
      13: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #26') },
      24: { state: 'CLOSED' },
      26: { state: 'CLOSED' },
    },
  });
}

describe('a merge that has nothing to unblock', () => {
  it('spends no board call at all on a pull request whose body closes no issue', async () => {
    const gh = twoWaiting();
    const lines = sink();
    const ask = scriptedAsk([true]);

    const report = await unblockAfterMerge({
      body: 'A pull request about nothing anybody waits on.',
      gh: gh.run,
      ask: ask.ask,
      info: lines.info,
      warn: lines.warn,
    });

    expect(report).toBeNull();
    expect(gh.routes()).toEqual([]);
    expect([ask.asked(), lines.infos(), lines.warnings()]).toEqual([[], [], []]);
  });

  it('costs one listing and prints nothing where the board keeps no blocked issue', async () => {
    const gh = fakeGh({ issues: { 24: { state: 'CLOSED' } } });
    const lines = sink();

    const report = await unblockAfterMerge({
      body: 'Closes #24',
      gh: gh.run,
      ask: scriptedAsk([true]).ask,
      info: lines.info,
      warn: lines.warn,
    });

    expect(gh.routes()).toEqual(['issue list']);
    expect(report).toEqual({ issues: [], problem: null, unchecked: null });
    expect([lines.infos(), lines.warnings()]).toEqual([[], []]);
  });
});

describe('the issues a merge considers', () => {
  it('reads the issue whose line names what the pull request closes, and asks about it', async () => {
    const gh = twoWaiting();
    const lines = sink();
    const ask = scriptedAsk([true]);

    const report = await unblockAfterMerge({
      body: 'Closes #24',
      gh: gh.run,
      ask: ask.ask,
      info: lines.info,
      warn: lines.warn,
    });

    expect(report?.issues.map((issue) => [issue.issue, issue.status])).toEqual([[12, 'removed']]);
    expect(ask.asked()).toEqual(['#12 was blocked by #24, all closed. Remove spec:blocked? [y/N] ']);
    expect(gh.removed()).toEqual(['#12 spec:blocked']);
    expect(lines.infos()).toEqual(['Removed spec:blocked from #12']);
  });

  it('reads the other issue over the same board when the pull request closes the other id', async () => {
    const gh = twoWaiting();
    const lines = sink();
    const ask = scriptedAsk([true]);

    await unblockAfterMerge({
      body: 'Fixes #26',
      gh: gh.run,
      ask: ask.ask,
      info: lines.info,
      warn: lines.warn,
    });

    expect(ask.asked()).toEqual(['#13 was blocked by #26, all closed. Remove spec:blocked? [y/N] ']);
    expect(gh.removed()).toEqual(['#13 spec:blocked']);
  });

  it('names the blocker still open and removes nothing, where one of two has closed', async () => {
    const gh = fakeGh({
      issues: {
        12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24 #26') },
        24: { state: 'CLOSED' },
        26: { state: 'OPEN' },
      },
    });
    const lines = sink();
    const ask = scriptedAsk([true]);

    const report = await unblockAfterMerge({
      body: 'Closes #24',
      gh: gh.run,
      ask: ask.ask,
      info: lines.info,
      warn: lines.warn,
    });

    expect(report?.issues.map((issue) => issue.status)).toEqual(['waiting']);
    expect(lines.infos()).toEqual(['#12 is blocked by #26 (open), so spec:blocked stays']);
    expect([ask.asked(), gh.removed(), lines.warnings()]).toEqual([[], [], []]);
  });

  it('asks nothing and removes nothing where there is no terminal to ask on', async () => {
    const gh = twoWaiting();
    const lines = sink();

    const report = await unblockAfterMerge({
      body: 'Closes #24',
      gh: gh.run,
      ask: null,
      info: lines.info,
      warn: lines.warn,
    });

    expect(report?.issues.map((issue) => issue.status)).toEqual(['unasked']);
    expect(gh.removed()).toEqual([]);
    expect(lines.infos()[0]).toContain('Run rafa issue unblock 12 where an answer can be typed');
    expect(lines.warnings()).toEqual([]);
  });
});

describe('every failure is a warning naming the reading', () => {
  it('warns and changes nothing when the blocked listing failed', async () => {
    const gh = fakeGh({ blockedResult: { ok: false, stdout: '', stderr: 'gh: not logged in' } });
    const lines = sink();

    const report = await unblockAfterMerge({
      body: 'Closes #24',
      gh: gh.run,
      ask: scriptedAsk([true]).ask,
      info: lines.info,
      warn: lines.warn,
    });

    expect(report?.problem).toContain('gh: not logged in');
    expect(lines.warnings()).toHaveLength(1);
    expect(lines.warnings()[0]).toContain('the blocked-issue reading did not run');
    expect([gh.removed(), lines.infos()]).toEqual([[], []]);
  });

  it('warns the fault of a line naming itself beside the closed issue, and never guesses at it', async () => {
    const gh = fakeGh({
      issues: {
        12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #12 #24') },
        24: { state: 'CLOSED' },
      },
    });
    const lines = sink();
    const ask = scriptedAsk([true]);

    const report = await unblockAfterMerge({
      body: 'Closes #24',
      gh: gh.run,
      ask: ask.ask,
      info: lines.info,
      warn: lines.warn,
    });

    expect(report?.issues.map((issue) => issue.status)).toEqual(['fault']);
    expect(lines.warnings()).toHaveLength(1);
    expect(lines.warnings()[0]).toContain('the blocked-issue reading: #12 has a "Blocked by:" line');
    expect([ask.asked(), gh.removed()]).toEqual([[], []]);
  });

  it('warns the removal GitHub refused rather than failing over it', async () => {
    const gh = fakeGh({
      issues: {
        12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') },
        24: { state: 'CLOSED' },
      },
      editResult: { ok: false, stdout: '', stderr: 'gh: Not Found (HTTP 404)' },
    });
    const lines = sink();

    const report = await unblockAfterMerge({
      body: 'Closes #24',
      gh: gh.run,
      ask: scriptedAsk([true]).ask,
      info: lines.info,
      warn: lines.warn,
    });

    expect(report?.issues.map((issue) => issue.status)).toEqual(['failed']);
    expect(lines.warnings()[0]).toContain('the blocked-issue reading: spec:blocked could not be removed from #12');
    expect(lines.infos()).toEqual([]);
  });

  it('warns the board it could not read whole, so no blocker was checked against it', async () => {
    const rows = Array.from({ length: 500 }, (unused, index) => ({ number: 1000 + index, state: 'CLOSED' }));
    const gh = fakeGh({
      issues: { 12: { labels: [SPEC_BLOCKED_LABEL], body: body('Blocked by: #24') } },
      stateResult: { ok: true, stdout: JSON.stringify(rows), stderr: '' },
    });
    const lines = sink();

    const report = await unblockAfterMerge({
      body: 'Closes #24',
      gh: gh.run,
      ask: scriptedAsk([true]).ask,
      info: lines.info,
      warn: lines.warn,
    });

    expect(report?.issues.map((issue) => issue.status)).toEqual(['waiting']);
    expect(gh.removed()).toEqual([]);
    expect(lines.warnings()).toHaveLength(1);
    expect(lines.warnings()[0]).toContain('no blocker id was checked against it');
  });

  it('answers null with a warning rather than throwing when the question itself threw', async () => {
    const gh = twoWaiting();
    const lines = sink();

    const report = await unblockAfterMerge({
      body: 'Closes #24',
      gh: gh.run,
      ask: () => Promise.reject(new Error('the terminal went away')),
      info: lines.info,
      warn: lines.warn,
    });

    expect(report).toBeNull();
    expect(lines.warnings()).toEqual([unblockProblemLine('the terminal went away')]);
    expect(gh.removed()).toEqual([]);
  });
});

describe('the two lines', () => {
  it('names the reading, so neither is read as something the merge did', () => {
    expect(unblockProblemLine('gh said no')).toBe('the blocked-issue reading did not run: gh said no');
    expect(unblockWarningLine('#12 keeps spec:blocked')).toBe('the blocked-issue reading: #12 keeps spec:blocked');
  });
});
