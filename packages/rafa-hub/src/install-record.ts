/**
 * The hub's install record, `rafa-hub.install.json`: a generated JSON
 * file beside the file `RAFA_HUB_CONFIG` names (so
 * `/data/rafa-hub.install.json` in the image) holding what an install
 * decided, read by the hub before its running config. A person never
 * edits it; `rafa-hub install` writes the whole record each time.
 *
 * ## Format `1`
 *
 * The record holds exactly six keys (spec #1614, update of 2026-11-23,
 * which drops `addons[]`):
 *
 *   - `installVersion`: the record's format, {@link INSTALL_RECORD_VERSION}.
 *   - `hub`: the version of the hub that wrote it.
 *   - `bun`: the Bun version the hub was installed with.
 *   - `dataDir`: the absolute path of the directory the hub keeps
 *     everything it writes in; the config file's directory by default.
 *   - `sqliteLibrary`: the absolute path of the SQLite library to load,
 *     or `null` for Bun's own.
 *   - `models`: one `{ id, path, hash, dimension }` per installed
 *     embedding model, `hash` the SHA-256 of the model file as 64
 *     lowercase hex characters; empty until one is installed.
 *
 * ## Reading it
 *
 * {@link readInstallRecord} answers one of four ways:
 *
 *   - no file at all: the defaults ({@link defaultInstallRecord}:
 *     `dataDir` the config file's directory, no library, no models) and
 *     one warning line for the caller to log;
 *   - a record whose `installVersion` is not `1`: refused;
 *   - a record whose `hub` names another version than the running
 *     hub's: refused;
 *   - a file that is no valid record (not JSON, not an object, a key
 *     missing, unknown or of the wrong shape): refused.
 *
 * Every refusal is a {@link HubConfigError}, so it reaches the operator
 * the way a config refusal does, and each of its problems opens with
 * the record's path and ends naming `run rafa-hub install`, the one
 * writer that mends it. The format is checked before the version, and
 * the version before the shape, since a record of another format or
 * hub may hold another shape and the version is the cause to name.
 *
 * ## Readings the spec leaves to this module
 *
 *   - The running hub's version is handed in rather than imported: the
 *     hub's version lives in `bin.ts`, which reads this module.
 *   - Only a missing file is read as no record. A file that exists and
 *     cannot be read (a directory, no permission) is refused, since the
 *     defaults would then hide an install the operator made.
 *   - Two models with one `id` are refused, so a reader asking for a
 *     model by id finds at most one.
 *   - {@link writeInstallRecord} checks the record with the reader's own
 *     rules first, so the writer never leaves a file the reader refuses,
 *     and writes beside the target then renames, so a reader never sees
 *     half a record.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { HubConfigError } from './config.js';

/** The install record's file name, beside the hub's config file. */
export const INSTALL_RECORD_FILE = 'rafa-hub.install.json';

/** The record format this hub reads and writes: `installVersion`. */
export const INSTALL_RECORD_VERSION = 1;

/** The keys format `1` holds, in the order the writer writes them. */
const RECORD_KEYS: readonly string[] = Object.freeze(['installVersion', 'hub', 'bun', 'dataDir', 'sqliteLibrary', 'models']);

/** The keys each entry of `models` holds. */
const MODEL_KEYS: readonly string[] = Object.freeze(['id', 'path', 'hash', 'dimension']);

/** A SHA-256 as hex: 64 lowercase hex characters. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** What every refusal ends with: the command that mends the record. */
const MEND = 'run rafa-hub install';

/** One installed embedding model, an entry of the record's `models`. */
export interface HubInstallModel {
  /** The model's id, as `hub.index.embedding.model` names it. */
  readonly id: string;
  /** The absolute path of the model file. */
  readonly path: string;
  /** The SHA-256 of the model file, as 64 lowercase hex characters. */
  readonly hash: string;
  /** The length of the vectors the model makes, a whole number above 0. */
  readonly dimension: number;
}

/** The install record, format `1`: what an install decided. */
export interface HubInstallRecord {
  /** The record's format, {@link INSTALL_RECORD_VERSION}. */
  readonly installVersion: typeof INSTALL_RECORD_VERSION;
  /** The version of the hub that wrote it. */
  readonly hub: string;
  /** The Bun version the hub was installed with. */
  readonly bun: string;
  /** The absolute path of the directory the hub keeps everything it writes in. */
  readonly dataDir: string;
  /** The absolute path of the SQLite library to load, or null for Bun's own. */
  readonly sqliteLibrary: string | null;
  /** The installed embedding models, in the order written. */
  readonly models: readonly HubInstallModel[];
}

/** A read of the install record: the record, and the warning a missing one gives. */
export interface HubInstallReading {
  /** The record read, or the defaults when there is none. */
  readonly record: HubInstallRecord;
  /** The path the record was read from, or would have been. */
  readonly path: string;
  /**
   * One warning line when no record exists and the defaults answer,
   * for the caller to log; null when a record was read.
   */
  readonly warning: string | null;
}

/** The record's path for the hub's config file at `configPath`: beside it. */
export function installRecordPath(configPath: string): string {
  return join(dirname(resolve(configPath)), INSTALL_RECORD_FILE);
}

/**
 * The record a hub reads when none exists, frozen: `dataDir` the
 * directory of the config file at `configPath`, no library, no models,
 * `hub` the running hub's `hubVersion` and `bun` the running Bun's.
 */
export function defaultInstallRecord(configPath: string, hubVersion: string): HubInstallRecord {
  return Object.freeze({
    installVersion: INSTALL_RECORD_VERSION,
    hub: hubVersion,
    bun: Bun.version,
    dataDir: dirname(resolve(configPath)),
    sqliteLibrary: null,
    models: Object.freeze([]),
  });
}

/** One problem of the record at `path`, closing with the command that mends it. */
function problem(path: string, what: string): string {
  return `${path}: ${what}; ${MEND}`;
}

/** How a problem shows the value it found. */
function describeValue(raw: unknown): string {
  return raw === undefined
    ? 'missing'
    : JSON.stringify(raw);
}

/** Whether `raw` is a JSON object, rather than an array, a scalar or null. */
function isObject(raw: unknown): raw is Readonly<Record<string, unknown>> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/** Whether `raw` is a string holding more than blanks. */
function isText(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.trim() !== '';
}

/** Whether `raw` is an absolute path. */
function isAbsolutePath(raw: unknown): raw is string {
  return isText(raw) && isAbsolute(raw);
}

/** The keys `object` lacks and holds beyond `known`, at `prefix`. */
function keyProblems(prefix: string, object: Readonly<Record<string, unknown>>, known: readonly string[]): string[] {
  const missing = known
    .filter((key) => !Object.hasOwn(object, key))
    .map((key) => `${prefix}${key} is missing`);
  const unknown = Object.keys(object)
    .filter((key) => !known.includes(key))
    .map((key) => `${prefix}${key} is not a key of install record format ${String(INSTALL_RECORD_VERSION)}`);
  return [...missing, ...unknown];
}

/** The problems of one entry of `models`, at index `at`. */
function modelProblems(raw: unknown, at: number): string[] {
  const prefix = `models[${String(at)}].`;
  if (!isObject(raw)) return [`models[${String(at)}] is ${describeValue(raw)}, expected an object holding ${MODEL_KEYS.join(', ')}`];

  const problems = keyProblems(prefix, raw, MODEL_KEYS);
  const { id, path, hash, dimension } = raw;
  if (id !== undefined && !isText(id)) problems.push(`${prefix}id is ${describeValue(id)}, expected a non-empty model id`);
  if (path !== undefined && !isAbsolutePath(path)) problems.push(`${prefix}path is ${describeValue(path)}, expected the model file's absolute path`);
  if (hash !== undefined && !(typeof hash === 'string' && SHA256_HEX.test(hash))) {
    problems.push(`${prefix}hash is ${describeValue(hash)}, expected the model file's SHA-256 as 64 lowercase hex characters`);
  }
  if (dimension !== undefined && !(Number.isInteger(dimension) && (dimension as number) > 0)) {
    problems.push(`${prefix}dimension is ${describeValue(dimension)}, expected a whole number above 0`);
  }
  return problems;
}

/** The problems of the record's `models`. */
function modelsProblems(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return [`models is ${describeValue(raw)}, expected a list of models, empty when none is installed`];

  const entries: readonly unknown[] = raw;
  const ids = entries
    .filter(isObject)
    .map((entry) => entry['id'])
    .filter(isText);
  const repeated = [...new Set(ids.filter((id, at) => ids.indexOf(id) !== at))]
    .map((id) => `models holds ${JSON.stringify(id)} more than once, expected one entry per model id`);
  return [...entries.flatMap(modelProblems), ...repeated];
}

/** The problems of the scalar keys of a format `1` record, the version and `hub` already checked. */
function scalarProblems(raw: Readonly<Record<string, unknown>>): string[] {
  const { hub, bun, dataDir, sqliteLibrary } = raw;
  const problems: string[] = [];
  if (hub !== undefined && typeof hub !== 'string') problems.push(`hub is ${describeValue(hub)}, expected the version of the hub that wrote the record`);
  if (bun !== undefined && !isText(bun)) problems.push(`bun is ${describeValue(bun)}, expected the Bun version the hub was installed with`);
  if (dataDir !== undefined && !isAbsolutePath(dataDir)) problems.push(`dataDir is ${describeValue(dataDir)}, expected an absolute directory path`);
  if (sqliteLibrary !== undefined && sqliteLibrary !== null && !isAbsolutePath(sqliteLibrary)) {
    problems.push(`sqliteLibrary is ${describeValue(sqliteLibrary)}, expected the SQLite library's absolute path, or null`);
  }
  return problems;
}

/**
 * The problems of the record `raw` read from `path` for a hub at
 * `hubVersion`, each ready for a {@link HubConfigError}: the format's
 * first, then the version's, then the shape's; empty for a valid record.
 */
function recordProblems(path: string, raw: unknown, hubVersion: string): string[] {
  if (!isObject(raw)) return [problem(path, `not a valid install record: ${describeValue(raw)} is no JSON object`)];

  const format = raw['installVersion'];
  if (format !== INSTALL_RECORD_VERSION) {
    return [problem(path, `installVersion is ${describeValue(format)}, expected ${String(INSTALL_RECORD_VERSION)}, the install record format this hub reads`)];
  }
  const writer = raw['hub'];
  if (typeof writer === 'string' && writer !== hubVersion) {
    return [problem(path, `written by hub ${writer}, and this hub is ${hubVersion}`)];
  }

  return [...keyProblems('', raw, RECORD_KEYS), ...scalarProblems(raw), ...modelsProblems(raw['models'])]
    .map((what) => problem(path, `not a valid install record: ${what}`));
}

/** The record `raw`, already checked, frozen with its keys in the format's order. */
function frozenRecord(raw: Readonly<Record<string, unknown>>): HubInstallRecord {
  const models = (raw['models'] as readonly HubInstallModel[]).map((model) => Object.freeze({
    id: model.id,
    path: model.path,
    hash: model.hash,
    dimension: model.dimension,
  }));
  return Object.freeze({
    installVersion: INSTALL_RECORD_VERSION,
    hub: raw['hub'] as string,
    bun: raw['bun'] as string,
    dataDir: raw['dataDir'] as string,
    sqliteLibrary: raw['sqliteLibrary'] as string | null,
    models: Object.freeze(models),
  });
}

/** The message of a thrown value, on one line. */
function reasonOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** Whether `error` says the file it was about does not exist. */
function isMissingFile(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Reads the install record beside the hub's config file at
 * `configPath`, for a hub at `hubVersion`. No file answers
 * {@link defaultInstallRecord} with one warning line; a record of
 * another format, one written by another hub version and a file that
 * is no valid record are refused.
 *
 * @throws {HubConfigError} When the record is refused or the file cannot be read.
 */
export async function readInstallRecord(configPath: string, hubVersion: string): Promise<HubInstallReading> {
  const path = installRecordPath(configPath);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (!isMissingFile(error)) throw new HubConfigError([problem(path, `the install record could not be read: ${reasonOf(error)}`)]);

    const record = defaultInstallRecord(configPath, hubVersion);
    const warning = `${path}: no install record; using the defaults (dataDir ${record.dataDir}, no SQLite library, no models); ${MEND} to write one`;
    return Object.freeze({ record, path, warning });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new HubConfigError([problem(path, `not a valid install record: not valid JSON: ${reasonOf(error)}`)]);
  }

  const problems = recordProblems(path, raw, hubVersion);
  if (problems.length > 0) throw new HubConfigError(problems);
  return Object.freeze({ record: frozenRecord(raw as Readonly<Record<string, unknown>>), path, warning: null });
}

/**
 * Writes `record` whole to `path`, as JSON with two-space indents and a
 * closing newline, creating the directory. The record is checked by the
 * reader's rules first, its own `hub` the version it is checked against,
 * and lands by a rename, so no reader sees half of it.
 *
 * @throws {HubConfigError} When `record` is one the reader would refuse.
 */
export async function writeInstallRecord(path: string, record: HubInstallRecord): Promise<void> {
  const problems = recordProblems(path, record, record.hub);
  if (problems.length > 0) throw new HubConfigError(problems);

  const text = `${JSON.stringify(frozenRecord(record as unknown as Readonly<Record<string, unknown>>), null, 2)}\n`;
  const staged = `${path}.${String(process.pid)}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(staged, text, 'utf8');
    await rename(staged, path);
  } catch (error) {
    await rm(staged, { force: true });
    throw error;
  }
}
