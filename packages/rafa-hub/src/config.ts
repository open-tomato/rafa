/**
 * The hub's config reader: the four server keys `rafa-hub` reads from
 * the YAML file the {@link HUB_CONFIG_ENV} environment variable names,
 * each with its default and its reader, resolved into one frozen
 * {@link HubConfig} or refused with every problem at once as a
 * {@link HubConfigError}.
 *
 * ## The keys
 *
 * The spec for #325 names them: `hub.repository` (the `owner/name` the
 * identity adapter asks GitHub about), `hub.port` (default `7373`),
 * `hub.storePath` and `hub.auth.cacheFor` (default `10m`, from `1m` to
 * `24h`, `false` to ask GitHub on every request), with `0` and negative
 * values refused. The client's keys (`hub.url`, `hub.tokenSecret`,
 * `hub.timeout`) are core's, read by `src/config-schema-hub.ts` from a
 * project's `.rafa/config.yaml`; this file is the server's own and
 * never a project's.
 *
 * ## Readings the spec leaves to this module
 *
 *   - `hub.repository` has no default and is required: no repository is
 *     one this module could spell for every team. It is `owner/name`
 *     with GitHub's characters, kept as written; `.` and `..` are
 *     refused as a name, since GitHub holds no repository called either.
 *   - `hub.port` is a whole number from 1 to 65535. `0`, which asks the
 *     system for any free port, is refused as the spec says: a hub on a
 *     port nobody chose is one no device can be pointed at. Tests start
 *     servers on `port: 0` through `Bun.serve` directly, never here.
 *   - `hub.storePath` defaults to {@link DEFAULT_STORE_FILE} beside the
 *     config file, since the spec names no default and the file beside
 *     the config is the one place the operator already chose. A
 *     relative path is resolved against the config file's directory,
 *     never the working directory, so the hub opens one store however
 *     it is started.
 *   - `hub.auth.cacheFor` is whole digits then `s`, `m` or `h`, as core's
 *     `hub.timeout` and `claims.staleAfter` are whole digits then a
 *     unit: `1.5h`, `10M`, ` 10m` and a bare number are refused, and so
 *     is anything below `1m` or above `24h`. `false` turns the cache
 *     off; `true` names no duration and is refused.
 *   - Nothing is coerced: a port written as the string `'7373'` is
 *     refused, as core's readers refuse a string spelled like a number.
 *   - A key under `hub` or `hub.auth` that the hub does not read is
 *     refused rather than ignored: the file is the hub's alone, so an
 *     unknown key there is a misspelling (`cachefor`) that would
 *     otherwise leave a default in force without a word.
 */
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

/** The environment variable naming the hub's config file. */
export const HUB_CONFIG_ENV = 'RAFA_HUB_CONFIG';

/** The port the hub listens on when `hub.port` is left out. */
export const DEFAULT_HUB_PORT = 7373;

/** The lowest `hub.port` accepted. */
export const HUB_PORT_MIN = 1;

/** The highest `hub.port` accepted. */
export const HUB_PORT_MAX = 65_535;

/** The store file's name when `hub.storePath` is left out, beside the config file. */
export const DEFAULT_STORE_FILE = 'rafa-hub.sqlite';

/** `hub.auth.cacheFor` when it is left out. */
export const DEFAULT_CACHE_FOR = '10m';

/** The shortest `hub.auth.cacheFor` accepted, in milliseconds (`1m`). */
export const CACHE_FOR_MIN_MS = 60_000;

/** The longest `hub.auth.cacheFor` accepted, in milliseconds (`24h`). */
export const CACHE_FOR_MAX_MS = 86_400_000;

/** Milliseconds in one of each unit `hub.auth.cacheFor` takes. */
const UNIT_MS: Readonly<Record<string, number>> = Object.freeze({
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
});

/** A cache duration as written: whole digits, then one unit. */
const CACHE_FOR = /^(\d+)([smh])$/;

/** A repository as GitHub spells it: `owner/name`. */
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

/** Repository names GitHub never holds. */
const RESERVED_NAMES: readonly string[] = Object.freeze(['.', '..']);

/** The keys the hub reads under `hub`. */
const HUB_KEYS: readonly string[] = Object.freeze(['repository', 'port', 'storePath', 'auth']);

/** The keys the hub reads under `hub.auth`. */
const AUTH_KEYS: readonly string[] = Object.freeze(['cacheFor']);

/** What `hub.repository` takes, as a refusal says it. */
const REPOSITORY_EXPECTED = 'expected a GitHub repository as owner/name, such as open-tomato/rafa';

/** What `hub.port` takes, as a refusal says it. */
const PORT_EXPECTED = `expected a whole number from ${String(HUB_PORT_MIN)} to ${String(HUB_PORT_MAX)}, such as ${String(DEFAULT_HUB_PORT)}`;

/** What `hub.storePath` takes, as a refusal says it. */
const STORE_PATH_EXPECTED = 'expected a file path, such as /data/rafa-hub.sqlite';

/** What `hub.auth.cacheFor` takes, as a refusal says it. */
const CACHE_FOR_EXPECTED = 'expected a duration of whole s, m or h from 1m to 24h, such as 10m, or false to ask GitHub on every request';

/** The hub's settings, resolved. */
export interface HubConfig {
  /** The repository whose permission decides who may sync. `hub.repository`. */
  readonly repository: string;
  /** The port the hub listens on. `hub.port`. */
  readonly port: number;
  /** The absolute path of the hub's SQLite store. `hub.storePath`. */
  readonly storePath: string;
  /**
   * How long a served token's answer is kept, in milliseconds, or null
   * to ask GitHub on every request. `hub.auth.cacheFor`.
   */
  readonly cacheForMs: number | null;
}

/** The hub's config refused: every problem found, one sentence each. */
export class HubConfigError extends Error {
  override readonly name = 'HubConfigError';

  /** Every problem, each opening with the file or variable it is about. */
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(problems.join('\n'));
    this.problems = Object.freeze([...problems]);
  }
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

/** Whether `raw` is an `owner/name` GitHub could hold. */
function isRepository(raw: unknown): raw is string {
  if (typeof raw !== 'string' || !REPOSITORY.test(raw)) return false;

  const name = raw.slice(raw.indexOf('/') + 1);
  return !RESERVED_NAMES.includes(name);
}

/** Reads `hub.repository`, which has no default. */
function readRepository(path: string, raw: unknown): Reading<string> {
  if (raw === undefined) {
    return { problems: [`${path}: hub.repository is missing, ${REPOSITORY_EXPECTED}`] };
  }
  return isRepository(raw)
    ? { value: raw, problems: [] }
    : refusal(path, 'hub.repository', raw, REPOSITORY_EXPECTED);
}

/** Reads `hub.port`, {@link DEFAULT_HUB_PORT} when left out. */
function readPort(path: string, raw: unknown): Reading<number> {
  if (raw === undefined) return { value: DEFAULT_HUB_PORT, problems: [] };

  const inRange = typeof raw === 'number'
    && Number.isInteger(raw)
    && raw >= HUB_PORT_MIN
    && raw <= HUB_PORT_MAX;
  return inRange
    ? { value: raw, problems: [] }
    : refusal(path, 'hub.port', raw, PORT_EXPECTED);
}

/** Reads `hub.storePath`, resolved against the config file's directory. */
function readStorePath(path: string, raw: unknown): Reading<string> {
  const base = dirname(path);
  if (raw === undefined) return { value: resolve(base, DEFAULT_STORE_FILE), problems: [] };

  if (typeof raw !== 'string' || raw.trim() === '' || raw.trim() !== raw) {
    return refusal(path, 'hub.storePath', raw, STORE_PATH_EXPECTED);
  }
  const value = isAbsolute(raw)
    ? raw
    : resolve(base, raw);
  return { value, problems: [] };
}

/**
 * The milliseconds a `hub.auth.cacheFor` duration spells (`10m` →
 * 600000), or undefined for anything else, a value out of range included.
 */
export function cacheForMs(raw: unknown): number | undefined {
  const match = typeof raw === 'string'
    ? CACHE_FOR.exec(raw)
    : null;
  if (match === null) return undefined;

  const ms = Number(match[1]) * (UNIT_MS[match[2] ?? ''] ?? Number.NaN);
  return ms >= CACHE_FOR_MIN_MS && ms <= CACHE_FOR_MAX_MS
    ? ms
    : undefined;
}

/** Reads `hub.auth.cacheFor`: `false` turns the cache off, left out is {@link DEFAULT_CACHE_FOR}. */
function readCacheFor(path: string, raw: unknown): Reading<number | null> {
  if (raw === false) return { value: null, problems: [] };

  const ms = cacheForMs(raw === undefined
    ? DEFAULT_CACHE_FOR
    : raw);
  return ms === undefined
    ? refusal(path, 'hub.auth.cacheFor', raw, CACHE_FOR_EXPECTED)
    : { value: ms, problems: [] };
}

/** One problem per key of `section` outside `known`, named by `prefix`. */
function unknownKeys(path: string, prefix: string, section: Readonly<Record<string, unknown>>, known: readonly string[]): string[] {
  return Object.keys(section)
    .filter((key) => !known.includes(key))
    .map((key) => `${path}: ${prefix}.${key} is not a key the hub reads; expected one of ${known.map((name) => `${prefix}.${name}`).join(', ')}`);
}

/** The `hub.auth` section, or the problem that refused it. */
function authSection(path: string, raw: unknown): Reading<Readonly<Record<string, unknown>>> {
  if (raw === undefined) return { value: {}, problems: [] };
  if (!isMapping(raw)) return refusal(path, 'hub.auth', raw, 'expected a mapping holding cacheFor');

  return { value: raw, problems: unknownKeys(path, 'hub.auth', raw, AUTH_KEYS) };
}

/**
 * The {@link HubConfig} the YAML `text` read from `path` names, frozen,
 * or a {@link HubConfigError} holding every problem found. `path` opens
 * each refusal and is the directory a relative `hub.storePath` is
 * resolved against, so it should be absolute.
 */
export function parseHubConfig(text: string, path: string): HubConfig {
  let document: unknown;
  try {
    document = Bun.YAML.parse(text);
  } catch (error) {
    const reason = error instanceof Error
      ? error.message
      : String(error);
    throw new HubConfigError([`${path}: not valid YAML: ${reason}`]);
  }

  const hub = isMapping(document)
    ? document['hub']
    : undefined;
  if (!isMapping(hub)) {
    throw new HubConfigError([`${path}: hub is ${describeValue(hub)}, expected a mapping holding hub.repository`]);
  }

  const auth = authSection(path, hub['auth']);
  const repository = readRepository(path, hub['repository']);
  const port = readPort(path, hub['port']);
  const storePath = readStorePath(path, hub['storePath']);
  const cacheFor = readCacheFor(path, auth.value?.['cacheFor']);

  const problems = [
    ...unknownKeys(path, 'hub', hub, HUB_KEYS),
    ...repository.problems,
    ...port.problems,
    ...storePath.problems,
    ...auth.problems,
    ...cacheFor.problems,
  ];
  if (problems.length > 0) throw new HubConfigError(problems);

  return Object.freeze({
    repository: repository.value as string,
    port: port.value as number,
    storePath: storePath.value as string,
    cacheForMs: cacheFor.value as number | null,
  });
}

/**
 * Reads the hub's config from the file `env[`{@link HUB_CONFIG_ENV}`]`
 * names, a relative name resolved against the working directory.
 * Refuses with a {@link HubConfigError} when the variable is unset or
 * empty, when the file cannot be read, and for every problem
 * {@link parseHubConfig} finds.
 */
export async function readHubConfig(env: Readonly<Record<string, string | undefined>> = process.env): Promise<HubConfig> {
  const named = env[HUB_CONFIG_ENV];
  if (named === undefined || named.trim() === '') {
    throw new HubConfigError([`${HUB_CONFIG_ENV} is not set; expected the path of the hub's YAML config file`]);
  }

  const path = resolve(named);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const reason = error instanceof Error
      ? error.message
      : String(error);
    throw new HubConfigError([`${path}: the hub's config file could not be read: ${reason}`]);
  }
  return parseHubConfig(text, path);
}
