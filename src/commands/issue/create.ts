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
 *   - `body` from `--body`, empty when left out;
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
 * a `create` that rejects.
 */
import type { IssueSeams, IssueTrackerData, LineFlags } from './issue-tracker.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { IssueDraft, IssueRef, IssueType } from '../../ports/index.js';

import { ISSUE_PRIORITIES, ISSUE_TYPES } from '../../adapters/tracker/issue-values.js';
import { TRIAGE_MODULE } from '../../triage/triage.js';
import { expectNoArgument } from '../plan/plan-files.js';

import {
  DEFAULT_ISSUE_SEAMS,
  issueName,
  onTracker,
  readChoiceFlag,
  readNonBlankFlag,
  readRequiredFlag,
  readTextFlag,
  resolveIssueTracker,
  urlLines,
} from './issue-tracker.js';

/** The usage line a refusal names. */
const USAGE = 'rafa issue create --title=<text> [--body=<text>] [--type=<type>] [--module=<name>] [--priority=<priority>]';

/** The type a draft takes when the line names none; see the module note. */
export const DEFAULT_ISSUE_TYPE: IssueType = 'code';

/** What json mode gives as the terminal result's `data`. */
export interface IssueCreateResult {
  readonly tracker: IssueTrackerData;
  /** The ref the tracker answered for the issue it filed. */
  readonly ref: IssueRef;
}

/** The draft a line's flags make; a refusal with exit code 1 for a flag refused. See the module note. */
export function readIssueDraft(flags: LineFlags): IssueDraft {
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

/** The lines text mode writes once an issue is filed. */
export function renderCreated(ref: IssueRef): string[] {
  return [`Created ${issueName(ref)}.`, ...urlLines(ref)];
}

/** Files the issue a line describes; see the module note. */
export async function createIssue(context: RafaContext, seams: IssueSeams): Promise<IssueCreateResult> {
  expectNoArgument(context.args, USAGE);
  const draft = readIssueDraft(context.flags);
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
      + ' `--module` say otherwise, and with no `--priority` the tracker marks it needs-triage. Prints the'
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
        description: 'The body of the issue, as markdown. Empty when left out.',
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
