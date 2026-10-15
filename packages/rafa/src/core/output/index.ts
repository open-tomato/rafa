/**
 * The barrel over core's output: every name `active.ts`, `text.ts` and
 * `stream.ts` export, and nothing else.
 *
 * A file outside `packages/rafa/src/core/` imports this file and never the ones behind
 * it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `packages/rafa/src/core/` imports the file it needs directly and never
 * this file: `packages/rafa/src/core/config/config-load.ts` imports `active.ts`, for
 * the output its warnings go through, and
 * `packages/rafa/src/core/adapters/registry.ts` imports `stream.ts`.
 *
 * ## What sits behind it
 *
 * `active.ts`: the output this process writes through and the mode it
 * renders in, the scope a run holds them in, and the module-level value
 * a test sets. `text.ts`: the `text` Output adapter, which `active.ts`
 * makes its default output with. `stream.ts`: the `OutputStream` every
 * output adapter writes to. The `json` and `events` adapters stay in
 * `src/adapters/output/`, where `text.ts` and `stream.ts` keep a
 * re-export each for their importers outside core, and the `Output`
 * port stays in `packages/rafa/src/ports/index.ts`.
 *
 * ## Why the barrel closes no cycle
 *
 * A barrel that groups a file with a file outside `packages/rafa/src/core/` that
 * imports the barrel back by value is a runtime cycle. No file behind
 * this barrel imports a file outside `packages/rafa/src/core/` by value: `active.ts`
 * imports `text.ts` beside it, for the default output it makes at load,
 * and `text.ts` and `stream.ts` import nothing by value, only the
 * `Output` port and `OutputStream` with `import type`, which is erased
 * before anything loads. So nothing behind it reaches this barrel back.
 *
 * ## What it exports
 *
 * Each name is spelled, as the other core barrels spell theirs. No name
 * here is part of the published surface: `src/index.ts` re-exports
 * nothing from this file.
 *
 * `index.test.ts` holds the list to the files: every name the three
 * export is here once, as the same binding, and no other name is here.
 */
export type { OutputStream } from './stream.js';
export type { CreateTextOutputOptions } from './text.js';

export { activeOutput, activeOutputMode, runWithActiveOutput, setActiveOutput } from './active.js';
export { createTextOutput } from './text.js';
