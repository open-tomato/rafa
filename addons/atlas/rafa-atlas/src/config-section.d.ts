/**
 * The `atlas` key of the project's config, merged into core's
 * `ModuleSections` so a `rafa.config.ts` setting it type-checks wherever
 * this declaration is loaded. The manifest (`package.json`, `rafa`
 * block) names the key under `provides.config`, so the runtime keeps it
 * unwarned and hands its raw value to the module's commands as
 * `ctx.moduleConfig`; `readAtlasLayers` (`./layers.ts`) validates it
 * there, since a file's type is no proof of what a YAML layer holds.
 *
 * The merge names `src/config/index.ts` by its path, the file this
 * repository's `rafa.config.ts` imports `Config` from, and not core's
 * published subpath `@open-tomato/rafa/config` that `src/config/shape.ts`
 * shows: inside the repository that subpath lands on no file
 * (`tsconfig.packages.json` maps `@open-tomato/rafa/*` to
 * `packages/rafa/src`, which holds no `config` folder), and
 * `src/tests/core-package.sweep.test.ts` fails any `@open-tomato/rafa/`
 * specifier outside core that does not land on a core file.
 *
 * It is a `.d.ts`, so this package's build never loads the root's
 * `src/config/` into its own program: there the merge is dropped
 * without a word, and it holds in a program that loads both this file
 * and `src/config/index.ts`, as a `rafa.config.ts` referencing this file
 * does. `config-section.test.ts` checks it in such a program, with the
 * control that the key is refused without it.
 */
import type { AtlasSection } from './layers.js';

declare module '../../../../src/config/index.js' {
  interface ModuleSections {
    /** The Atlas section: the ordered `layers` the import flow card draws as its columns. */
    readonly atlas: AtlasSection;
  }
}
