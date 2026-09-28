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
 * (`./promote.ts`); this module is the declaration. It starts no
 * session, so it declares no `spends`.
 */
import type { EpicHorizonSeams } from './horizon-change.js';
import type { RafaCommand } from '../../cli/command.js';

import { REASON_FLAG } from '../../board/epic-trail.js';

import { DEFER_ACTION, runEpicHorizon, TO_FLAG } from './horizon-change.js';

/** The command, reaching `gh`, `git` and the terminal through `seams`; see the module note. */
export function createEpicDeferCommand(seams: EpicHorizonSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'epic defer',
    subject: 'epic',
    action: 'defer',
    summary: 'move an epic to a later horizon, commenting the reason; ask whether to keep its open work',
    description: 'Swaps the epic\'s horizon: label for horizon:next or horizon:later in one edit and comments'
      + ' "Moved <from> → <to>: <reason>" on it. The reason is --reason, or asked once where there is a'
      + ' terminal; with neither, nothing changes and the question is printed. When the epic is in progress'
      + ' its members\' open branches and pull requests are named and it asks whether to keep them: a no'
      + ' closes each pull request with a comment and deletes no branch, and with no terminal they are kept.'
      + ' An issue that is not an open epic, a target equal to its horizon and one that is not later than it'
      + ' are refused with exit code 2 before anything is written. With `--output=json` the move, the work'
      + ' and what became of it are the data of the terminal result event.',
    args: [
      {
        name: 'n',
        description: 'The epic\'s issue number.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: TO_FLAG,
        description: `The horizon it moves to: one of ${DEFER_ACTION.targets.join(', ')}. Required.`,
        type: 'string',
        required: true,
      },
      {
        name: REASON_FLAG,
        description: 'Why it moves, commented on the epic. Asked once when left out.',
        type: 'string',
      },
    ],
    examples: [
      {
        cmd: 'rafa epic defer 40 --to=later --reason="waiting on #118"',
        note: 'Swaps horizon:now for horizon:later on #40 and comments "Moved now → later: waiting on #118".',
      },
    ],
    outputs: ['text', 'json'],
    run: (context) => runEpicHorizon(context, DEFER_ACTION, seams),
  };
  return Object.freeze(command);
}

export default createEpicDeferCommand();
