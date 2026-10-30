/**
 * The barrel over the service registry: every name `registry.ts` and
 * `shapes.ts` export, and nothing else.
 *
 * A file outside `packages/rafa/src/core/` imports this file and never the ones behind
 * it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `packages/rafa/src/core/` imports `registry.ts` or `shapes.ts` directly
 * and never this file.
 *
 * ## What sits behind it
 *
 * `registry.ts`: `RafaServices`, one key per service, the reason of each
 * key in `SERVICE_REASONS`, the slot the active set is kept in with
 * `registerServices`, `restoreServices` and `activeServices`, the last a
 * frozen facade whose members refuse, naming the root
 * `src/service-registry.ts`, while nothing is registered. `shapes.ts`:
 * the types the five service types are written over, the three
 * stale-docs line types `packages/rafa-release/src/docs/release-issue.ts` declared before
 * among them, and the five service types themselves.
 *
 * ## Why one barrel can hold both
 *
 * A barrel that groups a file with a file outside `packages/rafa/src/core/` that
 * imports the barrel back by value is a runtime cycle. `shapes.ts`
 * imports types alone, and `registry.ts` imports `shapes.ts` alone, for
 * types, so no file behind this barrel loads another file at all.
 *
 * ## What it exports
 *
 * Each name is spelled, types apart from values, as the other core
 * barrels spell theirs.
 *
 * `index.test.ts` holds the list to the files: every name `registry.ts`
 * and `shapes.ts` export is here once, as the same binding, and no other
 * name is here.
 */
export type { RafaServices, ServiceReason } from './registry.js';
export type {
  AddStaleDocLineOptions,
  AddStaleDocLineService,
  EndingSeams,
  EndWithNextStepService,
  PullRequestsInService,
  ReadStaleDocsVersionService,
  StaleDocLineResult,
  StaleDocsTracker,
  StaleDocsVersionOptions,
  TriageReportService,
  TriagedAction,
  TriagedBug,
  TriagedChannel,
  TriageServiceOptions,
  TriageServiceResult,
} from './shapes.js';

export {
  activeServices,
  registerServices,
  restoreServices,
  SERVICE_REASONS,
} from './registry.js';
