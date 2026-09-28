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
 * ## What it writes
 *
 * In text mode, the created epic with its labels, where its line went,
 * and its URL. In json mode the terminal result's `data` is an
 * {@link EpicNewResult}.
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

/** Whether the repository held the epic's label, or this run created it. */
export type LabelOutcome = 'created' | 'present';

/** What json mode gives as the terminal result's `data`. */
export interface EpicNewResult {
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

/** Creates the epic issue; a refusal with exit code 1 naming the label left standing when the create fails. */
async function createEpicIssue(board: IssueBoard, draft: EpicDraft, body: string): Promise<CreatedIssue> {
  try {
    return await board.createIssue(draft.title, body, epicIssueLabels(draft));
  } catch (error) {
    throw new CommandExit(1, `❌ Could not create the epic issue: ${messageOf(error)}\n`
      + `The label ${epicLabel(draft.slug)} stands with no issue carrying it; running the same line again keeps it.`);
  }
}

/** The sentence refusing a board line that did not land, the epic already created. */
export function lineFailedMessage(epic: CreatedIssue, board: number, problem: string): string {
  const id = `#${String(epic.number)}`;
  return `❌ Created epic ${id} (${epic.url}), but could not add its line to board #${String(board)}: ${problem}\n`
    + `Add "- [ ] ${id}" to board #${String(board)}'s checklist by hand.`;
}

/** Reads the board, refuses what the module note refuses, and makes the three writes; see the module note. */
export async function createEpic(context: RafaContext, seams: EpicNewSeams): Promise<EpicNewResult> {
  const draft = readEpicDraft(context.args, context.flags);
  const body = epicBody();
  const project = issueProject(context);
  const warn = (message: string): void => {
    context.output.warn(message);
  };
  const config = issueSubjectConfig(project, warn);
  const gh = seams.gh ?? createGhRunner({ cwd: project.root });

  const listing = await readOrRefuse('the board', () => createGhBoardListing({ gh })());
  const carrying = issuesLabelled(draft.slug, listing);
  if (carrying.length > 0) throw refusal(takenSlugMessage(draft.slug, carrying));
  const held = await readOrRefuse(`the repository's labels (the first ${String(LABEL_LIST_LIMIT)})`, () => listBoardLabels(gh));
  const resolved = await resolvePlace({ root: project.root, listing, defaultBoard: defaultBoardOnce(config, gh, listing) });
  for (const notice of resolved.notices) {
    if (notice.kind === 'lost' || notice.reason !== 'absent') warn(notice.message);
  }
  const boardNumber = resolved.current.board;

  const issues = createGhIssueBoard({ gh });
  const labelOutcome = await ensureLabel(issues, draft, held);
  const epic = await createEpicIssue(issues, draft, body);
  const line = await editChecklist({
    issue: boardNumber,
    edit: (text) => appendLine(text, epic.number, draft.title),
    board: createGhRoadmapBody({ gh }),
  });
  if (line.status === 'failed') throw new CommandExit(1, lineFailedMessage(epic, boardNumber, line.problem));

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

/** The lines text mode writes for `result`. */
export function renderEpicNew(result: EpicNewResult): string[] {
  const id = `#${String(result.epic.number)}`;
  const labelled = result.labelOutcome === 'created'
    ? `created ${result.label}`
    : `kept ${result.label}, which the repository held already`;
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
    summary: 'create an epic: its epic:<slug> label, the issue from the epic template, and its line on the current board',
    description: 'Creates one epic. The label epic:<slug> is created when the repository does not hold it, then'
      + ' the epic issue, titled as given, its body the epic template (acceptance criteria, estimate, date,'
      + ' Owns: and an empty checklist), labelled type:epic, epic:<slug> and horizon:<horizon> in the same'
      + ' command, and last its `- [ ] #<n> <title>` line on the current board, the one `rafa switch` moved'
      + ' to, else the default board. The horizon is later unless `--horizon` says now or next, so a new'
      + ' epic is not picked by the loop unasked. A slug that is not a kebab word (lowercase letters and'
      + ' digits joined by single hyphens) or that an issue already carries as epic:<slug> is refused with'
      + ' exit code 2 before anything is created, as is a board that cannot be read. With `--output=json`'
      + ' the epic, its labels and the board line are the data of the terminal result event.',
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
        description: 'The epic\'s slug, a kebab word such as sign-in: its members carry epic:<slug>. Required.',
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
