/**
 * Skill frontmatter v2: what a `SKILL.md` block has to say, and the
 * name every way of saying it wrong goes by.
 *
 * The block this schema reads is additive to the two fields Claude
 * Code has always read (`name`, `description`). v2 adds the fields
 * rafa's index dispatches on (`tags`, `stack`, `prevents`, `signal`,
 * `relates`, `supersedes`) and keeps the ones Claude Code's own loader
 * reads (`when_to_use`, `paths`, `disable-model-invocation`,
 * `user-invocable`), because the two mechanisms must not diverge: a
 * skill rafa names at dispatch should also be one an interactive
 * session can trigger.
 *
 * Nothing here opens a file, reads the home or throws. The input is a
 * parsed mapping — `readFrontmatterDocument` in `./frontmatter.js`
 * produces one — and the output is a list of {@link SkillIssue}, each
 * carrying a code from {@link SKILL_ISSUE_CODES}, the field it
 * concerns and a sentence a checker can print unedited. Layout,
 * path resolution and locality are the checker's own checks and are
 * deliberately absent: this module never learns where the file sat.
 *
 * ## Why every failure has a name
 *
 * The checker's exit code is a count of failing files, so the only
 * thing that tells an operator WHICH rule a file broke is the code on
 * the issue. A code is per RULE, not per field: `wrong-type` on
 * `tags[1]` and `wrong-type` on `paths` are the same rule about
 * different fields, while a `description` that is absent
 * ({@link SKILL_ISSUE_CODES} `missing-field`) and one that is 130
 * characters long (`description-too-long`) are different rules about
 * the same field. `--fix` keys off the code: a file whose only issues
 * are `missing-field` on `tags` and `stack` is the one case inference
 * can repair.
 *
 * ## The two length caps, and what a character is
 *
 * {@link DESCRIPTION_LIMIT} is 130 and {@link LISTING_LIMIT} is 1,536,
 * and both are exclusive: 129 passes, 130 fails; 1,535 passes, 1,536
 * fails. The listing cap is measured as the SUM of `description` and
 * `when_to_use`, with nothing counted for the framing Claude Code puts
 * between them, because that framing was not measured and a guess at
 * it would make a green reading here mean nothing there. The cap is
 * therefore a floor: a file this module passes may still be truncated
 * by a few characters of framing, and a file it fails is certainly
 * truncated.
 *
 * A character is a Unicode CODEPOINT ({@link countCharacters} counts
 * with `Array.from`), so an emoji counts once where `String.length`
 * counts it twice. Which unit the vendor truncates in was not
 * measured; counting codepoints is the reading that does not punish a
 * description for an accent.
 *
 * ## `paths`, and the rule Bun.Glob cannot enforce
 *
 * The spec asks that every `paths` entry be a glob `Bun.Glob` accepts.
 * Measured on Bun 1.3.14, `Bun.Glob` accepts EVERY string: `new
 * Bun.Glob('{a')`, `new Bun.Glob('[')` and `new Bun.Glob('')` all
 * construct, and `.match()` on each answers `false` rather than
 * throwing. Only a non-string argument throws (`Glob.constructor:
 * first argument is not a string`). So a check written as a
 * constructor try/catch would pass every malformed pattern silently,
 * which is the failure the checker exists to catch.
 *
 * {@link globProblem} therefore states rafa's own rule, and each part
 * of it is a measured silent failure rather than a style preference:
 *
 *   - `**\/*.{kt,kts` — an unclosed `{` — matches `src/a.kt` and NOT
 *     `src/a.kts`. Every alternative past the first is dropped, so the
 *     skill loads in half the projects it names and nobody sees a
 *     refusal.
 *   - `[abc` — an unclosed `[` — matches nothing at all, not even the
 *     literal text. The skill never loads.
 *   - `**\/*.kt}` — a `}` nothing opened — is a literal brace, so it
 *     matches only a file whose name ends in `}`. Again nothing loads.
 *
 * A backslash escapes the following character (`a\{b` matches `a{b`,
 * measured), so the scanner honours escapes, and a `]` in the first
 * position of a class is a literal (`[]]` matches `]`, measured), so
 * the scanner honours that too. The constructor try/catch is kept as a
 * belt: it cannot fire for a string on this Bun, and `skill.test.ts`
 * pins that it cannot, so the day a Bun starts refusing patterns the
 * control reddens rather than the rule silently changing hands.
 *
 * ## What the schema deliberately does not carry
 *
 * No `cost`, `confidence` or `model` field — {@link
 * FORBIDDEN_SKILL_FIELDS} names them as failures rather than ignoring
 * them, because each is a field of an INSTINCT and a skill carrying
 * one is a demotion somebody started and did not finish. `origin` is
 * not checked at all: it is an existing free-text field the demotion
 * pass reads, and a schema that constrained it would refuse the corpus
 * it has to run over.
 */

import type { StackValue } from './stack.js';

import { AGNOSTIC_STACK, isStackName, unknownStacks } from './stack.js';

/** Longest a `description` may be, exclusive: 129 passes, 130 fails. */
export const DESCRIPTION_LIMIT = 130;

/**
 * Longest `description` plus `when_to_use` may be together, exclusive:
 * 1,535 passes, 1,536 fails. Claude Code truncates the pair in its
 * skill listing at this length.
 */
export const LISTING_LIMIT = 1536;

/** The two values `signal` may take. */
export const SKILL_SIGNALS = ['loud', 'silent'] as const;

/** Whether the failure a skill prevents announces itself. */
export type SkillSignal = typeof SKILL_SIGNALS[number];

/** The fields a v2 skill cannot omit. */
export const REQUIRED_SKILL_FIELDS = ['name', 'description', 'tags', 'stack'] as const;

/**
 * Fields that belong to an instinct and never to a skill. Confidence
 * is a property of an observation, and a skill carrying one is an
 * unfinished demotion rather than a harmless extra key.
 */
export const FORBIDDEN_SKILL_FIELDS = ['confidence', 'cost', 'model'] as const;

/** The boolean fields Claude Code's loader reads. */
export const SKILL_BOOLEAN_FIELDS = ['disable-model-invocation', 'user-invocable'] as const;

/** The list-of-names fields that point at other skills. */
export const SKILL_NAME_LIST_FIELDS = ['relates', 'supersedes'] as const;

/**
 * The shape a skill name takes: lowercase alphanumerics in
 * hyphen-separated runs, with no leading, trailing or doubled hyphen.
 * Measured against the 200 skill directories in `~/.claude/skills` on
 * 2026-09-18, every one of which matches.
 */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Why a skill's frontmatter was refused. One code per RULE. */
export type SkillIssueCode =
  /** A required field is absent, or present carrying nothing. */
  | 'missing-field'
  /** A field present with a YAML type the schema cannot read. */
  | 'wrong-type'
  /** A name that is not {@link SKILL_NAME_PATTERN}-shaped. */
  | 'invalid-name'
  /** `description` at or past {@link DESCRIPTION_LIMIT}. */
  | 'description-too-long'
  /** `description` plus `when_to_use` at or past {@link LISTING_LIMIT}. */
  | 'listing-too-long'
  /** A `stack` entry outside the vocabulary, `agnostic` mixed in included. */
  | 'unknown-stack'
  /** `prevents` without `signal`, or `signal` without `prevents`. */
  | 'unpaired-prevents'
  /** `signal` outside {@link SKILL_SIGNALS}. */
  | 'unknown-signal'
  /** A `paths` entry that gates on nothing it appears to gate on. */
  | 'unusable-glob'
  /** An instinct's field on a skill; see {@link FORBIDDEN_SKILL_FIELDS}. */
  | 'forbidden-field';

/** Every code, in the order this module first documents them. */
export const SKILL_ISSUE_CODES: readonly SkillIssueCode[] = [
  'missing-field',
  'wrong-type',
  'invalid-name',
  'description-too-long',
  'listing-too-long',
  'unknown-stack',
  'unpaired-prevents',
  'unknown-signal',
  'unusable-glob',
  'forbidden-field',
];

/** One thing the frontmatter said that the schema cannot accept. */
export interface SkillIssue {
  /** Which rule was broken. */
  readonly code: SkillIssueCode;
  /**
   * The field it concerns, indexed where a list entry is at fault
   * (`tags[1]`). The listing cap names both its fields at once, as
   * `description + when_to_use`.
   */
  readonly field: string;
  /** A sentence a checker prints unedited, with no leading field name. */
  readonly message: string;
}

/**
 * A frontmatter block that passed every check, with the hyphenated
 * keys given camelCase names and every optional list defaulted, so a
 * caller never repeats the absent-versus-empty distinction the schema
 * already settled.
 */
export interface SkillFrontmatter {
  /** `name`, equal to the skill's directory name by the checker's rule. */
  readonly name: string;
  /** `description`, under {@link DESCRIPTION_LIMIT} characters. */
  readonly description: string;
  /** `tags`, free text, at least one. */
  readonly tags: readonly string[];
  /** `stack`, either `[agnostic]` or one or more vocabulary names. */
  readonly stack: readonly StackValue[];
  /** `prevents`, the failure this skill heads off, or null. */
  readonly prevents: string | null;
  /** `signal`, set exactly when `prevents` is. */
  readonly signal: SkillSignal | null;
  /** `when_to_use`, Claude Code's trigger text, or null. */
  readonly whenToUse: string | null;
  /** `paths`, the globs gating automatic loading. Empty for no gate. */
  readonly paths: readonly string[];
  /** `relates`, other skills worth reading beside this one. */
  readonly relates: readonly string[];
  /** `supersedes`, skills this one replaces. */
  readonly supersedes: readonly string[];
  /** `disable-model-invocation`, false when the key is absent. */
  readonly disableModelInvocation: boolean;
  /** `user-invocable`, false when the key is absent. */
  readonly userInvocable: boolean;
}

/** What {@link parseSkillFrontmatter} answers. */
export interface SkillCheckResult {
  /** Every rule broken, in field order. Empty on a clean block. */
  readonly issues: readonly SkillIssue[];
  /** The block read, or null when `issues` is non-empty. */
  readonly skill: SkillFrontmatter | null;
}

/**
 * The length of `text` in Unicode codepoints, which is the unit both
 * length caps are measured in.
 */
export function countCharacters(text: string): number {
  return Array.from(text).length;
}

/** Whether `value` is a usable skill name. */
export function isSkillName(value: string): boolean {
  return SKILL_NAME_PATTERN.test(value);
}

/** The string at `key`, or null when it is absent or another type. */
function stringAt(data: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string'
    ? value
    : null;
}

/**
 * What Claude Code's listing counts for this block: `description` plus
 * `when_to_use`, in codepoints, ignoring either field when it is not a
 * string. Framing between the two is not counted; see this module's
 * note on why the cap is a floor.
 */
export function listingLength(data: Readonly<Record<string, unknown>>): number {
  const description = stringAt(data, 'description') ?? '';
  const whenToUse = stringAt(data, 'when_to_use') ?? '';
  return countCharacters(description) + countCharacters(whenToUse);
}

/**
 * Why `pattern` cannot be used as a `paths` entry, as a phrase that
 * completes "the glob ...", or null when it is usable.
 *
 * Every refusal here is a pattern `Bun.Glob` ACCEPTS and then silently
 * under-matches; see this module's note for the three measured shapes.
 */
export function globProblem(pattern: string): string | null {
  if (pattern.trim() === '') return 'is empty';

  try {
    new Bun.Glob(pattern).match('');
  } catch {
    return 'is one Bun.Glob refuses';
  }

  return balanceProblem(pattern);
}

/** How far into a bracket class the scanner is. */
interface ClassState {
  /** Whether a `[` is open. */
  readonly open: boolean;
  /** Offset the open `[` sat at, for the message. */
  readonly start: number;
}

/**
 * The unbalanced brace or bracket in `pattern`, as a phrase, or null.
 * Escapes are honoured, and a `]` in the first position of a class is
 * a literal, both measured on Bun 1.3.14.
 */
function balanceProblem(pattern: string): string | null {
  let depth = 0;
  let klass: ClassState = { open: false, start: 0 };

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '\\') {
      if (index === pattern.length - 1) return 'ends in a backslash escaping nothing';
      index += 1;
      continue;
    }

    if (klass.open) {
      if (char === ']' && index > classLiteralEnd(pattern, klass.start)) {
        klass = { open: false, start: 0 };
      }
      continue;
    }

    if (char === '[') klass = { open: true, start: index };
    else if (char === '{') depth += 1;
    else if (char === '}' && depth === 0) return 'closes a } that nothing opened';
    else if (char === '}') depth -= 1;
  }

  if (klass.open) return 'leaves a [ character class unclosed, so it matches nothing';
  if (depth > 0) return 'leaves a { unclosed, so every alternative past the first is dropped';
  return null;
}

/**
 * The last offset at which a `]` is a literal rather than the close of
 * the class opened at `start`: the position after the opening `[` and
 * an optional leading `!` or `^`.
 */
function classLiteralEnd(pattern: string, start: number): number {
  const negated = pattern[start + 1] === '!' || pattern[start + 1] === '^';
  return negated
    ? start + 2
    : start + 1;
}

/** One issue, spelled once so every check reads the same. */
function issue(code: SkillIssueCode, field: string, message: string): SkillIssue {
  return { code, field, message };
}

/** Whether `value` is a string carrying something other than whitespace. */
function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The issues for a required string field: absent or blank is
 * `missing-field`, another type is `wrong-type`.
 */
function requiredString(
  data: Readonly<Record<string, unknown>>,
  field: string,
): SkillIssue[] {
  const value = data[field];
  if (value === undefined || value === null) {
    return [issue('missing-field', field, `${field} is required and is absent`)];
  }
  if (typeof value !== 'string') {
    return [issue('wrong-type', field, `${field} must be a string, not ${typeName(value)}`)];
  }
  if (value.trim() === '') {
    return [issue('missing-field', field, `${field} is required and is empty`)];
  }
  return [];
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

/** `name`: required, and shaped like a directory name. */
function checkName(data: Readonly<Record<string, unknown>>): SkillIssue[] {
  const issues = requiredString(data, 'name');
  if (issues.length > 0) return issues;

  const name = data['name'] as string;
  return isSkillName(name)
    ? []
    : [issue(
      'invalid-name',
      'name',
      `name "${name}" is not lowercase words joined by single hyphens`,
    )];
}

/** `description`: required, and under {@link DESCRIPTION_LIMIT}. */
function checkDescription(data: Readonly<Record<string, unknown>>): SkillIssue[] {
  const issues = requiredString(data, 'description');
  if (issues.length > 0) return issues;

  const length = countCharacters(data['description'] as string);
  return length < DESCRIPTION_LIMIT
    ? []
    : [issue(
      'description-too-long',
      'description',
      `description is ${length} characters, and the limit is ${DESCRIPTION_LIMIT}`,
    )];
}

/**
 * A required list of non-empty strings. The entries themselves are
 * left to the caller, which knows what a valid one looks like.
 */
function requiredStringList(
  data: Readonly<Record<string, unknown>>,
  field: string,
): SkillIssue[] {
  const value = data[field];
  if (value === undefined || value === null) {
    return [issue('missing-field', field, `${field} is required and is absent`)];
  }
  if (!Array.isArray(value)) {
    return [issue('wrong-type', field, `${field} must be a list, not ${typeName(value)}`)];
  }
  if (value.length === 0) {
    return [issue('missing-field', field, `${field} is required and is an empty list`)];
  }
  return entryTypeIssues(value, field);
}

/** A `wrong-type` issue for every entry of `values` that is not filled. */
function entryTypeIssues(values: readonly unknown[], field: string): SkillIssue[] {
  const issues: SkillIssue[] = [];
  for (const [index, entry] of values.entries()) {
    if (!isFilled(entry)) {
      issues.push(issue(
        'wrong-type',
        `${field}[${index}]`,
        `${field} entries must be non-empty strings, and this one is ${typeName(entry)}`,
      ));
    }
  }
  return issues;
}

/** `stack`: required, and drawn from the vocabulary or exactly `[agnostic]`. */
function checkStack(data: Readonly<Record<string, unknown>>): SkillIssue[] {
  const issues = requiredStringList(data, 'stack');
  if (issues.length > 0) return issues;

  const values = data['stack'] as string[];
  if (values.length > 1 && values.includes(AGNOSTIC_STACK)) {
    return [issue(
      'unknown-stack',
      'stack',
      `${AGNOSTIC_STACK} is either the whole stack list or no part of it`,
    )];
  }

  const unknown = new Set(unknownStacks(values));
  return values.flatMap((name, index) => (unknown.has(name)
    ? [issue('unknown-stack', `stack[${index}]`, `stack "${name}" is not a vocabulary name`)]
    : []));
}

/** `when_to_use`: optional, and capped with `description`. */
function checkWhenToUse(data: Readonly<Record<string, unknown>>): SkillIssue[] {
  const issues = optionalString(data, 'when_to_use');
  if (issues.length > 0) return issues;

  const length = listingLength(data);
  return length < LISTING_LIMIT
    ? []
    : [issue(
      'listing-too-long',
      'description + when_to_use',
      `description and when_to_use are ${length} characters together, `
      + `and Claude Code truncates the listing at ${LISTING_LIMIT}`,
    )];
}

/**
 * The issues for an optional string field: absent is fine, present and
 * blank is `missing-field`, another type is `wrong-type`.
 */
function optionalString(
  data: Readonly<Record<string, unknown>>,
  field: string,
): SkillIssue[] {
  if (!Object.hasOwn(data, field)) return [];
  return requiredString(data, field);
}

/** `prevents` and `signal`: written together or not at all. */
function checkTrigger(data: Readonly<Record<string, unknown>>): SkillIssue[] {
  const issues = [...optionalString(data, 'prevents'), ...optionalString(data, 'signal')];
  const hasPrevents = Object.hasOwn(data, 'prevents');
  const hasSignal = Object.hasOwn(data, 'signal');

  if (hasPrevents && !hasSignal) {
    issues.push(issue(
      'unpaired-prevents',
      'signal',
      'prevents names a failure, so signal must say whether it announces itself',
    ));
  }
  if (hasSignal && !hasPrevents) {
    issues.push(issue(
      'unpaired-prevents',
      'prevents',
      'signal describes a failure, so prevents must name the failure it describes',
    ));
  }

  const signal = stringAt(data, 'signal');
  if (signal !== null && signal.trim() !== '' && !isSkillSignal(signal)) {
    issues.push(issue(
      'unknown-signal',
      'signal',
      `signal "${signal}" is neither ${SKILL_SIGNALS.join(' nor ')}`,
    ));
  }

  return issues;
}

/** Whether `value` is one of {@link SKILL_SIGNALS}. */
function isSkillSignal(value: string): value is SkillSignal {
  return (SKILL_SIGNALS as readonly string[]).includes(value);
}

/** `relates` and `supersedes`: optional lists of skill names, possibly empty. */
function checkNameList(
  data: Readonly<Record<string, unknown>>,
  field: string,
): SkillIssue[] {
  const value = data[field];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    return [issue('wrong-type', field, `${field} must be a list, not ${typeName(value)}`)];
  }

  const issues = entryTypeIssues(value, field);
  if (issues.length > 0) return issues;

  return (value as string[]).flatMap((entry, index) => (isSkillName(entry)
    ? []
    : [issue(
      'invalid-name',
      `${field}[${index}]`,
      `${field} entry "${entry}" is not a skill name`,
    )]));
}

/** `paths`: an optional, possibly empty list of globs that gate on something. */
function checkPaths(data: Readonly<Record<string, unknown>>): SkillIssue[] {
  const value = data['paths'];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    return [issue('wrong-type', 'paths', `paths must be a list, not ${typeName(value)}`)];
  }

  const issues: SkillIssue[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string') {
      issues.push(issue(
        'wrong-type',
        `paths[${index}]`,
        `paths entries must be strings, and this one is ${typeName(entry)}`,
      ));
      continue;
    }
    const problem = globProblem(entry);
    if (problem !== null) {
      issues.push(issue('unusable-glob', `paths[${index}]`, `the glob "${entry}" ${problem}`));
    }
  }
  return issues;
}

/** A boolean field Claude Code reads: absent, or a real YAML boolean. */
function checkBoolean(
  data: Readonly<Record<string, unknown>>,
  field: string,
): SkillIssue[] {
  const value = data[field];
  if (value === undefined || typeof value === 'boolean') return [];
  return [issue(
    'wrong-type',
    field,
    `${field} must be true or false unquoted, and this is ${typeName(value)}`,
  )];
}

/** Every instinct-only field the block carries. */
function checkForbidden(data: Readonly<Record<string, unknown>>): SkillIssue[] {
  return FORBIDDEN_SKILL_FIELDS.filter((field) => Object.hasOwn(data, field)).map((field) => issue(
    'forbidden-field',
    field,
    `${field} belongs to an instinct record and never to a skill`,
  ));
}

/**
 * Every rule `data` breaks, in field order: `name`, `description`,
 * `tags`, `stack`, `when_to_use`, the `prevents`/`signal` pair,
 * `relates`, `supersedes`, `paths`, the booleans, then the forbidden
 * fields. An empty list means the block is v2.
 *
 * Every field is checked, so one pass names every offender rather than
 * the first, and a field that failed its type check contributes no
 * further issue of its own.
 */
export function checkSkillFrontmatter(
  data: Readonly<Record<string, unknown>>,
): readonly SkillIssue[] {
  return [
    ...checkName(data),
    ...checkDescription(data),
    ...requiredStringList(data, 'tags'),
    ...checkStack(data),
    ...checkWhenToUse(data),
    ...checkTrigger(data),
    ...SKILL_NAME_LIST_FIELDS.flatMap((field) => checkNameList(data, field)),
    ...checkPaths(data),
    ...SKILL_BOOLEAN_FIELDS.flatMap((field) => checkBoolean(data, field)),
    ...checkForbidden(data),
  ];
}

/** A list field's entries as strings, or the fallback when it is absent. */
function stringList(data: Readonly<Record<string, unknown>>, field: string): string[] {
  const value = data[field];
  return Array.isArray(value)
    ? value.map((entry) => String(entry))
    : [];
}

/**
 * `data` read as v2, with every issue beside it. `skill` is null
 * whenever `issues` is non-empty, so a caller reading the record never
 * has to ask which fields survived.
 */
export function parseSkillFrontmatter(
  data: Readonly<Record<string, unknown>>,
): SkillCheckResult {
  const issues = checkSkillFrontmatter(data);
  if (issues.length > 0) return { issues, skill: null };

  const signal = stringAt(data, 'signal');

  return {
    issues,
    skill: {
      name: data['name'] as string,
      description: data['description'] as string,
      tags: stringList(data, 'tags'),
      stack: stringList(data, 'stack').filter(
        (entry): entry is StackValue => entry === AGNOSTIC_STACK || isStackName(entry),
      ),
      prevents: stringAt(data, 'prevents'),
      signal: signal !== null && isSkillSignal(signal)
        ? signal
        : null,
      whenToUse: stringAt(data, 'when_to_use'),
      paths: stringList(data, 'paths'),
      relates: stringList(data, 'relates'),
      supersedes: stringList(data, 'supersedes'),
      disableModelInvocation: data['disable-model-invocation'] === true,
      userInvocable: data['user-invocable'] === true,
    },
  };
}
