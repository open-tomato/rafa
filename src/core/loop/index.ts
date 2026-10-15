/**
 * The barrel over the loop's session records and its doors onto the
 * Claude CLI: every name `sessions.ts` and `claude.ts` export, and
 * nothing else.
 *
 * A file outside `src/core/` imports this file and never the two behind
 * it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `src/core/` imports the two directly and never this file:
 * `session-readings.ts` and the six test files of `sessions.ts` import
 * that file, and `src/core/adapters/registry.ts` and
 * `claude.test.ts` import `claude.ts`. `index.test.ts`, this file's own
 * test, is the one file of `src/core/` that imports it.
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
 *     sentence.
 *
 * The two files share no name, and neither imports the other. One
 * import of this barrel loads both: a file that takes `isPidAlive`
 * alone loads `claude.ts` with it.
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
 * `claude.ts` imports four files by value: two of `src/core/`,
 * `src/core/command/command.ts` for `commandSpelling` and
 * `src/core/output/active.ts` for the active output, and two outside
 * it, `src/cli/running.ts` and `src/utils/session-env.ts`. Through them
 * it reached 13 files by value when it moved, and none of the 13
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
 * `index.test.ts` holds the list to the two files: every name either
 * exports is here once, as the same binding, the two share no name, the
 * names `sessions.ts` re-exports are the bindings
 * `src/loop/session-record-parse.ts` declares, and no other name is
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
export {
  carriesFlag,
  CLAUDE_BASE_ARGS,
  CLAUDE_BIN,
  claudeArgs,
  interruptClaudeSessions,
  runClaude,
  runClaudeCaptured,
  SETTING_SOURCES_FLAG,
  spawnClaude,
  spawnClaudeCaptured,
  spendWarning,
} from './claude.js';
