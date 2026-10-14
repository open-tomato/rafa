/**
 * The machine-fault reading, kept at its old path. The module lives in
 * `src/effort/store/machine-fault.ts`, which the store's `triage.ts`
 * reads to write a bug's `scope`; this file re-exports it under the same
 * names for `src/triage/triage.ts` and `src/start/triage.ts`.
 *
 * Re-export kept for importers outside core; the third step of core's
 * move into its package (#1090) removes it.
 */
export type {
  MachineFault,
  MachineFaultKind,
  MachineFaultShapeName,
} from '../effort/store/machine-fault.js';
export {
  BUILD_FAILURE,
  isMachineFault,
  machineFaultSentence,
  readMachineFault,
  SHAPES,
} from '../effort/store/machine-fault.js';
