/**
 * The `errors` section of the config schema: `errors.codes`, the cause
 * codes a project adds to rafa's list (#949). `config-schema.ts`'s
 * `RafaConfig` extends {@link ErrorsSettings}, and its `CONFIG_DEFAULTS`
 * and `SETTINGS` spread the objects below right after the `release`
 * section. It has its own module because `config-schema.ts` stood at 643
 * lines and `config-sections.ts` at 744 when it was added.
 *
 * Each entry is read with the same rules `defineErrorCodes`
 * (`src/errors/codes.ts`) applies to rafa's list, except that `since`
 * may be left out: a project often has no version to name. Then the
 * list as a
 * whole is checked: a code given twice, or one rafa already declares, is
 * refused with both places named, so neither meaning wins silently. An
 * unknown key inside an entry is kept and warned about, as every other
 * list of mappings does.
 */

import type { SettingSpec } from './config-schema.js';
import type { Reader, Reading } from './config-sections.js';
import type { ErrorCodeEntry } from './errors/codes.js';

import { below, isMapping, listOf, oneOf, refused, refusedWith, text } from './config-sections.js';
import { codeProblem, ERROR_LEVELS } from './errors/codes.js';
import { RAFA_CODES } from './errors/rafa-codes.js';

/** The `errors` settings. */
export interface ErrorsSettings {
  /** `errors.codes`: the project's own cause codes. */
  errorsCodes: readonly ErrorCodeEntry[];
}

/** The keys one entry reads. */
export const ERROR_CODE_KEYS = ['code', 'description', 'hint', 'level', 'since'] as const;

/** {@link ERROR_CODE_KEYS} as a set, for telling an unknown key apart. */
const KNOWN_KEYS: ReadonlySet<string> = new Set(ERROR_CODE_KEYS);

/** No project codes. */
export const ERRORS_DEFAULTS: Readonly<ErrorsSettings> = Object.freeze({ errorsCodes: Object.freeze([]) });

/** A code `codeProblem` accepts. */
const codeText: Reader<string> = (raw, at) => {
  const read = text('a code, <family>:<leaf>')(raw, at);
  if (read.value === undefined) return read;
  const fault = codeProblem(read.value);
  return fault === null
    ? read
    : refused(at, raw, `a code: ${fault}`);
};

/** What each text key is for, in a refusal. */
const EXPECTED = {
  description: 'a one-line description, a non-empty string',
  hint: 'the next action, a non-empty string',
  since: 'the version or issue that added it, a non-empty string',
} as const;

/** The reading of a `since` the entry leaves out: no value, and no problem. */
const NO_SINCE: Reading<string> = { value: undefined, problems: [], extras: [] };

/** One entry: its four required keys and `since`, unknown keys kept as extras. */
const errorCodeEntry: Reader<ErrorCodeEntry> = (raw, at) => {
  if (!isMapping(raw)) return refused(at, raw, `a mapping of: ${ERROR_CODE_KEYS.join(', ')}`);
  const code = codeText(raw.code, below(at, '.code'));
  const description = text(EXPECTED.description)(raw.description, below(at, '.description'));
  const hint = text(EXPECTED.hint)(raw.hint, below(at, '.hint'));
  const level = oneOf(ERROR_LEVELS)(raw.level, below(at, '.level'));
  const since = raw.since === undefined || raw.since === null
    ? NO_SINCE
    : text(EXPECTED.since)(raw.since, below(at, '.since'));
  const problems = [code, description, hint, level, since].flatMap((reading) => reading.problems);
  const extras = Object.entries(raw)
    .filter(([key]) => !KNOWN_KEYS.has(key))
    .map(([key, value]) => ({ key: `${at.key}.${key}`, value }));
  if (
    code.value === undefined || description.value === undefined || hint.value === undefined
    || level.value === undefined || problems.length > 0
  ) return { value: undefined, problems, extras };
  const entry: ErrorCodeEntry = {
    code: code.value,
    description: description.value,
    hint: hint.value,
    level: level.value,
    ...since.value === undefined
      ? {}
      : { since: since.value },
  };
  return { value: Object.freeze(entry), problems: [], extras };
};

/** The whole list: each entry, then no code twice and none of rafa's. */
const errorCodes: Reader<readonly ErrorCodeEntry[]> = (raw, at) => {
  const read = listOf(errorCodeEntry, 'error code entries')(raw, at);
  const entries = read.value;
  if (entries === undefined) return read;
  const problems = entries.flatMap((entry, index) => {
    const label = `${below(at, `[${index}]`).label}.code is ${JSON.stringify(entry.code)}`;
    if (RAFA_CODES.some((own) => own.code === entry.code)) {
      return [`${label}, which rafa already declares; add a leaf of your own instead`];
    }
    const first = entries.findIndex((other) => other.code === entry.code);
    return first < index
      ? [`${label}, already given at [${first}]`]
      : [];
  });
  return problems.length === 0
    ? read
    : { ...refusedWith<readonly ErrorCodeEntry[]>(problems), extras: read.extras };
};

/** Every `errors` setting. */
export const ERRORS_SETTINGS: { readonly [K in keyof ErrorsSettings]: SettingSpec<K> } = {
  errorsCodes: { key: 'errors.codes', read: errorCodes, cli: false, itemKeys: ERROR_CODE_KEYS },
};
