/**
 * Tests for the `Blocked by:` line of a spec `rafa issue create` files
 * (`create-blocked.ts`): which drafts are read, the `no-ids` refusal
 * made from the body alone, the board's numbers read through a planted
 * `find`, the `self-reference` and `unknown-issue` refusals, the
 * `blocked` reading that sets `specBlocked`, and the unchecked board.
 *
 * Every case drives a stub tracker whose `find` answers planted refs
 * and records each query, so none spawns `gh` or touches a file. Each
 * refusal is paired with a line the same board takes, so a case that
 * refused everything would fail.
 */
import type { IssueDraft, IssueQuery, IssueRef, Tracker } from '../../ports/index.js';

import { describe, expect, it } from 'bun:test';

import { readBlockedBy } from '../../board/blocked.js';
import { CommandExit } from '../../cli/command.js';

import {
  KNOWN_LIST_LIMIT,
  readBoardNumbers,
  readSpecLine,
  settleSpecLine,
  specLineFault,
} from './create-blocked.js';

/** What every refusal tells the author to do. */
const REMEDY = 'name the issues it waits on as "Blocked by: #24 #26", or take the line out';

/** A spec draft holding `body`. */
function specDraft(body: string, overrides: Partial<IssueDraft> = {}): IssueDraft {
  return {
    opt: 0,
    title: 'A spec',
    body,
    type: 'spec',
    module: 'unassigned',
    priority: null,
    project: null,
    blockedBy: [],
    ...overrides,
  };
}

/** A stub tracker of `kind` whose `find` answers `ids` as refs and records each query. */
function boardOf(ids: readonly string[], kind: Tracker['kind'] = 'local') {
  const queries: IssueQuery[] = [];
  const tracker: Pick<Tracker, 'kind' | 'find'> = {
    kind,
    find: (query) => {
      queries.push(query);
      return Promise.resolve(ids.map((id): IssueRef => ({ opt: 0, kind, externalId: id, url: null })));
    },
  };
  return { tracker, queries };
}

/** The ids 1 to `count`, as a tracker answers them. */
function idsUpTo(count: number): string[] {
  return Array.from({ length: count }, (_, index) => String(index + 1));
}

/** What `read` threw or rejected with, as its exit code and message for a `CommandExit`, or undefined when it did not. */
async function exitOf(read: () => unknown): Promise<unknown> {
  try {
    await read();
  } catch (error) {
    return error instanceof CommandExit
      ? { exitCode: error.exitCode, message: error.message }
      : error;
  }
  return undefined;
}

describe('which drafts readSpecLine reads', () => {
  it('reads a spec\'s line from the body alone', () => {
    expect(readSpecLine(specDraft('Blocked by: #20 #21\n\nThe spec.'))).toMatchObject({
      kind: 'blocked',
      line: 1,
      blockers: [20, 21],
    });
  });

  it('answers null for a spec with no line, and for every other type whatever its body says', () => {
    expect(readSpecLine(specDraft('The spec, waiting on nothing.'))).toBeNull();
    expect(readSpecLine(specDraft('Blocked by: #20', { type: 'bug' }))).toBeNull();
    expect(readSpecLine(specDraft('Blocked by: the API work', { type: 'code' }))).toBeNull();
  });

  it('refuses a line naming no issue with exit code 1, naming the line and what it said', async () => {
    expect(await exitOf(() => readSpecLine(specDraft('Intro.\nBlocked by: the API work\n')))).toEqual({
      exitCode: 1,
      message: `❌ The spec's "Blocked by:" line, line 2 of the body, names no issue: "the API work": ${REMEDY}`,
    });
  });

  it('refuses a line naming only issues on other repositories, naming them', async () => {
    expect(await exitOf(() => readSpecLine(specDraft('Blocked by: open-tomato/agentic-research#12')))).toEqual({
      exitCode: 1,
      message: '❌ The spec\'s "Blocked by:" line, line 1 of the body, names only issues on other repositories:'
        + ` open-tomato/agentic-research#12: ${REMEDY}`,
    });
  });
});

describe('the board numbers readBoardNumbers reads', () => {
  it('asks find for every issue up to the limit and predicts one past the highest', async () => {
    const { tracker, queries } = boardOf(['3', '20', '7']);

    expect(await readBoardNumbers(tracker)).toEqual({ known: new Set([3, 20, 7]), next: 21, unchecked: null });
    expect(queries).toEqual([{ limit: KNOWN_LIST_LIMIT }]);
  });

  it('predicts issue 1 on an empty board', async () => {
    expect(await readBoardNumbers(boardOf([]).tracker)).toEqual({ known: new Set(), next: 1, unchecked: null });
  });

  it('checks one listing short of the limit, and checks no id once the listing comes back full', async () => {
    const short = await readBoardNumbers(boardOf(idsUpTo(KNOWN_LIST_LIMIT - 1)).tracker);
    const full = await readBoardNumbers(boardOf(idsUpTo(KNOWN_LIST_LIMIT), 'github').tracker);

    expect([short.known?.size, short.next, short.unchecked]).toEqual([KNOWN_LIST_LIMIT - 1, KNOWN_LIST_LIMIT, null]);
    expect(full).toEqual({
      known: undefined,
      next: 0,
      unchecked: `the github tracker answered the ${String(KNOWN_LIST_LIMIT)} issues the listing asked for and may hold more,`
        + ' so no "Blocked by:" id was checked against it',
    });
  });

  it.each(['OPT-4', '04', '0', ''])('checks no id when the tracker answers the id %j, which is not an issue number', async (id) => {
    expect(await readBoardNumbers(boardOf(['1', id]).tracker)).toEqual({
      known: undefined,
      next: 0,
      unchecked: 'the local tracker answered an issue id that is not an issue number, so no "Blocked by:" id was checked against it',
    });
  });

  it('refuses a listing that rejects with exit code 1, naming the tracker', async () => {
    const tracker: Pick<Tracker, 'kind' | 'find'> = {
      kind: 'github',
      find: () => Promise.reject(new Error('gh issue list failed: HTTP 502')),
    };

    expect(await exitOf(() => readBoardNumbers(tracker))).toEqual({
      exitCode: 1,
      message: '❌ Could not list the board\'s issues on the github tracker: gh issue list failed: HTTP 502',
    });
  });
});

describe('the draft settleSpecLine answers', () => {
  it('sets specBlocked on a line naming issues the board holds, closed ones listed among them, and keeps the rest of the draft', async () => {
    const draft = specDraft('Blocked by: #2, #3 and open-tomato/agentic-research#12\n\nThe spec.');

    expect(await settleSpecLine(draft, boardOf(['1', '2', '3']).tracker)).toEqual({
      draft: { ...draft, specBlocked: true },
      unchecked: null,
    });
  });

  it('refuses a line naming the number the issue would be filed as, where the number below it is taken', async () => {
    const { tracker } = boardOf(['1', '2', '3']);

    expect(await exitOf(() => settleSpecLine(specDraft('Blocked by: #3 #4'), tracker))).toEqual({
      exitCode: 1,
      message: `❌ The spec's "Blocked by:" line, line 1 of the body, names #4, the number this issue would be filed as: ${REMEDY}`,
    });
    expect((await settleSpecLine(specDraft('Blocked by: #3'), tracker)).draft.specBlocked).toBe(true);
  });

  it('refuses a line naming an issue the board has no number for, naming every one', async () => {
    const { tracker } = boardOf(['1', '2', '5', '9']);

    expect(await exitOf(() => settleSpecLine(specDraft('Blocked by: #2 #3 #4 #9'), tracker))).toEqual({
      exitCode: 1,
      message: `❌ The spec's "Blocked by:" line, line 1 of the body, names #3 #4, which the board has no issue for: ${REMEDY}`,
    });
  });

  it('refuses an id past the predicted number as unknown', async () => {
    expect(await exitOf(() => settleSpecLine(specDraft('Blocked by: #40'), boardOf(['1']).tracker))).toMatchObject({
      exitCode: 1,
      message: expect.stringContaining('names #40, which the board has no issue for'),
    });
  });

  it('files a line it could not check as blocked, carrying the sentence saying why', async () => {
    const settled = await settleSpecLine(specDraft('Blocked by: #20000'), boardOf(idsUpTo(KNOWN_LIST_LIMIT)).tracker);

    expect(settled.draft.specBlocked).toBe(true);
    expect(settled.unchecked).toStartWith(`the local tracker answered the ${String(KNOWN_LIST_LIMIT)} issues`);
  });

  it('refuses a line naming no issue, read again on the board', async () => {
    expect(await exitOf(() => settleSpecLine(specDraft('Blocked by: soon'), boardOf(['1']).tracker))).toMatchObject({
      exitCode: 1,
      message: expect.stringContaining('names no issue: "soon"'),
    });
  });
});

describe('the fault sentence specLineFault makes', () => {
  it.each(['Blocked by: #3', 'No line here.'])('refuses to name a fault for the reading of %j', (body) => {
    expect(() => specLineFault(readBlockedBy(4, body))).toThrow(TypeError);
  });
});
