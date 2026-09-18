/**
 * The pinned resolve plans: where they are found, and how one is filled
 * for the pull request it is about to be run against.
 *
 * `rafa pr triage --resolve` does not ask a model how to clear a
 * mechanical failure; it runs a plan that already says how
 * (`.specs/rafa-20-pr-commands.md`). One plan ships per SIMPLE triage
 * class, beside this module in `src/pr/plans/`, and the ORDINARY loop
 * runs it, so its commits, its reports and its effort rows are the
 * usual ones. This module is the seam between the two: it answers the
 * plan's text for a class, with the pull-request-specific values
 * already substituted, and it knows nothing about worktrees, budgets or
 * attempts.
 *
 * ## Where a plan is looked for, and why in that order
 *
 * `src/plan.ts`'s `readPlanFormat` is the shape this copies, for the
 * same reason. `bun build` bundles TypeScript only, so the markdown has
 * to be COPIED into `dist/` by the build script, and a module inlined
 * into a bundle answers the BUNDLE's directory from `import.meta.url` —
 * `dist/`, where `cli.js` sits, and not `dist/pr/plans/`. So:
 *
 *   1. `<moduleDir>/plans/<name>.md`, which is
 *      `dist/plans/<name>.md` in a build: the directory this one is
 *      copied to, beside `cli.js`. {@link PINNED_PLANS_DIRNAME} is that
 *      directory's name, spelled here so the build script and the
 *      reader name it once.
 *   2. `<moduleDir>/<name>.md`, which is this module's own directory
 *      when it runs from the checkout, where the plans sit beside the
 *      source that reads them.
 *
 * Neither candidate is reachable from the other layout: a checkout has
 * no `src/pr/plans/plans/`, and a build has no markdown loose in
 * `dist/`, so the order costs one `existsSync` and never picks the
 * wrong copy. {@link readPinnedPlan} names BOTH paths when it finds
 * neither, because the way this fails in the field is a build that
 * dropped the copy step, and a message naming only the checkout path
 * sends the reader to a file that is there.
 *
 * ## The slots, and why `{agent=…}` is not one
 *
 * A plan is a template with `{SLOT}` tokens in it. A plan document
 * ALREADY uses braces for something else: `{agent=loop-implementer}` is
 * the declaration the loop routes a task by (`context/workflow.md`), and
 * a fill that treated it as an unfilled slot would refuse every plan
 * that ships. So a slot is UPPER_SNAKE and nothing else
 * ({@link SLOT_PATTERN}): `{CONFLICT_FILES}` is a slot,
 * `{agent=loop-implementer}` is not, and no spelling of an agent name
 * can become one, since the grammar puts `agent=` at its head in lower
 * case.
 *
 * {@link fillPinnedPlan} therefore refuses a template with an
 * UPPER_SNAKE token left in it after the substitution. That refusal is
 * the point of the pattern: a slot renamed in the markdown and not here
 * would otherwise ship a plan telling an agent to resolve
 * `{CONFLICT_FILES}`, which reads like an instruction and is not one.
 *
 * Substitution goes through a REPLACER FUNCTION rather than a string
 * replacement. `String.replaceAll` reads `$&`, `$'`, `` $` `` and `$1`
 * out of a string replacement, so a conflicting path or a log line
 * holding a dollar sign would be rewritten into something else; a
 * function replacement is handed the value verbatim. A case drives a
 * value of `$&` through to hold that.
 *
 * A value handed for a slot the template does not carry is silently
 * unused, which is what lets one value map serve all four plans: only
 * the two conflict plans carry `{CONFLICT_SENTENCE}`, and the two CI
 * plans carry no slot at all and come back byte-identical.
 *
 * ## Filled from the triage block, and from ONE conflict sentence
 *
 * {@link pinnedPlanValues} reads its values out of the `rafa:triage`
 * block the last assessment stored in the pull request's comment
 * (`../triage/comment.ts`), which is the only record of what was
 * classified and from which files. Every field of that block is
 * nullable — it is parsed back out of a comment an older rafa may have
 * written, or a person may have edited — so each slot has a stated
 * answer for a null: {@link NO_CONFLICT_FILES} stands in for files that
 * were not recorded, and it is a sentence telling the agent where to
 * look rather than an empty string, because an empty string would read
 * as a plan that had nothing to say.
 *
 * The class is taken as an ARGUMENT and not from `block.class`. That
 * field is verbatim untrusted text by contract, so that an unknown word
 * is still reported; the caller resolving which plan to run has a
 * checked {@link TriageClass} in hand already, and letting the block
 * pick the file would mean a hand-edited comment choosing which plan
 * runs.
 *
 * The conflict sentence is NOT written here. It lives in
 * `../conflict-sentence.ts`, the one source `buildWrapUpPrompt`
 * (`src/start/wrap-up.ts`) reads it from as well: the wrap-up prompt
 * and these plans must say the same thing about a mechanical conflict,
 * and the only way two readers cannot drift is one source. This module
 * is a reader of that source, not a second copy of it.
 *
 * `PinnedPlanFill.conflictSentence` stays an OPTIONAL override of that
 * default so a case can drive a sentence it can tell apart from the
 * shipped one — a fill test asserting the default text would pass on a
 * module that inlined its own copy of it, because the two strings would
 * be equal. Nothing in the product passes it.
 */
import type { TriageClass } from '../triage/classes.js';
import type { TriageBlock } from '../triage/comment.js';

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MECHANICAL_CONFLICT_SENTENCE } from '../conflict-sentence.js';
import { DEPENDENCY_BUMP_SIMPLE_CLASSES, SIMPLE_TRIAGE_CLASSES } from '../triage/classes.js';

/** This module's own directory, the default both lookups start from. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * The directory the build copies these plans to, beside `cli.js`; see
 * the module note on where a plan is looked for.
 */
export const PINNED_PLANS_DIRNAME = 'plans';

/**
 * Every class a pinned plan ships for: exactly the classes
 * `isSimpleTriageClass` can answer true for, in `TRIAGE_CLASSES` order.
 *
 * Derived from the two lists in `../triage/classes.ts` rather than
 * written out again, so a fifth simple class added there is a class this
 * module claims a plan for — and `load.test.ts` reads the directory, so
 * the claim fails loudly at that point instead of at the first resolve.
 */
export const PINNED_PLAN_CLASSES: readonly TriageClass[] = Object.freeze([
  ...SIMPLE_TRIAGE_CLASSES,
  ...DEPENDENCY_BUMP_SIMPLE_CLASSES,
]);

/** The name a class's plan file carries, without its directory. */
export function pinnedPlanFileName(triageClass: TriageClass): string {
  return `resolve-${triageClass}.md`;
}

/** Whether a pinned plan ships for a class; see {@link PINNED_PLAN_CLASSES}. */
export function hasPinnedPlan(triageClass: TriageClass): boolean {
  return PINNED_PLAN_CLASSES.includes(triageClass);
}

/**
 * Where a class's plan is looked for, in order: the build's copy beside
 * `cli.js`, then this module's own directory in a checkout.
 *
 * @param moduleDir The directory the reader starts from, normally the
 * directory of whichever file `import.meta.url` resolved to.
 */
export function pinnedPlanCandidates(
  moduleDir: string,
  triageClass: TriageClass,
): string[] {
  const name = pinnedPlanFileName(triageClass);
  return [
    join(moduleDir, PINNED_PLANS_DIRNAME, name),
    join(moduleDir, name),
  ];
}

/** What a plan lookup may be pointed at another directory with. */
export interface PinnedPlanLookup {
  /** Where to look from; this module's own directory unless given. */
  readonly moduleDir?: string | undefined;
}

/**
 * The unfilled text of a class's pinned plan, from the first of
 * {@link pinnedPlanCandidates} that exists.
 *
 * @throws Error when the class ships no plan, naming the classes that
 * do, or when no candidate exists, naming every path it looked at.
 */
export function readPinnedPlan(
  triageClass: TriageClass,
  lookup: PinnedPlanLookup = {},
): string {
  if (!hasPinnedPlan(triageClass)) {
    throw new Error(
      `No pinned resolve plan ships for ${triageClass}; `
      + `one ships for ${PINNED_PLAN_CLASSES.join(', ')}`,
    );
  }
  const candidates = pinnedPlanCandidates(lookup.moduleDir ?? MODULE_DIR, triageClass);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      `The pinned resolve plan for ${triageClass} is missing: `
      + `no file at ${candidates.join(' or ')}`,
    );
  }
  return readFileSync(found, 'utf8');
}

/**
 * What a slot looks like: `{` then UPPER_SNAKE then `}`, which
 * `{agent=loop-implementer}` is not. See the module note.
 */
const SLOT_PATTERN = /\{[A-Z][A-Z0-9_]*\}/g;

/** The slot the two conflict plans carry the shared conflict sentence in. */
export const CONFLICT_SENTENCE_SLOT = 'CONFLICT_SENTENCE';

/** The slot the two conflict plans carry the conflicting paths in. */
export const CONFLICT_FILES_SLOT = 'CONFLICT_FILES';

/**
 * What stands in for the conflicting paths when the triage block
 * recorded none; see the module note on nullable fields.
 */
export const NO_CONFLICT_FILES = 'the paths `git status` reports as conflicted';

/**
 * A template with every `{SLOT}` replaced by its value.
 *
 * A value for a slot the template does not carry is unused. A slot the
 * values do not cover is an error, not an empty string.
 *
 * @throws Error when a slot is left unfilled, naming it.
 */
export function fillPinnedPlan(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  const missing: string[] = [];
  const filled = template.replaceAll(SLOT_PATTERN, (token) => {
    const name = token.slice(1, -1);
    const value = values[name];
    if (value === undefined) {
      missing.push(token);
      return token;
    }
    return value;
  });
  if (missing.length > 0) {
    throw new Error(`The pinned resolve plan has unfilled slots: ${missing.join(', ')}`);
  }
  return filled;
}

/** What one pinned plan is filled from. */
export interface PinnedPlanFill {
  /** The `rafa:triage` block the last assessment stored, fields and all. */
  readonly block: TriageBlock;
  /**
   * An override of {@link MECHANICAL_CONFLICT_SENTENCE}, the sentence
   * the wrap-up prompt reads from the same module. Omitted outside
   * tests; see the module note.
   */
  readonly conflictSentence?: string | undefined;
}

/** The conflicting paths as a plan spells them: each in backticks, comma-joined. */
function conflictFiles(files: readonly string[] | null): string {
  if (files === null || files.length === 0) return NO_CONFLICT_FILES;
  return files.map((file) => `\`${file}\``).join(', ');
}

/**
 * The slot values one fill answers, keyed by slot name.
 *
 * Exported beside {@link fillPinnedPlan} so a caller with more to
 * substitute than a triage block holds — a CI log excerpt, say — spreads
 * these and adds its own rather than threading it through here.
 */
export function pinnedPlanValues(fill: PinnedPlanFill): Record<string, string> {
  return {
    [CONFLICT_SENTENCE_SLOT]: fill.conflictSentence ?? MECHANICAL_CONFLICT_SENTENCE,
    [CONFLICT_FILES_SLOT]: conflictFiles(fill.block.files),
  };
}

/**
 * A class's pinned plan, read and filled: the text `rafa pr triage
 * --resolve` hands to the loop.
 *
 * @throws Error when the class ships no plan, when no copy of it is
 * found, or when it carries a slot these values do not cover.
 */
export function loadPinnedPlan(
  triageClass: TriageClass,
  fill: PinnedPlanFill,
  lookup: PinnedPlanLookup = {},
): string {
  return fillPinnedPlan(readPinnedPlan(triageClass, lookup), pinnedPlanValues(fill));
}
