/**
 * `rafa pr view [<n>]`: the pull request opened in the browser.
 *
 * ## One provider call, or two, and never a read it does not use
 *
 * The action's whole work is `PullRequests.browse`, which the `gh`
 * adapter spells `gh pr view <n> --web` (`src/pr/gh.ts`). It asks the
 * provider for nothing else:
 *
 *   - With `<n>` on the line, `pickPullRequest` sends no call at all, so
 *     the command is the one `gh pr view --web`. The number is not
 *     checked against the repository first, which would be a second
 *     round trip to learn what `gh` is about to answer anyway: a number
 *     the repository has no pull request for fails in `gh`, and what it
 *     said is the refusal ({@link USAGE}, exit code 1).
 *   - With no `<n>`, the branch lookup is the one extra call, and it is
 *     the call that answers WHICH pull request. What it read is carried
 *     on the pick (`PullPick.summary`), so the URL the confirmation line
 *     names costs nothing.
 *
 * So {@link PrViewResult.url} is null exactly when `<n>` named the pull
 * request, and the line is then the number alone. `pr show` is the
 * action that reads a pull request in full, and spending its `gh pr view
 * --json` here to decorate a confirmation would double the cost of the
 * ordinary `rafa pr view 41`.
 *
 * ## What a browser that did not open looks like
 *
 * Nothing, from here. `gh pr view --web` hands the URL to the platform
 * opener and exits 0 once it has; a machine with no browser, or a
 * headless session, is between `gh` and the operating system, and the
 * port has no answer for it. So the confirmation line is written for an
 * exit 0 and says the pull request was OPENED, which is what the
 * provider reported. A `gh` that itself failed — absent, unauthenticated,
 * a repository it cannot resolve, a number it has no pull request for —
 * rejects, and {@link onProvider} turns that into the exit-1 refusal
 * carrying `gh`'s own words.
 *
 * ## Refusals
 *
 * `pr-context.ts`'s: exit 2 for a provider that is not `gh`, exit 1 for
 * a second word, a word that is no whole number from 1, a config that
 * cannot be used, a branch that cannot be read, a detached HEAD, and a
 * branch with no open pull request. Plus the one of its own above, for a
 * `browse` the provider rejected.
 */
import type { PrSeams, PullSource } from './pr-context.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';

import { SEPARATOR } from './current.js';
import {
  DEFAULT_PR_SEAMS,
  onProvider,
  openPrContext,
  pickPullRequest,
  PR_USAGE,
  readPullArgument,
} from './pr-context.js';

/** The usage line this action's refusals name. */
const USAGE = PR_USAGE.view;

/** What json mode gives as the terminal result's `data`. */
export interface PrViewResult {
  /** The pull request that was opened. */
  readonly number: number;
  /** `argument` when `<n>` named it, `branch` when the checked-out branch did. */
  readonly source: PullSource;
  /** The branch it was found on, or null when `<n>` named it. */
  readonly branch: string | null;
  /** Its URL, or null when nothing already read answered one; see the module note. */
  readonly url: string | null;
  /** The line text mode writes. */
  readonly line: string;
}

/** A string with something in it, trimmed, or null. */
function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === ''
    ? null
    : trimmed;
}

/** The confirmation line: the pull request opened, and its URL when one is in hand. */
export function renderView(number: number, url: string | null): string {
  const opened = `Opened #${number} in the browser`;
  return url === null
    ? opened
    : `${opened}${SEPARATOR}${url}`;
}

/** Picks the pull request and hands it to the provider's browser; see the module note. */
export async function runView(context: RafaContext, seams: PrSeams): Promise<PrViewResult> {
  const asked = readPullArgument(context.args, USAGE);
  const pr = openPrContext(context, seams);
  const pick = await pickPullRequest(pr, asked, USAGE);
  await onProvider(`open pull request #${pick.number} in the browser`, () => pr.pulls.browse(pick.number));
  const url = trimmedOrNull(pick.summary?.url ?? '');
  return {
    number: pick.number,
    source: pick.source,
    branch: pick.branch,
    url,
    line: renderView(pick.number, url),
  };
}

/** The command, reaching the provider and the branch through `seams`; see the module note. */
export function createPrViewCommand(seams: PrSeams = DEFAULT_PR_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'pr view',
    subject: 'pr',
    action: 'view',
    summary: 'open a pull request in the browser',
    description: 'Hands one pull request to the GitHub CLI to open in the browser, and writes one line naming what'
      + ' was opened. Without a number it opens the open pull request whose head is the branch checked out at the'
      + ' project root, and the line carries that pull request\'s URL; with a number it opens that pull request and'
      + ' names it alone, reading nothing else about it. A GitHub CLI that could not open it — absent,'
      + ' unauthenticated, or holding no such pull request — refuses with exit code 1 carrying what it said. With'
      + ' `--output=json` the number, where it came from, the branch, the URL and the line are the data of the'
      + ' terminal result event. Refuses with exit code 2 where `pr.provider` is not `gh`.',
    args: [
      {
        name: 'n',
        description: 'The pull request number. The open pull request of the current branch when it is left out.',
        type: 'number',
      },
    ],
    flags: [],
    examples: [
      {
        cmd: 'rafa pr view',
        note: 'Opens the open pull request of the branch checked out at the project root.',
      },
      {
        cmd: 'rafa pr view 41',
        note: 'Opens pull request 41, whatever branch is checked out.',
      },
      {
        cmd: 'rafa pr view 41 --output=json',
        note: 'Writes a start event, then a result event naming the pull request that was opened.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const viewed = await runView(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(viewed);
        return;
      }
      context.output.info(viewed.line);
    },
  };
  return Object.freeze(command);
}

export default createPrViewCommand();
