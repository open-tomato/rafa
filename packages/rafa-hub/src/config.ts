/**
 * The hub's config reader: the fourteen server keys `rafa-hub` reads from
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
 * values refused. The spec for #1428 adds two: `hub.store.sqliteLibrary`
 * (no default; the path of a vanilla `libsqlite3` that turns the index's
 * vector half on for a macOS hub) and `hub.index.rebuildAfterPush`
 * (default `true`; `false` leaves the index to `rafa-hub index
 * rebuild`). The spec for #1431 adds `hub.projects`, the list of
 * projects the hub serves, and `hub.auth.adapter` with
 * `hub.auth.apiKeys`, which choose how a caller is identified (see
 * below). The spec for #1433 adds `hub.auth.login`, the login that
 * guards the key routes under `api-key`, read by `config-login.ts`
 * (whose TSDoc holds its readings). The spec for #1429 adds four, read
 * with the rest of `hub.store` and `hub.index` by `config-store.ts`
 * (whose TSDoc holds their readings): `hub.store.engine` (default
 * `sqlite`), `hub.store.postgres.urlVariable` (default `POSTGRES_URL`
 * under `postgres`), `hub.index.embedding.model` (no default; vectors
 * off) and `hub.index.embedding.precision` (default `half`). The
 * client's keys (`hub.url`, `hub.tokenSecret`, `hub.timeout`) are
 * core's, read by `packages/rafa/src/config-schema-hub.ts` from a
 * project's `.rafa/config.yaml`; this file is the server's own and
 * never a project's.
 *
 * ## Readings the spec leaves to this module
 *
 *   - `hub.repository` has no default and is required when
 *     `hub.projects` is left out: no repository is one this module could
 *     spell for every team. It is `owner/name`
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
 *   - `hub.projects` is a non-empty list of mappings holding exactly
 *     `id` (the project's root commit sha, 40 lowercase hex characters,
 *     as git prints it and a device sends it), `name` (any non-empty
 *     text), `repository` (read as `hub.repository` is) and `storePath`
 *     (required, read and resolved as `hub.storePath` is). Two entries
 *     with one `id`, or two whose `storePath` resolves to one file, are
 *     refused, so one store file never holds two projects. Set, it
 *     replaces `hub.repository` and `hub.storePath`, and either key
 *     beside it is refused rather than one silently winning; the
 *     config's own `repository` and `storePath` are then the first
 *     listed project's. Left out, the hub serves one default project,
 *     {@link DEFAULT_PROJECT_ID}, named `hub.repository`, in
 *     `hub.storePath`: the single-project hub of before #1431.
 *   - `hub.auth.adapter` is `github` (the default, asking GitHub about
 *     each token's permission) or `api-key`, and nothing else.
 *     `hub.auth.apiKeys` is a list of environment variable names, each
 *     matching `^[A-Z_][A-Z0-9_]*$`, and never the keys themselves: the
 *     `api-key` adapter reads the named variables at start. It is
 *     required and non-empty under `api-key`, and refused under
 *     `github`, where nothing would read it. Since a value written
 *     there may be a key pasted in place of its name, no refusal under
 *     `hub.auth.apiKeys` repeats what was written: an entry that is no
 *     variable name is named by its position (`hub.auth.apiKeys[1]`)
 *     alone, and a value that is no list by its kind. Left out under
 *     `github`, it is empty.
 *   - Nothing is coerced: a port written as the string `'7373'` is
 *     refused, as core's readers refuse a string spelled like a number.
 *   - `hub.auth.login` is read by `config-login.ts`: refused under
 *     `github`, null there when left out, and `basic` when left out
 *     under `api-key`.
 *   - A key under `hub` or `hub.auth` that the hub does not read is
 *     refused rather than ignored, as `config-store.ts` refuses one under
 *     `hub.store` and `hub.index`: the file is the hub's alone, so an
 *     unknown key there is a misspelling (`cachefor`) that would
 *     otherwise leave a default in force without a word.
 */
import type { HubLoginConfig } from './config-login.js';
import type { HubIndexConfig, HubStoreConfig } from './config-store.js';

import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { readLoginConfig } from './config-login.js';
import { readIndexConfig, readStoreConfig } from './config-store.js';

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

/** A root commit sha as git prints it: 40 lowercase hex characters, a project's id on the wire. */
export const ROOT_COMMIT: RegExp = /^[0-9a-f]{40}$/;

/** The id of the one project a hub serves when `hub.projects` is left out. */
export const DEFAULT_PROJECT_ID = 'default';

/** The adapters `hub.auth.adapter` takes, in the order a refusal names them. */
export const HUB_AUTH_ADAPTERS: readonly HubAuthAdapter[] = Object.freeze(['github', 'api-key']);

/** How the hub identifies a caller: `hub.auth.adapter`. */
export type HubAuthAdapter = 'github' | 'api-key';

/** `hub.auth.adapter` when it is left out. */
export const DEFAULT_AUTH_ADAPTER: HubAuthAdapter = 'github';

/** An environment variable name, as `hub.auth.apiKeys` takes each entry. */
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

/** The keys the hub reads under `hub`. */
const HUB_KEYS: readonly string[] = Object.freeze(['repository', 'port', 'storePath', 'projects', 'auth', 'store', 'index']);

/** The keys the hub reads in each entry of `hub.projects`. */
const PROJECT_KEYS: readonly string[] = Object.freeze(['id', 'name', 'repository', 'storePath']);

/** The keys the hub reads under `hub.auth`. */
const AUTH_KEYS: readonly string[] = Object.freeze(['adapter', 'apiKeys', 'cacheFor', 'login']);

/** What `hub.repository` takes, as a refusal says it. */
const REPOSITORY_EXPECTED = 'expected a GitHub repository as owner/name, such as open-tomato/rafa';

/** What `hub.port` takes, as a refusal says it. */
const PORT_EXPECTED = `expected a whole number from ${String(HUB_PORT_MIN)} to ${String(HUB_PORT_MAX)}, such as ${String(DEFAULT_HUB_PORT)}`;

/** What `hub.storePath` takes, as a refusal says it. */
const STORE_PATH_EXPECTED = 'expected a file path, such as /data/rafa-hub.sqlite';

/** What `hub.projects` takes, as a refusal says it. */
const PROJECTS_EXPECTED = 'expected a non-empty list of projects, each a mapping holding id, name, repository and storePath';

/** What a project's `id` takes, as a refusal says it. */
const PROJECT_ID_EXPECTED = 'expected the project\'s root commit sha, 40 lowercase hex characters';

/** What a project's `name` takes, as a refusal says it. */
const PROJECT_NAME_EXPECTED = 'expected a non-empty name, such as rafa';

/** What `hub.auth.cacheFor` takes, as a refusal says it. */
const CACHE_FOR_EXPECTED = 'expected a duration of whole s, m or h from 1m to 24h, such as 10m, or false to ask GitHub on every request';

/** What `hub.auth.adapter` takes, as a refusal says it. */
const ADAPTER_EXPECTED = 'expected github or api-key';

/** What `hub.auth.apiKeys` takes, as a refusal says it. */
const API_KEYS_EXPECTED = 'expected a non-empty list of environment variable names, such as RAFA_HUB_KEY';

/** What an entry of `hub.auth.apiKeys` takes, as a refusal says it. */
const API_KEY_NAME_EXPECTED = 'expected an environment variable name of A-Z, 0-9 and _, not opening with a digit, such as RAFA_HUB_KEY; the value written is not repeated';

/** One project the hub serves: an entry of `hub.projects`, or the default one. */
export interface HubProject {
  /**
   * The project's root commit sha, as a device names it on the wire, or
   * {@link DEFAULT_PROJECT_ID} for the one project of a hub with
   * `hub.projects` left out.
   */
  readonly id: string;
  /** The name `/v1/status` answers for it; `hub.repository` for the default project. */
  readonly name: string;
  /** The `owner/name` whose permission decides who may sync it. */
  readonly repository: string;
  /** The absolute path of its SQLite store, resolved against the config file's directory. */
  readonly storePath: string;
}

/**
 * The hub's settings, resolved: the keys of `hub.store` and `hub.index`,
 * read by `config-store.ts`, beside the ones below.
 */
export interface HubConfig extends HubStoreConfig, HubIndexConfig {
  /**
   * The repository whose permission decides who may sync. `hub.repository`,
   * or the first listed project's when `hub.projects` is set.
   */
  readonly repository: string;
  /** The port the hub listens on. `hub.port`. */
  readonly port: number;
  /**
   * The absolute path of the hub's SQLite store. `hub.storePath`, or the
   * first listed project's when `hub.projects` is set.
   */
  readonly storePath: string;
  /**
   * The projects the hub serves, in the order listed, never empty:
   * `hub.projects`, or one {@link DEFAULT_PROJECT_ID} project named
   * `hub.repository` in `hub.storePath` when it is left out.
   */
  readonly projects: readonly HubProject[];
  /**
   * How long a served token's answer is kept, in milliseconds, or null
   * to ask GitHub on every request. `hub.auth.cacheFor`.
   */
  readonly cacheForMs: number | null;
  /** How the hub identifies a caller. `hub.auth.adapter`. */
  readonly authAdapter: HubAuthAdapter;
  /**
   * The names of the environment variables holding the keys the
   * `api-key` adapter serves, in the order listed, never their values;
   * empty under `github`. `hub.auth.apiKeys`.
   */
  readonly apiKeys: readonly string[];
  /**
   * The login guarding the key routes, or null under `github`, where
   * neither exists. `hub.auth.login`, read by `config-login.ts`.
   */
  readonly login: HubLoginConfig | null;
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
  if (raw === undefined) return { value: resolve(dirname(path), DEFAULT_STORE_FILE), problems: [] };

  return readFilePath(path, 'hub.storePath', raw);
}

/** Reads the store file path at `key`, resolved against the config file's directory. */
function readFilePath(path: string, key: string, raw: unknown): Reading<string> {
  const base = dirname(path);
  if (typeof raw !== 'string' || raw.trim() === '' || raw.trim() !== raw) {
    return refusal(path, key, raw, STORE_PATH_EXPECTED);
  }
  const value = isAbsolute(raw)
    ? raw
    : resolve(base, raw);
  return { value, problems: [] };
}

/** The problem of a project field at `key` left out, naming what it takes. */
function missing<T>(path: string, key: string, expected: string): Reading<T> {
  return { problems: [`${path}: ${key} is missing, ${expected}`] };
}

/** Reads the project entry `raw` at `key` (`hub.projects[0]`), every problem of it at once. */
function readProject(path: string, key: string, raw: unknown): Reading<HubProject> {
  if (!isMapping(raw)) return refusal(path, key, raw, `expected a mapping holding ${PROJECT_KEYS.join(', ')}`);

  const field = <T>(name: string, expected: string, read: (value: unknown) => Reading<T>): Reading<T> => {
    const value = raw[name];
    return value === undefined
      ? missing(path, `${key}.${name}`, expected)
      : read(value);
  };
  const id = field('id', PROJECT_ID_EXPECTED, (value) => typeof value === 'string' && ROOT_COMMIT.test(value)
    ? { value, problems: [] }
    : refusal(path, `${key}.id`, value, PROJECT_ID_EXPECTED));
  const name = field('name', PROJECT_NAME_EXPECTED, (value) => typeof value === 'string' && value.trim() !== ''
    ? { value, problems: [] }
    : refusal(path, `${key}.name`, value, PROJECT_NAME_EXPECTED));
  const repository = field('repository', REPOSITORY_EXPECTED, (value) => isRepository(value)
    ? { value, problems: [] }
    : refusal(path, `${key}.repository`, value, REPOSITORY_EXPECTED));
  const storePath = field('storePath', STORE_PATH_EXPECTED, (value) => readFilePath(path, `${key}.storePath`, value));

  const problems = [
    ...unknownKeys(path, key, raw, PROJECT_KEYS),
    ...id.problems,
    ...name.problems,
    ...repository.problems,
    ...storePath.problems,
  ];
  if (problems.length > 0) return { problems };

  return {
    value: Object.freeze({
      id: id.value as string,
      name: name.value as string,
      repository: repository.value as string,
      storePath: storePath.value as string,
    }),
    problems: [],
  };
}

/**
 * One problem per entry of `projects` whose `field` repeats an earlier
 * entry's, naming both positions.
 */
function repeated(path: string, projects: readonly (HubProject | undefined)[], field: 'id' | 'storePath', why: string): string[] {
  const firstAt = new Map<string, number>();
  const problems: string[] = [];
  projects.forEach((project, position) => {
    if (project === undefined) return;

    const value = project[field];
    const earlier = firstAt.get(value);
    if (earlier === undefined) {
      firstAt.set(value, position);
      return;
    }
    problems.push(`${path}: hub.projects[${String(position)}].${field} is ${JSON.stringify(value)}, as hub.projects[${String(earlier)}].${field} is; ${why}`);
  });
  return problems;
}

/**
 * Reads `hub.projects`: a non-empty list of projects, no `id` and no
 * resolved `storePath` twice. Undefined when left out.
 */
function readProjects(path: string, raw: unknown): Reading<readonly HubProject[]> | undefined {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw) && raw.length === 0) return { problems: [`${path}: hub.projects is an empty list, ${PROJECTS_EXPECTED}`] };
  if (isMapping(raw)) return { problems: [`${path}: hub.projects is a mapping, ${PROJECTS_EXPECTED}`] };
  if (!Array.isArray(raw)) return refusal(path, 'hub.projects', raw, PROJECTS_EXPECTED);

  const entries = raw.map((entry: unknown, position) => readProject(path, `hub.projects[${String(position)}]`, entry));
  const read = entries.map((entry) => entry.value);
  const problems = [
    ...entries.flatMap((entry) => entry.problems),
    ...repeated(path, read, 'id', 'expected each project listed once'),
    ...repeated(path, read, 'storePath', 'expected one store file per project'),
  ];
  return problems.length > 0
    ? { problems }
    : { value: Object.freeze(read as HubProject[]), problems: [] };
}

/** One problem per key of `keys` written in `hub` beside `hub.projects`. */
function besideProjects(path: string, hub: Readonly<Record<string, unknown>>, keys: readonly string[]): string[] {
  return keys
    .filter((key) => hub[key] !== undefined)
    .map((key) => `${path}: hub.${key} is set beside hub.projects; expected each project's ${key} under hub.projects instead`);
}

/** The one project a hub with `hub.projects` left out serves. */
function defaultProject(repository: string, storePath: string): readonly HubProject[] {
  return Object.freeze([Object.freeze({ id: DEFAULT_PROJECT_ID, name: repository, repository, storePath })]);
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

/** Reads `hub.auth.adapter`, {@link DEFAULT_AUTH_ADAPTER} when left out. */
function readAuthAdapter(path: string, raw: unknown): Reading<HubAuthAdapter> {
  if (raw === undefined) return { value: DEFAULT_AUTH_ADAPTER, problems: [] };

  const adapter = HUB_AUTH_ADAPTERS.find((name) => name === raw);
  return adapter === undefined
    ? refusal(path, 'hub.auth.adapter', raw, ADAPTER_EXPECTED)
    : { value: adapter, problems: [] };
}

/** How a refusal under `hub.auth.apiKeys` names a value that is no list, never repeating it. */
function kindOf(raw: unknown): string {
  if (raw === null) return 'null';
  if (isMapping(raw)) return 'a mapping';
  return `a ${typeof raw}`;
}

/**
 * Reads `hub.auth.apiKeys` under `adapter`: a non-empty list of
 * environment variable names under `api-key`, left out under `github`.
 * No problem repeats a value written, since one may be a key itself.
 */
function readApiKeys(path: string, adapter: HubAuthAdapter | undefined, raw: unknown): Reading<readonly string[]> {
  const key = 'hub.auth.apiKeys';
  if (adapter !== 'api-key') {
    return raw === undefined || adapter === undefined
      ? { value: Object.freeze([]), problems: [] }
      : { problems: [`${path}: ${key} is set while hub.auth.adapter is github; expected hub.auth.adapter: api-key beside it, or no ${key}`] };
  }
  if (raw === undefined) return { problems: [`${path}: ${key} is missing, ${API_KEYS_EXPECTED}`] };
  if (!Array.isArray(raw)) return { problems: [`${path}: ${key} is ${kindOf(raw)}, ${API_KEYS_EXPECTED}`] };
  if (raw.length === 0) return { problems: [`${path}: ${key} is an empty list, ${API_KEYS_EXPECTED}`] };

  const problems = raw.flatMap((name: unknown, position) => typeof name === 'string' && ENV_NAME.test(name)
    ? []
    : [`${path}: ${key}[${String(position)}] is not an environment variable name, ${API_KEY_NAME_EXPECTED}`]);
  return problems.length > 0
    ? { problems }
    : { value: Object.freeze([...raw] as string[]), problems: [] };
}

/** One problem per key of `section` outside `known`, named by `prefix`. */
function unknownKeys(path: string, prefix: string, section: Readonly<Record<string, unknown>>, known: readonly string[]): string[] {
  return Object.keys(section)
    .filter((key) => !known.includes(key))
    .map((key) => `${path}: ${prefix}.${key} is not a key the hub reads; expected one of ${known.map((name) => `${prefix}.${name}`).join(', ')}`);
}

/**
 * The section `hub.<name>`, or the problem that refused it: a mapping
 * holding only `known`, empty when left out.
 */
function section(path: string, name: string, raw: unknown, known: readonly string[]): Reading<Readonly<Record<string, unknown>>> {
  const key = `hub.${name}`;
  if (raw === undefined) return { value: {}, problems: [] };
  if (!isMapping(raw)) return refusal(path, key, raw, `expected a mapping holding ${known.join(', ')}`);

  return { value: raw, problems: unknownKeys(path, key, raw, known) };
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

  const auth = section(path, 'auth', hub['auth'], AUTH_KEYS);
  const store = readStoreConfig(path, hub['store']);
  const index = readIndexConfig(path, hub['index']);
  const projects = readProjects(path, hub['projects']);
  const repository = projects === undefined
    ? readRepository(path, hub['repository'])
    : { problems: besideProjects(path, hub, ['repository']) };
  const port = readPort(path, hub['port']);
  const storePath = projects === undefined
    ? readStorePath(path, hub['storePath'])
    : { problems: besideProjects(path, hub, ['storePath']) };
  const authAdapter = readAuthAdapter(path, auth.value?.['adapter']);
  const apiKeys = readApiKeys(path, authAdapter.value, auth.value?.['apiKeys']);
  const login = readLoginConfig(path, authAdapter.value, auth.value?.['login']);
  const cacheFor = readCacheFor(path, auth.value?.['cacheFor']);

  const problems = [
    ...unknownKeys(path, 'hub', hub, HUB_KEYS),
    ...repository.problems,
    ...port.problems,
    ...storePath.problems,
    ...(projects?.problems ?? []),
    ...auth.problems,
    ...authAdapter.problems,
    ...apiKeys.problems,
    ...cacheFor.problems,
    ...login.problems,
    ...store.problems,
    ...index.problems,
  ];
  if (problems.length > 0) throw new HubConfigError(problems);

  const served = projects?.value ?? defaultProject(repository.value as string, storePath.value as string);
  const [first] = served as readonly [HubProject, ...HubProject[]];
  return Object.freeze({
    repository: first.repository,
    port: port.value as number,
    storePath: first.storePath,
    projects: served,
    cacheForMs: cacheFor.value as number | null,
    authAdapter: authAdapter.value as HubAuthAdapter,
    apiKeys: apiKeys.value as readonly string[],
    login: login.value as HubLoginConfig | null,
    ...(store.value as HubStoreConfig),
    ...(index.value as HubIndexConfig),
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
