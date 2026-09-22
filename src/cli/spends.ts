/**
 * A command's `spends` declaration: whether running it can start a Claude
 * Code session, which spends the reader's Claude usage, and under what
 * condition.
 *
 * ## The four forms
 *
 * {@link CommandSpend} is one of four forms, each with `what`, one short
 * phrase saying what the command spends:
 *
 * - `always`: every run can start a session (`plan create`).
 * - `with`: only a run carrying `flag` can (`pr triage` with `--resolve`).
 * - `unless`: every run can, except one carrying `flag` (`--no-model`).
 * - `through`: the command starts none itself, and spends when a step it
 *   runs does (`next`).
 *
 * `flag` is written as typed, with its two leading dashes; a reader
 * matching it against a run's parsed flags drops them. A command without
 * a declaration spends nothing.
 *
 * ## Checking and rendering
 *
 * {@link spendsProblem} is the shape check a command's own check calls for
 * a roster the type checker never saw, a module's command entry. Like
 * that check it reads the shape and not the content, so an empty `what`
 * passes, but a flag must be a `--` spelling, since the mark prints it.
 *
 * {@link spendsCondition} is the condition as help prints it, `with
 * --resolve` or `unless --no-model`, and null for the two forms that have
 * none. {@link spendsMark} is the mark ending a roster line: the bare
 * {@link SPENDS_GLYPH}, followed by the condition when there is one.
 */
import { describeValue } from '../config-sections.js';

/** The mark help puts on a command that spends Claude usage. */
export const SPENDS_GLYPH = '🪙';

/** The four values `when` takes. */
export const SPENDS_WHEN = ['always', 'with', 'unless', 'through'] as const;

/** One of the four forms of a declaration. */
export type SpendsWhen = (typeof SPENDS_WHEN)[number];

/** What a command spends, and when; see the module note. */
export type CommandSpend =
  | { readonly when: 'always'; readonly what: string }
  | { readonly when: 'with'; readonly flag: string; readonly what: string }
  | { readonly when: 'unless'; readonly flag: string; readonly what: string }
  | { readonly when: 'through'; readonly what: string };

/** The forms that name a flag. */
const FLAGGED: readonly SpendsWhen[] = ['with', 'unless'];

/** A flag as typed: two dashes, then a name opening on neither a dash nor a space. */
const FLAG_SPELLING = /^--[^\s-]\S*$/;

/** The expected shape of `spends.flag`, by whether the form names a flag. */
function flagProblem(when: SpendsWhen, flag: unknown): string | null {
  if (FLAGGED.includes(when)) {
    return typeof flag === 'string' && FLAG_SPELLING.test(flag)
      ? null
      : `spends.flag is ${describeValue(flag)}, expected a flag as typed, starting with --`;
  }
  return flag === undefined
    ? null
    : `spends.flag is ${describeValue(flag)}, expected absent when spends.when is "${when}"`;
}

/**
 * What keeps `value` from being a `spends` declaration, as a sentence
 * naming the field, or null when nothing does. Absent passes: a command
 * that declares nothing spends nothing.
 */
export function spendsProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `spends is ${describeValue(value)}, expected absent or a mapping`;
  }
  const { when, what, flag } = value as Record<string, unknown>;
  if (!(SPENDS_WHEN as readonly unknown[]).includes(when)) {
    return `spends.when is ${describeValue(when)}, expected one of ${SPENDS_WHEN.join(', ')}`;
  }
  if (typeof what !== 'string') {
    return `spends.what is ${describeValue(what)}, expected a string`;
  }
  return flagProblem(when as SpendsWhen, flag);
}

/**
 * The condition a declaration spends under, as help prints it:
 * `with --resolve`, `unless --no-model`, or null for `always` and
 * `through`.
 */
export function spendsCondition(spend: CommandSpend): string | null {
  switch (spend.when) {
    case 'with':
    case 'unless':
      return `${spend.when} ${spend.flag}`;
    case 'always':
    case 'through':
      return null;
  }
}

/**
 * The mark ending a spender's roster line: `🪙`, `🪙 with --resolve` or
 * `🪙 unless --no-model`.
 */
export function spendsMark(spend: CommandSpend): string {
  const condition = spendsCondition(spend);
  return condition === null
    ? SPENDS_GLYPH
    : `${SPENDS_GLYPH} ${condition}`;
}
