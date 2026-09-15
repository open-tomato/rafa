/**
 * `rafa issue move <id> <state>`: one issue on the tracker the chain
 * lands on, moved to a state.
 *
 * ## What is read
 *
 * The line first: exactly two arguments, the id and the state, the state
 * one of the port's (`adapters/tracker/issue-values.ts`), checked before
 * the chain is resolved. Then the tracker, through the chain
 * (`issue-tracker.ts`), and its `transition` of the ref the id names
 * there. The id is the adapter's to check, and on a degraded chain it
 * names an issue on the tracker fallen back to; the module note of
 * `issue-tracker.ts` says why.
 *
 * ## A warning is not a failure
 *
 * The port answers a `warning` when the move's own write landed and a
 * later one did not. `github` holds an issue open or closed alone, so it
 * reopens or closes it and warns for the four states that write cannot
 * hold: `backlog`, `in-progress` and `in-review` read back as `todo`, and
 * `released` as `done` (`adapters/tracker/github.ts`). `local` writes the
 * state into the issue's file and warns for none. A warning is written at
 * `warn`, after the line saying the issue moved in text mode and before
 * the result in json mode, and the exit code stays 0: the tracker holds
 * the move it could make.
 *
 * ## What it writes
 *
 * In text mode, `Moved <kind> issue <id> to <state>.` In json mode the
 * terminal result's `data` is an {@link IssueMoveResult}: the tracker,
 * the ref, the state asked for and the warning, or null.
 *
 * ## Refusals
 *
 * Exit code 1, as `issue-tracker.ts` words them: a line handing other
 * than two arguments, a state outside the port's, a config refused, a
 * chain landing nowhere, and a `transition` that rejects, such as one for
 * an id no issue holds.
 */
import type { IssueSeams, IssueTrackerData } from './issue-tracker.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { IssueRef, IssueState } from '../../ports/index.js';

import { ISSUE_STATES } from '../../adapters/tracker/issue-values.js';

import {
  DEFAULT_ISSUE_SEAMS,
  expectTwoArguments,
  issueName,
  issueRef,
  onTracker,
  readChoice,
  resolveIssueTracker,
} from './issue-tracker.js';

/** The usage line a refusal names. */
const USAGE = 'rafa issue move <id> <state>';

/** What json mode gives as the terminal result's `data`. */
export interface IssueMoveResult {
  readonly tracker: IssueTrackerData;
  /** The ref moved. */
  readonly ref: IssueRef;
  /** The state asked for. */
  readonly state: IssueState;
  /** What the tracker could not hold of the move, or null when it held all of it. */
  readonly warning: string | null;
}

/** Moves the issue a line names; see the module note. */
export async function moveIssue(context: RafaContext, seams: IssueSeams): Promise<IssueMoveResult> {
  const [id, word] = expectTwoArguments(context.args, USAGE);
  const state = readChoice(word, 'The state', ISSUE_STATES, USAGE);
  const { tracker, data } = await resolveIssueTracker(context, seams);
  const ref = issueRef(tracker, id);
  const moved = await onTracker(tracker, `move issue ${id} to ${state}`, () => tracker.transition(ref, state));
  return { tracker: data, ref, state, warning: moved.warning ?? null };
}

/** The command, resolving the chain with `seams`; see the module note. */
export function createIssueMoveCommand(seams: IssueSeams = DEFAULT_ISSUE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'issue move',
    subject: 'issue',
    action: 'move',
    summary: 'move one issue on the tracker to a state',
    description: 'Moves one issue on the tracker `tracker.default` names in `.rafa/config.yaml`, or on the first'
      + ' `tracker.fallback` kind whose preflight passes when it fails, each kind passed over warned about,'
      + ` to one of the states ${ISSUE_STATES.join(', ')}. The id is the issue number on that tracker, so on`
      + ' a tracker fallen back to it names a different issue. The github tracker holds an issue open or'
      + ' closed, so it warns for backlog, in-progress, in-review and released, which it cannot hold, and'
      + ' still exits 0. With `--output=json` the tracker, the ref, the state and the warning are the data'
      + ' of the terminal result event.',
    args: [
      {
        name: 'id',
        description: 'The issue id on the tracker: a GitHub issue number, or the number of a file under `.rafa/issues/`.',
        type: 'string',
        required: true,
      },
      {
        name: 'state',
        description: `The state to move the issue to: one of ${ISSUE_STATES.join(', ')}.`,
        type: 'string',
        required: true,
      },
    ],
    flags: [],
    examples: [
      {
        cmd: 'rafa issue move 12 done',
        note: 'Moves issue 12 to done, which closes it on the github tracker.',
      },
      {
        cmd: 'rafa issue move 12 in-progress --output=json',
        note: 'Writes a start event, then a result event whose data holds the tracker, the ref, the state and any warning.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const moved = await moveIssue(context, seams);
      const warn = (): void => {
        if (moved.warning !== null) context.output.warn(`${issueName(moved.ref)}: ${moved.warning}`);
      };
      if (context.outputMode === 'json') {
        warn();
        context.output.result(moved);
        return;
      }
      context.output.info(`Moved ${issueName(moved.ref)} to ${moved.state}.`);
      warn();
    },
  };
  return Object.freeze(command);
}

export default createIssueMoveCommand();
