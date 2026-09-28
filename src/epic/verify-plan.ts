/**
 * The verification planner of `rafa epic close`: the prompt the one
 * planning session is handed, built from the epic's acceptance criteria,
 * and the `rafa:verify` answer it ends with, read into one check or one
 * uncheckable-with-reason per criterion.
 *
 * The closing gate (`.rafa/specs/rafa-246-epic-lifecycle.md`) plans a
 * verification-only run from the criteria before it closes an epic: one
 * session turns each criterion into a check or names it uncheckable, and
 * each check then runs on its own against main (`./verify-run.ts`). This
 * module is the first half and nothing else. It starts no session, reads
 * no board and runs no check; the one effect is reading the shipped
 * template, and every function takes what it reads from, so each case in
 * `./verify-plan.test.ts` is a literal string.
 *
 * ## One criterion is one list item
 *
 * `readEpicBody` (`../board/epic-body.ts`) answers the criteria section as
 * one text, kept as written. {@link splitCriteria} cuts it into criteria,
 * numbered from one in the order written:
 *
 * - A top-level list item (`-`, `*`, `+`, `1.` or `1)` after at most three
 *   spaces) opens a criterion, and every line up to the next one is part
 *   of it: an indented continuation, a nested list and a fenced example
 *   all stay with the item they follow. The top level is the first item's
 *   indentation, and an item indented deeper than that is nested: `  - by
 *   number` under a `- ` item is a sub-point of it, not a criterion, which
 *   is what a renderer shows.
 * - An unindented line after a blank line that is not an item also opens
 *   one, as it ends the list in Markdown. So does the first line when it
 *   is not an item. A lead-in paragraph such as `Done when:` therefore
 *   becomes a criterion of its own rather than being dropped, and the
 *   planning session calls it uncheckable: a criterion lost here would be
 *   a criterion never checked, and the gate would close over it.
 * - A line inside a fence never opens a criterion; the fence is tracked
 *   by `readEpicBody`'s own rule, so a list quoted in an example stays in
 *   the criterion that quotes it.
 *
 * A criterion's text is its lines, joined with `\n` and trimmed, marker
 * included, since the section is the author's words and is shown back to
 * them in the close comment as written.
 *
 * ## Placeholders are never asked about
 *
 * A criterion that is, trimmed, one of the epic template's
 * `CRITERIA_PLACEHOLDERS` (`../board/epic-template.ts`) states nothing to
 * check. It is left out of the prompt and answered as uncheckable with
 * `PLACEHOLDER_REASON`, whatever the session wrote about it, so an epic
 * whose criteria are all still placeholders has nothing to ask:
 * {@link criteriaToAsk} answers empty and the caller needs no session to
 * know the gate refuses.
 *
 * ## The prompt
 *
 * `src/epic-verify-prompt.md` is the template, and {@link buildVerifyPrompt}
 * fills its three slots ({@link VERIFY_PROMPT_SLOTS}). It opens with
 * {@link VERIFY_PROMPT_PREFIX}, a first line no other prompt rafa sends
 * starts with. Each criterion is rendered under its number inside a
 * `text` fence one backtick longer than any backtick run in it, as
 * `../inventory/search/prompt.ts` fences a question: the criteria come
 * from an issue body anyone with write access can edit, and a line in one
 * that reads like an instruction stays the epic's words. The title is
 * collapsed onto one line for the same reason. Substitution is one pass
 * with a replacer function, so a `$&` or a `{CRITERIA}` inside a
 * criterion is inserted verbatim and never read as a slot.
 *
 * A template missing a slot throws, naming it, so an edited template
 * fails where it is rendered rather than asking a session about nothing.
 *
 * ## Where the template is read
 *
 * The build copies prompts by name into `dist/` (`cp src/PROMPT.md
 * src/plan-prompt.md src/epic-verify-prompt.md dist/`), and a module
 * inlined into a bundle answers the BUNDLE's directory from
 * `import.meta.url`: `dist/`, where `cli.js` sits. `src/plan.ts` reads its
 * template beside itself for that reason. This module sits one directory
 * below the template in a checkout, so {@link verifyPromptCandidates}
 * answers two paths, as `../pr/plans/load.ts` does for its plans: the
 * module's own directory, which is `dist/` in a build, then its parent,
 * which is `src/` in a checkout. Neither is reachable from the other
 * layout, and {@link readVerifyPrompt} names both when it finds neither.
 *
 * ## The answer
 *
 * ````markdown
 * ```rafa:verify
 * criteria:
 *   - criterion: 1
 *     check: "Run `rafa roadmap` and confirm each epic line shows its state."
 *   - criterion: 2
 *     uncheckable: "It names a feeling, not a behaviour."
 * ```
 * ````
 *
 * {@link parseVerifyPlan} takes the session's output and the criteria it
 * was built from, never throws, and reads the LAST `rafa:verify` block by
 * `readRafaBlocks` (`../plan/blocks.ts`), under the rule
 * `../inventory/search/block.ts` reads its own by: an earlier block is a
 * draft or the format quoted back, and when the last one cannot be read
 * no earlier one is read in its place.
 *
 * An output with no block, an unclosed block or a block that is not a
 * mapping with a `criteria` list is an ABSENCE ({@link VerifyPlanAbsent}),
 * not a list of uncheckable criteria. A planning session that answered
 * nothing has not judged any criterion, and reading that as "every
 * criterion uncheckable" would let `--accept-unchecked` close an epic on
 * no check at all.
 *
 * A readable block answers one {@link CriterionVerdict} per criterion, in
 * the criteria's order, placeholders included:
 *
 * - an entry carrying a non-blank `check` is a check, and one carrying a
 *   non-blank `uncheckable` reason is uncheckable with that reason, both
 *   trimmed;
 * - a criterion no usable entry answers is uncheckable too, with
 *   {@link SKIPPED_REASON}, or, when an entry named it and was dropped,
 *   with that entry's problem, so the person closing reads why rather
 *   than a bare gap.
 *
 * An entry is dropped, with one {@link VerifyPlanIssue} naming why, when
 * it is not a mapping; when its `criterion` is not a whole number from
 * one; when that number is no criterion the prompt asked about, a
 * placeholder's number included; when it carries both `check` and
 * `uncheckable`, or neither; when the one it carries is not a non-blank
 * string; or when an earlier entry already answered the same criterion.
 * Dropping one entry keeps the rest. Keys the parser does not know are
 * ignored, and `criteria` absent or null reads as an empty list, every
 * criterion skipped.
 *
 * `Bun.YAML.parse` reads the body, with the readings
 * `../inventory/search/block.ts` records for it: an unquoted value holding
 * `: ` throws, which is why the template asks for every value quoted,
 * and `criterion: "1"` reads as a string, which is refused rather than
 * turned into a number.
 */
import type { RafaBlock } from '../plan/blocks.js';

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CRITERIA_PLACEHOLDERS, PLACEHOLDER_REASON } from '../board/epic-template.js';
import { readRafaBlocks } from '../plan/blocks.js';

/** This module's own directory, where the template lookup starts. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** The template's file name, in `src/` and in `dist/` alike. */
export const VERIFY_PROMPT_FILE = 'epic-verify-prompt.md';

/** The rendered prompt's first line; see the module note. */
export const VERIFY_PROMPT_PREFIX = '# Epic verification planning instructions';

/** The info string of the block the planning session must end with. */
export const VERIFY_BLOCK_FENCE = 'rafa:verify';

/** The slots the template carries, each written `{NAME}`. */
export const VERIFY_PROMPT_SLOTS = ['EPIC_NUMBER', 'EPIC_TITLE', 'CRITERIA'] as const;

/** One of {@link VERIFY_PROMPT_SLOTS}. */
export type VerifyPromptSlot = (typeof VERIFY_PROMPT_SLOTS)[number];

/** Why a criterion no usable entry answered reads as uncheckable. */
export const SKIPPED_REASON = 'the verification plan did not answer it';

/** One acceptance criterion, as {@link splitCriteria} cut it. */
export interface EpicCriterion {
  /** Its 1-based position in the section, the number the prompt shows. */
  readonly number: number;
  /** Its lines, joined with `\n` and trimmed, marker included. */
  readonly text: string;
  /** True when it is still one of the epic template's placeholders. */
  readonly placeholder: boolean;
}

/** What the prompt is built from. */
export interface VerifyPromptInput {
  /** The epic's issue number. */
  readonly epic: number;
  /** The epic's title, as the board lists it. */
  readonly title: string;
  /** Every criterion {@link splitCriteria} answered; placeholders are left out of the prompt. */
  readonly criteria: readonly EpicCriterion[];
}

/** Where an uncheckable verdict came from. */
export type UncheckableSource =
  /** The session named the criterion uncheckable and said why. */
  | 'answer'
  /** The criterion is still the template's placeholder; it was never asked about. */
  | 'placeholder'
  /** No usable entry answered it. */
  | 'skipped';

/** A criterion the planning session turned into a check. */
export interface CriterionCheck {
  readonly kind: 'check';
  readonly criterion: EpicCriterion;
  /** The check, trimmed, as a check session is handed it. */
  readonly check: string;
}

/** A criterion no check was planned for, and why. */
export interface CriterionUncheckable {
  readonly kind: 'uncheckable';
  readonly criterion: EpicCriterion;
  /** One sentence a person closing the epic can act on. */
  readonly reason: string;
  /** Where the verdict came from. */
  readonly source: UncheckableSource;
}

/** One criterion's verdict. */
export type CriterionVerdict = CriterionCheck | CriterionUncheckable;

/** One `criteria` entry that was dropped, and why. */
export interface VerifyPlanIssue {
  /** Which entry, in the block's own key names: `criteria[2]`. */
  readonly field: string;
  /** One sentence for an operator to read. */
  readonly text: string;
}

/** Why a session output answers no verification plan. */
export type VerifyPlanAbsenceReason = 'no-block' | 'unclosed-block' | 'malformed-block';

/** A session output whose last `rafa:verify` block was read. */
export interface VerifyPlanPresent {
  readonly present: true;
  /** One verdict per criterion, in the criteria's order. */
  readonly verdicts: readonly CriterionVerdict[];
  /** The block the answer was read from. */
  readonly block: RafaBlock;
  /** One entry per dropped `criteria` entry. Empty for a clean answer. */
  readonly issues: readonly VerifyPlanIssue[];
}

/** A session output that answers no verification plan, and why. */
export interface VerifyPlanAbsent {
  readonly present: false;
  readonly reason: VerifyPlanAbsenceReason;
  /** The last `rafa:verify` block, raw body included, or null for `no-block`. */
  readonly block: RafaBlock | null;
  /** One sentence for an operator to read. */
  readonly text: string;
}

/** What {@link parseVerifyPlan} answers. */
export type VerifyPlanReading = VerifyPlanPresent | VerifyPlanAbsent;

/** A plain mapping, as the parser returns one. */
type Mapping = Readonly<Record<string, unknown>>;

/** A fence opening or closing a code block; `readEpicBody`'s own rule. */
const FENCE = /^\s*(?:`{3,}|~{3,})/u;

/** A list item: at most three spaces, captured, a marker, whitespace. */
const LIST_ITEM = /^( {0,3})(?:[-*+]|\d{1,9}[.)])(?:\s|$)/u;

/** A line that opens with whitespace. */
const INDENTED = /^\s/u;

/** The shortest fence Markdown allows. */
const MIN_FENCE_LENGTH = 3;

/** The block kind: the fence's info string less its `rafa:` prefix. */
const VERIFY_KIND = VERIFY_BLOCK_FENCE.slice('rafa:'.length);

/** Any slot, braces included, with its name captured. */
const SLOT_PATTERN = new RegExp(`\\{(${VERIFY_PROMPT_SLOTS.join('|')})\\}`, 'gu');

/** The two answers an entry may carry, exactly one of them. */
const ANSWER_KEYS = ['check', 'uncheckable'] as const;

/** One criterion's lines, gathered before it is numbered. */
type Gathered = string[];

/** Where {@link splitCriteria} stands as it walks the section. */
interface SplitState {
  /** Inside a fence: no line opens a criterion. */
  fenced: boolean;
  /** The line before was blank. */
  afterBlank: boolean;
  /** The first list item's indentation: the top level. Null before any item. */
  topIndent: number | null;
}

/** Whether a line outside a fence opens a new criterion; see the module note. */
function opensCriterion(text: string, state: SplitState): boolean {
  const item = LIST_ITEM.exec(text);
  if (item !== null) {
    const indent = item[1]?.length ?? 0;
    state.topIndent ??= indent;
    return indent <= state.topIndent;
  }
  return state.afterBlank && !INDENTED.test(text);
}

/**
 * The criteria section cut into criteria, numbered from one in the order
 * written; see the module note for the rule. Empty for null or blank
 * criteria.
 */
export function splitCriteria(criteria: string | null): readonly EpicCriterion[] {
  if (criteria === null) return Object.freeze([]);

  const gathered: Gathered[] = [];
  const state: SplitState = { fenced: false, afterBlank: false, topIndent: null };
  for (const text of criteria.split(/\r\n?|\n/u)) {
    const insideFence = state.fenced;
    if (FENCE.test(text)) state.fenced = !state.fenced;

    if (!insideFence && text.trim() === '') {
      state.afterBlank = true;
      gathered.at(-1)?.push(text);
      continue;
    }
    const current = gathered.at(-1);
    const opens = !insideFence && opensCriterion(text, state);
    if (current === undefined || opens) {
      gathered.push([text]);
    } else {
      current.push(text);
    }
    state.afterBlank = false;
  }

  const numbered = gathered.map((lines, index) => {
    const text = lines.join('\n').trim();
    return Object.freeze({ number: index + 1, text, placeholder: CRITERIA_PLACEHOLDERS.includes(text) });
  });
  return Object.freeze(numbered);
}

/** The criteria a planning session is asked about: every one that is not a placeholder. */
export function criteriaToAsk(criteria: readonly EpicCriterion[]): readonly EpicCriterion[] {
  return Object.freeze(criteria.filter((criterion) => !criterion.placeholder));
}

/**
 * Where the template is looked for, in order: `moduleDir` itself, which
 * is `dist/` in a build, then its parent, which is `src/` in a checkout.
 */
export function verifyPromptCandidates(moduleDir: string = MODULE_DIR): readonly string[] {
  return [join(moduleDir, VERIFY_PROMPT_FILE), join(dirname(moduleDir), VERIFY_PROMPT_FILE)];
}

/**
 * The template's text, from the first of {@link verifyPromptCandidates}
 * that exists.
 *
 * @throws Error naming both paths when neither exists.
 */
export function readVerifyPrompt(moduleDir: string = MODULE_DIR): string {
  const candidates = verifyPromptCandidates(moduleDir);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(`epic verify prompt: the verification prompt is missing: no file at ${candidates.join(' or ')}`);
  }
  return readFileSync(found, 'utf8');
}

/** A backtick fence longer than any backtick run in `text`. */
export function fenceFor(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/gu) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(MIN_FENCE_LENGTH, longestRun + 1));
}

/** One criterion as the `{CRITERIA}` slot renders it. */
function renderCriterion(criterion: EpicCriterion): string {
  const fence = fenceFor(criterion.text);
  return [`### Criterion ${String(criterion.number)}`, '', `${fence}text`, criterion.text, fence].join('\n');
}

/**
 * The planning session's prompt: `template` with its three slots filled
 * from `input`. Placeholder criteria are left out; see the module note.
 *
 * @throws Error naming the first slot `template` does not carry.
 */
export function buildVerifyPrompt(template: string, input: VerifyPromptInput): string {
  const missing = VERIFY_PROMPT_SLOTS.find((slot) => !template.includes(`{${slot}}`));
  if (missing !== undefined) {
    throw new Error(`epic verify prompt: the template carries no {${missing}} slot`);
  }

  const values: Readonly<Record<VerifyPromptSlot, string>> = {
    EPIC_NUMBER: String(input.epic),
    EPIC_TITLE: input.title.replace(/\s+/gu, ' ').trim(),
    CRITERIA: criteriaToAsk(input.criteria).map(renderCriterion)
      .join('\n\n'),
  };
  return template.replace(SLOT_PATTERN, (_whole, slot: VerifyPromptSlot) => values[slot]);
}

/** True for a mapping; false for a list, a scalar or null. */
function isMapping(value: unknown): value is Mapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A key's own value, looked up by name and never by object index. */
function fieldOf(mapping: Mapping, key: string): unknown {
  return Object.entries(mapping).find(([own]) => own === key)?.[1];
}

/** A value as an issue quotes it. Never serialises a collection. */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null || value === undefined) return 'nothing';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  return `the ${typeof value} ${String(value)}`;
}

/** The message of whatever was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** One absence. */
function absent(reason: VerifyPlanAbsenceReason, block: RafaBlock | null, text: string): VerifyPlanAbsent {
  return Object.freeze({ present: false, reason, block, text });
}

/** One entry's usable answer, before it is matched to its criterion. */
interface EntryAnswer {
  readonly number: number;
  readonly key: (typeof ANSWER_KEYS)[number];
  readonly text: string;
}

/** An entry read: its answer, or its problem and the criterion number it named, if any. */
type EntryReading =
  | { readonly answer: EntryAnswer }
  | { readonly problem: string; readonly number: number | null };

/** Reads one `criteria` entry against the numbers the prompt asked about. */
function readEntry(item: unknown, field: string, asked: ReadonlySet<number>): EntryReading {
  if (!isMapping(item)) return { problem: `${field} is ${describeValue(item)}, not a mapping`, number: null };

  const number = fieldOf(item, 'criterion');
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) {
    return { problem: `${field}.criterion is ${describeValue(number)}, not a criterion number from 1`, number: null };
  }
  if (!asked.has(number)) {
    return { problem: `${field}.criterion ${String(number)} is no criterion the plan was asked about`, number: null };
  }

  const carried = ANSWER_KEYS.filter((key) => fieldOf(item, key) !== undefined);
  const [key] = carried;
  if (carried.length !== 1 || key === undefined) {
    const count = carried.length === 0
      ? 'neither'
      : 'both';
    return { problem: `${field} carries ${count} check and uncheckable`, number };
  }
  const value = fieldOf(item, key);
  if (typeof value !== 'string' || value.trim() === '') {
    return { problem: `${field}.${key} is ${describeValue(value)}, not a non-blank string`, number };
  }
  return { answer: { number, key, text: value.trim() } };
}

/** The verdict for one criterion, from its answer, its dropped entry's problem, or neither. */
function verdictFor(
  criterion: EpicCriterion,
  answer: EntryAnswer | undefined,
  problem: string | undefined,
): CriterionVerdict {
  if (criterion.placeholder) {
    return { kind: 'uncheckable', criterion, reason: PLACEHOLDER_REASON, source: 'placeholder' };
  }
  if (answer?.key === 'check') return { kind: 'check', criterion, check: answer.text };
  if (answer?.key === 'uncheckable') return { kind: 'uncheckable', criterion, reason: answer.text, source: 'answer' };
  const reason = problem === undefined
    ? SKIPPED_REASON
    : `${SKIPPED_REASON}: its entry was dropped, as ${problem}`;
  return { kind: 'uncheckable', criterion, reason, source: 'skipped' };
}

/** Reads a `criteria` list into one verdict per criterion; see the module note. */
function readVerdicts(
  items: readonly unknown[],
  criteria: readonly EpicCriterion[],
  block: RafaBlock,
): VerifyPlanPresent {
  const asked = new Set(criteriaToAsk(criteria).map((criterion) => criterion.number));
  const answers = new Map<number, EntryAnswer>();
  const problems = new Map<number, string>();
  const issues: VerifyPlanIssue[] = [];

  for (const [index, item] of items.entries()) {
    const field = `criteria[${String(index)}]`;
    const reading = readEntry(item, field, asked);
    if ('problem' in reading) {
      issues.push(Object.freeze({ field, text: `${reading.problem}; dropped` }));
      if (reading.number !== null && !problems.has(reading.number)) problems.set(reading.number, reading.problem);
      continue;
    }
    if (answers.has(reading.answer.number)) {
      const text = `${field} answers criterion ${String(reading.answer.number)} a second time; dropped`;
      issues.push(Object.freeze({ field, text }));
      continue;
    }
    answers.set(reading.answer.number, reading.answer);
  }

  const verdicts = criteria.map((criterion) => Object.freeze(
    verdictFor(criterion, answers.get(criterion.number), problems.get(criterion.number)),
  ));
  return Object.freeze({
    present: true,
    verdicts: Object.freeze(verdicts),
    block,
    issues: Object.freeze(issues),
  });
}

/**
 * Reads the last `rafa:verify` block out of the planning session's
 * output against the criteria its prompt was built from.
 *
 * Answers one verdict per criterion with an issue per dropped entry, or an
 * absence naming why there is no plan. Never throws. See the module note
 * for which block counts and what an entry must hold.
 */
export function parseVerifyPlan(output: string, criteria: readonly EpicCriterion[]): VerifyPlanReading {
  const block = readRafaBlocks(output)
    .filter((each) => each.kind === VERIFY_KIND)
    .at(-1);
  if (block === undefined) {
    return absent('no-block', null, `the session output holds no ${VERIFY_BLOCK_FENCE} block`);
  }

  const at = `${VERIFY_BLOCK_FENCE} block at line ${String(block.span.first)}`;
  if (!block.closed) {
    return absent('unclosed-block', block, `${at} is never closed, so it is not read`);
  }

  let document: unknown;
  try {
    document = Bun.YAML.parse(block.body);
  } catch (error) {
    return absent('malformed-block', block, `${at} is not valid YAML (${messageOf(error)})`);
  }
  if (!isMapping(document)) {
    return absent('malformed-block', block, `${at} holds ${describeValue(document)}, not a mapping`);
  }

  const listed = fieldOf(document, 'criteria') ?? [];
  if (!Array.isArray(listed)) {
    return absent('malformed-block', block, `${at} has criteria ${describeValue(listed)}, not a list`);
  }
  return readVerdicts(listed, criteria, block);
}
