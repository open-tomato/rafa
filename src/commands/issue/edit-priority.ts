/**
 * The priority half of `rafa issue edit <n> --priority=<priority>`: what
 * the line may hold beside the flag, which tracker can take it, when
 * nothing is left to write, and the lines the edit is reported with. The
 * run and its four gates live in `./edit-run.ts`, which is near the
 * 800-line size cap, so what a priority adds to an edit sits here.
 *
 * A priority edit is one write: the new priority set, every other
 * priority removed, and the issue taken out of triage, as `IssueEdit`
 * words it in `packages/rafa/src/ports/index.ts`. Each adapter's `edit` makes it so,
 * the `github` one as a label swap in one `gh issue edit`
 * (`src/adapters/tracker/github-edit.ts`), the `local` one as the issue
 * file's `priority` field.
 *
 * ## The line
 *
 * {@link readPriorityFlag} reads `--priority` off the flags alone, so a
 * line it refuses has opened nothing. Each refusal exits 1 and names the
 * usage line it is handed. The usage is an argument and not an import:
 * this module imports nothing from `./edit-run.ts`, so that module can
 * import this one without a cycle:
 *
 *   - a value outside `ISSUE_PRIORITIES`, a blank one included, and the
 *     flag typed bare;
 *   - `--priority` beside `--append-file`, `--append` or `--replace-file`
 *     ({@link PRIORITY_RIVALS}): one run makes one kind of change. The
 *     value is refused first, so a mistyped priority is named before the
 *     rival is.
 *
 * `--priority` stands alone or beside `--title`. `--reason` and
 * `--while-in-development` go with an append only, and the append rules
 * of `./edit-run.ts` refuse them; this reader lets both through.
 *
 * ## A tracker with no priority edit
 *
 * A tracker whose `edit` writes no priority answers no `priority` from
 * `editable`. That is known only once the issue is read, so
 * {@link requireHeldPriority} refuses there, with exit code 1 and the
 * tracker's kind, as `requireEditingTracker` refuses a tracker with no
 * `edit` at all. It is no gate's refusal: nothing about the issue or the
 * account was weighed.
 *
 * ## Already
 *
 * {@link holdsPriorityAlone} is true when the write would change
 * nothing: the issue holds the priority, no other, and no mark of
 * triage. The reading alone does not say so on a tracker that holds
 * labels, since `editable` answers the first `priority:` label and reads
 * past `needs-triage`. So the labels are read too, by the rule the
 * `github` adapter picks its `--remove-label` values by, with the two
 * spellings taken from `GITHUB_LABELS`. A tracker holding no labels, such
 * as `local`, answers on the reading alone. The test file runs the rule
 * beside each adapter's `edit`.
 *
 * A priority beside a title never answers `already`: a title change has
 * no such answer, and the title is written whatever the priority.
 *
 * ## What is reported
 *
 * {@link swapLine} is the line `--dry-run` prints for the edit: the
 * priority the issue holds, or `needs-triage` when it holds none, an
 * arrow and the new one. An issue holding a priority and the triage
 * label at once prints its priority there, and the edit still removes
 * the label. {@link priorityMessage} is the sentence of the outcome.
 *
 * {@link planPriorityEdit} puts the parts together in the shape
 * `./edit-run.ts` plans every edit in, its `PlannedEdit`. `added` is the
 * text that module hands gate 3: the new title, or the empty string for
 * a priority alone, which adds no text to read.
 */
import type { LineFlags } from './issue-tracker.js';
import type { EditableIssue, IssueEdit, IssuePriority } from '@open-tomato/rafa/ports';

import { CommandExit } from '@open-tomato/rafa/core/command';

import { GITHUB_LABELS } from '../../adapters/tracker/github.js';
import { ISSUE_PRIORITIES } from '../../adapters/tracker/issue-values.js';

import { lineRefusal, readChoiceFlag } from './issue-tracker.js';

/** The flag, by name. */
export const PRIORITY_FLAG = 'priority';

/** The flags `--priority` is refused beside, in the order a refusal names the first one typed. */
export const PRIORITY_RIVALS: readonly string[] = Object.freeze(['append-file', 'append', 'replace-file']);

/** What a line's `--priority` asks for: the priority, and the new title when `--title` is beside it. */
export interface PriorityEdit {
  readonly priority: IssuePriority;
  /** The new title, or null when the title stays. */
  readonly title: string | null;
}

/**
 * A priority edit planned: the six fields of the `PlannedEdit` in
 * `./edit-run.ts`, under the same names, narrowed to what a priority
 * edit can hold.
 */
export interface PriorityPlan {
  /** The text gate 3 reads: the new title, or the empty string for a priority alone. */
  readonly added: string;
  /** What the report calls the added part: the new title when there is one, then {@link swapLine}. */
  readonly shown: string;
  /** No block: only an append adds one. */
  readonly block: null;
  /** The whole body after the edit, which is the body as read. */
  readonly after: string;
  /** True when the issue holds the priority alone already and the line names no title. */
  readonly already: boolean;
  /** What `edit` is handed. */
  readonly change: IssueEdit;
}

/**
 * The priority `--priority` names, or undefined when the line leaves the
 * flag out; a refusal with exit code 1 naming `usage` for each rule the
 * module note lists. `flags` is the whole line, since the rivals are
 * read off it.
 */
export function readPriorityFlag(flags: LineFlags, usage: string): IssuePriority | undefined {
  const priority = readChoiceFlag(flags, PRIORITY_FLAG, ISSUE_PRIORITIES, usage);
  if (priority === undefined) return undefined;
  const rival = PRIORITY_RIVALS.find((name) => flags[name] !== undefined);
  if (rival === undefined) return priority;
  throw lineRefusal(
    `--${PRIORITY_FLAG} and --${rival} cannot be used together: one run makes one kind of change,`
    + ' so set the priority in a run of its own',
    usage,
  );
}

/**
 * The priority `found` holds, null when triage has set none; a refusal
 * with exit code 1 naming the tracker's kind when `found` carries no
 * priority reading, which is a tracker whose `edit` writes none.
 */
export function requireHeldPriority(found: EditableIssue): IssuePriority | null {
  if (found.priority !== undefined) return found.priority;
  throw new CommandExit(1, `❌ The ${found.ref.kind} tracker cannot set a priority: its edit writes none.`);
}

/**
 * True when `issue` holds `priority`, no other priority and no mark of
 * triage, so an edit to `priority` has nothing to write; see the module
 * note's already.
 */
export function holdsPriorityAlone(issue: Pick<EditableIssue, 'priority' | 'labels'>, priority: IssuePriority): boolean {
  if (issue.priority !== priority) return false;
  const wanted = `${GITHUB_LABELS.priorityPrefix}${priority}`;
  return !issue.labels.some((label) => label !== wanted
    && (label === GITHUB_LABELS.needsTriage || label.startsWith(GITHUB_LABELS.priorityPrefix)));
}

/** The swap as `--dry-run` prints it: `priority: needs-triage → high`. */
export function swapLine(held: IssuePriority | null, priority: IssuePriority): string {
  return `${PRIORITY_FLAG}: ${held ?? GITHUB_LABELS.needsTriage} → ${priority}`;
}

/**
 * The edit `edit` makes over `found`; see the module note's what is
 * reported. Refuses as {@link requireHeldPriority} does when `found`
 * carries no priority reading.
 */
export function planPriorityEdit(edit: PriorityEdit, found: EditableIssue): PriorityPlan {
  const held = requireHeldPriority(found);
  const { priority, title } = edit;
  const swap = swapLine(held, priority);
  if (title === null) {
    return { added: '', shown: swap, block: null, after: found.body, already: holdsPriorityAlone(found, priority), change: { priority } };
  }
  return { added: title, shown: `${title}\n\n${swap}`, block: null, after: found.body, already: false, change: { title, priority } };
}

/**
 * The sentence a priority edit of the issue called `name` is reported
 * with: nothing written when `already`, else what was written.
 */
export function priorityMessage(edit: PriorityEdit, already: boolean, name: string): string {
  const { priority } = edit;
  if (already) return `${name} already holds priority ${priority} and is out of triage; nothing was written.`;
  return edit.title === null
    ? `Set the priority of ${name} to ${priority}; it is out of triage.`
    : `Changed the title of ${name} and set its priority to ${priority}; it is out of triage.`;
}
