/**
 * `rafa epic promote <n> --to=now|next [--reason="<why>"]`: an epic moved
 * to an earlier horizon, its `horizon:` label swapped and the reason
 * commented on it (`.rafa/specs/rafa-246-epic-lifecycle.md`).
 *
 * A promote parks nothing, so it asks no keep question and closes no
 * pull request: the reason is its one question, asked only when
 * `--reason` is left out and there is a terminal. A target that is not
 * earlier than the standing horizon is refused with exit code 2, naming
 * the defer that would make it.
 *
 * The line, the reads, the question, the writes and the lines printed
 * are `./horizon-change.ts`'s, shared with `rafa epic defer`
 * (`./defer.ts`); its declaration is `EPIC_PROMOTE_DECLARATION`
 * (`./declarations.ts`), and this module joins it to that run. It starts
 * no session, so it declares no `spends`.
 */
import type { EpicHorizonSeams } from './horizon-change.js';
import type { RafaCommand } from '@open-tomato/rafa/core/command';

import { EPIC_PROMOTE_DECLARATION } from './declarations.js';
import { PROMOTE_ACTION, runEpicHorizon } from './horizon-change.js';

/** The command, reaching `gh`, `git` and the terminal through `seams`; see the module note. */
export function createEpicPromoteCommand(seams: EpicHorizonSeams = {}): RafaCommand {
  const command: RafaCommand = {
    ...EPIC_PROMOTE_DECLARATION,
    run: (context) => runEpicHorizon(context, PROMOTE_ACTION, seams),
  };
  return Object.freeze(command);
}

const command: RafaCommand = createEpicPromoteCommand();
export default command;
