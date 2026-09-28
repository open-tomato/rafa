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
 * (`./defer.ts`); this module is the declaration. It starts no session,
 * so it declares no `spends`.
 */
import type { EpicHorizonSeams } from './horizon-change.js';
import type { RafaCommand } from '../../cli/command.js';

import { REASON_FLAG } from '../../board/epic-trail.js';

import { PROMOTE_ACTION, runEpicHorizon, TO_FLAG } from './horizon-change.js';

/** The command, reaching `gh`, `git` and the terminal through `seams`; see the module note. */
export function createEpicPromoteCommand(seams: EpicHorizonSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'epic promote',
    subject: 'epic',
    action: 'promote',
    summary: 'move an epic to an earlier horizon, commenting the reason',
    description: 'Swaps the epic\'s horizon: label for horizon:now or horizon:next in one edit and comments'
      + ' "Moved <from> → <to>: <reason>" on it. The reason is --reason, or asked once where there is a'
      + ' terminal; with neither, nothing changes and the question is printed. An issue that is not an open'
      + ' epic, a target equal to its horizon and one that is not earlier than it are refused with exit code'
      + ' 2 before anything is written. With `--output=json` the move is the data of the terminal result'
      + ' event.',
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
        description: `The horizon it moves to: one of ${PROMOTE_ACTION.targets.join(', ')}. Required.`,
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
        cmd: 'rafa epic promote 40 --to=now --reason="the customer asked"',
        note: 'Swaps horizon:next for horizon:now on #40 and comments "Moved next → now: the customer asked".',
      },
    ],
    outputs: ['text', 'json'],
    run: (context) => runEpicHorizon(context, PROMOTE_ACTION, seams),
  };
  return Object.freeze(command);
}

export default createEpicPromoteCommand();
