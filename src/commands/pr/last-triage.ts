/**
 * The last triage on a pull request, read out of its comments.
 *
 * `rafa pr show` ends with "the last triage", and a triage leaves
 * exactly one comment per pull request, its history in that comment's
 * own edits (`.specs/rafa-20-pr-commands.md`). The comment is found by
 * the marker {@link TRIAGE_MARKER} its body opens with, and what it says
 * in machine-readable form is a fenced `rafa:triage` block:
 *
 * ````markdown
 * <!-- rafa:pr-triage v1 -->
 * **rafa triage**: `conflict-lockfile`, simple, not resolved
 * ```rafa:triage
 * head: "0badc0ffee..."
 * at: "2026-09-18T12:00:00Z"
 * class: "conflict-lockfile"
 * simple: true
 * attempts: 0
 * files: ["bun.lock"]
 * ```
 * ````
 *
 * This module READS one. Writing it, editing it and the re-run readings
 * over it belong to `rafa pr triage`, which the triage stage builds as
 * `src/pr/triage/comment.ts`; a reader that lives with the command
 * needing it now is what keeps `pr show` from waiting on that stage, and
 * it is where the writer's round-trip case will point.
 *
 * ## The block is read by the plan reader, not by a regular expression
 *
 * `readRafaBlocks` (`src/plan/blocks.ts`) already reads fenced `rafa:*`
 * blocks the way a renderer shows them, unknown kinds included, and a
 * second fence reader here could disagree with it about what a comment
 * quoting the format says. So the comment body goes through it, and the
 * first block whose kind is `triage` is the one read.
 *
 * ## Why a field of the wrong type is a problem and not a default
 *
 * `Bun.YAML.parse` types a scalar by the YAML core schema, so an
 * UNQUOTED value in the block can come back as something other than
 * text. Measured against Bun 1.3 on 2026-09-18:
 *
 * ```text
 * a: 0e12345     ->  0          (a float in the core schema)
 * b: 1234567     ->  1234567    (an integer)
 * c: 0badc0ffee  ->  "0badc0ffee"
 * d: "0e12345"   ->  "0e12345"
 * ```
 *
 * A short head sha spelled `0e12345` therefore reads as the NUMBER
 * zero, and a reader coercing it back with `String(value)` would print
 * `0` as the head a triage was made against — a wrong answer that looks
 * like a right one. So {@link readLastTriage} takes text for `head`,
 * `at` and `class` and nothing else, leaves the field null, and names it
 * in {@link LastTriage.problems} with the spelling that works. That is
 * the reading behind the spec's rule that every string value in the
 * block is quoted, and the writer will keep it.
 *
 * A field the block simply leaves out is null with no problem: a triage
 * comment from an older version carries fewer fields, and reporting each
 * absent one as a fault would bury the one that matters.
 *
 * ## What it does not check
 *
 * WHO wrote the comment. A marker comment from an account without write
 * access is to be ignored and reported, through `src/board/trust.ts`,
 * and the plan wires that into this reader and into `pr triage
 * --resolve` in the trust stage. Until then the author's login rides on
 * {@link LastTriage.author} and every reader of it prints it, so a
 * triage nobody trusted is at least attributed.
 */
import type { Mapping } from '../../config-sections.js';
import type { PullRequestComment } from '../../pr/index.js';

import { describeValue, isMapping, messageOf } from '../../config-sections.js';
import { readRafaBlocks } from '../../plan/blocks.js';

/** The HTML comment a rafa triage comment carries, and is found by. */
export const TRIAGE_MARKER = '<!-- rafa:pr-triage v1 -->';

/** The kind of the fenced block a triage comment carries its reading in. */
export const TRIAGE_BLOCK_KIND = 'triage';

/** The fence a problem names, as it is written. */
const BLOCK_FENCE = `rafa:${TRIAGE_BLOCK_KIND}`;

/** The `rafa:triage` block, each field null when it was absent or unusable. */
export interface TriageBlock {
  /** The head commit the triage was made against. */
  readonly head: string | null;
  /** When it was made, ISO 8601, as the triage wrote it. */
  readonly at: string | null;
  /** The class it was assessed as, verbatim: the classes are the triage stage's. */
  readonly class: string | null;
  /** Whether the class is one `--resolve` can act on. */
  readonly simple: boolean | null;
  /** How many resolve attempts have been spent, from 0. */
  readonly attempts: number | null;
  /** The files the class was read from, for a conflict. */
  readonly files: readonly string[] | null;
}

/** The last triage comment on a pull request, and what it says. */
export interface LastTriage {
  /** The comment's provider id, which an edit takes. */
  readonly id: string;
  /** The login that wrote it; see the module note on trust. */
  readonly author: string;
  /** The comment's own URL. */
  readonly url: string;
  /** When the comment last moved, ISO 8601. An edit moves it. */
  readonly updatedAt: string;
  /** What its `rafa:triage` block said, or null when none could be read. */
  readonly block: TriageBlock | null;
  /** What was wrong with the block and its fields; empty when it read clean. */
  readonly problems: readonly string[];
}

/** The last comment carrying the marker, or null when no comment does. */
function markerComment(comments: readonly PullRequestComment[]): PullRequestComment | null {
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const comment = comments[index];
    if (comment !== undefined && comment.body.includes(TRIAGE_MARKER)) return comment;
  }
  return null;
}

/** A field as it was read, and what to say about it when it was unusable. */
interface Field<T> {
  readonly value: T | null;
  readonly problem: string | null;
}

/** A field that read clean. */
function read<T>(value: T): Field<T> {
  return { value, problem: null };
}

/** A field the block left out: null, and nothing to say about it. */
function absent<T>(): Field<T> {
  return { value: null, problem: null };
}

/** A field that was there and unusable: null, with what was there and how to write it. */
function unusable<T>(key: string, value: unknown, expected: string): Field<T> {
  return { value: null, problem: `${key} is ${describeValue(value)}, not ${expected}` };
}

/** Text with something in it, trimmed; see the module note on quoting. */
function readText(fields: Mapping, key: string): Field<string> {
  const value = fields[key];
  if (value === undefined) return absent();
  if (typeof value !== 'string') return unusable(key, value, `text; write it quoted, as ${key}: "..."`);
  const trimmed = value.trim();
  return trimmed === ''
    ? unusable(key, value, 'text with something in it')
    : read(trimmed);
}

/** `true` or `false`, and no other spelling. */
function readBoolean(fields: Mapping, key: string): Field<boolean> {
  const value = fields[key];
  if (value === undefined) return absent();
  return typeof value === 'boolean'
    ? read(value)
    : unusable(key, value, 'true or false');
}

/** A count: a whole number from 0. */
function readCount(fields: Mapping, key: string): Field<number> {
  const value = fields[key];
  if (value === undefined) return absent();
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? read(value)
    : unusable(key, value, 'a whole number from 0');
}

/** A list of paths, each text with something in it. */
function readPaths(fields: Mapping, key: string): Field<readonly string[]> {
  const value = fields[key];
  if (value === undefined) return absent();
  if (!Array.isArray(value)) return unusable(key, value, 'a list of quoted paths');
  const paths = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  return paths.length === value.length
    ? read(paths.map((path) => path.trim()))
    : unusable(key, value, 'a list of quoted paths');
}

/** The block and its problems, as a comment body reads. */
interface BlockReading {
  readonly block: TriageBlock | null;
  readonly problems: readonly string[];
}

/** Nothing readable, for the one reason given. */
function noBlock(problem: string): BlockReading {
  return { block: null, problems: [problem] };
}

/** The fields of a mapping read into a block, each unusable one named. */
function readFields(fields: Mapping): BlockReading {
  const head = readText(fields, 'head');
  const at = readText(fields, 'at');
  const className = readText(fields, 'class');
  const simple = readBoolean(fields, 'simple');
  const attempts = readCount(fields, 'attempts');
  const files = readPaths(fields, 'files');
  const problems = [head, at, className, simple, attempts, files]
    .map((field) => field.problem)
    .filter((problem): problem is string => problem !== null);
  return {
    block: {
      head: head.value,
      at: at.value,
      class: className.value,
      simple: simple.value,
      attempts: attempts.value,
      files: files.value,
    },
    problems,
  };
}

/** The `rafa:triage` block of a comment body; see the module note. */
function readBlock(body: string): BlockReading {
  const block = readRafaBlocks(body).find((found) => found.kind === TRIAGE_BLOCK_KIND);
  if (block === undefined) return noBlock(`it carries the ${TRIAGE_MARKER} marker and no ${BLOCK_FENCE} block`);
  if (!block.closed) return noBlock(`its ${BLOCK_FENCE} block was never closed`);

  let document: unknown;
  try {
    document = Bun.YAML.parse(block.body);
  } catch (error) {
    return noBlock(`its ${BLOCK_FENCE} block is not valid YAML (${messageOf(error)})`);
  }
  if (!isMapping(document)) {
    return noBlock(`its ${BLOCK_FENCE} block holds ${describeValue(document)}, not a mapping of fields`);
  }
  return readFields(document);
}

/**
 * The last triage on a pull request, from its comments oldest first as
 * the port answers them, or null when none of them carries the marker.
 * A marker comment whose block cannot be read is still a reading: the
 * comment, with a null block and what was wrong with it.
 */
export function readLastTriage(comments: readonly PullRequestComment[]): LastTriage | null {
  const comment = markerComment(comments);
  if (comment === null) return null;
  const reading = readBlock(comment.body);
  return {
    id: comment.id,
    author: comment.author.login,
    url: comment.url,
    updatedAt: comment.updatedAt,
    block: reading.block,
    problems: reading.problems,
  };
}
