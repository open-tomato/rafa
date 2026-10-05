/**
 * `rafa issue create --title=<text>`: one new issue on the tracker the
 * chain lands on, from the flags of the line.
 *
 * ## The draft
 *
 * Read off the line before the chain is resolved, so a refused line
 * files nothing and runs no preflight:
 *
 *   - `title` from `--title`, required and not blank;
 *   - `body` from `--body`, or from `--body-file` (see below), empty
 *     when both are left out;
 *   - `type` from `--type`, one of the port's types, {@link DEFAULT_ISSUE_TYPE}
 *     (`code`) when left out, the type `github`'s `get` answers for an
 *     issue with no type label;
 *   - `module` from `--module`, not blank, `TRIAGE_MODULE` (`unassigned`)
 *     when left out, the module triage files with and `github`'s `get`
 *     answers for an issue with no module label;
 *   - `priority` from `--priority`, one of the port's priorities, or null
 *     when left out, which the port spells as the adapter applying
 *     `needs-triage`;
 *   - `opt: 0`, no project and no blocking issue, as triage files
 *     (`triage/triage.ts`): rafa keeps no OPT ledger, and each adapter
 *     numbers its own issues.
 *
 * ## The body file
 *
 * `--body-file=<path>` reads the body from the file at `path`, as its
 * bytes decode to UTF-8 and nothing trimmed; `--body-file=-` reads it
 * from standard input, whole, through the `stdin` seam
 * ({@link IssueSeams}). A relative path is read from the directory rafa
 * runs in. The file is read after every flag is read and before the
 * chain is resolved, so a line naming both `--body` and `--body-file`,
 * or a path that cannot be read (none there, a directory, no
 * permission), is refused without reading the config, running a
 * preflight or filing anything.
 *
 * The adapter checks the draft again. `github` refuses a module holding a
 * comma, which `gh` would read as two labels, and makes every label it
 * sends before it files. `local` writes the file `<number>.md` under
 * `.rafa/issues/`, recording why the chain passed over each kind ahead of
 * it (`adapters/tracker/local.ts`).
 *
 * ## What it writes
 *
 * In text mode, `Created <kind> issue <id>.`, then the URL when the
 * tracker gives one. A `warning` on the ref, a step after the filing that
 * failed, is written at `warn` in either mode. In json mode the terminal
 * result's `data` is an {@link IssueCreateResult}: the tracker and the
 * ref.
 *
 * ## Refusals
 *
 * Exit code 1, as `issue-tracker.ts` words them: an argument, a
 * `--title` left out or blank, a `--type` or `--priority` outside its
 * set, a blank `--module`, a config refused, a chain landing nowhere, and
 * a `create` that rejects. Two more are this action's own, each naming
 * the usage line: `--body` beside `--body-file`, and a body file that
 * cannot be read, naming the path and the reason the read gave.
 */
import type { IssueSeams, IssueTrackerData, LineFlags } from './issue-tracker.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { IssueDraft, IssueRef, IssueType } from '../../ports/index.js';

import { ISSUE_PRIORITIES, ISSUE_TYPES } from '../../adapters/tracker/issue-values.js';
import { messageOf } from '../../config-sections.js';
import { TRIAGE_MODULE } from '../../triage/triage.js';
import { expectNoArgument } from '../plan/plan-files.js';

import {
  DEFAULT_ISSUE_SEAMS,
  issueName,
  lineRefusal,
  onTracker,
  readChoiceFlag,
  readNonBlankFlag,
  readRequiredFlag,
  readTextFlag,
  resolveIssueTracker,
  urlLines,
} from './issue-tracker.js';

/** The usage line a refusal names. */
const USAGE = 'rafa issue create --title=<text> [--body=<text> | --body-file=<path>] [--type=<type>] [--module=<name>] [--priority=<priority>]';

/** The `--body-file` value that reads standard input. */
export const STDIN_PATH = '-';

/** The type a draft takes when the line names none; see the module note. */
export const DEFAULT_ISSUE_TYPE: IssueType = 'code';

/** What json mode gives as the terminal result's `data`. */
export interface IssueCreateResult {
  readonly tracker: IssueTrackerData;
  /** The ref the tracker answered for the issue it filed. */
  readonly ref: IssueRef;
}

/**
 * The path `--body-file` names, or undefined when the line leaves it out;
 * a refusal with exit code 1 for a blank value and for one beside
 * `--body`. See the module note.
 */
export function readBodyFileFlag(flags: LineFlags): string | undefined {
  const path = readNonBlankFlag(flags, 'body-file', USAGE);
  if (path === undefined || flags.body === undefined) return path;
  throw lineRefusal('--body and --body-file cannot be used together: name the body one way', USAGE);
}

/**
 * The draft a line's flags make, its body from `--body` alone; a refusal
 * with exit code 1 for a flag refused, `--body` beside `--body-file`
 * among them. {@link readIssueLine} reads the body file. See the module
 * note.
 */
export function readIssueDraft(flags: LineFlags): IssueDraft {
  readBodyFileFlag(flags);
  return {
    opt: 0,
    title: readRequiredFlag(flags, 'title', USAGE),
    body: readTextFlag(flags, 'body', USAGE) ?? '',
    type: readChoiceFlag(flags, 'type', ISSUE_TYPES, USAGE) ?? DEFAULT_ISSUE_TYPE,
    module: readNonBlankFlag(flags, 'module', USAGE) ?? TRIAGE_MODULE,
    priority: readChoiceFlag(flags, 'priority', ISSUE_PRIORITIES, USAGE) ?? null,
    project: null,
    blockedBy: [],
  };
}

/**
 * The body `path` holds, or standard input's through `seams.stdin` for
 * {@link STDIN_PATH}; a refusal with exit code 1 naming the path and the
 * reason when it cannot be read.
 */
export async function readBodyFile(path: string, seams: Pick<IssueSeams, 'stdin'>): Promise<string> {
  const read = path === STDIN_PATH
    ? seams.stdin ?? (() => Bun.stdin.text())
    : () => Bun.file(path).text();
  try {
    return await read();
  } catch (error) {
    const where = path === STDIN_PATH
      ? 'standard input'
      : `"${path}"`;
    throw lineRefusal(`--body-file cannot read ${where}: ${messageOf(error)}`, USAGE);
  }
}

/** The draft a line makes, its body read from `--body-file` when the line names one; see the module note. */
export async function readIssueLine(flags: LineFlags, seams: Pick<IssueSeams, 'stdin'>): Promise<IssueDraft> {
  const draft = readIssueDraft(flags);
  const path = readBodyFileFlag(flags);
  return path === undefined
    ? draft
    : { ...draft, body: await readBodyFile(path, seams) };
}

/** The lines text mode writes once an issue is filed. */
export function renderCreated(ref: IssueRef): string[] {
  return [`Created ${issueName(ref)}.`, ...urlLines(ref)];
}

/** Files the issue a line describes; see the module note. */
export async function createIssue(context: RafaContext, seams: IssueSeams): Promise<IssueCreateResult> {
  expectNoArgument(context.args, USAGE);
  const draft = await readIssueLine(context.flags, seams);
  const { tracker, data } = await resolveIssueTracker(context, seams);
  const ref = await onTracker(tracker, 'create the issue', () => tracker.create(draft));
  return { tracker: data, ref };
}

/** The command, resolving the chain with `seams`; see the module note. */
export function createIssueCreateCommand(seams: IssueSeams = DEFAULT_ISSUE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'issue create',
    subject: 'issue',
    action: 'create',
    summary: 'create an issue on the tracker from a title and a body',
    description: 'Files one issue on the tracker `tracker.default` names in `.rafa/config.yaml`, or on the first'
      + ' `tracker.fallback` kind whose preflight passes when it fails, each kind passed over warned about.'
      + ' `--title` is required. The issue is of type `code` and module `unassigned` unless `--type` and'
      + ' `--module` say otherwise, and with no `--priority` the tracker marks it needs-triage. The body is'
      + ' `--body`, or what the file `--body-file` names holds, standard input for `-`. Prints the'
      + ' tracker and id of the issue filed, and its URL when there is one. With `--output=json` the tracker'
      + ' and the ref are the data of the terminal result event.',
    args: [],
    flags: [
      {
        name: 'title',
        description: 'The title of the issue. Required.',
        type: 'string',
        required: true,
      },
      {
        name: 'body',
        description: 'The body of the issue, as markdown. Empty when left out. Not with --body-file.',
        type: 'string',
      },
      {
        name: 'body-file',
        description: 'A file holding the body of the issue, read whole; `-` reads standard input. Not with --body.',
        type: 'string',
      },
      {
        name: 'type',
        description: `What the issue is for: one of ${ISSUE_TYPES.join(', ')}.`,
        type: 'string',
        default: DEFAULT_ISSUE_TYPE,
      },
      {
        name: 'module',
        description: 'The module the issue belongs to.',
        type: 'string',
        default: TRIAGE_MODULE,
      },
      {
        name: 'priority',
        description: `How urgent the issue is: one of ${ISSUE_PRIORITIES.join(', ')}. Marked needs-triage when left out.`,
        type: 'string',
      },
    ],
    examples: [
      {
        cmd: 'rafa issue create --title="Timeouts in plan show" --type=bug',
        note: 'Files a bug with no priority, which the tracker marks needs-triage.',
      },
      {
        cmd: 'rafa issue create --title="Document issue move" --priority=low --output=json',
        note: 'Writes a start event, then a result event whose data holds the tracker and the ref of the issue.',
      },
      {
        cmd: 'rafa issue create --title="Faster plan show" --body-file=spec.md',
        note: 'Files an issue whose body is what spec.md holds; --body-file=- reads it from standard input.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const created = await createIssue(context, seams);
      if (created.ref.warning !== undefined) context.output.warn(`${issueName(created.ref)}: ${created.ref.warning}`);
      if (context.outputMode === 'json') {
        context.output.result(created);
        return;
      }
      for (const line of renderCreated(created.ref)) context.output.info(line);
    },
  };
  return Object.freeze(command);
}

export default createIssueCreateCommand();
