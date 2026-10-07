/**
 * The select options of the project's Stage and Horizon fields, spelled
 * once, by the template's exact names (`board.project.template`): the
 * rules (`./rules.ts`) answer them and the port (`./port.ts`) matches a
 * project's fields against them.
 *
 * ## A leaf, on purpose
 *
 * This module imports nothing. The lists used to live in `./rules.ts`,
 * and the port imported them from there, but `./rules.ts` reaches the
 * port back through the board readers it is built on (`../roadmap-epic-rows.ts`,
 * on through `../plan-spec.ts` to `./refresh.ts` and `./gh.ts`). In that
 * cycle, whichever of the two a process loaded first decided whether it
 * started at all: measured on bun 1.3.14 on 2026-10-07, a script whose
 * only import was `./rules.ts` failed with `ReferenceError: Cannot access
 * 'STAGE_OPTIONS' before initialization.` and one importing only
 * `./port.ts` with the same error for `PROJECT_PAGE_SIZE`. With the lists
 * here, neither edge closes the loop; `./options.test.ts` loads each of
 * the two alone in a fresh process.
 */

/** The Stage field's options, left to right, by the template's exact names. */
export const STAGE_OPTIONS = Object.freeze([
  'Backlog',
  'Triage',
  'Needs work',
  'Ready',
  'Blocked',
  'Claimed',
  'In development',
  'Waiting for approval',
  'In review',
  'Done',
  'Cancelled',
] as const);

/** One option of the Stage field. */
export type StageOption = (typeof STAGE_OPTIONS)[number];

/** The Horizon field's options, left to right, by the template's exact names. */
export const HORIZON_OPTIONS = Object.freeze([
  'Later',
  'Next',
  'Now',
  'Done',
  'Cancelled',
] as const);

/** One option of the Horizon field. */
export type HorizonOption = (typeof HORIZON_OPTIONS)[number];
