/**
 * The barrel over the command contract: every name `command.ts`,
 * `confirm.ts`, `spends.ts`, `types.ts` and `version.ts` export, and
 * nothing else.
 *
 * A file outside `src/core/` imports this file and never the five
 * behind it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `src/core/` imports the five directly and never this
 * file.
 *
 * ## What sits behind it
 *
 *   - `command.ts`: `RafaCommand`, the `RafaContext` it runs with,
 *     `CommandExit`, the routing words and the shape check;
 *   - `confirm.ts`: the `Prompter` every yes-or-no question goes
 *     through, and the line prompter that reads one from a stream;
 *   - `spends.ts`: a command's `spends` declaration, `CommandSpend`, its
 *     shape check and the mark help ends a spender's roster line with;
 *   - `types.ts`: the contracts copied from open-tomato's `cli-core`,
 *     `CliContext`, `CliCommand`, `ArgSpec` and `FlagSpec`, which
 *     `RafaCommand` extends;
 *   - `version.ts`: the version the running build answers with, and the
 *     line that spells it.
 *
 * The five hold no name in common, so each name is exported once and
 * from the file that declares it.
 *
 * ## Why one barrel can hold all five
 *
 * A barrel that groups a file with a file outside `src/core/` that
 * imports the barrel back by value is a runtime cycle. None of the five
 * imports a file outside `src/core/` by value. `command.ts` takes
 * `spendsProblem` from `spends.ts` beside it, and both take
 * `describeValue` from `src/core/config/config-sections.ts`.
 * `confirm.ts` imports `node:` modules alone, `version.ts` the root
 * `package.json`, and `types.ts` nothing by value: it names
 * `src/core/config/config-sections.ts` and the `Output` port with
 * `import type`.
 *
 * `command.ts` also names `src/cli/registry.ts` and
 * `src/project/scope.ts`, each with `import type`, which is erased
 * before anything loads. `src/cli/registry.ts` imports this barrel by
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
 * ## What it exports
 *
 * Each name is spelled, types apart from values, as the config barrels
 * spell theirs. No name here is part of the published surface:
 * `src/index.ts` re-exports nothing from this file.
 *
 * `index.test.ts` holds the list to the five files: every name any of
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
export type { PromptOutput, Prompter } from './confirm.js';
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
export { createLinePrompter } from './confirm.js';
export {
  SPENDS_GLYPH,
  SPENDS_WHEN,
  spendsCondition,
  spendsMark,
  spendsProblem,
} from './spends.js';
export { RAFA_VERSION, versionLine } from './version.js';
