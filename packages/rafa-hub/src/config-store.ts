/**
 * The readers of the hub's `hub.store` and `hub.index` sections,
 * resolved into a frozen {@link HubStoreConfig} and
 * {@link HubIndexConfig} for `config.ts` to set on its `HubConfig`, or
 * refused with every problem at once.
 *
 * ## The keys
 *
 * `hub.store` holds `engine`, `sqliteLibrary` and `postgres`:
 *
 *   - `engine` is `sqlite` (the default, a `bun:sqlite` file per
 *     project) or `postgres` (an organisation's hub), and nothing else.
 *   - `sqliteLibrary` is the absolute path of a vanilla `libsqlite3`
 *     that turns the index's vector half on for a macOS hub (#1428).
 *   - `postgres` holds `urlVariable`, the name of the environment
 *     variable holding the connection URL, `POSTGRES_URL` (the first one
 *     `Bun.sql` reads) when left out. The URL itself never sits in the
 *     file: there is no `hub.store.postgres.url` key.
 *
 * `hub.index` holds `rebuildAfterPush` and `embedding`:
 *
 *   - `rebuildAfterPush` is `true` (the default) or `false`, which
 *     leaves the index to `rafa-hub index rebuild` (#1428).
 *   - `embedding` holds `model`, the model the hub embeds text with,
 *     and `precision`, how it stores a vector: `half` (the default,
 *     2-byte floats) or `full`. The model's dimension is an install
 *     fact, never a key: there is no `hub.index.embedding.dimension`.
 *
 * ## Readings the spec leaves to this module
 *
 *   - `hub.store.postgres` is refused under `engine: sqlite`, the
 *     default included, since nothing would read it there: each key
 *     written under it is named, and a value that is no mapping or an
 *     empty one names `hub.store.postgres` itself. A key the hub does not
 *     read is named as unknown instead, under either engine. With the
 *     engine itself refused, only the shape of `hub.store.postgres` is
 *     checked. Under `sqlite` the URL variable is null.
 *   - `hub.store.postgres.urlVariable` matches `^[A-Z_][A-Z0-9_]*$`, as
 *     `hub.auth.apiKeys` does, and its refusal never repeats what was
 *     written, since a URL holding a password may have been pasted in
 *     place of the variable's name. Whether the variable is set is the
 *     start's to check, not this reader's: the file is read before the
 *     environment the hub runs in is.
 *   - `hub.store.sqliteLibrary` must be an absolute path, and a relative
 *     one is refused rather than resolved: the library is handed to
 *     `Database.setCustomSQLite`, which the process loads once and
 *     before any database opens, so a path that names a different file
 *     from another directory would be a silent wrong load. Left out, it
 *     is null, and the connector answers `vector: false` where the
 *     engine needs it. It is read under either engine.
 *   - `hub.index.embedding.model` is non-empty text with no white space
 *     at either end, kept as written; left out, it is null and vectors
 *     stay off. `hub.index.embedding.precision` is read whether or not a
 *     model is named, so a precision written ahead of the model is
 *     checked when it is written.
 *   - Nothing is coerced: `'false'` and `0` are refused for
 *     `rebuildAfterPush`, not read as off, and `precision: 16` is refused.
 *   - A key under `hub.store`, `hub.store.postgres`, `hub.index` or
 *     `hub.index.embedding` that the hub does not read is refused, as
 *     under `hub`.
 *
 * `config.ts` imports this module, so this one takes nothing from it,
 * and its few helpers are its own, as `config-login.ts`'s are.
 */
import { isAbsolute } from 'node:path';

/** The engine the hub keeps its rows and index in: `hub.store.engine`. */
export type HubStoreEngine = 'sqlite' | 'postgres';

/** The engines `hub.store.engine` takes, in the order a refusal names them. */
export const HUB_STORE_ENGINES: readonly HubStoreEngine[] = Object.freeze(['sqlite', 'postgres']);

/** `hub.store.engine` when it is left out. */
export const DEFAULT_STORE_ENGINE: HubStoreEngine = 'sqlite';

/** `hub.store.postgres.urlVariable` under `postgres` when it is left out: the first variable `Bun.sql` reads. */
export const DEFAULT_POSTGRES_URL_VARIABLE = 'POSTGRES_URL';

/** How the hub stores a vector: `hub.index.embedding.precision`. */
export type HubEmbeddingPrecision = 'half' | 'full';

/** The precisions `hub.index.embedding.precision` takes, in the order a refusal names them. */
export const HUB_EMBEDDING_PRECISIONS: readonly HubEmbeddingPrecision[] = Object.freeze(['half', 'full']);

/** `hub.index.embedding.precision` when it is left out. */
export const DEFAULT_EMBEDDING_PRECISION: HubEmbeddingPrecision = 'half';

/** `hub.index.rebuildAfterPush` when it is left out. */
export const DEFAULT_REBUILD_AFTER_PUSH = true;

/** An environment variable name, as `hub.store.postgres.urlVariable` takes it. */
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

/** The keys the hub reads under `hub.store`. */
const STORE_KEYS: readonly string[] = Object.freeze(['engine', 'sqliteLibrary', 'postgres']);

/** The keys the hub reads under `hub.store.postgres`. */
const POSTGRES_KEYS: readonly string[] = Object.freeze(['urlVariable']);

/** The keys the hub reads under `hub.index`. */
const INDEX_KEYS: readonly string[] = Object.freeze(['rebuildAfterPush', 'embedding']);

/** The keys the hub reads under `hub.index.embedding`. */
const EMBEDDING_KEYS: readonly string[] = Object.freeze(['model', 'precision']);

/** What `hub.store.engine` takes, as a refusal says it. */
const ENGINE_EXPECTED = 'expected sqlite or postgres';

/** What `hub.store.sqliteLibrary` takes, as a refusal says it. */
const SQLITE_LIBRARY_EXPECTED = 'expected an absolute path to a vanilla libsqlite3, such as /opt/homebrew/opt/sqlite/lib/libsqlite3.dylib';

/** What `hub.store.postgres.urlVariable` takes, as a refusal says it. */
const URL_VARIABLE_EXPECTED = 'expected an environment variable name of A-Z, 0-9 and _, not opening with a digit, such as POSTGRES_URL; the value written is not repeated';

/** What `hub.index.rebuildAfterPush` takes, as a refusal says it. */
const REBUILD_AFTER_PUSH_EXPECTED = 'expected true or false';

/** What `hub.index.embedding.model` takes, as a refusal says it. */
const MODEL_EXPECTED = 'expected a model name of non-empty text with no white space at either end, such as nomic-embed-text-v1.5';

/** What `hub.index.embedding.precision` takes, as a refusal says it. */
const PRECISION_EXPECTED = 'expected half or full';

/** The hub's `hub.store` section, resolved. */
export interface HubStoreConfig {
  /** The engine the hub keeps its rows and index in. `hub.store.engine`. */
  readonly storeEngine: HubStoreEngine;
  /**
   * The name of the environment variable holding the Postgres URL, never
   * its value, or null under `sqlite`. `hub.store.postgres.urlVariable`.
   */
  readonly postgresUrlVariable: string | null;
  /**
   * The absolute path of the vanilla `libsqlite3` the index loads its
   * vector extension through, or null when none is named.
   * `hub.store.sqliteLibrary`.
   */
  readonly sqliteLibrary: string | null;
}

/** The hub's `hub.index` section, resolved. */
export interface HubIndexConfig {
  /**
   * Whether a push that added rows rebuilds the project's index; `false`
   * leaves it to `rafa-hub index rebuild`. `hub.index.rebuildAfterPush`.
   */
  readonly rebuildAfterPush: boolean;
  /** The model the hub embeds text with, or null to keep vectors off. `hub.index.embedding.model`. */
  readonly embeddingModel: string | null;
  /** How the hub stores a vector. `hub.index.embedding.precision`. */
  readonly embeddingPrecision: HubEmbeddingPrecision;
}

/** One section's reading: its value, or the problems that refused it. */
export interface SectionReading<T> {
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
function refusal<T>(path: string, key: string, raw: unknown, expected: string): SectionReading<T> {
  return { problems: [`${path}: ${key} is ${describeValue(raw)}, ${expected}`] };
}

/** Whether `raw` is a YAML mapping, rather than a list, a scalar or null. */
function isMapping(raw: unknown): raw is Readonly<Record<string, unknown>> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/** One problem per key of `section` outside `known`, named by `prefix`. */
function unknownKeys(path: string, prefix: string, section: Readonly<Record<string, unknown>>, known: readonly string[]): string[] {
  return Object.keys(section)
    .filter((key) => !known.includes(key))
    .map((key) => `${path}: ${prefix}.${key} is not a key the hub reads; expected one of ${known.map((name) => `${prefix}.${name}`).join(', ')}`);
}

/**
 * The section at `key`, or the problem that refused it: a mapping
 * holding only `known`, empty when left out.
 */
function section(path: string, key: string, raw: unknown, known: readonly string[]): SectionReading<Readonly<Record<string, unknown>>> {
  if (raw === undefined) return { value: {}, problems: [] };
  if (!isMapping(raw)) return refusal(path, key, raw, `expected a mapping holding ${known.join(', ')}`);

  return { value: raw, problems: unknownKeys(path, key, raw, known) };
}

/** Reads the one of `choices` at `key`, `fallback` when left out. */
function readChoice<T extends string>(path: string, key: string, raw: unknown, choices: readonly T[], fallback: T, expected: string): SectionReading<T> {
  if (raw === undefined) return { value: fallback, problems: [] };

  const choice = choices.find((name) => name === raw);
  return choice === undefined
    ? refusal(path, key, raw, expected)
    : { value: choice, problems: [] };
}

/** Reads `hub.store.sqliteLibrary`: an absolute path, null when left out. */
function readSqliteLibrary(path: string, raw: unknown): SectionReading<string | null> {
  if (raw === undefined) return { value: null, problems: [] };

  const isPath = typeof raw === 'string' && raw.trim() === raw && isAbsolute(raw);
  return isPath
    ? { value: raw, problems: [] }
    : refusal(path, 'hub.store.sqliteLibrary', raw, SQLITE_LIBRARY_EXPECTED);
}

/** The problems of a `hub.store.postgres` written under `engine: sqlite`, one per key it holds. */
function postgresUnderSqlite(path: string, raw: unknown): string[] {
  const key = 'hub.store.postgres';
  const why = 'is set while hub.store.engine is sqlite; expected hub.store.engine: postgres beside it, or no hub.store.postgres';
  const known = isMapping(raw)
    ? Object.keys(raw).filter((name) => POSTGRES_KEYS.includes(name))
    : [];
  if (!isMapping(raw) || Object.keys(raw).length === 0) return [`${path}: ${key} ${why}`];

  return [
    ...unknownKeys(path, key, raw, POSTGRES_KEYS),
    ...known.map((name) => `${path}: ${key}.${name} ${why}`),
  ];
}

/**
 * Reads `hub.store.postgres.urlVariable` under `engine`: an environment
 * variable name under `postgres`, {@link DEFAULT_POSTGRES_URL_VARIABLE}
 * when left out, and null under `sqlite`, where `hub.store.postgres` is
 * refused. No problem repeats a value written, since one may be a URL.
 */
function readUrlVariable(path: string, engine: HubStoreEngine | undefined, raw: unknown): SectionReading<string | null> {
  const key = 'hub.store.postgres';
  if (engine === 'sqlite') {
    return raw === undefined
      ? { value: null, problems: [] }
      : { problems: postgresUnderSqlite(path, raw) };
  }

  const postgres = section(path, key, raw, POSTGRES_KEYS);
  if (engine === undefined || postgres.value === undefined) return { problems: postgres.problems };

  const variable = postgres.value['urlVariable'];
  if (variable === undefined) return { value: DEFAULT_POSTGRES_URL_VARIABLE, problems: postgres.problems };

  return typeof variable === 'string' && ENV_NAME.test(variable)
    ? { value: variable, problems: postgres.problems }
    : { problems: [...postgres.problems, `${path}: ${key}.urlVariable is not an environment variable name, ${URL_VARIABLE_EXPECTED}`] };
}

/**
 * Reads the `hub.store` section `raw` from the config file at `path`:
 * its engine, its Postgres URL variable and its SQLite library, frozen,
 * or every problem found.
 */
export function readStoreConfig(path: string, raw: unknown): SectionReading<HubStoreConfig> {
  const store = section(path, 'hub.store', raw, STORE_KEYS);
  if (store.value === undefined) return { problems: store.problems };

  const engine = readChoice(path, 'hub.store.engine', store.value['engine'], HUB_STORE_ENGINES, DEFAULT_STORE_ENGINE, ENGINE_EXPECTED);
  const sqliteLibrary = readSqliteLibrary(path, store.value['sqliteLibrary']);
  const urlVariable = readUrlVariable(path, engine.value, store.value['postgres']);

  const problems = [...store.problems, ...engine.problems, ...sqliteLibrary.problems, ...urlVariable.problems];
  if (problems.length > 0) return { problems };

  return {
    value: Object.freeze({
      storeEngine: engine.value as HubStoreEngine,
      postgresUrlVariable: urlVariable.value as string | null,
      sqliteLibrary: sqliteLibrary.value as string | null,
    }),
    problems: [],
  };
}

/** Reads `hub.index.rebuildAfterPush`, {@link DEFAULT_REBUILD_AFTER_PUSH} when left out. */
function readRebuildAfterPush(path: string, raw: unknown): SectionReading<boolean> {
  if (raw === undefined) return { value: DEFAULT_REBUILD_AFTER_PUSH, problems: [] };

  return typeof raw === 'boolean'
    ? { value: raw, problems: [] }
    : refusal(path, 'hub.index.rebuildAfterPush', raw, REBUILD_AFTER_PUSH_EXPECTED);
}

/** Reads `hub.index.embedding.model`: non-empty text with no white space at either end, null when left out. */
function readModel(path: string, raw: unknown): SectionReading<string | null> {
  if (raw === undefined) return { value: null, problems: [] };

  return typeof raw === 'string' && raw !== '' && raw.trim() === raw
    ? { value: raw, problems: [] }
    : refusal(path, 'hub.index.embedding.model', raw, MODEL_EXPECTED);
}

/**
 * Reads the `hub.index` section `raw` from the config file at `path`:
 * its rebuild switch and its embedding model and precision, frozen, or
 * every problem found.
 */
export function readIndexConfig(path: string, raw: unknown): SectionReading<HubIndexConfig> {
  const index = section(path, 'hub.index', raw, INDEX_KEYS);
  if (index.value === undefined) return { problems: index.problems };

  const embedding = section(path, 'hub.index.embedding', index.value['embedding'], EMBEDDING_KEYS);
  const rebuildAfterPush = readRebuildAfterPush(path, index.value['rebuildAfterPush']);
  const model = readModel(path, embedding.value?.['model']);
  const precision = readChoice(path, 'hub.index.embedding.precision', embedding.value?.['precision'], HUB_EMBEDDING_PRECISIONS, DEFAULT_EMBEDDING_PRECISION, PRECISION_EXPECTED);

  const problems = [...index.problems, ...rebuildAfterPush.problems, ...embedding.problems, ...model.problems, ...precision.problems];
  if (problems.length > 0) return { problems };

  return {
    value: Object.freeze({
      rebuildAfterPush: rebuildAfterPush.value as boolean,
      embeddingModel: model.value as string | null,
      embeddingPrecision: precision.value as HubEmbeddingPrecision,
    }),
    problems: [],
  };
}
