/**
 * The barrel over the active output: every name `active.ts` exports, and
 * nothing else.
 *
 * A file outside `src/core/` imports this file and never the one behind
 * it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `src/core/` imports `active.ts` directly and never this
 * file: `src/core/config/config-load.ts` does, for the output its
 * warnings go through.
 *
 * ## What sits behind it
 *
 * `active.ts` alone: the output this process writes through and the mode
 * it renders in, the scope a run holds them in, and the module-level
 * value a test sets. The output adapters (`text.ts`, `json.ts`,
 * `events.ts`) and the `OutputStream` they write to stay in
 * `src/adapters/output/`, and the `Output` port in `src/ports/index.ts`.
 *
 * ## Why the barrel closes no cycle
 *
 * A barrel that groups a file with a file outside `src/core/` that
 * imports the barrel back by value is a runtime cycle. `active.ts`
 * imports one file outside `src/core/` by value:
 * `src/adapters/output/text.ts`, for the default output it makes at
 * load. That file imports nothing by value: `stream.ts` beside it and
 * the `Output` port, each with `import type`, which is erased before
 * anything loads. So it imports this barrel back by no route.
 *
 * Measured when the file moved: the value imports of the non-test files
 * under `src/` and `packages/` held six cycles before the move and the
 * same six after it, none through a file of this folder. The control,
 * the same tree with `src/adapters/output/text.ts` taking one value
 * (`activeOutputMode`) from this barrel, held a seventh: that file,
 * `active.ts` and this one. That seventh loaded in the three orders
 * tried (`text.ts`, this file and `active.ts` each imported first in a
 * fresh `bun` process), because both names crossing it are function
 * declarations, which exist before their module runs. The barrel holds
 * the rule rather than that reading: `active.ts` calls
 * `createTextOutput` at load, not inside a function, so a `const` on
 * either side of such a cycle would fail in one import order only.
 *
 * ## What it exports
 *
 * Each name is spelled, as the other core barrels spell theirs.
 * `active.ts` exports no type, so there is no `export type` line. No
 * name here is part of the published surface: `src/index.ts` re-exports
 * nothing from this file.
 *
 * `index.test.ts` holds the list to the file: every name `active.ts`
 * exports is here once, as the same binding, and no other name is here.
 */
export { activeOutput, activeOutputMode, runWithActiveOutput, setActiveOutput } from './active.js';
