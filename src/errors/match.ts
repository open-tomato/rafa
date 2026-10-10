/**
 * Word matching over cause codes (#949): the closest codes for a cause
 * written in words, and the pairs of leaves that read alike.
 *
 * Words come from triage's `wordSetOf`, so a code and a bug's text are
 * split the same way. A suggestion scores the share of the TEXT's words
 * an entry holds, since a short cause read against a long description
 * would score low by Jaccard alone; Jaccard breaks ties. It never picks:
 * the caller (an agent) does.
 */

import type { ErrorCodeEntry } from './codes.js';

import { jaccard, wordSetOf } from '../triage/similarity.js';

import { familyOf } from './codes.js';

/** How many suggestions `rafa bug codes --suggest` prints by default. */
export const SUGGESTION_LIMIT = 5;

/** The Jaccard score at which two leaves of one family read alike. */
export const NEAR_DUPLICATE_SCORE = 0.6;

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

/** An entry's words: its code and its description. */
function entryWords(entry: ErrorCodeEntry): ReadonlySet<string> {
  return wordSetOf(`${entry.code} ${entry.description}`);
}

/** The share of `query` that `words` holds. */
function coverage(query: ReadonlySet<string>, words: ReadonlySet<string>): number {
  return query.size === 0
    ? 0
    : [...query].filter((word) => words.has(word)).length / query.size;
}

/** The entries closest to `text`, best first, at most `limit`. */
export function suggestCodes(
  text: string,
  entries: readonly ErrorCodeEntry[],
  limit = SUGGESTION_LIMIT,
): readonly CodeSuggestion[] {
  const query = wordSetOf(text);
  const scored = entries.map((entry) => {
    const words = entryWords(entry);
    return { code: entry.code, score: coverage(query, words), tie: jaccard(query, words) };
  });
  return scored
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.tie - a.tie || a.code.localeCompare(b.code))
    .slice(0, limit)
    .map((row) => Object.freeze({ code: row.code, score: row.score, proposal: false }));
}

/** An entry's leaf words and description words, for comparing within a family. */
function leafWords(entry: ErrorCodeEntry): ReadonlySet<string> {
  return wordSetOf(`${entry.code.slice(entry.code.indexOf(':') + 1)} ${entry.description}`);
}

/** Every pair inside one family reading alike at `threshold` or above, in list order. */
export function nearDuplicates(
  entries: readonly ErrorCodeEntry[],
  threshold = NEAR_DUPLICATE_SCORE,
): readonly NearDuplicate[] {
  const pairs: NearDuplicate[] = [];
  entries.forEach((first, index) => {
    for (const second of entries.slice(index + 1)) {
      if (familyOf(first.code) !== familyOf(second.code)) continue;
      const score = jaccard(leafWords(first), leafWords(second));
      if (score >= threshold) pairs.push(Object.freeze({ first: first.code, second: second.code, score }));
    }
  });
  return Object.freeze(pairs);
}
