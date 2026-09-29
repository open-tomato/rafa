/**
 * The `effort store schema` row of `rafa doctor`: whether this rafa can
 * read and write the effort store, read as `rafa effort schema --check`
 * reads it, and what in a store it uses is still worth a warning.
 *
 * ## What it reads
 *
 * The SQLite store every other command would open under the project
 * root: `<root>/.rafa/effort/effort.sqlite`, or the one under
 * `RAFA_EFFORT_DIR` when that is set (`effortStoreDir`,
 * `effort/store/location.ts`). It goes through `readSchemaReport`
 * (`effort/store/schema-report.ts`), which opens the store read-only and
 * adopts and applies nothing, so the row never changes a byte of the
 * store, a development build's doctor included.
 *
 * ## The outcome
 *
 *   - `fail` wherever `rafa effort schema --check` fails: a store this
 *     rafa refuses to read or to write (any of `planSchema`'s refusals,
 *     or `development-build`), a `RAFA_EFFORT_DIR` the location refuses,
 *     and a file that cannot be read as a store. `doctor` then exits 1,
 *     the refusal naming the store, the reason and the next safe step.
 *   - `warn` for a store this rafa uses that logs an unknown additive
 *     migration (`unknownAdditive`, each in the preflight's own words),
 *     or, for the project's own store alone, a migration whose
 *     `applied_by` names a development build (`developmentApplied`): a
 *     development build migrates only a copy, so such a row says a
 *     checkout's working tree once migrated the live store. A copy under
 *     `RAFA_EFFORT_DIR` is expected to hold such rows and is not warned
 *     about. A warning never changes the exit code.
 *   - `ok` otherwise: no store yet, a current one, or one behind that
 *     the next open brings forward.
 *
 * ## The lines
 *
 * {@link renderDoctorEffortSchema} gives text mode one row,
 * `Effort store schema: <outcome>, <status> (<path>)`, and, for a
 * failure, the reason and `Next safe step: <command>` under it. A
 * project with no store yet prints no line, as a repository with
 * nothing to clean prints no cleanup row; json mode still gives the
 * reading. The
 * warnings go through `warn` in both modes ({@link writeDoctorEffortSchema}),
 * as `doctor`'s other warnings do, so json mode reads each as a `log`
 * event. {@link effortSchemaRefusal} is the text `doctor` exits 1 with.
 */
import type { RafaContext } from '../cli/command.js';
import type { StoreEnvironment } from '../effort/store/location.js';
import type { SchemaReport, SchemaReportOptions, SchemaStatus } from '../effort/store/schema-report.js';

import { join } from 'node:path';

import { messageOf } from '../config-sections.js';
import { EFFORT_DIR_VARIABLE, effortStoreDir } from '../effort/store/location.js';
import {
  developmentApplied,
  NO_NEXT_STEP,
  readSchemaReport,
  unknownAdditive,
  unknownAdditiveWarning,
} from '../effort/store/schema-report.js';
import { SQLITE_STORE_FILE_NAME } from '../effort/store/sqlite.js';

/** The row's name, as its lines and the refusal spell it. */
export const EFFORT_SCHEMA_ROW = 'effort store schema';

/** The command that reads the whole log, which a warning points at. */
const SCHEMA_COMMAND = 'rafa effort schema';

/** How the row came out; see the module note. */
export type EffortSchemaOutcome = 'ok' | 'warn' | 'fail';

/** The report's status, or `unreadable` for a location or a file that could not be read as a store. */
export type EffortSchemaStatus = SchemaStatus | 'unreadable';

/** What the row read; json mode gives it as the result's `effortSchema`. */
export interface DoctorEffortSchemaReading {
  readonly outcome: EffortSchemaOutcome;
  /** The store file read, or null when `RAFA_EFFORT_DIR` was refused before one was named. */
  readonly path: string | null;
  /** Whether the file is the project's own store rather than a copy `RAFA_EFFORT_DIR` names. */
  readonly live: boolean;
  readonly status: EffortSchemaStatus;
  /** Why the row fails, without its next step; null when it does not. */
  readonly problem: string | null;
  /** One sentence per warning, in the order `warn` writes them. */
  readonly warnings: readonly string[];
  /** The one command to run next, or `none`. */
  readonly nextStep: string;
}

/** The warning for one migration a development build applied to the project's own store. */
export function developmentAppliedWarning(path: string, id: string, appliedBy: string): string {
  return `⚠ effort store ${path} logs migration ${id} applied by a development build (${appliedBy});`
    + ` a development build migrates only a copy. Read the log with ${SCHEMA_COMMAND}.`;
}

/** The reading of a location or a file that could not be read as a store. */
function unreadable(path: string | null, live: boolean, problem: string): DoctorEffortSchemaReading {
  return { outcome: 'fail', path, live, status: 'unreadable', problem, warnings: [], nextStep: NO_NEXT_STEP };
}

/** The reading of a report: failing where `--check` fails, warning as the module note says. */
function readingOf(report: SchemaReport, live: boolean): DoctorEffortSchemaReading {
  const { path, status, nextStep } = report;
  if (report.refused) {
    const problem = `this rafa refuses ${path} (${status}): ${String(report.refusal)}`;
    return { outcome: 'fail', path, live, status, problem, warnings: [], nextStep };
  }
  const developed = live
    ? developmentApplied(report).map(({ id, appliedBy }) => developmentAppliedWarning(path, id, appliedBy))
    : [];
  const warnings = [...unknownAdditive(report).map(unknownAdditiveWarning), ...developed];
  const outcome = warnings.length === 0
    ? 'ok'
    : 'warn';
  return { outcome, path, live, status, problem: null, warnings, nextStep };
}

/**
 * The row for the store under `root`, read with `env`'s
 * `RAFA_EFFORT_DIR`; never a throw. `options` is `readSchemaReport`'s,
 * for a test's synthetic catalogue or development probe.
 */
export function readDoctorEffortSchema(
  root: string,
  env: StoreEnvironment,
  options: SchemaReportOptions = {},
): DoctorEffortSchemaReading {
  const override = env[EFFORT_DIR_VARIABLE];
  const live = override === undefined || override === '';
  let path: string;
  try {
    path = join(effortStoreDir(root, env), SQLITE_STORE_FILE_NAME);
  } catch (error) {
    return unreadable(null, live, messageOf(error));
  }
  try {
    return readingOf(readSchemaReport(path, options), live);
  } catch (error) {
    return unreadable(path, live, `${path} cannot be read as an effort store: ${messageOf(error)}`);
  }
}

/** The failure's closing sentence: its next safe step, or nothing when there is none to name. */
function wayOut(reading: DoctorEffortSchemaReading): string {
  return reading.nextStep === NO_NEXT_STEP
    ? ''
    : ` Next safe step: ${reading.nextStep}`;
}

/** The lines text mode writes for the row; see the module note. */
export function renderDoctorEffortSchema(reading: DoctorEffortSchemaReading): readonly string[] {
  if (reading.outcome === 'ok' && reading.status === 'absent') return [];
  const where = reading.path === null
    ? ''
    : ` (${reading.path})`;
  const row = `Effort store schema: ${reading.outcome}, ${reading.status}${where}`;
  if (reading.problem === null) return [row];
  const next = reading.nextStep === NO_NEXT_STEP
    ? []
    : [`  Next safe step: ${reading.nextStep}`];
  return [row, `  ${reading.problem}`, ...next];
}

/** Writes the row's lines at `info` in text mode, and each warning at `warn` in both modes. */
export function writeDoctorEffortSchema(
  context: Pick<RafaContext, 'output' | 'outputMode'>,
  reading: DoctorEffortSchemaReading,
): void {
  if (context.outputMode !== 'json') {
    for (const line of renderDoctorEffortSchema(reading)) context.output.info(line);
  }
  for (const warning of reading.warnings) context.output.warn(warning);
}

/** The text `doctor` exits 1 with for a failing row, or null for a row that does not fail. */
export function effortSchemaRefusal(reading: DoctorEffortSchemaReading): string | null {
  if (reading.outcome !== 'fail') return null;
  return `rafa doctor: ${EFFORT_SCHEMA_ROW}: ${String(reading.problem)}${wayOut(reading)}`;
}
