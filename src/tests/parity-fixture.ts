/**
 * Locates the sibling's session logs and stored rows for the parity
 * tests, or names why they cannot be read here.
 *
 * The parity tests run rafa's collector over the SIBLING's session logs
 * (the loop at `~/projects/agentic-research` this package was imported
 * from) and compare what it writes across both store backends, and
 * against the rows the sibling's own collector already stored. Neither
 * input travels with a clone. The logs are Claude Code's, filed under
 * the home directory, and the rows sit under the sibling checkout's
 * gitignored `.ralph/`. So the suite has to run on a machine that holds
 * neither, and {@link resolveParityFixture} is what lets it: it answers
 * the paths to read, or a named reason to skip.
 *
 * ## Where it looks
 *
 * Each fixture has one override and one documented default, and the
 * override outranks the default. An override set to the empty string
 * counts as unset, so a stray `RAFA_PARITY_LOG_DIR=` in a profile falls
 * through to the default instead of pointing at nothing.
 *
 *   - Session logs: `RAFA_PARITY_LOG_DIR`, else the directory Claude
 *     Code files the checkout `~/projects/agentic-research` under,
 *     derived by the collector's own `sessionLogDir`. On the machine
 *     the parity stage was written on, that is
 *     `~/.claude/projects/-Users-marcos-projects-agentic-research/`.
 *   - Stored rows: `RAFA_PARITY_STORE_DIR`, else
 *     `~/projects/agentic-research/.ralph/effort/`, holding
 *     `sessions.ndjson` and `commits.ndjson`.
 *
 * The stored rows' layout is the sibling's, and it is spelled here
 * rather than taken from `effort/store.ts`. That module's directory is
 * rafa's own store, which phase 1 is set to move under `.rafa/`, while
 * the sibling's rows stay where the sibling's collector wrote them.
 *
 * An override is taken as given, never resolved against the working
 * directory, which is wherever `bun test` happened to start; a relative
 * one is an absence of its own. An override naming nothing is an
 * absence like any other, not a refusal. The reason names the variable,
 * so a mistyped path reads plainly in the skip line, and a profile that
 * sets the variable on a machine without the directory still runs the
 * rest of the suite.
 *
 * It locates these two fixtures and nothing else. The sibling's plan
 * roster and its git history are not looked for here.
 *
 * ## What counts as present
 *
 * Present means the resolver found what the tests read, not merely a
 * path. The log directory must hold at least one session log by the
 * collector's own population rule, because it is counted by
 * `listSessionLogs`: loose `*.jsonl` files only, never a subagent
 * transcript one level down. Each stored-row file must be a regular
 * file holding at least one byte. An empty fixture is an absence, not a
 * presence: two stores collected from zero logs agree with each other,
 * and a parity test over them would pass having compared nothing. The
 * stored rows are checked by stat alone; reading them is the tests'
 * job.
 *
 * Every absence is reported, not only the first, in a fixed order:
 * the session logs, then the stored-row directory or each of its two
 * files. Each carries a code from {@link PARITY_ABSENCE_CODES}, the
 * path checked, and where that path came from, and
 * {@link AbsentParityFixture.reason} renders them all as one line.
 *
 * ## It never throws, because it runs where a skip is decided
 *
 * A consumer calls it at module scope to choose between running and
 * skipping, so a throw there would fail the whole file on exactly the
 * machine the skip exists for. An error other than "nothing is there"
 * (`ENOENT`, or `ENOTDIR` for a path running through a file) is
 * therefore an `unreadable` absence carrying the error's code. The cost
 * at module scope is one directory read plus one stat per entry: one
 * measured listing of the sibling's 1,053 logs took 4.3 ms.
 *
 * Measured on bun 1.3.14, and the reason a consumer's READING of the
 * fixture belongs in `beforeAll` or a case rather than beside this
 * call: a `describe.skipIf(true)` callback still runs.
 *
 * ## Where a skip reason shows up
 *
 * bun takes no skip reason, so a consumer carries this one in its
 * describe title. Measured on bun 1.3.14:
 *
 *   - In a terminal, each skipped case prints as
 *     `(skip) <describe title> > <case title>`, so the reason is read
 *     straight off the skip line.
 *   - With `CLAUDECODE` set, as it is inside a Claude Code session, bun
 *     prints no per-test line at all, skipped or passed, only the
 *     counts. A session reading its own capture sees `N skip` and no
 *     reason, unless it runs with `CLAUDECODE` unset or with
 *     `--reporter=junit`, whose file names every skipped case.
 */
import type { Stats } from 'node:fs';

import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { listSessionLogs, sessionLogDir } from '../effort/collect.js';

/** The variable that points the parity tests at a session log directory. */
export const PARITY_LOG_DIR_ENV = 'RAFA_PARITY_LOG_DIR';

/** The variable that points the parity tests at a directory of stored rows. */
export const PARITY_STORE_DIR_ENV = 'RAFA_PARITY_STORE_DIR';

/**
 * Every reason one fixture can be absent where it was looked for.
 *
 *   - `not-absolute`: an override that is a relative path.
 *   - `missing`: nothing at the path.
 *   - `not-a-directory`: a file where a directory was looked for.
 *   - `no-session-log`: a log directory holding no loose session log.
 *   - `not-a-file`: something other than a file where a stored-row
 *     file was looked for.
 *   - `empty`: a stored-row file holding no byte.
 *   - `unreadable`: any other error, its code carried beside it.
 */
export const PARITY_ABSENCE_CODES = [
  'not-absolute',
  'missing',
  'not-a-directory',
  'no-session-log',
  'not-a-file',
  'empty',
  'unreadable',
] as const;

/** One reason from {@link PARITY_ABSENCE_CODES}. */
export type ParityAbsenceCode = (typeof PARITY_ABSENCE_CODES)[number];

/** The two fixtures, as the reason line names them. */
export type ParityFixtureName = 'session logs' | 'stored rows';

/** Where one fixture's path came from: its override, or the default. */
export type ParitySource =
  | 'default'
  | typeof PARITY_LOG_DIR_ENV
  | typeof PARITY_STORE_DIR_ENV;

/** One thing one fixture is missing. */
export interface ParityAbsence {
  fixture: ParityFixtureName;
  code: ParityAbsenceCode;
  /** The path the check was made against. */
  path: string;
  /** Where that path came from. */
  source: ParitySource;
  /** The error code of an `unreadable` absence; null for every other. */
  detail: string | null;
}

/** Where the resolver looks, before anything there is checked. */
export interface ParityFixturePaths {
  /** The sibling's session log directory. */
  logDir: string;
  logDirSource: 'default' | typeof PARITY_LOG_DIR_ENV;
  /** The directory holding the sibling's stored rows. */
  storeDir: string;
  storeDirSource: 'default' | typeof PARITY_STORE_DIR_ENV;
  /** The stored session rows, under {@link ParityFixturePaths.storeDir}. */
  sessionsPath: string;
  /** The stored commit rows, under {@link ParityFixturePaths.storeDir}. */
  commitsPath: string;
}

/** Both fixtures are there: the paths the parity tests read. */
export interface PresentParityFixture extends ParityFixturePaths {
  present: true;
  /** The loose session logs the directory held when it was checked. */
  sessionLogCount: number;
}

/** At least one fixture is not: everything missing, and why. */
export interface AbsentParityFixture extends ParityFixturePaths {
  present: false;
  /** Every absence found, in the order the module note gives; never empty. */
  absences: ParityAbsence[];
  /** The named skip reason: every absence, on one line. */
  reason: string;
}

/** What {@link resolveParityFixture} answers. */
export type ParityFixture = PresentParityFixture | AbsentParityFixture;

/** Where the resolver reads its overrides and home directory from. */
export interface ParityFixtureOptions {
  /** Read for the two overrides alone. Defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Both defaults sit under it. Defaults to `homedir()`. */
  home?: string;
}

/** The sibling checkout both defaults derive from, under the home directory. */
const SIBLING_CHECKOUT = ['projects', 'agentic-research'] as const;

/** Where the sibling's collector keeps its rows, under that checkout. */
const SIBLING_STORE_DIR = ['.ralph', 'effort'] as const;

/** The stored-row files, one per kind, as the sibling's collector names them. */
const SIBLING_STORE_FILES = {
  sessions: 'sessions.ndjson',
  commits: 'commits.ndjson',
} as const;

/** Error codes meaning nothing is at a path, rather than that it cannot be read. */
const NOTHING_THERE: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

/** How the reason line words each code. */
const ABSENCE_PHRASES: Readonly<Record<ParityAbsenceCode, string>> = {
  'not-absolute': 'is not an absolute path',
  missing: 'does not exist',
  'not-a-directory': 'is not a directory',
  'no-session-log': 'holds no loose *.jsonl session log',
  'not-a-file': 'is not a file',
  empty: 'is empty',
  unreadable: 'cannot be read',
};

/** Builds one fixture's absences, all from one source. */
type AbsenceFactory = (
  code: ParityAbsenceCode,
  path: string,
  detail?: string | null,
) => ParityAbsence;

/** What checking the log directory found. */
interface LogDirCheck {
  absences: ParityAbsence[];
  /** Zero whenever there is an absence. */
  sessionLogCount: number;
}

/** An override's value, with an empty one counted as unset. */
function overrideOf(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | null {
  const value = env[name];
  return value === undefined || value === ''
    ? null
    : value;
}

/** An fs error's code, or its message when it carries none. */
function errorCodeOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return 'code' in error && typeof error.code === 'string'
    ? error.code
    : error.message;
}

/**
 * A path's stats, or null when nothing is there. Any other error is
 * rethrown, so a path that cannot be read is never taken for a path
 * that is absent.
 */
function statOrNull(path: string): Stats | null {
  try {
    return statSync(path);
  } catch (error) {
    if (NOTHING_THERE.has(errorCodeOf(error))) return null;
    throw error;
  }
}

/** An absence factory bound to one fixture and one source. */
function absenceFactory(
  fixture: ParityFixtureName,
  source: ParitySource,
): AbsenceFactory {
  return (code, path, detail = null) => ({
    fixture,
    code,
    path,
    source,
    detail,
  });
}

/**
 * Checks the session log directory, counting its logs with the
 * collector's own listing so the population is the one it reads.
 */
function checkSessionLogs(paths: ParityFixturePaths): LogDirCheck {
  const path = paths.logDir;
  const absent = absenceFactory('session logs', paths.logDirSource);
  const only = (absence: ParityAbsence): LogDirCheck => ({
    absences: [absence],
    sessionLogCount: 0,
  });

  if (!isAbsolute(path)) return only(absent('not-absolute', path));
  try {
    const stats = statOrNull(path);
    if (stats === null) return only(absent('missing', path));
    if (!stats.isDirectory()) return only(absent('not-a-directory', path));

    const sessionLogCount = listSessionLogs(path).length;
    return sessionLogCount === 0
      ? only(absent('no-session-log', path))
      : { absences: [], sessionLogCount };
  } catch (error) {
    return only(absent('unreadable', path, errorCodeOf(error)));
  }
}

/** Checks one stored-row file by stat alone. */
function checkStoredFile(
  path: string,
  absent: AbsenceFactory,
): ParityAbsence[] {
  try {
    const stats = statOrNull(path);
    if (stats === null) return [absent('missing', path)];
    if (!stats.isFile()) return [absent('not-a-file', path)];
    return stats.size === 0
      ? [absent('empty', path)]
      : [];
  } catch (error) {
    return [absent('unreadable', path, errorCodeOf(error))];
  }
}

/**
 * Checks the stored rows: the directory first, and each file only once
 * the directory is there, so a missing directory is one absence rather
 * than two missing files.
 */
function checkStoredRows(paths: ParityFixturePaths): ParityAbsence[] {
  const dir = paths.storeDir;
  const absent = absenceFactory('stored rows', paths.storeDirSource);

  if (!isAbsolute(dir)) return [absent('not-absolute', dir)];
  try {
    const stats = statOrNull(dir);
    if (stats === null) return [absent('missing', dir)];
    if (!stats.isDirectory()) return [absent('not-a-directory', dir)];
  } catch (error) {
    return [absent('unreadable', dir, errorCodeOf(error))];
  }
  return [paths.sessionsPath, paths.commitsPath].flatMap(
    (file) => checkStoredFile(file, absent),
  );
}

/** One absence as the reason line words it. */
function describeAbsence(absence: ParityAbsence): string {
  const phrase = ABSENCE_PHRASES[absence.code];
  const said = absence.detail === null
    ? phrase
    : `${phrase}, ${absence.detail}`;
  const source = absence.source === 'default'
    ? 'documented default'
    : `from ${absence.source}`;
  return `${absence.fixture} at ${absence.path}: ${said} (${source})`;
}

/**
 * Where the resolver looks. Pure: nothing on disk is read. Each
 * override outranks its own default and only its own, and an empty
 * override counts as unset.
 */
export function parityFixturePaths(
  options: ParityFixtureOptions = {},
): ParityFixturePaths {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const checkout = join(home, ...SIBLING_CHECKOUT);
  const logOverride = overrideOf(env, PARITY_LOG_DIR_ENV);
  const storeOverride = overrideOf(env, PARITY_STORE_DIR_ENV);
  const storeDir = storeOverride ?? join(checkout, ...SIBLING_STORE_DIR);

  return {
    logDir: logOverride ?? sessionLogDir(checkout, home),
    logDirSource: logOverride === null
      ? 'default'
      : PARITY_LOG_DIR_ENV,
    storeDir,
    storeDirSource: storeOverride === null
      ? 'default'
      : PARITY_STORE_DIR_ENV,
    sessionsPath: join(storeDir, SIBLING_STORE_FILES.sessions),
    commitsPath: join(storeDir, SIBLING_STORE_FILES.commits),
  };
}

/**
 * Resolves both parity fixtures: their paths when both are there, else
 * every absence and the one-line reason to skip on. Never throws; see
 * the module note.
 */
export function resolveParityFixture(
  options: ParityFixtureOptions = {},
): ParityFixture {
  const paths = parityFixturePaths(options);
  const logs = checkSessionLogs(paths);
  const absences = [...logs.absences, ...checkStoredRows(paths)];

  if (absences.length === 0) {
    return { ...paths, present: true, sessionLogCount: logs.sessionLogCount };
  }
  return {
    ...paths,
    present: false,
    absences,
    reason: `parity fixture absent: ${absences.map(describeAbsence).join('; ')}`,
  };
}
