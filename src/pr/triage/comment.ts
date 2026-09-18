/**
 * The triage comment: the one comment `rafa pr triage` leaves on a pull
 * request, the edit that replaces it on the next assessment, and the
 * `rafa:triage` block read back out of it.
 *
 * The spec gives ONE triage comment per pull request, with its history
 * in that comment's own edits (`.specs/rafa-20-pr-commands.md`). That
 * makes the comment a small STORE and not only a report: the re-run
 * readings the plan builds next compare the stored `head` against the
 * pull request's to decide whether to assess again, and `--resolve`
 * counts what it has already spent out of `attempts`. So both halves
 * live here — the body written and the fields read back — because a
 * field written in a shape the reader refuses is a store that silently
 * forgets, and one file is what holds the two spellings together.
 *
 * `src/commands/pr/last-triage.ts` is the reader's other caller: `pr
 * show` ends with the last triage, and it reads the same comment through
 * {@link findTriageComment} and {@link readTriageBlock} rather than
 * through a fence reader of its own.
 *
 * ## What is here and what is the caller's
 *
 * Nothing in this module decides WHETHER to comment. `--no-comment`
 * reads an existing comment and writes none, and the four re-run
 * readings decide between assessing again, showing the old triage and
 * saying green; both are the command's, and they reach
 * {@link writeTriageComment} only when a write is what they concluded.
 * This module also never reads a clock: `at` is handed in, so the body
 * is a pure function of its input and every case drives it from
 * literals.
 *
 * ## Every string value is quoted, and the block is not
 * `Bun.YAML.stringify`'s
 *
 * `Bun.YAML.parse` types a scalar by the YAML core schema, so an
 * unquoted value can come back as something other than the text that was
 * written. Measured against Bun 1.3.14 on 2026-09-18:
 *
 * ```text
 * head: 0e12345      ->  0             (a float in the core schema)
 * head: 1234567      ->  1234567       (an integer)
 * head: 0badc0ffee   ->  "0badc0ffee"
 * at: value # tail   ->  "value"       (the comment cuts the value short)
 * author: @rafa      ->  throws        YAML Parse error: Unexpected token
 * ```
 *
 * A short head sha spelled `0e12345` would therefore be stored as the
 * number zero, and the next run would compare the pull request's head
 * against `0` and assess again for ever.
 *
 * `Bun.YAML.stringify` does quote that one. Handed the six fields of a
 * block it answered, in the same run, a single-line FLOW mapping:
 *
 * ```text
 * {head: "0e12345",at: 2026-09-18T12:00:00Z,class: ci-lint,simple: false,attempts: 0,files: [bun.lock]}
 * ```
 *
 * which its own parser reads back whole and a person reads not at all.
 * Of the four string values in it, one came back quoted, and the three
 * a triage comment is most often read by eye — `at`, `class` and the
 * paths — came back bare, so the spec's rule that every string value is
 * quoted is not one that library keeps. So {@link writeTriageBlock}
 * spells the block itself, one `key: value` a line in the spec's order,
 * every string value through `JSON.stringify`, which is a YAML
 * double-quoted scalar. The round trip was measured on the same day over
 * a value holding a quote, a backslash, a tab, a newline, `@`, `# `,
 * `%`, `[` and non-ASCII text: each came back identical, and `files`
 * written as a JSON array read back as the same list of paths.
 *
 * ## Why a field of the wrong type is a problem and not a default
 *
 * {@link readTriageBlock} takes text for `head`, `at` and `class` and
 * nothing else. A reader coercing a number back with `String(value)`
 * would print `0` as the head a triage was made against — a wrong answer
 * that looks like a right one. So the field is left null, and named in
 * {@link TriageBlockReading.problems} with the spelling that works.
 *
 * A field the block simply leaves out is null with NO problem: a comment
 * written by an older rafa carries fewer fields, and reporting each
 * absent one as a fault would bury the one that matters.
 *
 * ## The fences
 *
 * The body is read back by `readRafaBlocks` (`src/plan/blocks.ts`), the
 * reader that already tells a real block from a comment illustrating the
 * format, so a comment quoting a triage inside a longer fence
 * contributes no reading. Both fences this module writes — the block and
 * the follow-up prompt in its `<details>` — go through `fencedBlock`
 * (`./follow-up.ts`), one backtick longer than any backtick run inside,
 * because the prompt carries fences of its own and a CI log excerpt can
 * carry anything at all.
 *
 * The log excerpt appears twice in a full comment: once in the evidence,
 * where a person reads it, and once inside the follow-up prompt, which
 * is a copy-paste unit that has to stand alone (`./follow-up.ts`). That
 * duplication is deliberate; trimming either copy would cost one of the
 * two readers.
 *
 * ## What it does not check
 *
 * WHO wrote the comment. A marker comment from an account without write
 * access is to be ignored and reported, through `src/board/trust.ts`,
 * which the trust stage wires into this reader's callers. Until then
 * every caller prints the author it found, so a triage nobody trusted is
 * at least attributed.
 */
import type { TriageClass } from './classes.js';
import type { TriageAssessment } from './classify.js';
import type { FailedLogEvidence } from './evidence.js';
import type { FollowUpPullRequest } from './follow-up.js';
import type { Mapping } from '../../config-sections.js';
import type { PullRequestComment, PullRequests } from '../types.js';

import { describeValue, isMapping, messageOf } from '../../config-sections.js';
import { readRafaBlocks } from '../../plan/blocks.js';

import { buildFollowUpPrompt, excerptCaption, excerptLines, fencedBlock } from './follow-up.js';

/** The HTML comment a rafa triage comment carries, and is found by. */
export const TRIAGE_MARKER = '<!-- rafa:pr-triage v1 -->';

/** The kind of the fenced block a triage comment carries its reading in. */
export const TRIAGE_BLOCK_KIND = 'triage';

/** The info string that block's fence opens with, as a problem names it. */
export const TRIAGE_BLOCK_FENCE = `rafa:${TRIAGE_BLOCK_KIND}`;

/** The `rafa:triage` block, each field null when it was absent or unusable. */
export interface TriageBlock {
  /** The head commit the triage was made against. */
  readonly head: string | null;
  /** When it was made, ISO 8601, as the triage wrote it. */
  readonly at: string | null;
  /** The class it was assessed as, verbatim: an unknown word is still reported. */
  readonly class: string | null;
  /** Whether the class is one `--resolve` can act on. */
  readonly simple: boolean | null;
  /** How many resolve attempts have been spent, from 0. */
  readonly attempts: number | null;
  /** The files the class was read from, for a conflict. */
  readonly files: readonly string[] | null;
}

/** A block as one comment body reads, and what was wrong with it. */
export interface TriageBlockReading {
  /** The fields, or null when no block could be read at all. */
  readonly block: TriageBlock | null;
  /** What was wrong with the block and its fields; empty when it read clean. */
  readonly problems: readonly string[];
}

/** The fields one assessment writes into the block; see the module note on quoting. */
export interface WrittenTriageBlock {
  /** The head commit the triage was read at. */
  readonly head: string;
  /** When it was read, ISO 8601. Handed in: this module reads no clock. */
  readonly at: string;
  /** The class, one of `TRIAGE_CLASSES`. */
  readonly triageClass: TriageClass;
  /** Whether `--resolve` may act on it, the class and the bump reading together. */
  readonly simple: boolean;
  /** How many resolve attempts have been spent, from 0. */
  readonly attempts: number;
  /** The conflicting paths, empty for every class that is not a conflict. */
  readonly files: readonly string[];
}

/** Everything one triage comment is written from. */
export interface TriageCommentInput {
  /** The pull request, as the port answered it. */
  readonly pr: FollowUpPullRequest;
  /** What the classifier concluded. */
  readonly assessment: TriageAssessment;
  /** When the assessment was read, ISO 8601. */
  readonly at: string;
  /** How many resolve attempts have been spent, from 0. */
  readonly attempts: number;
  /** Whether a `--resolve` run has already fixed this pull request. */
  readonly resolved: boolean;
  /** The failing job's log reading, when there was a failing job. */
  readonly evidence?: FailedLogEvidence | undefined;
}

/**
 * The port members a triage comment is written through: the list it
 * looks for its own marker in, the post and the edit.
 *
 * Spelled as a `Pick` of {@link PullRequests} so a caller hands over the
 * provider it already has, and so a rename on the port reaches this
 * writer through the compiler.
 */
export type TriageCommentWriter = Pick<PullRequests, 'comment' | 'comments' | 'editComment'>;

/** What one write did. */
export interface TriageCommentWrite {
  /** `edited` whenever a marker comment was already there; see the module note. */
  readonly action: 'posted' | 'edited';
  /** The comment as the provider answered it, posted or edited. */
  readonly comment: PullRequestComment;
}

/** What one write is asked for. */
export interface WriteTriageCommentOptions {
  /** The provider the comment is written through. */
  readonly pulls: TriageCommentWriter;
  /** The pull request number. */
  readonly number: number;
  /** The body, from {@link triageCommentBody}. */
  readonly body: string;
  /**
   * The marker comment already found, or null when the caller looked and
   * there was none. Left out, the writer lists the comments and looks
   * itself — which a caller that has just read them for the re-run
   * readings need not pay for twice.
   */
  readonly existing?: PullRequestComment | null;
}

/**
 * The LAST comment carrying the marker, or null when none does.
 *
 * Last rather than first, because a comment posted by an older rafa and
 * then a newer one are both markers, and the newest is the triage that
 * stands. Ordinary comments after it change nothing.
 */
export function findTriageComment(
  comments: readonly PullRequestComment[],
): PullRequestComment | null {
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

/** Nothing readable, for the one reason given. */
function noBlock(problem: string): TriageBlockReading {
  return { block: null, problems: [problem] };
}

/** The fields of a mapping read into a block, each unusable one named. */
function readFields(fields: Mapping): TriageBlockReading {
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

/**
 * The `rafa:triage` block of one comment body, field by field.
 *
 * Total: a body with no block, an unclosed block, a block that is not
 * YAML and a block that is not a mapping each answer a null block and
 * one problem naming what was wrong, because a comment that cannot be
 * read is a reading a caller has to report rather than a throw.
 */
export function readTriageBlock(body: string): TriageBlockReading {
  const block = readRafaBlocks(body).find((found) => found.kind === TRIAGE_BLOCK_KIND);
  if (block === undefined) {
    return noBlock(`it carries the ${TRIAGE_MARKER} marker and no ${TRIAGE_BLOCK_FENCE} block`);
  }
  if (!block.closed) return noBlock(`its ${TRIAGE_BLOCK_FENCE} block was never closed`);

  let document: unknown;
  try {
    document = Bun.YAML.parse(block.body);
  } catch (error) {
    return noBlock(`its ${TRIAGE_BLOCK_FENCE} block is not valid YAML (${messageOf(error)})`);
  }
  if (!isMapping(document)) {
    return noBlock(`its ${TRIAGE_BLOCK_FENCE} block holds ${describeValue(document)}, not a mapping of fields`);
  }
  return readFields(document);
}

/** One string value, as a YAML double-quoted scalar; see the module note. */
function quoted(value: string): string {
  return JSON.stringify(value);
}

/**
 * The block's YAML, one field a line in the spec's order, every string
 * value quoted. No fence: {@link triageCommentBody} puts one round it.
 */
export function writeTriageBlock(fields: WrittenTriageBlock): string {
  return [
    `head: ${quoted(fields.head)}`,
    `at: ${quoted(fields.at)}`,
    `class: ${quoted(fields.triageClass)}`,
    `simple: ${String(fields.simple)}`,
    `attempts: ${String(fields.attempts)}`,
    `files: [${fields.files.map((file) => quoted(file)).join(', ')}]`,
  ].join('\n');
}

/**
 * The one bold line under the marker: the class, whether a resolve plan
 * covers it, and whether one has already run.
 */
export function triageHeadline(
  assessment: Pick<TriageAssessment, 'simple' | 'triageClass'>,
  resolved: boolean,
): string {
  const simple = assessment.simple
    ? 'simple'
    : 'not simple';
  const resolution = resolved
    ? 'resolved'
    : 'not resolved';
  return `**rafa triage**: \`${assessment.triageClass}\`, ${simple}, ${resolution}`;
}

/** A list of paths as backticked code, or the sentence for none. */
function pathList(files: readonly string[], none: string): string {
  return files.length === 0
    ? none
    : files.map((file) => `\`${file}\``).join(', ');
}

/** The evidence lines: the files, the step and the failing checks. */
function evidenceLines(assessment: TriageAssessment): string {
  const none = assessment.conflicting
    ? 'none read; the head was not fetched locally'
    : 'none; the head merges cleanly';
  const step = assessment.step === undefined
    ? 'none named'
    : `\`${assessment.step.name}\``;
  const checks = pathList(assessment.failing.map((row) => row.name), 'none failing');
  return [
    `- Why: ${assessment.reason}`,
    `- Conflicting files: ${pathList(assessment.files, none)}`,
    `- Failing step: ${step}`,
    `- Failing checks: ${checks}`,
    `- Checks verdict: \`${assessment.verdict}\`, at the head commit in the block above`,
  ].join('\n');
}

/** The log excerpt under the evidence, or nothing when no log was read. */
function excerptSection(evidence: FailedLogEvidence | undefined): string {
  if (evidence === undefined) return '';
  const reading = excerptLines(evidence);
  if (reading.lines.length === 0) return '';
  return `\n\n${excerptCaption(reading)}\n\n${fencedBlock(reading.lines.join('\n'), 'text')}`;
}

/** The follow-up prompt, folded into a `<details>` a reader opens. */
function followUpSection(input: TriageCommentInput): string {
  const prompt = buildFollowUpPrompt({
    pr: input.pr,
    assessment: input.assessment,
    evidence: input.evidence,
  });
  return [
    '<details>',
    '<summary>Follow-up prompt: hand this to a session as it stands</summary>',
    '',
    fencedBlock(prompt, 'markdown'),
    '',
    '</details>',
  ].join('\n');
}

/**
 * The whole comment body: the marker, the headline, the `rafa:triage`
 * block, the evidence and the follow-up prompt in its `<details>`.
 *
 * Pure and total, and it reads no clock: everything it says comes from
 * {@link TriageCommentInput}.
 */
export function triageCommentBody(input: TriageCommentInput): string {
  const { assessment } = input;
  const block = writeTriageBlock({
    head: input.pr.headRefOid,
    at: input.at,
    triageClass: assessment.triageClass,
    simple: assessment.simple,
    attempts: input.attempts,
    files: assessment.files,
  });
  return [
    TRIAGE_MARKER,
    triageHeadline(assessment, input.resolved),
    '',
    fencedBlock(block, TRIAGE_BLOCK_FENCE),
    '',
    `${evidenceLines(assessment)}${excerptSection(input.evidence)}`,
    '',
    followUpSection(input),
    '',
  ].join('\n');
}

/**
 * Writes the triage comment: an EDIT of the marker comment already on
 * the pull request, or a new comment when there is none.
 *
 * One comment per pull request with its history in its edits is the
 * spec's rule, so this never posts beside a marker comment it found.
 */
export async function writeTriageComment(
  options: WriteTriageCommentOptions,
): Promise<TriageCommentWrite> {
  const { body, number, pulls } = options;
  const existing = options.existing === undefined
    ? findTriageComment(await pulls.comments(number))
    : options.existing;
  if (existing === null) {
    return { action: 'posted', comment: await pulls.comment(number, body) };
  }
  return { action: 'edited', comment: await pulls.editComment(existing.id, body) };
}
