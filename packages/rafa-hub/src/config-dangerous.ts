/**
 * The reader of the hub's `dangerous` section, resolved into a frozen
 * {@link HubDangerousConfig} for `config.ts` to set on its `HubConfig`,
 * or refused with every problem at once.
 *
 * ## The key
 *
 * `dangerous` is a top-level section beside `hub`, holding `hub`, which
 * holds `maxPayloadRows` (#1429): the most rows one push may carry and
 * one pull page may answer, which the hub answers as `maxPayloadRows`
 * in its contract. It is {@link DEFAULT_MAX_PAYLOAD_ROWS} when left out,
 * and `unlimited`, spelled out, lifts it. The section is named
 * `dangerous` because a larger cap, or none, lets one request hold the
 * hub's memory for its whole length; `bin.ts` prints one warning line at
 * start for a value above the default or `unlimited`
 * ({@link isDangerousPayloadCap}).
 *
 * ## Readings the spec leaves to this module
 *
 *   - `maxPayloadRows` is a whole number from 1 up, as YAML writes a
 *     number, or the string `unlimited`. `0` and `-1` are refused, as the
 *     spec says, and so is every other number below 1, a fraction
 *     (`1.5`), a number past `Number.MAX_SAFE_INTEGER`, and any other
 *     spelling of no cap (`Unlimited`, `none`, `null`, `false`).
 *   - Nothing is coerced: `'50000'`, written as a string, is refused, as
 *     `config.ts` refuses a port spelled as one.
 *   - `unlimited` resolves to null, the `maxPayloadRows: null` the hub's
 *     contract answers for no cap.
 *   - A key under `dangerous` or `dangerous.hub` that the hub does not
 *     read is refused, as one under `hub` is: a misspelt
 *     `maxPayloadRow` would otherwise leave the default in force without
 *     a word. Other top-level sections beside `hub` and `dangerous` are
 *     not this module's to judge.
 *
 * `config.ts` imports this module, so this one takes nothing from it,
 * and its few helpers are its own, as `config-store.ts`'s are.
 */

/** `dangerous.hub.maxPayloadRows` when it is left out. */
export const DEFAULT_MAX_PAYLOAD_ROWS = 50_000;

/** The spelling of `dangerous.hub.maxPayloadRows` that lifts the cap. */
export const UNLIMITED_PAYLOAD_ROWS = 'unlimited';

/** The key's full name, as a refusal and the start's warning name it. */
export const MAX_PAYLOAD_ROWS_KEY = 'dangerous.hub.maxPayloadRows';

/** The keys the hub reads under `dangerous`. */
const DANGEROUS_KEYS: readonly string[] = Object.freeze(['hub']);

/** The keys the hub reads under `dangerous.hub`. */
const DANGEROUS_HUB_KEYS: readonly string[] = Object.freeze(['maxPayloadRows']);

/** What `dangerous.hub.maxPayloadRows` takes, as a refusal says it. */
const MAX_PAYLOAD_ROWS_EXPECTED = `expected a whole number from 1 up, such as ${String(DEFAULT_MAX_PAYLOAD_ROWS)}, or ${UNLIMITED_PAYLOAD_ROWS}`;

/** The hub's `dangerous` section, resolved. */
export interface HubDangerousConfig {
  /**
   * The most rows one push may carry and one pull page may answer, or
   * null for no cap. `dangerous.hub.maxPayloadRows`.
   */
  readonly maxPayloadRows: number | null;
}

/** The section's reading: its value, or the problems that refused it. */
export interface DangerousReading {
  readonly value?: HubDangerousConfig;
  readonly problems: readonly string[];
}

/** One key's reading: its value, or the problems that refused it. */
interface Reading<T> {
  readonly value?: T;
  readonly problems: readonly string[];
}

/** How a refusal shows the value it refused. */
function describeValue(raw: unknown): string {
  return typeof raw === 'string'
    ? JSON.stringify(raw)
    : String(raw);
}

/** A refusal of `raw` at `key` in `path`, naming what was expected. */
function refusal<T>(path: string, key: string, raw: unknown, expected: string): Reading<T> {
  return { problems: [`${path}: ${key} is ${describeValue(raw)}, ${expected}`] };
}

/** Whether `raw` is a YAML mapping, rather than a list, a scalar or null. */
function isMapping(raw: unknown): raw is Readonly<Record<string, unknown>> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/**
 * The section at `key`, or the problem that refused it: a mapping
 * holding only `known`, empty when left out.
 */
function section(path: string, key: string, raw: unknown, known: readonly string[]): Reading<Readonly<Record<string, unknown>>> {
  if (raw === undefined) return { value: {}, problems: [] };
  if (!isMapping(raw)) return refusal(path, key, raw, `expected a mapping holding ${known.join(', ')}`);

  const unknown = Object.keys(raw)
    .filter((name) => !known.includes(name))
    .map((name) => `${path}: ${key}.${name} is not a key the hub reads; expected one of ${known.map((each) => `${key}.${each}`).join(', ')}`);
  return { value: raw, problems: unknown };
}

/** Reads `dangerous.hub.maxPayloadRows`: a whole number from 1 up, null for `unlimited`, the default when left out. */
function readMaxPayloadRows(path: string, raw: unknown): Reading<number | null> {
  if (raw === undefined) return { value: DEFAULT_MAX_PAYLOAD_ROWS, problems: [] };
  if (raw === UNLIMITED_PAYLOAD_ROWS) return { value: null, problems: [] };

  const isCap = typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 1;
  return isCap
    ? { value: raw, problems: [] }
    : refusal(path, MAX_PAYLOAD_ROWS_KEY, raw, MAX_PAYLOAD_ROWS_EXPECTED);
}

/**
 * Reads the top-level `dangerous` section of the config file at `path`,
 * every problem of it at once; left out, every key takes its default.
 */
export function readDangerousConfig(path: string, raw: unknown): DangerousReading {
  const dangerous = section(path, 'dangerous', raw, DANGEROUS_KEYS);
  if (dangerous.value === undefined) return { problems: dangerous.problems };

  const hub = section(path, 'dangerous.hub', dangerous.value['hub'], DANGEROUS_HUB_KEYS);
  const maxPayloadRows = readMaxPayloadRows(path, hub.value?.['maxPayloadRows']);

  const problems = [...dangerous.problems, ...hub.problems, ...maxPayloadRows.problems];
  return problems.length > 0
    ? { problems }
    : { value: Object.freeze({ maxPayloadRows: maxPayloadRows.value as number | null }), problems: [] };
}

/**
 * Whether the cap `maxPayloadRows` (null for `unlimited`) is one the
 * hub warns about at start: none at all, or one above
 * {@link DEFAULT_MAX_PAYLOAD_ROWS}.
 */
export function isDangerousPayloadCap(maxPayloadRows: number | null): boolean {
  return maxPayloadRows === null || maxPayloadRows > DEFAULT_MAX_PAYLOAD_ROWS;
}
