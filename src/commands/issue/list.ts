/**
 * `rafa issue list`: the issues on the tracker the chain lands on,
 * narrowed as its `find` narrows them.
 *
 * ## What is read
 *
 * The line first: no argument, `--state` and `--type` each one of the
 * port's values (`adapters/tracker/issue-values.ts`), `--module` and
 * `--search` any text that is not blank, and `--limit` a positive whole
 * number. Then the tracker, through the chain (`issue-tracker.ts`), and
 * its `find` with a query holding each flag typed, `--search` as `text`.
 * A flag left out narrows by nothing, and with no `--limit` the adapter
 * applies its own: 30 on `github`, none on `local`. A ref carries no
 * title, so each ref `find` answers is then read with `get`, all of them
 * at once and given in the order `find` answered them: one
 * `gh issue view` per issue on `github`.
 *
 * `github`'s `find` refuses every state, because GitHub holds an issue
 * open or closed and each state shares its bucket with others
 * (`adapters/tracker/github.ts`), so `--state` on `github` is refused
 * with the adapter's reason. `local` narrows by it.
 *
 * ## What it writes
 *
 * In text mode, `Tracker: <kind>`, then one row per issue: its id, state,
 * type and title, the first three padded to a column, or `No issues.`
 * when none matched. In json mode the terminal result's `data` is an
 * {@link IssueListResult}: the tracker, the query `find` was handed, and
 * each issue as `get` answered it.
 *
 * ## Refusals
 *
 * Exit code 1, as `issue-tracker.ts` words them: an argument, a flag
 * value outside its set, a `--limit` that is no positive whole number, a
 * config refused, a chain landing nowhere, and a `find` or a `get` that
 * rejects. One `get` rejecting refuses the whole list, so no row is left
 * out unannounced.
 */
import type { IssueSeams, IssueTrackerData, LineFlags } from './issue-tracker.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { Issue, IssueQuery, TrackerKind } from '../../ports/index.js';

import { ISSUE_STATES, ISSUE_TYPES } from '../../adapters/tracker/issue-values.js';
import { expectNoArgument } from '../plan/plan-files.js';

import {
  DEFAULT_ISSUE_SEAMS,
  lineRefusal,
  onTracker,
  readChoiceFlag,
  readNonBlankFlag,
  readTextFlag,
  resolveIssueTracker,
} from './issue-tracker.js';

/** The usage line a refusal names. */
const USAGE = 'rafa issue list [--state=<state>] [--type=<type>] [--module=<name>] [--search=<text>] [--limit=<n>]';

/** A limit as written: a positive whole number with no leading zero. */
const LIMIT = /^[1-9]\d*$/;

/** What json mode gives as the terminal result's `data`. */
export interface IssueListResult {
  readonly tracker: IssueTrackerData;
  /** The query `find` was handed, each flag left out absent from it. */
  readonly query: IssueQuery;
  /** Each issue `find` answered, as `get` read it, in the order `find` answered them. */
  readonly issues: readonly Issue[];
}

/** The `--limit` a line gives, or undefined when it gives none; a refusal for any value but a positive whole number. */
function readLimit(flags: LineFlags): number | undefined {
  const value = readTextFlag(flags, 'limit', USAGE);
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (LIMIT.test(value) && Number.isSafeInteger(limit)) return limit;
  throw lineRefusal(`--limit is "${value}", expected a positive whole number`, USAGE);
}

/**
 * The query a line's flags make, each flag left out absent from it; a
 * refusal with exit code 1 for a value the flag does not take. See the
 * module note.
 */
export function readIssueQuery(flags: LineFlags): IssueQuery {
  const narrowed: IssueQuery = {
    state: readChoiceFlag(flags, 'state', ISSUE_STATES, USAGE),
    type: readChoiceFlag(flags, 'type', ISSUE_TYPES, USAGE),
    module: readNonBlankFlag(flags, 'module', USAGE),
    text: readNonBlankFlag(flags, 'search', USAGE),
    limit: readLimit(flags),
  };
  // Every key dropped is one whose value is undefined, so the rest keep their types.
  return Object.fromEntries(Object.entries(narrowed).filter(([, value]) => value !== undefined)) as IssueQuery;
}

/** The lines text mode writes for a list; see the module note. */
export function renderIssueList(kind: TrackerKind, issues: readonly Issue[]): string[] {
  const head = `Tracker: ${kind}`;
  if (issues.length === 0) return [head, 'No issues.'];

  const widest = (column: (issue: Issue) => string): number => Math.max(...issues.map((issue) => column(issue).length));
  const idWidth = widest((issue) => issue.ref.externalId);
  const stateWidth = widest((issue) => issue.state);
  const typeWidth = widest((issue) => issue.type);
  const rows = issues.map((issue) => [
    issue.ref.externalId.padStart(idWidth),
    issue.state.padEnd(stateWidth),
    issue.type.padEnd(typeWidth),
    issue.title,
  ].join('  '));
  return [head, ...rows.map((row) => `  ${row}`)];
}

/** Lists the issues a line asks for; see the module note. */
export async function listIssues(context: RafaContext, seams: IssueSeams): Promise<IssueListResult> {
  expectNoArgument(context.args, USAGE);
  const query = readIssueQuery(context.flags);
  const { tracker, data } = await resolveIssueTracker(context, seams);
  const refs = await onTracker(tracker, 'list issues', () => tracker.find(query));
  const issues = await onTracker(tracker, 'read the issues listed', () => Promise.all(refs.map((ref) => tracker.get(ref))));
  return { tracker: data, query, issues };
}

/** The command, resolving the chain with `seams`; see the module note. */
export function createIssueListCommand(seams: IssueSeams = DEFAULT_ISSUE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'issue list',
    subject: 'issue',
    action: 'list',
    summary: 'list the issues on the tracker, narrowed by state, type, module or text',
    description: 'Lists the issues on the tracker `tracker.default` names in `.rafa/config.yaml`, or on the first'
      + ' `tracker.fallback` kind whose preflight passes when it fails, each kind passed over warned about.'
      + ' Prints the tracker, then one row per issue: its id, state, type and title. Each flag narrows the'
      + ' list, and a flag left out narrows by nothing. The github tracker holds an issue open or closed, so'
      + ' it refuses `--state`, and lists 30 issues unless `--limit` says otherwise. With `--output=json`'
      + ' the tracker, the query and every issue are the data of the terminal result event.',
    args: [],
    flags: [
      {
        name: 'state',
        description: `Only issues in this state: one of ${ISSUE_STATES.join(', ')}. Refused on the github tracker.`,
        type: 'string',
      },
      {
        name: 'type',
        description: `Only issues of this type: one of ${ISSUE_TYPES.join(', ')}.`,
        type: 'string',
      },
      {
        name: 'module',
        description: 'Only issues of this module.',
        type: 'string',
      },
      {
        name: 'search',
        description: 'Only issues whose title or body holds this text.',
        type: 'string',
      },
      {
        name: 'limit',
        description: 'At most this many issues, a positive whole number. The limit of the tracker when left out.',
        type: 'number',
      },
    ],
    examples: [
      {
        cmd: 'rafa issue list',
        note: 'Lists the issues on the tracker the chain lands on, one row each.',
      },
      {
        cmd: 'rafa issue list --type=bug --search=timeout',
        note: 'Lists the bugs whose title or body holds the word timeout.',
      },
      {
        cmd: 'rafa issue list --limit=5 --output=json',
        note: 'Writes a start event, then a result event whose data holds the tracker, the query and five issues at most.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const listed = await listIssues(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(listed);
        return;
      }
      for (const line of renderIssueList(listed.tracker.kind, listed.issues)) context.output.info(line);
    },
  };
  return Object.freeze(command);
}

export default createIssueListCommand();
