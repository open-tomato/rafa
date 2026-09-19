/**
 * `rafa pr current`: the open pull request of the branch checked out at
 * the project root, on one line.
 *
 * ## The line, and why it is assembled rather than formatted
 *
 * The spec asks for "one line: #n, title, state, checks verdict, URL
 * (URL alone when that is all `gh` answers)". So the line is not one
 * template with holes in it: it is the parts that came back, joined by
 * {@link SEPARATOR}, and a part nothing was readable for is left out
 * rather than printed as an empty field. The URL is the last part, so
 * the degenerate reading — nothing readable but the URL — renders as the
 * URL alone, which is the fallback the spec names, and not as a line of
 * separators around it. {@link renderCurrent} is that rule, pure and
 * total, and `current.test.ts` drives it over every subset.
 *
 * Which parts a `gh` provider can actually leave out, measured against
 * the adapter's readers in `src/pr/gh.ts`:
 *
 *   - The NUMBER and the STATE cannot. `readSummary` refuses a `number`
 *     that is not a positive whole number and a `state` that is not one
 *     of `OPEN`, `CLOSED` and `MERGED`, so a payload missing either is a
 *     throw and never a blank field on the line.
 *   - The TITLE and the URL can: both go through `readString`, which
 *     takes the empty string. A blank one drops its part.
 *   - The CHECKS VERDICT can, and this is the one that happens in the
 *     ordinary way: `PullRequests.checks` spawns its own `gh pr checks`,
 *     and an outage, an expired token or a repository `gh` cannot
 *     resolve fails that call while the summary is already in hand. So
 *     the call is caught here rather than allowed to refuse the whole
 *     command: the verdict part drops, {@link PrCurrentResult.checksProblem}
 *     carries what the provider said, and text mode writes it as a
 *     warning. A pull request with no checks AT ALL is a different
 *     answer — the verdict `none`, which the port declares — and it
 *     prints as `checks none`, so "nobody ran anything" never reads as
 *     "nobody could ask".
 *
 * The URL-alone line is therefore the PORT's fallback rather than a `gh`
 * payload seen in the wild. It is what a provider answering a summary
 * with no number, no title and no state leaves, and no `gh` answer
 * reaches it, because those are exactly the two fields `readSummary`
 * refuses a payload over and the field the port types as a closed set
 * with no absent member. So the rule is measured where it is total, on
 * {@link renderCurrent} itself, and what the cases drive end to end is
 * the degradation `gh` CAN produce: a blank title, and a checks call
 * that could not be made. Spelling the whole thing as "the parts that
 * came back" rather than as a special branch is what makes it one rule
 * instead of two that can drift apart, and it is why the command needs
 * no refusal for an empty line: through this action the state alone
 * already keeps the line non-empty.
 *
 * ## What it reads, in order
 *
 * The line first ({@link USAGE} takes no argument at all, the branch
 * being the only thing that names the pull request), then the config and
 * the provider through `openPrContext`, then the branch and its open
 * pull request through `pickPullRequest`, then the checks. That is
 * `pr-context.ts`'s order, and it is why a line with a stray word spawns
 * no `gh`.
 *
 * `pickPullRequest` is asked for no number, so what it answers carries
 * the summary the branch lookup already read
 * (`PullPick.summary`), and the whole command is two provider calls: one
 * `gh pr list --head`, one `gh pr checks`.
 *
 * ## Refusals
 *
 * `pr-context.ts`'s, and no others: exit 2 for a provider that is not
 * `gh`, exit 1 for a stray word, a config that cannot be used, a branch
 * that cannot be read, a detached HEAD, and a branch with no open pull
 * request. A checks call that failed is NOT one of them; see above.
 */
import type { PrSeams } from './pr-context.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ChecksVerdict, PullRequests, PullRequestState } from '../../pr/index.js';

import { messageOf } from '../../config-sections.js';

import { DEFAULT_PR_SEAMS, expectNoArguments, openPrContext, pickPullRequest, PR_USAGE } from './pr-context.js';

/** The usage line this action's refusals name. */
const USAGE = PR_USAGE.current;

/** What the parts of the line are joined by. */
export const SEPARATOR = ' — ';

/** Every part of the line, each null when nothing was readable for it. */
export interface PrCurrentReading {
  /** The pull request number, or null when the provider gave none above zero. */
  readonly number: number | null;
  /** The title, trimmed, or null when it is blank. */
  readonly title: string | null;
  readonly state: PullRequestState | null;
  /** The verdict over the checks, or null when the provider could not be asked. */
  readonly checks: ChecksVerdict | null;
  /** The URL, trimmed, or null when it is blank. */
  readonly url: string | null;
}

/** What json mode gives as the terminal result's `data`. */
export interface PrCurrentResult {
  /** The branch the pull request was found on. */
  readonly branch: string;
  /** The line text mode writes. */
  readonly line: string;
  /** What each part of the line was read as. */
  readonly pull: PrCurrentReading;
  /** What the checks read said when it failed, and null when it did not; see the module note. */
  readonly checksProblem: string | null;
}

/** A string with something in it, trimmed, or null. */
function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === ''
    ? null
    : trimmed;
}

/** The `#n title` part, or null when neither is readable. */
function headPart(reading: PrCurrentReading): string | null {
  const words = [
    reading.number === null
      ? null
      : `#${reading.number}`,
    reading.title,
  ].filter((word): word is string => word !== null);
  return words.length === 0
    ? null
    : words.join(' ');
}

/**
 * The one line for a reading: its readable parts, joined. Empty when
 * nothing at all was readable. See the module note for the rule.
 */
export function renderCurrent(reading: PrCurrentReading): string {
  const parts = [
    headPart(reading),
    reading.state,
    reading.checks === null
      ? null
      : `checks ${reading.checks}`,
    reading.url,
  ].filter((part): part is string => part !== null);
  return parts.join(SEPARATOR);
}

/** The verdict over a pull request's checks, or what kept the provider from answering one. */
interface ChecksProbe {
  readonly verdict: ChecksVerdict | null;
  readonly problem: string | null;
}

/** Asks the provider for the checks, answering what it said when it rejects; see the module note. */
async function probeChecks(pulls: PullRequests, number: number): Promise<ChecksProbe> {
  try {
    const reading = await pulls.checks(number);
    return { verdict: reading.verdict, problem: null };
  } catch (error) {
    return { verdict: null, problem: messageOf(error) };
  }
}

/** Reads the open pull request of the branch, and everything the line carries; see the module note. */
export async function readCurrent(context: RafaContext, seams: PrSeams): Promise<PrCurrentResult> {
  expectNoArguments(context.args, USAGE);
  const pr = openPrContext(context, seams);
  const pick = await pickPullRequest(pr, null, USAGE);
  const summary = pick.summary;
  const probe = await probeChecks(pr.pulls, pick.number);
  const reading: PrCurrentReading = {
    number: pick.number > 0
      ? pick.number
      : null,
    title: trimmedOrNull(summary?.title ?? ''),
    state: summary?.state ?? null,
    checks: probe.verdict,
    url: trimmedOrNull(summary?.url ?? ''),
  };
  return {
    branch: pick.branch ?? '',
    line: renderCurrent(reading),
    pull: reading,
    checksProblem: probe.problem,
  };
}

/** The command, reaching the provider and the branch through `seams`; see the module note. */
export function createPrCurrentCommand(seams: PrSeams = DEFAULT_PR_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'pr current',
    subject: 'pr',
    action: 'current',
    summary: 'show the open pull request of the current branch on one line',
    description: 'Reads the open pull request whose head is the branch checked out at the project root, and'
      + ' prints one line carrying its number, title, state, the verdict over its checks, and its URL.'
      + ' A part the provider answered nothing for is left out, so a pull request that only answers a URL'
      + ' prints as that URL alone. When the checks cannot be read at all the verdict is left out and what'
      + ' the GitHub CLI said is warned about, where a pull request with no checks prints `checks none`.'
      + ' With `--output=json` the branch, the line, the parts it was built from and any checks problem are'
      + ' the data of the terminal result event. Refuses with exit code 2 where `pr.provider` is not `gh`.',
    args: [],
    flags: [],
    examples: [
      {
        cmd: 'rafa pr current',
        note: 'Prints one line for the open pull request of the branch checked out at the project root.',
      },
      {
        cmd: 'rafa pr current --output=json',
        note: 'Writes a start event, then a result event holding the branch, the line and each part of it.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const current = await readCurrent(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(current);
        return;
      }
      if (current.checksProblem !== null) context.output.warn(`the checks could not be read: ${current.checksProblem}`);
      context.output.info(current.line);
    },
  };
  return Object.freeze(command);
}

export default createPrCurrentCommand();
