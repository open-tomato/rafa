/**
 * The barrel over the hop record's shapes: every name `hop-record.ts`
 * exports, and nothing else.
 *
 * A file outside `packages/rafa/src/core/` imports this file and never the one behind
 * it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `packages/rafa/src/core/` imports `hop-record.ts` directly and never this
 * file: `sessions.ts` does, for `HopRecord`.
 *
 * ## Why one file has a barrel of its own
 *
 * `packages/rafa/src/core/loop/` has three barrels, all listed under `CORE_BARRELS` in
 * `scripts/survey/core-moves.ts`. `hop-record.ts` would have gone behind
 * `index.ts`, and it closed a runtime cycle there.
 *
 * A barrel that groups a file with a file outside `packages/rafa/src/core/` that
 * imports the barrel back by value is a runtime cycle. `src/next/hop-record.ts`
 * imports `asHopRecord` by value to re-export it, and
 * `src/loop/session-record-parse.ts` imported it from there by value
 * when the split was made (the parser has since moved beside
 * `sessions.ts` and imports `hop-record.ts` by path).
 * `sessions.ts`, behind `index.ts`, imports that parser by value. So
 * `hop-record.ts` behind `index.ts` closed a cycle of four files:
 * `index.ts`, `sessions.ts`, `src/loop/session-record-parse.ts` and
 * `src/next/hop-record.ts`. `hop-record.ts` imports no file, so a barrel
 * that holds it alone is imported back by nothing it reaches.
 *
 * Measured when the split was made: with the names on `index.ts` and
 * `src/project/position.ts` and `src/next/hop-record.ts` importing it,
 * `src/tests/import-cycle.sweep.test.ts` failed on that cycle across
 * c1, c2 and c3 of `docs/survey/cluster-map.json`, and with them on this
 * barrel it passed.
 *
 * ## What it exports
 *
 * `Place` and `asPlace`, which `src/project/position.ts` re-exports;
 * `HopKind`, `HopState`, `HopRecord` and `asHopRecord`, which
 * `src/next/hop-record.ts` re-exports; and `isRecord`, which
 * `src/project/position.ts` reads for its own check. `hops.test.ts` holds
 * the list to `hop-record.ts`, and holds that no name here is on the
 * other two loop barrels.
 */
export type { HopKind, HopRecord, HopState, Place } from './hop-record.js';

export { asHopRecord, asPlace, isRecord } from './hop-record.js';
