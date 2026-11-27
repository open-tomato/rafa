/**
 * The `rafa-hub install` command, which `bin.ts` routes here:
 * {@link runInstall} writes the hub's install record
 * (`install-record.ts`), `rafa-hub.install.json` beside the file
 * `RAFA_HUB_CONFIG` names, whole, each time it runs.
 *
 * ## Its flags
 *
 *   - `--data-dir=<path>`: the record's `dataDir`, where the hub keeps
 *     everything it writes.
 *   - `--sqlite-library=<path>`: the record's `sqliteLibrary`, the SQLite
 *     library the hub loads; the file must exist.
 *   - `--model=<id> --model-path=<path> --model-dimension=<n>`: one entry
 *     of the record's `models`, its `hash` the SHA-256 of the file at
 *     `--model-path`, read now. An entry of the same id is replaced, and
 *     the other entries are kept.
 *
 * Every flag is written `--name=<value>`, at most once. A relative path
 * is resolved against the working directory, as `RAFA_HUB_CONFIG` is.
 *
 * ## Flags left out
 *
 * A flag left out keeps the value of the record already there: its
 * `dataDir`, its `sqliteLibrary` and its models, hashes included, so
 * the image's start can run the command each time without hashing a
 * model again. With no record there, a flag left out takes the default
 * the reader answers for a missing record: `dataDir` the config file's
 * directory, no library, no models. `--model=<id>` naming a model the
 * record holds may leave out `--model-path` and `--model-dimension`,
 * which then keep that entry's, and its file is hashed again; naming
 * a new model, it needs both. `hub` and `bun` are always the running
 * hub's version and the running Bun's.
 *
 * The record kept is read as the hub that wrote it would, so one
 * written by another hub version, which refuses a start, still lends
 * its values to the record that mends it; the command says so in one
 * line on standard error. A file that is no valid record of format `1`
 * lends nothing: the command says so in one line naming its problems,
 * and writes the record from the flags and the defaults.
 *
 * ## What it prints
 *
 * One line on standard output naming the record's path and what it
 * holds, and exit 0. A refusal is one line on standard error ending
 * `nothing was written`, and exit 1: `RAFA_HUB_CONFIG` unset or empty,
 * a flag with no value, `--model-path` or `--model-dimension` without
 * `--model`, a dimension that is not a whole number above 0, a library
 * or model file that is not there, a `dataDir` that is a file, a record
 * file that cannot be read, and a write that fails. It reads no running
 * config, so a config the reader refuses does not stop an install.
 *
 * {@link runInstall} is the whole command but the process's exit, so a
 * test runs it in process; importing this file starts nothing.
 */
import type { HubInstallModel, HubInstallRecord } from './install-record.js';

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { HUB_CONFIG_ENV, HubConfigError } from './config.js';
import { defaultInstallRecord, INSTALL_RECORD_VERSION, installRecordPath, readInstallRecord, writeInstallRecord } from './install-record.js';

/** The flags `rafa-hub install` takes, each written `<flag>=<value>`. */
export const INSTALL_FLAGS: Readonly<{
  dataDir: '--data-dir';
  sqliteLibrary: '--sqlite-library';
  model: '--model';
  modelPath: '--model-path';
  modelDimension: '--model-dimension';
}> = Object.freeze({
  dataDir: '--data-dir',
  sqliteLibrary: '--sqlite-library',
  model: '--model',
  modelPath: '--model-path',
  modelDimension: '--model-dimension',
} as const);

/** What `rafa-hub install` takes, as a refused argument list says it. */
export const INSTALL_USAGE = 'rafa-hub install [--data-dir=<path>] [--sqlite-library=<path>] [--model=<id> [--model-path=<path>] [--model-dimension=<n>]]';

/** The word that runs `rafa-hub install`. */
export const INSTALL_WORD = 'install';

/** A key of {@link INSTALL_FLAGS}. */
type InstallFlagKey = keyof typeof INSTALL_FLAGS;

/** One `rafa-hub install` run, as its arguments name it: each flag's value as typed, or null when left out. */
export type InstallCommand = Readonly<Record<InstallFlagKey, string | null>>;

/** What {@link runInstall} may vary beyond its arguments and the environment. */
export interface RunInstallOptions {
  /** Where the line naming the written record goes; standard output when left out. */
  readonly out?: (line: string) => void;
  /** Where a refusal's line, and a note on the record replaced, goes; standard error when left out. */
  readonly err?: (line: string) => void;
}

/** The prefix every line of `rafa-hub install` opens with. */
const INSTALL_PREFIX = 'rafa-hub install';

/** A dimension as typed: a whole number above 0, with no sign or leading zero. */
const DIMENSION = /^[1-9]\d*$/;

/** The record kept from the file already there, and the one line saying what became of it. */
interface KeptRecord {
  /** The record whose values flags left out keep, or null for the defaults. */
  readonly record: HubInstallRecord | null;
  /** One line for standard error when the record is not the running hub's, or null. */
  readonly note: string | null;
}

/** The message of a thrown value, on one line. */
function oneLine(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : String(error);
  return message.replace(/\s*\n\s*/g, '; ');
}

/** The problems of a thrown value: a {@link HubConfigError}'s own, or its message. */
function problemsOf(error: unknown): readonly string[] {
  return error instanceof HubConfigError
    ? error.problems
    : [oneLine(error)];
}

/** The key of {@link INSTALL_FLAGS} whose flag is `name`, or undefined. */
function flagKeyOf(name: string): InstallFlagKey | undefined {
  return (Object.keys(INSTALL_FLAGS) as InstallFlagKey[]).find((key) => INSTALL_FLAGS[key] === name);
}

/**
 * The `rafa-hub install` run `args` (the arguments past `install`)
 * name, or null for any other: every argument one of
 * {@link INSTALL_FLAGS} written `<flag>=<value>`, each at most once.
 * Values are checked by {@link runInstall}, which names what is wrong.
 */
export function installCommandOf(args: readonly string[]): InstallCommand | null {
  const command: Record<InstallFlagKey, string | null> = { dataDir: null, sqliteLibrary: null, model: null, modelPath: null, modelDimension: null };
  for (const arg of args) {
    const equals = arg.indexOf('=');
    if (equals === -1) return null;
    const key = flagKeyOf(arg.slice(0, equals));
    if (key === undefined || command[key] !== null) return null;
    command[key] = arg.slice(equals + 1);
  }
  return Object.freeze(command);
}

/** The problems of `command`'s values that need no file to find. */
function flagProblems(command: InstallCommand): string[] {
  const problems = (Object.keys(INSTALL_FLAGS) as InstallFlagKey[])
    .filter((key) => command[key]?.trim() === '')
    .map((key) => `${INSTALL_FLAGS[key]} has no value, expected ${INSTALL_FLAGS[key]}=<value>`);
  if (command.model === null) {
    for (const key of ['modelPath', 'modelDimension'] as const) {
      if (command[key] !== null) problems.push(`${INSTALL_FLAGS[key]} names no model; give ${INSTALL_FLAGS.model}=<id> with it`);
    }
  }
  const dimension = command.modelDimension;
  if (dimension !== null && dimension.trim() !== '' && !DIMENSION.test(dimension)) {
    problems.push(`${INSTALL_FLAGS.modelDimension} is ${JSON.stringify(dimension)}, expected a whole number above 0`);
  }
  return problems;
}

/** Whether `error` says the file it was about does not exist. */
function isMissingFile(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** The `hub` the record `text` names, or null when it is no JSON object naming one; the reader names what else is wrong. */
function writerOf(text: string): string | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const hub: unknown = typeof raw === 'object' && raw !== null
    ? (raw as Readonly<Record<string, unknown>>)['hub']
    : undefined;
  return typeof hub === 'string'
    ? hub
    : null;
}

/**
 * The record already beside the config file at `configPath`, read as
 * the hub that wrote it would, for a hub at `hubVersion`: none when
 * there is no file, and none with a note when the file is no record
 * this format reads.
 *
 * @throws {HubConfigError} When the file is there and cannot be read.
 */
async function keptRecord(configPath: string, hubVersion: string): Promise<KeptRecord> {
  const path = installRecordPath(configPath);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) return { record: null, note: null };

    throw new HubConfigError([`${path}: the install record could not be read: ${oneLine(error)}`]);
  }

  const writer = writerOf(text) ?? hubVersion;
  try {
    const { record } = await readInstallRecord(configPath, writer);
    const note = writer === hubVersion
      ? null
      : `${INSTALL_PREFIX}: ${path} was written by hub ${writer}; rewriting it for hub ${hubVersion}, keeping its values`;
    return { record, note };
  } catch (error) {
    const replaced = `${INSTALL_PREFIX}: ${path} is no install record of format ${String(INSTALL_RECORD_VERSION)} (${problemsOf(error).join('; ')}); writing a new one from the flags and the defaults`;
    return { record: null, note: replaced };
  }
}

/** The problem with the file at `path`, named by `flag`, when it is no regular file; null when it is. */
async function fileProblem(flag: string, path: string): Promise<string | null> {
  try {
    const found = await stat(path);
    return found.isFile()
      ? null
      : `${flag} names ${path}, which is not a file`;
  } catch (error) {
    return `${flag} names ${path}, which could not be read: ${oneLine(error)}`;
  }
}

/** The problem with `dataDir` when something other than a directory is there; null when it is one or nothing is. */
async function dataDirProblem(dataDir: string): Promise<string | null> {
  try {
    const found = await stat(dataDir);
    return found.isDirectory()
      ? null
      : `${INSTALL_FLAGS.dataDir} names ${dataDir}, which is not a directory`;
  } catch (error) {
    return isMissingFile(error)
      ? null
      : `${INSTALL_FLAGS.dataDir} names ${dataDir}, which could not be read: ${oneLine(error)}`;
  }
}

/** The SHA-256 of the file at `path`, as 64 lowercase hex characters, read in chunks. */
export async function sha256OfFile(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest('hex');
}

/**
 * The model `command` names, its file hashed now, its path and
 * dimension left out taken from `kept`'s entry of the same id.
 *
 * @throws {HubConfigError} When a new model leaves out its path or
 *   dimension, or its file is not there.
 */
async function installedModel(command: InstallCommand, id: string, kept: readonly HubInstallModel[]): Promise<HubInstallModel> {
  const before = kept.find((model) => model.id === id);
  const path = command.modelPath === null
    ? before?.path
    : resolve(command.modelPath);
  const dimension = command.modelDimension === null
    ? before?.dimension
    : Number(command.modelDimension);
  const missing = [
    ...path === undefined
      ? [`${INSTALL_FLAGS.model}=${id} is no model of the record, so ${INSTALL_FLAGS.modelPath}=<path> is needed`]
      : [],
    ...dimension === undefined
      ? [`${INSTALL_FLAGS.model}=${id} is no model of the record, so ${INSTALL_FLAGS.modelDimension}=<n> is needed`]
      : [],
  ];
  if (path === undefined || dimension === undefined) throw new HubConfigError(missing);

  const problem = await fileProblem(INSTALL_FLAGS.modelPath, path);
  if (problem !== null) throw new HubConfigError([problem]);
  return { id, path, hash: await sha256OfFile(path), dimension };
}

/** `kept`'s models with `model` in place of the entry of its id, or after them when there is none. */
function modelsWith(kept: readonly HubInstallModel[], model: HubInstallModel): readonly HubInstallModel[] {
  return kept.some(({ id }) => id === model.id)
    ? kept.map((entry) => entry.id === model.id
      ? model
      : entry)
    : [...kept, model];
}

/**
 * The record `command` writes beside the config file at `configPath`
 * for a hub at `hubVersion`, flags left out keeping `kept`'s values.
 *
 * @throws {HubConfigError} When a path the flags name is not what it should be.
 */
async function recordOf(command: InstallCommand, configPath: string, hubVersion: string, kept: HubInstallRecord): Promise<HubInstallRecord> {
  const dataDir = command.dataDir === null
    ? kept.dataDir
    : resolve(command.dataDir);
  const sqliteLibrary = command.sqliteLibrary === null
    ? kept.sqliteLibrary
    : resolve(command.sqliteLibrary);
  const problems = [
    command.dataDir === null
      ? null
      : await dataDirProblem(dataDir),
    command.sqliteLibrary === null || sqliteLibrary === null
      ? null
      : await fileProblem(INSTALL_FLAGS.sqliteLibrary, sqliteLibrary),
  ].filter((problem) => problem !== null);
  if (problems.length > 0) throw new HubConfigError(problems);

  const models = command.model === null
    ? kept.models
    : modelsWith(kept.models, await installedModel(command, command.model, kept.models));
  return { ...defaultInstallRecord(configPath, hubVersion), dataDir, sqliteLibrary, models };
}

/** The line a written record prints: its path and what it holds. */
export function installedLine(path: string, record: HubInstallRecord): string {
  const library = record.sqliteLibrary ?? 'none, Bun\'s own';
  const models = record.models.length === 0
    ? 'none'
    : record.models.map(({ id, dimension, hash }) => `${id} (dimension ${String(dimension)}, sha256 ${hash})`).join(', ');
  return `${INSTALL_PREFIX}: wrote ${path} for hub ${record.hub} on bun ${record.bun}: dataDir ${record.dataDir}, sqliteLibrary ${library}, models ${models}`;
}

/**
 * Runs `rafa-hub install` over `args` (the arguments past `install`)
 * for a hub at `hubVersion`, writing the record beside the file `env`'s
 * `RAFA_HUB_CONFIG` names, and answers the exit code: 0 once the record
 * is written, its line on `out`, or 1 with one refusal line on `err`
 * and nothing written. Never exits the process.
 */
export async function runInstall(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  hubVersion: string,
  options: RunInstallOptions = {},
): Promise<number> {
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line: string) => process.stderr.write(`${line}\n`));
  const refuse = (problems: readonly string[]): number => {
    err(`${INSTALL_PREFIX}: ${problems.join('; ')}; nothing was written`);
    return 1;
  };

  const command = installCommandOf(args);
  if (command === null) return refuse([`${args.join(' ')} are not its arguments; usage: ${INSTALL_USAGE}`]);
  const named = env[HUB_CONFIG_ENV];
  if (named === undefined || named.trim() === '') {
    return refuse([`${HUB_CONFIG_ENV} is not set; expected the path of the hub's config file, beside which the install record is written`]);
  }
  const problems = flagProblems(command);
  if (problems.length > 0) return refuse(problems);

  const configPath = resolve(named);
  const path = installRecordPath(configPath);
  try {
    const kept = await keptRecord(configPath, hubVersion);
    const record = await recordOf(command, configPath, hubVersion, kept.record ?? defaultInstallRecord(configPath, hubVersion));
    await writeInstallRecord(path, record);
    if (kept.note !== null) err(kept.note);
    out(installedLine(path, record));
    return 0;
  } catch (error) {
    return refuse(problemsOf(error));
  }
}
