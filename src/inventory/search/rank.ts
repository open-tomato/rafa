/**
 * Step one of `rafa skill search` and `rafa agent search`: rank the
 * inventory's records by a question's words and keep the top twelve.
 *
 * This step runs no model. Its twelve are what `--no-model` prints, what
 * the search session is allowed to read (a scratch copy of exactly
 * these files), and what a missing or malformed answer falls back to. A
 * file this step does not keep is therefore a file the session can
 * never name, which is why the reading below leans toward keeping a
 * plausible item over sharpening the order.
 *
 * ## The question's words
 *
 * {@link questionWords} lowercases the question, splits it on anything
 * that is not a letter or a digit (Unicode-aware, so `résumé` stays one
 * word), and drops words shorter than {@link MIN_WORD_LENGTH}, the
 * function words in {@link STOP_WORDS}, and duplicates. The stop list
 * also holds `skill`, `skills`, `agent` and `agents`: "which skill
 * writes changelogs" asks about changelogs, and most descriptions say
 * `skill` of themselves, so the word would score every item alike.
 *
 * ## The fields and their weights
 *
 * Each record is scored against five texts, each with a weight in
 * {@link FIELD_WEIGHTS}: `tags` 4, `prevents` 3, `when_to_use` 3,
 * `description` 2 and the body 1. The weights follow how deliberately
 * each text was written as a retrieval key: a tag names the subject in
 * one word, `prevents` and `when_to_use` are written to say when the
 * item applies, a description says what it is, and a body mentions
 * everything it touches in passing. The item's `name` is NOT a field;
 * its description names the subject when the name does.
 *
 * A question word scores a field's weight ONCE when any word of that
 * field matches it, however often it recurs. Counting occurrences would
 * rank a long body over a short, exact tag, and a body is long for
 * reasons that have nothing to do with the question.
 *
 * ## What counts as a match
 *
 * A field is split into words the way the question is. A question word
 * matches a field word when the two are equal, or when one begins with
 * the other and the shorter is at least {@link MIN_PREFIX_LENGTH}
 * letters: `test` matches `tests` and `testing`, `document` matches
 * `documentation`, but `doc` does not match `docker`. That is the whole
 * of the stemming; no dependency is taken for it.
 *
 * The rule over-matches and is kept anyway: `under` matches
 * `understand`, measured in `rank.test.ts` against the fixture corpus.
 * An extra candidate costs the session one more file to read, while a
 * missed one is a file it can never name.
 *
 * ## The order, and what is dropped
 *
 * A record scoring zero is dropped: nothing in it answers any word, and
 * handing it to the session would only spend its reading on noise. The
 * rest are ordered by score, highest first; a tie keeps the order the
 * records were given in, which for the inventory is precedence order
 * within a name and tree order across names, so one input ranks one way
 * on every run. The first {@link SEARCH_LIMIT} are kept. A question with
 * no word left after the stop list ranks nothing.
 *
 * ## Where the description and the body come from
 *
 * An {@link InventoryRecord} carries `tags`, `prevents` and
 * `when_to_use` whole but its description only as the cut `summary`,
 * and no body at all. {@link readRankCandidate} reads the file for the
 * whole description and the body. A file that does not read (gone or
 * unreadable since the inventory walked it) still ranks, on the
 * record's own fields and its summary with an empty body: the ranker
 * lists, it never refuses.
 */
import type { InventoryRecord } from '../record.js';

import { readFileSync } from 'node:fs';

import { readFrontmatterDocument } from '../../schema/frontmatter.js';
import { readInventoryFrontmatter } from '../record.js';

/** How many candidates the ranking keeps: the files a search session may read. */
export const SEARCH_LIMIT = 12;

/** Shortest question word kept, in characters. */
export const MIN_WORD_LENGTH = 2;

/** Shortest side of a prefix match, in characters; see the module note. */
export const MIN_PREFIX_LENGTH = 4;

/** A text a record is scored against. */
export type RankField = 'tags' | 'prevents' | 'whenToUse' | 'description' | 'body';

/** What one question word scores when it matches a field. */
export const FIELD_WEIGHTS: Readonly<Record<RankField, number>> = {
  tags: 4,
  prevents: 3,
  whenToUse: 3,
  description: 2,
  body: 1,
};

/** The fields in the order a match is reported. */
const FIELDS: readonly RankField[] = ['tags', 'prevents', 'whenToUse', 'description', 'body'];

/**
 * Question words that say nothing about the subject: English function
 * words, and the item kinds themselves (see the module note).
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'by', 'can', 'could', 'do',
  'does', 'for', 'from', 'has', 'have', 'how', 'if', 'in', 'into', 'is', 'it', 'its', 'me',
  'my', 'of', 'on', 'or', 'should', 'so', 'that', 'the', 'their', 'there', 'this', 'to',
  'use', 'was', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with',
  'would', 'you', 'your',
  'agent', 'agents', 'skill', 'skills',
]);

/** One record with the texts it is scored against. */
export interface RankCandidate {
  readonly record: InventoryRecord;
  /** The whole `description`, or null when the item has none. */
  readonly description: string | null;
  /** The file's body after the frontmatter, empty when it did not read. */
  readonly body: string;
}

/** One kept candidate, with what it scored and where. */
export interface RankedCandidate {
  readonly record: InventoryRecord;
  /** The sum of {@link FIELD_WEIGHTS} over every word and field that matched. */
  readonly score: number;
  /** The question words that matched any field, in question order. */
  readonly words: readonly string[];
  /** The fields any word matched, in {@link FIELD_WEIGHTS} order. */
  readonly fields: readonly RankField[];
}

/** The lowercased letter-and-digit runs of `text`. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * The question's words that are scored: lowercased, split on
 * non-letters, stop words and short words dropped, first occurrence
 * kept.
 */
export function questionWords(question: string): readonly string[] {
  const kept = wordsOf(question)
    .filter((word) => word.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word));
  return [...new Set(kept)];
}

/** Whether question word `word` matches field word `other`; see the module note. */
export function wordsMatch(word: string, other: string): boolean {
  if (word === other) return true;

  const [shorter, longer] = word.length <= other.length
    ? [word, other]
    : [other, word];
  return shorter.length >= MIN_PREFIX_LENGTH && longer.startsWith(shorter);
}

/** Each field's text as its distinct words. */
function fieldWords(candidate: RankCandidate): ReadonlyMap<RankField, readonly string[]> {
  const { record } = candidate;
  const texts: Readonly<Record<RankField, string>> = {
    tags: record.tags.join(' '),
    prevents: record.prevents ?? '',
    whenToUse: record.whenToUse ?? '',
    description: candidate.description ?? '',
    body: candidate.body,
  };
  return new Map(FIELDS.map((field) => [field, [...new Set(wordsOf(texts[field]))]]));
}

/** `candidate` scored against `words`, the question's words. */
export function scoreCandidate(
  candidate: RankCandidate,
  words: readonly string[],
): RankedCandidate {
  const byField = fieldWords(candidate);
  const matchedWords = new Set<string>();
  const matchedFields = new Set<RankField>();
  let score = 0;

  for (const word of words) {
    for (const field of FIELDS) {
      const found = (byField.get(field) ?? []).some((other) => wordsMatch(word, other));
      if (!found) continue;
      score += FIELD_WEIGHTS[field];
      matchedWords.add(word);
      matchedFields.add(field);
    }
  }

  return {
    record: candidate.record,
    score,
    words: words.filter((word) => matchedWords.has(word)),
    fields: FIELDS.filter((field) => matchedFields.has(field)),
  };
}

/**
 * The candidates ranked by `question`: zero scores dropped, highest
 * score first, ties in input order, at most `limit` kept.
 */
export function rankCandidates(
  question: string,
  candidates: readonly RankCandidate[],
  limit: number = SEARCH_LIMIT,
): readonly RankedCandidate[] {
  const words = questionWords(question);
  if (words.length === 0) return [];

  return candidates
    .map((candidate) => scoreCandidate(candidate, words))
    .filter((ranked) => ranked.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * `record` with the texts it is scored against, reading its file
 * through `read` (`readFileSync` as UTF-8 by default). A file that does
 * not read ranks on the record's summary and an empty body.
 */
export function readRankCandidate(
  record: InventoryRecord,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): RankCandidate {
  let text: string;
  try {
    text = read(record.path);
  } catch {
    return {
      record,
      description: record.summary === ''
        ? null
        : record.summary,
      body: '',
    };
  }

  const document = readFrontmatterDocument(text);
  return {
    record,
    description: readInventoryFrontmatter(document?.data ?? null).description,
    body: document?.body ?? text,
  };
}
