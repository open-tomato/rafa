/**
 * The search answer: the `rafa:search` block the one search session
 * ends its final message with, read out of the session's captured
 * output.
 *
 * ````markdown
 * ```rafa:search
 * matches:
 *   - name: documentation
 *     why: "owns TSDoc blocks and inline comment rules"
 *     quote: "Every exported symbol carries a TSDoc block"
 *     line: 41
 * unanswerable: false
 * ```
 * ````
 *
 * {@link parseSearchBlock} is the whole interface. It takes any string
 * and the candidates' names, never throws, and answers either the
 * matches or an explicit record of why there are none. The runner falls
 * back to the keyword ranking on an absence, so an unreadable answer is
 * a value here, not an exception.
 *
 * ## Which block is read
 *
 * Blocks are found by `readRafaBlocks` (`src/plan/blocks.ts`), under
 * the rules `parseReport` (`src/report/parse.ts`) reads a report by:
 * only the LAST `rafa:search` block counts, an earlier one being a
 * draft or the session quoting the format, and when the last one cannot
 * be read no earlier one is read in its place. Blocks of every other
 * kind are ignored.
 *
 * ## Absence
 *
 * {@link SearchBlockAbsent.reason} says why there is no answer:
 *
 *   - `no-block`: the output holds no `rafa:search` block.
 *   - `unclosed-block`: the last block is never closed. A body cut
 *     short can still be valid YAML with its later matches missing.
 *   - `malformed-block`: the body is not YAML or not a mapping;
 *     `unanswerable` is absent or not a boolean; `matches` is present
 *     and not a list; or `unanswerable: true` comes with matches, an
 *     answer that contradicts itself and is not guessed at.
 *
 * Every reason but `no-block` carries the block, so its raw body can be
 * shown to whoever reads the fallback notice.
 *
 * ## Entries
 *
 * A readable block answers every usable match, in the order written,
 * and one {@link SearchBlockIssue} for each entry it drops. An entry is
 * dropped when it is not a mapping; when `name`, `why` or `quote` is
 * not a non-blank string; when `line` is not a whole number from one
 * up; when its `name` is none of the candidates the session was given,
 * the prompt's rule that code enforces here; or when an earlier entry
 * already named the same candidate. Dropping one entry keeps the rest:
 * one bad match is no reason to throw away the good ones.
 *
 * `matches` absent or null reads as empty. Keys the parser does not
 * know are ignored, at either level. Strings are kept as written, never
 * trimmed: whether a quote occurs in its file is the quote check's
 * reading (`src/inventory/search/quote.ts`), and it normalizes
 * whitespace itself.
 *
 * ## The parser, measured on bun 1.3.14
 *
 * `Bun.YAML.parse` reads the body, with the readings `parseReport`
 * records: an unquoted value holding `: ` throws, a `#` after a space
 * cuts a value short, and `line: "41"` reads as a string, which is
 * refused rather than turned into a number.
 */
import type { RafaBlock } from '../../plan/blocks.js';

import { readRafaBlocks } from '../../plan/blocks.js';

import { SEARCH_BLOCK_FENCE } from './prompt.js';

/** One match the session named, as it wrote it. */
export interface SearchMatch {
  /** The candidate's name, one of the names the parser was given. */
  readonly name: string;
  /** One line on what the file covers that answers the question. */
  readonly why: string;
  /** A sentence the session says it copied from the file. */
  readonly quote: string;
  /** The 1-based line the quote is said to sit on. */
  readonly line: number;
}

/** One `matches` entry that was dropped, and why. */
export interface SearchBlockIssue {
  /** Which entry, in the block's own key names: `matches[2]`. */
  readonly field: string;
  /** One sentence for an operator to read. */
  readonly text: string;
}

/** Why a session output answers no search result. */
export type SearchBlockAbsenceReason = 'no-block' | 'unclosed-block' | 'malformed-block';

/** A session output whose last `rafa:search` block was read. */
export interface SearchBlockPresent {
  readonly present: true;
  /** The usable matches, in the order written. */
  readonly matches: readonly SearchMatch[];
  /** True when the session said no candidate answers the question. */
  readonly unanswerable: boolean;
  /** The block the answer was read from. */
  readonly block: RafaBlock;
  /** One entry per dropped match. Empty for a clean answer. */
  readonly issues: readonly SearchBlockIssue[];
}

/** A session output that answers no search result, and why. */
export interface SearchBlockAbsent {
  readonly present: false;
  /** Why there is no answer. */
  readonly reason: SearchBlockAbsenceReason;
  /** The last `rafa:search` block, raw body included, or null for `no-block`. */
  readonly block: RafaBlock | null;
  /** One sentence for an operator to read. */
  readonly text: string;
}

/** What {@link parseSearchBlock} answers. */
export type SearchBlockReading = SearchBlockPresent | SearchBlockAbsent;

/** A plain mapping, as the parser returns one. */
type Mapping = Readonly<Record<string, unknown>>;

/** The block kind: the fence's info string less its `rafa:` prefix. */
const SEARCH_KIND = SEARCH_BLOCK_FENCE.slice('rafa:'.length);

/** The string fields every match carries. */
const STRING_KEYS = ['name', 'why', 'quote'] as const;

/** True for a mapping; false for a list, a scalar or null. */
function isMapping(value: unknown): value is Mapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

/** A key's own value, looked up by name and never by object index. */
function fieldOf(mapping: Mapping, key: string): unknown {
  return Object.entries(mapping).find(([own]) => own === key)?.[1];
}

/** One absence. */
function absent(
  reason: SearchBlockAbsenceReason,
  block: RafaBlock | null,
  text: string,
): SearchBlockAbsent {
  return { present: false, reason, block, text };
}

/** Why one entry is unusable, or null when it is a match. */
function entryProblem(item: unknown, field: string, names: ReadonlySet<string>): string | null {
  if (!isMapping(item)) return `${field} is ${describeValue(item)}, not a mapping`;
  for (const key of STRING_KEYS) {
    const value = fieldOf(item, key);
    if (typeof value !== 'string' || value.trim().length === 0) {
      return `${field}.${key} is ${describeValue(value)}, not a non-blank string`;
    }
  }
  const line = fieldOf(item, 'line');
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) {
    return `${field}.line is ${describeValue(line)}, not a line number from 1`;
  }
  const name = fieldOf(item, 'name') as string;
  if (!names.has(name)) return `${field}.name ${JSON.stringify(name)} is not a candidate`;
  return null;
}

/** Reads the usable entries of a `matches` list, dropping the rest. */
function readMatches(
  items: readonly unknown[],
  names: ReadonlySet<string>,
): { matches: SearchMatch[]; issues: SearchBlockIssue[] } {
  const matches: SearchMatch[] = [];
  const issues: SearchBlockIssue[] = [];
  for (const [index, item] of items.entries()) {
    const field = `matches[${index}]`;
    const problem = entryProblem(item, field, names);
    if (problem !== null) {
      issues.push({ field, text: `${problem}; dropped` });
      continue;
    }
    const entry = item as Mapping;
    const match: SearchMatch = {
      name: fieldOf(entry, 'name') as string,
      why: fieldOf(entry, 'why') as string,
      quote: fieldOf(entry, 'quote') as string,
      line: fieldOf(entry, 'line') as number,
    };
    if (matches.some((earlier) => earlier.name === match.name)) {
      issues.push({ field, text: `${field} names ${match.name} a second time; dropped` });
      continue;
    }
    matches.push(match);
  }
  return { matches, issues };
}

/** Reads a parsed body that is a mapping; see the module note. */
function readDocument(
  document: Mapping,
  block: RafaBlock,
  names: ReadonlySet<string>,
): SearchBlockReading {
  const at = `rafa:search block at line ${block.span.first}`;
  const unanswerable = fieldOf(document, 'unanswerable');
  if (typeof unanswerable !== 'boolean') {
    const text = `${at} has unanswerable ${describeValue(unanswerable)}, not true or false`;
    return absent('malformed-block', block, text);
  }

  const listed = fieldOf(document, 'matches') ?? [];
  if (!Array.isArray(listed)) {
    return absent('malformed-block', block, `${at} has matches ${describeValue(listed)}, not a list`);
  }
  if (unanswerable && listed.length > 0) {
    const text = `${at} says unanswerable: true yet lists ${listed.length} matches`;
    return absent('malformed-block', block, text);
  }

  const { matches, issues } = readMatches(listed, names);
  return { present: true, matches, unanswerable, block, issues };
}

/**
 * Reads the last `rafa:search` block out of a search session's output.
 *
 * Takes any string, normally `CapturedSession.stdout`, and the names of
 * the candidates the session was given. Answers the usable matches with
 * an issue per dropped entry, or an absence naming why there is none.
 * Never throws. See the module note for which block counts and what a
 * match must hold.
 */
export function parseSearchBlock(output: string, candidates: readonly string[]): SearchBlockReading {
  const block = readRafaBlocks(output)
    .filter((each) => each.kind === SEARCH_KIND)
    .at(-1);
  if (block === undefined) {
    return absent('no-block', null, 'the session output holds no rafa:search block');
  }

  const at = `rafa:search block at line ${block.span.first}`;
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

  return readDocument(document, block, new Set(candidates));
}
