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
  `Expected no arguments` is beside `packages/rafa/src/commands/plan/plan-files.ts`'s
  shared `expectNoArgument`, which says `Expected no argument`.
  `src/commands/release/workflows.ts` takes `readLadderFiles` from
  `src/commands/doctor-ladder.ts`, the ladder's readings the doctor row
  takes too, and `LADDER_WORKFLOWS` from `src/release/ladder.ts` and
  `readReleaseTemplate` and `writeReleaseWorkflow` from
  `src/release/templates.ts`, so the command and the doctor row read one
  set of files.
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

### Declarations, feature indexes and the roots

- **A `declarations.ts` imports types and `@open-tomato/rafa/core/*`
  values alone.** A value import of a module under `src/` loads it with
  the roster and undoes the laziness the declaration exists for. A
  feature's test reads the file's imports off the source (its
  `declarations.test.ts`, or `index.test.ts` for `board`, which has none)
  and holds that; a constant a declaration and its command both read lives
  in the declaration file, and a copy of a value from outside `src/commands/`
  is held equal to its source by the same test.
- **A feature's `index.ts` reaches a command module only through
  `lazyCommand`'s dynamic import.** Each command is one
  `lazyCommand(DECLARATION, () => import('./x.js'), FEATURE)` line, so
  importing the index loads the declarations and the core command barrel
  and no command module. `index.test.ts` reads each call off the source
  and holds its loader to its declaration's module.
- **No module under `src/` registers an adapter or a config section on
  import.** `src/config-registry.ts` and `src/adapter-registry.ts` register
  nothing as they load, and neither do the declarations, the feature
  indexes or the command modules. The registration calls sit at the top
  level of two roots only: `src/index.ts`, the `@open-tomato/rafa` entry,
  and `src/rafa.ts`, the CLI's. Each calls `registerCoreConfigSections`,
  then `registerCoreAdapters`, once its imports have loaded.
  `src/tests/preload.ts` makes the same two calls, and `bunfig.toml`'s
  `[test] preload` runs it before the first test file. Other callers, such
  as `src/cli/feature-load-probe.ts`, call them inside a function they run,
  never on import. A child process a test spawns runs no preload, so its
  script calls a root itself before it reads either registry.

### Explicit types on exports

**`base.json` of `packages/typescript-config` sets `isolatedDeclarations`
and `erasableSyntaxOnly`**. Every tsconfig reaches it by one chain: the
root `tsconfig.json` and each composite member's `tsconfig.json` extend
`tsconfig.packages.json`, which extends
`@open-tomato/rafa-typescript-config/base`, the name the root's
`workspace:*` line links into `node_modules`. So the root config and the
four composite members are held to both flags by `bun run check-types`, with
no flag on the command line. The package's `base.test.ts` holds both flags and
`declaration`. `declaration` sits beside them because `tsc` refuses
`isolatedDeclarations` without it; under the base's `noEmit` it writes no
file. The root `tsconfig.json` excludes `**/*.test.ts`,
so `check-types` does not hold a test file under `src/` or `scripts/`. The
runner's type step does, for the test files a task adds or edits: its scratch
config extends `tsconfig.json` and takes the flags with it. The
`tsconfig.json` of each of the four composite members leaves its test files out
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
run through them. Twenty-nine files changed path into it, nineteen by #905 and
ten more by #1088 and #1089, `runtime/identity.ts` among them. They sit in
eight subject folders. `config/` holds the value readers, core's keys of the
schema, the section contract, core's own section and the loader; `command/`
the command contract (`RafaCommand`, `RafaContext`, `CommandExit`), the
version and the confirm prompt; `output/` the active output; `adapters/` the
adapter registry; `git/` the git runner and the commit helpers; `plan/` the
block reader, the plan parser and the plan-file readers; `loop/` the loop's
session helpers, its session readings and the Claude spawner; `runtime/` the
reading of which build is running. A file keeps its base name when it moves. A
moved file keeps no re-export at its old path. The root's build entries are
the exception: `src/effort/store/index.ts` and `src/ports/index.ts` stand at
core's folder paths and re-export a package subpath until #808 publishes core.

Two edge cases show why a file is core. `src/pr/git.ts` sat under the
pull-request code, but release code imports the git runner too, so it moved to
`packages/rafa/src/core/git/`. `packages/rafa/src/report/parse.ts` reads like
the run's report code, but the effort store reads it, so it is core. Core is
also `packages/rafa/src/ports/`, the effort store under
`packages/rafa/src/effort/store/`, `packages/rafa/src/report/record.ts` and
the cause codes of `packages/rafa/src/errors/codes.ts` and
`packages/rafa/src/errors/rafa-codes.ts`: core by assignment, kept where they
are. Pass 1 of #808 moved in the 36 root files that reach no feature
(`scripts/codemod/moves/pass-1.ts`), each at its old path under
`packages/rafa/src/`: the logger's six files and the events output
(`adapters/logger/`, `adapters/output/events.ts`); the bug record and title
(`bugs/record.ts`, `bugs/title.ts`) with the four bug helpers beside them; the
plan-file readers (`commands/plan/plan-files.ts`); the four `config-schema-*.ts`
section files (bugs, errors, features and logger); the module loader and its
activation and manifest (`modules/`); the hop record (`next/hop-record.ts`);
the doc task and the plan injection (`plan/doc-task.ts`, `plan/inject.ts`); the
risk patterns and secrets (`plan/risk/patterns.ts`, `plan/risk/secrets.ts`);
the project readers (`project/`); the live-loops reading
(`runtime/live-loops.ts`); and the git, progress and tracker utilities
(`utils/`). They sit outside `core/`, so no barrel rule holds them: a file
outside the package imports each by its own subpath, which core's `exports`
names by a key or a folder wildcard. The move tool,
`scripts/codemod/pass-moves.ts`, leaves a colocated test the project's
`tests.integration` globs match at the root, with its imports rewritten to
subpaths, and lists it in its output, until #913 places integration tests;
`src/modules/activate-integration.test.ts` is the one pass 1 moved and #1289
moved back.

Since the move, `CORE_FOLDERS` of `scripts/survey/core-moves.ts` is
`[CORE_SOURCE]`, the package's source folder, and `CORE_NAMED_FILES` is empty,
so every file under the package is core's and a file that moves in needs no
entry. `isCoreFile` reads both: the one place a sweep, a survey script or a
spawned loader takes core's location from.

**Nine more files moved into core at commit 94769d8, with their colocated tests
but one.** They are `packages/rafa/src/board/naming.ts`,
`packages/rafa/src/triage/doc-only.ts`,
`packages/rafa/src/triage/local-paths.ts`,
`packages/rafa/src/start/worktree-dir.ts`,
`packages/rafa/src/release/fragment.ts`,
`packages/rafa/src/schema/frontmatter.ts`,
`packages/rafa/src/utils/agent-definition.ts`,
`packages/rafa/src/effort/session-log.ts` and
`packages/rafa/src/effort/session-log-dirs.ts`, each at its path under
`packages/rafa/src/`. `scripts/codemod/moves/decouple-1.ts` lists them and
`scripts/codemod/pass-moves.ts` moved them. Eight of them have a subpath of
their own, `@open-tomato/rafa/board/naming`, `triage/doc-only`,
`triage/local-paths`, `start/worktree-dir`, `release/fragment`,
`schema/frontmatter`, `effort/session-log` and `effort/session-log-dirs`, each
an `exports` key of `packages/rafa/package.json` to its `./src/` file;
`agent-definition.ts` is held by the `./utils/*` wildcard. The
`tsconfig.packages.json` wildcard for `@open-tomato/rafa/*` did not change. The
ninth test, `worktree-dir.test.ts`, was parked under
`src/tests/core-coupled/start/` before the move and stays there. The flag
`SESSION_ID_FLAG` (`'--session-id'`) moved at commit d9b339b from
`src/start/dispatch.ts` into `packages/rafa/src/core/loop/claude.ts`, beside
`SETTING_SOURCES_FLAG`, and the loop barrel exports it with no re-export at the
old path. `packages/rafa-inventory/src/start/serving.ts` is an inventory file by
name, though it sat under `src/start/` before the move: it imports only
`packages/rafa-inventory/src/tiers/` and
`packages/rafa-inventory/src/inventory/trees.ts`, so `INVENTORY_NAMED` of
`scripts/survey/cut-names.ts` named it (commit 24fdaf6), and the move of pass 4a
placed it in the package at that path.

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
`store/<file>` and a ports file `ports/<file>`. A file moved outside `core/`
takes the same spelling: `packages/rafa/src/bugs/record.ts` is `bugs/record`,
which the package's `exports` names with `./bugs/*`, so a file outside the
package imports it as `@open-tomato/rafa/bugs/record`.

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
`@open-tomato/rafa/<anything>`, and the barrels sweep reads the whole package as
core's own, so no barrel rule holds the effort store, the ports or a moved file
outside `core/`. They reach core's barrels by relative path, as
`effort/store/move.ts` and `utils/tracker.ts` do. A scan of the non-test files
at this commit found every such import names one of the thirteen barrels and no
deeper file. A grep at this commit found no barrel imported from inside core,
but no sweep measures that half.

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
no import: a `declare module` naming the declaring file, which each section
file writes to add its fields to `RafaConfig`, is answered under `augment` and
passes. Every section file in the package
(`packages/rafa/src/config-schema-*.ts`) names it by its relative path,
`./core/config/config-schema.js`. It has to name the declaring file: spelled
through the config barrel, two augmentations merged with each other and not
with `RafaConfig`, whose `keyof` missed both. That file is one of core's
`exports` entries until #808 retires them.

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

**The public-entries sweep holds every member to its `exports`.**
`src/tests/public-entries.sweep.test.ts` reads the members through
`readMembers` of `scripts/survey/package-entries.ts`, never a list in code.
Each bare `@open-tomato/` specifier in a code file outside a member that lands
on a file of that member names one of its `exports` keys (`isPublicEntry`) and
lands on the file the key's target names; a member with no `exports`, the hub
and the sync service, is named by no bare specifier. A specifier that lands
outside the checkout or nowhere is matched to a member by its package name, as
a worktree resolves a workspace link through the main checkout's
`node_modules`. The tests under `src/tests/core-coupled/` are read as core's
own files, as `isCoreRead` reads them, so their deep subpaths into core are
set aside and counted. It prints its counts at load, and a planted tree holds
a control for each failure.

**Core's tests that import above core wait in `src/tests/core-coupled/`.**
Each keeps its path under `src/` from before the move:
`core/config/config.test.ts` sits at
`src/tests/core-coupled/core/config/config.test.ts`, and it tests
`packages/rafa/src/core/config/config.ts`. A file's text changes only in its
specifiers, and `src/tests/core-coupled/README.md` has one row per parked file
naming what it reaches above core. A feature package's parked tests wait in
`src/tests/<name>-coupled/` the same way, inventory's seven first, under
`src/tests/inventory-coupled/`, and effort's twelve after them, under
`src/tests/effort-coupled/`. A file that joins the folder takes its row in the
same commit. The ten section tests are the named exception: each parks under
`src/tests/core-coupled/` as `config-schema-<section>.test.ts`, not beside its
file under `packages/rafa/src/`, because it reads `src/config-registry.ts`, the
root's merged registry, which stays at the root. They leave the folder when #913
places integration tests. `CORE_PARKED_TESTS` of `scripts/survey/core-moves.ts`
names the folder: the barrels sweep reads these files as core's and does not
hold their imports to the barrel rule. The test-index guard reads them as any
test: under its own path, in the unit the cut table lists it in, and held to the
rule of its kind. A later spec sorts each file back into the package once its
coupling is gone, or into the module it really tests.

**The config sections are handed in, never imported.** Core declares the
section contract in `packages/rafa/src/core/config/section.ts`: a
`ConfigSection` carries its `package` name, its `settings`, its `defaults` and
its cross-key `checks`. Core names no section. The fifteen are listed in
`src/config-registry.ts`, which sits outside `packages/rafa/src/core/`: core's
own (`core-section.ts`) and fourteen `config-schema-*.ts` files, all under
`packages/rafa/src/` since rafa-1325 moved the ten feature sections in from
`src/`: four for `bugs`, `errors`, `features` and `logger`, and ten for the
registered feature sections. That module registers nothing as it is imported:
its `registerCoreConfigSections()` registers the fifteen with core and sets
core's load hook, and `src/rafa.ts`, `src/index.ts` and `src/tests/preload.ts`
call it ahead of `registerCoreAdapters()`, before anything loads a config. A
second call registers nothing. A file outside `packages/rafa/src/core/` takes
the merged `SETTINGS`, `CONFIG_DEFAULTS`, `SETTING_NAMES`, `SETTING_BY_KEY`,
`SECTIONS` and `knownKeysAbove` from the registry, never from the core barrel,
which exports none of them; core reads the same through the `active*`
functions of `section.ts`. The two registered readers are
`registeredDefaults()` and `registeredSettings()` of `section.ts`, which the
core barrel re-exports: a feature file that needs the whole default record or
the whole spec record takes it from there, typed as `CONFIG_DEFAULTS` and
`SETTINGS` are, and so imports no root file. The callers at this commit are
`src/start/preflight.ts`, `src/start/pr-lifecycle.ts`, `src/board/roadmap.ts`,
`packages/rafa-effort/src/effort/collect.ts` and
`packages/rafa-inventory/src/inventory/index.ts` for the defaults, and
`src/refs/extract.ts` and `src/refs/verify.ts` for the settings. Each refuses
with a `ConfigSectionError` naming `src/config-registry.ts` while no section is
registered, so a constant built as a module loads, before an entry registers,
reads the section file that defines its value instead. A registration that
breaks a rule throws from the call, naming what it refused: a setting name two
sections define, a file key a second section defines under another setting name,
which names both setting names too, or a `dangerous.*` key a second section
defines under the same setting name, each naming both packages.

**The adapters are handed in, never imported.** Core declares the adapter
registry in `packages/rafa/src/core/adapters/registry.ts`, and that file
imports no adapter. The adapters the registry lists are split by place. Four
sit in the package: the console logger and the events output
(`adapters/logger/console`, `adapters/output/events`), and the two store
backends, `store/sqlite` and `store/ndjson`, under
`packages/rafa/src/effort/store/`. The text output is core's own, under
`core/output/`. The rest sit above core. Under `src/adapters/` are the json
output, the local and GitHub trackers and the claude planner. The local learning
adapter sits under `packages/rafa-inventory/src/adapters/learning/`, and the
file and local sync strategies under `packages/rafa-effort/src/effort/sync/`.
`src/adapter-registry.ts`, outside
`packages/rafa/src/core/`, lists them as `CORE_ADAPTERS` and registers nothing
as it is imported: its `registerCoreAdapters()` hands them to
`registerAdapters` and answers the registry that call made. `src/rafa.ts` and
`src/index.ts` call it before anything resolves an adapter, so the entries
hold under a manifest declaring `"sideEffects": false`, which the root manifest
does not declare today because bun 1.3.14's split build breaks under it
(#1213). A second call registers nothing. Until something calls
it, every member of `CORE_ADAPTER_REGISTRY` refuses, naming the root.
`bun test` calls it once per test process from `src/tests/preload.ts`, which
`bunfig.toml` names under `[test] preload`, so a test reads core's adapters
registered; a child process a test spawns runs no preload and calls the root
itself.

**A section adds its keys to `RafaConfig` by `declare module`.** `RafaConfig`
stays declared in `packages/rafa/src/core/config/config-schema.ts` with core's
keys. Each section file, all of them under `packages/rafa/src/` since
rafa-1325, adds its own by a `declare module` naming that file by its relative
path, `./core/config/config-schema.js`, and not the config barrel, for the
reason the augment note in the deep-import sweep paragraph above gives: no
non-test file in the package imports `@open-tomato/rafa/<anything>`. So
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
`packages/rafa/src/core/` and fails on any import of a `config-schema-*.ts`
section file in the package, by any specifier `textImports` finds, so a
dynamic `import()` or a `require()` counts as much as a static import. Like
the barrel sweep, it does not see an argument that is not a string literal. A
second `describe` holds `loadConfig` with no section registered to a refusal
naming `src/config-registry.ts`.

**A barrel is split, never widened, when it closes a runtime cycle.** A barrel
that groups a file with one outside `packages/rafa/src/core/` that imports the
barrel back by value closes a cycle. The cycle fails with a `ReferenceError` at
load, in one import order only, so a green `tsc` proves nothing about it. The
five barrels beyond the subject indexes are the splits made so far.
`config/sections.ts` holds the leaf pair `config-sections.ts` and
`config-readers.ts`, with `branch-template.ts` and `merge-method.ts` as leaves
beside them, split while `config-merged.ts` imported section files that
import the pair back; that file is retired and nothing behind `config/index.ts`
imports a section file now, so the split stands as it was made. `config/load.ts`
stands alone, because `config-load.ts` reaches
`packages/rafa/src/effort/store/settings.ts`, which imports the config barrels
back. `loop/readings.ts` stands alone, because `session-readings.ts` reaches
`packages/rafa/src/effort/store/task-finishes.ts`, from which
`development-build.ts` imports `loop/index.ts` back. `loop/hops.ts` stands alone
over `hop-record.ts`, split while `packages/rafa/src/next/hop-record.ts` imported it back by
value and the session record parser, which `sessions.ts` imports by value,
imported that file by value; the parser now sits beside `sessions.ts` as
`loop/session-record-parse.ts` and imports `hop-record.ts` by path, so the split
stands as it was made. `plan/block-reader.ts` stands alone, split while
`parse.ts` imported `packages/rafa/src/utils/tracker.ts`, which imports `blocks.ts` back;
`parse.ts` now reads `plan/blocker-comment.ts` instead and no core file imports
the tracker, so the split stands as it was made.

### The cut table

**The cut table ranks where the package lines could fall.**
`docs/survey/cut-table.json` and `docs/survey/cut-table.md` list the twelve
packages of epic #801, lowest first: `rafa-eslint-config`,
`rafa-typescript-config`, `@open-tomato/rafa-core` (core),
`rafa-inventory`, `rafa-board`, `rafa-pr`, `rafa-run`, `rafa-release`,
`rafa-effort`, `rafa-hub`, `rafa-sync-service` and `@open-tomato/rafa`
(the CLI, the root that publishes). The names are #808's: core keeps its
manifest's private name and there is no `@open-tomato/rafa-cli`. The two
shared-config packages sit lowest because nothing in the graph imports
them. For each it gives the folders and named files it
holds, and its count of upward edges: imports of kind `value` or `type`
between two non-test files, from a package lower in the order into a
higher one. `scripts/survey/cut-table.ts` writes both files from
`docs/survey/import-graph.json`, never from a fresh build of the graph, so
the table and the graph cannot disagree.

**Where a file goes is a rule, and a file no rule holds counts toward the
CLI.** A file a package names goes there, and a test follows the file it
tests. Otherwise the longest folder that holds the file decides, among the
package folders and the unassigned ones. A file no rule holds is left to
place and counts as a file of `@open-tomato/rafa`, which takes every
file no line holds. An edge with an end in an unassigned folder
(`src/stretch/`, `src/commands/stretch/` or `src/ci/`) has no rank on that
end, so it is never upward. Inside `src/schema/` the placement is per file,
as the Packages section below lists.

**The named lists are in `scripts/survey/cut-names.ts`.** `BOARD_NAMED`,
`PR_NAMED`, `RUN_NAMED`, `RELEASE_NAMED`, `EFFORT_NAMED` and `INVENTORY_NAMED`
hold the root files that reach each feature package, each sorted by UTF-16
code unit. A file a list names is placed in that package whatever its folder,
and keeps its path: no named file moves in the cut itself; the packages' moves
move them. `CUT_RULES` reads them and adds a package's own file beside its
list where one belongs: `src/pr/index.ts` to `PR_NAMED`. The run rule added
`packages/rafa/src/start/branch-decision.ts` beside `RUN_NAMED` until the
fourth decouple item (rafa-1333) moved it into core. `INVENTORY_NAMED` is empty
since pass 4a moved its six files into `packages/rafa-inventory/src/`, where
the package's folder rule places them. The CLI's named files are five,
`CLI_NAMED`: the roster, the bin entry and the agent schema, which were the
CLI rule's three inline names, and `src/inventory/browse.ts`, the view behind
`rafa skill list -i`, which sits under `src/inventory/` but is a CLI file by
name: the CLI's prompt files it uses, `src/cli/prompt/page.ts`, `select.ts`
and `terminal.ts`, are CLI-internal, so it counts no edge out of inventory and
does not move. The store entry, `src/effort/store/index.ts`, is the fifth, since
pass 4b: the published `./store` build entry, a CLI file by name as
`src/rafa.ts` is, and it stays at the root. The first decouple item (#808) took
`naming.ts` off `BOARD_NAMED` and `agent-definition.ts` off `EFFORT_NAMED` as
they moved into core, now `packages/rafa/src/board/naming.ts` and
`packages/rafa/src/utils/agent-definition.ts`, and `frontmatter.ts` left the
effort rule of `CUT_RULES` for `packages/rafa/src/schema/frontmatter.ts`. The
placement, in the same item, added `serving.ts` under `src/start/` to
`INVENTORY_NAMED`; the move of pass 4a then moved it into the package, to
`packages/rafa-inventory/src/start/serving.ts`, and the list has been empty
since. The third decouple item (rafa-1325) took the eleven section files off the
lists, each into `packages/rafa/src/` beside core's four, where the
`packages/rafa/` folder of `CUT_RULES` places it:
`config-schema-board-project.ts` and `config-schema-issues.ts` off
`BOARD_NAMED`, `config-schema-readings.ts` and `config-schema-triage.ts` off
`PR_NAMED`, `config-schema-checks.ts`, `config-schema-loop-continue.ts`,
`config-schema-loop-retries.ts`, `config-schema-tests.ts` and
`config-schema-wrap-up.ts` off `RUN_NAMED`, `config-schema-release.ts` off
`RELEASE_NAMED` and `config-schema-hub.ts` off `EFFORT_NAMED`, which holds none
now.

**The left-to-place test is an edge check.** A file no rule holds is left to
place, and it counts as the CLI's, the package that ranks highest. So an import
from a feature package onto such a file is an upward edge, and the cut table
counts the upward edges that end on each file it leaves to place. A cut passes
the test when no feature package imports one. `docs/survey/cut-table.md` lists
the files left to place under its "Files left to place" heading and marks each
upward target `left to place` or `by rule`.

**The coupling reading takes the same table.** `scripts/survey/coupling.ts`
counts the value imports between the six feature packages of its `MOVE_ORDER`,
the order they move in: `rafa-inventory`, `rafa-effort`, `rafa-board`,
`rafa-release`, `rafa-pr` and `rafa-run`, which is not the cut table's rank
order (inventory first by the decision of 23 October 2026). A back edge
runs from a package earlier in that order into a later one, since moved
first the earlier package would import a file not yet moved. An importer
pair is a file that is no test and imports a package of the order it is not
placed in, by a value or a type edge, counted once per package; a pair is
kept when the file imports that package by a relative path. Run as
`bun scripts/survey/coupling.ts --max=<percent>` from the root, it prints the
back edges by package pair and one line, `back <n> of <total> value imports
between feature packages, <percent>%`, then a second, `kept <k> of <n>
importers on relative paths, <percent>%`, and exits 1 when either percent is
above `--max`, so `--max` applies to both lines. The kept line reads over 20%
until pass 4 rewires the kept files. It reads the import graph, the cut table
and the tracked files of the kept pairs, and writes nothing; an edge with an
end in core, in the CLI or in a package outside the order is not counted on
the first line.

**Core's rule is its package folder.** `CUT_RULES` gives core the folder
`packages/rafa/` and no named file, so every file under the package is core's,
and the folder's closing `/` keeps `packages/rafa-hub/` out of it. The hub,
the sync service and the two shared-config packages
(`packages/eslint-config/`, `packages/typescript-config/`) follow the same
one-folder rule. A facade folder is its package's too: `packages/rafa-effort/`
is the `rafa-effort` row's one folder, since pass 4b dropped `src/effort/` from
the rule, and the table lists its `src/` files there but not its facade
`index.ts`, which the graph does not read.

**The counts rank options and do not certify a cut.** An upward edge from
`packages/rafa/src/core/config/` into a `config-schema-<section>.ts` file is
marked as cleared by #118, which makes each package own its config section. It
still counts as upward: the table's `remaining` column is the count less the
cleared edges. The rule reads none since the third decouple item (rafa-1325)
moved the eleven sections into `packages/rafa/src/`, beside core's four, so an
import from core's config folder into a section is no upward edge at all. The
rule stays in `scripts/survey/cut-table.ts` for a section that moves back into
a feature package that publishes on its own. A count is only as current as the
graph it was read from. `tsc --build` with project references (#807) is the
gate that certifies a cut.

**The facade reader lists the names an outside file takes from a facade.**
`scripts/survey/facade-names.ts --package=rafa-<name>` reads the root
program's files that are not tests or test support and do not sit in the
package, the universe its names come from, and prints each name they import
from it, value or type, with its declaration. Four shapes it reports as
problems rather than names: an anonymous default export (`anonymous-default`),
a namespace import or `export *` (`namespace-import`), two declarations
under one name (`collision`), and a name taken through an entry that the
entry does not export (`unexported-name`). `--entry` prints the facade's
`index.ts` as it would be written, `--commands` its commands entry
`commands.ts`, and `--json` prints the whole reading. An import by the
facade's name or by its commands entry's, `@open-tomato/rafa-<name>/commands`,
is read through that entry's table (`facade-tables.ts`, which reads both):
each name counts as taken from the file the entry re-exports it from, so a
rewired importer reads as its relative form did and `--entry` prints the
tracked entry unchanged. Each name records the entry it is taken through: the
commands entry when every import of it goes through that entry, else the
index, which `--entry` writes. The import graph reads an import of
`@open-tomato/rafa-<name>` the same way: an edge of the import's kind, `type`
when the binding or the entry's row is one, from the importer to each file its
names come from, and the facade entry is no node.

### Packages under `packages/`

- **`packages/*` is a bun workspace** (`workspaces` in the root
  `package.json`) with eleven members, all `private`: the five that
  predate the facades, `packages/rafa/` (`@open-tomato/rafa-core`, core, the
  name for good), `packages/rafa-hub/` (`@open-tomato/rafa-hub`),
  `packages/rafa-sync-service/` (`@open-tomato/rafa-sync-service`) and the
  two config packages, `packages/typescript-config/`
  (`@open-tomato/rafa-typescript-config`) and `packages/eslint-config/`
  (`@open-tomato/rafa-eslint-config`); and the six feature packages that
  `docs/survey/facade-pile.md` lists as passing, `packages/rafa-effort/`,
  `packages/rafa-inventory/`, `packages/rafa-board/`,
  `packages/rafa-release/`, `packages/rafa-pr/` and `packages/rafa-run/`,
  each under its final name, as the next bullet sets out. Publishing one is
  the manifest rule below, and the root `files` ships none of them.
  The root publishes `@open-tomato/rafa` with core bundled.
- **A feature package's name is a facade until its move.** Pass 2 gives each of
  the six feature packages its final name as a facade: a private member at
  `packages/rafa-<name>/` whose `package.json` maps `exports` `"."` to
  `./index.ts`, has `lint` and `test` scripts and the eslint leaf's
  devDependencies, and until its move holds no `tsconfig.json`. The root
  declares it with `workspace:*`. Until its move, its `index.ts` re-exports
  today's files from their `src/` paths, with `.js` specifiers:
  `'../../src/effort/collect.js'`, never `'.ts'`, since a `.ts` ending fails
  `tsc` with TS5097. The entry exports exactly the names that non-test files
  outside the package import from it, value and type alike, as `export type { …
  }` and `export { … }` lines and nothing else. `scripts/survey/facade-names.ts
  --package=rafa-<name>` reads that set with the checker, and `--entry` prints
  the entry it is written from. Board, release, pr and run hold a second entry,
  `commands.ts`, mapped as `"./commands"` beside `"."` and imported as
  `@open-tomato/rafa-<name>/commands`: it re-exports the feature object
  (`BOARD_FEATURE`, `RELEASE_FEATURE`, `PR_FEATURE`, `RUN_FEATURE`) alone, which
  the facade's `index.ts` does not, since a feature's index holds the loaders of
  its lazy command modules and every library entry reaching the facade would
  reach them. The roster, `src/commands/index.ts`, is its one importer, which
  `src/tests/commands-entry.sweep.test.ts` holds, and `--commands` prints it.
  Each of the four facades' `index.test.ts` holds both entries, the index
  against its names and the commands entry against the names taken through it,
  and `facade-names.ts` renders both. eslint's `import/order` places a facade
  import in the `external` group, with the other package imports, so a rewired
  importer (pass 3) moves its line there. Pass 2 added the package's folder to
  `CUT_RULES` with its facade, and at its move (pass 4) the facade becomes the
  package's own `index`. Pass 2 moved no file under `src/` and changed no
  importer. Inventory's move (pass 4a) and effort's (pass 4b) have run: those
  two packages now hold their own files and a `tsconfig.json`, and their
  `index.ts` re-exports from `./src/…`, so the sentences above that say 'until
  its move' describe the four facades still waiting, for board, release, pr and
  run, and the `'../../src/effort/collect.js'` example is the form effort's
  facade took before pass 4b.
- **The first feature move is inventory's (pass 4a), effort's the second (pass
  4b), and each later move repeats its shape.** A feature package holds its own
  files under `packages/rafa-<name>/src/`, at their paths below `src/`, once its
  move has run, as `packages/rafa-inventory/` does since pass 4a. The move tool,
  `scripts/codemod/pass-moves.ts`, takes `--package=<name>` and moves a list
  into a feature package as it moves into core, with four differences: the
  parked tests go to `src/tests/<name>-coupled/`, with a README; an outside
  importer takes the package by `@open-tomato/rafa-<name>/<path below src>`; a
  moved file keeps its bare core specifiers; and the facade's re-exports point
  at `./src/…`. The package's `exports` maps `"./*"` to `./src/*.ts`, for the
  tests outside it that take names the facade does not export, and
  `src/tests/facade-subpaths.sweep.test.ts` holds that no non-test file takes a
  subpath. Its `tsconfig.json` is composite, references core and each feature
  package it depends on, and `check-types` runs `tsc --build`. Its `bunfig.toml`
  preloads `test-preload.ts`, which registers core's section and nothing of the
  root, since no package may import the root. Effort's move (pass 4b) differed
  in three ways: a package that depends on a second feature package declares it
  in `package.json` and references that package's `tsconfig.json`; a test that
  reads a root source by path with no import parks by hand, as
  `classify.test.ts` does; and the fixtures a core test reads move into core
  before the run, as `migrations/` did. The integration test stays at the root
  until #913.
- **The rewire moves effort's, inventory's, board's, release's, pr's and run's
  importers onto their facades and keeps the files each one's groups name on
  their paths.**
  `bun scripts/codemod/rewire-facade.ts --package=rafa-<name>` `[--dry-run]`
  takes each importer of a feature package that can take it by name and
  rewrites it to import `@open-tomato/rafa-<name>`.
  `scripts/codemod/rewire-groups.ts` puts each importer in the first of four
  groups that holds it. The codemod rewrites the fourth, `rewire`, and leaves
  the other three byte for byte:
  - `loadCycle`: the package's own non-test files reach the importer over value
    edges, so taking the package by name would load it inside that cycle. Effort
    has none: its six, `packages/rafa-inventory/src/agents/roster.ts`,
    `packages/rafa-inventory/src/check/run.ts`,
    `packages/rafa-inventory/src/inventory/record.ts`,
    `packages/rafa-inventory/src/inventory/trees.ts`,
    `packages/rafa-inventory/src/schema/instinct.ts` and
    `packages/rafa-inventory/src/tiers/serve.ts`, imported effort only for the
    frontmatter and agent-definition files, which the first decouple item moved
    into core. Inventory has none either: its last,
    `packages/rafa-effort/src/effort/skill-use.ts`, was reached from inventory's
    search through `packages/rafa-effort/src/effort/collect.ts` until the second
    decouple item cut that edge, and it took the facade once the graph was
    regenerated without the cycle, so the guard's inventory row is empty;
    `packages/rafa-inventory/src/start/serving.ts` is an inventory file by name,
    so it is no importer. Board has nineteen: `src/bugs/filed-values.ts`,
    `src/claims/drift.ts`, `src/claims/labels.ts`, `src/commands/switch.ts`,
    `src/next/hop-action.ts`, `src/next/hop-rows.ts`, `src/next/owner-gate.ts`,
    `src/next/readings.ts`, `src/next/relations-mode.ts`, `src/next/sources.ts`,
    `src/next/state.ts`, `src/pr/gh-close.ts`, `src/pr/gh.ts`,
    `src/pr/owner-approval.ts`, `src/start/stale-docs.ts`,
    `src/start/triage.ts`, `src/triage/bug-filing.ts`,
    `src/triage/refs-section.ts` and `src/triage/triage.ts`.
    `src/claims/ahead.ts` and `src/epic/verify-run.ts` left them in the fourth
    decouple item (rafa-1333), which places both in board by name, and
    `src/claims/plan-claim.ts`, which took them by path, took the facade. The
    second decouple item took the importers it freed onto the facades:
    inventory's `src/start/dispatch.ts`, `handout.ts` and `preflight.ts`, and
    board's `src/plan/store-rules.ts`, `src/start/preflight-claim.ts` and
    `preflight-drift.ts`. `packages/rafa-effort/src/effort/epic-cost.ts`, an
    effort file, sat among them until the first decouple item moved
    `packages/rafa/src/board/naming.ts`, its one board import, into core.
    Release has two: `src/board/project/facts.ts` and
    `src/docs/release-issue.ts`. `src/board/project/facts.ts` is among them
    though it is a board file that imports release, because the load-cycle group
    comes first; its edge to release is a back edge the decouple step before
    pass 4 cuts. Pr has sixteen: `packages/rafa/src/claims/git.ts`, `src/claims/lost.ts`,
    `src/cleanup/past-head.ts`, `src/cleanup/worktrees.ts`,
    `src/commands/release/status-fragments.ts`, `src/next/epic-end.ts`,
    `src/next/hint.ts`, `src/next/hop-rows.ts`, `src/next/readings.ts`,
    `src/release/branch-forecast.ts`, `src/release/fragment-tree.ts`,
    `src/release/settle-pr.ts`, `packages/rafa/src/start/branch-decision.ts`,
    `src/start/pr-lifecycle.ts`, `src/start/pr-retarget.ts` and
    `src/start/suite-blocker.ts`. Six of them, `src/cleanup/past-head.ts`,
    `src/commands/release/status-fragments.ts`, `src/next/epic-end.ts`,
    `src/release/branch-forecast.ts`, `src/release/fragment-tree.ts` and
    `src/release/settle-pr.ts`, are release files by the cut table's unit that
    import pr from a package earlier in the move order; their edges are back
    edges the decouple step before pass 4 cuts, and they sit in this group
    because the load-cycle group comes first. Run has fifteen: five board files
    (`src/board/gate.ts`, `src/board/project/rules.ts`,
    `src/board/roadmap-claims.ts`, `src/board/setup.ts` and
    `src/next/relation-readings.ts`), nine pr files (`src/cleanup/groups.ts`,
    `src/cleanup/steps.ts`, `src/next/owner-gate.ts`, `src/next/settle-step.ts`,
    `src/next/sources.ts` and the four `src/triage/` files) and one release file
    (`src/next/epic-end.ts`). All fifteen are files of packages earlier in
    `MOVE_ORDER` of `scripts/survey/coupling.ts`, by the cut table's unit, and
    they sit in this group because the load-cycle group comes first. Their edges
    to run are back edges the decouple step before pass 4 cuts, since run moves
    last and no package imports it forward.
  - `backEdge`: the importer sits in a package earlier in the move order than
    the one it imports, so taking the package by name would make that earlier
    package import a later one, which the decouple step before pass 4 cuts.
    Inventory has none since the 23 October 2026 swap put it first: its
    three effort importers,
    `packages/rafa-effort/src/effort/report-skills-read.ts`,
    `packages/rafa-effort/src/effort/report-skills.ts` and
    `packages/rafa-effort/src/effort/skill-facts.ts`, import it forward and take
    it by name since the second decouple item's rewire. Board has none: no
    effort file imports it. Release has none in the codemod's grouping, because
    its one board importer, `src/board/project/facts.ts`, is taken first by the
    load-cycle group. Pr has eighteen: `src/board/project/add-filed.ts`, the
    three `src/commands/epic/` files (`close-docs.ts`, `close-triage.ts` and
    `close.ts`), the two `src/commands/issue/` files (`create-bug.ts` and
    `create.ts`), the ten `src/commands/release/` files,
    `src/release/prepare.ts` and `src/release/verify.ts`;
    `packages/rafa-effort/src/effort/report-doc-bugs.ts` left it when the first
    decouple item moved `packages/rafa/src/triage/doc-only.ts` into core. Each
    sits earlier in the move order than pr, so each imports it backwards, and
    the decouple step before pass 4 cuts them.
    Run has ten: two board files (`src/commands/epic/close-triage.ts` and
    `src/commands/issue/ready.ts`; `src/commands/board/list.ts` and
    `src/commands/epic/new.ts` left them in the fourth decouple item, which
    moves `defaultBoardOnce` into `src/board/default-board-once.ts`), the
    eight `src/commands/pr/` files
    (`merge-cleanup.ts`, `merge-followups.ts`, `merge-loop-worktree.ts`,
    `merge.ts`, `retarget.ts`, `triage-resolve.ts`, `triage.ts` and
    `wait.ts`). Each sits earlier in the move order than
    run, so each imports it backwards, and the decouple step before pass 4 cuts
    them.
  - `declarationGraph`: the importer is reached from the `include` of a
    declaration build whose `.d.ts` files ship, so a published type would name
    a private package, which pass 4 settles. Effort has two:
    `src/config/shape.ts` and `src/config-registry.ts`. Inventory has none.
    Board has the same two as effort. Release has the same two. Pr has the
    same two. Run has the same two.

  Tests move or rewire in pass 4 with the files they test, so the test files
  that import a rewired package by path stay on their paths in pass 3. The
  rewire guard, `scripts/survey/facade-rewire.sweep.test.ts`, holds each
  rewired package to its row of `REWIRED`: no non-test file outside the
  package imports one of its files by relative path unless the row names it
  with its group, and each named file still does. Each row names its kept
  files, effort's two, inventory's one, board's 23, release's four,
  pr's 36 and run's 32, and a planted control reds on one relative import.
  No row keeps a file for the library build. Board's, release's, pr's and
  run's rows once held a fourth group, `libraryChunks`: 68 files a library
  entry reaches statically (board 21, release eight, pr 33 and run six), kept
  on their paths while each facade carried its feature object, since through
  the facade that graph reached the package's lazy command modules and the
  splitting build wrote each as a chunk of its own. The feature objects left
  the facades for the commands entries at commit e54b5e3, and the rewire at
  commit da2acc3 took the 68 onto the facades, so the group is gone from the
  guard's `KeptGroup` and from every row. The published-types case of
  `src/tests/package-build.test.ts` checks that no `dist/**/*.d.ts` of the
  scratch build names `@open-tomato/rafa-effort`, `-inventory`, `-board`,
  `-release`, `-pr` or `-run`, nor a commands entry of board, release, pr or
  run, each with a planted-text control.

  The codemod matches a binding by name and file against the facade, so a
  statement is refused whichever side names the other file. A binding taken
  through a re-exporting module of the package, such as
  `packages/rafa-inventory/src/learning/index.ts`, `src/board/setup.ts` or
  `src/board/gate.ts`, is refused by the codemod and is pointed at its origin
  file by hand before the run: pass 3a did that three times, inventory's rewire
  six, and board's eight; release's rewire refused no statement. The second
  decouple item's rewires pointed four refused bindings on three statements by
  hand before the run: two statements through the library's `index.ts` (now
  `packages/rafa-inventory/src/learning/index.ts`) and one through
  `src/board/roadmap.ts`. Pr's rewire refused 21 bindings on 20 statements that
  took `PullRequests`, `resolvePrProvider`, `ResolvePrProviderOptions`,
  `PrProviderReading`, `ghPreflightItems`, `ghHostOf` and `ChecksVerdict` from
  their defining files while the facade lists them under `src/pr/index.ts`, and
  each was pointed at the barrel by hand before the run. Run's rewire refused 36
  bindings on 9 statements in 7 files, 34 of them taken through the barrels
  `src/plan/index.ts` and `src/cleanup/index.ts` while the facade lists them
  under the preflight and cleanup files that define them, and `PreflightCheck`
  taken from `src/preflight/run.ts` while the facade lists it under
  `src/plan/index.ts`, so one rewire met both directions of the refusal; each
  statement was split by hand before the run so every binding names the file the
  facade lists it under. A file whose stem names a fake is read as a test by the
  codemod and the guard, so the three fakes `src/ci/runs-fake.ts`,
  `src/pr/gh-fake.ts` and `src/pr/gh-fake-shapes.ts` keep their paths until pass
  4.
- **What publishes is what the manifests say.** A workspace member publishes
  when its `package.json` holds no `"private": true`, and no config key names
  the packages that publish. The build (`publishableOf` in
  `src/release/workspace-packages.ts`) and the release read that one field;
  the graph check reads it through `isPublishable` in
  `scripts/workspace/publish-rules.ts`. Every member is `private` today, so the
  build passes no external and no fragment can name a package for settle.
- **The root `build` script keeps every publishable member out of the CLI.**
  The script runs `bun scripts/build/bundle.ts` after `rm -rf dist`. That
  script builds `src/rafa.ts` alone to `dist/cli.js`, then the six library
  entries together, with `--splitting --root=src`, into `dist/`. Each build
  passes `--external <name>` for every publishable member's name. bun applies
  an external to the name and to every `<name>/<subpath>` before it resolves
  the import, so the bundle keeps the bare specifier; a private member such as
  `@open-tomato/rafa-core` is bundled, as before. The bundle guard then reads
  each build's metafile and fails the build, exit 1, when a file under a
  publishable member's folder is in a bundle, one line per file:
  `dist/cli.js bundles <file> of <name>, imported by <importers>`. The
  externals only name bare imports, so the guard is what catches a relative
  import that reaches into a publishable member's folder. A clean build prints
  one line per bundle, `<label> built with externals: <names>`, or `none`.
  `--no-externals`, which the tests alone pass, builds with no `--external`,
  so the guard's failure has a planted-tree control.
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
- **A publishable member names rafa as a peer, never as a dev dependency.** A
  member that publishes and imports `@open-tomato/rafa`, or a subpath of it,
  declares that package under `peerDependencies` and in no other field, so the
  rafa its consumer installed is the one it shares. Its manifest has no
  `devDependencies` line for the root: bun 1.3.14 refuses `workspace:*` and
  `link:../..` there (`@x/root@workspace:* failed to resolve`), and
  `file:../..` installs a copy of the root instead. The in-repo import still
  resolves through the `paths` of `tsconfig.packages.json`, which bun reads at
  run time. The publish rules hold the shape: a file the member ships that
  imports the root while `peerDependencies` does not name it is refused. Their
  import rules read only the shipped files: with a `files` list, each file an
  entry names, directly, by a folder holding it or as a `Bun.Glob`; with none,
  every code file but a test file (a name holding `.test.`, or a `__tests__`,
  `test` or `tests` folder) and a tool config at the member's root
  (`*.config.{js,mjs,cjs,ts,mts,cts}`). The targets of `main` and `bin` are
  not read, and the undeclared-import rule of the graph check below still
  reads every code file. A plugin's manifest reads:

  ```json
  { "name": "@open-tomato/rafa-plugin-example", "version": "0.1.0",
    "peerDependencies": { "@open-tomato/rafa": ">=0.46.0" } }
  ```

  No member here has the shape yet: this plan ships no plugin, so the publish
  rules and this example are what hold it.
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
  member that has one: `tsc --build` in the four composite members. `bun run
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
  every run prints `Multiple projects found` to stderr. A facade over `src/`
  holds no `tsconfig.json`, so the graph check asks it no `check-types`
  script and the references build skips it, as it skips the config
  packages. `packages/rafa-inventory`, which holds its own files, has a
  composite `tsconfig.json` referencing `../rafa`, a `check-types` script
  and an entry in the solution file, and its `bunfig.toml` preloads
  `test-preload.ts`, which registers core's section alone, so `bun test`
  run from its folder reads core's settings.
- **The composite recipe builds the four composite members' declarations.**
  The `tsconfig.json` of `packages/rafa`, `packages/rafa-hub`,
  `packages/rafa-sync-service` and `packages/rafa-inventory` keeps the
  `extends` of `tsconfig.packages.json` and sets `composite: true`,
  `noEmit: false`, `emitDeclarationOnly: true`, `rootDir` (`"src"`, or `"."` in
  `packages/rafa-inventory`, whose `index.ts` sits beside `src/`), `outDir:
  ".tsbuild"` and `tsBuildInfoFile: ".tsbuild/tsconfig.tsbuildinfo"`, the last
  so two packages never share one (TS6377). It leaves its test files out, and
  its `references` name what it imports: core none, and every other member
  `../rafa`. `tsc --build` builds a
  reference first, reads core through `paths` from that reference's
  declarations, and is a no-op on a second run. `.tsbuild/` is gitignored at
  every depth. Each of the three code packages' `turbo.json` extends the root's
  (`"extends": ["//"]`) and declares `check-types.outputs` as `.tsbuild/**`, so
  a cache hit restores the declarations a dependent's build reads. The two
  config packages emit nothing and carry no override. `packages/rafa-inventory`
  has no `turbo.json`, so its `check-types` runs under the root's definition,
  which declares no outputs. A service with its
  reference to core dropped fails with `TS6307` and `TS6059` on core's files,
  and still writes their `.d.ts` files beside core's sources, so a run that
  fails that way leaves stray files under `packages/rafa/src/` to remove; list
  them with `git ls-files --others --exclude-standard`.
- **The solution file builds the members in dependency order.** The root
  `tsconfig.references.json` holds `"files": []` and one reference per
  composite member, so `tsc --build tsconfig.references.json` builds all four
  and refuses a reference cycle with `TS6202`, exit 4. Ring 1 runs it. The root
  umbrella `tsconfig.json` keeps `tsc --noEmit` and no `references`, so ring 0
  reads core's source through `paths` as before.
- **The graph check refuses four things, and three more of a publishable
  member.** `scripts/workspace/graph-check.ts` reads each member under
  `packages/*` and refuses it on four counts, one line per reason: it has no
  script for a task in the root `turbo.json` (`lint`, `check-types` and `test`
  today), with `check-types` asked only of a member that holds a
  `tsconfig.json`; its `tsconfig.json` is not `composite`, or the
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
  manifest's `exports` lack, or a private member by name. The last two read
  only the files the member ships, as the bullet on a publishable member's
  peer above sets out. For such a member `@open-tomato/rafa/<subpath>` names
  the root package, not the member the `paths` alias resolves it into, so the
  fourth refusal leaves it to these.
  It exits 0 with one `ok` line per member and exits 1 with a line per
  reason; a root it cannot read is a refusal too. Ring 1 runs it, and
  `src/tests/workspace-graph.sweep.test.ts` runs it over the live tree in every
  task's gates. Each refusal has a planted-tree control in
  `scripts/workspace/graph-check.test.ts`.
- **Bun links each member in isolation, so a member declares what its files
  import.** A member's own `node_modules/` holds only what its manifest
  declares, so a bare import resolves from its manifest and not from the
  root's. Each member but the eslint-config package declares
  `@open-tomato/rafa-eslint-config` (`workspace:*`) and `eslint` in its
  `devDependencies`, the last at the root's range, so one install serves its
  scripts; the members with a `check-types` script and the typescript-config
  package also declare `typescript` at the root's range, and the two services
  also declare `@open-tomato/rafa-core` (`workspace:*`). The graph check's
  fourth refusal holds the `@open-tomato/*` imports to those declarations and
  reads no `eslint` or `typescript` import, which the scripts name. The
  eslint-config package lists `eslint` in its `dependencies`, declares
  `typescript` as a `devDependency`, and imports itself by name through its
  own `exports`. After a manifest edit, `bun install` refreshes `bun.lock` and
  the links.
- **The build reads core from its source and names it through two shims.** The
  root `build` script runs `scripts/build/bundle.ts`, which bun-builds
  `src/rafa.ts`, five library entries under `src/` and, alone, the learning
  entry the inventory package holds since pass 4a, with every publishable
  member as `--external` (core is private, so it stays bundled), and fails
  when a bundle holds a publishable member's file. Two of those entries,
  `src/effort/store/index.ts` and `src/ports/index.ts`, are one-line
  `export *` shims of `@open-tomato/rafa/store` and `@open-tomato/rafa/ports`,
  so the `dist/` files the root `exports` name exist until #808 bundles core
  into the root. Its declarations come in two passes:
  `packages/rafa/tsconfig.types.json` writes core's declarations for the
  root's `./config` subpath into the root `dist/`, and
  `tsconfig.config-types.json` then writes the `./config` declarations after
  them. The root `exports` also keeps twenty-three `types`-only entries for
  core's files (`./core/config`, `./core/config/config-schema`,
  `./core/config/sections`, `./errors/codes`, `./errors/rafa-codes`,
  `./ports/log-level`, `./report/parse`, `./store/check-rows`, and, since pass
  1 and the third decouple item (rafa-1325) moved the section files in,
  `./bugs/record` and the fourteen `./config-schema-*` files), which #808
  retires. The first pass's `include` names each moved file the root's config
  files import.
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
  - `tiers.ts`, `project-id.ts` and `frontmatter.ts`, under
    `packages/rafa/src/schema/`: `@open-tomato/rafa-core` (core);
    `frontmatter.ts` moved there from `rafa-effort` in the first decouple item
  - `instinct.ts`, `skill.ts`, `stack.ts`, `provenance.ts`,
    `failure-strings.ts`, `scope-records.ts`: `rafa-inventory`
  - `agent.ts`: `@open-tomato/rafa` (the CLI)
- **No upward edge leaves rafa-effort.**
  `packages/rafa-effort/src/effort/report-skills.ts` reads `readScopes` from
  `packages/rafa-inventory/src/schema/scope-records.ts`, which lands in
  rafa-inventory. Inventory ranks below effort in the cut table, so that edge
  runs down the order, not up it, and the table reads rafa-effort at 0 upward
  edges.

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

**The 800-line cap is a convention only.** The root `eslint.config.mjs` and the
`base.mjs` and `sharedRules.mjs` of `packages/eslint-config` carry no
`max-lines` rule, so nothing refuses an oversized module and a file crosses the
cap without any capture going red. Count the file with `wc -l` when a task adds
to one already near the cap; a module that has to grow puts the new concern in a
new file, and a note that has outgrown its module can move to the `context/`
page that owns the subject. Some modules including
`packages/rafa-inventory/src/schema/instinct.ts` exceed the cap; the cap is a
convention about the target size, not an upper bound the gates enforce.

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
  `packages/rafa/src/config-schema-*.ts`, where `eslint.config.mjs` and the
  package's own leaf allow it: a section's
  `interface RafaConfig extends HubSettings {}` inside its `declare module` is
  that shape on purpose.
- **Markdown is a lint target, and every fenced block needs a language**
  (`markdown/fenced-code-language`). A fence shown INSIDE a fenced example
  — a `context/` page quoting the comment a command writes, say — is read
  as a real fence by the rule, so escape the inner backticks (`\`\`\``)
  rather than nesting them bare.

### Runtime import cycles

**The sweep `src/tests/import-cycle.sweep.test.ts` fails on any non-test
runtime import cycle that spans two clusters.** It reads the import graph
the way `scripts/survey/import-graph.ts` does: `readMetafile` and
`buildImportGraph` from there, handed the facade tables `readFacadeTables`
of `scripts/survey/facade-tables.ts` reads, and the file set from
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
`packages/rafa/src/core/` and kept each keyed file's cluster. The map keys 16
of the 36 files pass 1 moved, at their new paths. The other 20 are unkeyed, as
are `core/plan/plan-files.ts` and `core/loop/session-readings.ts`. The sweep
places each unkeyed file by its folder's majority, or counts it unplaced, as its
coverage line reports. The moved files' relative barrel imports change no cycle:
the sweep passes at this commit.

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
`packages/rafa-effort/src/effort/sync/select.ts` by value, and `select.ts`
imported the registry back through the barrel. Both sat in cluster c7, so the
sweep passed them, and a barrel over one file could not be split to step round
the cycle. The composition root `src/adapter-registry.ts` now lists `sync/local`
from `select.ts`, so `registry.ts` imports nothing above core and the cycle is
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
`packages/rafa/src/commands/plan/plan-files.ts` is the command half of the plan readers: the
first command that needed them (`rafa plan create`) wrote them there, and sixty
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
