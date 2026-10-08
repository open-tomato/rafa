/**
 * Tests for the refreshing issue board (`issue-board-refresh.ts`).
 *
 * The wrapper's cases drive a recording inner board and a recording
 * refresh, so each of the three label writes is read for what it hands
 * the refresh, in what order, and what it does with the refresh's lines.
 * The factory's cases drive one hand-made `gh` runner, so the label
 * write, the refresh's first read and the scope refusal it meets are the
 * real commands `createGhIssueBoard` and `refreshProjectItems` send. No
 * case reaches GitHub.
 *
 * ## The controls
 *
 *  - Every "no refresh" case is read beside a write that does refresh,
 *    so an empty refresh log proves the failed write and not a refresh
 *    that was never wired.
 *  - The factory's case with no `board.project.number` is read beside the
 *    same write with the number set, which sends the refresh's reads, so
 *    a log holding the edit alone proves the key.
 */
import type { IssueBoard } from '../issue-board.js';
import type { RefreshIssues } from './issue-board-refresh.js';
import type { ProjectRefresh, RefreshConfig } from './refresh.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../../adapters/output/active.js';
import { sinkOutput } from '../../tests/output-sinks.js';

import { createRefreshingGhIssueBoard, refreshFailedWarning, withProjectRefresh } from './issue-board-refresh.js';
import { scopeWarning } from './refresh-warnings.js';

/** The issue every write is made on. */
const ISSUE = 12;

/** A refresh with nothing to warn of. */
const QUIET: ProjectRefresh = { kind: 'skipped', reason: 'no-project', warnings: [] };

/** A refresh answering two lines. */
const LOUD: ProjectRefresh = { kind: 'refused', reason: 'scope', project: { owner: 'open-tomato', number: 6 }, warnings: ['first', 'second'] };

/** What the recording inner board and refresh saw, in order. */
type Step = readonly [kind: 'write', member: string, ...args: readonly (string | number)[]] | readonly [kind: 'refresh', issues: readonly number[]];

/** An inner board recording each label write into `log`, failing the members named in `failing`. */
function innerBoard(log: Step[], failing: ReadonlySet<string> = new Set()): IssueBoard {
  const write = (member: string, ...args: readonly (string | number)[]): Promise<void> => {
    log.push(['write', member, ...args]);
    return failing.has(member)
      ? Promise.reject(new Error(`board issue: gh issue edit failed for ${member}`))
      : Promise.resolve();
  };
  const unused = (): never => {
    throw new Error('not a label write');
  };
  return {
    comments: unused,
    comment: unused,
    editComment: unused,
    swapLabels: (issue, removed, added) => write('swapLabels', issue, removed, added),
    addLabel: (issue, label) => write('addLabel', issue, label),
    removeLabel: (issue, label) => write('removeLabel', issue, label),
    closeIssue: () => Promise.resolve(),
    createLabel: unused,
    createIssue: unused,
    closePullRequest: unused,
  };
}

/** A refresh recording each call into `log`, answering `answer`, or rejecting with it when it is an `Error`. */
function recordingRefresh(log: Step[], answer: ProjectRefresh | Error = QUIET): RefreshIssues {
  return (issues) => {
    log.push(['refresh', [...issues]]);
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  };
}

/** The three label writes, each made on {@link ISSUE} through `board`. */
const WRITES: readonly (readonly [member: 'swapLabels' | 'addLabel' | 'removeLabel', write: (board: IssueBoard) => Promise<void>, args: readonly string[]])[] = [
  ['swapLabels', (board) => board.swapLabels(ISSUE, 'rafa:claimed', 'rafa:in-development'), ['rafa:claimed', 'rafa:in-development']],
  ['addLabel', (board) => board.addLabel(ISSUE, 'rafa:claimed'), ['rafa:claimed']],
  ['removeLabel', (board) => board.removeLabel(ISSUE, 'spec:blocked'), ['spec:blocked']],
];

describe('withProjectRefresh', () => {
  for (const [member, write, args] of WRITES) {
    describe(member, () => {
      it('sends no refresh and rejects as the inner board did when the label write fails', async () => {
        const log: Step[] = [];
        const warned: string[] = [];
        const board = withProjectRefresh(innerBoard(log, new Set([member])), { refresh: recordingRefresh(log), warn: (line) => warned.push(line) });

        const written = write(board);

        await expect(written).rejects.toThrow(`gh issue edit failed for ${member}`);
        expect(log).toEqual([['write', member, ISSUE, ...args]]);
        expect(warned).toEqual([]);
      });

      it('refreshes the one issue labelled, after the write, and warns of nothing for a quiet refresh', async () => {
        const log: Step[] = [];
        const warned: string[] = [];
        const board = withProjectRefresh(innerBoard(log), { refresh: recordingRefresh(log), warn: (line) => warned.push(line) });

        await write(board);

        expect(log).toEqual([['write', member, ISSUE, ...args], ['refresh', [ISSUE]]]);
        expect(warned).toEqual([]);
      });

      it('hands every line the refresh answered to warn, in order, and resolves', async () => {
        const log: Step[] = [];
        const warned: string[] = [];
        const board = withProjectRefresh(innerBoard(log), { refresh: recordingRefresh(log, LOUD), warn: (line) => warned.push(line) });

        await write(board);

        expect(warned).toEqual(['first', 'second']);
      });

      it('answers a refresh that rejects as one warning line naming the issue, and still resolves', async () => {
        const log: Step[] = [];
        const warned: string[] = [];
        const failure = new Error('gh repo view --json nameWithOwner failed: no network');
        const board = withProjectRefresh(innerBoard(log), { refresh: recordingRefresh(log, failure), warn: (line) => warned.push(line) });

        await write(board);

        expect(warned).toEqual([refreshFailedWarning(ISSUE, failure)]);
        expect(log.at(-1)).toEqual(['refresh', [ISSUE]]);
      });
    });
  }

  it('passes every other member through untouched, so a close sends no refresh', async () => {
    const log: Step[] = [];
    const inner = innerBoard(log);
    const board = withProjectRefresh(inner, { refresh: recordingRefresh(log), warn: () => undefined });

    await board.closeIssue(ISSUE, 'completed', 'done');

    expect(log).toEqual([]);
    expect([board.comments, board.comment, board.editComment, board.closeIssue, board.createLabel, board.createIssue, board.closePullRequest])
      .toEqual([inner.comments, inner.comment, inner.editComment, inner.closeIssue, inner.createLabel, inner.createIssue, inner.closePullRequest]);
    expect(Object.isFrozen(board)).toBe(true);
  });
});

describe('refreshFailedWarning', () => {
  it('names the issue, what failed and the sync that catches up', () => {
    const line = refreshFailedWarning(ISSUE, new Error('the default board #1 is not on the board listing'));

    expect(line).toBe('The project was not updated for #12: the default board #1 is not on the board listing. Run `rafa board sync` to catch up.');
  });
});

/** GitHub's documented refusal for a token without the `project` scope, NOT a reading; see `./refresh-warnings.ts`. */
const SCOPE_STDERR = 'gh: Your token has not been granted the required scopes to execute this query. The \'projectV2\' field requires one of the following scopes: [\'read:project\'], but your token has only been granted the: [\'repo\'] scopes.\n';

/** A `gh` recording every call: the edit and the repository answered, every GraphQL call refused for the scope. */
function scopelessGh(calls: string[][]): GhRunner {
  const answer = (ok: boolean, stdout: string, stderr = ''): GhResult => ({ ok, code: ok
    ? 0
    : 1, stdout, stderr });
  return (args) => {
    calls.push([...args]);
    if (args[0] === 'issue' && args[1] === 'edit') return Promise.resolve(answer(true, ''));
    if (args[0] === 'repo' && args[1] === 'view') return Promise.resolve(answer(true, JSON.stringify({ nameWithOwner: 'open-tomato/rafa' })));
    if (args[0] === 'api' && args[1] === 'graphql') return Promise.resolve(answer(false, '', SCOPE_STDERR));
    return Promise.resolve(answer(false, '', `unexpected gh ${args.join(' ')}`));
  };
}

/** The config the factory's cases read, the number set. */
const CONFIG: RefreshConfig = { boardProjectNumber: 6, boardRelationships: 'labels', roadmapIssue: null, releaseFragments: '.changes' };

describe('createRefreshingGhIssueBoard', () => {
  it('sends the edit alone with board.project.number unset', async () => {
    const calls: string[][] = [];
    const warned: string[] = [];
    const board = createRefreshingGhIssueBoard({ gh: scopelessGh(calls), config: { ...CONFIG, boardProjectNumber: null }, warn: (line) => warned.push(line) });

    await board.addLabel(ISSUE, 'rafa:claimed');

    expect(calls).toEqual([['issue', 'edit', '12', '--add-label', 'rafa:claimed']]);
    expect(warned).toEqual([]);
  });

  it('refreshes after the edit with the number set, and answers a token without the project scope with the scope line', async () => {
    const calls: string[][] = [];
    const warned: string[] = [];
    const board = createRefreshingGhIssueBoard({ gh: scopelessGh(calls), config: CONFIG, warn: (line) => warned.push(line) });

    await board.swapLabels(ISSUE, 'rafa:claimed', 'rafa:in-development');

    expect(calls.slice(0, 2)).toEqual([
      ['issue', 'edit', '12', '--remove-label', 'rafa:claimed', '--add-label', 'rafa:in-development'],
      ['repo', 'view', '--json', 'nameWithOwner'],
    ]);
    expect(calls.slice(2).every((call) => call[0] === 'api' && call[1] === 'graphql')).toBe(true);
    expect(warned).toEqual([scopeWarning()]);
  });

  it('warns on the output active at the line when the build hands no warn', async () => {
    const calls: string[][] = [];
    const warned: string[] = [];
    const board = createRefreshingGhIssueBoard({ gh: scopelessGh(calls), config: CONFIG });
    setActiveOutput(sinkOutput({ warn: (line) => warned.push(line) }));
    try {
      await board.removeLabel(ISSUE, 'spec:blocked');
    } finally {
      setActiveOutput(null);
    }

    expect(warned).toEqual([scopeWarning()]);
  });
});
