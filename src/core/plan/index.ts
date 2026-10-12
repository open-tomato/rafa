/**
 * The barrel over the plan parser and the plan-file helpers: every name
 * `parse.ts` and `plan-files.ts` export, and nothing else.
 *
 * A file outside `src/core/` imports this file and never the two behind
 * it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `src/core/` imports the two directly and never this file.
 * None outside this folder does today.
 *
 * ## What sits behind it
 *
 *   - `parse.ts`: the plan parser, which reads a plan's `rafa:*` blocks
 *     and its checklist into one model, with the names of the blocks,
 *     the header fields and the release levels it reads;
 *   - `plan-files.ts`: where plans are kept and how their files are
 *     named, counted and worded: the plans directory, the file a stub
 *     names, the task counts, and the lines the plan commands print.
 *
 * ## Why the block reader is not here
 *
 * `src/core/plan/` has two barrels, both listed under `CORE_BARRELS` in
 * `scripts/survey/core-moves.ts`. `blocks.ts`, the third file that moved
 * here, sits alone behind `block-reader.ts`.
 *
 * A barrel that groups a file with a file outside `src/core/` that
 * imports the barrel back by value is a runtime cycle. `parse.ts`
 * imports `src/utils/tracker.ts` by value, for `splitBlockerComment`,
 * and that file imports `readRafaBlocks` of `blocks.ts` by value. With
 * `blocks.ts` behind this barrel the tracker would import this file,
 * and this file `parse.ts`: a cycle of three.
 *
 * Measured when the three moved: the value imports of the non-test
 * files under `src/` and `packages/` held six cycles before the move and
 * the same six after it, none through a file of this folder. The
 * control, the same tree with this barrel re-exporting the block
 * reader's runtime names as well and `src/utils/tracker.ts` importing
 * `readRafaBlocks` from it, held a seventh: this file, `parse.ts` and
 * `src/utils/tracker.ts`.
 *
 * That seventh loaded without a `ReferenceError` in the five orders
 * tried: this file, the tracker, `parse.ts`, `blocks.ts` and
 * `plan-files.ts` each first in a fresh `bun` process, then a plan
 * parsed and a block read. `parse.ts` calls `splitBlockerComment` inside
 * a function, and the tracker calls `readRafaBlocks` inside one, so
 * neither reads the other at load. The split holds the rule rather than
 * that reading: a later top-level read on either side would fail in one
 * import order only.
 *
 * `src/tests/import-cycle.sweep.test.ts` would not have refused the
 * seventh. It fails on a cycle across two clusters of
 * `docs/survey/cluster-map.json`, and the three files of the seventh
 * were all placed in cluster c3.
 *
 * The other two files outside `src/core/` that the files behind this
 * barrel import by value, `src/utils/declaration.ts` and
 * `src/utils/plan-stamp.ts`, import no file by value.
 *
 * ## What it exports
 *
 * Each name is spelled, types apart from values, as the other core
 * barrels spell theirs. No name here is on `block-reader.ts`.
 *
 * The barrel is wider than the published surface it feeds.
 * `src/plan/index.ts`, the `./plan` entry, re-exports `parsePlan`,
 * `PLAN_BLOCK_KINDS`, `PLAN_HEADER_FIELDS` and ten types of `parse.ts`
 * from here. It leaves out `PLAN_RELEASE_LEVELS`, `PlanReleaseLevel` and
 * every name of `plan-files.ts`, as it did before the move.
 * `src/tests/entry-exports.test.ts` pins that entry's names.
 *
 * `index.test.ts` holds the list to the two files: every name either
 * exports is here once, as the same binding, no other name is here, and
 * no name here is on the other plan barrel.
 */
export type {
  PlanBlockKind,
  PlanHeader,
  PlanHeaderExtra,
  PlanHeaderField,
  PlanIssue,
  PlanIssueReason,
  PlanModel,
  PlanReleaseLevel,
  PlanStage,
  PlanTask,
  PlanTaskStatus,
} from './parse.js';
export type { PlansDir, TaskCounts } from './plan-files.js';

export { parsePlan, PLAN_BLOCK_KINDS, PLAN_HEADER_FIELDS, PLAN_RELEASE_LEVELS } from './parse.js';
export {
  checkbox,
  countTasks,
  formatCounts,
  isFile,
  issueLine,
  planFileName,
  plansDirAt,
  plural,
  REJECTED_DIR,
  rejectedPath,
  stubOfPlanFile,
} from './plan-files.js';
