/**
 * The survey's decision sources: what the project has already decided, in
 * the words it was decided in, each line with the place it was read. Run
 * from the repository root, `bun scripts/survey/decision-sources.ts` reads
 * the `type:spec` issues through `gh`, the local specs under `.rafa/specs/`
 * when that folder is there, and the `context/` pages, and writes
 * `docs/survey/decision-sources.json` and `docs/survey/decision-sources.md`.
 * `--issues=<file>` reads the issues from a file holding what
 * `gh issue list --json number,title,body` prints instead of calling `gh`.
 *
 * Three kinds of decision are read:
 *
 *   - `tenet`: the project's tenets, from the bodies of #598 and #754 only.
 *     A line naming the tenets with a list after its colon gives one tenet
 *     per comma-separated item (#598's "a shortener of commands, …"); a
 *     line naming them that ends in a colon gives one tenet per list item
 *     below it, the item's bold lead as its title (#754's "**Never
 *     block.** …").
 *   - `rejected`: every "Rejected" line of a `type:spec` issue body or a
 *     local spec. The label is `Rejected` or `Rejected alternatives` (also
 *     `names`, `options`, `approaches`), bold or plain, alone or behind a
 *     list marker, or a heading. A label with text after it is one line,
 *     its wrapped continuation joined (`**Rejected:** a lock file. …`,
 *     `- **Rejected: deleting the files.** …`); a label standing alone
 *     takes the list items or the paragraph below it, each one line. A
 *     plain label needs its colon, so prose that only uses the word is not
 *     read.
 *   - `rule`: the rule statements of the `context/` pages: each sentence
 *     of a paragraph or list item that says `never`, `always` or `must`
 *     outside a code span, and each bold lead of six words or more that
 *     ends in a period
 *     (`**Every writer of a merged table must be checked.**`). This is a
 *     reading by shape; a rule written with none of those words is missed,
 *     and the guideline sheet infers it instead.
 *
 * Fenced code and tables are never read. One decision written twice, in an
 * issue and a local spec or on two pages, is kept once with every source:
 * two lines are the same when they match with emphasis marks, case, runs
 * of blanks and a closing period set aside. Decisions of different kinds
 * never merge, and nothing here judges whether two lines mean the same
 * thing; that is the guideline sheet's work.
 *
 * The summary's coverage line counts the `context/` pages read against the
 * pages `git ls-files` lists there. Issues are counted by number and local
 * specs by path: they are not tracked, so no coverage line can hold them.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { coverageLine } from './files';
import { OUTPUT_DIR, stableJson } from './import-graph';

/** The issues whose bodies hold the project's tenets. */
export const TENET_ISSUES: readonly number[] = [598, 754];

/** The folder of local specs, repository-relative. Gitignored, so it may be absent. */
export const LOCAL_SPECS_DIR = '.rafa/specs';

/** The folder of context pages, repository-relative. */
export const CONTEXT_DIR = 'context';

/** The most issues one `gh issue list` call is asked for. */
export const ISSUE_LIMIT = 1000;

/** The kinds of decision read. */
export type DecisionKind = 'rejected' | 'rule' | 'tenet';

/** Where a source sits: an issue body, a local spec or a context page. */
export type SourceKind = 'context' | 'issue' | 'local-spec';

/** One issue as `gh issue list --json number,title,body` gives it. */
export interface IssueBody {
  readonly number: number;
  readonly title: string;
  readonly body: string;
}

/** One markdown file read from disk, by repository-relative path. */
export interface MarkdownFile {
  readonly path: string;
  readonly text: string;
}

/** What the collection is built from, all of it passed in as data. */
export interface DecisionSourcesInput {
  /** The `type:spec` issues, the tenet issues among them. */
  readonly issues: readonly IssueBody[];
  /** The local specs, or `undefined` when `.rafa/specs/` is absent. */
  readonly localSpecs: readonly MarkdownFile[] | undefined;
  /** The `context/` pages. */
  readonly contextPages: readonly MarkdownFile[];
}

/** One line read from a markdown text, before its source is named. */
export interface MarkdownReading {
  /** The line's text, one line, its label and list marker dropped. */
  readonly text: string;
  /** A tenet's bold lead, or `null`. */
  readonly title: string | null;
  /** The 1-based line the reading starts on. */
  readonly line: number;
  /** The nearest heading above it, or `null`. */
  readonly section: string | null;
}

/** One place a decision was read. */
export interface DecisionSource {
  readonly kind: SourceKind;
  /** `#<number>` for an issue, the repository-relative path otherwise. */
  readonly ref: string;
  readonly line: number;
  readonly section: string | null;
}

/** One decision, with every place it was read. */
export interface Decision {
  readonly kind: DecisionKind;
  /** The text as first read, by source order. */
  readonly text: string;
  /** A tenet's title, or `null`. */
  readonly title: string | null;
  /** Every source, sorted: issues by number, then local specs, then pages. */
  readonly sources: readonly DecisionSource[];
}

/** The collection both outputs show. */
export interface DecisionSources {
  /** Every decision, sorted by kind, then by its sources, then by text. */
  readonly decisions: readonly Decision[];
  /** The issues read, sorted by number. */
  readonly issues: readonly { readonly number: number; readonly title: string }[];
  /** The tenet issues, and whether each was among the issues read. */
  readonly tenetIssues: readonly { readonly number: number; readonly read: boolean }[];
  /** The local specs read, sorted, or `null` when `.rafa/specs/` is absent. */
  readonly localSpecs: readonly string[] | null;
  /** The context pages read, sorted. */
  readonly contextPages: readonly string[];
}

const FENCE = /^\s*(?:```|~~~)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const TABLE_ROW = /^\s*\|/;
const LABEL_WORDS = String.raw`Rejected(?:\s+(?:alternatives?|names|options|approaches))?`;
const LABEL_ALONE = new RegExp(String.raw`^${LABEL_WORDS}\s*[:.,]?$`, 'i');
const LABEL_HOLDING_ITEM = new RegExp(String.raw`^${LABEL_WORDS}\s*:\s*(.+)$`, 'i');
const PLAIN_LABEL = new RegExp(String.raw`^${LABEL_WORDS}\s*:\s*(.*)$`, 'i');
const HEADING_LABEL = new RegExp(String.raw`^${LABEL_WORDS}\b`, 'i');
const TENET_WORD = /\btenets?\b/i;
const RULE_WORD = /\b(?:never|always|must)\b/i;
const CODE_SPAN = /`[^`]*`/g;
const RULE_LEAD_WORDS = 6;
const KIND_ORDER: Readonly<Record<SourceKind, number>> = { context: 2, issue: 0, 'local-spec': 1 };

/**
 * Compares two strings by UTF-16 code unit, the order `sort` gives.
 *
 * @param left - One string.
 * @param right - The other.
 * @returns A negative, zero or positive number.
 */
function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right
    ? -1
    : 1;
}

/**
 * Joins lines into one, runs of blanks folded to one space.
 *
 * @param parts - The lines.
 * @returns One trimmed line.
 */
function oneLine(parts: readonly string[]): string {
  return parts
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The key two decisions share when they say the same words: emphasis
 * marks, case, runs of blanks and a closing period set aside.
 *
 * @param text - A decision's text.
 * @returns Its key.
 */
export function decisionKey(text: string): string {
  return text
    .replace(/\*\*|__|\*/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '');
}

/** One prose line of a markdown text: fenced code blanked, its heading kept. */
interface ProseLine {
  /** The line as written, or `''` inside a fence. */
  readonly raw: string;
  /** The nearest heading at or above the line, or `null`. */
  readonly section: string | null;
  /** The heading's level when the line is one, else `0`. */
  readonly headingLevel: number;
}

/**
 * Splits a markdown text into lines, each fenced code line blanked so no
 * reader sees it, each line carrying the heading it sits under.
 *
 * @param text - The markdown.
 * @returns One entry per line of `text`.
 */
function proseLines(text: string): ProseLine[] {
  const lines: ProseLine[] = [];
  let inFence = false;
  let section: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      lines.push({ headingLevel: 0, raw: '', section });
      continue;
    }
    if (inFence) {
      lines.push({ headingLevel: 0, raw: '', section });
      continue;
    }
    const heading = HEADING.exec(raw);
    if (heading) {
      const [, hashes = '', title = ''] = heading;
      section = title;
      lines.push({ headingLevel: hashes.length, raw, section });
      continue;
    }
    lines.push({ headingLevel: 0, raw, section });
  }
  return lines;
}

/**
 * The prose line at an index the caller has bounded by the list's length.
 *
 * @param lines - The prose lines.
 * @param index - An index below `lines.length`.
 * @returns The line.
 * @throws When the index is out of range, a bug in the caller.
 */
function lineAt(lines: readonly ProseLine[], index: number): ProseLine {
  const line = lines[index];
  if (line === undefined) {
    throw new Error(`no prose line at ${index} of ${lines.length}`);
  }
  return line;
}

/** A bold lead: the text inside the opening bold and what follows it. */
interface BoldLead {
  readonly inner: string;
  readonly after: string;
}

/**
 * The bold run a text opens with, its closing mark looked for outside code
 * spans, so `**Rejected: \`stretch/**\`.**` closes after the span.
 *
 * @param text - Trimmed text.
 * @returns The bold run and the rest, or `null` when the text opens with none.
 */
export function boldLead(text: string): BoldLead | null {
  const mark = text.slice(0, 2);
  if (mark !== '**' && mark !== '__') {
    return null;
  }
  let inCode = false;
  for (let index = 2; index < text.length; index += 1) {
    if (text[index] === '`') {
      inCode = !inCode;
    } else if (!inCode && index > 2 && text.startsWith(mark, index)) {
      return { after: text.slice(index + 2), inner: text.slice(2, index) };
    }
  }
  return null;
}

/** A line that a following line cannot continue. */
function isBreak(line: ProseLine): boolean {
  return line.raw.trim() === ''
    || line.headingLevel > 0
    || LIST_ITEM.test(line.raw)
    || TABLE_ROW.test(line.raw);
}

/**
 * Whether a line stands alone in bold, as `**Analogies used**` does: a
 * bold heading that ends the block above it.
 */
function isBoldOnly(raw: string): boolean {
  const lead = boldLead(raw.trim());
  return lead !== null && lead.after.trim().replace(/^[:.,]/, '') === '';
}

/**
 * The text after a Rejected label, when the content opens with one.
 *
 * @param content - A line's text, its list marker dropped.
 * @returns `''` for a label standing alone, the text after the label for a
 *   label holding a line, `undefined` when the content is no label.
 */
export function afterRejectedLabel(content: string): string | undefined {
  const trimmed = content.trim();
  const lead = boldLead(trimmed);
  if (lead) {
    const { after, inner } = lead;
    const rest = after.replace(/^\s*[:.,]?\s*/, '');
    if (LABEL_ALONE.test(inner.trim())) {
      return rest;
    }
    const holding = LABEL_HOLDING_ITEM.exec(inner.trim());
    return holding
      ? oneLine([holding[1] ?? '', after])
      : undefined;
  }
  const plain = PLAIN_LABEL.exec(trimmed);
  return plain
    ? (plain[1] ?? '').trim()
    : undefined;
}

/** One list item or paragraph of a block, its lines still apart. */
interface BlockItem {
  /** The 1-based line it starts on. */
  readonly line: number;
  readonly parts: string[];
  readonly section: string | null;
}

/**
 * The lines below a label standing alone, each list item or paragraph one
 * line, and the index the scan resumes at.
 *
 * @param lines - The text's prose lines.
 * @param start - The index just below the label.
 * @param labelIndent - The label's list indent, or `-1` when it is no list item.
 * @param underHeading - `true` when the label is a heading, so the block runs to the next heading.
 * @returns The items read and the index after the block.
 */
function readBlock(
  lines: readonly ProseLine[],
  start: number,
  labelIndent: number,
  underHeading: boolean,
): { items: BlockItem[]; end: number } {
  const items: BlockItem[] = [];
  let current: BlockItem | undefined;
  let sawBlank = false;
  let index = start;
  for (; index < lines.length; index += 1) {
    const line = lineAt(lines, index);
    const raw = line.raw;
    if (line.headingLevel > 0) {
      break;
    }
    if (raw.trim() === '') {
      sawBlank = items.length > 0;
      current = undefined;
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    if (labelIndent >= 0 && indent <= labelIndent) {
      break;
    }
    if (TABLE_ROW.test(raw) || (!underHeading && isBoldOnly(raw))) {
      break;
    }
    const item = LIST_ITEM.exec(raw);
    const endsHere = !underHeading && labelIndent < 0 && sawBlank && (!item || items.length === 0);
    if (endsHere) {
      break;
    }
    if (item) {
      current = { line: index + 1, parts: [item[2] ?? ''], section: line.section };
      items.push(current);
    } else if (current) {
      current.parts.push(raw);
    } else {
      current = { line: index + 1, parts: [raw], section: line.section };
      items.push(current);
    }
    sawBlank = false;
  }
  return { end: index, items };
}

/**
 * Every Rejected line of a markdown text: a label holding a line, or each
 * item below a label standing alone. Fenced code and tables are not read.
 *
 * @param text - An issue body or a local spec.
 * @returns The lines read, in source order.
 */
export function readRejected(text: string): MarkdownReading[] {
  const lines = proseLines(text);
  const readings: MarkdownReading[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lineAt(lines, index);
    const raw = line.raw;
    const heading = line.headingLevel > 0
      ? HEADING_LABEL.test(line.section ?? '')
      : false;
    const item = LIST_ITEM.exec(raw);
    const rest = line.headingLevel > 0 || TABLE_ROW.test(raw)
      ? undefined
      : afterRejectedLabel(item
        ? item[2] ?? ''
        : raw);
    if (!heading && rest === undefined) {
      index += 1;
      continue;
    }
    if (rest !== undefined && rest !== '') {
      const parts = [rest];
      let next = index + 1;
      while (next < lines.length && !isBreak(lineAt(lines, next)) && !isBoldOnly(lineAt(lines, next).raw)) {
        parts.push(lineAt(lines, next).raw);
        next += 1;
      }
      readings.push({ line: index + 1, section: line.section, text: oneLine(parts), title: null });
      index = next;
      continue;
    }
    const labelIndent = item
      ? (item[1] ?? '').length
      : -1;
    const block = readBlock(lines, index + 1, labelIndent, heading);
    for (const found of block.items) {
      const joined = oneLine(found.parts);
      const inner = afterRejectedLabel(joined);
      const text = inner === undefined || inner === ''
        ? joined
        : inner;
      readings.push({ line: found.line, section: found.section, text, title: null });
    }
    index = block.end;
  }
  return readings;
}

/**
 * Splits a tenet list item into its bold lead and the rest.
 *
 * @param content - The item's text, its marker dropped.
 * @returns The title (the bold lead, closing period dropped, or the whole
 *   item) and the text.
 */
function tenetFromItem(content: string): { title: string; text: string } {
  const lead = boldLead(content.trim());
  if (!lead) {
    return { text: content.trim(), title: content.trim().replace(/\.$/, '') };
  }
  const title = lead.inner.trim().replace(/[.:]$/, '');
  const rest = lead.after.trim();
  return { text: rest === ''
    ? title
    : rest, title };
}

/**
 * The tenets a markdown text names: the comma-separated items after the
 * colon of a line that names the tenets, or each list item below such a
 * line when it ends in its colon.
 *
 * @param text - A tenet issue's body.
 * @returns The tenets read, in source order.
 */
export function readTenets(text: string): MarkdownReading[] {
  const lines = proseLines(text);
  const readings: MarkdownReading[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const { raw, section } = lineAt(lines, index);
    const word = TENET_WORD.exec(raw);
    const colon = word
      ? raw.indexOf(':', word.index)
      : -1;
    if (!word || colon < 0 || lineAt(lines, index).headingLevel > 0) {
      continue;
    }
    const after = raw.slice(colon + 1).trim();
    if (after !== '') {
      for (const part of after.split(/[,;]\s*/)) {
        const tenet = part
          .replace(/^and\s+/i, '')
          .replace(/\.$/, '')
          .trim();
        if (tenet !== '') {
          readings.push({ line: index + 1, section, text: tenet, title: tenet });
        }
      }
      continue;
    }
    const block = readBlock(lines, index + 1, -1, false);
    for (const found of block.items) {
      const { title, text: body } = tenetFromItem(oneLine(found.parts));
      readings.push({ line: found.line, section: found.section, text: body, title });
    }
  }
  return readings;
}

/**
 * Splits a line of prose into sentences: at `.`, `!` or `?` followed by a
 * blank and a capital, a backtick, a bold mark or a parenthesis, never
 * inside a code span.
 *
 * @param text - One line of prose.
 * @returns The sentences, trimmed.
 */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let inCode = false;
  let begin = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '`') {
      inCode = !inCode;
      continue;
    }
    const closes = !inCode && (char === '.' || char === '!' || char === '?');
    const next = text.slice(index + 1);
    if (closes && /^\*{0,2}\s+[A-Z`*(]/.test(next)) {
      const stars = /^\*{0,2}/.exec(next)?.[0].length ?? 0;
      sentences.push(text.slice(begin, index + 1 + stars).trim());
      begin = index + 1 + stars;
    }
  }
  const tail = text.slice(begin).trim();
  if (tail !== '') {
    sentences.push(tail);
  }
  return sentences;
}

/**
 * The rule statements of a context page: each sentence of a paragraph or
 * list item that says `never`, `always` or `must` outside a code span, and
 * each bold lead of six words or more that ends in a period.
 *
 * @param text - A context page.
 * @returns The rules read, in source order.
 */
export function readRules(text: string): MarkdownReading[] {
  const lines = proseLines(text);
  const readings: MarkdownReading[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lineAt(lines, index);
    if (line.raw.trim() === '' || line.headingLevel > 0 || TABLE_ROW.test(line.raw)) {
      index += 1;
      continue;
    }
    const item = LIST_ITEM.exec(line.raw);
    const parts = [item
      ? item[2] ?? ''
      : line.raw];
    let next = index + 1;
    while (next < lines.length && !isBreak(lineAt(lines, next))) {
      parts.push(lineAt(lines, next).raw);
      next += 1;
    }
    const block = oneLine(parts);
    const leadText = boldLead(block)?.inner.trim() ?? '';
    const leadIsRule = leadText.endsWith('.') && leadText.split(/\s+/).length >= RULE_LEAD_WORDS;
    const sentences = splitSentences(block);
    sentences.forEach((sentence, position) => {
      const isLead = position === 0 && leadIsRule;
      if (isLead || RULE_WORD.test(sentence.replace(CODE_SPAN, ''))) {
        readings.push({ line: index + 1, section: line.section, text: sentence, title: null });
      }
    });
    index = next;
  }
  return readings;
}

/**
 * Orders sources: issues by number, then local specs, then context pages,
 * each by path and line.
 */
function compareSources(left: DecisionSource, right: DecisionSource): number {
  const kind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
  if (kind !== 0) {
    return kind;
  }
  if (left.kind === 'issue') {
    const byNumber = Number(left.ref.slice(1)) - Number(right.ref.slice(1));
    if (byNumber !== 0) {
      return byNumber;
    }
  }
  return compareText(left.ref, right.ref) || left.line - right.line;
}

/**
 * Orders two sorted source lists source by source, a shorter list first
 * when one is the other's start.
 */
function compareSourceLists(left: readonly DecisionSource[], right: readonly DecisionSource[]): number {
  for (const [index, source] of left.entries()) {
    const other = right[index];
    if (other === undefined) {
      return 1;
    }
    const order = compareSources(source, other);
    if (order !== 0) {
      return order;
    }
  }
  return left.length - right.length;
}

/**
 * Collects every decision from the sources passed in, one decision per
 * kind and key with all its sources. Pure.
 *
 * @param input - The issues, the local specs (or `undefined`) and the context pages.
 * @returns The collection, every list sorted.
 */
export function collectDecisions(input: DecisionSourcesInput): DecisionSources {
  const found = new Map<string, { kind: DecisionKind; text: string; title: string | null; sources: DecisionSource[] }>();
  const add = (kind: DecisionKind, reading: MarkdownReading, source: Omit<DecisionSource, 'line' | 'section'>): void => {
    const keyText = kind === 'tenet' && reading.title !== null
      ? `${reading.title}\n${reading.text}`
      : reading.text;
    const key = `${kind}\0${decisionKey(keyText)}`;
    const entry = found.get(key) ?? { kind, sources: [], text: reading.text, title: reading.title };
    entry.sources.push({ ...source, line: reading.line, section: reading.section });
    found.set(key, entry);
  };
  const issues = [...input.issues].sort((left, right) => left.number - right.number);
  for (const issue of issues) {
    const ref = `#${issue.number}`;
    if (TENET_ISSUES.includes(issue.number)) {
      readTenets(issue.body).forEach((reading) => add('tenet', reading, { kind: 'issue', ref }));
    }
    readRejected(issue.body).forEach((reading) => add('rejected', reading, { kind: 'issue', ref }));
  }
  const localSpecs = input.localSpecs === undefined
    ? undefined
    : [...input.localSpecs].sort((left, right) => compareText(left.path, right.path));
  for (const spec of localSpecs ?? []) {
    readRejected(spec.text).forEach((reading) => add('rejected', reading, { kind: 'local-spec', ref: spec.path }));
  }
  const pages = [...input.contextPages].sort((left, right) => compareText(left.path, right.path));
  for (const page of pages) {
    readRules(page.text).forEach((reading) => add('rule', reading, { kind: 'context', ref: page.path }));
  }
  const decisions = [...found.values()]
    .map((entry) => ({ ...entry, sources: [...entry.sources].sort(compareSources) }))
    .sort((left, right) => compareText(left.kind, right.kind)
      || compareSourceLists(left.sources, right.sources)
      || compareText(decisionKey(left.text), decisionKey(right.text)));
  const readNumbers = new Set(issues.map((issue) => issue.number));
  return {
    contextPages: pages.map((page) => page.path),
    decisions,
    issues: issues.map((issue) => ({ number: issue.number, title: issue.title })),
    localSpecs: localSpecs === undefined
      ? null
      : localSpecs.map((spec) => spec.path),
    tenetIssues: TENET_ISSUES.map((number) => ({ number, read: readNumbers.has(number) })),
  };
}

/**
 * The collection as `docs/survey/decision-sources.json` holds it.
 *
 * @param sources - The collection.
 * @returns The JSON text, keys sorted, two-space indent.
 */
export function renderDecisionSourcesJson(sources: DecisionSources): string {
  return stableJson(sources);
}

/** A source as the summary names it: `#598:158` or `context/cli.md:40`. */
function sourceLabel(source: DecisionSource): string {
  return `\`${source.ref}:${source.line}\``;
}

/** The sources of a decision, comma-separated. */
function sourcesLabel(decision: Decision): string {
  return decision.sources.map(sourceLabel).join(', ');
}

/**
 * The line saying which local specs were read.
 *
 * @param localSpecs - The paths read, or `null` when the folder is absent.
 * @returns One line of markdown.
 */
function localSpecsLine(localSpecs: readonly string[] | null): string {
  if (localSpecs === null) {
    return `Local specs: none, \`${LOCAL_SPECS_DIR}/\` is absent.`;
  }
  if (localSpecs.length === 0) {
    return `Local specs: none, \`${LOCAL_SPECS_DIR}/\` holds no markdown file.`;
  }
  return `Local specs: ${localSpecs.length} read, ${localSpecs.map((path) => `\`${path}\``).join(', ')}.`;
}

/**
 * The summary `docs/survey/decision-sources.md` holds: the coverage line,
 * what was read, then the tenets, the Rejected lines and the context rules
 * by page, each with its sources.
 *
 * @param sources - The collection.
 * @param trackedPages - The pages `git ls-files` lists under `context/`.
 * @returns The markdown text.
 */
export function renderDecisionSourcesMarkdown(sources: DecisionSources, trackedPages: readonly string[]): string {
  const ofKind = (kind: DecisionKind): Decision[] => sources.decisions.filter((decision) => decision.kind === kind);
  const tenets = ofKind('tenet');
  const rejected = ofKind('rejected');
  const rules = ofKind('rule');
  const missingTenets = sources.tenetIssues.filter((issue) => !issue.read).map((issue) => `#${issue.number}`);
  const issueLine = `Issues: ${sources.issues.length} \`type:spec\` bodies read. Tenets from ${TENET_ISSUES.map((n) => `#${n}`).join(' and ')}${missingTenets.length === 0
    ? '.'
    : `; not read: ${missingTenets.join(', ')}.`}`;
  const lines = [
    '# Decision sources',
    '',
    coverageLine(sources.contextPages, trackedPages, `${CONTEXT_DIR}/`),
    '',
    issueLine,
    '',
    localSpecsLine(sources.localSpecs),
    '',
    `Decisions: ${tenets.length} tenets, ${rejected.length} Rejected lines, ${rules.length} context rules. A line read in more than one place is listed once with every source.`,
    '',
    '## Tenets',
    '',
    ...tenets.map((tenet) => `- **${tenet.title ?? tenet.text}**${tenet.text === tenet.title
      ? ''
      : ` ${tenet.text}`} (${sourcesLabel(tenet)})`),
    '',
    '## Rejected',
    '',
    ...rejected.map((decision) => `- ${decision.text} (${sourcesLabel(decision)})`),
    '',
    '## Context rules',
  ];
  for (const page of sources.contextPages) {
    const onPage = rules.filter((rule) => rule.sources.some((source) => source.ref === page));
    lines.push('', `### \`${page}\` (${onPage.length})`, '');
    lines.push(...onPage.map((rule) => `- ${rule.text} (${sourcesLabel(rule)})`));
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

/**
 * Lists the markdown pages git tracks directly under `context/`.
 *
 * @param root - The repository's root folder.
 * @returns The repository-relative paths, sorted.
 * @throws When `git ls-files` cannot run or exits non-zero.
 */
export function listTrackedPages(root: string): string[] {
  const result = Bun.spawnSync(['git', 'ls-files', '-z', '--', CONTEXT_DIR], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ls-files failed in ${root} (exit ${result.exitCode}): ${result.stderr.toString().trim()}`);
  }
  return result.stdout
    .toString()
    .split('\0')
    .filter((path) => /^context\/[^/]+\.md$/.test(path))
    .sort();
}

/**
 * Reads the markdown files of a folder, below it at any depth.
 *
 * @param root - The repository's root folder.
 * @param dir - The folder, repository-relative.
 * @param recursive - `true` to read subfolders too.
 * @returns The files, or `undefined` when the folder is absent.
 */
async function readMarkdownDir(root: string, dir: string, recursive: boolean): Promise<MarkdownFile[] | undefined> {
  const full = join(root, dir);
  if (!existsSync(full)) {
    return undefined;
  }
  const names = readdirSync(full, { encoding: 'utf8', recursive, withFileTypes: false })
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.split('\\').join('/'))
    .sort();
  const files: MarkdownFile[] = [];
  for (const name of names) {
    const path = `${dir}/${name}`;
    files.push({ path, text: await Bun.file(join(root, path)).text() });
  }
  return files;
}

/**
 * Checks that a parsed value is a list of issue bodies.
 *
 * @param value - Parsed JSON.
 * @param origin - Where it came from, for the error.
 * @returns The issues.
 * @throws When an entry lacks a numeric `number` or a string `title` or `body`.
 */
export function parseIssues(value: unknown, origin: string): IssueBody[] {
  if (!Array.isArray(value)) {
    throw new Error(`${origin}: expected a JSON array of issues`);
  }
  return value.map((entry: unknown, index) => {
    const issue = entry as Partial<IssueBody> | null;
    if (typeof issue?.number !== 'number' || typeof issue.title !== 'string' || typeof issue.body !== 'string') {
      throw new Error(`${origin}: entry ${index} needs a numeric number and a string title and body`);
    }
    return { body: issue.body, number: issue.number, title: issue.title };
  });
}

/**
 * Runs one `gh` read and parses its JSON.
 *
 * @param root - The repository's root folder.
 * @param args - The arguments after `gh`.
 * @returns The parsed output.
 * @throws When `gh` exits non-zero.
 */
function ghJson(root: string, args: readonly string[]): unknown {
  const result = Bun.spawnSync(['gh', ...args], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`gh ${args.join(' ')} failed (exit ${result.exitCode}): ${result.stderr.toString().trim()}`);
  }
  return JSON.parse(result.stdout.toString());
}

/**
 * Fetches every `type:spec` issue body through `gh`, open and closed, and
 * each tenet issue the label does not reach.
 *
 * @param root - The repository's root folder.
 * @returns The issues.
 * @throws When `gh` fails, or when the list fills `ISSUE_LIMIT` and may be cut short.
 */
export function fetchSpecIssues(root: string): IssueBody[] {
  const listed = parseIssues(ghJson(root, [
    'issue',
    'list',
    '--label',
    'type:spec',
    '--state',
    'all',
    '--limit',
    String(ISSUE_LIMIT),
    '--json',
    'number,title,body',
  ]), 'gh issue list');
  if (listed.length >= ISSUE_LIMIT) {
    throw new Error(`gh issue list returned ${listed.length} issues, the limit; raise ISSUE_LIMIT`);
  }
  const numbers = new Set(listed.map((issue) => issue.number));
  const tenets = TENET_ISSUES
    .filter((number) => !numbers.has(number))
    .flatMap((number) => parseIssues([ghJson(root, ['issue', 'view', String(number), '--json', 'number,title,body'])], `gh issue view ${number}`));
  return [...listed, ...tenets];
}

/**
 * Reads the sources, collects the decisions and writes both outputs.
 *
 * @param root - The repository's root folder.
 * @param issues - The issues to read; fetched through `gh` when left out.
 * @returns The paths written, repository-relative.
 */
export async function main(root: string, issues?: readonly IssueBody[]): Promise<string[]> {
  const trackedPages = listTrackedPages(root);
  const contextPages = await readMarkdownDir(root, CONTEXT_DIR, false) ?? [];
  const localSpecs = await readMarkdownDir(root, LOCAL_SPECS_DIR, true);
  const sources = collectDecisions({ contextPages, issues: issues ?? fetchSpecIssues(root), localSpecs });
  mkdirSync(join(root, OUTPUT_DIR), { recursive: true });
  const jsonPath = `${OUTPUT_DIR}/decision-sources.json`;
  const markdownPath = `${OUTPUT_DIR}/decision-sources.md`;
  writeFileSync(join(root, jsonPath), renderDecisionSourcesJson(sources));
  writeFileSync(join(root, markdownPath), renderDecisionSourcesMarkdown(sources, trackedPages));
  return [jsonPath, markdownPath];
}

if (import.meta.main) {
  try {
    const flag = process.argv.slice(2).find((arg) => arg.startsWith('--issues='));
    const issues = flag === undefined
      ? undefined
      : parseIssues(await Bun.file(flag.slice('--issues='.length)).json(), flag);
    for (const path of await main(process.cwd(), issues)) {
      console.log(`wrote ${path}`);
    }
  } catch (err) {
    console.error(err instanceof Error
      ? err.message
      : String(err));
    process.exit(1);
  }
}
