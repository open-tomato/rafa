/**
 * `rafa issue comment <id> --body=<text>`: one comment on an issue on the
 * tracker the chain lands on.
 *
 * ## What is read
 *
 * The line first: exactly one argument, the id, and `--body`, required
 * and not blank. Then the tracker, through the chain
 * (`issue-tracker.ts`), and its `comment` on the ref the id names there.
 * The id is the adapter's to check, and on a degraded chain it names an
 * issue on the tracker fallen back to; the module note of
 * `issue-tracker.ts` says why. `github` posts the body with
 * `gh issue comment`, and `local` appends it, stamped with the time, to
 * the issue's file (`adapters/tracker/local.ts`).
 *
 * ## What it writes
 *
 * In text mode, `Commented on <kind> issue <id>.` In json mode the
 * terminal result's `data` is an {@link IssueCommentResult}: the tracker
 * and the ref commented on.
 *
 * ## Refusals
 *
 * Exit code 1, as `issue-tracker.ts` words them: no id or more than one,
 * a `--body` left out or blank, a config refused, a chain landing
 * nowhere, and a `comment` that rejects, such as one for an id no issue
 * holds.
 */
import type { IssueSeams, IssueTrackerData } from './issue-tracker.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { IssueRef } from '../../ports/index.js';

import { expectOneArgument } from '../plan/plan-files.js';

import {
  DEFAULT_ISSUE_SEAMS,
  issueName,
  issueRef,
  onTracker,
  readRequiredFlag,
  resolveIssueTracker,
} from './issue-tracker.js';

/** The usage line a refusal names. */
const USAGE = 'rafa issue comment <id> --body=<text>';

/** What json mode gives as the terminal result's `data`. */
export interface IssueCommentResult {
  readonly tracker: IssueTrackerData;
  /** The ref the comment was posted on. */
  readonly ref: IssueRef;
}

/** Posts the comment a line holds; see the module note. */
export async function commentOnIssue(context: RafaContext, seams: IssueSeams): Promise<IssueCommentResult> {
  const id = expectOneArgument(context.args, USAGE);
  const body = readRequiredFlag(context.flags, 'body', USAGE);
  const { tracker, data } = await resolveIssueTracker(context, seams);
  const ref = issueRef(tracker, id);
  await onTracker(tracker, `comment on issue ${id}`, () => tracker.comment(ref, body));
  return { tracker: data, ref };
}

/** The command, resolving the chain with `seams`; see the module note. */
export function createIssueCommentCommand(seams: IssueSeams = DEFAULT_ISSUE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'issue comment',
    subject: 'issue',
    action: 'comment',
    summary: 'comment on one issue on the tracker',
    description: 'Posts `--body` as a comment on one issue on the tracker `tracker.default` names in'
      + ' `.rafa/config.yaml`, or on the first `tracker.fallback` kind whose preflight passes when it fails,'
      + ' each kind passed over warned about. The id is the issue number on that tracker, so on a tracker'
      + ' fallen back to it names a different issue. With `--output=json` the tracker and the ref commented'
      + ' on are the data of the terminal result event.',
    args: [
      {
        name: 'id',
        description: 'The issue id on the tracker: a GitHub issue number, or the number of a file under `.rafa/issues/`.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: 'body',
        description: 'The comment, as markdown. Required.',
        type: 'string',
        required: true,
      },
    ],
    examples: [
      {
        cmd: 'rafa issue comment 12 --body="Seen again after the retry change."',
        note: 'Posts one comment on issue 12 on the tracker the chain lands on.',
      },
      {
        cmd: 'rafa issue comment 12 --body=Reproduced --output=json',
        note: 'Writes a start event, then a result event whose data holds the tracker and the ref commented on.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const commented = await commentOnIssue(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(commented);
        return;
      }
      context.output.info(`Commented on ${issueName(commented.ref)}.`);
    },
  };
  return Object.freeze(command);
}

export default createIssueCommentCommand();
