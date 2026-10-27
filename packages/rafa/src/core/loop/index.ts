/**
 * The barrel over the loop's session records and its doors onto the
 * Claude CLI: every name `sessions.ts`, `claude.ts`, `session-env.ts` and
 * `suite-failure.ts` export, and nothing else.
 *
 * A file outside `packages/rafa/src/core/` imports this file and never the two behind
 * it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `packages/rafa/src/core/` imports the two directly and never this file:
 * `session-readings.ts` and the six test files of `sessions.ts` import
 * that file, and `packages/rafa/src/core/adapters/registry.ts` and
 * `claude.test.ts` import `claude.ts`. `index.test.ts`, this file's own
 * test, is the one file of `packages/rafa/src/core/` that imports it.
 *
 * ## What sits behind it
 *
 *   - `sessions.ts`: the session records of `loop start`, one JSON file
 *     per run under `<root>/.rafa/runs/`, with their reads, the state a
 *     record reads as, the refusal of a second run of a plan, and the
 *     writes;
 *   - `claude.ts`: the two doors a Claude session is spawned through,
 *     the argument list both build, the spawners behind them, the
 *     interrupt of the sessions still running, and the spend guard's
 *     sentence;
 *   - `session-env.ts`: the environment a Claude session is spawned
 *     with, which `claude.ts` imports by path;
 *   - `suite-failure.ts`: the type of one failing test, which
 *     `sessions.ts` imports by path and `packages/rafa/src/suite/run.ts`
 *     re-exports.
 *
 * The four files share no name, and only `sessions.ts` imports
 * `suite-failure.ts`, for a type. One
 * import of this barrel loads both: a file that takes `isPidAlive`
 * alone loads `claude.ts` with it.
 *
 * The reading of one record is `session-record-parse.ts`, beside
 * `sessions.ts`, which imports it by path: the sets a record's fields
 * are checked against, `parseSessionRecord`, `SessionRecordError` and
 * the readers of the optional fields. It was
 * `src/loop/session-record-parse.ts` until it moved here, and a
 * re-export stays at that path. `sessions.ts` re-exports what a caller
 * of a record reads from there, four types and thirteen runtime names,
 * and this barrel carries them with the rest, so the parser takes no
 * line of its own here. So a file outside `packages/rafa/src/core/` that reads a
 * record needs this one import, as it needed `sessions.ts` alone before
 * the move.
 *
 * ## Why `claude.ts` is here
 *
 * A barrel is split when it would close a runtime cycle, and never
 * otherwise. `claude.ts` was the third file to move into this folder,
 * and it closes none behind this barrel, so it took no barrel of its
 * own. The section "Why the barrel closes no cycle" holds the
 * measurement.
 *
 * ## Why the session readings are not here
 *
 * `packages/rafa/src/core/loop/` has three barrels, all listed under `CORE_BARRELS` in
 * `scripts/survey/core-moves.ts`. `session-readings.ts`, the second
 * file that moved here, sits alone behind `readings.ts`. It reaches
 * `packages/rafa/src/effort/store/development-build.ts` by value, through
 * `packages/rafa/src/effort/store/task-finishes.ts`, and that file imports three
 * runtime names from this barrel. With `session-readings.ts` behind
 * this barrel the store would import this file, and this file the
 * store: a cycle of six files. `readings.ts` records the measurement,
 * and `readings.test.ts` holds that no name is on both barrels.
 *
 * ## Why the hop record is not here
 *
 * `hop-record.ts`, the shapes of the hop record and of a place, sits
 * alone behind `hops.ts`. `packages/rafa/src/next/hop-record.ts` and
 * `packages/rafa/src/project/position.ts` re-export its names, so they import a
 * barrel over it by value, and `src/loop/session-record-parse.ts`,
 * which `sessions.ts` imported by value, imported `asHopRecord` from
 * `packages/rafa/src/next/hop-record.ts` by value when the split was made; it has
 * since moved here and imports `hop-record.ts` by path. With `hop-record.ts` behind this
 * barrel that is a cycle of four files: this one, `sessions.ts`, the
 * parser and `packages/rafa/src/next/hop-record.ts`. `hops.ts` records the
 * measurement, and `hops.test.ts` holds that no name is on two loop
 * barrels. `sessions.ts` imports `hop-record.ts` by path, for
 * `HopRecord`.
 *
 * ## Why the barrel closes no cycle
 *
 * A barrel that groups a file with a file outside `packages/rafa/src/core/` that
 * imports the barrel back by value is a runtime cycle. `sessions.ts`
 * imported three files by value when it moved:
 * `packages/rafa/src/core/config/config-sections.ts`, for `messageOf`, and two outside
 * `packages/rafa/src/core/`, `src/loop/session-record-parse.ts` and
 * `packages/rafa/src/project/scope.ts`. Through them it reached 38 files by value, and
 * none of the 38 imported it by value. Both have since moved into
 * `packages/rafa/src/core/`, as `session-record-parse.ts` beside it and
 * `packages/rafa/src/core/config/scope.ts`.
 *
 * The parser, then `src/loop/session-record-parse.ts`, imported this
 * barrel for the record's interfaces with `import type` alone, which is
 * erased before anything loads; since it moved here as
 * `session-record-parse.ts` it imports `sessions.ts` by path, the same
 * way. Its own note says why its sets, its error and its id check live
 * on its side: so that it takes no value from `sessions.ts`. That rule
 * holds this barrel as well.
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
 * `claude.ts` imports four files by value: three of `packages/rafa/src/core/`,
 * `packages/rafa/src/core/command/command.ts` for `commandSpelling`,
 * `packages/rafa/src/core/command/running.ts` for the running command and
 * `packages/rafa/src/core/output/active.ts` for the active output, and one outside
 * it, `src/utils/session-env.ts`, which has since moved here as
 * `session-env.ts`. When it moved, `running.ts` was still
 * `src/cli/running.ts`; through the four it reached 13 files by value, and none of the 13
 * imported this barrel or `claude.ts` by value. None of the 38 files
 * `sessions.ts` reached did either. Eleven non-test files imported
 * `claude.ts` by value before the move and import this barrel since.
 *
 * Measured when `claude.ts` moved: the same six cycles before the move
 * and after it, none through a file of this folder, with this barrel
 * reaching 46 files by value. The control, the same tree with
 * `src/utils/session-env.ts` taking `CLAUDE_BIN` from this barrel and
 * returning it from a function, held a seventh of three files: this
 * file, `claude.ts` and that one.
 *
 * That seventh loaded in the three orders tried: each of the three
 * files imported first in a fresh `bun` process, then `claudeArgs`
 * called and `CLAUDE_BIN` and `RUNS_DIR` read through this barrel. A
 * second control read `CLAUDE_BIN` at the top level of
 * `src/utils/session-env.ts` instead. It loaded when that file came
 * first, and failed with
 * `ReferenceError: Cannot access 'CLAUDE_BIN' before initialization.`
 * when this file or `claude.ts` did.
 *
 * The map places `claude.ts` in c3 and `src/utils/session-env.ts` in
 * c4. The folder's two mapped files now tie, one in c2 and one in c3,
 * and a tie goes to the name that sorts first, so this file still lands
 * in c2. Read the way the sweep reads the graph, the first control held
 * one cross-cluster cycle, c2 with c3 and c4, and the tree as moved
 * held none.
 *
 * ## What it exports
 *
 * Each name is spelled, types apart from values, as the other core
 * barrels spell theirs. No name here is part of the published surface:
 * `src/index.ts` re-exports nothing from this file.
 *
 * `index.test.ts` holds the list to the four files: every name each
 * exports is here once, as the same binding, the first three share no name, the
 * names `sessions.ts` re-exports are the bindings
 * `session-record-parse.ts` declares, and no other name is
 * here.
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
export type { CapturedSession, CapturedSpawnOptions, CapturingSpawner, ClaudeSpawner } from './claude.js';
export type { SpawnEnv } from './session-env.js';
export type { SuiteFailure } from './suite-failure.js';

export {
  beginSession,
  errorCode,
  isPidAlive,
  isPositiveWhole,
  isSessionId,
  NONE_STEP_SCOPE,
  parseSessionRecord,
  readSession,
  readSessions,
  readState,
  RECORD_EXTENSION,
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
export {
  carriesFlag,
  CLAUDE_BASE_ARGS,
  CLAUDE_BIN,
  claudeArgs,
  interruptClaudeSessions,
  runClaude,
  runClaudeCaptured,
  SESSION_ID_FLAG,
  SETTING_SOURCES_FLAG,
  spawnClaude,
  spawnClaudeCaptured,
  spendWarning,
} from './claude.js';
export { sessionPath, sessionSpawnEnv } from './session-env.js';
