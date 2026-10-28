/**
 * The barrel over the block reader: every name `blocks.ts` exports, and
 * nothing else.
 *
 * A file outside `packages/rafa/src/core/` imports this file and never the one behind
 * it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `packages/rafa/src/core/` imports `blocks.ts` directly and never this
 * file.
 *
 * ## Why one file has a barrel of its own
 *
 * `packages/rafa/src/core/plan/` has two barrels, both listed under `CORE_BARRELS` in
 * `scripts/survey/core-moves.ts`. `index.ts` holds the plan parser and
 * the plan-file helpers. This one holds `blocks.ts` alone, because
 * `index.ts` cannot take it.
 *
 * A barrel that groups a file with a file outside `packages/rafa/src/core/` that
 * imports the barrel back by value is a runtime cycle.
 * `packages/rafa/src/utils/tracker.ts` imports `readRafaBlocks` by value, and
 * `parse.ts`, behind `index.ts`, imported that file by value when the
 * split was made. So `blocks.ts` behind `index.ts` closed a cycle
 * through the tracker. `blocks.ts` imports no file, so a barrel that
 * holds it alone is imported back by nothing it reaches.
 *
 * `parse.ts` now reads the blocker comment from `blocker-comment.ts`,
 * and no file of `packages/rafa/src/core/` imports the tracker, so that cycle is
 * gone. The split stands as it was made.
 *
 * `index.ts` records the measurement: six cycles before the move and
 * the same six after it, and a seventh in the control that puts all
 * three files behind one barrel.
 *
 * ## What it exports
 *
 * Each name is spelled, types apart from values, as the other core
 * barrels spell theirs. `src/plan/index.ts`, the `./plan` entry,
 * re-exports all six, so this barrel is exactly as wide as the published
 * surface it feeds.
 *
 * `block-reader.test.ts` holds the list to the file: every name
 * `blocks.ts` exports is here once, as the same binding, no other name
 * is here, and no name here is on the other plan barrel.
 */
export type { LineSpan, RafaBlock, RafaBlockKind } from './blocks.js';

export { isRafaBlockKind, RAFA_BLOCK_KINDS, readRafaBlocks } from './blocks.js';
