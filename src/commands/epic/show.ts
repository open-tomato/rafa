/**
 * `rafa epic show [n]`: one epic's issues as the table `rafa roadmap`
 * prints for its spec lines — the epic numbered, or the first `now` epic
 * on the Roadmap that is not done (`.rafa/specs/rafa-244-epics-group-issues-features.md`).
 *
 * ## Its spellings
 *
 * It was the top-level `rafa epics` until the `epic` subject was
 * declared (`.rafa/specs/rafa-246-epic-lifecycle.md`), and the registry
 * refuses a top-level command spelled as a subject's plural. It keeps
 * that spelling through its lasting alias `epic`, which a line types by
 * the subject's name or its plural (`src/cli/route.ts`): `rafa epics`,
 * `rafa epics <n>`, `rafa epic` and `rafa epic <n>` all run it, with no
 * deprecation line, and print what `rafa epics` printed before the move
 * (`src/tests/epic-show-cli.test.ts`). So its refusals still name
 * `rafa epics [<n>]`, the spelling people type. A word after the subject
 * that is one of its actions runs that action instead, so `rafa epic
 * show` is the spelling to type when the number could be read as one.
 *
 * ## Which epic
 *
 * With `n`, the `type:epic` issue numbered `n` on the board listing,
 * whatever its horizon and whether or not the Roadmap names it. A number
 * the listing holds that is not an epic, and one the listing does not
 * hold, are refused with exit code 1.
 *
 * Without it, the epic is the CURRENT PLACE's, read as `rafa roadmap`
 * reads its board (`readCurrentPlace`, `src/board/roadmap-rows.ts`):
 * with a position file, `resolvePlace` (`src/board/place.ts`) over the
 * one board listing, a place that no longer stands falling back by its
 * rule, and each notice it gives but the absent-file one a `warn` line.
 * A current place naming an epic shows that epic, whatever its horizon
 * and computed state, and reads no board body. A place naming a board
 * alone, and a project with no position file, read the board — the
 * place's, else the default board (`resolveDefaultBoard`,
 * `src/board/boards.ts`: `roadmap.issue`, else the lowest-numbered open
 * `type:roadmap` board, else the open issue titled Roadmap) — and its
 * unticked
 * lines are asked in order for the first naming an epic that is OPEN,
 * carries exactly one `horizon:` label and that label `horizon:now`
 * (`isNowEpic`, the walk's own test, `src/board/epic-walk.ts`), and whose
 * computed state is not `done`: the epic `rafa next` walks into. Each
 * line is told an epic by the listing's type for its issue, never by
 * reading the issue, so a Roadmap of any length costs no more than one
 * Roadmap read and one listing. When no line qualifies, one line says
 * so and the command exits 0. A Roadmap that cannot be found or read is
 * refused with `ROADMAP_REFUSAL_EXIT`, as `rafa roadmap` refuses it.
 *
 * ## The rows
 *
 * The epic's lines are `epicLines` (`src/board/epic-walk.ts`): its body's
 * checklist, then its open members missing from it by ascending number —
 * the order the walk reads, spelled once. They are read into rows by
 * `readLineRows` (`src/board/roadmap-rows.ts`), the reading behind
 * `rafa roadmap`'s spec rows, so every column (`spec`, `blocked by`,
 * `has`, `refs`) means here what it means there, the unticked lines
 * only, and printed by `renderRoadmapTable`. Only the chosen epic's lines
 * are rows: no issue of a second epic is named, which the spec asks of
 * every command but `rafa roadmap --full`.
 *
 * ## One board read
 *
 * The seams are `onceSeams` (`src/board/roadmap-epic-rows.ts`): the
 * listing, the open pull requests, the plan dir and the branch scan are
 * each asked once, and the claims `readEpics` weighs for the state
 * (`claimsOf`) and the rows' `has` column read the same answers.
 *
 * ## What it writes
 *
 * In text mode, the head {@link epicHead} — `Epic #<n> · <title> ·
 * <state>, <done>/<total> done` — then the epic's disagreement line when
 * its stored state and computed one differ, indented, and then the
 * table, or `No issues.` when no line is left. Each failed reading of the
 * rows and each label problem about this epic (`readEpicProblems`,
 * `src/board/epic-problems.ts`: its horizon, its checklist, its members
 * and a member carrying a second `epic:` label; an orphan label belongs
 * to no epic and is `rafa roadmap`'s to report) is a `warn` line, a
 * `warn` log event in json mode. In json mode the terminal result's
 * `data` is an {@link EpicsResult}.
 *
 * Whenever the listing was read, whichever epic is shown or none, each
 * line of the cancelled-epic notice (`cancelledEpicNoticeLines`,
 * `src/board/epic-cancel-notice.ts`) is a `warn` line too, written last:
 * one per epic closed as not planned that open issues outside it still
 * wait on, naming them and `rafa epic cancel <n>`. A board with no such
 * epic writes none.
 *
 * A failed listing is not guessed at: the command prints the epic, or
 * the Roadmap's epics, `unknown` with the listing's reason, no rows, and
 * exits 0, as `rafa roadmap` exits 0 on the same failure.
 *
 * It starts no session, so it declares no `spends`.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { EpicProblem } from '../../board/epic-problems.js';
import type { Epic, Epics } from '../../board/epics.js';
import type { BoardIssue } from '../../board/roadmap-board.js';
import type { LineRowsOptions, RoadmapRefs, RoadmapRow } from '../../board/roadmap-rows.js';
import type { RoadmapLine } from '../../board/roadmap.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { RafaConfig } from '../../config.js';
import type { IssueSeams } from '../issue/issue-tracker.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { createGhBoardLister, resolveDefaultBoard } from '../../board/boards.js';
import { cancelledEpicNoticeLines } from '../../board/epic-cancel-notice.js';
import { epicProblemMessage, readEpicProblems } from '../../board/epic-problems.js';
import { epicLines, isNowEpic } from '../../board/epic-walk.js';
import { readEpics } from '../../board/epics.js';
import { createGhSpecIssueReader } from '../../board/issue.js';
import { createGhBoardListing } from '../../board/roadmap-board.js';
import { claimsOf, onceSeams } from '../../board/roadmap-epic-rows.js';
import { createPlanDirNames, readCurrentPlace, readLineRows } from '../../board/roadmap-rows.js';
import {
  createGhOpenPullRequests,
  createGhRoadmapSearch,
  parseRoadmapBody,
  ROADMAP_REFUSAL_EXIT,
} from '../../board/roadmap.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { createGitRunner } from '../../pr/git.js';
import { readDoctorRefs, roadmapRefsCells } from '../doctor-refs.js';
import { DEFAULT_ISSUE_SEAMS, issueProject, issueSubjectConfig, lineRefusal } from '../issue/issue-tracker.js';
import { unknownLine } from '../issue/roadmap-epic-table.js';
import { renderRoadmapTable } from '../issue/roadmap-table.js';
import { plansDirAt } from '../plan/plan-files.js';

/** The usage line a refusal names. */
const USAGE = 'rafa epics [<n>]';

/** An issue number as written: a whole number from 1, no leading zero. */
const ISSUE_NUMBER = /^[1-9]\d*$/u;

/** What json mode gives as the terminal result's `data`. */
export interface EpicsResult {
  /** The board the epic was chosen on, the current place's, or null when the line numbered one. */
  readonly roadmap: number | null;
  /** The epic the line numbered, or null when it numbered none. */
  readonly asked: number | null;
  /** The epic shown, as `readEpics` computed it; null when none was chosen or the listing failed. */
  readonly epic: Epic | null;
  /** Why the listing failed, so no epic could be read; null when it was read. */
  readonly unknown: string | null;
  /** The epic's lines as rows, the unticked ones, in its order. */
  readonly rows: readonly RoadmapRow[];
  /** Every label problem about the epic shown, each also written as a warning. */
  readonly problems: readonly EpicProblem[];
  /** A sentence per reading that failed, then one per problem, each also written as a warning. */
  readonly warnings: readonly string[];
}

/**
 * The epic a line numbers, or null when it numbers none; a refusal with
 * exit code 1 for a second word and a word that is no whole number from
 * 1. Read before anything is opened.
 */
export function readEpicArgument(args: readonly string[]): number | null {
  if (args.length > 1) {
    throw lineRefusal(`Expected at most one epic number, got ${String(args.length)}: ${args.join(' ')}`, USAGE);
  }
  const word = args[0];
  if (word === undefined) return null;
  if (!ISSUE_NUMBER.test(word)) {
    throw lineRefusal(`"${word}" is no epic number, which is a whole number from 1`, USAGE);
  }
  return Number(word);
}

/** True when `problem` is about `epic`: its horizon, its order, or a member carrying its label beside another. */
export function isProblemOf(problem: EpicProblem, epic: Epic): boolean {
  switch (problem.kind) {
    case 'horizon':
      return problem.issue === epic.number;
    case 'unlabelled-checklist':
    case 'unlisted-member':
      return problem.epic === epic.number;
    case 'several-epic-labels':
      return epic.slug !== null && problem.slugs.includes(epic.slug);
    case 'orphan-label':
      return false;
  }
}

/**
 * The first of `lines` naming an epic that is open, `now` and not done,
 * read off `listing` and `epics`; null when none does. Ticked lines are
 * passed, as the walk passes them.
 */
export function firstNowEpic(lines: readonly RoadmapLine[], listing: readonly BoardIssue[], epics: Epics): Epic | null {
  const issues = new Map(listing.map((issue) => [issue.number, issue]));
  const read = new Map(epics.epics.map((epic) => [epic.number, epic]));
  for (const line of lines) {
    const issue = issues.get(line.issue);
    const epic = read.get(line.issue);
    if (line.ticked || issue?.type !== 'epic' || epic === undefined) continue;
    if (issue.state === 'OPEN' && isNowEpic(issue.labels) && epic.state !== 'done') return epic;
  }
  return null;
}

/** The line heading the table: the epic, its title, its computed state and its progress. */
export function epicHead(epic: Epic): string {
  const { done, total } = epic.progress;
  return `Epic #${String(epic.number)} · ${epic.title} · ${epic.state}, ${String(done)}/${String(total)} done`;
}

/** The line printed when the Roadmap names no epic to show. */
export function noNowEpicLine(roadmap: number): string {
  return `Roadmap #${String(roadmap)} names no epic that is open, now and not done;`
    + ' rafa epics <n> shows one by number, and rafa roadmap --all lists them all';
}

/** The line printed for epic `number` when the listing failed. */
export function epicUnknownLine(number: number, reason: string): string {
  return `Epic #${String(number)} · unknown: ${reason}`;
}

/** The lines text mode writes for `result`, the table fitted to `width`; see the module note. */
export function renderEpics(result: EpicsResult, width?: number): string[] {
  if (result.unknown !== null) {
    return [result.asked === null
      ? unknownLine(result.roadmap ?? 0, result.unknown)
      : epicUnknownLine(result.asked, result.unknown)];
  }
  if (result.epic === null) return [noNowEpicLine(result.roadmap ?? 0)];
  const disagreement = result.epic.disagreement === null
    ? []
    : [`  ${result.epic.disagreement}`];
  const table = result.rows.length === 0
    ? ['No issues.']
    : renderRoadmapTable(result.rows, width);
  return [epicHead(result.epic), ...disagreement, ...table];
}

/** The board an epic is chosen on with no number; see the module note. */
interface ChosenBoard {
  /** The current place's board. */
  readonly number: number;
  /** The board's lines; empty, and not read, when the place names an epic. */
  readonly lines: readonly RoadmapLine[];
  /** The current place's epic, or null to take the board's first now epic not done. */
  readonly epic: number | null;
  /** The current place's notices, each written as a warning. */
  readonly notices: readonly string[];
}

/**
 * The current place's board and epic; a refusal with
 * `ROADMAP_REFUSAL_EXIT` when the default board cannot be found or the
 * board read cannot be.
 */
async function readRoadmap(config: RafaConfig, gh: GhRunner, root: string, read: LineRowsOptions): Promise<ChosenBoard> {
  try {
    const { number: fallback } = await resolveDefaultBoard({
      configured: config.roadmapIssue,
      listBoards: createGhBoardLister({ gh }),
      search: createGhRoadmapSearch({ gh }),
    });
    const { place, notices } = await readCurrentPlace(root, read.board, fallback);
    const number = place?.board ?? fallback;
    const epic = place?.epic ?? null;
    if (epic !== null) return { number, lines: [], epic, notices };
    const issue = await createGhSpecIssueReader({ gh })(number);
    return { number, lines: parseRoadmapBody(issue.body), epic, notices };
  } catch (error) {
    const code = error instanceof CommandExit
      ? error.exitCode
      : ROADMAP_REFUSAL_EXIT;
    throw new CommandExit(code, `❌ Could not read the roadmap: ${messageOf(error)}\nName the epic instead: ${USAGE}`);
  }
}

/** Epic `number` off `epics`; a refusal with exit code 1 when the listing holds no such epic. */
function askedEpic(number: number, listing: readonly BoardIssue[], epics: Epics): Epic {
  const epic = epics.epics.find((read) => read.number === number);
  if (epic !== undefined) return epic;
  const id = `#${String(number)}`;
  const listed = listing.some((issue) => issue.number === number);
  throw new CommandExit(1, listed
    ? `❌ ${id} is not an epic: it does not carry type:epic`
    : `❌ ${id} is not on the board listing, so it cannot be read as an epic`);
}

/** The current place's epic off `epics`, else `board`'s first now epic not done; null when there is none. */
function placeEpic(board: ChosenBoard | null, listing: readonly BoardIssue[], epics: Epics): Epic | null {
  if (board === null) return null;
  const { epic: chosen } = board;
  if (chosen === null) return firstNowEpic(board.lines, listing, epics);
  return epics.epics.find((epic) => epic.number === chosen) ?? null;
}

/** The seams the rows and the claims read through, each asked once; see the module note. */
function rowSeams(context: RafaContext, seams: IssueSeams, config: RafaConfig, gh: GhRunner): LineRowsOptions {
  const { root } = issueProject(context);
  const refs: RoadmapRefs = async (issues) => roadmapRefsCells(await readDoctorRefs(
    { root, specsDir: config.specsDir, gh, env: context.env, issues },
    { refsVerifier: seams.refsVerifier },
  ));
  return onceSeams({
    board: createGhBoardListing({ gh }),
    git: seams.git ?? createGitRunner(root),
    pullRequests: createGhOpenPullRequests({ gh }),
    planNames: (seams.planNames ?? createPlanDirNames)(plansDirAt(root, config.planDir).path),
    refs,
  });
}

/**
 * The epic a line asks for and its rows, each failed reading and each of
 * its label problems written as a warning; a refusal for a line, a
 * config, a Roadmap or an epic number that cannot be used. See the
 * module note.
 */
export async function readEpicsView(context: RafaContext, seams: IssueSeams): Promise<EpicsResult> {
  const asked = readEpicArgument(context.args);
  const project = issueProject(context);
  const warn = (message: string): void => {
    context.output.warn(message);
  };
  const config = issueSubjectConfig(project, warn);
  const gh = seams.gh ?? createGhRunner({ cwd: project.root });
  const read = rowSeams(context, seams, config, gh);
  const roadmap = asked === null
    ? await readRoadmap(config, gh, project.root, read)
    : null;
  const notices = roadmap?.notices ?? [];
  for (const notice of notices) warn(notice);
  const empty = { roadmap: roadmap?.number ?? null, asked, rows: [], problems: [], warnings: Object.freeze([...notices]) };

  let listing: readonly BoardIssue[];
  try {
    listing = await read.board();
  } catch (error) {
    return Object.freeze({ ...empty, epic: null, unknown: messageOf(error) });
  }
  const epics = readEpics({ issues: listing, claims: await claimsOf(listing, read), today: new Date() });
  const epic = asked === null
    ? placeEpic(roadmap, listing, epics)
    : askedEpic(asked, listing, epics);
  const cancelled = cancelledEpicNoticeLines(listing);
  const row = listing.find((issue) => issue.number === epic?.number);
  if (epic === null || row === undefined) {
    for (const line of cancelled) warn(line);
    return Object.freeze({ ...empty, epic: null, unknown: null, warnings: Object.freeze([...notices, ...cancelled]) });
  }

  const rows = await readLineRows(epicLines(epic, row).lines, read);
  const problems = readEpicProblems(listing).filter((problem) => isProblemOf(problem, epic));
  const warnings = [...rows.warnings, ...problems.map(epicProblemMessage), ...cancelled];
  for (const warning of warnings) warn(warning);
  return Object.freeze({
    ...empty,
    epic,
    unknown: null,
    rows: rows.rows,
    problems: Object.freeze([...problems]),
    warnings: Object.freeze([...notices, ...warnings]),
  });
}

/** Runs one `epic show` line with `seams`, writing it in the line's output mode. */
export async function runEpics(context: RafaContext, seams: IssueSeams): Promise<void> {
  const result = await readEpicsView(context, seams);
  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  const width = (seams.terminalWidth ?? ((): number | undefined => process.stdout.columns))();
  for (const text of renderEpics(result, width)) context.output.info(text);
}

/** The command, reading the board with `seams`; see the module note. */
export function createEpicShowCommand(seams: IssueSeams = DEFAULT_ISSUE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'epic show',
    subject: 'epic',
    action: 'show',
    summary: 'list one epic\'s issues as the Roadmap table: the epic numbered, or the first now epic not done',
    description: 'Prints one epic\'s issues as `rafa roadmap` prints its spec lines, with the spec, blocked by,'
      + ' has and refs columns: the unticked lines of the epic\'s checklist in its order, then its open members'
      + ' missing from the checklist by number. The epic is the type:epic issue numbered, or, with no number,'
      + ' the current place\'s epic, the one `rafa switch` moved to; a place naming a board alone, or no'
      + ' position file, takes the first epic that board (with no position file `roadmap.issue`, else the'
      + ' lowest-numbered open type:roadmap board, else the open issue titled Roadmap) names that is open,'
      + ' horizon:now and not done, the one `rafa next` walks into. The table is headed by the epic\'s title,'
      + ' computed state and done/total, and a stored state disagreeing with the computed one is printed'
      + ' under it. No issue of another epic is named. Each label problem about the epic and each reading that'
      + ' failed is warned about; an unreachable board prints the epic unknown with the reason. With'
      + ' `--output=json` the epic, its rows, its problems and the warnings are the data of the terminal result'
      + ' event. `rafa epics` and `rafa epic` are the same command, typed by the subject alone.',
    args: [
      {
        name: 'n',
        description: 'The epic\'s issue number on the GitHub board. Left out, the current place\'s epic, else the first now epic on its board that is not done.',
        type: 'string',
        required: false,
      },
    ],
    flags: [],
    examples: [
      {
        cmd: 'rafa epic show',
        note: 'Prints the issues of the epic `rafa next` is walking: the first now epic on the Roadmap not done.'
          + ' `rafa epics` prints the same.',
      },
      {
        cmd: 'rafa epic show 252',
        note: 'Prints the issues of epic #252, whatever its horizon, in its checklist\'s order, as `rafa epics 252` does.',
      },
      {
        cmd: 'rafa epic show 252 --output=json',
        note: 'Writes a result event whose data holds epic #252 as computed, its rows and its label problems.',
      },
    ],
    outputs: ['text', 'json'],
    aliases: ['epic'],
    lastingAliases: ['epic'],
    run: (context) => runEpics(context, seams),
  };
  return Object.freeze(command);
}

export default createEpicShowCommand();
