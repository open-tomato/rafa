/**
 * `rafa pr open --head=<branch> --base=<branch> --title=<text> --body-file=<path>`:
 * one pull request opened from `head` into `base` through
 * `PullRequests.create`, or, when `head` already has an open pull
 * request, that pull request printed and none opened. Starts no Claude
 * session and declares no `spends`.
 *
 * ## What it reads, in order
 *
 * The line first: no positional word, then the four flags, each
 * required and none blank, then a head equal to the base, refused by
 * name, since a branch cannot be merged into itself. Then the body file,
 * then the config and the provider through `openPrContext`. So a line
 * refused for its words, and a body file that cannot be used, read no
 * config, make no provider and spawn no `gh`: the rule `pr-context.ts`
 * keeps for every `pr` action, and the one `issue create` keeps for its
 * own `--body-file`.
 *
 * ## The body file
 *
 * Read whole as UTF-8 from the path the flag names, a relative path from
 * the directory rafa runs in, and handed to the provider untrimmed. A
 * path that cannot be read (none there, a directory, no permission) is
 * refused naming it and the reason. So is a file holding nothing but
 * whitespace: the port opens a pull request with no body for an empty
 * one ({@link PullRequestDraft.body}), and a caller writing its body to
 * a file and getting nothing in it is a fault to stop on rather than a
 * pull request to open bare. There is no `-` for standard input.
 *
 * ## A head that already has a pull request
 *
 * `findOpen(head)` is asked before `create`, and an open pull request it
 * answers is printed and returned with `opened: false`, exit 0: running
 * the line twice opens one pull request. The port's `create` does not
 * look first (`src/pr/types.ts`), and `gh pr create` refuses a second
 * pull request for the same head and base, so asking is what makes a
 * repeat a reading rather than a failure. An open pull request on the
 * head INTO ANOTHER BASE is printed the same way, with a warning naming
 * both bases, since `findOpen` matches on the head alone and moving a
 * pull request onto another base is not this action's to do.
 *
 * ## Exit codes
 *
 * 0 for a pull request opened and for one already open on the head. 2
 * for a provider that is not `gh`, as every `pr` action refuses. 1 for
 * every other refusal: a stray word, a flag left out, typed bare or
 * blank, a head equal to the base, a body file that cannot be read or is
 * empty, a config that cannot be used, and a provider call that
 * rejected. With `--output=json` the {@link PrOpenResult} is the data of
 * the terminal result event.
 */
import type { LineFlags, PrSeams } from './pr-context.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { PullRequestDraft, PullRequestSummary } from '../../pr/index.js';

import { messageOf } from '../../config-sections.js';
import { readRequiredFlag } from '../issue/issue-tracker.js';

import { DEFAULT_PR_SEAMS, expectNoArguments, lineRefusal, onProvider, openPrContext, PR_USAGE } from './pr-context.js';

/** The usage line this action's refusals name. */
const USAGE = PR_USAGE.open;

/** What json mode gives as the terminal result's `data`. */
export interface PrOpenResult {
  /** True when this run opened the pull request, false when one was already open on the head. */
  readonly opened: boolean;
  /** The branch the line asked to open from. */
  readonly head: string;
  /** The branch the line asked to open into. */
  readonly base: string;
  /** The pull request opened, or the one already open on the head. */
  readonly pull: PullRequestSummary;
}

/** The four flags of a line, the body file not read yet. */
export interface PrOpenLine {
  readonly head: string;
  readonly base: string;
  readonly title: string;
  readonly bodyFile: string;
}

/** The line's four flags, refusing a stray word, a flag missing or blank, and a head equal to the base. */
export function readOpenLine(args: readonly string[], flags: LineFlags): PrOpenLine {
  expectNoArguments(args, USAGE);
  const head = readRequiredFlag(flags, 'head', USAGE);
  const base = readRequiredFlag(flags, 'base', USAGE);
  const title = readRequiredFlag(flags, 'title', USAGE);
  const bodyFile = readRequiredFlag(flags, 'body-file', USAGE);
  if (head === base) {
    throw lineRefusal(`--head and --base are both "${head}": a branch cannot be merged into itself`, USAGE);
  }
  return { head, base, title, bodyFile };
}

/** What the body file holds, refusing one that cannot be read and one holding nothing but whitespace. */
export async function readOpenBody(path: string): Promise<string> {
  let body: string;
  try {
    body = await Bun.file(path).text();
  } catch (error) {
    throw lineRefusal(`--body-file cannot read "${path}": ${messageOf(error)}`, USAGE);
  }
  if (body.trim() === '') {
    throw lineRefusal(`--body-file "${path}" is empty, and a pull request is not opened with no body`, USAGE);
  }
  return body;
}

/** Opens the pull request a line names, or answers the one already open on its head; see the module note. */
export async function openPull(context: RafaContext, seams: PrSeams): Promise<PrOpenResult> {
  const line = readOpenLine(context.args, context.flags);
  const body = await readOpenBody(line.bodyFile);
  const pr = openPrContext(context, seams);
  const { head, base } = line;

  const open = await onProvider(
    `read the open pull request for the branch "${head}"`,
    () => pr.pulls.findOpen(head),
  );
  if (open !== null) return { opened: false, head, base, pull: open };

  const draft: PullRequestDraft = { head, base, title: line.title, body };
  const pull = await onProvider(
    `open a pull request from "${head}" into "${base}"`,
    () => pr.pulls.create(draft),
  );
  return { opened: true, head, base, pull };
}

/** The warning a pull request already open on the head into another base gets, or null. */
export function baseWarning(result: PrOpenResult): string | null {
  if (result.opened || result.pull.baseRefName === result.base) return null;
  return `#${result.pull.number} is open from "${result.head}" into "${result.pull.baseRefName}", not into "${result.base}"`;
}

/** The one line text mode prints for a result. */
export function renderOpen(result: PrOpenResult): string {
  const { pull } = result;
  const what = `#${pull.number} ${pull.title} (${pull.headRefName} → ${pull.baseRefName}) ${pull.url}`;
  return result.opened
    ? `✅ Opened ${what}`
    : `✅ Already open, so none was opened: ${what}`;
}

/** The command, reaching the provider through `seams`; see the module note. */
export function createPrOpenCommand(seams: PrSeams = DEFAULT_PR_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'pr open',
    subject: 'pr',
    action: 'open',
    summary: 'open a pull request from a pushed branch, or print the one already open on it',
    description: 'Opens a pull request from the branch `--head` into the branch `--base`, titled `--title`,'
      + ' its body what the file `--body-file` holds, and prints its number, title, branches and URL. The'
      + ' head is a branch already pushed: nothing is pushed for it. When the head already has an open pull'
      + ' request, that pull request is printed and none is opened, with a warning when it is into another'
      + ' base. Exit code 1, with nothing opened, for a flag left out or blank, a head equal to the base,'
      + ' and a body file that cannot be read or holds nothing but whitespace. With `--output=json` whether'
      + ' it opened one, the two branches and the pull request are the data of the terminal result event.'
      + ' Refuses with exit code 2 where `pr.provider` is not `gh`. Starts no session.',
    args: [],
    flags: [
      { name: 'head', description: 'The branch to open the pull request from, already pushed.', type: 'string' },
      { name: 'base', description: 'The branch to open the pull request into.', type: 'string' },
      { name: 'title', description: 'The title of the pull request.', type: 'string' },
      {
        name: 'body-file',
        description: 'The file holding the body, as markdown; read from the directory rafa runs in.',
        type: 'string',
      },
    ],
    examples: [
      {
        cmd: 'rafa pr open --head=feat/rafa-9 --base=stretch/9 --title="rafa-9: one item" --body-file=body.md',
        note: 'Opens feat/rafa-9 into stretch/9, or prints the pull request already open on feat/rafa-9.',
      },
      {
        cmd: 'rafa pr open --head=feat/rafa-9 --base=main --title="rafa-9" --body-file=body.md --output=json',
        note: 'Gives whether one was opened, the two branches and the pull request as the terminal result.',
      },
    ],
    outputs: ['text', 'json'],
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

export default createPrOpenCommand();
