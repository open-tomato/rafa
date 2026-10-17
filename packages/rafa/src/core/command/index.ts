/**
 * The barrel over the command contract: every name `command.ts`,
 * `confirm.ts`, `lazy.ts`, `registry-types.ts`, `running.ts`,
 * `shared-flags.ts`, `spends.ts`, `types.ts` and `version.ts` export,
 * and nothing else.
 *
 * A file outside `packages/rafa/src/core/` imports this file and never the nine
 * behind it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `packages/rafa/src/core/` imports the nine directly and never this
 * file.
 *
 * ## What sits behind it
 *
 *   - `command.ts`: `RafaCommand`, the `RafaContext` it runs with,
 *     `CommandExit`, the routing words and the shape check;
 *   - `confirm.ts`: the `Prompter` every yes-or-no question goes
 *     through, the line prompter that reads one from a stream, and the
 *     lazy prompter that opens one only to ask;
 *   - `lazy.ts`: `CommandDeclaration`, a command less its `run`, and
 *     `lazyCommand`, the command over a declaration whose `run` imports
 *     the command's module and delegates to its default export;
 *   - `registry-types.ts`: the contract of the dispatcher's registry,
 *     `CommandRegistry` and the five shapes it names, and
 *     `CommandFeature`, what one feature contributes to it, whose
 *     builder stays in `src/cli/registry.ts`;
 *   - `running.ts`: the command this process is running with its parsed
 *     flags, recorded by the dispatcher and read by the spend guard;
 *   - `shared-flags.ts`: the flags commands of several features
 *     declare, spelled once: `HINT_FLAG` and `HINT_FLAG_SPEC`, the
 *     `--no-hint` flag of the six commands that end with a hint;
 *   - `spends.ts`: a command's `spends` declaration, `CommandSpend`, its
 *     shape check and the mark help ends a spender's roster line with;
 *   - `types.ts`: the contracts copied from open-tomato's `cli-core`,
 *     `CliContext`, `CliCommand`, `ArgSpec` and `FlagSpec`, which
 *     `RafaCommand` extends;
 *   - `version.ts`: the version the running build answers with, and the
 *     line that spells it.
 *
 * The nine hold no name in common, so each name is exported once and
 * from the file that declares it.
 *
 * ## Why one barrel can hold all nine
 *
 * A barrel that groups a file with a file outside `packages/rafa/src/core/` that
 * imports the barrel back by value is a runtime cycle. None of the nine
 * imports a file outside `packages/rafa/src/core/` by value. `command.ts` takes
 * `spendsProblem` from `spends.ts` beside it, and both take
 * `describeValue` from `packages/rafa/src/core/config/config-sections.ts`.
 * `lazy.ts` takes the shape check, `CommandExit` and `commandSpelling`
 * from `command.ts`, and `messageOf` from the same config file; the
 * module a lazy command loads is the caller's `load()`, imported when
 * the command runs, never by `lazy.ts` itself.
 * `confirm.ts` and `running.ts` import `node:` modules alone by value,
 * `running.ts` naming `command.ts` and `types.ts` with `import type`.
 * `version.ts` imports the root `package.json`, and `types.ts` nothing
 * by value: it names `packages/rafa/src/core/config/config-sections.ts` and the
 * `Output` port with `import type`. `registry-types.ts` imports nothing
 * by value either: it names `command.ts` with `import type`, and this
 * file exports its names with `export type`, so loading the barrel
 * never loads it. `shared-flags.ts` imports nothing by value either: it
 * names `command.ts` with `import type` alone.
 *
 * `command.ts` also names `src/project/scope.ts` with `import type`,
 * which is erased before anything loads; it named `src/cli/registry.ts`
 * the same way until the registry's contract moved into
 * `registry-types.ts`. `src/cli/registry.ts` imports this barrel by
 * value, for the shape check and the routing words, so that edge is the
 * one a value import in `command.ts` would turn into a cycle.
 *
 * Measured when the three moved: the value imports of the non-test files
 * under `src/` and `packages/` held six cycles before the move and the
 * same six after it, none through a file of this folder. The control,
 * the same tree with `command.ts` taking one value (`HELP_WORD`) from
 * `src/cli/registry.ts`, held a seventh: `src/cli/registry.ts`,
 * `command.ts` and this file.
 *
 * Measured again when `types.ts` moved in, over every strongly connected
 * set of the same value imports: five cycles at the base and five after
 * the move, none through a file of this folder or of `src/cli/core/`.
 * The same `HELP_WORD` control held a sixth, `src/cli/registry.ts`,
 * `command.ts` and this file.
 *
 * Measured again when `spends.ts` moved in, the same way: five cycles at
 * the base and five after the move, none through a file of this folder
 * or of `src/cli/`. The same `HELP_WORD` control held a sixth,
 * `src/cli/registry.ts`, `command.ts` and this file.
 *
 * Measured again when the registry's contract moved into
 * `registry-types.ts`, the same way: five cycles at the base and five
 * after the move, none through a file of this folder or of `src/cli/`.
 * The same `HELP_WORD` control held a sixth, `src/cli/registry.ts`,
 * `command.ts` and this file.
 *
 * Measured again when `shared-flags.ts` moved in, the same way and with
 * the untracked new file read: five cycles at the base and four after
 * the move, none through a file of this folder. The one gone is
 * `src/next/actions.ts` and `src/next/hint.ts`, broken because
 * `actions.ts` now takes `HINT_FLAG` from this barrel rather than from
 * `hint.ts`. The control, `shared-flags.ts` taking one value
 * (`HINT_TIMEOUT_MS`) from `src/next/hint.ts`, folded this file,
 * `shared-flags.ts` and `hint.ts` into one strongly connected set of
 * seventy files.
 *
 * ## What it exports
 *
 * Each name is spelled, types apart from values, as the config barrels
 * spell theirs. No name here is part of the published surface:
 * `src/index.ts` re-exports nothing from this file.
 *
 * `index.test.ts` holds the list to the nine files: every name any of
 * them exports is here once, as the same binding, and no other name is
 * here.
 */
export type {
  CommandDeprecation,
  CommandExample,
  CommandOutput,
  FlagDeprecation,
  RafaCommand,
  RafaContext,
  RafaFlagSpec,
} from './command.js';
export type { LazyPrompter, PromptOutput, Prompter } from './confirm.js';
export type { CommandDeclaration } from './lazy.js';
export type {
  CommandAlias,
  CommandFeature,
  CommandRegistry,
  CommandRegistryInput,
  ModuleMount,
  RosterOptions,
  SubjectSpec,
} from './registry-types.js';
export type { RunningCommand } from './running.js';
export type { CommandSpend, SpendsWhen } from './spends.js';
export type {
  ArgSpec,
  CliCommand,
  CliContext,
  FlagSpec,
} from './types.js';

export {
  COMMAND_OUTPUTS,
  CommandExit,
  commandProblem,
  commandSpelling,
  isRoutingWord,
  isTopLevel,
} from './command.js';
export { createLinePrompter, lazyPrompter } from './confirm.js';
export { lazyCommand } from './lazy.js';
export {
  restoreRunningCommand,
  runAsRunningCommand,
  runningCommand,
  setRunningCommand,
} from './running.js';
export { HINT_FLAG, HINT_FLAG_SPEC } from './shared-flags.js';
export {
  SPENDS_GLYPH,
  SPENDS_WHEN,
  spendsCondition,
  spendsMark,
  spendsProblem,
} from './spends.js';
export { RAFA_VERSION, versionLine } from './version.js';
