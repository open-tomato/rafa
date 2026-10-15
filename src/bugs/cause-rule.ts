/**
 * The cause rule: what a bug the loop files carries as its cause, read
 * from the `cause` a session reported (#991).
 *
 * `rafa issue create --type=bug` refuses a cause the list lacks; triage
 * never refuses a report over its bug fields, so this rule answers a
 * cause the record accepts for every input and keeps the session's own
 * word beside it: as `proposed` when it is shaped like a code, as
 * `suspected` when it is not. Each row of the rule, in the order it is
 * read:
 *
 * - null or blank: `unknown:new-context`, no proposal, no suspected.
 * - a code whose `cause:` label would pass GitHub's 50 characters:
 *   `<family>:new-context`, the code kept as `proposed`.
 * - a code of the list: used as written.
 * - shaped `<family>:<leaf>` with a family the list has and a leaf it
 *   lacks: `<family>:new-context`, the code kept as `proposed`.
 * - shaped with a family the list lacks: `unknown:new-context`, the code
 *   kept as `proposed`.
 * - anything else: `unknown:new-context`, the text kept as `suspected`.
 *
 * A shaped value no list could declare (`codeProblem`: a reserved leaf
 * or the `unknown` family) names no leaf to propose, so it is read as
 * anything else. A `<family>:new-context` whose own label would pass the
 * cap falls back to `unknown:new-context`. The function is pure: the
 * text it keeps is the trimmed input, and redacting it is the caller's.
 */
import type { ErrorCodeEntry } from '../errors/codes.js';

import { GITHUB_LABEL_MAX_LENGTH, GITHUB_LABELS } from '../adapters/tracker/github.js';
import { CODE_PATTERN, codeProblem, familyOf, isKnownCode, NEW_CONTEXT_LEAF, UNKNOWN_FAMILY } from '../errors/codes.js';

/** What the rule answers for one reported cause. */
export interface CauseReading {
  /** The cause the record carries: a known code, or a `new-context` one. */
  readonly cause: string;
  /** The code the session reported, beside a `new-context` cause. */
  readonly proposed: string | null;
  /** The session's text, when it was no code at all. */
  readonly suspected: string | null;
}

/** The cause of the last resort. */
const LAST_RESORT = `${UNKNOWN_FAMILY}:${NEW_CONTEXT_LEAF}`;

/** True when `code`'s `cause:` label fits GitHub's cap on a label's name. */
function labelFits(code: string): boolean {
  return GITHUB_LABELS.causePrefix.length + code.length <= GITHUB_LABEL_MAX_LENGTH;
}

/** `<family>:new-context` for `code`'s family, or the last resort when its label would not fit. */
function familyNewContext(code: string): string {
  const cause = `${familyOf(code)}:${NEW_CONTEXT_LEAF}`;
  return labelFits(cause)
    ? cause
    : LAST_RESORT;
}

/**
 * The cause, proposal and suspected text a bug is filed with, for the
 * `reported` cause of a session and the merged code list `codes` (rafa's
 * and the project's, as `bugRulesOf` answers them).
 */
export function causeOf(reported: string | null, codes: readonly ErrorCodeEntry[]): CauseReading {
  const text = reported?.trim() ?? '';
  if (text === '') return { cause: LAST_RESORT, proposed: null, suspected: null };
  const declarable = CODE_PATTERN.test(text) && codeProblem(text) === null;
  if (!declarable && !isKnownCode(text, codes)) return { cause: LAST_RESORT, proposed: null, suspected: text };
  if (!labelFits(text)) return { cause: familyNewContext(text), proposed: text, suspected: null };
  if (isKnownCode(text, codes)) return { cause: text, proposed: null, suspected: null };
  const familyListed = codes.some((entry) => familyOf(entry.code) === familyOf(text));
  return familyListed
    ? { cause: familyNewContext(text), proposed: text, suspected: null }
    : { cause: LAST_RESORT, proposed: text, suspected: null };
}
