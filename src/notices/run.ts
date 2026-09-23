/**
 * The standing notices wired to the real process: the user's home, the
 * running build's version, stdin for the question and the active output
 * for a run with no terminal. `./notices.ts` owns every decision; this
 * file only supplies its seams and turns a cancel into an exit.
 *
 * Called by the two commands that start a Claude Code session on the
 * person's behalf, ahead of anything that costs money or moves a
 * branch: `loop start` (`src/start.ts`) and `plan create`
 * (`src/plan.ts`).
 */
import { homedir } from 'node:os';

import { activeOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { createLinePrompter } from '../cli/prompt/confirm.js';
import { RAFA_VERSION } from '../cli/version.js';

import { offerNotices } from './notices.js';

/** What a cancelled run says. */
export const NOTICES_CANCELLED = '🛑 Cancelled at the notice: nothing was started.';

/**
 * Shows the notices still owed and asks the one question; see
 * `./notices.ts`. Returns when the run may go on.
 *
 * @throws CommandExit with exit code 1 when the person cancels.
 */
export async function requireNoticesAnswered(): Promise<void> {
  const outcome = await offerNotices(
    { home: homedir(), version: RAFA_VERSION },
    {
      isTerminal: () => process.stdin.isTTY === true,
      openPrompter: () => createLinePrompter(process.stdin, process.stderr),
      warn: (line) => {
        activeOutput().warn(line);
      },
    },
  );
  if (outcome === 'cancelled') throw new CommandExit(1, NOTICES_CANCELLED);
}
