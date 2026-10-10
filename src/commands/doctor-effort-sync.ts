/**
 * The `effort sync` row of `rafa doctor`: the lines it prints for whether
 * the strategy the project's `effort.sync` names has an adapter to carry
 * the store, and the text `doctor` exits 1 with when none does. This is
 * the command half of `../effort/sync/doctor-reading.ts`, which holds the
 * reading itself (`readDoctorEffortSync`), its types
 * (`DoctorEffortSyncReading`, `DoctorEffortSyncSeams`,
 * `DoctorEffortSyncInput`) and the row's name (`EFFORT_SYNC_ROW`), for
 * the preflight of `loop start` to read with the same ones. Its note
 * says what is read, which registry each kind is selected through, and
 * what each outcome means.
 *
 * ## The lines
 *
 * {@link renderDoctorEffortSync} gives text mode one row on every run,
 * since every project has a strategy: `Effort sync: ok, <strategy>`,
 * with ` (module)` for a strategy a module serves, or
 * `Effort sync: fail, <strategy>` with each line of the problem indented
 * under it. json mode gives the reading as the result's `effortSync`.
 *
 * ## The refusal
 *
 * A failing row makes `doctor` exit 1 with {@link effortSyncRefusal}:
 * `rafa doctor: effort sync: <problem>`, the row's name said once since
 * the reading's `problem` comes without it.
 */
import type { DoctorEffortSyncReading } from '../effort/sync/doctor-reading.js';

import { EFFORT_SYNC_ROW } from '../effort/sync/doctor-reading.js';

/** The lines text mode writes for the row; see the module note. */
export function renderDoctorEffortSync(reading: DoctorEffortSyncReading): readonly string[] {
  const served = reading.source === 'module'
    ? ' (module)'
    : '';
  const row = `Effort sync: ${reading.outcome}, ${reading.strategy}${served}`;
  if (reading.problem === null) return [row];
  return [row, ...reading.problem.split('\n').map((line) => `  ${line}`)];
}

/** The text `doctor` exits 1 with for a failing row, or null for a row that passes. */
export function effortSyncRefusal(reading: DoctorEffortSyncReading): string | null {
  if (reading.outcome !== 'fail') return null;
  return `rafa doctor: ${EFFORT_SYNC_ROW}: ${String(reading.problem)}`;
}
