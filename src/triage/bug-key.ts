/**
 * The key a bug is looked up by, and the artifact it is built from; loop-
 * owned triage (`./triage.ts`) files and looks up every public bug by it.
 *
 * ## The key
 *
 * {@link bugKeyOf} builds it from the bug's artifact and `what`, both with
 * their local paths already taken out (`./local-paths.ts`), so one bug
 * keys the same on every machine and a key never holds a user's name:
 *
 *   - A bug naming a test case (`./test-failure.ts`) keys on the TEST: its
 *     test file's base name, its case name and its first evidence line
 *     stripped, as `a.test.ts > outer > case: <evidence>`, with no tracker
 *     file in it. One red test met by two plans is one defect, and keying
 *     it on the plan's tracker file had filed it once per plan (20 issues
 *     for one failure on 2026-09-30). The evidence line is in the key so
 *     two different failures in one case stay two bugs. A case naming no
 *     file keys on the case alone, and one with no evidence line on its
 *     file and case alone.
 *   - Every other bug keys on the base name of the task's tracker file,
 *     then its stripped artifact, joined by {@link KEY_SEPARATOR}. The
 *     artifact alone is not the defect: two plans quoting one error string
 *     report two different bugs, and keying on that string alone commented
 *     the second on the first one's issue. The base name rather than the
 *     path, so one plan keys the same from two checkouts.
 *
 * ## Stripping
 *
 * Sessions word one failure differently: #446 got three artifacts for one
 * lint error, with the path and line, with the line only and with neither.
 * {@link strippedText} takes out, in this order, commit hashes (a word of
 * 7 to 40 hex characters; before numbers, which would leave a hash's
 * letters behind), folder prefixes (everything up to a path's last `/`),
 * numbers, and then makes each run of whitespace one space and trims the
 * ends. A case name is NOT stripped, only put on one line: `parses 2
 * lines` and `parses 3 lines` are two tests. A text holding nothing but
 * what stripping takes out keys on itself, on one line, rather than on the
 * empty string every such text would share.
 *
 * ## The legacy key
 *
 * Before #486 every bug keyed on the tracker file's base name and the
 * artifact on one line, unstripped ({@link legacyBugKeyOf}), and before
 * that on the artifact with its local paths. Step 1 of `./triage.ts`'s
 * public lookup asks the store for both legacy keys after the new one, so
 * an issue filed before this rafa is still found from the store.
 *
 * ## A bug with no key
 *
 * A bug with no artifact has no key (roadmap Q18): it is filed every time,
 * with no lookup and no reference stored. An artifact that is blank, or
 * that holds a lone UTF-16 surrogate, which the store cannot key a
 * reference by, counts as none ({@link artifactOf}).
 */
import type { TestFailure } from './test-failure.js';
import type { ReportBug } from '../report/parse.js';

import { basename } from 'node:path';

import { textProblem } from '../effort/store/findings.js';

import { testFailureOf } from './test-failure.js';

/** What stands between a bug's file, or its test case, and the text it keys on. */
export const KEY_SEPARATOR = ': ';

/** What stands between a test file and its case name in a test failure's key. */
export const CASE_SEPARATOR = ' > ';

/** True for text with something in it. */
export function hasText(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A bug's artifact when it can key a reference, or null; see the module note. */
export function artifactOf(bug: ReportBug): string | null {
  return hasText(bug.artifact) && textProblem(bug.artifact) === null
    ? bug.artifact
    : null;
}

/** `text` on one line, every run of whitespace one space, trimmed. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A commit hash: a word of 7 to 40 hex characters. */
const COMMIT_HASH = /\b[0-9a-f]{7,40}\b/gi;

/** A folder prefix: a path's characters up to and with its last `/`. */
const FOLDER_PREFIX = /[^\s'"`()[\]{}<>,;|]*\//g;

/** A number: a run of digits. */
const NUMBER = /\d+/g;

/** `text` with its commit hashes, folder prefixes and numbers taken out, on one line; see the module note. */
export function strippedText(text: string): string {
  const taken = text
    .replace(COMMIT_HASH, '')
    .replace(FOLDER_PREFIX, '')
    .replace(NUMBER, '');
  return oneLine(taken);
}

/**
 * {@link strippedText}, or `text` on one line when stripping leaves
 * nothing: what an evidence line keys on, and what `./inherited.ts`
 * compares an evidence line and a run-start message by.
 */
export function keyText(text: string): string {
  const stripped = strippedText(text);
  return stripped.length > 0
    ? stripped
    : oneLine(text);
}

/** The key of a bug naming a test case; see the module note. */
function testFailureKeyOf(failure: TestFailure): string {
  const test = failure.file === null
    ? oneLine(failure.name)
    : `${basename(failure.file)}${CASE_SEPARATOR}${oneLine(failure.name)}`;
  return failure.evidence === null
    ? test
    : `${test}${KEY_SEPARATOR}${keyText(failure.evidence)}`;
}

/**
 * The key a bug's issue is looked up and kept under, from its artifact
 * and its `what`, each with its local paths taken out: its test file,
 * case and stripped evidence line when it names a test case, else the
 * base name of the tracker file it was reported against and its stripped
 * artifact; see the module note.
 */
export function bugKeyOf(trackerPath: string, artifact: string, what: string | null = null): string {
  const failure = testFailureOf({ what, artifact });
  return failure === null
    ? `${basename(trackerPath)}${KEY_SEPARATOR}${keyText(artifact)}`
    : testFailureKeyOf(failure);
}

/**
 * The key a bug was kept under before #486: the base name of the tracker
 * file it was reported against, then its artifact on one line, unstripped,
 * joined by {@link KEY_SEPARATOR}; see the module note.
 */
export function legacyBugKeyOf(trackerPath: string, artifact: string): string {
  return `${basename(trackerPath)}${KEY_SEPARATOR}${oneLine(artifact)}`;
}
