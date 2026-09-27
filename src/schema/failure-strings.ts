/**
 * The rule for one `failure_strings` entry in a skill's frontmatter.
 *
 * A skill may declare `failure_strings:`, literal strings — a compiler
 * code such as `TS2769`, a line such as `no changes added to commit` —
 * whose appearance in a later task's report says the failure the skill
 * exists to prevent happened anyway. The list itself (absent, a list,
 * its entries strings) is read by `./skill.js` with the rules every
 * list field there shares; what is particular to this field is what a
 * STRING entry may hold, and that is this module.
 *
 * - A blank entry is `empty-failure-string`, a failure: the empty
 *   literal is found inside every text, so it would call every task a
 *   recurrence. Whitespace-only counts as blank for the same reason —
 *   a lone space is in nearly every line.
 * - An entry shorter than {@link FAILURE_STRING_MIN_LENGTH} codepoints
 *   is `short-failure-string`, a WARNING: `TS27` is a prefix of every
 *   `TS27xx` error, so it matches more than it names, but whether that
 *   breadth is wrong is the author's call. `src/check/run.ts` maps it
 *   to a `warning` severity, which never reaches `rafa skill check`'s
 *   exit code.
 *
 * Length is counted in codepoints, the unit `./skill.js` counts its own
 * caps in, so an accented word is not warned on for its accent.
 * Nothing here trims or folds an entry: a recurrence is a case-sensitive
 * literal match, so the string is kept exactly as it was written.
 */

/**
 * Shortest a `failure_strings` entry may be without a warning, in
 * codepoints, inclusive: 6 passes quietly, 5 warns.
 */
export const FAILURE_STRING_MIN_LENGTH = 6;

/** The two codes this module's rule produces. */
export type FailureStringCode = 'empty-failure-string' | 'short-failure-string';

/** What is wrong with one entry, before `./skill.js` attaches its field. */
export interface FailureStringProblem {
  /** Which rule the entry broke. */
  readonly code: FailureStringCode;
  /** A sentence a checker prints unedited. */
  readonly message: string;
}

/**
 * What is wrong with `entry` as a failure string, or null when it is a
 * usable one.
 */
export function failureStringProblem(entry: string): FailureStringProblem | null {
  if (entry.trim() === '') {
    return {
      code: 'empty-failure-string',
      message: 'a blank failure string is found in every text, '
        + 'so every task would read as a recurrence',
    };
  }

  const length = Array.from(entry).length;
  return length < FAILURE_STRING_MIN_LENGTH
    ? {
      code: 'short-failure-string',
      message: `failure string "${entry}" is ${length} characters, under `
        + `${FAILURE_STRING_MIN_LENGTH}, so it may match failures the skill does not name`,
    }
    : null;
}
