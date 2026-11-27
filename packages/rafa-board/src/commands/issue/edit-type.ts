/**
 * The type half of `rafa issue edit <n> --type=bug|debt`: what the line
 * may hold beside the flag, which issue can take it, when nothing is left
 * to write, and the lines the edit is reported with. The run and its four
 * gates live in `./edit-run.ts`, which is at the 800-line size cap, so
 * what a type adds to an edit sits here, as `./edit-priority.ts` holds
 * what a priority adds.
 *
 * A type edit moves an issue between the two record types,
 * `ISSUE_RECORD_TYPES` (`./declarations-shared.ts`): a `bug`, which makes
 * something break, and a `debt`, a gap that only leaves a step done by
 * hand. Both are one bug record under its two types, so the move changes
 * the type and nothing else: every other label, the module, cause and
 * priority among them, and the body stay as they were, as `IssueEdit`
 * words a type in `packages/rafa/src/ports/index.ts`. Each adapter's
 * `edit` makes it so, the `github` one as a `type:` label swap in one
 * `gh issue edit` (`packages/rafa-board/src/adapters/tracker/github-edit.ts`),
 * the `local` one as the issue file's `type` field.
 *
 * ## The line
 *
 * {@link readTypeFlag} reads `--type` off the flags alone, so a line it
 * refuses has opened nothing. Each refusal exits 1 and names the usage
 * line it is handed, an argument for the reason `./edit-priority.ts`
 * gives: this module imports nothing from `./edit-run.ts`.
 *
 *   - a value outside the record types, a blank one included, and the
 *     flag typed bare;
 *   - `--type` beside `--append-file`, `--append`, `--replace-file` or
 *     `--priority` ({@link TYPE_RIVALS}): one run makes one kind of
 *     change. The value is refused first, so a mistyped type is named
 *     before the rival is.
 *
 * `--type` stands alone or beside `--title`. `--reason` and
 * `--while-in-development` go with an append only, and the append rules
 * of `./edit-run.ts` refuse them.
 *
 * ## The issue
 *
 * What the issue is typed is known only once it is read, so
 * {@link requireRecordType} refuses there, with exit code 1: an issue
 * whose type is neither record type (a `code`, `chore`, `spec` …), which
 * a move would turn into a record its fields were never asked for; and
 * a tracker whose `edit` writes no type, which answers no `type` from
 * `editable`, named by its kind as `requireHeldPriority` names one
 * writing no priority. Neither is a gate's refusal: nothing about the
 * account or the issue's state was weighed.
 *
 * ## Already
 *
 * {@link holdsTypeAlone} is true when the write would change nothing:
 * the issue is of the type, and holds no other `type:` label. The
 * reading alone does not say so on a tracker that holds labels, since
 * `editable` answers the first `type:` label, so the labels are read
 * too, by the rule the `github` adapter picks its `--remove-label`
 * values by, the prefix taken from `GITHUB_LABELS`. A tracker holding no
 * labels, such as `local`, answers on the reading alone. A type beside a
 * title never answers `already`: the title is written whatever the type.
 *
 * ## What is reported
 *
 * {@link typeSwapLine} is the line `--dry-run` prints for the edit, the
 * type the issue holds, an arrow and the new one: `type: debt → bug`.
 * {@link typeMessage} is the sentence of the outcome. {@link planTypeEdit}
 * puts the parts together in the shape `./edit-run.ts` plans every edit
 * in, its `PlannedEdit`. `added` is the text that module hands gate 3:
 * the new title, or the empty string for a type alone, which adds no
 * text to read.
 */
import type { LineFlags } from './issue-tracker.js';
import type { EditableIssue, IssueEdit, IssueType } from '@open-tomato/rafa/ports';

import { CommandExit } from '@open-tomato/rafa/core/command';

import { GITHUB_LABELS } from '../../adapters/tracker/github.js';
import { ISSUE_TYPES } from '../../adapters/tracker/issue-values.js';

import { ISSUE_RECORD_TYPES, PRIORITY_FLAG, TYPE_FLAG } from './declarations.js';
import { issueName, lineRefusal, readChoiceFlag } from './issue-tracker.js';

/** The two types `--type` moves an issue between, in `ISSUE_TYPES` order: `bug`, then `debt`. */
export const EDIT_RECORD_TYPES: readonly IssueType[] = Object.freeze(ISSUE_TYPES.filter((type) => ISSUE_RECORD_TYPES.includes(type)));

/** The flags `--type` is refused beside, in the order a refusal names the first one typed. */
export const TYPE_RIVALS: readonly string[] = Object.freeze(['append-file', 'append', 'replace-file', PRIORITY_FLAG]);

/** What a line's `--type` asks for: the type, and the new title when `--title` is beside it. */
export interface TypeEdit {
  readonly type: IssueType;
  /** The new title, or null when the title stays. */
  readonly title: string | null;
}

/**
 * A type edit planned: the six fields of the `PlannedEdit` in
 * `./edit-run.ts`, under the same names, narrowed to what a type edit
 * can hold.
 */
export interface TypePlan {
  /** The text gate 3 reads: the new title, or the empty string for a type alone. */
  readonly added: string;
  /** What the report calls the added part: the new title when there is one, then {@link typeSwapLine}. */
  readonly shown: string;
  /** No block: only an append adds one. */
  readonly block: null;
  /** The whole body after the edit, which is the body as read. */
  readonly after: string;
  /** True when the issue holds the type alone already and the line names no title. */
  readonly already: boolean;
  /** What `edit` is handed. */
  readonly change: IssueEdit;
}

/** The record types as a refusal names them: `bug and debt`. */
const RECORD_TYPES_WORDED = EDIT_RECORD_TYPES.join(' and ');

/**
 * The type `--type` names, or undefined when the line leaves the flag
 * out; a refusal with exit code 1 naming `usage` for each rule the
 * module note lists. `flags` is the whole line, since the rivals are
 * read off it.
 */
export function readTypeFlag(flags: LineFlags, usage: string): IssueType | undefined {
  const type = readChoiceFlag(flags, TYPE_FLAG, EDIT_RECORD_TYPES, usage);
  if (type === undefined) return undefined;
  const rival = TYPE_RIVALS.find((name) => flags[name] !== undefined);
  if (rival === undefined) return type;
  throw lineRefusal(
    `--${TYPE_FLAG} and --${rival} cannot be used together: one run makes one kind of change,`
    + ' so move the type in a run of its own',
    usage,
  );
}

/**
 * The record type `found` is of; a refusal with exit code 1 when the
 * tracker reads no type, or when `found` is of neither record type. See
 * the module note's issue.
 */
export function requireRecordType(found: EditableIssue): IssueType {
  const held = found.type;
  if (held === undefined) {
    throw new CommandExit(1, `❌ The ${found.ref.kind} tracker cannot move an issue's type: its edit writes none.`);
  }
  if (EDIT_RECORD_TYPES.includes(held)) return held;
  throw new CommandExit(
    1,
    `❌ ${issueName(found.ref)} is of type ${held}: --${TYPE_FLAG} moves an issue between ${RECORD_TYPES_WORDED} only,`
      + ' the two types a bug record is filed under.',
  );
}

/**
 * True when `issue` is of `type` and holds no other `type:` label, so an
 * edit to `type` has nothing to write; see the module note's already.
 */
export function holdsTypeAlone(issue: Pick<EditableIssue, 'type' | 'labels'>, type: IssueType): boolean {
  if (issue.type !== type) return false;
  const wanted = `${GITHUB_LABELS.typePrefix}${type}`;
  return !issue.labels.some((label) => label !== wanted && label.startsWith(GITHUB_LABELS.typePrefix));
}

/** The swap as `--dry-run` prints it: `type: debt → bug`. */
export function typeSwapLine(held: IssueType, type: IssueType): string {
  return `${TYPE_FLAG}: ${held} → ${type}`;
}

/**
 * The edit `edit` makes over `found`; see the module note's what is
 * reported. Refuses as {@link requireRecordType} does.
 */
export function planTypeEdit(edit: TypeEdit, found: EditableIssue): TypePlan {
  const held = requireRecordType(found);
  const { type, title } = edit;
  const swap = typeSwapLine(held, type);
  if (title === null) {
    return { added: '', shown: swap, block: null, after: found.body, already: holdsTypeAlone(found, type), change: { type } };
  }
  return { added: title, shown: `${title}\n\n${swap}`, block: null, after: found.body, already: false, change: { title, type } };
}

/**
 * The sentence a type edit of the issue called `name` is reported with:
 * nothing written when `already`, else what was written.
 */
export function typeMessage(edit: TypeEdit, already: boolean, name: string): string {
  const { type } = edit;
  if (already) return `${name} is already of type ${type}; nothing was written.`;
  return edit.title === null
    ? `Moved ${name} to type ${type}.`
    : `Changed the title of ${name} and moved it to type ${type}.`;
}
