/**
 * `rafa issue show <id>`: one issue on the tracker the chain lands on,
 * as its `get` answers it.
 *
 * ## What is read
 *
 * The line first: exactly one argument, the id. Then the tracker, through
 * the chain (`issue-tracker.ts`), and its `get` for the ref the id names
 * there. The id is the adapter's to check, and on a degraded chain it
 * names an issue on the tracker fallen back to; the module note of
 * `issue-tracker.ts` says why.
 *
 * ## What it writes
 *
 * In text mode, {@link renderIssue}'s lines: the tracker, the id, the URL
 * when the tracker gives one, the title, state, type and module, the
 * priority, `needs-triage` while the port holds none, the project and
 * the blocking issues when there are any, then a blank line and the body
 * line by line when it holds more than whitespace. The port carries no
 * comments, so none is shown. In json mode the terminal result's `data`
 * is an {@link IssueShowResult}: the tracker and the issue.
 *
 * ## Refusals
 *
 * Exit code 1, as `issue-tracker.ts` words them: no id or more than one,
 * a config refused, a chain landing nowhere, and a `get` that rejects,
 * such as one for an id no issue holds.
 */
import type { IssueSeams, IssueTrackerData } from './issue-tracker.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { Issue, TrackerKind } from '../../ports/index.js';

import { expectOneArgument } from '../plan/plan-files.js';

import {
  DEFAULT_ISSUE_SEAMS,
  issueRef,
  onTracker,
  resolveIssueTracker,
  urlLines,
} from './issue-tracker.js';

/** The usage line a refusal names. */
const USAGE = 'rafa issue show <id>';

/** What text mode writes for a priority the port holds none of. */
const NO_PRIORITY = 'needs-triage';

/** What json mode gives as the terminal result's `data`. */
export interface IssueShowResult {
  readonly tracker: IssueTrackerData;
  readonly issue: Issue;
}

/** The lines text mode writes for an issue; see the module note. */
export function renderIssue(kind: TrackerKind, issue: Issue): string[] {
  const project = issue.project === null
    ? []
    : [`Project: ${issue.project}`];
  const blockedBy = issue.blockedBy.length === 0
    ? []
    : [`Blocked by: ${issue.blockedBy.join(', ')}`];
  const body = issue.body.trim() === ''
    ? []
    : ['', ...issue.body.replace(/\n+$/, '').split('\n')];
  return [
    `Tracker: ${kind}`,
    `Issue: ${issue.ref.externalId}`,
    ...urlLines(issue.ref),
    `Title: ${issue.title}`,
    `State: ${issue.state}`,
    `Type: ${issue.type}`,
    `Module: ${issue.module}`,
    `Priority: ${issue.priority ?? NO_PRIORITY}`,
    ...project,
    ...blockedBy,
    ...body,
  ];
}

/** Reads the issue a line names; see the module note. */
export async function showIssue(context: RafaContext, seams: IssueSeams): Promise<IssueShowResult> {
  const id = expectOneArgument(context.args, USAGE);
  const { tracker, data } = await resolveIssueTracker(context, seams);
  const issue = await onTracker(tracker, `read issue ${id}`, () => tracker.get(issueRef(tracker, id)));
  return { tracker: data, issue };
}

/** The command, resolving the chain with `seams`; see the module note. */
export function createIssueShowCommand(seams: IssueSeams = DEFAULT_ISSUE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'issue show',
    subject: 'issue',
    action: 'show',
    summary: 'show one issue on the tracker: its fields, then its body',
    description: 'Reads one issue on the tracker `tracker.default` names in `.rafa/config.yaml`, or on the first'
      + ' `tracker.fallback` kind whose preflight passes when it fails, each kind passed over warned about.'
      + ' The id is the issue number on that tracker, so on a tracker fallen back to it names a different'
      + ' issue. Prints the tracker, the id, the URL when there is one, the title, state, type, module and'
      + ' priority, then the body. With `--output=json` the tracker and the issue are the data of the'
      + ' terminal result event.',
    args: [
      {
        name: 'id',
        description: 'The issue id on the tracker: a GitHub issue number, or the number of a file under `.rafa/issues/`.',
        type: 'string',
        required: true,
      },
    ],
    flags: [],
    examples: [
      {
        cmd: 'rafa issue show 12',
        note: 'Prints issue 12 on the tracker the chain lands on, its fields and then its body.',
      },
      {
        cmd: 'rafa issue show 12 --output=json',
        note: 'Writes a start event, then a result event whose data holds the tracker and the issue.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const shown = await showIssue(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(shown);
        return;
      }
      for (const line of renderIssue(shown.tracker.kind, shown.issue)) context.output.info(line);
    },
  };
  return Object.freeze(command);
}

export default createIssueShowCommand();
