/**
 * `rafa epic new "<title>" --slug <slug> [--horizon now|next|later]`: one
 * new epic, created whole — its `epic:<slug>` label, the epic issue from
 * the shipped template, and its line on the current board
 * (`.rafa/specs/rafa-246-epic-lifecycle.md`).
 *
 * ## The line
 *
 * One argument, the title: one line holding some text, so a title typed
 * unquoted, spread over several words, is refused rather than guessed
 * at. `--slug` is required. `--horizon` is one of `now`, `next` and
 * `later`, {@link DEFAULT_HORIZON} (`later`) when left out, so a new epic
 * never enters the loop's pick unasked. Each of these is refused with
 * exit code 1, before anything is read, but for the slug's own refusals
 * below.
 *
 * ## The slug
 *
 * A KEBAB WORD ({@link KEBAB_SLUG}): lowercase letters and digits, in
 * runs joined by single hyphens, as `sign-in` or `v2-billing`. Any other
 * slug is refused with {@link EPIC_NEW_REFUSAL_EXIT} (2) before `gh` is
 * asked anything, since `epic:<slug>` is the label every member will
 * carry and `rafa next`'s epic reading matches it by name.
 *
 * A slug ALREADY LABELLED is refused with the same exit code: one any
 * issue on the board listing carries as `epic:<slug>`, open or closed,
 * epic or member, compared without case as GitHub compares label names.
 * An epic's membership is its label (`src/board/epics.ts`), so a second
 * epic on a slug in use would take over the first one's members, or a
 * closed epic's history. The refusal names the issues carrying it.
 *
 * A repository LABEL `epic:<slug>` that no issue carries is not a slug in
 * use: it is kept and not created again, which is what a rerun after a
 * failed issue create finds. The repository's labels are read with one
 * `gh label list` (`listBoardLabels`, `src/board/setup.ts`), which reads
 * the first {@link LABEL_LIST_LIMIT}; a label past that is not seen, and
 * the create then fails on it, refused with exit code 1 and nothing
 * else created.
 *
 * ## One board listing
 *
 * The listing is read once (`createGhBoardListing`, through
 * `BOARD_LIST_FIELDS` and `parseBoardListing`), and serves the slug check
 * and the current place: `resolvePlace` (`src/board/place.ts`) over it,
 * with the default board ranked over its open `type:roadmap` rows by
 * `defaultBoardOnce` (`../switch.ts`), asked at most once. The epic's
 * line goes on the CURRENT board, the board `rafa switch` last moved to,
 * or the default board with no position file; each notice the place
 * raises but the absent-file one is a warning. A listing, a label list or
 * a default board that cannot be read is refused with
 * {@link EPIC_NEW_REFUSAL_EXIT}, and nothing is created.
 *
 * ## The writes, in order
 *
 * Every refusal above comes before the first write, and the writes go in
 * the order that leaves the least behind when one fails:
 *
 * 1. The label, `gh label create epic:<slug>` through `IssueBoard`
 *    (`src/board/issue-board.ts`), when the repository does not hold it.
 * 2. The issue, `gh issue create` through the same board, its body
 *    `renderEpicBody` (`src/board/epic-template.ts`) and its labels
 *    `type:epic`, `epic:<slug>` and `horizon:<horizon>` in the same
 *    command, so it never stands unlabelled.
 * 3. Its line, `- [ ] #<n> <title>`, appended to the board's checklist
 *    with `appendLine` and carried by `editChecklist`
 *    (`src/board/epic-checklist.ts`): read, write, re-read, retried up to
 *    `TICK_ATTEMPTS`, every other byte of the board kept.
 *
 * A failed label or issue create is refused with exit code 1, the second
 * naming the label it left standing, which a rerun then keeps. A board
 * line that ends `failed` is refused with exit code 1 too, after the
 * epic exists: the message names the epic, its URL and the line to add
 * by hand. A board already naming the new issue ends `nothing-to-edit`,
 * which is not a failure.
 *
 * The trail module (`src/board/epic-trail.ts`) holds no comment for a new
 * epic, and none is posted: the issue's creation is its own record, and
 * the board's line names it.
 *
 * ## Native mode
 *
 * Everything above is the `labels` mode, the default, where an epic's
 * membership is its `epic:<slug>` label. Under
 * `board.relationships: native` an epic's members are its sub-issues
 * (`src/board/relations/port.ts`), so an epic is named by its number and
 * title and has no slug (`.rafa/specs/rafa-340-relationships-epics-blockers-github.md`,
 * "Updated to make native relationships a mode"). A native run reads
 * the same title and horizon, refused the same way, but:
 *
 *  - `--slug` is not required and not read. When the line gives one it
 *    is not checked, and {@link NATIVE_SLUG_WARNING}, opening with the
 *    mode as every native-mode no-op line does, is written as a warning.
 *  - Nothing is asked about labels: no slug-in-use check over the
 *    listing, no `gh label list` and no `gh label create`.
 *  - The issue is created with `type:epic` and `horizon:<horizon>` only
 *    ({@link nativeEpicIssueLabels}), and a failed create names no label
 *    left standing, since none was created.
 *
 * The listing read, the current place and the board's line are the
 * same in both modes: a board lists its epics by checklist in either.
 *
 * The mode is read by {@link epicNewMode} before the line, off the
 * project's config with its warnings dropped; the run then loads the
 * config again with its warnings written, as it did before the mode
 * existed. A line with no project, or whose config `loadConfig` refuses,
 * reads as `labels`, so it meets the same refusals in the same order as
 * before; a `labels` run's output and `gh` calls are unchanged.
 *
 * ## What it writes
 *
 * In text mode, the created epic with its labels, where its line went,
 * and its URL; in native mode, the epic by number and title with the
 * mode named in place of its label. In json mode the terminal result's
 * `data` is an {@link EpicNewResult}: a {@link NativeEpicNewResult} in
 * native mode carries `relationships: 'native'` and leaves the slug and
 * label keys out rather than setting them to undefined.
 *
 * It starts no session, so it declares no `spends`, and it asks nothing,
 * so it reads no terminal.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { ChecklistEditResult } from '../../board/epic-checklist.js';
import type { CreatedIssue, IssueBoard } from '../../board/issue-board.js';
import type { BoardIssue } from '../../board/roadmap-board.js';
import type { Horizon } from '../../board/roadmap-epic-rows.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { RafaConfig } from '../../config-schema.js';
import type { BoardRelationshipMode } from '../../config-sections.js';
import type { LineFlags } from '../issue/issue-tracker.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { appendLine, editChecklist } from '../../board/epic-checklist.js';
import { EPIC_TYPE_LABEL } from '../../board/epic-context.js';
import { HORIZON_LABEL_PREFIX } from '../../board/epic-problems.js';
import { renderEpicBody } from '../../board/epic-template.js';
import { EPIC_LABEL_PREFIX } from '../../board/epics.js';
import { createGhIssueBoard } from '../../board/issue-board.js';
import { resolvePlace } from '../../board/place.js';
import { createGhBoardListing } from '../../board/roadmap-board.js';
import { HORIZONS } from '../../board/roadmap-epic-rows.js';
import { createGhRoadmapBody } from '../../board/roadmap-tick.js';
import { LABEL_LIST_LIMIT, listBoardLabels } from '../../board/setup.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { issueProject, issueSubjectConfig, lineRefusal, readChoiceFlag, readRequiredFlag } from '../issue/issue-tracker.js';
import { defaultBoardOnce } from '../switch.js';

import { NATIVE_MODE } from './move-native.js';

/** The usage line a refusal names. */
const USAGE = 'rafa epic new "<title>" --slug=<slug> [--horizon=now|next|later]';

/** The exit code of a slug refused and of a board that cannot be read; see the module note. */
export const EPIC_NEW_REFUSAL_EXIT = 2;

/** The horizon a new epic takes when the line names none. */
export const DEFAULT_HORIZON: Horizon = 'later';

/** A kebab word: lowercase letters and digits, in runs joined by single hyphens. */
export const KEBAB_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** A line break, which a title may not hold. */
const LINE_BREAK = /[\r\n]/u;

/** What a line asks for, read before anything is opened. */
export interface EpicDraft {
  readonly title: string;
  readonly slug: string;
  readonly horizon: Horizon;
}

/** What a line asks for in native mode, which names an epic by number and title and takes no slug. */
export interface NativeEpicDraft {
  readonly title: string;
  readonly horizon: Horizon;
}

/** The warning a native-mode line giving `--slug` gets; see the module note. */
export const NATIVE_SLUG_WARNING = `${NATIVE_MODE}: an epic is named by its number and title, so --slug is not used`
  + ' and no epic: label is created';

/** Whether the repository held the epic's label, or this run created it. */
export type LabelOutcome = 'created' | 'present';

/** What json mode gives as the terminal result's `data` in labels mode. */
export interface LabelsEpicNewResult {
  /** The epic issue created. */
  readonly epic: CreatedIssue & { readonly title: string };
  readonly slug: string;
  /** `epic:<slug>`. */
  readonly label: string;
  readonly labelOutcome: LabelOutcome;
  readonly horizon: Horizon;
  /** The board its line was added to, the current place's. */
  readonly board: number;
  /** How the board's edit ended; never `failed`, which is refused instead. */
  readonly line: ChecklistEditResult;
}

/** What json mode gives as the terminal result's `data` in native mode: no slug, no label. */
export interface NativeEpicNewResult {
  readonly epic: CreatedIssue & { readonly title: string };
  readonly relationships: 'native';
  readonly horizon: Horizon;
  readonly board: number;
  readonly line: ChecklistEditResult;
}

/** What json mode gives as the terminal result's `data`, in the mode the run read. */
export type EpicNewResult = LabelsEpicNewResult | NativeEpicNewResult;

/** How the command reaches `gh`; the system's own when left out. */
export interface EpicNewSeams {
  readonly gh?: GhRunner;
}

/** The refusal a slug and a board that cannot be read raise. */
function refusal(message: string): CommandExit {
  return new CommandExit(EPIC_NEW_REFUSAL_EXIT, `❌ ${message}`);
}

/** `epic:<slug>`, the label every member of the epic carries. */
export function epicLabel(slug: string): string {
  return `${EPIC_LABEL_PREFIX}${slug}`;
}

/** The description `epic:<slug>` is created with. */
export function epicLabelDescription(slug: string): string {
  return `A member of the ${slug} epic`;
}

/** The labels the epic issue is created with, in the order sent. */
export function epicIssueLabels(draft: Pick<EpicDraft, 'slug' | 'horizon'>): readonly string[] {
  return Object.freeze([EPIC_TYPE_LABEL, epicLabel(draft.slug), `${HORIZON_LABEL_PREFIX}${draft.horizon}`]);
}

/** The labels the epic issue is created with in native mode, in the order sent: no `epic:<slug>`. */
export function nativeEpicIssueLabels(horizon: Horizon): readonly string[] {
  return Object.freeze([EPIC_TYPE_LABEL, `${HORIZON_LABEL_PREFIX}${horizon}`]);
}

/**
 * The `board.relationships` mode of the project `context` runs in, the
 * config's warnings dropped; `labels` with no project or a config
 * `loadConfig` refuses, which the labels run then refuses as before. See
 * the module note.
 */
export function epicNewMode(context: RafaContext): BoardRelationshipMode {
  if (context.project === null) return 'labels';
  try {
    return issueSubjectConfig(context.project, () => undefined).boardRelationships;
  } catch (error) {
    if (error instanceof CommandExit) return 'labels';
    throw error;
  }
}

/** The title a line hands; a refusal with exit code 1 for none, several or one that is blank or spans lines. */
function readTitle(args: readonly string[]): string {
  const [title] = args;
  if (args.length !== 1 || title === undefined) {
    const got = args.length === 0
      ? 'none'
      : `${String(args.length)}: ${args.join(' ')}`;
    throw lineRefusal(`Expected one title, quoted, got ${got}`, USAGE);
  }
  if (title.trim() === '' || LINE_BREAK.test(title)) {
    throw lineRefusal('The title has to be one line holding some text', USAGE);
  }
  return title.trim();
}

/**
 * What a line asks for; a refusal with exit code 1 for the title, a
 * missing `--slug` and a `--horizon` outside {@link HORIZONS}, and with
 * {@link EPIC_NEW_REFUSAL_EXIT} for a slug that is not a kebab word.
 */
export function readEpicDraft(args: readonly string[], flags: LineFlags): EpicDraft {
  const title = readTitle(args);
  const slug = readRequiredFlag(flags, 'slug', USAGE);
  const horizon = readChoiceFlag(flags, 'horizon', HORIZONS, USAGE) ?? DEFAULT_HORIZON;
  if (!KEBAB_SLUG.test(slug)) {
    throw refusal(`--slug is "${slug}", which is not a kebab word: lowercase letters and digits`
      + ` joined by single hyphens, as sign-in\nUsage: ${USAGE}`);
  }
  return Object.freeze({ title, slug, horizon });
}

/**
 * What a native-mode line asks for: the title and the horizon, refused
 * as {@link readEpicDraft} refuses them. `--slug` is not read; see the
 * module note.
 */
export function readNativeEpicDraft(args: readonly string[], flags: LineFlags): NativeEpicDraft {
  const title = readTitle(args);
  const horizon = readChoiceFlag(flags, 'horizon', HORIZONS, USAGE) ?? DEFAULT_HORIZON;
  return Object.freeze({ title, horizon });
}

/** True when `label` is `name`, without case, as GitHub compares label names. */
function sameLabel(label: string, name: string): boolean {
  return label.trim().toLowerCase() === name.toLowerCase();
}

/** The issues on `listing` carrying `epic:<slug>`, lowest number first. */
export function issuesLabelled(slug: string, listing: readonly BoardIssue[]): readonly number[] {
  const label = epicLabel(slug);
  return Object.freeze(listing
    .filter((issue) => issue.labels.some((held) => sameLabel(held, label)))
    .map((issue) => issue.number)
    .sort((a, b) => a - b));
}

/** The sentence refusing a slug `issues` carry already. */
export function takenSlugMessage(slug: string, issues: readonly number[]): string {
  const named = issues.map((issue) => `#${String(issue)}`).join(', ');
  return `The slug ${slug} is already labelled: ${named} carry ${epicLabel(slug)}, so an epic on it would take`
    + ' them over. Pick another slug.';
}

/** Reads what `read` answers; a refusal with {@link EPIC_NEW_REFUSAL_EXIT} naming `what` when it fails. */
async function readOrRefuse<T>(what: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw refusal(`Could not read ${what}, so no epic was created: ${messageOf(error)}`);
  }
}

/** The body the epic is created with; a refusal with exit code 1 when the shipped template cannot be used. */
function epicBody(): string {
  try {
    return renderEpicBody();
  } catch (error) {
    throw new CommandExit(1, `❌ ${messageOf(error)}; no epic was created`);
  }
}

/** Creates `label` when `held` lacks it; a refusal with exit code 1 when the create fails. */
async function ensureLabel(board: IssueBoard, draft: EpicDraft, held: readonly string[]): Promise<LabelOutcome> {
  const label = epicLabel(draft.slug);
  if (held.some((name) => sameLabel(name, label))) return 'present';
  try {
    await board.createLabel(label, epicLabelDescription(draft.slug));
  } catch (error) {
    throw new CommandExit(1, `❌ Could not create the label ${label}, so no epic was created: ${messageOf(error)}`);
  }
  return 'created';
}

/**
 * Creates the epic issue titled `title` with `labels`; a refusal with
 * exit code 1 when the create fails, followed by `leftBehind` when the
 * run left something standing.
 */
async function createEpicIssue(
  board: IssueBoard,
  title: string,
  body: string,
  labels: readonly string[],
  leftBehind: string | null,
): Promise<CreatedIssue> {
  try {
    return await board.createIssue(title, body, labels);
  } catch (error) {
    const detail = leftBehind === null
      ? ''
      : `\n${leftBehind}`;
    throw new CommandExit(1, `❌ Could not create the epic issue: ${messageOf(error)}${detail}`);
  }
}

/** The sentence refusing a board line that did not land, the epic already created. */
export function lineFailedMessage(epic: CreatedIssue, board: number, problem: string): string {
  const id = `#${String(epic.number)}`;
  return `❌ Created epic ${id} (${epic.url}), but could not add its line to board #${String(board)}: ${problem}\n`
    + `Add "- [ ] ${id}" to board #${String(board)}'s checklist by hand.`;
}

/** What both modes read before the first write: the config, the `gh` runner and the one board listing. */
interface OpenedBoard {
  readonly config: RafaConfig;
  readonly gh: GhRunner;
  readonly listing: readonly BoardIssue[];
  readonly warn: (message: string) => void;
}

/** Loads the config with its warnings written and reads the board listing once; see the module note. */
async function openBoard(context: RafaContext, seams: EpicNewSeams): Promise<OpenedBoard> {
  const project = issueProject(context);
  const warn = (message: string): void => {
    context.output.warn(message);
  };
  const config = issueSubjectConfig(project, warn);
  const gh = seams.gh ?? createGhRunner({ cwd: project.root });
  const listing = await readOrRefuse('the board', () => createGhBoardListing({ gh })());
  return { config, gh, listing, warn };
}

/** The current board's number over `opened`, each notice but the absent-file one written as a warning. */
async function currentBoard(context: RafaContext, opened: OpenedBoard): Promise<number> {
  const { config, gh, listing, warn } = opened;
  const resolved = await resolvePlace({ root: issueProject(context).root, listing, defaultBoard: defaultBoardOnce(config, gh, listing) });
  for (const notice of resolved.notices) {
    if (notice.kind === 'lost' || notice.reason !== 'absent') warn(notice.message);
  }
  return resolved.current.board;
}

/** Appends `epic`'s line to board `boardNumber`; a refusal with exit code 1 when the edit ends `failed`. */
async function addBoardLine(gh: GhRunner, boardNumber: number, epic: CreatedIssue, title: string): Promise<ChecklistEditResult> {
  const line = await editChecklist({
    issue: boardNumber,
    edit: (text) => appendLine(text, epic.number, title),
    board: createGhRoadmapBody({ gh }),
  });
  if (line.status === 'failed') throw new CommandExit(1, lineFailedMessage(epic, boardNumber, line.problem));
  return line;
}

/** The native-mode run: no slug, no label, the issue and its board line; see the module note. */
async function createNativeEpic(context: RafaContext, seams: EpicNewSeams): Promise<NativeEpicNewResult> {
  const draft = readNativeEpicDraft(context.args, context.flags);
  const body = epicBody();
  const opened = await openBoard(context, seams);
  if (context.flags['slug'] !== undefined) opened.warn(NATIVE_SLUG_WARNING);
  const boardNumber = await currentBoard(context, opened);

  const epic = await createEpicIssue(createGhIssueBoard({ gh: opened.gh }), draft.title, body, nativeEpicIssueLabels(draft.horizon), null);
  const line = await addBoardLine(opened.gh, boardNumber, epic, draft.title);
  return Object.freeze({
    epic: Object.freeze({ ...epic, title: draft.title }),
    relationships: 'native',
    horizon: draft.horizon,
    board: boardNumber,
    line,
  });
}

/** Reads the board, refuses what the module note refuses, and makes the writes of the mode it reads; see the module note. */
export async function createEpic(context: RafaContext, seams: EpicNewSeams): Promise<EpicNewResult> {
  if (epicNewMode(context) === 'native') return createNativeEpic(context, seams);
  const draft = readEpicDraft(context.args, context.flags);
  const body = epicBody();
  const opened = await openBoard(context, seams);
  const carrying = issuesLabelled(draft.slug, opened.listing);
  if (carrying.length > 0) throw refusal(takenSlugMessage(draft.slug, carrying));
  const held = await readOrRefuse(`the repository's labels (the first ${String(LABEL_LIST_LIMIT)})`, () => listBoardLabels(opened.gh));
  const boardNumber = await currentBoard(context, opened);

  const issues = createGhIssueBoard({ gh: opened.gh });
  const labelOutcome = await ensureLabel(issues, draft, held);
  const leftBehind = `The label ${epicLabel(draft.slug)} stands with no issue carrying it; running the same line again keeps it.`;
  const epic = await createEpicIssue(issues, draft.title, body, epicIssueLabels(draft), leftBehind);
  const line = await addBoardLine(opened.gh, boardNumber, epic, draft.title);

  return Object.freeze({
    epic: Object.freeze({ ...epic, title: draft.title }),
    slug: draft.slug,
    label: epicLabel(draft.slug),
    labelOutcome,
    horizon: draft.horizon,
    board: boardNumber,
    line,
  });
}

/** What the first line says of the epic's label, or of the mode that names it by number and title. */
function labelledPhrase(result: EpicNewResult): string {
  if ('relationships' in result) return `${NATIVE_MODE}, so it is named by its number and title and no epic: label was created`;
  return result.labelOutcome === 'created'
    ? `created ${result.label}`
    : `kept ${result.label}, which the repository held already`;
}

/** The lines text mode writes for `result`. */
export function renderEpicNew(result: EpicNewResult): string[] {
  const id = `#${String(result.epic.number)}`;
  const labelled = labelledPhrase(result);
  const board = `#${String(result.board)}`;
  const placed = result.line.status === 'edited'
    ? `Added its line to board ${board}.`
    : `Board ${board} names it already.`;
  return [
    `Created epic ${id} ${result.epic.title}, horizon ${result.horizon}; ${labelled}.`,
    placed,
    result.epic.url,
  ];
}

/** Runs one `epic new` line with `seams`, writing it in the line's output mode. */
export async function runEpicNew(context: RafaContext, seams: EpicNewSeams): Promise<void> {
  const result = await createEpic(context, seams);
  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const text of renderEpicNew(result)) context.output.info(text);
}

/** The command, reaching `gh` through `seams`; see the module note. */
export function createEpicNewCommand(seams: EpicNewSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'epic new',
    subject: 'epic',
    action: 'new',
    summary: 'create an epic: the issue from the epic template, its line on the current board, and in labels mode its epic:<slug> label',
    description: 'Creates one epic. The label epic:<slug> is created when the repository does not hold it, then'
      + ' the epic issue, titled as given, its body the epic template (acceptance criteria, estimate, date,'
      + ' Owns: and an empty checklist), labelled type:epic, epic:<slug> and horizon:<horizon> in the same'
      + ' command, and last its `- [ ] #<n> <title>` line on the current board, the one `rafa switch` moved'
      + ' to, else the default board. The horizon is later unless `--horizon` says now or next, so a new'
      + ' epic is not picked by the loop unasked. A slug that is not a kebab word (lowercase letters and'
      + ' digits joined by single hyphens) or that an issue already carries as epic:<slug> is refused with'
      + ' exit code 2 before anything is created, as is a board that cannot be read. With `--output=json`'
      + ' the epic, its labels and the board line are the data of the terminal result event. With'
      + ' board.relationships native an epic is named by its number and title: no slug is needed or read, no'
      + ' epic:<slug> label is created or checked, and the issue is labelled type:epic and horizon:<horizon> only.',
    args: [
      {
        name: 'title',
        description: 'The epic\'s title, quoted: one line.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: 'slug',
        description: 'The epic\'s slug, a kebab word such as sign-in: its members carry epic:<slug>. Required in'
          + ' labels mode; not used with board.relationships native.',
        type: 'string',
        required: true,
      },
      {
        name: 'horizon',
        description: `The epic's horizon: one of ${HORIZONS.join(', ')}.`,
        type: 'string',
        default: DEFAULT_HORIZON,
      },
    ],
    examples: [
      {
        cmd: 'rafa epic new "Sign-in without passwords" --slug=passwordless',
        note: 'Creates the label epic:passwordless and the epic, horizon later, and adds its line to the current board.',
      },
      {
        cmd: 'rafa epic new "Billing v2" --slug=billing-v2 --horizon=next',
        note: 'Creates the epic with horizon:next.',
      },
    ],
    outputs: ['text', 'json'],
    run: (context) => runEpicNew(context, seams),
  };
  return Object.freeze(command);
}

export default createEpicNewCommand();
