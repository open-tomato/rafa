/**
 * The plan format's entry: the block reader, the plan parser and the
 * injection renderer.
 *
 * The spec's `exports` map points the package's `./plan` subpath at
 * `./dist/plan/index.js`, which is this module built, and the roadmap
 * names what that subpath is for: the parsers a service implements
 * against. A caller that reads plans, or renders one task's share of
 * one, and needs none of the rest of the library imports it from here.
 *
 * ## What the entry exports
 *
 *   - The block reader: {@link readRafaBlocks}, which answers every
 *     fenced `rafa:*` block of a document, with {@link isRafaBlockKind}
 *     and {@link RAFA_BLOCK_KINDS} naming the kinds this phase defines.
 *   - The plan parser: {@link parsePlan} and the model it answers, with
 *     {@link PLAN_BLOCK_KINDS} and {@link PLAN_HEADER_FIELDS} naming the
 *     blocks and header fields it reads.
 *   - The injection renderer: {@link renderInjection}, with its request
 *     and its answer.
 *   - The mode names, {@link INJECT_MODES} and `InjectMode`, so a caller
 *     can spell and check a request's mode without importing the config
 *     module.
 *
 * Nothing else. A subpath is a public surface: a name added to it later
 * breaks nobody, and a name removed breaks every caller that imported
 * it. So a type a model borrows from another module stays out: a task's
 * declaration is spelled `PlanTask['declaration']`, not imported from
 * the declaration module through here.
 *
 * ## The report parser is not exported
 *
 * The roadmap puts the report parser under this subpath too, so its
 * entry point belongs in the list above. There is none to export yet:
 * no module under `src/` reads a `rafa:report` block into a report, and
 * `src/report/` does not exist. The change that adds the report parser
 * adds its entry point here, and to the export list `index.test.ts`
 * pins.
 *
 * ## Importing the entry from inside the package
 *
 * `src/plan.ts`, the `rafa plan` command, sits beside this directory
 * under the same name. From `src/`, both `./plan` and `./plan.js`
 * resolve to that file and never to this entry, so a module inside the
 * package imports the entry as `./plan/index.js`. `index.test.ts` pins
 * all three resolutions.
 */
export type { InjectMode } from '../config.js';
export type { LineSpan, RafaBlock, RafaBlockKind } from './blocks.js';
export type {
  InjectionFallback,
  InjectionFallbackReason,
  InjectionRequest,
  InjectionTask,
  PlanInjection,
} from './inject.js';
export type {
  PlanBlockKind,
  PlanHeader,
  PlanHeaderExtra,
  PlanHeaderField,
  PlanIssue,
  PlanIssueReason,
  PlanModel,
  PlanStage,
  PlanTask,
  PlanTaskStatus,
} from './parse.js';

export { INJECT_MODES } from '../config.js';
export { isRafaBlockKind, RAFA_BLOCK_KINDS, readRafaBlocks } from './blocks.js';
export { renderInjection } from './inject.js';
export { parsePlan, PLAN_BLOCK_KINDS, PLAN_HEADER_FIELDS } from './parse.js';
