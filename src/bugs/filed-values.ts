/**
 * The boundary rule and the summary cut: the module, the action and the
 * summary a bug the loop files carries, read from what a session
 * reported (#991).
 *
 * `rafa issue create --type=bug` refuses a module or an action it cannot
 * use; triage never refuses a report over its bug fields, so
 * {@link boundaryValueOf} answers a value the record accepts for every
 * input. A value is lower-cased and trimmed first. One still off its
 * shape (`MODULE_SHAPE`, `ACTION_SHAPE`, `./title.ts`), outside a
 * vocabulary that is set, or too long for a label is `unknown`, and the
 * session's own word is answered beside it as `reported`, for a
 * `Reported module` or `Reported action` section. The `Module` section
 * is filed plain and becomes a label, so it holds a checked name or
 * `unknown`, never the session's word.
 *
 * A module is filed as the label `module:<name>`; an action is filed as
 * no label of rafa's, and is held to the cap of a label's name alone, so
 * a project filing it as one is never refused.
 *
 * {@link summaryOf} takes its cap as an argument: the redacted `what` on
 * one line, cut to the cap in code points, the last three of them `...`
 * when it was cut. When the title rendered from
 * it does not read back as its fields (`titleRoundTrips`, the
 * test-file-and-colon case), the first `: ` of the summary is written
 * ` — `. The full `what` stays in the `What` section, which is the
 * caller's.
 *
 * Both functions are pure; redacting the text they keep is the caller's.
 */
import type { TitleValues } from '@open-tomato/rafa/bugs/title';

import { GITHUB_LABELS, GITHUB_LABEL_MAX_LENGTH } from '@open-tomato/rafa-board';

import { ACTION_SHAPE, MODULE_SHAPE, titleRoundTrips, UNKNOWN_VALUE } from '@open-tomato/rafa/bugs/title';
import { oneLine } from '@open-tomato/rafa/triage/bug-key';

/** The two fields the boundary rule reads. */
export type BoundaryField = 'module' | 'action';

/** What the boundary rule answers for one reported module or action. */
export interface BoundaryReading {
  /** The value the record carries: a checked name, or `unknown`. */
  readonly value: string;
  /** The session's own word, trimmed, beside an `unknown` it could not use; null otherwise. */
  readonly reported: string | null;
}

/** What a field's value has to match, whole. */
const SHAPES: Readonly<Record<BoundaryField, RegExp>> = {
  module: new RegExp(`^${MODULE_SHAPE}$`),
  action: new RegExp(`^${ACTION_SHAPE}$`),
};

/** What opens the label a field's value is filed as; an action is filed as none of rafa's. */
const LABEL_PREFIXES: Readonly<Record<BoundaryField, string>> = {
  module: GITHUB_LABELS.modulePrefix,
  action: '',
};

/** What ends a summary that was cut. */
const SUMMARY_CUT = '...';

/** The first `: ` of a summary whose title does not read back. */
const COLON = ': ';

/** What that `: ` is written as. */
const COLON_REWRITE = ' — ';

/** True when `value` is a name `field` can be filed under. */
function usable(field: BoundaryField, value: string, vocabulary: readonly string[]): boolean {
  const labelLength = LABEL_PREFIXES[field].length + value.length;
  return SHAPES[field].test(value)
    && labelLength <= GITHUB_LABEL_MAX_LENGTH
    && (vocabulary.length === 0 || vocabulary.includes(value));
}

/**
 * The value `field` is filed with for the word a session `reported`,
 * under `vocabulary` (`issues.vocabulary.modules` or `.actions`, empty
 * for any name of the shape). See the module note.
 */
export function boundaryValueOf(field: BoundaryField, reported: string | null, vocabulary: readonly string[]): BoundaryReading {
  const word = reported?.trim() ?? '';
  const value = word.toLowerCase();
  if (value === '' || value === UNKNOWN_VALUE) return { value: UNKNOWN_VALUE, reported: null };
  return usable(field, value, vocabulary)
    ? { value, reported: null }
    : { value: UNKNOWN_VALUE, reported: word };
}

/** `line` cut to `max` code points, the cut marker included. */
function cutTo(line: string, max: number): string {
  const points = Array.from(line);
  if (points.length <= max) return line;
  const kept = points.slice(0, max - SUMMARY_CUT.length).join('');
  return `${kept.trimEnd()}${SUMMARY_CUT}`;
}

/**
 * The summary a bug is filed with: `what`, already redacted, on one
 * line and cut to `max` code points, its first `: ` written ` — ` when
 * the title `template` renders from it and `fields` does not read back.
 * See the module note.
 */
export function summaryOf(what: string, max: number, template: string, fields: Omit<TitleValues, 'summary'>): string {
  const line = oneLine(what);
  const cut = cutTo(line, max);
  if (!cut.includes(COLON) || titleRoundTrips(template, { ...fields, summary: cut })) return cut;
  return cutTo(line.replace(COLON, COLON_REWRITE), max);
}
