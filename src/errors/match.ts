/**
 * Word matching over cause codes (#949): the closest codes for a cause
 * written in words, and the pairs of leaves that read alike.
 *
 * Words come from triage's `wordSetOf`, so a code and a bug's text are
 * split the same way, with the filler words of {@link FILLER_WORDS} left
 * out of both: nearly every description holds "a" or "the", so counting
 * them would rank unrelated codes for any sentence.
 *
 * A suggestion scores the share of the TEXT's words an entry holds, since
 * a short cause read against a long description would score low by
 * Jaccard alone; Jaccard breaks ties. A text of {@link FLOOR_TEXT_WORDS}
 * words or more must share {@link FLOOR_SHARED_WORDS}: one shared word
 * out of a sentence is a coincidence, and a cause the list lacks should
 * read as no match, which sends it to `<family>:new-context`. It never
 * picks: the caller (an agent) does.
 */

import type { ErrorCodeEntry } from './codes.js';

import { jaccard, wordSetOf } from '../triage/similarity.js';

import { familyOf } from './codes.js';

/** How many suggestions `rafa bug codes --suggest` prints by default. */
export const SUGGESTION_LIMIT = 5;

/**
 * The Jaccard score at which two leaves of one family read alike.
 *
 * Measured on rafa's own list: two leaves for DIFFERENT causes score up
 * to 0.44 (`skill:description-too-long` beside `skill:listing-too-long`),
 * and a second leaf for `git:no-identity` scores 0.56 when its
 * description says the same in fewer words. 0.5 sits between the two. A
 * leaf naming the same cause in other words scores about 0.36, below
 * what distinct causes reach, so no bar on shared words can find it:
 * the control for that case is `suggestCodes` at filing time, which
 * shows the existing code before a new one is proposed.
 */
export const NEAR_DUPLICATE_SCORE = 0.5;

/** How many content words a text holds before one shared word stops being enough. */
export const FLOOR_TEXT_WORDS = 3;

/** How many words such a text must share with an entry to be suggested it. */
export const FLOOR_SHARED_WORDS = 2;

/**
 * Words that say nothing about a cause, left out of every word set here.
 * "no" and "not" are kept: they tell `no-identity` from `identity`.
 */
export const FILLER_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'out',
  'and', 'or', 'so', 'than', 'then', 'when', 'where', 'which', 'because', 'often',
  'has', 'have', 'had',
]);

/** One ranked code. */
export interface CodeSuggestion {
  readonly code: string;
  /** The share of the text's words the entry holds, above 0 and at most 1. */
  readonly score: number;
  /** True for an open bug's proposed leaf; always false until the bug record lands. */
  readonly proposal: boolean;
}

/** Two codes of one family that read alike. */
export interface NearDuplicate {
  readonly first: string;
  readonly second: string;
  readonly score: number;
}

/** The words of `text` that say something: its word set, less the filler words. */
function contentWords(text: string): ReadonlySet<string> {
  return new Set([...wordSetOf(text)].filter((word) => !FILLER_WORDS.has(word)));
}

/** An entry's words: its code and its description. */
function entryWords(entry: ErrorCodeEntry): ReadonlySet<string> {
  return contentWords(`${entry.code} ${entry.description}`);
}

/** How many words of `query` the set `words` holds. */
function sharedCount(query: ReadonlySet<string>, words: ReadonlySet<string>): number {
  return [...query].filter((word) => words.has(word)).length;
}

/** How many words `query` must share with an entry to be suggested it. */
function sharedFloor(query: ReadonlySet<string>): number {
  return query.size >= FLOOR_TEXT_WORDS
    ? FLOOR_SHARED_WORDS
    : 1;
}

/** The entries closest to `text`, best first, at most `limit`. */
export function suggestCodes(
  text: string,
  entries: readonly ErrorCodeEntry[],
  limit = SUGGESTION_LIMIT,
): readonly CodeSuggestion[] {
  const query = contentWords(text);
  const floor = sharedFloor(query);
  const scored = entries.map((entry) => {
    const words = entryWords(entry);
    return { code: entry.code, shared: sharedCount(query, words), tie: jaccard(query, words) };
  });
  return scored
    .filter((row) => row.shared >= floor)
    .map((row) => ({ ...row, score: row.shared / query.size }))
    .sort((a, b) => b.score - a.score || b.tie - a.tie || a.code.localeCompare(b.code))
    .slice(0, limit)
    .map((row) => Object.freeze({ code: row.code, score: row.score, proposal: false }));
}

/** An entry's leaf words and description words, for comparing within a family. */
function leafWords(entry: ErrorCodeEntry): ReadonlySet<string> {
  return contentWords(`${entry.code.slice(entry.code.indexOf(':') + 1)} ${entry.description}`);
}

/** Every pair inside one family reading alike at `threshold` or above, in list order. */
export function nearDuplicates(
  entries: readonly ErrorCodeEntry[],
  threshold = NEAR_DUPLICATE_SCORE,
): readonly NearDuplicate[] {
  const pairs = entries.flatMap((first, index) => entries.slice(index + 1)
    .filter((second) => familyOf(first.code) === familyOf(second.code))
    .map((second): NearDuplicate => Object.freeze({
      first: first.code,
      second: second.code,
      score: jaccard(leafWords(first), leafWords(second)),
    }))
    .filter((pair) => pair.score >= threshold));
  return Object.freeze(pairs);
}
