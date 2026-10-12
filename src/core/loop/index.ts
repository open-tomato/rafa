/**
 * The barrel over the session records: every name `sessions.ts` exports,
 * and nothing else.
 *
 * A file outside `src/core/` imports this file and never the one behind
 * it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `src/core/` imports `sessions.ts` directly and never this
 * file. Its six test files beside it do, and no other file of
 * `src/core/` imports it today.
 *
 * ## What sits behind it
 *
 * `sessions.ts` alone: the session records of `loop start`, one JSON
 * file per run under `<root>/.rafa/runs/`, with their reads, the state a
 * record reads as, the refusal of a second run of a plan, and the
 * writes.
 *
 * The reading of one record stays outside `src/core/`, in
 * `src/loop/session-record-parse.ts`: the sets a record's fields are
 * checked against, `parseSessionRecord`, `SessionRecordError` and the
 * readers of the optional fields. `sessions.ts` re-exports what a caller
 * of a record reads from there, four types and eleven runtime names, and
 * this barrel carries them with the rest. So a file outside `src/core/`
 * that reads a record needs this one import, as it needed `sessions.ts`
 * alone before the move.
 *
 * ## Why the session readings are not here
 *
 * `src/core/loop/` has two barrels, both listed under `CORE_BARRELS` in
 * `scripts/survey/core-moves.ts`. `session-readings.ts`, the second
 * file that moved here, sits alone behind `readings.ts`. It reaches
 * `src/effort/store/development-build.ts` by value, through
 * `src/effort/store/task-finishes.ts`, and that file imports three
 * runtime names from this barrel. With `session-readings.ts` behind
 * this barrel the store would import this file, and this file the
 * store: a cycle of six files. `readings.ts` records the measurement,
 * and `readings.test.ts` holds that no name is on both barrels.
 *
 * ## Why the barrel closes no cycle
 *
 * A barrel that groups a file with a file outside `src/core/` that
 * imports the barrel back by value is a runtime cycle. `sessions.ts`
 * imports three files by value: `src/core/config/config-sections.ts`,
 * for `messageOf`, and two outside `src/core/`,
 * `src/loop/session-record-parse.ts` and `src/project/scope.ts`. Through
 * them it reached 38 files by value when it moved, and none of the 38
 * imported it by value.
 *
 * `src/loop/session-record-parse.ts` does import this barrel, for the
 * record's interfaces, with `import type` alone, which is erased before
 * anything loads. Its own note says why its sets, its error and its id
 * check live on its side: so that it takes no value from `sessions.ts`.
 * That rule now holds this barrel as well.
 *
 * Measured when the file moved: the value imports of the non-test files
 * under `src/` and `packages/` held six cycles before the move and the
 * same six after it, none through a file of this folder. The control,
 * the same tree with `src/loop/session-record-parse.ts` taking one
 * function (`errorCode`) from this barrel and calling it inside a
 * function, held a seventh: this file, `sessions.ts` and that one.
 *
 * That seventh loaded in the three orders tried: this file,
 * `sessions.ts` and `src/loop/session-record-parse.ts` each imported
 * first in a fresh `bun` process, then one record parsed through this
 * barrel. A second control took a `const` (`RUNS_DIR`) instead and read
 * it at the top level of `src/loop/session-record-parse.ts`. It loaded
 * when that file came first, and failed with
 * `ReferenceError: Cannot access 'RUNS_DIR' before initialization.`
 * when this file or `sessions.ts` did. The barrel holds the rule rather
 * than the first reading.
 *
 * `src/tests/import-cycle.sweep.test.ts` would have refused both
 * controls. It fails on a cycle across two clusters of
 * `docs/survey/cluster-map.json`, which places `sessions.ts` in c2 and
 * `src/loop/session-record-parse.ts` in c3; this file, which the map
 * does not name, lands in c2 by its folder. Read the way the sweep
 * reads the graph, each control held one cross-cluster cycle and the
 * tree as moved held none.
 *
 * ## What it exports
 *
 * Each name is spelled, types apart from values, as the other core
 * barrels spell theirs. No name here is part of the published surface:
 * `src/index.ts` re-exports nothing from this file.
 *
 * `index.test.ts` holds the list to the file: every name `sessions.ts`
 * exports is here once, as the same binding, the names it re-exports
 * are the bindings `src/loop/session-record-parse.ts` declares, and no
 * other name is here.
 */
export type {
  PidProbe,
  SessionChange,
  SessionConflict,
  SessionConflictReason,
  SessionDecision,
  SessionDraft,
  SessionPhase,
  SessionReadSeams,
  SessionRecord,
  SessionState,
  SessionStep,
  SessionStepKind,
  SessionStepOnly,
  SessionStepReason,
  SessionTask,
  SessionTaskRef,
} from './sessions.js';

export {
  beginSession,
  errorCode,
  isPidAlive,
  isSessionId,
  parseSessionRecord,
  readSession,
  readSessions,
  readState,
  RUNS_DIR,
  runsDir,
  samePlan,
  SESSION_DECISION_STRATEGIES,
  SESSION_PHASES,
  SESSION_STATES,
  SESSION_STEP_KINDS,
  SESSION_STEP_REASONS,
  SessionConflictError,
  sessionConflicts,
  sessionDecisions,
  sessionFilePath,
  sessionPhase,
  SessionRecordError,
  SessionStateError,
  sessionSteps,
  updateSession,
} from './sessions.js';
