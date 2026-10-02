/**
 * The suite baseline: the full suite's result at a plan's first dispatch,
 * kept as `SUITE_BASELINE-<stub>.json` beside the plan's tracker, and the
 * split of a later result's failures into NEW (absent from the baseline)
 * and KNOWN (present in it).
 *
 * The runner (`rafa loop start`) records the baseline once and compares
 * every later step against it, so a run that starts on an already-red
 * suite blocks nothing, and files nothing, for the failures it inherited.
 *
 * ## Where it lives
 *
 * Beside the tracker, named from it as the tracker is named from its
 * plan (`utils/tracker.ts`): `PLAN_TRACKER-foo.md` gives
 * `SUITE_BASELINE-foo.json` and a bare `PLAN_TRACKER.md` gives
 * `SUITE_BASELINE.json`. A plan's own path (`PLAN-foo.md`) names the same
 * file, so either may be handed in. Any other name is refused with a
 * `RangeError` rather than guessed at: a baseline written under a name no
 * reader derives would be silently never read.
 *
 * ## What is compared
 *
 * A failure is its test file plus its full test name
 * ({@link SuiteFailure}); two failures are the same when both strings
 * are equal. Nothing else is compared: not the error text (a failure's
 * `message` is stored but never compared), not the duration, not the
 * test's position in the file.
 *
 * With no baseline to compare against, every failure is new: the
 * comparison never assumes a failure was inherited. The same holds for a
 * baseline whose JUnit file was not read (`junit` other than `read`),
 * since it names no failure at all. Errors outside any test (a file that
 * throws while it loads) are carried as a count and name no test, so they
 * are not split here; the caller reads {@link SuiteResult.errors} and the
 * exit code for those.
 *
 * ## The file
 *
 * One JSON object, pretty-printed with a trailing newline, holding
 * {@link BASELINE_VERSION}, when it was recorded, the commit it was
 * recorded at, and the {@link SuiteResult} fields. A file that does not
 * parse, carries another version, or lacks a field reads as `unreadable`
 * with the reason, never as a throw: the caller decides whether to record
 * the baseline again.
 *
 * A failure's `message` is optional within version 1: it is written when
 * the result holds one, and a failure without it reads as before, so a
 * baseline written before messages were kept still reads as `read`. A
 * `message` that is present but not a string makes the file `unreadable`.
 */
import type { JunitReading, SuiteFailure, SuiteResult } from './run.js';

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** The version this module writes and the only one it reads. */
export const BASELINE_VERSION = 1;

/** The baseline file's name before its stub. */
export const BASELINE_FILE_PREFIX = 'SUITE_BASELINE';

/** A plan's or a tracker's file name, and the stub it carries, with its leading `-`. */
const PLAN_FILE_NAME = /^PLAN(?:_TRACKER)?(-.+)?\.md$/;

/** The JUnit readings a stored baseline may hold. */
const JUNIT_READINGS: readonly JunitReading[] = ['read', 'missing', 'unreadable'];

/** A suite result as the baseline file holds it. */
export interface SuiteBaseline extends SuiteResult {
  readonly version: typeof BASELINE_VERSION;
  /** When the run finished, as an ISO 8601 string. */
  readonly recordedAt: string;
  /** The commit the run was made at, or null when it was not read. */
  readonly commit: string | null;
}

/** How a baseline file read. */
export type BaselineReading =
  | { readonly state: 'read'; readonly baseline: SuiteBaseline }
  | { readonly state: 'missing' }
  | { readonly state: 'unreadable'; readonly reason: string };

/** A result's failures, split against a baseline. */
export interface FailureSplit {
  /** Failures the baseline does not hold, in the result's order. */
  readonly fresh: readonly SuiteFailure[];
  /** Failures the baseline holds too, in the result's order. */
  readonly known: readonly SuiteFailure[];
}

/**
 * The baseline file beside the tracker (or plan) at `trackerPath`. Throws
 * a `RangeError` for a file name that is neither a plan's nor a
 * tracker's; see the module note.
 */
export function baselinePathFor(trackerPath: string): string {
  const match = PLAN_FILE_NAME.exec(basename(trackerPath));
  if (match === null) {
    throw new RangeError(`baselinePathFor: ${trackerPath} is not a PLAN or PLAN_TRACKER file`);
  }
  return join(dirname(trackerPath), `${BASELINE_FILE_PREFIX}${match[1] ?? ''}.json`);
}

/** `failure` as a new object, its message kept only when it has one. */
function copyFailure(failure: SuiteFailure): SuiteFailure {
  return failure.message === undefined
    ? { file: failure.file, name: failure.name }
    : { file: failure.file, name: failure.name, message: failure.message };
}

/** A baseline of `result`, recorded at `recordedAt` on `commit`, as a new object. */
export function baselineOf(result: SuiteResult, recordedAt: Date, commit: string | null): SuiteBaseline {
  return {
    version: BASELINE_VERSION,
    recordedAt: recordedAt.toISOString(),
    commit,
    command: [...result.command],
    exitCode: result.exitCode,
    summary: result.summary,
    failures: result.failures.map(copyFailure),
    errors: result.errors,
    junit: result.junit,
  };
}

/**
 * Writes `baseline` to `path`, creating its directory, through a
 * temporary file renamed into place so a reader never sees half of it.
 */
export function writeBaseline(path: string, baseline: SuiteBaseline): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

/** True when `value` is a string or null. */
function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** True when `value` is a whole {@link SuiteFailure}. */
function isFailure(value: unknown): value is SuiteFailure {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const message = record['message'];
  return typeof record['file'] === 'string'
    && typeof record['name'] === 'string'
    && (message === undefined || typeof message === 'string');
}

/** The first field of `record` that does not hold what a baseline needs, or null. */
function badField(record: Readonly<Record<string, unknown>>): string | null {
  const checks: readonly (readonly [string, (value: unknown) => boolean])[] = [
    ['recordedAt', (value) => typeof value === 'string'],
    ['commit', isStringOrNull],
    ['command', (value) => Array.isArray(value) && value.every((part) => typeof part === 'string')],
    ['exitCode', (value) => Number.isInteger(value)],
    ['summary', isStringOrNull],
    ['failures', (value) => Array.isArray(value) && value.every(isFailure)],
    ['errors', (value) => value === null || Number.isInteger(value)],
    ['junit', (value) => JUNIT_READINGS.includes(value as JunitReading)],
  ];
  const failed = checks.find(([key, check]) => !check(record[key]));
  return failed?.[0] ?? null;
}

/** `parsed` as a baseline, or the reason it is not one. */
function asBaseline(parsed: unknown): BaselineReading {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { state: 'unreadable', reason: 'not a JSON object' };
  }
  const record = parsed as Record<string, unknown>;
  if (record['version'] !== BASELINE_VERSION) {
    return { state: 'unreadable', reason: `version ${JSON.stringify(record['version'])}, expected ${BASELINE_VERSION}` };
  }
  const bad = badField(record);
  if (bad !== null) return { state: 'unreadable', reason: `field ${bad} is missing or malformed` };
  return { state: 'read', baseline: parsed as SuiteBaseline };
}

/** The baseline at `path`, read and checked; see the module note. */
export function readBaseline(path: string): BaselineReading {
  if (!existsSync(path)) return { state: 'missing' };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const reason = error instanceof Error
      ? error.message
      : String(error);
    return { state: 'unreadable', reason };
  }
  try {
    return asBaseline(JSON.parse(text));
  } catch {
    return { state: 'unreadable', reason: 'not JSON' };
  }
}

/** The key two equal failures share. */
function failureKey(failure: SuiteFailure): string {
  return JSON.stringify([failure.file, failure.name]);
}

/**
 * `failures` split into those `baseline` does not hold and those it
 * does. With no baseline every failure is new; see the module note.
 */
export function splitFailures(failures: readonly SuiteFailure[], baseline: Pick<SuiteBaseline, 'failures'> | null): FailureSplit {
  const held = new Set((baseline?.failures ?? []).map(failureKey));
  return {
    fresh: failures.filter((failure) => !held.has(failureKey(failure))),
    known: failures.filter((failure) => held.has(failureKey(failure))),
  };
}
