/**
 * `rafa pr open --head=<branch> --base=<branch> --title=<text> --body-file=<path>`:
 * one pull request opened from `head` into `base` through
 * `PullRequests.create`, or, when `head` already has an open pull
 * request, that pull request printed and none opened. Starts no Claude
 * session and declares no `spends`.
 *
 * What it reads in order, the body file and a head that already has a
 * pull request are the library half's, `open-pull.ts`, whose note
 * describes them; this module runs it and prints what it answers.
 *
 * ## Exit codes
 *
 * 0 for a pull request opened and for one already open on the head. 2
 * for a provider that is not `gh`, as every `pr` action refuses. 1 for
 * every other refusal: a stray word, a flag left out, typed bare or
 * blank, a head equal to the base, a body file that cannot be read or is
 * empty, a config that cannot be used, and a provider call that
 * rejected. With `--output=json` the `PrOpenResult` of `open-pull.ts`
 * is the data of the terminal result event.
 */
import type { PrSeams } from './pr-context.js';
import type { RafaCommand } from '@open-tomato/rafa/core/command';

import { PR_OPEN_DECLARATION } from './declarations.js';
import { baseWarning, openPull, renderOpen } from './open-pull.js';
import { DEFAULT_PR_SEAMS } from './pr-context.js';

/** The command, reaching the provider through `seams`; see the module note. */
export function createPrOpenCommand(seams: PrSeams = DEFAULT_PR_SEAMS): RafaCommand {
  const command: RafaCommand = {
    ...PR_OPEN_DECLARATION,
    run: async (context) => {
      const result = await openPull(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(result);
        return;
      }
      const warning = baseWarning(result);
      if (warning !== null) context.output.warn(warning);
      context.output.info(renderOpen(result));
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createPrOpenCommand();
export default command;
