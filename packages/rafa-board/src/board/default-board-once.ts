/**
 * The default board, asked at most once: the thunk `rafa switch`,
 * `rafa board list` and `rafa epic new` rank the default board with over
 * the board listing they already read, so its title search is spent
 * only when an answer needs it and never twice.
 *
 * {@link defaultBoardOnce} ranks through `resolveDefaultBoard`
 * (`./boards.ts`), the labelled boards being the listing's open
 * `type:roadmap` rows (`openBoards`, `./epic-board.ts`) and the title
 * search `createGhRoadmapSearch` (`./roadmap.ts`). Any failure is refused
 * with {@link DEFAULT_BOARD_REFUSAL_EXIT} and the line
 * `❌ Could not find the default board: <reason>`.
 *
 * It moved here from `packages/rafa-run/src/commands/switch.ts` (decouple 4, #808), so the
 * two board commands that ask it take it from board rather than from a
 * run file.
 */
import type { BoardIssue } from './roadmap-board.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { RafaConfig } from '@open-tomato/rafa/core/config';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { messageOf } from '@open-tomato/rafa/core/config/sections';

import { resolveDefaultBoard } from './boards.js';
import { openBoards } from './epic-board.js';
import { createGhRoadmapSearch } from './roadmap.js';

/** The exit code of a default board that cannot be found: the value of `SWITCH_REFUSAL_EXIT` (`packages/rafa-run/src/commands/switch.ts`). */
export const DEFAULT_BOARD_REFUSAL_EXIT = 2;

/** The default board's number, asked at most once; any failure refused with {@link DEFAULT_BOARD_REFUSAL_EXIT}. */
export function defaultBoardOnce(config: Pick<RafaConfig, 'roadmapIssue'>, gh: GhRunner, listing: readonly BoardIssue[]): () => Promise<number> {
  let answer: Promise<number> | null = null;
  const read = async (): Promise<number> => {
    try {
      const found = await resolveDefaultBoard({
        configured: config.roadmapIssue,
        listBoards: () => Promise.resolve(openBoards(listing)),
        search: createGhRoadmapSearch({ gh }),
      });
      return found.number;
    } catch (error) {
      throw new CommandExit(DEFAULT_BOARD_REFUSAL_EXIT, `❌ Could not find the default board: ${messageOf(error)}`);
    }
  };
  return () => {
    answer ??= read();
    return answer;
  };
}
