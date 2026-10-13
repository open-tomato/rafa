/**
 * The barrel over the session readings: every name
 * `session-readings.ts` exports, and nothing else.
 *
 * A file outside `src/core/` imports this file and never the one behind
 * it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `src/core/` imports `session-readings.ts` directly and
 * never this file. None does today.
 *
 * ## What sits behind it
 *
 * `session-readings.ts` alone: the session records under a root with
 * the state each reads as, whether a record's run has ended, a session
 * written as a line, a session's tasks and rough ETA, a rough duration
 * as a person reads it, the refusal those throw, and the seams they
 * reach the system through. It is the library half of
 * `src/commands/loop/loop-sessions.ts`.
 *
 * ## Why one file has a barrel of its own
 *
 * `src/core/loop/` has two barrels, both listed under `CORE_BARRELS` in
 * `scripts/survey/core-moves.ts`. `index.ts` holds `sessions.ts` and
 * `claude.ts`. This one holds `session-readings.ts` alone, because
 * `index.ts` cannot take it.
 *
 * A barrel that groups a file with a file outside `src/core/` that
 * imports the barrel back by value is a runtime cycle.
 * `session-readings.ts` imports `src/effort/store/task-finishes.ts` by
 * value, for `readTaskFinishes`. That file imports the store's
 * `sqlite.ts`, which imports `bring-forward.ts`, which imports
 * `development-build.ts`, each by value, and
 * `src/effort/store/development-build.ts` imports `isPidAlive`,
 * `readSessions` and `runsDir` from `index.ts` by value. So
 * `session-readings.ts` behind `index.ts` closes a cycle through the
 * store.
 *
 * Measured when the file moved: `session-readings.ts` reached 67 files
 * by value, 14 of them under `src/effort/store/`. One of the 67 imported
 * `index.ts` by value, `src/effort/store/development-build.ts`, and
 * none imported this file by value. `src/effort/store/migrate.ts`, the
 * store's other importer of `index.ts`, was not among the 67.
 *
 * The value imports of the non-test files under `src/` and `packages/`
 * held six cycles before the move and the same six after it, none
 * through a file of this folder. The control, the same tree with
 * `index.ts` re-exporting `isLive` of `session-readings.ts` as well,
 * held a seventh of six files: `index.ts`, `session-readings.ts`,
 * `src/effort/store/task-finishes.ts`, `src/effort/store/sqlite.ts`,
 * `src/effort/store/bring-forward.ts` and
 * `src/effort/store/development-build.ts`.
 *
 * That seventh loaded without a `ReferenceError` in the six orders
 * tried: each of the six files imported first in a fresh `bun` process,
 * then `isLive` called and `RUNS_DIR` read through `index.ts`. The split
 * holds the rule rather than that reading: a later top-level read on
 * either side would fail in one import order only.
 *
 * `src/tests/import-cycle.sweep.test.ts` would have refused the
 * control. It fails on a cycle across two clusters of
 * `docs/survey/cluster-map.json`, which places the four store files in
 * c5. The map names neither `session-readings.ts`, at this path or at
 * `src/loop/` before it, nor either barrel; all three land in c2 by
 * their folder. Read the way the sweep reads the graph, the control
 * held one cross-cluster cycle, c2 with c5, and the tree as moved held
 * none.
 *
 * ## What it exports
 *
 * Each name is spelled, types apart from values, as the other core
 * barrels spell theirs. No name here is on `index.ts`, and no name here
 * is part of the published surface: `src/index.ts` re-exports nothing
 * from this file.
 *
 * `readings.test.ts` holds the list to the file: every name
 * `session-readings.ts` exports is here once, as the same binding, no
 * other name is here, and no name here is on the other loop barrel.
 */
export type { LoopSessionSeams, ResolvedLoopSeams, SessionChecklist, SessionEta } from './session-readings.js';

export {
  estimateEta,
  formatDuration,
  isLive,
  planLabel,
  readRecords,
  readSessionChecklist,
  readSessionFinishes,
  refusal,
  resolveLoopSeams,
  runsLabel,
  sessionLine,
  STOP_POLL_MS,
  STOP_WAIT_MS,
} from './session-readings.js';
