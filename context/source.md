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
  rather than in a neutral module: eighteen command modules import
  `../plan/plan-files.js`, and `src/commands/release/tag.ts` takes
  `versionTag` from `../pr/merge-followups.js` so two commands cannot
  spell one tag differently. Reach for the existing helper — a second
  spelling of a refusal is the real smell, as `release status`'s
  hand-rolled `Expected no arguments` is beside `plan-files.ts`'s shared
  `expectNoArgument`, which says `Expected no argument`.
- **Every `import type` line forms one `import/order` group**
  (`sharedRules.mjs`), and no short rule predicts its order: neither plain
  name order, "every sibling before every parent", nor path depth first,
  as this bullet read until 2026-09-24. `src/plan/risk.ts` spells
  `./parse.js`, `../config.js`, `./risk/accounts.js`,
  `../utils/declaration.js`, while `src/inventory/search/index.ts` puts
  `../record.js` after `../../utils/claude.js`. Take the order from
  `bunx eslint --fix-dry-run --format json <file>`, not from this page.
  Value imports differ: the `parent` group (`../`) comes before the
  `sibling` group (`./`), a blank line between them.
- **`tsconfig.json` sets `lib` to `ES2022`**, so an ES2023 method such as
  `Array.prototype.toSorted` fails `check-types` although bun runs it.
  Sort a copy with `[...array].sort()`.

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
  under bun and `TS2307` under tsc. Each package's
  `src/core-subpaths.test.ts` holds this, holds the map to the two
  subpaths as a closed list, and holds each entry equal to the root
  `exports`. A new subpath goes into both files and that list.
- **Which gates reach a package.** `bun run test` runs its tests.
  `bun run check-types` runs the root `tsc --noEmit`, whose `tsconfig.json`
  excludes `packages`, then `bun run --filter './packages/*' check-types`,
  each package's own `tsc --noEmit`; a package's `tsconfig.json`
  includes its test files. `bun run lint` reaches none of it:
  `eslint.config.mjs` ignores `packages/**`, and a package file linted
  with `--no-ignore` reports `import/no-unresolved` on both subpaths,
  because `eslint.base.mjs`'s resolver reads only the root
  `tsconfig.json`.

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

**A new key in `SETTINGS` reaches six files beyond the schema, sections
and `init` scaffold.** `RafaConfig` literals have to be complete, so the
layer literal in `src/config.ts` needs it. `src/config-schema.test.ts`
pins the key set as closed lists (`KEYS`, `TOP`, `SECTIONS`,
`knownKeysAbove`). Both config suites also check
that every setting appears exactly once: `src/config.test.ts` (`SETTINGS`,
`DEFAULTS`, `FULL`, `FULL_VALUES`, its cases and `KNOWN`) and
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
files hold. If a file's folder holds no mapped file, the sweep fails,
naming the file and that you must extend the map with a new survey run.
The sweep prints the file coverage line and a count of files placed by
folder majority.

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
cycle in place. Once `#905`'s shared-contract move cuts the code into
packages, the sweep reads packages instead of clusters.
