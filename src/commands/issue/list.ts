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
 * issue is the Roadmap (the current place's board, handed the project
 * root so `.rafa/position.json` is weighed; with no position file the
 * default board, `roadmap.issue`, else the lowest-numbered open
 * `type:roadmap` board, else the one open issue titled `Roadmap`), the
 * unticked lines in body order — every line under
 * `--all` — and the `spec`, `blocked by`, `has` and `refs` columns. This
 * module resolves what it is handed and prints what it answers.
 *
 * The reading is `readRoadmapEpicRows` (`board/roadmap-epic-rows.ts`),
 * which asks `readRoadmapRows` for those rows and then tells the lines
 * naming an epic (an issue the board listing labels `type:epic`) from
 * the lines naming a spec, over the same one board listing. See
 * "Epic lines" below; a Roadmap naming no epic answers the rows
 * `readRoadmapRows` answers, untouched.
 *
 * The `refs` column is read by `readDoctorRefs` (`../doctor-refs.ts`),
 * the reading behind `rafa doctor`'s references row, narrowed to the
 * selected lines' issues and folded by `roadmapRefsCells`: the saved
 * copies under `specs.dir`, resolved against the project root, each
 * issue a copy names answered from the board listing when it holds it
 * and read once for the run through the same `gh` runner when it does
 * not. It writes nothing. In text mode it is read with `refsWhen:
 * 'plain'`: a Roadmap naming an epic prints no `refs` column anywhere,
 * so its copies are not read at all. `--full` prints the lines naming no
 * epic as the issue table, `refs` column included, so it reads them
 * always, as json mode does: a `-` there would claim no saved copy where
 * the truth is that none was read.
 *
 * ## One board read
 *
 * The board listing is {@link roadmapBoard}'s: asked once for the
 * command and handed to the rows, the epics and the refs column alike.
 * It is kept under `.rafa/cache/board.json` and read incrementally
 * (`../../board/board-cache.ts`) — a first read lists the whole board,
 * every later one asks GitHub only for the issues changed since — and
 * `--refresh` reads the whole board again. A case planting `gh` reads
 * uncached unless its seams set `boardCache`, so the commands it planted
 * are the commands sent.
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
 * They narrow the SPEC rows only. An epic row is chosen by its horizon
 * alone: its type is always `epic`, it carries no module the listing
 * reads for it, and `--limit` counts the rows of one table, so each flag
 * would either pass every epic or none. `--type=epic` therefore prints
 * the epics and no spec row.
 *
 * `--state` beside `--roadmap` is refused, whatever its value and
 * whatever tracker the chain would land on: the board is GitHub's, which
 * holds an issue open or closed, the reason the github tracker refuses
 * every state. `--all` without `--roadmap` is refused: there is no
 * ticked line to include.
 *
 * ## Epic lines
 *
 * `--all` widens the epics too: without it only the `now` horizon's
 * epic rows are shown, with it every horizon's, as it already widens to
 * the ticked lines.
 *
 * `--full` prints each shown epic's members under its row, two rows
 * each, as `renderEpicTable` spells them under its `full`: the only
 * listing that mixes the issues of two epics. It changes text mode only
 * — json mode's epics already carry every member — and a Roadmap naming
 * no epic prints today's bytes with it too. `--full` without
 * `--roadmap` is refused, as `--all` is.
 *
 * `--check` prints what the line would print without it, then weighs
 * every `type:epic` issue on the listing — not only the Roadmap's, and
 * whatever horizon is shown — its stored state against its computed one,
 * as `epicCheckFailure` (`./roadmap-check.ts`) reads them, and ends with
 * exit code 1 when one disagrees or the listing failed, naming each
 * disagreement on stderr in text mode and as the terminal error's message
 * in json mode. The dispatcher drops the payload of a non-zero ending,
 * so a failed check in json mode writes no result. A check that passes
 * changes nothing. `--check` without `--roadmap` is refused, as `--all`
 * is.
 *
 * When the Roadmap names at least one epic, shown or hidden by horizon,
 * or when the board listing failed so no line could be told an epic,
 * the table is the one `renderEpicTable` (`./roadmap-epic-table.ts`)
 * spells: one group per shown horizon headed `Roadmap #<n> · <horizon>`,
 * the `unknown` line with the listing's reason, the line counting the
 * epics a horizon hides, and one line counting the lines that name no
 * epic — listed as the issue table under `--full`, and as the table
 * under `Specs` when the listing failed and no line could be told an
 * epic. Each group names the Roadmap, so the `Roadmap: #<n>` head is
 * not written. Every label problem on the board is a warning, written
 * as the other warnings are; the reading adds none when the Roadmap
 * names no epic. Whenever the listing was read, the cancelled-epic
 * notice (`src/board/epic-cancel-notice.ts`) follows as warnings too,
 * one line per epic closed as not planned that open issues outside it
 * still wait on; a board with no such epic adds none.
 *
 * A Roadmap naming no epic, with the listing read, prints today's bytes:
 * the head, today's table over the spec rows (every row), and in json
 * mode a result with no `epics` key. A failed listing is not that path:
 * nothing says whether a line was an epic, so the `unknown` line is
 * printed and the rows sit under `Specs`.
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
 * row is left: `spec` and `blocked by` as symbols with a legend under
 * the table, or in words under `--texts` (`-t`), and each issue's labels
 * on a row under it only with `--labels`. Each reading `readRoadmapRows` could not make — the board
 * unreachable, a branch scan or a pull request list failing — is written
 * as a `warn` line, a `warn` `log` event in json mode, and the rows
 * still print: an unreachable board leaves every row in the Roadmap's
 * order with its `spec` and `blocked by` empty, and the command exits
 * 0. In json mode the result's `data` is a {@link RoadmapListResult},
 * carrying the epics as a {@link RoadmapEpicsResult} whenever the text
 * mode would print the epic table.
 *
 * ## Refusals
 *
 * Exit code 1, as `issue-tracker.ts` words them: an argument, a switch
 * typed with a value, a flag value outside its set, a `--limit` that is
 * no positive whole number, `--state` beside `--roadmap`, `--all`,
 * `--full` or `--check` without it, a config refused, a chain landing nowhere, and a `find` or
 * a `get` that rejects. One `get` rejecting refuses the whole list, so no
 * row is left out unannounced.
 *
 * Under `--roadmap`, a Roadmap that cannot be found or read refuses with
 * `ROADMAP_REFUSAL_EXIT` (`board/roadmap.ts`), `plan create --next`'s
 * code for the same: there is no order to print. Under `--check`, a
 * stored state disagreeing with its computed one, or a listing that
 * failed, ends with `EPIC_CHECK_EXIT`, 1.
 */
import type { IssueSeams, IssueTrackerData, LineFlags } from './issue-tracker.js';
import type { TableStyle } from './roadmap-table.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { EpicProblem } from '../../board/epic-problems.js';
import type { Epics } from '../../board/epics.js';
import type { BoardIssueState, BoardListing } from '../../board/roadmap-board.js';
import type { EpicHorizonGroup } from '../../board/roadmap-epic-rows.js';
import type { RoadmapRefs, RoadmapRow } from '../../board/roadmap-rows.js';
import type { RafaCommand, RafaContext, RafaFlagSpec } from '../../cli/command.js';
import type { Issue, IssueQuery, TrackerKind } from '../../ports/index.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { ISSUE_STATES, ISSUE_TYPES } from '../../adapters/tracker/issue-values.js';
import { createCachedBoardListing } from '../../board/board-cache.js';
import { createGhBoardLister } from '../../board/boards.js';
import { createGhSpecIssueReader } from '../../board/issue.js';
import { createGhBoardListing, keepListing } from '../../board/roadmap-board.js';
import { hasEpicLines, readRoadmapEpicRows } from '../../board/roadmap-epic-rows.js';
import { createPlanDirNames } from '../../board/roadmap-rows.js';
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
  keepsBoard,
  lineRefusal,
  onTracker,
  readChoiceFlag,
  readNonBlankFlag,
  readTextFlag,
  resolveIssueTracker,
} from './issue-tracker.js';
import { EPIC_CHECK_EXIT, epicCheckFailure } from './roadmap-check.js';
import { renderEpicTable } from './roadmap-epic-table.js';
import { renderRoadmapTable } from './roadmap-table.js';

/** The usage line a refusal names. */
const USAGE = 'rafa issue list [--roadmap [--all] [--full] [--check] [--labels] [--texts] [--refresh]] [--state=<state>]'
  + ' [--type=<type>] [--module=<name>]'
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

/** The epics a roadmap listing carries: what the epic table is printed from, less the spec rows. */
export interface RoadmapEpicsResult {
  /** The shown horizon groups: `now` only, every one under `--all`. */
  readonly groups: readonly EpicHorizonGroup[];
  /** How many epic rows a horizon not shown left out. */
  readonly hidden: number;
  /** Why the board listing failed, so no epic could be read; null when it was read. */
  readonly unknown: string | null;
  /** Every label problem on the board, each also written as a warning. */
  readonly problems: readonly EpicProblem[];
}

/** What json mode gives as the terminal result's `data` under `--roadmap`. */
export interface RoadmapListResult {
  /** The Roadmap issue the lines were read from. */
  readonly roadmap: number;
  /** True under `--all`: the ticked lines were kept too, and the epics of every horizon shown. */
  readonly all: boolean;
  /** The narrowing applied after the Roadmap's selection, each flag left out absent from it. */
  readonly filter: RoadmapFilter;
  /** Each spec row left, in the Roadmap's order, every column as the row reading holds it. */
  readonly rows: readonly RoadmapRow[];
  /** The epics, present only when the epic table is printed; see the module note. */
  readonly epics?: RoadmapEpicsResult;
  /** A sentence per reading that failed, each also written as a warning. */
  readonly warnings: readonly string[];
}

/** What {@link listRoadmap} answers: the result json mode writes, and every epic on the listing for `--check`. */
export interface RoadmapListing {
  readonly result: RoadmapListResult;
  /** Every `type:epic` issue on the listing, read, or why the listing failed. */
  readonly epics: Epics;
  /** Each issue's state on the listing, for the blockers `--full` prints under a member; empty when it failed. */
  readonly states: ReadonlyMap<number, BoardIssueState>;
}

/**
 * Which listing a line asks for: the tracker's, or the Roadmap's with or
 * without its ticked lines and epic members, checked or not.
 */
export interface IssueListLine {
  readonly roadmap: boolean;
  readonly all: boolean;
  readonly full: boolean;
  readonly check: boolean;
  /** `--labels`: each issue's labels on a row of their own under it. */
  readonly labels: boolean;
  /** `--texts` (`-t`): the spec and blocked by columns in words. */
  readonly texts: boolean;
  /** `--refresh`: read the whole board rather than what changed since the kept listing. */
  readonly refresh: boolean;
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
 * beside `--roadmap`, and `--all`, `--full` or `--check` without it. See
 * the module note.
 */
export function readIssueListLine(flags: LineFlags): IssueListLine {
  const roadmap = readSwitch('roadmap', flags['roadmap'], SWITCH_HINT);
  const all = readSwitch('all', flags['all'], SWITCH_HINT);
  const full = readSwitch('full', flags['full'], SWITCH_HINT);
  const check = readSwitch('check', flags['check'], SWITCH_HINT);
  const labels = readSwitch('labels', flags['labels'], SWITCH_HINT);
  const texts = readSwitch('texts', flags['texts'], SWITCH_HINT);
  const refresh = readSwitch('refresh', flags['refresh'], SWITCH_HINT);
  if (roadmap && flags['state'] !== undefined) {
    throw lineRefusal(
      '--state cannot narrow --roadmap: the Roadmap is read off the GitHub board, which holds an issue open or'
      + ' closed and so no state of the tracker',
      USAGE,
    );
  }
  if (all && !roadmap) throw lineRefusal('--all keeps the ticked Roadmap lines, so it needs --roadmap', USAGE);
  if (full && !roadmap) throw lineRefusal('--full prints the issues of each Roadmap epic, so it needs --roadmap', USAGE);
  if (check && !roadmap) throw lineRefusal('--check weighs the epics the board read finds, so it needs --roadmap', USAGE);
  if (labels && !roadmap) throw lineRefusal('--labels prints a row under each Roadmap line, so it needs --roadmap', USAGE);
  if (texts && !roadmap) throw lineRefusal('--texts spells the Roadmap table\'s columns in words, so it needs --roadmap', USAGE);
  if (refresh && !roadmap) throw lineRefusal('--refresh reads the whole board the Roadmap is listed from, so it needs --roadmap', USAGE);
  return { roadmap, all, full, check, labels, texts, refresh };
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

/**
 * The lines text mode writes for a roadmap listing, the table fitted to
 * `width`, each epic's members under it when `full` is set; see the
 * module note.
 */
export function renderRoadmapList(
  listed: Pick<RoadmapListResult, 'roadmap' | 'rows' | 'epics'>,
  width?: number,
  full = false,
  style?: TableStyle,
  states?: ReadonlyMap<number, BoardIssueState>,
): string[] {
  if (listed.epics !== undefined) {
    return renderEpicTable({ ...listed.epics, roadmap: listed.roadmap, specs: listed.rows, states }, width, full, style);
  }
  const head = `Roadmap: #${String(listed.roadmap)}`;
  if (listed.rows.length === 0) return [head, 'No issues.'];
  return [head, ...renderRoadmapTable(listed.rows, width, style)];
}

/**
 * The board listing a roadmap reading reads through, asked once for the
 * command: kept under `.rafa/cache/` and read incrementally when `seams`
 * keeps the board (`keepsBoard`), else one full `gh issue list`. See the
 * module note's "One board read".
 */
export function roadmapBoard(seams: IssueSeams, gh: GhRunner, root: string, refresh: boolean): BoardListing {
  return keepListing(keepsBoard(seams)
    ? createCachedBoardListing({ gh, root, refresh })
    : createGhBoardListing({ gh }));
}

/** What a roadmap listing is read with beyond its filter: `--all`, `--refresh`, and whether the refs column is printed. */
export interface RoadmapReadOptions {
  readonly all: boolean;
  readonly refresh?: boolean;
  /** When the refs column is read; `always` for json mode, `plain` for text. See `RoadmapRowsOptions.refsWhen`. */
  readonly refsWhen?: 'always' | 'plain';
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
  how: RoadmapReadOptions,
  filter: RoadmapFilter,
): Promise<RoadmapListing> {
  const { all } = how;
  const project = issueProject(context);
  const warn = (message: string): void => {
    context.output.warn(message);
  };
  const config = issueSubjectConfig(project, warn);
  const gh = seams.gh ?? createGhRunner({ cwd: project.root });
  const plans = plansDirAt(project.root, config.planDir);
  const planNames = (seams.planNames ?? createPlanDirNames)(plans.path);
  const board = roadmapBoard(seams, gh, project.root, how.refresh === true);
  const refs: RoadmapRefs = async (issues) => roadmapRefsCells(await readDoctorRefs(
    { root: project.root, specsDir: config.specsDir, gh, env: context.env, issues, listing: board },
    { refsVerifier: seams.refsVerifier },
  ));

  let read;
  try {
    read = await readRoadmapEpicRows({
      configured: config.roadmapIssue,
      listBoards: createGhBoardLister({ gh }),
      search: createGhRoadmapSearch({ gh }),
      issues: createGhSpecIssueReader({ gh }),
      board,
      git: seams.git ?? createGitRunner(project.root),
      pullRequests: createGhOpenPullRequests({ gh }),
      planNames,
      refs,
      refsWhen: how.refsWhen,
      all,
      root: project.root,
    });
  } catch (error) {
    const code = error instanceof CommandExit
      ? error.exitCode
      : ROADMAP_REFUSAL_EXIT;
    throw new CommandExit(code, `❌ Could not read the roadmap: ${messageOf(error)}`);
  }

  for (const warning of read.warnings) warn(warning);
  const listed: RoadmapListResult = {
    roadmap: read.roadmap,
    all,
    filter,
    rows: narrowRoadmapRows(read.specs, filter),
    warnings: read.warnings,
  };
  if (!hasEpicLines(read) && read.unknown === null) {
    return Object.freeze({ result: Object.freeze(listed), epics: read.epics, states: read.states });
  }
  const { groups, hidden, unknown, problems } = read;
  const result = Object.freeze({ ...listed, epics: Object.freeze({ groups, hidden, unknown, problems }) });
  return Object.freeze({ result, epics: read.epics, states: read.states });
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
  const { result, epics, states } = await listRoadmap(context, seams, {
    all: line.all,
    refresh: line.refresh,
    refsWhen: context.outputMode === 'json' || line.full
      ? 'always'
      : 'plain',
  }, filter);
  const failure = line.check
    ? epicCheckFailure(epics)
    : null;
  if (context.outputMode === 'json') {
    // A non-zero ending drops the payload, so the failure is its message alone; see the module note.
    if (failure !== null) throw new CommandExit(EPIC_CHECK_EXIT, failure);
    context.output.result(result);
    return;
  }
  const width = (seams.terminalWidth ?? ((): number | undefined => process.stdout.columns))();
  const style: TableStyle = { labels: line.labels, texts: line.texts };
  for (const text of renderRoadmapList(result, width, line.full, style, states)) context.output.info(text);
  if (failure !== null) throw new CommandExit(EPIC_CHECK_EXIT, failure);
}

/** The flags `issue list` declares, `--roadmap`, `--all`, `--full` and `--check` first. */
export const ISSUE_LIST_FLAGS: readonly RafaFlagSpec[] = Object.freeze([
  {
    name: 'roadmap',
    description: 'List the unticked lines of the Roadmap issue instead, in its order, with the spec, blocked by,'
      + ' has and refs columns, and the epics it names grouped by horizon. Reads the GitHub board whatever'
      + ' tracker the chain lands on.',
    type: 'boolean',
  },
  {
    name: 'all',
    description: 'With --roadmap, keep the ticked lines too, each in its place, and show the epics of every'
      + ' horizon, not only now. Refused without --roadmap.',
    type: 'boolean',
  },
  {
    name: 'full',
    description: 'With --roadmap, print each epic\'s issues under its row, on two rows each: number, state and'
      + ' title, then labels and blockers. Refused without --roadmap.',
    type: 'boolean',
  },
  {
    name: 'check',
    description: 'With --roadmap, exit 1 when any type:epic issue on the board is open with its work done, or'
      + ' closed with it not done, or when the board could not be read, naming each. Refused without --roadmap.',
    type: 'boolean',
  },
  {
    name: 'labels',
    description: 'With --roadmap, print each issue\'s labels on a row of their own under it, and under each --full'
      + ' member; they are no column. Refused without --roadmap.',
    type: 'boolean',
  },
  {
    name: 'texts',
    description: 'With --roadmap, spell the spec and blocked by columns in words instead of symbols, with no legend.'
      + ' Refused without --roadmap.',
    type: 'boolean',
    aliases: ['t'],
  },
  {
    name: 'refresh',
    description: 'With --roadmap, read the whole board again instead of only what changed since the listing kept'
      + ' under .rafa/cache/. Refused without --roadmap.',
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
      + ' the unticked lines of the Roadmap issue (`roadmap.issue`, else the lowest-numbered open type:roadmap'
      + ' board, else the open issue titled Roadmap) in its'
      + ' order instead, read off the GitHub board, as a table adding four columns: spec, whether the issue'
      + ' can be planned (every section of the spec template filled, and the spec:ready label on it), as a'
      + ' symbol; blocked by, the blockers grouped by whether they are still open;'
      + ' has, a plan, a branch or a pull request already made for it; and refs, how many references of the'
      + ' issue\'s saved copy under `specs.dir` read suspect or dangling, `-` with no copy. A legend names each'
      + ' symbol, `--texts` (`-t`) spells them in words, and `--labels` prints the labels on a row under each'
      + ' issue. A Roadmap naming epics prints them alone, grouped by horizon under a `Roadmap #<n> · <horizon>`'
      + ' heading with the columns #, state, done/total, blocked, date and title, the now horizon only unless'
      + ' `--all`, with one line counting the lines naming no epic; `--full` prints each epic\'s issues under'
      + ' its row, and the lines naming no epic as the table. The board listing is kept under .rafa/cache/ and'
      + ' read for what changed since; `--refresh` reads the whole board again. `--check` exits 1 when any'
      + ' type:epic issue\'s stored state'
      + ' disagrees with its computed one. `--type`, `--module`, `--search` and `--limit` then narrow the spec rows, keeping their'
      + ' order, and an unreachable board is warned about with the rows still printed. With `--output=json`'
      + ' the tracker, the query and every issue, or under `--roadmap` the roadmap, the rows, the epics and the'
      + ' warnings, are the data of the terminal result event.',
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
        cmd: 'rafa issue list --roadmap --full',
        note: 'Prints the Roadmap\'s now epics with each epic\'s issues underneath, then its spec lines.',
      },
      {
        cmd: 'rafa issue list --roadmap --check',
        note: 'Prints the Roadmap, then exits 1 when an epic is open with its work done or closed with it not done.',
      },
      {
        cmd: 'rafa issue list --roadmap --all --type=bug',
        note: 'Prints the bugs on the Roadmap, ticked lines included, in the Roadmap\'s order, beside its epics of every horizon.',
      },
    ],
    outputs: ['text', 'json'],
    run: (context) => runIssueList(context, seams),
  };
  return Object.freeze(command);
}

export default createIssueListCommand();
