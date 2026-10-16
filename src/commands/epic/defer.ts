/**
 * `rafa epic defer <n> --to=next|later [--reason="<why>"]`: an epic moved
 * to a later horizon, its `horizon:` label swapped and the reason
 * commented on it (`.rafa/specs/rafa-246-epic-lifecycle.md`).
 *
 * Deferring an epic that work has started on parks that work, so an
 * `in-progress` epic's open branches and pull requests are named and the
 * one keep question asks whether to keep them. A no closes each pull
 * request with a comment naming the deferral and deletes no branch; with
 * no terminal the work is kept and named. A target that is not later than
 * the standing horizon is refused with exit code 2, naming the promote
 * that would make it.
 *
 * The line, the reads, the questions, the writes and the lines printed
 * are `./horizon-change.ts`'s, shared with `rafa epic promote`
 * (`./promote.ts`); its declaration is `EPIC_DEFER_DECLARATION`
 * (`./declarations.ts`), and this module joins it to that run. It starts
 * no session, so it declares no `spends`.
 */
import type { EpicHorizonSeams } from './horizon-change.js';
import type { RafaCommand } from '@open-tomato/rafa/core/command';

import { EPIC_DEFER_DECLARATION } from './declarations.js';
import { DEFER_ACTION, runEpicHorizon } from './horizon-change.js';

/** The command, reaching `gh`, `git` and the terminal through `seams`; see the module note. */
export function createEpicDeferCommand(seams: EpicHorizonSeams = {}): RafaCommand {
  const command: RafaCommand = {
    ...EPIC_DEFER_DECLARATION,
    run: (context) => runEpicHorizon(context, DEFER_ACTION, seams),
  };
  return Object.freeze(command);
}

const command: RafaCommand = createEpicDeferCommand();
export default command;
