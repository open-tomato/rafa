/**
 * `rafa issue list`: the issues on the tracker the chain lands on,
 * narrowed as its `find` narrows them; or, under `--roadmap`, the
 * Roadmap issue's lines in its order, as a table.
 *
 * ## What is read
 *
 * The line first: no argument, `--roadmap` and `--all` each typed bare,
 * `--state` and `--type` each one of the port's values
 * (`adapters/tracker/issue-values.ts`), `--module` and `--search` any
 * text that is not blank, and `--limit` a positive whole number. Then
 * the tracker, through the chain (`issue-tracker.ts`), and its `find`
 * with a query holding each flag typed, `--search` as `text`.
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
 * ## Under --roadmap
 *
 * The rows are the Roadmap issue's lines, read by `readRoadmapRows`
 * (`board/roadmap-rows.ts`), which owns every reading on them: which
 * issue is the Roadmap (`roadmap.issue`, else the one open issue titled
 * `Roadmap`), the unticked lines in body order — every line under
 * `--all` — and the `spec`, `blocked by`, `has` and `refs` columns. This
 * module resolves what it is handed and prints what it answers.
 *
 * The `refs` column is read by `readDoctorRefs` (`../doctor-refs.ts`),
 * the reading behind `rafa doctor`'s references row, narrowed to the
 * selected lines' issues and folded by `roadmapRefsCells`: the saved
 * copies under `specs.dir`, resolved against the project root, each
 * issue a copy names read once for the run through the same `gh`
 * runner. It writes nothing.
 *
 * The Roadmap and the board are GitHub's, so `--roadmap` resolves no
 * tracker, runs no preflight and reads the board whatever
 * `tracker.default` names: the config is read for `roadmap.issue` and
 * for `specs.dir`, where the saved copies are, and for `plan.dir`, the directory the `plan` mark is read in, resolved
 * against the project root as `resolvePlansDir`
 * (`commands/plan/plan-files.ts`) resolves it. The config is read once,
 * through `issueSubjectConfig`, so its warnings are written once.
 *
 * The other flags narrow AFTER the Roadmap's selection and keep its
 * order: `--type` and `--module` by the issue's type and module as the
 * board listing read them off its labels, which is the github tracker's
 * own reading; `--search` by the text, case folded, in the issue's title
 * or body, as the `local` tracker reads `text`; and `--limit` keeps the
 * first that many rows left. A row whose issue the board did not answer
 * matches no `--type` and no `--module`, since nothing says what it is,
 * and `--search` reads its line's own text, the one printed as its
 * title.
 *
 * `--state` beside `--roadmap` is refused, whatever its value and
 * whatever tracker the chain would land on: the board is GitHub's, which
 * holds an issue open or closed, the reason the github tracker refuses
 * every state. `--all` without `--roadmap` is refused: there is no
 * ticked line to include.
 *
 * ## What it writes
 *
 * In text mode, `Tracker: <kind>`, then one row per issue: its id, state,
 * type and title, the first three padded to a column, or `No issues.`
 * when none matched. In json mode the terminal result's `data` is an
 * {@link IssueListResult}: the tracker, the query `find` was handed, and
 * each issue as `get` answered it.
 *
 * Under `--roadmap`, text mode writes `Roadmap: #<n>`, then the table
 * `renderRoadmapTable` (`./roadmap-table.ts`) spells, fitted to the
 * terminal's width and uncut with no terminal, or `No issues.` when no
 * row is left. Each reading `readRoadmapRows` could not make — the board
 * unreachable, a branch scan or a pull request list failing — is written
 * as a `warn` line, a `warn` `log` event in json mode, and the rows
 * still print: an unreachable board leaves every row in the Roadmap's
 * order with its `spec` and `blocked by` empty, and the command exits
 * 0. In json mode the result's `data` is a {@link RoadmapListResult}.
 *
 * ## Refusals
 *
 * Exit code 1, as `issue-tracker.ts` words them: an argument, a switch
 * typed with a value, a flag value outside its set, a `--limit` that is
 * no positive whole number, `--state` beside `--roadmap`, `--all`
 * without it, a config refused, a chain landing nowhere, and a `find` or
 * a `get` that rejects. One `get` rejecting refuses the whole list, so no
 * row is left out unannounced.
 *
 * Under `--roadmap`, a Roadmap that cannot be found or read refuses with
 * `ROADMAP_REFUSAL_EXIT` (`board/roadmap.ts`), `plan create --next`'s
 * code for the same: there is no order to print.
 */
import type { IssueSeams, IssueTrackerData, LineFlags } from './issue-tracker.js';
import type { RoadmapRefs, RoadmapRow } from '../../board/roadmap-rows.js';
import type { RafaCommand, RafaContext, RafaFlagSpec } from '../../cli/command.js';
import type { Issue, IssueQuery, TrackerKind } from '../../ports/index.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { ISSUE_STATES, ISSUE_TYPES } from '../../adapters/tracker/issue-values.js';
import { createGhSpecIssueReader } from '../../board/issue.js';
import { createGhBoardListing } from '../../board/roadmap-board.js';
import { createPlanDirNames, readRoadmapRows } from '../../board/roadmap-rows.js';
import { createGhOpenPullRequests, createGhRoadmapSearch, ROADMAP_REFUSAL_EXIT } from '../../board/roadmap.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { createGitRunner } from '../../pr/git.js';
import { readDoctorRefs, roadmapRefsCells } from '../doctor-refs.js';
import { expectNoArgument, plansDirAt, readSwitch } from '../plan/plan-files.js';

import {
  DEFAULT_ISSUE_SEAMS,
  issueProject,
  issueSubjectConfig,
  lineRefusal,
  onTracker,
  readChoiceFlag,
  readNonBlankFlag,
  readTextFlag,
  resolveIssueTracker,
} from './issue-tracker.js';
import { renderRoadmapTable } from './roadmap-table.js';

/** The usage line a refusal names. */
const USAGE = 'rafa issue list [--roadmap [--all]] [--state=<state>] [--type=<type>] [--module=<name>]'
  + ' [--search=<text>] [--limit=<n>]';

/** What a switch typed with a value is told. */
const SWITCH_HINT = `Type it bare: ${USAGE}`;

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

/** What narrows the Roadmap's rows after its own selection: a query with no state. */
export type RoadmapFilter = Omit<IssueQuery, 'state'>;

/** What json mode gives as the terminal result's `data` under `--roadmap`. */
export interface RoadmapListResult {
  /** The Roadmap issue the lines were read from. */
  readonly roadmap: number;
  /** True under `--all`: the ticked lines were kept too. */
  readonly all: boolean;
  /** The narrowing applied after the Roadmap's selection, each flag left out absent from it. */
  readonly filter: RoadmapFilter;
  /** Each row left, in the Roadmap's order, every column as the row reading holds it. */
  readonly rows: readonly RoadmapRow[];
  /** A sentence per reading that failed, each also written as a warning. */
  readonly warnings: readonly string[];
}

/** Which listing a line asks for: the tracker's, or the Roadmap's with or without its ticked lines. */
export interface IssueListLine {
  readonly roadmap: boolean;
  readonly all: boolean;
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

/**
 * Which listing a line asks for, read before anything else on it; a
 * refusal with exit code 1 for a switch typed with a value, `--state`
 * beside `--roadmap` and `--all` without it. See the module note.
 */
export function readIssueListLine(flags: LineFlags): IssueListLine {
  const roadmap = readSwitch('roadmap', flags['roadmap'], SWITCH_HINT);
  const all = readSwitch('all', flags['all'], SWITCH_HINT);
  if (roadmap && flags['state'] !== undefined) {
    throw lineRefusal(
      '--state cannot narrow --roadmap: the Roadmap is read off the GitHub board, which holds an issue open or'
      + ' closed and so no state of the tracker',
      USAGE,
    );
  }
  if (all && !roadmap) throw lineRefusal('--all keeps the ticked Roadmap lines, so it needs --roadmap', USAGE);
  return { roadmap, all };
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

/** True when `row` passes every narrowing `filter` holds but the limit; see the module note. */
function matchesFilter(row: RoadmapRow, filter: RoadmapFilter): boolean {
  const { issue } = row;
  if (filter.type !== undefined && issue?.type !== filter.type) return false;
  if (filter.module !== undefined && issue?.module !== filter.module) return false;
  if (filter.text === undefined) return true;
  const text = issue === null
    ? row.line.why
    : `${issue.title}\n${issue.body}`;
  return text.toLowerCase().includes(filter.text.toLowerCase());
}

/** The rows `filter` leaves, in the order given, at most `filter.limit` of them. */
export function narrowRoadmapRows(rows: readonly RoadmapRow[], filter: RoadmapFilter): readonly RoadmapRow[] {
  const kept = rows.filter((row) => matchesFilter(row, filter));
  return Object.freeze(filter.limit === undefined
    ? kept
    : kept.slice(0, filter.limit));
}

/** The lines text mode writes for a roadmap listing, the table fitted to `width`; see the module note. */
export function renderRoadmapList(listed: Pick<RoadmapListResult, 'roadmap' | 'rows'>, width?: number): string[] {
  const head = `Roadmap: #${String(listed.roadmap)}`;
  if (listed.rows.length === 0) return [head, 'No issues.'];
  return [head, ...renderRoadmapTable(listed.rows, width)];
}

/**
 * The Roadmap's rows a line asks for, narrowed by `filter`, each failed
 * reading written as a warning; a refusal with a config refused, and
 * with `ROADMAP_REFUSAL_EXIT` when the Roadmap cannot be found or read.
 * See the module note.
 */
export async function listRoadmap(
  context: RafaContext,
  seams: IssueSeams,
  all: boolean,
  filter: RoadmapFilter,
): Promise<RoadmapListResult> {
  const project = issueProject(context);
  const warn = (message: string): void => {
    context.output.warn(message);
  };
  const config = issueSubjectConfig(project, warn);
  const gh = seams.gh ?? createGhRunner({ cwd: project.root });
  const plans = plansDirAt(project.root, config.planDir);
  const planNames = (seams.planNames ?? createPlanDirNames)(plans.path);
  const refs: RoadmapRefs = async (issues) => roadmapRefsCells(await readDoctorRefs(
    { root: project.root, specsDir: config.specsDir, gh, env: context.env, issues },
    { refsVerifier: seams.refsVerifier },
  ));

  let read;
  try {
    read = await readRoadmapRows({
      configured: config.roadmapIssue,
      search: createGhRoadmapSearch({ gh }),
      issues: createGhSpecIssueReader({ gh }),
      board: createGhBoardListing({ gh }),
      git: seams.git ?? createGitRunner(project.root),
      pullRequests: createGhOpenPullRequests({ gh }),
      planNames,
      refs,
      all,
    });
  } catch (error) {
    const code = error instanceof CommandExit
      ? error.exitCode
      : ROADMAP_REFUSAL_EXIT;
    throw new CommandExit(code, `❌ Could not read the roadmap: ${messageOf(error)}`);
  }

  for (const warning of read.warnings) warn(warning);
  return Object.freeze({
    roadmap: read.roadmap,
    all,
    filter,
    rows: narrowRoadmapRows(read.rows, filter),
    warnings: read.warnings,
  });
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

/** Runs one `issue list` line with `seams`, either listing, writing it in the line's output mode. */
export async function runIssueList(context: RafaContext, seams: IssueSeams): Promise<void> {
  const line = readIssueListLine(context.flags);
  if (!line.roadmap) {
    const listed = await listIssues(context, seams);
    if (context.outputMode === 'json') {
      context.output.result(listed);
      return;
    }
    for (const text of renderIssueList(listed.tracker.kind, listed.issues)) context.output.info(text);
    return;
  }

  expectNoArgument(context.args, USAGE);
  const filter: RoadmapFilter = readIssueQuery(context.flags);
  const listed = await listRoadmap(context, seams, line.all, filter);
  if (context.outputMode === 'json') {
    context.output.result(listed);
    return;
  }
  const width = (seams.terminalWidth ?? ((): number | undefined => process.stdout.columns))();
  for (const text of renderRoadmapList(listed, width)) context.output.info(text);
}

/** The flags `issue list` declares, `--roadmap` and `--all` first. */
export const ISSUE_LIST_FLAGS: readonly RafaFlagSpec[] = Object.freeze([
  {
    name: 'roadmap',
    description: 'List the unticked lines of the Roadmap issue instead, in its order, with the spec, blocked by,'
      + ' has and refs columns. Reads the GitHub board whatever tracker the chain lands on.',
    type: 'boolean',
  },
  {
    name: 'all',
    description: 'With --roadmap, keep the ticked lines too, each in its place. Refused without --roadmap.',
    type: 'boolean',
  },
  {
    name: 'state',
    description: `Only issues in this state: one of ${ISSUE_STATES.join(', ')}. Refused on the github tracker`
      + ' and beside --roadmap.',
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
    description: 'At most this many issues, a positive whole number. The limit of the tracker when left out,'
      + ' and none under --roadmap.',
    type: 'number',
  },
]);

/** The command, resolving the chain with `seams`; see the module note. */
export function createIssueListCommand(seams: IssueSeams = DEFAULT_ISSUE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'issue list',
    subject: 'issue',
    action: 'list',
    summary: 'list the issues on the tracker, or the Roadmap\'s lines in its order, narrowed by type, module or text',
    description: 'Lists the issues on the tracker `tracker.default` names in `.rafa/config.yaml`, or on the first'
      + ' `tracker.fallback` kind whose preflight passes when it fails, each kind passed over warned about.'
      + ' Prints the tracker, then one row per issue: its id, state, type and title. Each flag narrows the'
      + ' list, and a flag left out narrows by nothing. The github tracker holds an issue open or closed, so'
      + ' it refuses `--state`, and lists 30 issues unless `--limit` says otherwise. With `--roadmap` it lists'
      + ' the unticked lines of the Roadmap issue (`roadmap.issue`, else the open issue titled Roadmap) in its'
      + ' order instead, read off the GitHub board, as a table adding four columns: spec, whether the body'
      + ' passes the readiness gate; blocked by, each blocker and whether it is open; has, a plan, a branch'
      + ' or a pull request already made for it; and refs, how many references of the issue\'s saved copy under'
      + ' `specs.dir` read suspect or dangling, `-` with no copy. `--type`, `--module`, `--search` and `--limit` then narrow'
      + ' those rows, keeping their order, and an unreachable board is warned about with the rows still'
      + ' printed. With `--output=json` the tracker, the query and every issue, or under `--roadmap` the'
      + ' roadmap, the rows and the warnings, are the data of the terminal result event.',
    args: [],
    flags: [...ISSUE_LIST_FLAGS],
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
      {
        cmd: 'rafa issue list --roadmap',
        note: 'Prints the Roadmap\'s unticked lines in its order, with the spec, blocked by, has and refs of each.',
      },
      {
        cmd: 'rafa issue list --roadmap --all --type=bug',
        note: 'Prints the bugs on the Roadmap, ticked lines included, in the Roadmap\'s order.',
      },
    ],
    outputs: ['text', 'json'],
    run: (context) => runIssueList(context, seams),
  };
  return Object.freeze(command);
}

export default createIssueListCommand();
