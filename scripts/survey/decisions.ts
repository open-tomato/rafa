/**
 * The decisions rafa already stands on, in the words they were written in:
 * `bun scripts/survey/decisions.ts` from the repository root writes
 * `.rafa/survey/decision-sources.json` and `.rafa/survey/decision-sources.md`
 * through `survey-io.ts`. rafa writes its decisions in specs, not ADRs, so
 * this is the input the guideline sheet is drafted from. It collects; it
 * never judges whether two lines mean the same thing.
 *
 * ## Sources
 *
 * - The spec bodies: every row of the board cache, `.rafa/cache/board.json`,
 *   labelled `type:spec`. A worktree keeps no board cache of its own:
 *   `--board <path>` reads another checkout's, as `provenance.ts` does.
 * - The tracked `context/*.md` pages.
 *
 * ## What is read
 *
 * - A TENET LINE ({@link readTenetLines}), from specs and pages: a line
 *   naming the word `tenet`. When the words before its last colon name the
 *   tenets, the list after it gives one tenet per item (#598's "a
 *   shortener of commands, …"); when the line ends in a colon, the list
 *   below gives one tenet per item, an item's bold lead as its title
 *   (#754's "**Never block.** …"). Any other tenet line is kept whole,
 *   with no items.
 * - A REJECTED SECTION ({@link readRejectedSections}), from specs and
 *   pages: a label {@link REJECTED_LABEL} (`Rejected`, `Rejected
 *   alternatives`, `Rejected for now`, `Alternatives rejected`, …) as a
 *   heading, in bold, or plain with its colon, alone or behind a list
 *   marker. A heading takes every list item and paragraph up to the next
 *   heading of its level or above; a label standing alone takes the list
 *   or the paragraph below it; a label with text after it is one entry,
 *   its wrapped lines joined. Prose that only uses the word ("fuzzy
 *   matching is rejected") is not read.
 * - A CONTEXT RULE ({@link readContextRules}), from pages only: each
 *   sentence of a paragraph or list item saying `never`, `always` or
 *   `must` outside a code span, and each bold lead of
 *   {@link MIN_LEAD_WORDS} words or more closing on a period, read once
 *   (the sentences after a lead are read for the words). A rule written
 *   with none of those shapes is missed by design; the guideline sheet
 *   infers it.
 *
 * Fenced code and table rows are never read. Every reading carries its
 * source (`#<number>` or the page's path), its 1-based line and the
 * nearest heading above it.
 *
 * ## Coverage
 *
 * The coverage line counts the context pages read against the ones
 * `git ls-files` lists. The spec bodies are not tracked files, so the
 * summary counts them apart: the board rows, the `type:spec` rows read,
 * and each spec with no rejected section, by number.
 */
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

import { readTextFiles } from './concepts.js';
import { boardArgument, BOARD_CACHE_PATH } from './provenance.js';
import { listTrackedFiles, measureCoverage, writeSurvey } from './survey-io.js';

/** The survey name the outputs carry. */
export const SURVEY_NAME = 'decision-sources';

/** The folder of the context pages, relative to the repository root. */
export const CONTEXT_DIR = 'context';

/** The label a board row carries when it is a spec. */
export const SPEC_LABEL = 'type:spec';

/** The words a rejected section's label is spelled with. */
export const REJECTED_LABEL = String.raw`(?:Rejected(?:\s+(?:alternatives?|for\s+now|names|options|approaches))?|Alternatives\s+rejected)`;

/** The fewest words a bold lead holds to read as a rule. */
export const MIN_LEAD_WORDS = 6;

/** The word a tenet line names. */
const TENET_WORD = /\btenets?\b/i;

/** The words a context rule says. */
const RULE_WORD = /\b(?:never|always|must)\b/i;

/** A fence opening or closing a code block. */
const FENCE = /^\s*(?:```|~~~)/;

/** A table row. */
const TABLE_ROW = /^\s*\|/;

/** A markdown heading. */
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

/** A list item: its indent and its text. */
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

/** A heading naming a rejected section. */
const REJECTED_HEADING = new RegExp(String.raw`^(?:\*\*)?${REJECTED_LABEL}\b`, 'i');

/** A bold label: the bold span opening the line, and the text after it. */
const BOLD_LABEL = new RegExp(String.raw`^\*\*(${REJECTED_LABEL}\b[^*]*)\*\*(.*)$`, 'i');

/** A plain label: it needs its colon, so prose using the word is not read. */
const PLAIN_LABEL = new RegExp(String.raw`^${REJECTED_LABEL}\s*:(.*)$`, 'i');

/** The label words opening a bold span, with the marks after them. */
const LABEL_PREFIX = new RegExp(String.raw`^${REJECTED_LABEL}[\s:.,]*`, 'i');

/** A bold lead opening an item: its bold text and the rest. */
const BOLD_LEAD = /^\*\*([^*]+)\*\*\s*(.*)$/;

/** A code span. */
const CODE_SPAN = /`[^`]*`/g;

/** Where one sentence ends and the next begins. */
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z*`"(])/;

/** One line of a markdown text, as the readers see it. */
export interface MarkdownLine {
  /** The 1-based line number. */
  readonly line: number;
  readonly text: string;
  /** Whether the line is fenced code, a fence or a table row, never read. */
  readonly skipped: boolean;
  /** The nearest heading above the line, or the line's own when it is one; `null` when none. */
  readonly section: string | null;
}

/** One list item or paragraph, its lines joined. */
export interface Block {
  /** The 1-based line it starts on. */
  readonly line: number;
  readonly text: string;
  /** Whether it is a list item. */
  readonly item: boolean;
}

/** Where a reading sits: a spec as `#<number>`, a page by its path. */
export interface SourceRef {
  readonly ref: string;
  readonly line: number;
  readonly section: string | null;
}

/** One tenet a tenet line lists. */
export interface TenetItem {
  /** Its bold lead, a closing period left out, or `null`. */
  readonly title: string | null;
  readonly text: string;
}

/** A line naming the project's tenets. */
export interface TenetLine extends SourceRef {
  readonly text: string;
  /** The tenets it lists, empty when it lists none. */
  readonly items: readonly TenetItem[];
}

/** One rejected alternative. */
export interface RejectedEntry {
  readonly line: number;
  readonly text: string;
}

/** A rejected section: its label and the entries it holds. */
export interface RejectedSection extends SourceRef {
  /** The label as written, its marks left out. */
  readonly label: string;
  readonly entries: readonly RejectedEntry[];
}

/** One rule a context page states. */
export interface ContextRule extends SourceRef {
  /** `word` for a sentence saying never, always or must; `lead` for a bold lead. */
  readonly shape: 'word' | 'lead';
  readonly text: string;
}

/** One spec body from the board cache. */
export interface SpecBody {
  readonly number: number;
  readonly title: string;
  readonly body: string;
}

/** A markdown text and the reference its readings carry. */
export interface SourceText {
  readonly ref: string;
  readonly text: string;
}

/** The reading written under `data` in `decision-sources.json`. */
export interface DecisionSourcesData {
  /** How many rows the board cache holds. */
  readonly boardRows: number;
  /** The specs read, by number, with their titles. */
  readonly specs: readonly { readonly number: number; readonly title: string }[];
  /** The context pages read, sorted. */
  readonly pages: readonly string[];
  readonly tenetLines: readonly TenetLine[];
  readonly rejected: readonly RejectedSection[];
  readonly rules: readonly ContextRule[];
  /** The specs holding no rejected section, by number. */
  readonly specsWithoutRejected: readonly number[];
}

/** Lines joined into one, runs of blanks folded. */
function oneLine(parts: readonly string[]): string {
  return parts
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The lines of `markdown`, each with whether it is read and its section. */
export function markdownLines(markdown: string): MarkdownLine[] {
  let fenced = false;
  let section: string | null = null;
  const texts = markdown
    .replace(/\r\n?/g, '\n')
    .split('\n');
  return texts.map((text, index) => {
    const fence = FENCE.test(text);
    if (fence) {
      fenced = !fenced;
    }
    const skipped = fence || fenced || TABLE_ROW.test(text);
    const heading = skipped
      ? null
      : HEADING.exec(text);
    if (heading !== null) {
      section = heading[2] ?? '';
    }
    return { line: index + 1, text, skipped, section };
  });
}

/** Whether `line` ends a block: blank, skipped or a heading. */
function endsBlock(line: MarkdownLine): boolean {
  return line.skipped || line.text.trim().length === 0 || HEADING.test(line.text);
}

/** The indent of a list item line, or `null` for any other line. */
function itemIndent(line: MarkdownLine | undefined): number | null {
  if (line === undefined || endsBlock(line)) {
    return null;
  }
  const match = LIST_ITEM.exec(line.text);
  return match === null
    ? null
    : (match[1] ?? '').length;
}

/** The index of the first line from `from` that is not blank or skipped, or `lines.length`. */
function nextContent(lines: readonly MarkdownLine[], from: number): number {
  let at = from;
  while (at < lines.length && (lines[at]?.skipped === true || lines[at]?.text.trim().length === 0)) {
    at += 1;
  }
  return at;
}

/**
 * The lines from `from` that continue the block opened on the line
 * before it: up to the next blank, skipped or heading line, or the next
 * list item at `stopIndent` or less. Returns their texts and the index
 * after them.
 */
function continuation(lines: readonly MarkdownLine[], from: number, stopIndent: number | null): { texts: string[]; next: number } {
  const texts: string[] = [];
  let at = from;
  for (; at < lines.length; at += 1) {
    const line = lines[at];
    if (line === undefined || endsBlock(line)) {
      break;
    }
    const indent = itemIndent(line);
    if (indent !== null && (stopIndent === null || indent <= stopIndent)) {
      break;
    }
    texts.push(line.text.trim());
  }
  return { texts, next: at };
}

/**
 * The block starting at `lines[start]`, which is neither blank, skipped
 * nor a heading: a list item, its wrapped lines and deeper items joined,
 * or a paragraph. Returns the block and the index after it.
 */
function readBlock(lines: readonly MarkdownLine[], start: number): { block: Block; next: number } {
  const first = lines[start];
  const indent = itemIndent(first);
  const opening = indent === null
    ? (first?.text ?? '')
    : (LIST_ITEM.exec(first?.text ?? '')?.[2] ?? '');
  const rest = continuation(lines, start + 1, indent ?? -1);
  return {
    block: { line: first?.line ?? 0, text: oneLine([opening, ...rest.texts]), item: indent !== null },
    next: rest.next,
  };
}

/**
 * The list below `lines[from]`, blank lines skipped first, one block per
 * item at the first item's indent, or the paragraph there as one block.
 * Stops at a heading, at a list item less indented than the first, and
 * at a blank line no item at that indent follows.
 */
function blocksBelow(lines: readonly MarkdownLine[], from: number): Block[] {
  let at = nextContent(lines, from);
  const firstIndent = itemIndent(lines[at]);
  if (at >= lines.length || HEADING.test(lines[at]?.text ?? '')) {
    return [];
  }
  if (firstIndent === null) {
    return [readBlock(lines, at).block];
  }
  const blocks: Block[] = [];
  while (itemIndent(lines[at]) === firstIndent) {
    const read = readBlock(lines, at);
    blocks.push(read.block);
    const after = nextContent(lines, read.next);
    at = itemIndent(lines[after]) === firstIndent
      ? after
      : read.next;
  }
  return blocks;
}

/** Every block from `from` up to the first heading of `level` or above. */
function blocksUntilHeading(lines: readonly MarkdownLine[], from: number, level: number): Block[] {
  const blocks: Block[] = [];
  let at = nextContent(lines, from);
  while (at < lines.length) {
    const heading = HEADING.exec(lines[at]?.text ?? '');
    if (heading !== null) {
      if ((heading[1] ?? '').length <= level) {
        break;
      }
      at = nextContent(lines, at + 1);
      continue;
    }
    const read = readBlock(lines, at);
    blocks.push(read.block);
    at = nextContent(lines, read.next);
  }
  return blocks;
}

/** The text of a line read, its list marker left out. */
function itemText(text: string): string {
  return (LIST_ITEM.exec(text)?.[2] ?? text).trim();
}

/** The tenets a list item names: its bold lead as the title, the rest as the text. */
function tenetItem(text: string): TenetItem {
  const lead = BOLD_LEAD.exec(text);
  return lead === null
    ? { title: null, text }
    : { title: (lead[1] ?? '').trim().replace(/[.:]$/, ''), text: (lead[2] ?? '').trim() };
}

/** `text` split at each `separator` outside parentheses. */
function splitOutsideParentheses(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    depth += char === '('
      ? 1
      : char === ')'
        ? -1
        : 0;
    current += char;
    const cut = depth === 0
      ? separator.exec(current)
      : null;
    if (cut !== null) {
      parts.push(current.slice(0, cut.index));
      current = '';
    }
  }
  return [...parts, current];
}

/**
 * The items of a list written as prose: split at each comma outside
 * parentheses, a leading `and` and a closing period left out; a list of
 * one item is split at its `and` instead.
 */
export function listItems(text: string): string[] {
  const byComma = splitOutsideParentheses(text, /,$/);
  const parts = byComma.length > 1
    ? byComma
    : splitOutsideParentheses(text, /\sand\s$/);
  return parts
    .map((part) => part
      .trim()
      .replace(/^and\s+/i, '')
      .replace(/\.$/, '')
      .trim())
    .filter((part) => part.length > 0);
}

/** The tenet lines of one markdown source. */
export function readTenetLines(source: SourceText): TenetLine[] {
  const lines = markdownLines(source.text);
  return lines.flatMap((line, index) => {
    if (line.skipped || !TENET_WORD.test(line.text)) {
      return [];
    }
    const text = itemText(line.text.replace(/^\s*#{1,6}\s+/, ''));
    const plain = text.replace(/\*\*/g, '');
    const colon = plain.lastIndexOf(':');
    const items = plain.endsWith(':')
      ? blocksBelow(lines, index + 1)
        .filter((block) => block.item)
        .map((block) => tenetItem(block.text))
      : colon > 0 && TENET_WORD.test(plain.slice(0, colon))
        ? listItems(plain.slice(colon + 1)).map((item) => ({ title: null, text: item }))
        : [];
    return [{ ref: source.ref, line: line.line, section: line.section, text, items }];
  });
}

/** A label line's label as written and the text after it, or `null` when the line holds no label. */
function labelOf(text: string): { label: string; after: string } | null {
  const bold = BOLD_LABEL.exec(text);
  if (bold !== null) {
    const inner = bold[1] ?? '';
    const label = LABEL_PREFIX.exec(inner)?.[0] ?? inner;
    return { label: label.replace(/[\s:.,]+$/, ''), after: oneLine([inner.slice(label.length), bold[2] ?? '']).replace(/^[:.,]\s*/, '') };
  }
  const plain = PLAIN_LABEL.exec(text);
  return plain === null
    ? null
    : { label: text.slice(0, text.indexOf(':')).trim(), after: (plain[1] ?? '').trim() };
}

/** The rejected sections of one markdown source. */
export function readRejectedSections(source: SourceText): RejectedSection[] {
  const lines = markdownLines(source.text);
  const sections: RejectedSection[] = [];
  let at = 0;
  while (at < lines.length) {
    const line = lines[at];
    if (line === undefined || line.skipped) {
      at += 1;
      continue;
    }
    const heading = HEADING.exec(line.text);
    const where = { ref: source.ref, line: line.line, section: line.section };
    if (heading !== null) {
      const title = heading[2] ?? '';
      if (REJECTED_HEADING.test(title)) {
        const entries = blocksUntilHeading(lines, at + 1, (heading[1] ?? '').length);
        sections.push({ ...where, label: title.replace(/\*\*/g, ''), entries: entries.map(({ line: entryLine, text }) => ({ line: entryLine, text })) });
      }
      at += 1;
      continue;
    }
    const found = labelOf(itemText(line.text));
    if (found === null) {
      at += 1;
      continue;
    }
    if (found.after.length === 0) {
      const entries = blocksBelow(lines, at + 1);
      sections.push({ ...where, label: found.label, entries: entries.map(({ line: entryLine, text }) => ({ line: entryLine, text })) });
      at += 1;
      continue;
    }
    const rest = continuation(lines, at + 1, itemIndent(line) ?? -1);
    sections.push({ ...where, label: found.label, entries: [{ line: line.line, text: oneLine([found.after, ...rest.texts]) }] });
    at = rest.next;
  }
  return sections;
}

/** The context rules of one page. */
export function readContextRules(page: SourceText): ContextRule[] {
  const lines = markdownLines(page.text);
  return blocksUntilHeading(lines, 0, 0).flatMap((block) => {
    const where = { ref: page.ref, line: block.line, section: lines[block.line - 1]?.section ?? null };
    const bold = BOLD_LEAD.exec(block.text);
    const lead = bold?.[1]?.trim() ?? '';
    const isLead = lead.endsWith('.') && lead.split(/\s+/).length >= MIN_LEAD_WORDS;
    const leads: ContextRule[] = isLead
      ? [{ ...where, shape: 'lead', text: lead }]
      : [];
    const rest = isLead
      ? (bold?.[2] ?? '')
      : block.text;
    const words: ContextRule[] = rest
      .split(SENTENCE_BREAK)
      .filter((sentence) => RULE_WORD.test(sentence.replace(CODE_SPAN, '')))
      .map((sentence) => ({ ...where, shape: 'word', text: sentence.trim() }));
    return [...leads, ...words];
  });
}

/** A JSON value as a record, or `null`. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Whether a board row carries `label`. */
function hasLabel(row: Record<string, unknown>, label: string): boolean {
  return Array.isArray(row.labels) && row.labels.some((entry) => asRecord(entry)?.name === label);
}

/**
 * The spec bodies of a board cache's JSON, by number, and how many rows
 * it holds. Throws when it holds no `rows` list.
 */
export function parseSpecBodies(json: unknown): { rows: number; specs: SpecBody[] } {
  const rows = asRecord(json)?.rows;
  if (!Array.isArray(rows)) {
    throw new Error('the board cache holds no rows list');
  }
  const specs = rows.flatMap((value): SpecBody[] => {
    const row = asRecord(value);
    if (row === null || typeof row.number !== 'number' || !hasLabel(row, SPEC_LABEL)) {
      return [];
    }
    return [{
      number: row.number,
      title: typeof row.title === 'string'
        ? row.title
        : '',
      body: typeof row.body === 'string'
        ? row.body
        : '',
    }];
  });
  return { rows: rows.length, specs: specs.sort((a, b) => a.number - b.number) };
}

/** The reading of the spec bodies and the context pages. */
export function readDecisionSources(
  board: { rows: number; specs: readonly SpecBody[] },
  pages: readonly SourceText[],
): DecisionSourcesData {
  const sortedPages = [...pages].sort((a, b) => a.ref.localeCompare(b.ref));
  const specSources = board.specs.map((spec) => ({ ref: `#${spec.number}`, text: spec.body }));
  const sources = [...specSources, ...sortedPages];
  const rejected = sources.flatMap(readRejectedSections);
  const withRejected = new Set(rejected.map((section) => section.ref));
  return {
    boardRows: board.rows,
    specs: board.specs.map(({ number, title }) => ({ number, title })),
    pages: sortedPages.map((page) => page.ref),
    tenetLines: sources.flatMap(readTenetLines),
    rejected,
    rules: sortedPages.flatMap(readContextRules),
    specsWithoutRejected: board.specs.map((spec) => spec.number).filter((number) => !withRejected.has(`#${number}`)),
  };
}

/** Where a reading sits, as the summary writes it. */
function at(source: SourceRef): string {
  return `\`${source.ref}:${source.line}\``;
}

/** The markdown summary's body, written after the coverage line. */
export function renderDecisionSources(data: DecisionSourcesData): string {
  const entries = data.rejected.reduce((count, section) => count + section.entries.length, 0);
  const titleOf = new Map(data.specs.map((spec) => [`#${spec.number}`, spec.title]));
  return [
    '# Decision sources',
    '',
    `Specs: ${data.specs.length} \`${SPEC_LABEL}\` bodies read of ${data.boardRows} board rows. `
      + `Context pages: ${data.pages.length}.`,
    '',
    `Read: ${data.tenetLines.length} tenet lines, ${data.rejected.length} rejected sections holding ${entries} `
      + `entries, ${data.rules.length} context rules. Each is listed as written with its source line; two lines `
      + 'saying the same thing are both listed, and the guideline sheet makes them one.',
    '',
    '## Tenet lines',
    '',
    ...data.tenetLines.flatMap((tenet) => [
      `- ${tenet.text} (${at(tenet)})`,
      ...tenet.items.map((item) => `  - ${item.title === null
        ? item.text
        : `**${item.title}** ${item.text}`.trim()}`),
    ]),
    '',
    '## Rejected sections',
    '',
    ...data.rejected.flatMap((section) => [
      `### ${section.label} (${at(section)}${titleOf.has(section.ref)
        ? `, ${titleOf.get(section.ref)}`
        : ''})`,
      '',
      ...(section.entries.length === 0
        ? ['- (no entry below the label)']
        : section.entries.map((entry) => `- ${entry.text} (line ${entry.line})`)),
      '',
    ]),
    `Specs with no rejected section: ${data.specsWithoutRejected.length === 0
      ? 'none'
      : data.specsWithoutRejected.map((number) => `#${number}`).join(', ')}`,
    '',
    '## Context rules',
    '',
    ...data.pages.flatMap((page) => {
      const rules = data.rules.filter((rule) => rule.ref === page);
      return rules.length === 0
        ? []
        : [`### \`${page}\``, '', ...rules.map((rule) => `- ${rule.text} (line ${rule.line}, ${rule.shape})`), ''];
    }),
  ].join('\n');
}

/** Reads the board cache at `path`; throws naming how to fill it when it is absent. */
export async function loadSpecBodies(path: string): Promise<{ rows: number; specs: SpecBody[] }> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`${path} is absent: run rafa roadmap to fill the board cache, or pass --board <path>`);
  }
  return parseSpecBodies(await file.json());
}

/** Collects and writes the decision sources of the repository at `repoRoot`. */
export async function surveyDecisions(repoRoot: string, boardPath: string | null = null): Promise<DecisionSourcesData> {
  const realRoot = realpathSync(repoRoot);
  const board = await loadSpecBodies(boardPath ?? join(realRoot, BOARD_CACHE_PATH));
  const pagePaths = (await listTrackedFiles(realRoot, [CONTEXT_DIR])).filter((path) => path.endsWith('.md'));
  if (pagePaths.length === 0) {
    throw new Error(`${CONTEXT_DIR}/ holds no tracked page to read decisions from`);
  }
  const pages = await readTextFiles(realRoot, pagePaths);
  const data = readDecisionSources(board, pages.map((page) => ({ ref: page.path, text: page.text })));
  await writeSurvey(realRoot, SURVEY_NAME, {
    data,
    markdown: renderDecisionSources(data),
    coverage: measureCoverage(pagePaths, pages.map((page) => page.path)),
  });
  return data;
}

if (import.meta.main) {
  try {
    const data = await surveyDecisions(process.cwd(), boardArgument(process.argv.slice(2)));
    console.log(`[decisions] ${data.specs.length} specs and ${data.pages.length} pages: ${data.tenetLines.length} tenet lines, `
      + `${data.rejected.length} rejected sections, ${data.rules.length} context rules`);
  } catch (err) {
    console.error(`[decisions] FAIL — ${err instanceof Error
      ? err.message
      : String(err)}`);
    process.exit(1);
  }
}
