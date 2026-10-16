## Source

What `src/` and `packages/` expect of a new or moved module that no gate
spells out, and the shapes the lint config forces.

### Imports

- **Relative imports name `.ts` files with `.js` specifiers.** Keep them
  when a file moves.
- **From `src/`, `./plan` and `./plan.js` both resolve to `src/plan.ts`**,
  the `rafa plan` command, and never to the `src/plan/` barrel: import
  `./plan/index.js`.
- **A library module never imports `src/rafa.ts`.** It dispatches on
  `process.argv` when imported; `src/index.ts` explains the rule and
  `index.test.ts` measures it.
- **A cross-subject helper import is the convention, not a smell.**
  Shared refusals and readers live in the subject that first needed them
  rather than in a neutral module: command modules take the plan readers
  from the plan barrel, `@open-tomato/rafa/core/plan`, and
  `src/commands/release/tag.ts` takes `versionTag` from
  `../../release/version-tag.js` so two writers cannot spell one tag
  differently. Reach for the existing helper — a second spelling of a
  refusal is the real smell, as `release status`'s hand-rolled
  `Expected no arguments` is beside `src/commands/plan/plan-files.ts`'s
  shared `expectNoArgument`, which says `Expected no argument`.
- **Every `import type` line forms one `import/order` group**
  (`packages/eslint-config/sharedRules.mjs`), and no short rule predicts its order: neither plain
  name order, "every sibling before every parent", nor path depth first,
  as this bullet read until 2026-09-24. `src/plan/risk.ts` puts its two
  `./risk/` lines first and its `../core/` and `../utils/` lines after,
  while `src/board/project/rules.ts` puts `./options.js` last, after its
  `../` lines. Both pass eslint. Take the order from
  `bunx eslint --fix-dry-run --format json <file>`, not from this page.
  Value imports differ: the `parent` group (`../`) comes before the
  `sibling` group (`./`), a blank line between them.
- **`tsconfig.json` sets `lib` to `ES2022`**, so an ES2023 method such as
  `Array.prototype.toSorted` fails `check-types` although bun runs it.
  Sort a copy with `[...array].sort()`.

### Explicit types on exports

**`base.json` of `packages/typescript-config` sets `isolatedDeclarations`
and `erasableSyntaxOnly`**. Every tsconfig reaches it by one chain: the
root `tsconfig.json` and each composite member's `tsconfig.json` extend
`tsconfig.packages.json`, which extends
`@open-tomato/rafa-typescript-config/base`, the name the root's
`workspace:*` line links into `node_modules`. So the root config and the
three code packages are held to both flags by `bun run check-types`, with no
flag on the command line. The package's `base.test.ts` holds both flags and
`declaration`. `declaration` sits beside them because `tsc` refuses
`isolatedDeclarations` without it; under the base's `noEmit` it writes no
file. The root `tsconfig.json` excludes `**/*.test.ts`,
so `check-types` does not hold a test file under `src/` or `scripts/`. The
runner's type step does, for the test files a task adds or edits: its scratch
config extends `tsconfig.json` and takes the flags with it. The
`tsconfig.json` of each of the three code packages leaves its test files out
too, as the root does, so `check-types` holds no test file anywhere: `tsc`
reports no `isolatedDeclarations` error for a program with any other error,
and the test files carry hundreds (the spike's probe 8, #804).

- **An export carries its type.** An exported `const`, a function's
  return, and a parameter or property whose default is not a plain
  literal each need an annotation the compiler can read from the file
  alone; a missing one is a TS90xx error (`a = [1].length` is refused,
  `b = 2` is not). Write the type the compiler infers, then read it
  against what the export is for. A frozen literal array or object that a
  `typeof X[number]` or `keyof typeof X` reads keeps its literal type
  (`readonly ['a', 'b']`, not `readonly string[]`). A path, a message or
  a query string is `string`, and a pattern is `RegExp`. Where a named
  type already says it, write the name instead of the expanded shape.
- **A command's default export takes the `const command: RafaCommand` form**:
  `const command: RafaCommand = createNextCommand();` and then `export default
  command;`, as `src/commands/next.ts` does. `RafaCommand` comes from the
  command barrel, `packages/rafa/src/core/command/index.ts`. Where the
  expression is not assignable to `RafaCommand`, fix the factory's declared
  return type rather than the annotation.
- **An annotation adds `import type` only, never a value import.** A
  value import of a barrel from a file the barrel imports back closes a
  runtime cycle (A barrel is split, never widened, below). No `any`, no
  `import('…')` type and no `as` cast is added to make an annotation fit.
- **A constructor declares its fields instead of using parameter
  properties.** `constructor(readonly step: UpdateStep)` is refused with
  TS1294; declare the field on the class and assign it in the body, as
  `UpdateStepError` in `src/project/update-current.ts` does. An `enum`
  and a `namespace` holding values are refused the same way.
- **One TS1294 or ordinary type error hides every TS90xx error.** `tsc`
  computes the TS90xx errors only for a program with no other error, so
  fix the others first and run it again before reading a file as clean.
- **`scripts/codemod/explicit-exports.ts` writes the annotations.** Run
  `bun scripts/codemod/explicit-exports.ts <folder>…`, with `--dry-run`
  to print the changes and write nothing. It lists each export it
  refuses, and those are annotated by hand.

### Core and its barrels

**Core is the workspace package `packages/rafa/`, the code every part of rafa
reads.** Its source is `packages/rafa/src/`, and the files of its `core/`
folder are the connective tissue of the codebase: graph analysis calls such
files high-betweenness nodes, since many paths between the rest of the tree
run through them. `CORE_MOVES` of `scripts/survey/core-moves.ts` lists the
twenty-nine files that changed path, nineteen by #905 and ten more by #1088
and #1089, `runtime/identity.ts` among them. They sit in eight subject
folders. `config/` holds the value readers, core's keys of the schema, the
section contract, core's own section and the loader; `command/` the command
contract (`RafaCommand`, `RafaContext`, `CommandExit`), the version and the
confirm prompt; `output/` the active output; `adapters/` the adapter registry;
`git/` the git runner and the commit helpers; `plan/` the block reader, the
plan parser and the plan-file readers; `loop/` the loop's session helpers, its
session readings and the Claude spawner; `runtime/` the reading of which build
is running. A file keeps its base name when it moves. A moved file keeps a
re-export at its old path while a non-test file outside core still imports it
there; `CORE_REEXPORTS` of `scripts/survey/core-moves.ts` lists those paths,
and it is empty since the move into the package.

Two edge cases show why a file is core. `src/pr/git.ts` sat under the
pull-request code, but release code imports the git runner too, so it moved to
`packages/rafa/src/core/git/`. `packages/rafa/src/report/parse.ts` reads like
the run's report code, but the effort store reads it, so it is core. Core is
also `packages/rafa/src/ports/`, the effort store under
`packages/rafa/src/effort/store/` and `packages/rafa/src/report/record.ts`: core
by assignment, kept where they are. `CORE_FOLDERS` and `CORE_NAMED_FILES` of
`scripts/survey/core-moves.ts` list core's folders and named files, and
`isCoreFile` reads them: the one place a sweep, a survey script or a spawned
loader takes core's location from.

**Core is imported by its name, and a core file's subpath is its path under
`packages/rafa/src/`.** The subpath drops the extension and a closing
`/index`: `packages/rafa/src/core/config/index.ts` is `core/config` and
`packages/rafa/src/core/config/load.ts` is `core/config/load`. One folder is
spelled differently. `effort/store` is spelled `store`, the name the root
already publishes, so the store barrel is `@open-tomato/rafa/store`, and the
ports barrel is `@open-tomato/rafa/ports`. The `core/` prefix is not optional:
`@open-tomato/rafa/plan` and `@open-tomato/rafa/config` are the root's own
`./plan` and `./config` exports, and core's subpaths must not collide with
them. So the thirteen barrels of `CORE_BARRELS` read
`@open-tomato/rafa/core/adapters`, `core/command`, `core/config`,
`core/config/load`, `core/config/sections`, `core/git`, `core/loop`,
`core/loop/hops`, `core/loop/readings`, `core/output`, `core/plan`,
`core/plan/block-reader` and `core/runtime`; the named files read
`report/parse`, `report/record`, `schema/tiers` and `schema/project-id`; the
augmentation target reads `core/config/config-schema`. A store file is
`store/<file>` and a ports file `ports/<file>`.

**Two names, by job.** An import reads `@open-tomato/rafa/<subpath>`, which
the `paths` map of `tsconfig.packages.json` resolves to core's source, so no
import line spells the manifest name. That name is `@open-tomato/rafa-core`,
core's workspace package name for good (`packages/rafa/package.json`,
private); the root publishes `@open-tomato/rafa` with core bundled. The
manifests spell it in four places: core's own `package.json` and the three
`workspace:*` lines, the root's `devDependencies` and the two services'
`dependencies`. #808 retires the `types`-only `exports` entries the root keeps
for core's files.

**A subject's barrel is the only file under `packages/rafa/src/core/` that a
file outside it may import.** There are thirteen, all listed in `CORE_BARRELS`
of `scripts/survey/core-moves.ts`: an `index.ts` in each subject folder, and
five more, `config/sections.ts`, `config/load.ts`, `loop/readings.ts`,
`loop/hops.ts` and `plan/block-reader.ts`. A barrel re-exports the names of the
files behind it and no more. The barrels are the declared exports until the cut
names real subpaths (#808).

**Outside `packages/rafa/src/core/`, a file imports a barrel by its subpath
and nothing deeper.** In a file outside `packages/rafa/src/core/`, no static
import, `import type`, `export … from` or dynamic `import()` names a file
behind a barrel. Inside `packages/rafa/src/core/`, a file imports the files it
needs by relative path, siblings and other subjects' files alike, and never a
barrel. No non-test file under `packages/rafa/src/` imports
`@open-tomato/rafa/<anything>`, but no barrel rule reaches the effort store or
the ports folder: the store imports core's barrels by relative path today, as
`effort/store/move.ts` does, and this plan adds none. A grep at this commit
found no barrel imported from inside core, but no sweep measures that half.

**The deep-import sweep holds the outside half.**
`src/tests/core-barrels.sweep.test.ts` reads every code file a commit would
hold, tracked or untracked and not ignored, under `src/`, `scripts/` and
`packages/` and at the root, test files included, less core's own files and
its parked tests: the paths `isCoreRead` of `scripts/survey/core-moves.ts`
holds, today the package's source `packages/rafa/src/` and
`src/tests/core-coupled/`, are named and not read. It fails on any import from
outside core that reaches a file inside `packages/rafa/src/core/` other than a
listed barrel. The reading is `readCoreImports` in
`scripts/survey/core-barrels.ts`, over the specifiers `textImports` finds, so
an `import type`, an `export … from`, a dynamic `import()` and a `require()`
count as much as a static import. It takes no allow-list: a path is allowed
only by listing it as a barrel in `core-moves.ts`, and `core-moves.test.ts`
checks that list's shape. An `index.ts` under a subject folder is a deep
import like any other file. Three things are not seen: an `import()` or
`require()` whose argument is not a string literal, a `mock.module()` call,
and a path built for a spawned process or a file read. The sweep prints the
files it read at load, so an empty read cannot pass. A module augmentation is
no import: a `declare module` naming
`@open-tomato/rafa/core/config/config-schema`, which each
`src/config-schema-*.ts` file writes to add its fields to `RafaConfig`, is
answered under `augment` and passes. It has to name the declaring file:
spelled through the config barrel, two augmentations merged with each other
and not with `RafaConfig`, whose `keyof` missed both. That file is one of
core's `exports` entries until #808 retires them.

**The two-names sweep holds the two names to the live tree.**
`src/tests/core-package.sweep.test.ts`, beside the barrels sweep, has three
checks, and planted trees that break each half of the rule. The outside half:
each specifier opening `@open-tomato/rafa/` in a code file outside core,
resolved by `Bun.resolveSync` from its importer's folder as `bunResolver` of
`scripts/survey/import-graph.ts` does, lands on a file core holds, and one that
lands elsewhere, or nowhere, fails. The inside half: each specifier of a core
file, relative or bare, lands on a core file or outside the repository, and a
bare `@open-tomato/rafa/` specifier inside core fails even when it would land
inside. One import inside core lands outside it on purpose:
`core/command/version.ts` reads the root `package.json` until #808 bundles core
into the root, and the half fails once that read is gone, so the
exception cannot outlive it. The third check holds the two names' maps to the
same files: each `paths` entry of `tsconfig.packages.json` names one existing
target under `packages/rafa/src/`, and each `exports` key of
`packages/rafa/package.json` resolves through that map to the file its `exports`
target names.

**Core's tests that import above core wait in `src/tests/core-coupled/`.**
Each keeps its path under `src/` from before the move:
`core/config/config.test.ts` sits at
`src/tests/core-coupled/core/config/config.test.ts`, and it tests
`packages/rafa/src/core/config/config.ts`. A file's text changes only in its
specifiers, and `src/tests/core-coupled/README.md` lists what each reaches
above core. `CORE_PARKED_TESTS` of `scripts/survey/core-moves.ts` names the
folder: the barrels sweep reads these files as core's and does not hold their
imports to the barrel rule, and the test-index comparison holds each under its
path from before the move. A later spec sorts each file back into the package
once its coupling is gone, or into the module it really tests.

**The config sections are handed in, never imported.** Core declares the section
contract in `packages/rafa/src/core/config/section.ts`: a `ConfigSection`
carries its `package` name, its `settings`, its `defaults` and its cross-key
`checks`. Core names no section. The twelve are listed in
`src/config-registry.ts`, which sits outside `packages/rafa/src/core/`: core's
own (`core-section.ts`) and the eleven `src/config-schema-*.ts` files. Importing
that module registers the twelve with core once, and `src/rafa.ts` and
`src/index.ts` import it ahead of anything that loads a config. A file outside
`packages/rafa/src/core/` takes the merged `SETTINGS`, `CONFIG_DEFAULTS`,
`SETTING_NAMES`, `SETTING_BY_KEY`, `SECTIONS` and `knownKeysAbove` from the
registry, never from the core barrel, which exports none of them; core reads the
same through the `active*` functions of `section.ts`. A registration that breaks
a rule throws at import, naming what it refused: a setting name two sections
define, a file key a second section defines under another setting name, which
names both setting names too, or a `dangerous.*` key a second section defines
under the same setting name, each naming both packages.

**The adapters are handed in, never imported.** Core declares the adapter
registry in `packages/rafa/src/core/adapters/registry.ts`, and that file
imports no adapter: the adapters the registry lists sit above core, under
`src/adapters/` and `src/effort/sync/`, while the two store backends,
`store/sqlite` and `store/ndjson`, sit in the package under
`packages/rafa/src/effort/store/`. `src/adapter-registry.ts`, outside
`packages/rafa/src/core/`, lists them and hands them to `registerAdapters` as
it is imported. `src/rafa.ts` and `src/index.ts` import it right after
`src/config-registry.ts`, before anything resolves an adapter, so the two
composition roots are the two entries' imports. Until the root is imported,
every member of `CORE_ADAPTER_REGISTRY` refuses, naming it. A test that reads
core's adapters off the registry imports the root for its effect, as the
entries do.

**A section adds its keys to `RafaConfig` by `declare module`.** `RafaConfig`
stays declared in `packages/rafa/src/core/config/config-schema.ts` with core's
keys. Each section file adds its own by a `declare module` naming that file as
`@open-tomato/rafa/core/config/config-schema`, and not the config barrel, for
the reason the augment note in the deep-import sweep paragraph above gives. So
`ConfigSetting` names every key, and nothing in core names a section.

**`ConfigShape` is composed from the sections, not merged into.** Each section
file exports an interface of the keys a file writes for it (`HubShape` holds
`hub`, `ReleaseShape` holds `pr` and `release`), and its part of a namespace it
shares with core as an interface of its own: `LoopRetriesShape`,
`LoopContinueShape` and `WrapUpShape` for `loop`, `BoardProjectLimitsShape` for
`board.project`, `ReleaseDangerousShape` for `dangerous`. `src/config/shape.ts`,
outside `packages/rafa/src/core/`, holds core's keys and composes `ConfigShape`,
`LoopShape`, `BoardProjectShape` and `DangerousShape` from those interfaces by
`extends`, through `import type`. Each section's `declare module` on `shape.ts`,
the form this replaced, merged only in a program that loaded the section files:
the emitted `dist/config/shape.d.ts` imported none of them, so a consumer of the
`./config` subpath saw core's keys alone. Written out, the emitted `shape.d.ts`
imports every section's emitted declaration, and `src/config/shape.test.ts`
reads `ConfigShape['hub']['url']` as `string` from declarations emitted in
memory.

**The sweep holds core off the section files.**
`src/tests/core-config-sections.sweep.test.ts` reads every code file under
`packages/rafa/src/core/` and fails on any import of a `src/config-schema-*.ts`
file, by any specifier `textImports` finds, so a dynamic `import()` or a
`require()` counts as much as a static import. Like the barrel sweep, it does
not see an argument that is not a string literal. A second `describe` holds
`loadConfig` with no section registered to a refusal naming
`src/config-registry.ts`.

**A barrel is split, never widened, when it closes a runtime cycle.** A barrel
that groups a file with one outside `packages/rafa/src/core/` that imports the
barrel back by value closes a cycle. The cycle fails with a `ReferenceError` at
load, in one import order only, so a green `tsc` proves nothing about it. The
five barrels beyond the subject indexes are the splits made so far.
`config/sections.ts` holds the leaf pair `config-sections.ts` and
`config-readers.ts`, split while `config-merged.ts` imported section files that
import the pair back; that file is retired and nothing behind `config/index.ts`
imports a section file now, so the split stands as it was made. `config/load.ts`
stands alone, because `config-load.ts` reaches
`packages/rafa/src/effort/store/settings.ts`, which imports the config barrels
back. `loop/readings.ts` stands alone, because `session-readings.ts` reaches
`packages/rafa/src/effort/store/task-finishes.ts`, from which
`development-build.ts` imports `loop/index.ts` back. `loop/hops.ts` stands alone
over `hop-record.ts`, split while `src/next/hop-record.ts` imported it back by
value and the session record parser, which `sessions.ts` imports by value,
imported that file by value; the parser now sits beside `sessions.ts` as
`loop/session-record-parse.ts` and imports `hop-record.ts` by path, so the split
stands as it was made. `plan/block-reader.ts` stands alone, split while
`parse.ts` imported `src/utils/tracker.ts`, which imports `blocks.ts` back;
`parse.ts` now reads `plan/blocker-comment.ts` instead and no core file imports
the tracker, so the split stands as it was made.

### The cut table

**The cut table ranks where the package lines could fall.**
`docs/survey/cut-table.json` and `docs/survey/cut-table.md` list the ten
packages of epic #801, lowest first: `@open-tomato/rafa` (core),
`rafa-inventory`, `rafa-board`, `rafa-pr`, `rafa-run`, `rafa-release`,
`rafa-effort`, `rafa-hub`, `rafa-sync-service` and
`@open-tomato/rafa-cli`. For each it gives the folders and named files it
holds, and its count of upward edges: imports of kind `value` or `type`
between two non-test files, from a package lower in the order into a
higher one. `scripts/survey/cut-table.ts` writes both files from
`docs/survey/import-graph.json`, never from a fresh build of the graph, so
the table and the graph cannot disagree.

**Where a file goes is a rule, and a file no rule holds counts toward the
CLI.** A file a package names goes there, and a test follows the file it
tests. Otherwise the longest folder that holds the file decides, among the
package folders and the unassigned ones. A file no rule holds is left to
place and counts as a file of `@open-tomato/rafa-cli`, which takes every
file no line holds. An edge with an end in an unassigned folder
(`src/stretch/`, `src/commands/stretch/` or `src/ci/`) has no rank on that
end, so it is never upward. Inside `src/schema/` the placement is per file,
as the Packages section below lists.

**Core's rule is its package folder.** `CUT_RULES` gives core the folder
`packages/rafa/` and no named file, so every file under the package is core's,
and the folder's closing `/` keeps `packages/rafa-hub/` out of it.

**The counts rank options and do not certify a cut.** An upward edge from
`packages/rafa/src/core/config/` into a `src/config-schema-<section>.ts` file is
marked as cleared by #118, which makes each package own its config section. It
still counts as upward: the table's `remaining` column is the count less the
cleared edges. A count is only as current as the graph it was read from. `tsc
--build` with project references (#807) is the gate that certifies a cut.

### Packages under `packages/`

- **`packages/*` is a bun workspace** (`workspaces` in the root
  `package.json`) with five members, all `private`: `packages/rafa/`
  (`@open-tomato/rafa-core`, core, the name for good), `packages/rafa-hub/`
  (`@open-tomato/rafa-hub`), `packages/rafa-sync-service/`
  (`@open-tomato/rafa-sync-service`), and the two config packages,
  `packages/typescript-config/` (`@open-tomato/rafa-typescript-config`) and
  `packages/eslint-config/` (`@open-tomato/rafa-eslint-config`). Publishing
  them is an operator's decision, and the root `files` ships none of them.
  The root publishes `@open-tomato/rafa` with core bundled.
- **The config packages are the shared configs every member extends.**
  `packages/typescript-config/base.json` is the strict tsconfig base, reached
  as `@open-tomato/rafa-typescript-config/base`; the root declares it with
  `workspace:*` so the chain resolves from the root, as "Explicit types on
  exports" above sets out. `packages/eslint-config/base.mjs` is the flat ESLint
  config, with `sharedRules.mjs` and `rules/` beside it, reached as
  `@open-tomato/rafa-eslint-config`; a member's `eslint.config.mjs` imports it
  and adds only its own ignores. Neither package holds a `tsconfig.json` or a
  `check-types` script; each has its own `lint` and `test` scripts. Each
  manifest declares `openTomato.team` (`@open-tomato/maintainers`), which
  `scripts/codeowners.ts` reads to derive `.github/CODEOWNERS`. `bun run
  codeowners --check` refuses a file that differs from the manifests, but no
  check confirms that a team exists on GitHub.
- **The import name resolves through `paths`, not `node_modules`.**
  `tsconfig.packages.json` maps four entries, longest prefix first:
  `@open-tomato/rafa/store` and `@open-tomato/rafa/ports` to the two barrels,
  `@open-tomato/rafa/store/*` to `packages/rafa/src/effort/store/*` and
  `@open-tomato/rafa/*` to `packages/rafa/src/*`. The root `tsconfig.json` and
  each package's `tsconfig.json` extend it, and bun reads `paths` at runtime,
  so `bun test` resolves them from the root or from a package with no `dist/`.
  Nothing installs `@open-tomato/rafa` into `node_modules`: a member depending
  on that name with `workspace:*` fails `bun install` with
  `@open-tomato/rafa@workspace:* failed to resolve`, since the root is not a
  member of its own workspace. The members depend on
  `@open-tomato/rafa-core` instead.
- **A package imports core through the entries the import rule allows.** A
  file outside core takes the barrels, the store and ports entries and the
  named files by the subpaths of "Core and its barrels" above, and nothing
  deeper. Today `packages/rafa-hub` and `packages/rafa-sync-service` import
  only `@open-tomato/rafa/store` and `@open-tomato/rafa/ports`.
- **Every other route into core stays unresolved.** A deep path or an unmapped
  subpath fails with `Cannot find package '@open-tomato/rafa'` under bun and
  `TS2307` under tsc. `packages/rafa-hub/src/core-subpaths.test.ts` and
  `packages/rafa-sync-service/src/core-subpaths.test.ts` hold this, and hold
  the map's four entries as a closed list, so a new subpath goes into
  `tsconfig.packages.json`, into core's `exports` and into both lists. The
  third check of `src/tests/core-package.sweep.test.ts` holds the map and
  core's `exports` to the same files.
- **Which gates reach a package.** Each member's `test` script runs `bun test`
  from its folder, and ring 1's `turbo run test --affected` reaches it.
  `bun run check-types` runs `tsc --noEmit` over the root, whose `tsconfig.json`
  leaves out `packages/` and the test files, then `bun run --filter
  './packages/*' check-types`, which runs the `check-types` script of each
  member that has one: `tsc --build` in the three composite members. `bun run
  lint` lints package code from the root config like `src/`, its `testdata/`
  folders included, and so does the runner's lint step on a task's diff; the
  root `eslint.config.mjs` ignores `**/.tsbuild/**`, so the root `eslint .`
  never lints the declarations a `check-types` run left behind. Each member's
  own `eslint.config.mjs` is a leaf on `@open-tomato/rafa-eslint-config` that
  adds only `.tsbuild/**` and `node_modules/**` to the ignores, and its `lint`
  script, `eslint .` run from the package directory, lints that package alone.
  The import names resolve for `import/no-unresolved` because the resolver of
  `packages/eslint-config/base.mjs`, the shared config the root
  `eslint.config.mjs` imports, lists `./packages/*/tsconfig.json` beside the
  root `tsconfig.json`; without that entry, `bunx eslint packages` reported 21
  `import/no-unresolved` errors (measured on ESLint 9.39.5). Two globs make
  several projects, so the resolver also sets `noWarnOnMultipleProjects`, or
  every run prints `Multiple projects found` to stderr.
- **The composite recipe builds the three code packages' declarations.** The
  `tsconfig.json` of `packages/rafa`, `packages/rafa-hub` and
  `packages/rafa-sync-service` keeps the `extends` of `tsconfig.packages.json`
  and sets `composite: true`, `noEmit: false`, `emitDeclarationOnly: true`,
  `rootDir: "src"`, `outDir: ".tsbuild"` and `tsBuildInfoFile:
  ".tsbuild/tsconfig.tsbuildinfo"`, the last so two packages never share one
  (TS6377). It leaves its test files out, and its `references` name what it
  imports: core none, the two services `../rafa`. `tsc --build` builds a
  reference first, reads core through `paths` from that reference's
  declarations, and is a no-op on a second run. `.tsbuild/` is gitignored at
  every depth. Each code package's `turbo.json` extends the root's
  (`"extends": ["//"]`) and declares `check-types.outputs` as `.tsbuild/**`, so
  a cache hit restores the declarations a dependent's build reads. The two
  config packages emit nothing and carry no override. A service with its
  reference to core dropped fails with `TS6307` and `TS6059` on core's files,
  and still writes their `.d.ts` files beside core's sources, so a run that
  fails that way leaves stray files under `packages/rafa/src/` to remove; list
  them with `git ls-files --others --exclude-standard`.
- **The solution file builds the members in dependency order.** The root
  `tsconfig.references.json` holds `"files": []` and one reference per
  composite member, so `tsc --build tsconfig.references.json` builds all three
  and refuses a reference cycle with `TS6202`, exit 4. Ring 1 runs it. The root
  umbrella `tsconfig.json` keeps `tsc --noEmit` and no `references`, so ring 0
  reads core's source through `paths` as before.
- **The graph check refuses four things, and three more of a publishable
  member.** `scripts/workspace/graph-check.ts` reads each member under
  `packages/*` and refuses it on four counts, one line per reason: it has no script for a task in the root `turbo.json` (`lint`,
  `check-types` and `test` today), with `check-types` asked only of a member
  that holds a `tsconfig.json`; its `tsconfig.json` is not `composite`, or the
  solution file does not reference it; its `tsconfig.json` `references` omit a
  workspace dependency whose own `tsconfig.json` is composite; or a `.ts`,
  `.mjs` or `.js` file under it imports an `@open-tomato/*` package that its
  `dependencies`, `devDependencies` or `peerDependencies` do not declare, a
  `paths` alias counting as the member it resolves into. A member with no
  `private: true`, which publishes, is refused on three more counts, kept in
  `scripts/workspace/publish-rules.ts`: its `dependencies`,
  `peerDependencies` or `optionalDependencies` name a private member; a file
  imports `@open-tomato/rafa` or a subpath of it while `peerDependencies` does
  not name `@open-tomato/rafa`; or a file imports a subpath the root
  manifest's `exports` lack, or a private member by name. For such a member
  `@open-tomato/rafa/<subpath>` names the root package, not the member the
  `paths` alias resolves it into, so the fourth refusal leaves it to these.
  It exits 0 with one `ok` line per member and exits 1 with a line per
  reason; a root it cannot read is a refusal too. Ring 1 runs it, and
  `src/tests/workspace-graph.sweep.test.ts` runs it over the live tree in every
  task's gates. Each refusal has a planted-tree control in
  `scripts/workspace/graph-check.test.ts`.
- **Bun links each member in isolation, so a member declares what its files
  import.** A member's own `node_modules/` holds only what its manifest
  declares, so a bare import resolves from its manifest and not from the
  root's. Each member but the eslint-config package declares
  `@open-tomato/rafa-eslint-config` (`workspace:*`), `eslint` and `typescript`
  in its `devDependencies`, the last two at the root's ranges, so one install
  serves its scripts; the two services also declare `@open-tomato/rafa-core`
  (`workspace:*`). The graph check's fourth refusal holds the `@open-tomato/*`
  imports to those declarations and reads no `eslint` or `typescript` import,
  which the scripts name. The eslint-config package lists `eslint` in its
  `dependencies`, declares `typescript` as a `devDependency`, and imports
  itself by name through its own `exports`. After a manifest edit, `bun
  install` refreshes `bun.lock` and the links.
- **The build reads core from its source and names it through two shims.** The
  root `build` script bun-builds `src/effort/store/index.ts` and
  `src/ports/index.ts`, two of its entries, which are one-line `export *`
  shims of `@open-tomato/rafa/store` and `@open-tomato/rafa/ports`, so the
  `dist/` files the root `exports` name exist until #808 bundles core into
  the root. Its declarations come in two passes:
  `packages/rafa/tsconfig.types.json` writes core's declarations for the
  root's `./config` subpath into the root `dist/`, and
  `tsconfig.config-types.json` then writes the `./config` declarations after
  them. The root `exports` also keeps six `types`-only entries for core's
  files (`./core/config`, `./core/config/config-schema`,
  `./core/config/sections`, `./ports/log-level`, `./report/parse` and
  `./store/check-rows`), which #808 retires.
- **A content schema is imported through its owner's `schemas` export.** A
  content schema is a frontmatter or record schema describing a file rafa
  reads (a skill, an agent, an instinct), not config and not a step. Across a
  package line it comes through the owning package's `schemas` export, a fifth
  export beside the four the package contract lists (commands, steps with
  guards, config section, flows through `run(ctx, options)`), never through a
  deep path. Core's schemas would be exported from `@open-tomato/rafa/ports`
  as `schemas`, so core's subpath list would stay closed; no such export
  exists yet, and no schema has moved: this is the placement the cut takes.
- **Each schema under `src/schema/` lands in one package**, the one
  `docs/survey/content-schema-importers.md` names for it:
  - `tiers.ts` and `project-id.ts`, already under `packages/rafa/src/schema/`:
    `@open-tomato/rafa` (core)
  - `frontmatter.ts`: `rafa-effort`
  - `instinct.ts`, `skill.ts`, `stack.ts`, `provenance.ts`,
    `failure-strings.ts`, `scope-records.ts`: `rafa-inventory`
  - `agent.ts`: `@open-tomato/rafa-cli`
- **One upward edge survives the placement.** `src/effort/report-skills.ts`
  (rafa-effort) reads `readScopes` from `src/schema/scope-records.ts`,
  which lands in rafa-inventory. No placement clears it, because
  `scope-records.ts` imports inventory's `instinct.ts` and
  `check/layout.ts`. The survey page records it under its upward edges.

### References

- **`src/refs/` extracts, verifies, stamps and composes references**
  in spec and bug report bodies. Each reference (an issue, a symbol, a
  path, a command) is extracted by pattern, verified against its
  target, and fingerprinted. The fingerprint at the time the spec was
  read is the reference's STAMP; it is kept in the saved copy under
  `specs.dir` as an HTML comment, never on the forge. Five states:
  `ok`; `new` (a target but an issue that has not existed since its
  first reading, stamped `new`); `dangling` (the target does not
  exist); `suspect` (the target's fingerprint differs from its
  stamp); `resolved` (a `Blocked by:` target closed since the
  stamp). A sixth, `unknown`, is a cross-repository target the
  provider cannot read; it is listed and never refuses. Nothing spawns a process: `gh`, `git` and
  `ts-symbols` arrive through seams (`GhRunner` from
  `src/adapters/tracker/github.ts`, `GitRunner`, a symbol lookup),
  so unit cases drive fakes and planted repositories under `tmpdir`
  only. Sha256 uses `node:crypto` or `Bun.CryptoHasher`.
  `check-command.ts` spells `rafa issue check <n>`, the fix a report
  points a drifted copy at, and imports nothing, so a board module and
  a command module both take it from there.

### The size cap no gate reads

**The 800-line cap is a convention only.** The root `eslint.config.mjs`
and the `base.mjs` and `sharedRules.mjs` of `packages/eslint-config` carry
no `max-lines` rule, so nothing refuses an oversized module and a file
crosses the cap without any capture going red. Count the file with `wc -l` when a task adds to one
already near the cap; a module that has to grow puts the new concern in
a new file, and a note that has outgrown its module can move to the
`context/` page that owns the subject. Some modules including
`src/schema/instinct.ts` exceed the cap; the cap is a convention about
the target size, not an upper bound the gates enforce.

**The cap is a rule about modules, not about their tests.** Multiple
colocated `*.test.ts` files exceed the cap by design; splitting a test
file costs the shared helpers a home, which is why larger suites like
`src/commands/doctor.test.ts` and `src/commands/init.test.ts` stay
whole rather than split. The gate reads nothing and no capture goes red,
so a suite that grows past 800 lines is the tree's own convention and not
a thing to split.

### Adding a setting

**A new key in `SETTINGS` reaches the files below beyond the schema, sections
and `init` scaffold.** `packages/rafa/src/core/config/config.ts` is not one: it
builds a layer by a loop over the names registered with
`packages/rafa/src/core/config/section.ts`, so it names no setting.
`src/config-registry.test.ts` pins the key set as closed lists (`KEYS`, `TOP`,
`SECTIONS`, `knownKeysAbove`), and a core key is also spelled in
`packages/rafa/src/core/config/core-section.test.ts` and takes its place in one
of the runs of core's names that `src/config-registry.ts` spells. Both config
suites also check that every setting appears exactly once:
`src/tests/core-coupled/core/config/config.test.ts` (`SETTINGS`, `DEFAULTS`,
`FULL`, `FULL_VALUES`, its cases and `KNOWN`) and
`src/tests/config-layers.test.ts` (the PROJECT and USER text and values, and
`SECTION_CASES`). `check-types` never reads the two suites, so only `bun run
test` shows what is missing. A section appended after the last one in the
scaffold has to bound any scaffold case that slices from an earlier header to
the end of the template. This section replaces nothing.

### Shapes the lint config forces

- **`@typescript-eslint/no-unused-vars` has no ignore pattern and no
  `ignoreRestSiblings`**, so a `{ mode: _mode, ...rest }` discard is an
  error. Drop keys with an `Object.entries` loop.
- **`eslint --fix` spreads a nested ternary over one line per branch**
  (`@stylistic/multiline-ternary`). Sort with `a.localeCompare(b)` rather
  than an `a < b ? -1 : a > b ? 1 : 0` comparator.
- **`NodeJS.*` types fail `no-undef` outside test files**: the config
  declares no `NodeJS` global. Type an environment as
  `Record<string, string>` rather than `NodeJS.ProcessEnv`. This bullet
  replaces nothing.
- **An apostrophe in a test title is written backslash-escaped inside
  single quotes**, as `describe('the hint\'s own timeout', ...)`.
  Reaching for double quotes is refused by `@stylistic/quotes`
  (`Strings must use singlequote`), and `eslint --fix` puts the escape
  back, so the escape is the convention rather than a thing to route
  around: 46 titles across `src/` carry one. This bullet read `so write
  test titles without one` until 2026-09-22, which those 46 falsify.
- **An interface whose one `extends` is its whole content is refused**
  (`@typescript-eslint/no-empty-object-type`) everywhere but
  `src/config-schema-*.ts`, where `eslint.config.mjs` allows it: a
  section's `interface RafaConfig extends HubSettings {}` inside its
  `declare module` is that shape on purpose. This bullet replaces
  nothing.
- **Markdown is a lint target, and every fenced block needs a language**
  (`markdown/fenced-code-language`). A fence shown INSIDE a fenced example
  — a `context/` page quoting the comment a command writes, say — is read
  as a real fence by the rule, so escape the inner backticks (`\`\`\``)
  rather than nesting them bare.

### Runtime import cycles

**The sweep `src/tests/import-cycle.sweep.test.ts` fails on any non-test
runtime import cycle that spans two clusters.** It reads the import graph
the way `scripts/survey/import-graph.ts` does: `readMetafile` and
`buildImportGraph` from there, and the file set from
`scripts/survey/files.ts`. Type-only imports are erased in the graph, so
a type-level cycle passes; `tsc --build tsconfig.references.json`, over
the composite packages' project references, is the gate for those.

**Files are mapped to clusters via `docs/survey/cluster-map.json`,** the
file-to-cluster assignment from the eight-cluster import graph survey run. A
file with no mapping takes the cluster most of its folder's mapped files hold.
If a file's folder holds no mapped file, the file stays unplaced and the sweep
does not fail on it: a cycle through it is still found, and the file counts
toward no cluster. The sweep prints the file coverage line, a count of files
placed by folder majority, and a count of the unplaced ones; a new survey run
that extends the map places them. The move of #905 renamed the map's keys to the
`src/core/` paths, and the move into the package renamed them to
`packages/rafa/src/core/` and kept each keyed file's cluster. Two moved files
were never keyed, `plan-files.ts` and `session-readings.ts`, so the sweep places
them by their folder.

**The map traces the 68-file cycle that crossed package lines before
rafa-903.** That cycle spanned five clusters (c1: board, pr, triage; c6:
plan gate and `rafa next`; c2: CLI and commands; c3: task run; c4:
inventory), held by one dynamic import (`import('../index.js')` in
`src/commands/plan/refs-check.ts` for `coreRoster`) and three small
symbols: `firstNowEpic` (board/place.ts importing from commands/epic/show.ts),
`issueCheckCommand` (board/roadmap-rows.ts from commands/doctor-refs.ts),
and `BOARD_REFUSAL_EXIT` (board/refs-gate.ts from board/plan-spec.ts
in c6). The fix moves those three symbols first to new homes in c1, then
replaces the dynamic import's roster with a parameter; order matters,
because a seam landing before the three moves leaves the 13-file c1/c6
cycle in place. The sweep still reads clusters. The cut table names each
file's package, but this sweep does not read it: its own note names the
table as the input it is meant to take later. Until then, a cycle that
crosses two packages but sits in one cluster passes it.

**A cycle through a barrel can stay inside one cluster, and the adapters
barrel's was retired by the registry seam.** Until then
`packages/rafa/src/core/adapters/index.ts` was one: `registry.ts` imported
`src/effort/sync/select.ts` by value, and `select.ts` imported the registry
back through the barrel. Both sat in cluster c7, so the sweep passed them,
and a barrel over one file could not be split to step round the cycle. The
composition root `src/adapter-registry.ts` now lists `sync/local` from
`select.ts`, so `registry.ts` imports nothing above core and the cycle is
gone. A barrel's cycles are still counted by `stronglyConnected` in
`scripts/survey/graph-algorithms.ts`, a full read whatever the cluster.
Its load order is still checked by
`src/tests/core-barrel-load-spawned.test.ts`, which loads each barrel first
in a fresh `bun` process and expects exit 0.

### The library boundary

**Commands and their supporting code go into `src/commands/`, library code the
rest of the codebase reads goes into the subject folders at `src/`.** A non-test
file outside `src/commands/` holds no import whose target is inside it — not
static `import`, not `import type`, not `export … from`, and not dynamic
`import()`. This rule forces every feature that more than one command might want
into the library half first, before a second command is even written. Library
code every part of rafa reads goes into `packages/rafa/src/core/`, behind its
barrels (Core and its barrels, above).

**Two files are exempt by name:** `src/rafa.ts` (the bin entry, which
loads the command registry and dispatches on `process.argv`) and
`src/plan.ts` (the body of the `rafa plan create` command). Both are the
CLI's own layer, not library code. A sweep (`src/tests/commands-direction.sweep.test.ts`)
names every non-test import edge and fails when a library file brings in
the command half.

**Edge case: a reader so widely used that it lives in the commands folder.**
`src/commands/plan/plan-files.ts` is the command half of the plan readers: the
first command that needed them (`rafa plan create`) wrote them there, and ten
non-test files import it at this commit. Its library half, the readings that
take no command context, is `packages/rafa/src/core/plan/plan-files.ts`, which
command modules reach through the plan barrel. When a second command wants a
reader, the reader moves to the library half and the command file imports it
from there. The sweep reads the move with the list: a command file that exports
its own library half is a failure until the re-export is gone. Symbols imported
from inside `src/commands/` by test files are never swept; `classifyFile` of
`scripts/survey/files.ts` decides what a test is.

**Symbols take their subject folder from the import graph survey.** The
eight-cluster map in `docs/survey/cluster-map.json` decides the folder;
`docs/survey/cut-table.md` names each file's package, which confirms the
place before a task moves a symbol. A file with no mapping takes the
cluster most of its folder's mapped files hold; if a file's folder holds
no mapped file, the task extends the map with a new survey run.
