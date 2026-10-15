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
  from the plan barrel, `../../core/plan/index.js`, and
  `src/commands/release/tag.ts` takes `versionTag` from
  `../../release/version-tag.js` so two writers cannot spell one tag
  differently. Reach for the existing helper — a second spelling of a
  refusal is the real smell, as `release status`'s hand-rolled
  `Expected no arguments` is beside `src/commands/plan/plan-files.ts`'s
  shared `expectNoArgument`, which says `Expected no argument`.
- **Every `import type` line forms one `import/order` group**
  (`sharedRules.mjs`), and no short rule predicts its order: neither plain
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

**`tsconfig.base.json` sets `isolatedDeclarations` and
`erasableSyntaxOnly`**, so the root config and both workspace packages
are held to them by `bun run check-types`, with no flag on the command
line. `declaration` sits beside them because `tsc` refuses
`isolatedDeclarations` without it; under the base's `noEmit` it writes no
file. The root `tsconfig.json` excludes `**/*.test.ts`, so
`check-types` does not hold a test file under `src/` or `scripts/`. The
runner's type step does, for the test files a task adds or edits: its
scratch config extends `tsconfig.json` and takes the flags with it. A
package's `tsconfig.json` includes its test files, so `check-types`
holds one under `packages/`.

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
- **A command's default export takes the `const command: RafaCommand`
  form**: `const command: RafaCommand = createNextCommand();` and then
  `export default command;`, as `src/commands/next.ts` does. `RafaCommand`
  comes from the command barrel, `src/core/command/index.ts`. Where the
  expression is not assignable to `RafaCommand`, fix the factory's
  declared return type rather than the annotation.
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

**Core is `src/core/`, the code every part of rafa reads.** The nineteen
files that #905 moves there are the connective tissue of the codebase:
graph analysis calls such files high-betweenness nodes, since many paths
between the rest of the tree run through them. A twentieth,
`runtime/identity.ts`, moved there in #1088 so the effort store imports
nothing above core for it. They sit in eight subject folders. `config/`
holds the value readers, core's keys of the schema, the section
contract, core's own section and the loader; `command/` the command
contract (`RafaCommand`, `RafaContext`,
`CommandExit`), the version and the confirm prompt; `output/` the active
output; `adapters/` the adapter registry; `git/` the git runner and the
commit helpers; `plan/` the block reader, the plan parser and the
plan-file readers; `loop/` the loop's session helpers, its session
readings and the Claude spawner; `runtime/` the reading of which build
is running. A file keeps its base name when it moves. A moved file keeps
a re-export at its old path while a non-test file outside core still
imports it there; `CORE_REEXPORTS` of `scripts/survey/core-moves.ts`
lists those paths, today `src/runtime/identity.ts`.

Two edge cases show why a file is core. `src/pr/git.ts` sat under the
pull-request code, but release code imports the git runner too, so it
moved to `src/core/git/`. `src/report/parse.ts` reads like the run's
report code, but the effort store reads it, so it is core. Core is also
`src/ports/`, the effort store under `src/effort/store/` and
`src/report/record.ts`: core by assignment, kept where they are.

**A subject's barrel is the only file under `src/core/` that a file
outside it may import.** There are twelve, all listed in `CORE_BARRELS` of
`scripts/survey/core-moves.ts`: an `index.ts` in each subject folder, and
four more, `config/sections.ts`, `config/load.ts`, `loop/readings.ts` and
`plan/block-reader.ts`. A barrel re-exports the names of the files behind
it and no more. The barrels are the declared exports until the cut names
real subpaths (#808).

**Outside `src/core/`, a file imports a barrel by relative path and
nothing deeper.** In a file outside `src/core/`, no static import,
`import type`, `export … from` or dynamic `import()` names a file behind a
barrel.
Inside `src/core/`, a file imports the files it needs by path, siblings
and other subjects' files alike, and never a barrel. A grep at this
commit found no barrel imported from inside, but no sweep measures that
half.

**The deep-import sweep holds the outside half.**
`src/tests/core-barrels.sweep.test.ts` reads every code file a commit
would hold, tracked or untracked and not ignored, under `src/`, `scripts/`
and `packages/` and at the root, test files included. It fails on any
import from outside `src/core/` that reaches a file inside it other than a
listed barrel. The reading is `readCoreImports` in
`scripts/survey/core-barrels.ts`, over the specifiers `textImports` finds,
so an `import type`, an `export … from`, a dynamic `import()` and a
`require()` count as much as a static import. It takes no allow-list: a
path is allowed only by listing it as a barrel in `core-moves.ts`, and
`core-moves.test.ts` checks that list's shape. An `index.ts` under a
subject folder is a deep import like any other file. Three things are not
seen: an `import()` or `require()` whose argument is not a string literal,
a `mock.module()` call, and a path built for a spawned process or a file
read. The sweep prints the files it read at load, so an empty read cannot
pass. A module augmentation is no import: a `declare module` naming
`src/core/config/config-schema.ts`, which each `src/config-schema-*.ts`
file writes to add its fields to `RafaConfig`, is answered under
`augment` and passes. It has to name the declaring file: spelled through
the config barrel, two augmentations merged with each other and not with
`RafaConfig`, whose `keyof` missed both. That file is one more path the
core package will have to export (#808).

**The config sections are handed in, never imported.** Core declares the
section contract in `src/core/config/section.ts`: a `ConfigSection` carries its
`package` name, its `settings`, its `defaults` and its cross-key `checks`. Core
names no section. The twelve are listed in `src/config-registry.ts`, which sits
outside `src/core/`: core's own (`core-section.ts`) and the eleven
`src/config-schema-*.ts` files. Importing that module registers the twelve with
core once, and `src/rafa.ts` and `src/index.ts` import it ahead of anything
that loads a config. A file outside `src/core/` takes the merged `SETTINGS`,
`CONFIG_DEFAULTS`, `SETTING_NAMES`, `SETTING_BY_KEY`, `SECTIONS` and
`knownKeysAbove` from the registry, never from the core barrel, which exports
none of them; core reads the same through the `active*` functions of
`section.ts`. A registration that breaks a rule throws at import, naming what
it refused: a setting name two sections define, a file key a second section
defines under another setting name, which names both setting names too, or a
`dangerous.*` key a second section defines under the same setting name, each
naming both packages.

**The adapters are handed in, never imported.** Core declares the adapter
registry in `src/core/adapters/registry.ts`, and that file imports no
adapter: core's adapters sit under `src/adapters/`, `src/effort/store/` and
`src/effort/sync/`, above core. `src/adapter-registry.ts`, outside
`src/core/`, lists them and hands them to `registerAdapters` as it is
imported. `src/rafa.ts` and `src/index.ts` import it right after
`src/config-registry.ts`, before anything resolves an adapter, so the two
composition roots are the two entries' imports. Until the root is imported,
every member of `CORE_ADAPTER_REGISTRY` refuses, naming it. A test that
reads core's adapters off the registry imports the root for its effect, as
the entries do.

**A section adds its keys to `RafaConfig` by `declare module`.**
`RafaConfig` stays declared in `src/core/config/config-schema.ts` with core's
keys. Each section file adds its own by a `declare module` naming that file,
`'./core/config/config-schema.js'`, and not the config barrel, for the reason
the augment note in the deep-import sweep paragraph above gives. So
`ConfigSetting` names every key, and nothing in core names a section.

**`ConfigShape` is composed from the sections, not merged into.** Each
section file exports an interface of the keys a file writes for it
(`HubShape` holds `hub`, `ReleaseShape` holds `pr` and `release`), and its
part of a namespace it shares with core as an interface of its own:
`LoopRetriesShape`, `LoopContinueShape` and `WrapUpShape` for `loop`,
`BoardProjectLimitsShape` for `board.project`, `ReleaseDangerousShape`
for `dangerous`. `src/config/shape.ts`, outside `src/core/`, holds core's
keys and composes `ConfigShape`, `LoopShape`, `BoardProjectShape` and
`DangerousShape` from those interfaces by `extends`, through `import type`.
Each section's `declare module` on `shape.ts`, the form this replaced,
merged only in a program that loaded the section files: the emitted
`dist/config/shape.d.ts` imported none of them, so a consumer of the
`./config` subpath saw core's keys alone. Written out, the emitted `shape.d.ts` imports every section's
emitted declaration, and `src/config/shape.test.ts` reads
`ConfigShape['hub']['url']` as `string` from declarations emitted in
memory.

**The sweep holds core off the section files.**
`src/tests/core-config-sections.sweep.test.ts` reads every code file under
`src/core/` and fails on any import of a `src/config-schema-*.ts` file, by any
specifier `textImports` finds, so a dynamic `import()` or a `require()` counts
as much as a static import. Like the barrel sweep, it does not see an
argument that is not a string literal. A second `describe` holds `loadConfig`
with no section registered to a refusal naming `src/config-registry.ts`.

**A barrel is split, never widened, when it closes a runtime cycle.** A
barrel that groups a file with one outside `src/core/` that imports the
barrel back by value closes a cycle. The cycle fails with a
`ReferenceError` at load, in one import order only, so a green `tsc`
proves nothing about it. The four barrels beyond the subject indexes are
the splits made so far. `config/sections.ts` holds the leaf pair
`config-sections.ts` and `config-readers.ts`, split while
`config-merged.ts` imported section files that import the pair back;
that file is retired and nothing behind `config/index.ts` imports a
section file now, so the split stands as it was made. `config/load.ts` stands
alone, because `config-load.ts` reaches `src/effort/store/settings.ts`,
which imports the config barrels back. `loop/readings.ts` stands alone,
because `session-readings.ts` reaches `src/effort/store/task-finishes.ts`,
from which `development-build.ts` imports `loop/index.ts` back.
`plan/block-reader.ts` stands alone, split while `parse.ts` imported
`src/utils/tracker.ts`, which imports `blocks.ts` back; `parse.ts` now
reads `plan/blocker-comment.ts` instead and no core file imports the
tracker, so the split stands as it was made.

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

**The counts rank options and do not certify a cut.** An upward edge from
`src/core/config/` into a `src/config-schema-<section>.ts` file is marked
as cleared by #118, which makes each package own its config section. It
still counts as upward: the table's `remaining` column is the count less
the cleared edges. A count is only as current as the graph it was read
from. `tsc --build` with project references (#807) is the gate that
certifies a cut.

### Packages under `packages/`

- **`packages/*` is a bun workspace** (`workspaces` in the root
  `package.json`) holding `packages/rafa-hub/` (`@open-tomato/rafa-hub`)
  and `packages/rafa-sync-service/` (`@open-tomato/rafa-sync-service`).
  Both are `private`: publishing them is an operator's decision, and the
  root `files` ships neither.
- **A package imports core only as `@open-tomato/rafa/store` or
  `@open-tomato/rafa/ports`**, never `../../src/...` and never another
  subpath. What a package needs from core is exported from one of those
  two entries first (`src/effort/store/index.ts`, `src/ports/index.ts`).
- **The two subpaths resolve through `paths`, not `node_modules`.**
  `tsconfig.packages.json` maps each to the source file the build
  compiles into its `exports` target, and each package's `tsconfig.json`
  extends it; bun reads `paths` at runtime, so `bun test` resolves them
  from the root or from the package with no `dist/`. Nothing installs
  `@open-tomato/rafa` into `node_modules`: a member depending on it with
  `workspace:*` fails `bun install` with
  `@open-tomato/rafa@workspace:* failed to resolve`, since the root is
  not a member of its own workspace.
- **Every other route into core stays unresolved.** A deep path or an
  unmapped subpath fails with `Cannot find package '@open-tomato/rafa'`
  under bun and `TS2307` under tsc. Each package's own
  `core-subpaths.test.ts`, under `packages/<name>/src/`, holds this,
  holds the map to the two
  subpaths as a closed list, and holds each entry equal to the root
  `exports`. A new subpath goes into both files and that list.
- **Which gates reach a package.** `bun run test` runs its tests.
  `bun run check-types` runs the root `tsc --noEmit`, whose `tsconfig.json`
  excludes `packages`, then `bun run --filter './packages/*' check-types`,
  each package's own `tsc --noEmit`; a package's `tsconfig.json`
  includes its test files. `bun run lint` lints it from the root config
  like `src/`, its `testdata/` folders included, and so does the
  runner's lint step on a task's diff. The two subpaths resolve for
  `import/no-unresolved` because `eslint.base.mjs`'s resolver lists
  `./packages/*/tsconfig.json` beside the root `tsconfig.json`; without
  that entry, `bunx eslint packages` reported 21 `import/no-unresolved`
  errors (measured on ESLint 9.39.5). Two globs make several projects,
  so the resolver also sets `noWarnOnMultipleProjects`, or every run
  prints `Multiple projects found` to stderr.
- **A content schema is imported through its owner's `schemas` export.**
  A content schema is a frontmatter or record schema describing a file
  rafa reads (a skill, an agent, an instinct), not config and not a step.
  Across a package line it comes through the owning package's `schemas`
  export, a fifth export beside the four the package contract lists
  (commands, steps with guards, config section, flows through
  `run(ctx, options)`), never through a deep path. Core's schemas are
  exported from `@open-tomato/rafa/ports` as `schemas`, so the closed list
  of two core subpaths stays at two. No schema has moved yet: this is the
  placement the cut takes.
- **Each schema under `src/schema/` lands in one package**, the one
  `docs/survey/content-schema-importers.md` names for it:
  - `tiers.ts`, `project-id.ts`: `@open-tomato/rafa` (core)
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

**The 800-line cap is a convention only.** `eslint.base.mjs`,
`eslint.config.mjs` and `sharedRules.mjs` carry no `max-lines` rule, so
nothing refuses an oversized module and a file crosses the cap without
any capture going red. Count the file with `wc -l` when a task adds to one
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

**A new key in `SETTINGS` reaches the files below beyond the schema,
sections and `init` scaffold.** `src/core/config/config.ts` is not one:
it builds a layer by a loop over the names registered with
`src/core/config/section.ts`, so it names no setting.
`src/config-registry.test.ts` pins the key set as closed lists (`KEYS`,
`TOP`, `SECTIONS`, `knownKeysAbove`), and a core key
is also spelled in `src/core/config/core-section.test.ts` and takes its
place in one of the runs of core's names that `src/config-registry.ts`
spells. Both config suites
also check that every setting appears exactly once:
`src/core/config/config.test.ts` (`SETTINGS`, `DEFAULTS`, `FULL`,
`FULL_VALUES`, its cases and `KNOWN`) and
`src/tests/config-layers.test.ts` (the PROJECT and USER text and values,
and `SECTION_CASES`). `check-types` never reads the two suites, so only
`bun run test` shows what is missing. A section appended after the last
one in the scaffold has to bound any scaffold case that slices from an
earlier header to the end of the template. This section replaces
nothing.

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
a type-level cycle passes; `#807`'s `tsc --build` with project references
is the gate for those.

**Files are mapped to clusters via `docs/survey/cluster-map.json`,**
the file-to-cluster assignment from the eight-cluster import graph survey
run. A file with no mapping takes the cluster most of its folder's mapped
files hold. If a file's folder holds no mapped file, the file stays
unplaced and the sweep does not fail on it: a cycle through it is still
found, and the file counts toward no cluster. The sweep prints the file
coverage line, a count of files placed by folder majority, and a count
of the unplaced ones; a new survey run that extends the map places them.
The move of #905 renamed the map's keys to the `src/core/` paths and kept
each keyed file's cluster. Two moved files were never keyed,
`plan-files.ts` and `session-readings.ts`, so the sweep places them by
their folder.

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
`src/core/adapters/index.ts` was one: `registry.ts` imported
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

**Commands and their supporting code go into `src/commands/`, library
code the rest of the codebase reads goes into the subject folders at
`src/`.** A non-test file outside `src/commands/` holds no import whose
target is inside it — not static `import`, not `import type`, not
`export … from`, and not dynamic `import()`. This rule forces every
feature that more than one command might want into the library half
first, before a second command is even written. Library code every part
of rafa reads goes into `src/core/`, behind its barrels (Core and its
barrels, above).

**Two files are exempt by name:** `src/rafa.ts` (the bin entry, which
loads the command registry and dispatches on `process.argv`) and
`src/plan.ts` (the body of the `rafa plan create` command). Both are the
CLI's own layer, not library code. A sweep (`src/tests/commands-direction.sweep.test.ts`)
names every non-test import edge and fails when a library file brings in
the command half.

**Edge case: a reader so widely used that it lives in the commands
folder.** `src/commands/plan/plan-files.ts` is the command half of the
plan readers: the first command that needed them (`rafa plan create`)
wrote them there, and ten non-test files import it at this commit. Its
library half, the readings that take no command context, is
`src/core/plan/plan-files.ts`, which command modules reach through the
plan barrel. When a second command wants a reader, the reader moves to
the library half and the command file imports it from there. The sweep
reads the move with the list: a command file that exports its own library
half is a failure until the re-export is gone. Symbols imported from inside
`src/commands/` by test files are never swept; `classifyFile` of
`scripts/survey/files.ts` decides what a test is.

**Symbols take their subject folder from the import graph survey.** The
eight-cluster map in `docs/survey/cluster-map.json` decides the folder;
`docs/survey/cut-table.md` names each file's package, which confirms the
place before a task moves a symbol. A file with no mapping takes the
cluster most of its folder's mapped files hold; if a file's folder holds
no mapped file, the task extends the map with a new survey run.
