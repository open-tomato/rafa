/**
 * `rafa pr show [<n>]`: one pull request in detail — its title, its
 * author, the branch it is from into the branch it is into, whether it
 * merges, every check with its state and its link, and the last triage
 * made on it.
 *
 * ## The reads, and the two that are allowed to fail
 *
 * The line first, then the config and the provider through
 * `openPrContext`, then the pull request through `pickPullRequest` — one
 * `gh pr list --head` where the branch names it, none where `<n>` does —
 * as `pr-context.ts` orders them, so a line with a stray word spawns no
 * `gh`. Then three reads of its own:
 *
 *   - `get`, which answers the DETAIL — `mergeable` and
 *     `mergeStateStatus` are on no summary — and whose failure refuses
 *     the command. Everything printed hangs off it, so there is nothing
 *     to show without it. A repository with no such pull request is
 *     `null` rather than a throw (the port's rule), and that is a
 *     refusal of the line, naming the number.
 *   - `checks`, and
 *   - `comments`, which are DEGRADED rather than fatal. Each is its own
 *     `gh` invocation, and an outage, an expired token or a rate limit
 *     fails it while the detail is already in hand. A report that
 *     refused outright over the triage comment would hide the mergeable
 *     state that was read fine. So each answers a problem instead, and
 *     the problem is printed IN ITS OWN SECTION, where the reader is
 *     looking for what it replaced. `pr current` warns instead, because
 *     it has one line and no section to put it in.
 *
 * The distinction the sections keep is the one `pr current` keeps for
 * the verdict: `checks none` is a pull request GitHub ran nothing for,
 * and `checks could not be read` is a question that could not be asked.
 * Rendering both as an absence would make a conflicting pull request —
 * which schedules no run at all, `src/pr/checks.ts` — look like an
 * outage.
 *
 * ## The rendering is one pure function
 *
 * {@link renderShow} takes what was read and answers the whole report,
 * problems included, so every shape is driven by calling it rather than
 * by provoking a provider into each one. Nothing is written through
 * `output.warn`: a detail report that put half its findings in warnings
 * would read in two places at once, and `show.test.ts` would have to
 * assert over stream interleaving to know what a reader sees.
 *
 * The parts of a line are joined the way `pr current` joins them
 * ({@link SEPARATOR}, imported from it), one subject's two readings
 * being read by one person. Check rows are `formatRows`
 * (`src/pr/checks.ts`), the one row format the wrap-up gate and a repair
 * prompt already print, so a check reads the same wherever it is shown.
 *
 * ## Refusals
 *
 * `pr-context.ts`'s — exit 2 for a provider that is not `gh`, exit 1 for
 * a word that is no pull request number, a second word, a config that
 * cannot be used, a branch that cannot be read, a detached HEAD and a
 * branch with no open pull request — and one of its own: exit 1 for a
 * number the repository has no pull request under. A checks read and a
 * comments read that failed are not refusals; see above.
 */
import type { LastTriage } from './last-triage.js';
import type { PrSeams } from './pr-context.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ChecksReading, PullRequestDetail } from '../../pr/index.js';

import { messageOf } from '../../config-sections.js';
import { formatRows } from '../../pr/index.js';

import { SEPARATOR } from './current.js';
import { readLastTriage } from './last-triage.js';
import {
  DEFAULT_PR_SEAMS,
  lineRefusal,
  onProvider,
  openPrContext,
  pickPullRequest,
  PR_USAGE,
  readPullArgument,
} from './pr-context.js';

/** The usage line this action's refusals name. */
const USAGE = PR_USAGE.show;

/** What a line under a section is indented by, as `formatRows` indents a check row. */
const INDENT = '   ';

/** How many characters of a commit sha a line names it by. */
const SHORT_SHA = 7;

/** Everything the report is rendered from: what was read, and what could not be. */
export interface PrShowReading {
  /** The pull request in full, which the report hangs off. */
  readonly detail: PullRequestDetail;
  /** Its checks, or null when the provider could not be asked. */
  readonly checks: ChecksReading | null;
  /** What the checks read said when it failed, and null when it did not. */
  readonly checksProblem: string | null;
  /** The last triage comment, or null when there is none or none could be read. */
  readonly triage: LastTriage | null;
  /** What the comments read said when it failed, and null when it did not. */
  readonly triageProblem: string | null;
}

/** What json mode gives as the terminal result's `data`. */
export interface PrShowResult extends PrShowReading {
  /** The report text mode writes. */
  readonly text: string;
}

/** The `#n title` line, carrying the number alone when the title is blank. */
function headLine(detail: PullRequestDetail): string {
  const title = detail.title.trim();
  return title === ''
    ? `#${detail.number}`
    : `#${detail.number} ${title}`;
}

/** The author, marked as a bot where it is one: `dependabot[bot]` is. */
function authorWord(detail: PullRequestDetail): string {
  return detail.author.isBot
    ? `${detail.author.login} (bot)`
    : detail.author.login;
}

/** Whether it merges, with GitHub's own merge state beside it. */
function mergeWord(detail: PullRequestDetail): string {
  const status = detail.mergeStateStatus.trim();
  return status === ''
    ? detail.mergeable
    : `${detail.mergeable} (${status})`;
}

/** The state, the author, the branches and the mergeability, on one line. */
function factsLine(detail: PullRequestDetail): string {
  return [
    detail.state,
    authorWord(detail),
    `${detail.headRefName} → ${detail.baseRefName}`,
    mergeWord(detail),
  ].join(SEPARATOR);
}

/** The checks section: the verdict, then one line per check, or what kept it from being read. */
function checksLines(reading: PrShowReading): readonly string[] {
  if (reading.checks === null) {
    return [`checks could not be read${SEPARATOR}${reading.checksProblem ?? 'the provider gave no reason'}`];
  }
  return [`checks ${reading.checks.verdict}`, formatRows(reading.checks.rows)];
}

/** `simple` or `not simple`, and nothing when the block did not say. */
function simpleWord(simple: boolean | null): string | null {
  if (simple === null) return null;
  return simple
    ? 'simple'
    : 'not simple';
}

/** How many resolve attempts have been spent, and nothing when none have. */
function attemptWord(attempts: number | null): string | null {
  if (attempts === null || attempts === 0) return null;
  return attempts === 1
    ? 'after 1 attempt'
    : `after ${attempts} attempts`;
}

/** When it was assessed, falling back to when the comment last moved. */
function whenWord(at: string | null, updatedAt: string): string {
  return at === null
    ? `commented ${updatedAt}`
    : `assessed ${at}`;
}

/** Which head it was made against, and whether the pull request is still on it. */
function headWord(head: string | null, headRefOid: string): string | null {
  if (head === null) return null;
  if (head === headRefOid) return 'against this head';
  return `against head ${head.slice(0, SHORT_SHA)}, where the head is now ${headRefOid.slice(0, SHORT_SHA)}`;
}

/** The triage section for a comment that was found: its line, its link, and what did not read. */
function foundTriageLines(triage: LastTriage, headRefOid: string): readonly string[] {
  const block = triage.block;
  const words = [
    `triage ${block?.class ?? 'unreadable'}`,
    simpleWord(block?.simple ?? null),
    attemptWord(block?.attempts ?? null),
    whenWord(block?.at ?? null, triage.updatedAt),
    headWord(block?.head ?? null, headRefOid),
  ].filter((word): word is string => word !== null);
  return [
    words.join(SEPARATOR),
    `${INDENT}${triage.url}${SEPARATOR}by ${triage.author}`,
    ...triage.problems.map((problem) => `${INDENT}${problem}`),
  ];
}

/** The triage section: the last triage, what kept it from being read, or that there is none. */
function triageLines(reading: PrShowReading): readonly string[] {
  if (reading.triageProblem !== null) {
    return [`triage could not be read${SEPARATOR}${reading.triageProblem}`];
  }
  if (reading.triage === null) {
    return [`triage none${SEPARATOR}run rafa pr triage to assess this pull request`];
  }
  return foundTriageLines(reading.triage, reading.detail.headRefOid);
}

/**
 * The whole report for a reading: the pull request, its checks and its
 * last triage, one section each, blank line between. Pure and total; see
 * the module note.
 */
export function renderShow(reading: PrShowReading): string {
  const url = reading.detail.url.trim();
  const head = [
    headLine(reading.detail),
    factsLine(reading.detail),
    ...url === ''
      ? []
      : [url],
  ];
  return [
    head.join('\n'),
    checksLines(reading).join('\n'),
    triageLines(reading).join('\n'),
  ].join('\n\n');
}

/** What a degradable read answered, or what the provider said when it failed. */
interface Probe<T> {
  readonly value: T | null;
  readonly problem: string | null;
}

/** Runs a read that is allowed to fail, answering what the provider said when it does. */
async function probe<T>(call: () => Promise<T>): Promise<Probe<T>> {
  try {
    return { value: await call(), problem: null };
  } catch (error) {
    return { value: null, problem: messageOf(error) };
  }
}

/** Reads one pull request, its checks and its last triage; see the module note. */
export async function readShow(context: RafaContext, seams: PrSeams): Promise<PrShowResult> {
  const asked = readPullArgument(context.args, USAGE);
  const pr = openPrContext(context, seams);
  const pick = await pickPullRequest(pr, asked, USAGE);
  const detail = await onProvider(`read pull request #${pick.number}`, () => pr.pulls.get(pick.number));
  if (detail === null) {
    throw lineRefusal(`No pull request #${pick.number} in the repository at ${pr.project.root}`, USAGE);
  }
  const checks = await probe(() => pr.pulls.checks(pick.number));
  const comments = await probe(() => pr.pulls.comments(pick.number));
  const reading: PrShowReading = {
    detail,
    checks: checks.value,
    checksProblem: checks.problem,
    triage: comments.value === null
      ? null
      : readLastTriage(comments.value),
    triageProblem: comments.problem,
  };
  return { ...reading, text: renderShow(reading) };
}

/** The command, reaching the provider and the branch through `seams`; see the module note. */
export function createPrShowCommand(seams: PrSeams = DEFAULT_PR_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'pr show',
    subject: 'pr',
    action: 'show',
    summary: 'show one pull request in detail, with its checks and its last triage',
    description: 'Reads one pull request in full and prints its number and title, its state, author, head branch,'
      + ' base branch and mergeability, its URL, every check with its state and its link, and the last rafa triage'
      + ' comment made on it. Without a number it reads the open pull request whose head is the branch checked out'
      + ' at the project root. The checks and the triage comment are read separately, and one that cannot be read'
      + ' says so in its own section rather than refusing the command, where a pull request with no checks reads'
      + ' `checks none`. With `--output=json` the pull request, the checks, the triage and the rendered text are'
      + ' the data of the terminal result event. Refuses with exit code 2 where `pr.provider` is not `gh`.',
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
        cmd: 'rafa pr show',
        note: 'Shows the open pull request of the branch checked out at the project root.',
      },
      {
        cmd: 'rafa pr show 41',
        note: 'Shows pull request 41, whatever branch is checked out.',
      },
      {
        cmd: 'rafa pr show 41 --output=json',
        note: 'Writes a start event, then a result event holding the pull request, its checks and its last triage.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const shown = await readShow(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(shown);
        return;
      }
      context.output.info(shown.text);
    },
  };
  return Object.freeze(command);
}

export default createPrShowCommand();
