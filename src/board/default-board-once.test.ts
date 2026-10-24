/**
 * Tests for the default board asked at most once
 * (`src/board/default-board-once.ts`): two calls of the thunk spend one
 * resolution, the answer is the board's number, and a read that throws
 * is refused with {@link DEFAULT_BOARD_REFUSAL_EXIT} and its message.
 *
 * The listing holds the open labelled board #31 and the plain issue #7.
 * The title search is planted through the `gh` seam and counted, since
 * `resolveDefaultBoard` spends it once per resolution even when a
 * labelled board answers.
 */
import type { BoardIssue } from './roadmap-board.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { CommandExit } from '@open-tomato/rafa/core/command';

import { typeOfLabels } from '../adapters/tracker/github.js';

import { DEFAULT_BOARD_REFUSAL_EXIT, defaultBoardOnce } from './default-board-once.js';

/** One open row as the listing reads it. */
function row(number: number, labels: readonly string[]): BoardIssue {
  return { number, title: `Issue ${String(number)}`, body: '', state: 'OPEN', stateReason: null, labels, type: typeOfLabels(labels), module: 'unassigned' };
}

/** A listing with one labelled board, #31. */
const LISTING: readonly BoardIssue[] = [row(7, ['type:bug']), row(31, ['type:roadmap'])];

/** A `gh` that answers `result` to every call, counting them. */
function plantedGh(result: GhResult): { readonly gh: GhRunner; readonly calls: () => number } {
  let calls = 0;
  return {
    gh: () => {
      calls += 1;
      return Promise.resolve(result);
    },
    calls: () => calls,
  };
}

/** What the thunk rejected with. */
async function rejectionOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error('the thunk did not reject');
}

describe('defaultBoardOnce', () => {
  it('answers the lowest labelled board and resolves once over two calls', async () => {
    const planted = plantedGh({ ok: true, stdout: '[]', stderr: '' });
    const ask = defaultBoardOnce({ roadmapIssue: null }, planted.gh, LISTING);

    expect(planted.calls()).toBe(0);
    expect(await ask()).toBe(31);
    expect(await ask()).toBe(31);
    expect(planted.calls()).toBe(1);
  });

  it('answers the configured board over the labelled one', async () => {
    const planted = plantedGh({ ok: true, stdout: '[]', stderr: '' });

    expect(await defaultBoardOnce({ roadmapIssue: 12 }, planted.gh, LISTING)()).toBe(12);
  });

  it('refuses with exit 2 and the message when the read throws, and asks no second time', async () => {
    const planted = plantedGh({ ok: false, stdout: '', stderr: 'gh: offline' });
    const ask = defaultBoardOnce({ roadmapIssue: null }, planted.gh, [row(7, ['type:bug'])]);

    const first = await rejectionOf(ask());
    const second = await rejectionOf(ask());

    expect(DEFAULT_BOARD_REFUSAL_EXIT).toBe(2);
    expect(first).toBeInstanceOf(CommandExit);
    expect((first as CommandExit).exitCode).toBe(DEFAULT_BOARD_REFUSAL_EXIT);
    expect((first as CommandExit).message).toStartWith('❌ Could not find the default board: ');
    expect((first as CommandExit).message).toContain('gh: offline');
    expect(second).toBe(first);
    expect(planted.calls()).toBe(1);
  });
});
