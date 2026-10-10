/**
 * Cause codes: the `<family>:<leaf>` names of known error contexts, and
 * the checks every list of them passes (#949).
 *
 * A code marks which gate tripped: the family names the gate or tool
 * (`git`, `tsc`, `fs`), the leaf the condition. Two bugs sharing a code
 * may still fail in different things, so a code raises a match score and
 * never decides it.
 *
 * Every family holds `<family>:new-context` without declaring it, for a
 * cause no leaf fits yet; `unknown:new-context` is the last resort when
 * even the family is unknown. Both reserved words are refused as declared
 * leaves, and `unknown` as a declared family, so a listed code always
 * names a real context. `context/error-codes.md` is the page for the list.
 */

/** How loud an error of the code is. */
export type ErrorLevel = 'error' | 'warn';

/** Every level, in the order a refusal names them. */
export const ERROR_LEVELS: readonly ErrorLevel[] = Object.freeze(['error', 'warn']);

/** One known error context. */
export interface ErrorCodeEntry {
  /** `<family>:<leaf>`, both kebab-case. */
  readonly code: string;
  /** One line: what the context is. */
  readonly description: string;
  /** The recommended next action. */
  readonly hint: string;
  /** How loud an error of the code is. */
  readonly level: ErrorLevel;
  /** The version or issue that added the code. */
  readonly since: string;
  /** The spelling an older per-module union gives the same context. */
  readonly legacy?: string;
}

/** A declarable code: kebab family, colon, kebab leaf. */
export const CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The leaf every family holds for a cause no leaf fits yet. */
export const NEW_CONTEXT_LEAF = 'new-context';

/** The family of the last resort, and a leaf no entry may take. */
export const UNKNOWN_FAMILY = 'unknown';

/** The text fields every entry must fill. */
const TEXT_FIELDS = ['description', 'hint', 'since'] as const;

/** What a refusal opens with. */
const PREFIX = 'error codes';

/** The part of `code` before its colon. */
export function familyOf(code: string): string {
  return code.slice(0, code.indexOf(':'));
}

/** Why `code` cannot be declared, or null when it can. */
export function codeProblem(code: string): string | null {
  if (!CODE_PATTERN.test(code)) return `${JSON.stringify(code)} is not <family>:<leaf> in kebab-case`;
  const leaf = code.slice(code.indexOf(':') + 1);
  if (leaf === NEW_CONTEXT_LEAF || leaf === UNKNOWN_FAMILY) {
    return `${JSON.stringify(code)} uses the reserved leaf ${leaf}`;
  }
  if (familyOf(code) === UNKNOWN_FAMILY) return `${JSON.stringify(code)} uses the reserved family ${UNKNOWN_FAMILY}`;
  return null;
}

/** Why the entry at `index` cannot be declared, or null. */
function entryProblem(entry: ErrorCodeEntry, index: number): string | null {
  const codeFault = codeProblem(entry.code);
  if (codeFault !== null) return `[${index}].code ${codeFault}`;
  const empty = TEXT_FIELDS.find((field) => entry[field].trim() === '');
  if (empty !== undefined) return `[${index}].${empty} is empty`;
  if (!ERROR_LEVELS.includes(entry.level)) {
    return `[${index}].level is ${JSON.stringify(entry.level)}, expected ${ERROR_LEVELS.join(' or ')}`;
  }
  return null;
}

/**
 * `entries`, frozen, once each passes the shape check and no code is
 * declared twice. Throws a `TypeError` naming the first fault: the list
 * is source, so a fault is a build error, never a reading to recover.
 */
export function defineErrorCodes(entries: readonly ErrorCodeEntry[]): readonly ErrorCodeEntry[] {
  const seen = new Map<string, number>();
  entries.forEach((entry, index) => {
    const fault = entryProblem(entry, index);
    if (fault !== null) throw new TypeError(`${PREFIX}: ${fault}`);
    const first = seen.get(entry.code);
    if (first !== undefined) {
      throw new TypeError(`${PREFIX}: ${JSON.stringify(entry.code)} is declared at [${first}] and [${index}]`);
    }
    seen.set(entry.code, index);
  });
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
}

/** True for a declared code, a declared family's new-context, or `unknown:new-context`. */
export function isKnownCode(code: string, entries: readonly ErrorCodeEntry[]): boolean {
  if (code === `${UNKNOWN_FAMILY}:${NEW_CONTEXT_LEAF}`) return true;
  if (entries.some((entry) => entry.code === code)) return true;
  return code === `${familyOf(code)}:${NEW_CONTEXT_LEAF}`
    && entries.some((entry) => familyOf(entry.code) === familyOf(code));
}
