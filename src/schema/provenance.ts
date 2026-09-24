/**
 * `provenance`: the optional frontmatter field saying where a skill or an
 * agent came from, read the same way by both checkers.
 *
 * The value takes one of two shapes:
 *
 *   - the string `first-party` ({@link FIRST_PARTY}) — written here, owed
 *     to nobody;
 *   - a mapping `{ origin, license, reviewed? }` — somebody else's work,
 *     with `origin` saying where it was taken from, `license` the terms it
 *     was taken under, and `reviewed`, when present, `<who> <YYYY-MM-DD>`:
 *     the person who read it before it was served and the day they did.
 *
 * The field is optional on both kinds. Where it is REQUIRED (every item
 * rafa bundles) and what an unreviewed third-party item costs (it is not
 * served from the rafa tier or from an add-on) are the callers' rules and
 * not this module's; this module answers only whether a value that is
 * there reads as one of the two shapes, and what it says.
 *
 * ## Why an unknown key in the mapping is refused
 *
 * A mapping carrying `licence` beside `origin` would otherwise read as a
 * mapping missing `license`, which is refused anyway, but a mapping
 * carrying `review: marcos 2026-09-24` would read as an UNREVIEWED item
 * with nothing refused at all — a typo that silently keeps an item out of
 * service. So every key outside {@link PROVENANCE_KEYS} is
 * `unknown-provenance` on its own field.
 *
 * ## What `Bun.YAML` hands this module
 *
 * Measured on Bun 1.3.14: `provenance: first-party` parses to the string,
 * `provenance: { origin: https://x/y, license: MIT }` to a mapping of two
 * strings (the `:` inside the URL does not split the flow mapping), and
 * an unquoted `reviewed: 2026-09-24` stays the STRING `2026-09-24` rather
 * than becoming a date, so `reviewed` is checked as text. A calendar date
 * that does not exist (`2026-02-30`) is also still a string, which is why
 * {@link reviewProblem} checks the day as well as the shape.
 *
 * Nothing here opens a file or throws. The issue codes are the skill
 * schema's own spelling of the same rules (`missing-field`, `wrong-type`)
 * plus the two only this field has, so a skill and an agent report a bad
 * `provenance` with the same code.
 */

/** The field's name in a frontmatter block. */
export const PROVENANCE_FIELD = 'provenance';

/** The one string value `provenance` may take. */
export const FIRST_PARTY = 'first-party';

/** The keys a third-party mapping may carry, required ones first. */
export const PROVENANCE_KEYS = ['origin', 'license', 'reviewed'] as const;

/** The keys a third-party mapping cannot omit. */
export const REQUIRED_PROVENANCE_KEYS = ['origin', 'license'] as const;

/**
 * The shape `reviewed` takes: a reviewer that starts and ends with a
 * non-space character, whitespace, then a `YYYY-MM-DD` date.
 */
export const REVIEWED_PATTERN = /^(\S(?:.*\S)?)\s+(\d{4}-\d{2}-\d{2})$/;

/** Why a `provenance` value was refused. One code per rule. */
export type ProvenanceIssueCode =
  /** Present carrying nothing, or a mapping without `origin` or `license`. */
  | 'missing-field'
  /** Neither a string nor a mapping, or a mapping entry that is not a string. */
  | 'wrong-type'
  /** A string other than {@link FIRST_PARTY}, or a key outside {@link PROVENANCE_KEYS}. */
  | 'unknown-provenance'
  /** A `reviewed` that is not `<who> <YYYY-MM-DD>` naming a real day. */
  | 'invalid-reviewed';

/** Every code, in the order this module first documents them. */
export const PROVENANCE_ISSUE_CODES: readonly ProvenanceIssueCode[] = [
  'missing-field',
  'wrong-type',
  'unknown-provenance',
  'invalid-reviewed',
];

/** One thing a `provenance` value said that cannot be accepted. */
export interface ProvenanceIssue {
  /** Which rule was broken. */
  readonly code: ProvenanceIssueCode;
  /** `provenance`, or `provenance.<key>` for one entry of the mapping. */
  readonly field: string;
  /** A sentence a checker prints unedited, with no leading field name. */
  readonly message: string;
}

/** Who read a third-party item, and on which day. */
export interface ProvenanceReview {
  /** The reviewer, as written. */
  readonly who: string;
  /** The day, `YYYY-MM-DD`. */
  readonly date: string;
}

/** An item written here. */
export interface FirstPartyProvenance {
  readonly kind: 'first-party';
}

/** An item taken from somebody else. */
export interface ThirdPartyProvenance {
  readonly kind: 'third-party';
  /** Where it was taken from. */
  readonly origin: string;
  /** The terms it was taken under. */
  readonly license: string;
  /** Who read it and when, or null for an unreviewed item. */
  readonly reviewed: ProvenanceReview | null;
}

/** A `provenance` value that passed {@link checkProvenance}. */
export type Provenance = FirstPartyProvenance | ThirdPartyProvenance;

/** One issue, spelled once so every check reads the same. */
function issue(code: ProvenanceIssueCode, field: string, message: string): ProvenanceIssue {
  return { code, field, message };
}

/** The YAML type of `value`, for a `wrong-type` message. */
function typeName(value: unknown): string {
  if (value === null) return 'an empty value';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  if (typeof value === 'boolean') return 'a boolean';
  if (typeof value === 'number') return 'a number';
  return `a ${typeof value}`;
}

/** Whether `value` is a YAML mapping rather than a list or a scalar. */
function isMapping(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Why `text` cannot be a `reviewed` value, as a phrase completing
 * "reviewed ...", or null when it is `<who> <YYYY-MM-DD>` on a real day.
 */
export function reviewProblem(text: string): string | null {
  const match = REVIEWED_PATTERN.exec(text.trim());
  if (match === null) return 'must be a reviewer then a YYYY-MM-DD date, as `<who> <YYYY-MM-DD>`';

  const date = match[2] as string;
  const parsed = new Date(`${date}T00:00:00Z`);
  const real = !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  return real
    ? null
    : `names ${date}, which is not a day on the calendar`;
}

/** The issues for one required string entry of the mapping. */
function requiredEntry(
  value: Readonly<Record<string, unknown>>,
  key: string,
): ProvenanceIssue[] {
  const field = `${PROVENANCE_FIELD}.${key}`;
  const entry = value[key];
  if (entry === undefined || entry === null) {
    return [issue('missing-field', field, `${field} is required on a third-party item and is absent`)];
  }
  if (typeof entry !== 'string') {
    return [issue('wrong-type', field, `${field} must be a string, not ${typeName(entry)}`)];
  }
  if (entry.trim() === '') {
    return [issue('missing-field', field, `${field} is required on a third-party item and is empty`)];
  }
  return [];
}

/** The issues for the optional `reviewed` entry. */
function reviewedEntry(value: Readonly<Record<string, unknown>>): ProvenanceIssue[] {
  if (!Object.hasOwn(value, 'reviewed')) return [];

  const field = `${PROVENANCE_FIELD}.reviewed`;
  const entry = value['reviewed'];
  if (typeof entry !== 'string') {
    return [issue('wrong-type', field, `${field} must be a string, not ${typeName(entry)}`)];
  }
  const problem = reviewProblem(entry);
  return problem === null
    ? []
    : [issue('invalid-reviewed', field, `${field} "${entry}" ${problem}`)];
}

/** Every key of the mapping outside {@link PROVENANCE_KEYS}. */
function unknownKeys(value: Readonly<Record<string, unknown>>): ProvenanceIssue[] {
  const known = PROVENANCE_KEYS as readonly string[];
  const unknown = Object.keys(value).filter((key) => !known.includes(key));
  return unknown.map((key) => issue(
    'unknown-provenance',
    `${PROVENANCE_FIELD}.${key}`,
    `${key} is not a provenance key; the keys are ${PROVENANCE_KEYS.join(', ')}`,
  ));
}

/** The issues for a string `provenance`. */
function stringProblems(value: string): ProvenanceIssue[] {
  if (value.trim() === '') {
    return [issue('missing-field', PROVENANCE_FIELD, `${PROVENANCE_FIELD} is present and empty`)];
  }
  return value === FIRST_PARTY
    ? []
    : [issue(
      'unknown-provenance',
      PROVENANCE_FIELD,
      `${PROVENANCE_FIELD} "${value}" is neither ${FIRST_PARTY} nor a mapping of origin and license`,
    )];
}

/**
 * Every rule the `provenance` of `data` breaks, or none when the field
 * is absent or reads as one of the two shapes. A mapping's entries are
 * checked in {@link PROVENANCE_KEYS} order, then its unknown keys.
 */
export function checkProvenance(data: Readonly<Record<string, unknown>>): readonly ProvenanceIssue[] {
  if (!Object.hasOwn(data, PROVENANCE_FIELD)) return [];

  const value = data[PROVENANCE_FIELD];
  if (value === null) {
    return [issue('missing-field', PROVENANCE_FIELD, `${PROVENANCE_FIELD} is present and empty`)];
  }
  if (typeof value === 'string') return stringProblems(value);
  if (!isMapping(value)) {
    return [issue(
      'wrong-type',
      PROVENANCE_FIELD,
      `${PROVENANCE_FIELD} must be ${FIRST_PARTY} or a mapping, not ${typeName(value)}`,
    )];
  }

  return [
    ...REQUIRED_PROVENANCE_KEYS.flatMap((key) => requiredEntry(value, key)),
    ...reviewedEntry(value),
    ...unknownKeys(value),
  ];
}

/**
 * The `provenance` of `data`, or null when the field is absent or
 * {@link checkProvenance} refuses it, so a caller never reads a value
 * the checker did not pass.
 */
export function readProvenance(data: Readonly<Record<string, unknown>>): Provenance | null {
  if (checkProvenance(data).length > 0) return null;

  const value = data[PROVENANCE_FIELD];
  if (value === FIRST_PARTY) return { kind: 'first-party' };
  if (!isMapping(value)) return null;

  const reviewed = typeof value['reviewed'] === 'string'
    ? REVIEWED_PATTERN.exec(value['reviewed'].trim())
    : null;

  return {
    kind: 'third-party',
    origin: value['origin'] as string,
    license: value['license'] as string,
    reviewed: reviewed === null
      ? null
      : { who: reviewed[1] as string, date: reviewed[2] as string },
  };
}
