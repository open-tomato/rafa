/**
 * Tests for the package's published shape: the `bin`, `exports`, `files`,
 * `private`, `publishConfig`, `engines` and `module` fields of
 * `package.json`, the dependency keys it does NOT carry, and the `build`
 * script that writes what those fields name.
 *
 * Each of those fields is spelled HERE, as the phase 0 spec gives the
 * first three and phase 1's publishing stage the rest, so a target
 * renamed in the manifest fails a case instead of agreeing with
 * itself. Every other case reads a build: the suite copies the package
 * (its manifest and lockfile, its tsconfig files, the README, `src/`,
 * core's workspace package `packages/rafa/` and the tsconfig base's
 * `packages/typescript-config/`) into a scratch directory and runs
 * `bun run build` there,
 * the script as the manifest holds it, so nothing is written into the
 * repository's own `dist/`.
 *
 * The manifest declares no `sideEffects` field, and every build this file
 * reads was taken without one: under `"sideEffects": false` bun 1.3.14's
 * `--splitting` build wrote library entries that failed to parse, so the
 * field went and #1213 keeps the goal of declaring it again. The entries
 * call their composition roots, `registerCoreConfigSections` and
 * `registerCoreAdapters`, either way, so they hold under the field too.
 *
 * ## What each clause of the build script is for
 *
 * Each clause answers a reading taken on bun 1.3.14:
 *
 *   - `rm -rf dist` runs first. A chunk is named by its content hash, so
 *     a rebuild after a change writes a new chunk and leaves the old one
 *     in place: measured, `index-whheyr7c.js` survived beside its
 *     successor `index-vt2jdjxh.js`, and `files` would have published
 *     both. An unused export appended to a module changed no chunk at
 *     all, which is why that reading was taken on a change the bundle
 *     keeps.
 *   - `src/rafa.ts` is built on its own, with `--outfile=dist/cli.js`.
 *     The build keeps the dispatcher's `#!/usr/bin/env bun` line and
 *     writes the file executable, which is what lets `bin` point at it.
 *   - The six library entries are built together with `--splitting`.
 *     Without it each entry is a bundle of its own, and `parsePlan`,
 *     `parseReport`, `openSqliteStore` and `EFFORT_KEY_PROJECTIONS` were
 *     each a different value from `dist/index.js` than from their
 *     subpath's bundle, so `src/index.ts`'s rule that a subpath's names
 *     are the root's own bindings held in source only. With it, the
 *     shared code moves into chunks beside `index.js` and all four were
 *     identical. `--root=src` spells out where each entry lands: at its
 *     source's path under `dist/`.
 *   - `tsc -p packages/rafa/tsconfig.types.json` and then
 *     `tsc -p tsconfig.config-types.json` follow them and write the
 *     declarations of the `./config` subpath, the one entry whose types
 *     the manifest publishes; see "The config subpath's declarations".
 *   - `src/PROMPT.md`, `src/plan-prompt.md` and `src/epic-verify-prompt.md`
 *     are copied into `dist/`. `start.ts` and `plan.ts` find the first two
 *     beside themselves through `import.meta.url`, and a bundle inlining
 *     either module answers its OWN directory. The two built files reading
 *     `import.meta.url` are `cli.js` and `index.js`, both directly in
 *     `dist/`. `epic/verify-plan.ts` sits one directory below its prompt
 *     in a checkout, so it looks beside itself first and in its parent
 *     second, and a case resolves the prompt through `readVerifyPrompt`
 *     pointed at `dist/`. Dropping it from the `cp` was driven on
 *     2026-09-28, one run of this file, 57 pass before and 55 pass and 2
 *     fail under it (its copy case and that reader case), the manifest
 *     restored byte-identical (sha256).
 *   - `src/continue-decision-prompt.md` and `src/continue-criteria.md`,
 *     the `loop start --continue` contract and base criteria, are copied
 *     into `dist/` the same way, and `start/decision-prompt.ts` sits one
 *     directory below them in a checkout as `epic/verify-plan.ts` does,
 *     so a case resolves both through `readBundledFile` pointed at
 *     `dist/`.
 *   - `src/bundled/` is copied whole to `dist/bundled/`: the rafa tier,
 *     its skills and agents, which sits beside the entry in both a
 *     checkout and a build (`packages/rafa/src/schema/tiers.ts`). The dev-planner skill
 *     in it is the plan format `buildPlanPrompt` inlines into the plan
 *     prompt, read at `bundled/skills/dev-planner/SKILL.md` under the
 *     module's directory, and a project running an installed rafa
 *     carries no copy of its own. The copy is whole, not `*.md`, because
 *     a skill is a directory that may hold more than its `SKILL.md`, and
 *     a case holds `dist/bundled/` to exactly the files `src/bundled/`
 *     holds, byte for byte, plus the one program built into it below, so
 *     a stray file in either is seen.
 *   - `src/tools/ts-symbols/cli.ts` is built to `dist/bundled/bin/ts-symbols`,
 *     the rafa tier's `bin`. Like `cli.js`, the build keeps the
 *     `#!/usr/bin/env bun` line and writes the file executable, so it
 *     runs by path. The clause comes AFTER the tier copy: with
 *     `dist/bundled/` already there, `cp -R src/bundled dist/bundled`
 *     copies into it, as `dist/bundled/bundled/`. Its `typescript` is
 *     the project's, found from the working directory (see the module),
 *     so the bundle carries no copy of its own.
 *
 * ## The template cases
 *
 * Copying the templates is held by behaviour as well as by bytes: `rafa
 * plan` runs from the build in a scratch repository, under a PATH holding
 * git and a stand-in `claude` that keeps the prompt and the arguments it is
 * handed, and that prompt is held equal to what `buildPlanPrompt` makes of the source
 * template and the source skill, with the skill index `readPlanSkillIndex`
 * reads for the scratch repository over the source rafa tier, which the
 * build's `bundled/` copies byte for byte. It runs four times: through
 * `dist/cli.js` and twice through the root bundle's `planCommand`, all
 * inside the scratch package, and through a copy of the build outside
 * the package. Two controls run the same command from a copy of the build
 * outside the package, one without `plan-prompt.md` and one without
 * `bundled/skills/dev-planner/SKILL.md`, and each refuses before any
 * session starts, so the check can see a template that is not there.
 *
 * The prompt names the plan by absolute path under the planner's root,
 * and the two entries hand the planner different roots. `dist/cli.js`
 * hands it the project the dispatcher resolved, a real path, and
 * `planCommand` the root its caller typed, resolved absolute with no
 * symlink followed. The two are one string on a Linux runner and two on
 * macOS, where the temporary directory is `/var/...` and its real path
 * `/private/var/...`. So each case names the root its entry runs on, and
 * one more hands `planCommand` the scratch repository through a symlink
 * and holds the prompt to the link, which is red on every platform when
 * the expected prompt is built from the real path.
 *
 * The `dist/cli.js` run also holds the session's argument list to the
 * base arguments and `--setting-sources project,local`, the sources a run
 * with no config resolves to. Its control runs under a user-scope config
 * naming `local,user` and holds those instead, and a config whose sources
 * the loop refuses stops the command before the stand-in is reached.
 *
 * ## The asset-tree clause
 *
 * The two templates above are named files; the pinned resolve plans
 * and the board templates are DIRECTORIES, so the build script ends with
 * a loop over a table of `<source under src>:<name under dist>` pairs.
 * Three readings shape it:
 *
 *   - It copies `*.md` and `*.yml` and nothing else. `src/pr/plans/`
 *     holds `load.ts` and `load.test.ts` beside the four plans, and
 *     copying the directory whole would publish both, since `files`
 *     publishes all of `dist`. A case reads `dist/plans` for a `.ts`
 *     file and names the two source modules that would land there.
 *     The `*.yml` copy is for the epic guard workflow
 *     `src/board/templates/epic-guard.yml`, and a case resolves it
 *     through `readEpicGuard` pointed at `dist/`. Unlike `*.md`, a tree
 *     holding no YAML is not a failure: the `[ -e ]` guard skips the
 *     unmatched pattern, since `src/pr/plans/` carries none.
 *   - A tree lands DIRECTLY under `dist/`, as `dist/plans` and
 *     `dist/templates`, not at its source path. A bundle reading
 *     `import.meta.url` answers its own directory, which is `dist/` for
 *     `cli.js`, so `src/pr/plans/load.ts`'s first candidate is
 *     `<moduleDir>/plans/<name>.md`; `PINNED_PLANS_DIRNAME` is that
 *     name, and a case resolves every pinned plan through
 *     `readPinnedPlan` pointed at `dist/` rather than only comparing
 *     bytes.
 *   - A tree that is not there is SKIPPED, and a tree that is there
 *     with no markdown in it fails the build, whatever YAML it holds. `src/board/templates/`
 *     now carries `spec.md`, the spec issue template, and carried no
 *     tracked file when the clause was written: `cp
 *     src/board/templates/*.md` against an absent directory would have
 *     stopped the build, and the guard is what the next empty tree
 *     needs too. Measured
 *     on bun 1.3.14, in a probe package carrying this clause alone:
 *     with the directory absent, the `[ -d ]` guard skipped it and the
 *     run exited 0; with it present and holding no markdown, the `cp`
 *     matched nothing and the run exited 1. So the skip cannot hide a
 *     tree that is there and ships nothing.
 *
 * That last reading is why the board tree's case reads a PLANTED file:
 * `beforeAll` writes {@link PLANTED_BOARD_TEMPLATE} into the scratch
 * package's `src/board/templates/` before the build runs, and it was
 * how the clause was read on a tree with a file in it while this
 * repository carried none. It is kept now that `spec.md` is tracked,
 * since it is the one file in either tree whose presence the case
 * itself guarantees: both tree cases list whatever markdown the scratch
 * package's source tree holds — the real template included — and hold
 * the copy to it byte for byte.
 *
 * Three mutations of the clause were driven on 2026-09-19, one run of
 * this file each, 44 pass before and after and the manifest restored
 * byte-identical (sha256). Dropping the whole loop reddened all five
 * cases below, 39 pass and 5 fail. Dropping only
 * `board/templates:templates` reddened the board tree case and the
 * planted-file case, 2 of 44, and left the plan cases green, so the two
 * table rows are read apart. Copying `*` instead of `*.md` reddened the
 * TypeScript case and the `src/pr/plans` tree case, whose file list no
 * longer matched the markdown it lists, again 2 of 44. When the `*.yml`
 * copy joined the clause, dropping it was driven on 2026-09-27 the same
 * way: 55 pass before, and 53 pass and 2 fail under it — the board tree
 * case and the epic guard case — with the plan cases green.
 *
 * ## The describe case
 *
 * `rafa describe` stamps its document with the `version` of
 * `package.json`, which `src/commands/describe.ts` imports by name. The
 * case runs it from a copy of the build outside the scratch package,
 * where no `package.json` sits above the bundle, and holds its output to
 * what `src/rafa.ts` prints and its version to the manifest's. So the
 * version is the one `bun build` inlined, and nothing beside the bundle
 * is read for it.
 *
 * Two mutations of `src/commands/describe.ts` were driven on 2026-09-14,
 * one run of this file each, with the module restored byte-identical
 * (sha256). A version other than the manifest's reddened this case alone.
 * The version read at run time from the `package.json` beside the module
 * reddened every case running the built CLI, 9 of 31 and this one among
 * them: the bundle reads that file when it is imported, and the build has
 * none there.
 *
 * ## The names phase 1 adds
 *
 * The preflight and the PREREQUISITES parser joined `./plan` in phase 1,
 * and scope resolution, the adapter registry and the manifest validator
 * joined the root beside the config resolver it already carried. Those
 * names are spelled here too, so a bundle that lost one fails a case
 * naming it, where the computed case above compares a bundle with a
 * source that could have lost it as well. The root bundle's
 * `PORT_VERSIONS` is held to the source's, its `RUNNING_MANIFEST_SEAMS`
 * to the manifest's `version`, which `src/modules/manifest.ts` imports
 * from `package.json` as `describe` does, and its built `resolveScope`
 * and `validateManifest` are run once each.
 *
 * `README.md` says only `./plan`, `./ports`, `./learning` and `./config`
 * load under node; `./learning` is read below, in its own section, and
 * `./config` in the config subpath's cases. The
 * preflight brought `Bun.spawn`, `Bun.which` and `Bun.file` calls into
 * `./plan`, so one case imports `dist/plan/index.js` under node and holds
 * its names to its source's. It imports `dist/index.js` the same way as
 * its control, which node refuses at `bun:sqlite`. The case needs `node`
 * on the suite's PATH, and fails naming it when there is none.
 *
 * Driven on 2026-09-15 with node 22.14.0, one run each over this file,
 * `src/index.test.ts` and `src/plan/index.test.ts`, with 161 pass before
 * and after and every file restored byte-identical (sha256).
 * `resolveScope` dropped from the root reddened the root names case, and
 * so did `CORE_ADAPTER_REGISTRY` dropped. A bare `import 'bun:sqlite';`
 * added to `src/plan/index.ts` left every case green, the node case
 * among them. It is no control: in a scratch build under that mutation,
 * the import landed in `cli.js` and the chunk `index-qebmbvjb.js`, not
 * in `dist/plan/index.js`, and node loaded that entry's twenty names.
 * `Database` re-exported from `bun:sqlite` there instead reddened the
 * node case, which is the control that it can fail.
 *
 * ## The learning subpath, by the package's name
 *
 * `./learning` joined the exports map and the build's entry list
 * together, for the library under `src/learning/`. The computed cases
 * above read it by path, as `dist/learning/index.js`; two more import it
 * as a consumer does, by `@open-tomato/rafa/learning`, from a scratch
 * directory whose `node_modules/@open-tomato/rafa` links to the scratch
 * package, so the name resolves through the manifest's own exports map.
 * One imports it under bun and holds its names to the source entry's and
 * its `actionHash` to the source's answer; the other does the same under
 * node, which is what lets `README.md` name `./learning` among the
 * subpaths that load there: the library needs only `node:crypto`. Both
 * import `@open-tomato/rafa/unmapped` from the same directory first, as
 * the control that a name the map does not carry is refused, so the
 * link is not what makes the import pass.
 *
 * Two mutations of `package.json` were driven on 2026-09-25 with bun
 * 1.3.14 and node 22.14.0, one run of this file each, 54 pass before and
 * after and the manifest restored byte-identical (sha256). Dropping the
 * `./learning` exports entry reddened 3 of 54: the exports map case and
 * both name cases. Dropping `src/learning/index.ts` from the build's
 * entry list reddened 5 of 54: the exports-target case, the two computed
 * `dist/learning/index.js` cases and both name cases.
 *
 * ## The publishing fields phase 1 sets
 *
 * `private: false` with `publishConfig.access: public` is what lets the
 * scoped name reach the registry at all; npm defaults a scoped package to
 * a restricted publish, so the access is spelled out rather than left to
 * the default. `engines` names `bun` alone, against a build that targets
 * bun: the phase 0 manifest declared `engines.node >= 22`, which no
 * reading supported, since the root, `./cli` and `./store` never load
 * under node. `module` moved off `index.ts`, a `console.log` placeholder
 * `bun init` had left at the repository root and `files` never published,
 * onto `./dist/index.js`, the root of the exports map; the case holds the
 * two equal and finds the file in the build, so a `module` naming an
 * entry the build does not write cannot pass.
 *
 * The dependency case reads absence, so it names every key an install
 * would resolve from, not just the two the manifest once carried, and it
 * asserts `devDependencies` is non-empty beside them: a manifest that
 * failed to parse into an object would otherwise satisfy it. What the
 * absence buys was measured on npm 11.1.0, outside this suite, on two
 * probe tarballs differing in that one key: with
 * `peerDependencies: {typescript: ^5}`, `npm install --offline` against
 * an empty cache exited 1 with `npm error code ENOTCACHED` on
 * `https://registry.npmjs.org/typescript` and left `node_modules` empty,
 * and without it the same install exited 0. Against a warm cache the
 * peer-carrying tarball installed 2 packages where the other installed
 * 1, so npm resolves a peer dependency as a real install rather than a
 * hint.
 *
 * The README case reads the install section that ships in the tarball —
 * `files` publishes only `dist`, but npm packs `README.md` regardless,
 * which the pack case above pins. It builds both commands from the
 * manifest's own `name`, so renaming the package reddens it too.
 *
 * ## The config library, folded in
 *
 * `@open-tomato/define-config` is a devDependency, pinned at `0.5.0`, that
 * `bun build` folds into the bundles, so the published manifest still
 * declares no runtime dependency. Three cases hold that: the manifest
 * `bun pm pack` writes into the tarball carries no `dependencies` (or an
 * empty one), `dist/cli.js` carries no `import`, `from` or `require` of
 * the package, and a copy of the build where no `node_modules` sits at
 * or above it answers `--version`, exit 0. A fourth builds a probe that
 * calls `defineConfig` twice: left external, the bundle carries
 * `from "@open-tomato/define-config"` and the matcher sees it; folded in,
 * the bundle carries `function defineConfig(` and no load.
 *
 * The `--version` run passes `--no-install`. Measured on bun 1.3.14:
 * with no `node_modules` found, bun auto-installs a package the script
 * imports, so a probe importing the library from an empty directory
 * printed `function`, exit 0, and the same probe under `--no-install`
 * exited 1 with `Cannot find module '@open-tomato/define-config'`.
 *
 * Driven on 2026-10-14, one run of this file each, 66 pass before and after,
 * with `package.json` and `src/rafa.ts` restored byte-identical (sha256).
 * `dependencies` naming the library reddened 2 of 66: the pack case and
 * the absence case above. `src/rafa.ts` importing the library with the
 * CLI built `--external` to it reddened 1 of 66 without `--no-install`
 * (the matcher case), and 2 of 66 with it, the `--version` run among
 * them. The same import with no `--external` stopped the build itself,
 * 55 of 66: the scratch package copies no `node_modules`, so its build
 * cannot resolve the library until it is given one.
 *
 * It is given one now. `packages/rafa/src/core/config/config-load.ts` imports
 * `createLoader` by value, so the scratch package's `node_modules` links
 * the library the repository installed, as the probe's directory does;
 * without the link the build exits 1 on `Could not resolve:
 * "@open-tomato/define-config"`, measured when that import landed. The
 * `--version` copy sits beside the package, not under it, so no
 * `node_modules` is at or above it still.
 *
 * The four packages, and the `tsc` the two type-check cases run, are
 * linked as bun resolves them from the checkout (`Bun.resolveSync` of the
 * package's `package.json` from `REPO_ROOT`), not as
 * `REPO_ROOT/node_modules/<name>`. A linked worktree with no
 * `node_modules` of its own (a loop's, under `.rafa/worktrees/`) finds the
 * main checkout's that way. Measured on 2026-10-16 on bun 1.3.14, the
 * fixed path made `beforeAll` fail with ENOENT in such a worktree, the
 * failure of #1124's three reports.
 *
 * ## The config subpath's declarations
 *
 * `./config` is the exports entry carrying both conditions: `types` at
 * `dist/config/index.d.ts`, and `import` at `dist/config/index.js`, which
 * the `--splitting` build writes beside the other entries. The
 * declarations come from two `tsc` passes, since one program over the
 * root's `src/` and core's `packages/rafa/src/` would write every
 * declaration under `dist/src/` and `dist/packages/`. The first,
 * `tsc -p packages/rafa/tsconfig.types.json`, writes the declarations of
 * the core files the root's config files import, from core's own
 * `src/` into the root's `dist/`. The second,
 * `tsc -p tsconfig.config-types.json`, includes `src/config/index.ts`
 * alone, with `rootDir: src` and a `paths` map sending each
 * `@open-tomato/rafa/` subpath to the declaration the first pass wrote,
 * so it writes none of core's. The emitted declarations keep those bare
 * specifiers, and a consumer resolves each through the manifest's
 * `exports`: a `types`-only entry for each core subpath they name, at the
 * declaration already under `dist/` (#1090). The `dist/` file list is
 * held to the one a build before the move wrote, chunk hashes set aside
 * (`fixtures/dist-files-c920603.txt`): `c920603` is stretch 9's head
 * before it merged the move, which differs from `ec376a8`'s list only by
 * #991's declarations (`bugs/fenced.d.ts` added, four `triage/` ones no
 * longer reached).
 *
 * `tsc` writes a declaration for every file of its program, and the
 * program is every file the entry reaches in source, value imports
 * included: through `src/config-registry.ts` that is the sections, core
 * and the effort store, 121 files measured on 2026-10-14 with
 * typescript 5.9.3. Eleven of them import a specifier outside rafa:
 * nine `bun:sqlite` (the store's modules), `core/command/confirm.d.ts`
 * `node:stream`, and `core/config/standard-schema.d.ts`
 * `@open-tomato/define-config`. None of the eleven is reached from
 * `dist/config/index.d.ts`, whose own reach was 16 files, so a consumer
 * type-checking a `rafa.config.ts` loads none of them. The case reads
 * that reach: it follows every relative specifier from the types target
 * through the emitted files (`ts.preProcessFile`, so a specifier inside a
 * comment is not read as one), and every `@open-tomato/rafa/` specifier
 * through the manifest's `exports` to its declaration, and holds every
 * other specifier, a `node:` or `bun:` builtin and
 * `@open-tomato/define-config` alike, to none. A declaration under `dist/` that the types target does not reach
 * is out of the check: the subpath's promise is that its declaration
 * imports nothing outside rafa, and the eleven above stay where `tsc`
 * wrote them. The case's control plants a static `import type` of the
 * library and an `import('bun:sqlite')` type into a copy of two reached
 * declarations, one two hops from the entry, and reads both back.
 *
 * The scratch package links `typescript`, `@types/bun` and `@types/node`
 * as the repository installed them, and `node_modules/.bin/tsc`, which
 * `bun run` puts on the script's PATH. Without the `tsc` link the build
 * exited 127 on `tsc: command not found`, and with it but without the
 * two `@types` links it exited 2 on 151 errors, the first
 * `Cannot find module 'node:async_hooks'`, both measured on 2026-10-14.
 *
 * Both declaration passes, and the root's `tsconfig.packages.json`, extend
 * `@open-tomato/rafa-typescript-config/base`, a workspace package `tsc`
 * resolves through `node_modules`. The scratch package copies
 * `packages/typescript-config` and links it under its name as `bun install`
 * does, a relative link to the copy. Without the link the first `tsc` pass
 * exits 1 on TS6053, the base file not found, and 36 of this file's 77
 * cases failed, measured on 2026-10-15 with typescript 5.9.3.
 *
 * Three mutations of `package.json` were driven on 2026-10-14, one run
 * of this file each, with the manifest restored byte-identical (sha256).
 * Dropping the `./config` exports entry reddened the exports map case
 * alone, 1 of 72, before the node case joined. With it, 73 pass before
 * and after: dropping the `tsc` step reddened 4 of 73, the
 * exports-target case and the three declaration cases, and dropping
 * `src/config/index.ts` from the entry list reddened 5 of 73, the
 * exports-target case, the two computed `dist/config/index.js` cases,
 * the defaults case and the node case.
 *
 * ## How the cases were shown to fail
 *
 * Eight mutations of `package.json` were driven against this file, one
 * run each, with the unmutated manifest green before and after them and
 * restored byte-identical. Seven reddened at least one case: `--splitting`
 * dropped (the two binding cases), `rm -rf dist` dropped (the stale chunk
 * case), the template copy dropped (re-measured below), `bin` renamed,
 * the ports entry dropped from the build, the CLI built from
 * `src/index.ts`, and `files` widened to `src`. The eighth, `--root=src`
 * dropped, is equivalent: bun's default root for these four entries is
 * their common directory, `src`, and every case stayed green.
 *
 * When the skill moved into the rafa tier, two mutations were driven
 * on 2026-09-24, one run each, with the files restored byte-identical
 * (sha256). Dropping `cp -R src/bundled dist/bundled` from the manifest
 * reddened 6 of 45 here: the tier case, the four `rafa plan` runs and
 * the skill control, whose file to remove was never written. No run
 * inside the scratch package stays green on it any more, since
 * `readPlanFormat` has no fallback to a copy above `dist/`. Pointing
 * `planFormatPath` back at the checkout's
 * `.claude/skills/dev-planner/SKILL.md` reddened the same four runs and
 * the control here, the source case in `plan-format-source.test.ts` and
 * the four `readPlanFormat` cases in `plan-and-schedule.test.ts`, 10 of
 * 101 across those files and `src/plan.test.ts`: the tier copy carries
 * a `provenance` line the `.claude` one does not.
 *
 * When ts-symbols joined the build, two mutations of its clause were
 * driven on 2026-09-24, one run of this file each, 48 pass before and
 * after and the manifest restored byte-identical (sha256). Dropping it
 * reddened 4 of 48: the tier case and the three ts-symbols cases.
 * Moving it before the tier copy reddened 6 of 48, the tier case and the
 * five cases reading the dev-planner skill from the build, which the copy
 * had written under `dist/bundled/bundled/`.
 *
 * `check-types` skips this file. Checked through a tsconfig outside the
 * repo, it compiled clean, and a planted TS2322 in a second file of the
 * same program was reported.
 */
import type { ScratchPaths } from './cli-capture.js';

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import ts from 'typescript';

import { loadConfig } from '@open-tomato/rafa/core/config/load';
import * as portsSource from '@open-tomato/rafa/ports';
import * as storeSource from '@open-tomato/rafa/store';

import { EPIC_GUARD_FILE, readEpicGuard } from '../board/epic-guard.js';
import * as configSource from '../config/index.js';
import { readVerifyPrompt, VERIFY_PROMPT_FILE } from '../epic/verify-plan.js';
import * as rootSource from '../index.js';
import * as learningSource from '../learning/index.js';
import * as planSource from '../plan/index.js';
import { buildPlanPrompt, planFormatPath, readPlanSkillIndex } from '../plan.js';
import { PINNED_PLAN_CLASSES, pinnedPlanFileName, readPinnedPlan } from '../pr/plans/load.js';
import { CONTINUE_CRITERIA_FILE, DECISION_PROMPT_FILE, readBundledFile } from '../start/decision-prompt.js';

import { eventsOf, expectExit, plantProjectConfig } from './cli-capture.js';
import { scratchHomeEnv } from './scratch-home-env.js';
import { hostToolDirs } from './stand-in-gh.js';

/** The repository root: this file sits in `src/tests/`. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * The binary the manifest maps, spelled as npm writes a `bin` target:
 * with no leading `./`. `npm publish` cleans a target that carries one
 * and warns that it corrected the manifest (measured on npm 11.1.0).
 */
const BIN = { rafa: 'dist/cli.js' };

/**
 * The exports map the manifest carries, as the phase 0 spec gives it, and
 * a `types`-only entry for each core subpath the emitted declarations name
 * (#1090), at the declaration the build writes under `dist/`.
 */
const EXPORTS = {
  '.': './dist/index.js',
  './cli': './dist/cli.js',
  './plan': './dist/plan/index.js',
  './store': './dist/effort/store/index.js',
  './ports': './dist/ports/index.js',
  './learning': './dist/learning/index.js',
  './config': {
    types: './dist/config/index.d.ts',
    import: './dist/config/index.js',
  },
  './core/config': { types: './dist/core/config/index.d.ts' },
  './core/config/config-schema': { types: './dist/core/config/config-schema.d.ts' },
  './core/config/sections': { types: './dist/core/config/sections.d.ts' },
  './ports/log-level': { types: './dist/ports/log-level.d.ts' },
  './report/parse': { types: './dist/report/parse.d.ts' },
  './store/check-rows': { types: './dist/effort/store/check-rows.d.ts' },
};

/** The prefix of a specifier that names one of the package's own subpaths. */
const OWN_SUBPATH = '@open-tomato/rafa/';

/**
 * The `dist/` file list a build at `c920603`, before core moved into its package, wrote: one path a line.
 * It follows the build since: six lines from `7306b06` (`config-schema-features.d.ts`,
 * `core/command/lazy.d.ts`, three `index-<hash>.js` and `ready-<hash>.js`).
 */
const DIST_FILES_BEFORE_MOVE = 'fixtures/dist-files-c920603.txt';

/** A chunk the `--splitting` build names by its content hash, directly in `dist/`. */
const HASHED_CHUNK = /^([^/]+)-[a-z0-9]{8}\.js$/;

/** The declaration the `./config` subpath publishes, under `dist/`. */
const CONFIG_TYPES = 'config/index.d.ts';

/** What the manifest publishes: the build, and the NOTICE the licence asks to travel with it (npm adds LICENSE and README by itself). */
const FILES = ['dist', 'NOTICE'];

/** The public registry. */
const NPMJS = 'https://registry.npmjs.org/';

/**
 * How the manifest publishes: a scoped name needs the access spelled
 * out, and the registry is named TWICE. A machine's npm config may map
 * the scope to a private registry (`@open-tomato:registry=...`), and for
 * a scoped package npm reads the scope's registry ahead of the general
 * one, so `registry` alone is ignored. Measured 2026-09-21 with
 * `npm publish --dry-run`: with `registry` only, "Publishing to" named
 * the private registry; with the scoped key beside it, npmjs.
 */
const PUBLISH_CONFIG = {
  access: 'public',
  registry: NPMJS,
  '@open-tomato:registry': NPMJS,
};

/** The engine the build targets, and the only one the manifest names. */
const ENGINES = { bun: '>=1.3.14' };

/** The manifest's `module`: the root of the exports map, which the build writes. */
const MODULE = './dist/index.js';

/**
 * Every manifest key an install would resolve packages from. All are
 * absent, which is what lets a packed tarball install with no registry
 * access: measured on npm 11.1.0, a probe tarball carrying only
 * `peerDependencies: {typescript: ^5}` failed `npm install --offline`
 * against an empty cache with `ENOTCACHED` on
 * `https://registry.npmjs.org/typescript` and installed nothing, where
 * the same tarball without that key installed offline, exit 0.
 */
const DEPENDENCY_KEYS = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
  'bundleDependencies',
  'bundledDependencies',
];

/** The config library the build folds into its bundles, and the version the manifest pins it at. */
const DEFINE_CONFIG = '@open-tomato/define-config';
const DEFINE_CONFIG_VERSION = '0.5.0';

/**
 * Each form a bundle can load {@link DEFINE_CONFIG} by at run time: a
 * static `import ... from`, a bare `import '...'`, a dynamic `import()`
 * and a `require()`, each with or without a subpath. A literal naming the
 * package anywhere else, such as in a message, is not a load.
 */
const DEFINE_CONFIG_LOADS = [
  /\bfrom\s*['"`]@open-tomato\/define-config(?:\/[^'"`]*)?['"`]/g,
  /\bimport\s*['"`]@open-tomato\/define-config(?:\/[^'"`]*)?['"`]/g,
  /\b(?:import|require)\s*\(\s*['"`]@open-tomato\/define-config(?:\/[^'"`]*)?['"`]\s*\)/g,
];

/** The rafa tier in a checkout, from the repository root, and where the build copies it under `dist/`. */
const BUNDLED = ['src/bundled', 'bundled'] as const;

/** The ts-symbols program: its source, from the repository root, and where the build writes it under `dist/`. */
const TS_SYMBOLS = ['src/tools/ts-symbols/cli.ts', 'bundled/bin/ts-symbols'] as const;

/** The ts-symbols runs held to the source's answer: neither needs a `typescript` package. */
const TS_SYMBOLS_RUNS: [string, string[]][] = [['`help`', ['help']], ['no arguments', []]];

/** The dev-planner skill under the tier: the plan format. */
const PLAN_FORMAT_IN_TIER = 'bundled/skills/dev-planner/SKILL.md';

/** The dev-planner skill, from the repository root. */
const SKILL = `src/${PLAN_FORMAT_IN_TIER}`;

/** The files the scratch copy of the package takes besides `src/`. */
const PACKAGE_FILES = [
  'package.json',
  // `bun pm pack` resolves the `workspace:*` devDependency on core's package through the lockfile.
  'bun.lock',
  'tsconfig.json',
  'tsconfig.packages.json',
  'tsconfig.config-types.json',
  'README.md',
];

/** Core's workspace package, which the build reads core's source and first declarations pass from. */
const CORE_PACKAGE_DIR = 'packages/rafa';

/** The workspace package holding the tsconfig base every tsconfig extends: its directory and its name. */
const TYPESCRIPT_CONFIG = ['packages/typescript-config', '@open-tomato/rafa-typescript-config'] as const;

/** The installed packages the declaration step reads, linked into the scratch package; see the module note. */
const TYPESCRIPT_PACKAGES = ['typescript', '@types/bun', '@types/node'];

/** Each library entry: its path under `dist/`, and its source module. */
const LIBRARY_ENTRIES: [string, Record<string, unknown>][] = [
  ['index.js', rootSource],
  ['plan/index.js', planSource],
  ['effort/store/index.js', storeSource],
  ['ports/index.js', portsSource],
  ['learning/index.js', learningSource],
  ['config/index.js', configSource],
];

/** The subpath bundles whose every name the root bundle carries too. */
const CONTAINED_SUBPATHS = ['plan/index.js', 'effort/store/index.js'];

/**
 * The names phase 1 adds to the `./plan` entry, the preflight and the
 * PREREQUISITES parser, which the root bundle carries too.
 */
const PLAN_PREFLIGHT_NAMES = [
  'PROBE_TIMEOUT_MS',
  'loadPlanPrerequisites',
  'mergePlanPrerequisites',
  'parsePrerequisites',
  'planPrerequisites',
  'prerequisitesPathForPlan',
  'runPreflight',
  'runShellProbe',
];

/**
 * The names phase 1 adds to the root alone, scope resolution, the adapter
 * registry and the manifest validator, with the config resolver the root
 * already carried.
 */
const ROOT_SEAM_NAMES = [
  'CORE_ADAPTER_REGISTRY',
  'DISK_FILE_SYSTEM',
  'FEATURE_TYPES',
  'INIT_COMMAND',
  'MANIFEST_VERSION',
  'OUTPUT_CHANNELS',
  'PORT_VERSIONS',
  'RUNNING_MANIFEST_SEAMS',
  'SCOPE_DIR',
  'ScopeError',
  'createAdapterRegistry',
  'initHint',
  'loadConfig',
  'resolveConfig',
  'resolveScope',
  'scopeAt',
  'selfAndAncestors',
  'validateManifest',
];

/**
 * The templates the build copies beside its bundles: each one's source,
 * from the repository root, and its name in `dist/`.
 */
const TEMPLATES: [string, string][] = [
  ['src/PROMPT.md', 'PROMPT.md'],
  ['src/plan-prompt.md', 'plan-prompt.md'],
  ['src/epic-verify-prompt.md', 'epic-verify-prompt.md'],
  ['src/continue-decision-prompt.md', 'continue-decision-prompt.md'],
  ['src/continue-criteria.md', 'continue-criteria.md'],
];

/**
 * The asset trees the build copies whole: each one’s directory under the
 * package root, and the directory it lands in under `dist/`. See the module
 * note on the clause.
 */
const ASSET_TREES: [string, string][] = [
  ['src/pr/plans', 'plans'],
  ['src/board/templates', 'templates'],
];

/**
 * The board template planted into the scratch package before the build,
 * beside the tracked `spec.md`; see the module note on why it is kept.
 */
const PLANTED_BOARD_TEMPLATE = 'spec-probe.md';

/** What {@link PLANTED_BOARD_TEMPLATE} holds. */
const PLANTED_BOARD_BODY = '<!-- No local paths. -->\n\n# Spec: a copied board template\n';

/** What the asset-tree clause copies out of a tree; see the module note. */
const ASSET_EXTENSIONS = ['.md', '.yml'];

/** The modules sitting beside the pinned plans, which the build must not copy. */
const PLAN_READER_MODULES = ['load.ts', 'load.test.ts'];

/** The action the learning cases hash, with case and surrounding whitespace the hash ignores. */
const HASHED_ACTION = '  Run Bun Install First ';

/** The spec the template cases plan from, and what `rafa plan` is told. */
const SPEC = '# Spec: a build probe\n\nNothing to build.\n';
const PLAN_ARGS = ['--spec=spec.md', '--no-progress'];

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-build-'));

/** The scratch copy of the package the build runs in. */
const PACKAGE_DIR = join(tempRoot, 'package');

/** Where the build writes. */
const DIST = join(PACKAGE_DIR, 'dist');

/** A chunk planted in `dist/` before the build, which the build removes. */
const STALE_CHUNK = join(DIST, 'index-stale000.js');

/** What one command did. */
interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a command to its end. */
function run(
  command: readonly string[],
  cwd: string,
  env: Record<string, string | undefined>,
): CommandRun {
  const proc = Bun.spawnSync([...command], { cwd, env });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

/** This process's environment, with the running bun first on PATH. */
function withBunOnPath(): Record<string, string | undefined> {
  return {
    ...process.env,
    PATH: [dirname(process.execPath), process.env['PATH'] ?? ''].join(delimiter),
  };
}

let build: CommandRun;
let plantedBeforeBuild = false;

beforeAll(() => {
  mkdirSync(DIST, { recursive: true });
  for (const file of PACKAGE_FILES) cpSync(join(REPO_ROOT, file), join(PACKAGE_DIR, file));
  cpSync(join(REPO_ROOT, 'src'), join(PACKAGE_DIR, 'src'), { recursive: true });
  cpSync(join(REPO_ROOT, CORE_PACKAGE_DIR), join(PACKAGE_DIR, CORE_PACKAGE_DIR), { recursive: true });
  linkTypeScriptConfig(PACKAGE_DIR);
  linkDefineConfig(PACKAGE_DIR);
  linkTypeScript(PACKAGE_DIR);
  const boardTemplates = join(PACKAGE_DIR, 'src', 'board', 'templates');
  mkdirSync(boardTemplates, { recursive: true });
  writeFileSync(join(boardTemplates, PLANTED_BOARD_TEMPLATE), PLANTED_BOARD_BODY, 'utf8');
  writeFileSync(STALE_CHUNK, 'export const stale = true;\n', 'utf8');
  plantedBeforeBuild = existsSync(STALE_CHUNK);
  build = run([process.execPath, 'run', 'build'], PACKAGE_DIR, withBunOnPath());
}, 60_000);

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** The repository's manifest. */
function readManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;
}

/** Every load of {@link DEFINE_CONFIG} that `text` carries, in the order of {@link DEFINE_CONFIG_LOADS}. */
function defineConfigLoads(text: string): string[] {
  return DEFINE_CONFIG_LOADS.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0]));
}

/** The directory the repository installed the package `name` in, found as bun resolves it from {@link REPO_ROOT}. */
function installedDir(name: string): string {
  return realpathSync(dirname(Bun.resolveSync(`${name}/package.json`, REPO_ROOT)));
}

/** The `tsc` binary of the `typescript` the repository installed. */
function installedTsc(): string {
  return join(installedDir('typescript'), 'bin', 'tsc');
}

/** Links the package `name` as the repository installed it into `dir`'s `node_modules`. */
function linkInstalled(dir: string, name: string): void {
  mkdirSync(dirname(join(dir, 'node_modules', name)), { recursive: true });
  symlinkSync(installedDir(name), join(dir, 'node_modules', name), 'dir');
}

/** Links {@link DEFINE_CONFIG} as the repository installed it into `dir`'s `node_modules`. */
function linkDefineConfig(dir: string): void {
  linkInstalled(dir, DEFINE_CONFIG);
}

/** Copies {@link TYPESCRIPT_CONFIG} into `dir` and links it under its name, as `bun install` does. */
function linkTypeScriptConfig(dir: string): void {
  const [packageDir, name] = TYPESCRIPT_CONFIG;
  cpSync(join(REPO_ROOT, packageDir), join(dir, packageDir), { recursive: true });
  const link = join(dir, 'node_modules', name);
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(relative(dirname(link), join(dir, packageDir)), link, 'dir');
}

/** Links {@link TYPESCRIPT_PACKAGES} into `dir`'s `node_modules`, and `tsc` into its `.bin`. */
function linkTypeScript(dir: string): void {
  for (const name of TYPESCRIPT_PACKAGES) linkInstalled(dir, name);
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true });
  symlinkSync(join('..', 'typescript', 'bin', 'tsc'), join(dir, 'node_modules', '.bin', 'tsc'));
}

/** What {@link declarationReach} found from one declaration. */
interface DeclarationReach {
  /** Every declaration reached, relative to the root it was read under, sorted. */
  readonly reached: string[];
  /** Each specifier outside rafa, as `<declaration>: <specifier>`, sorted. */
  readonly outside: string[];
  /** Each relative specifier naming no emitted declaration, as `<declaration>: <specifier>`, sorted. */
  readonly missing: string[];
}

/**
 * The declaration under `dist/` a consumer reads for one of the package's
 * own subpaths, through {@link EXPORTS}: the `types` target of its entry,
 * or the `.d.ts` beside a bare target.
 *
 * @param specifier - A specifier opening with {@link OWN_SUBPATH}.
 * @returns Its path relative to `dist/`, or `undefined` when no entry names it.
 */
function exportedDeclaration(specifier: string): string | undefined {
  const entry: unknown = (EXPORTS as Record<string, unknown>)[`./${specifier.slice(OWN_SUBPATH.length)}`];
  const target = typeof entry === 'string'
    ? entry
    : (entry as { types?: string } | undefined)?.types;
  return target?.replace(/^\.\/dist\//, '').replace(/\.js$/, '.d.ts');
}

/**
 * Follows every relative specifier from `entry`, a declaration under
 * `root`, through the declarations beside it, and every specifier of the
 * package's own subpaths through {@link EXPORTS} to its declaration, and
 * names every other specifier: a package, a builtin, or a `/// <reference
 * types>`. A `declare module` of a subpath is followed as an import is.
 * See the module note.
 */
function declarationReach(root: string, entry: string): DeclarationReach {
  const reached = new Set<string>();
  const outside: string[] = [];
  const missing: string[] = [];
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (reached.has(file)) continue;
    reached.add(file);
    const read = ts.preProcessFile(readFileSync(join(root, file), 'utf8'), true, false);
    for (const { fileName } of read.typeReferenceDirectives) outside.push(`${file}: types ${fileName}`);
    const named = [...read.importedFiles.map(({ fileName }) => fileName), ...read.ambientExternalModules ?? []];
    for (const fileName of named) {
      if (fileName.startsWith(OWN_SUBPATH)) {
        const target = exportedDeclaration(fileName);
        if (target !== undefined && existsSync(join(root, target))) queue.push(target);
        else missing.push(`${file}: ${fileName}`);
        continue;
      }
      if (!fileName.startsWith('.')) {
        outside.push(`${file}: ${fileName}`);
        continue;
      }
      const target = relative(root, join(root, dirname(file), fileName.replace(/\.js$/, '.d.ts')));
      if (existsSync(join(root, target))) queue.push(target);
      else missing.push(`${file}: ${fileName}`);
    }
  }
  return { reached: [...reached].sort(), outside: outside.sort(), missing: missing.sort() };
}

/** Every target the binary and the exports map name, a condition's target included. */
function manifestTargets(): string[] {
  return [...Object.values(BIN), ...Object.values(EXPORTS)]
    .flatMap((target) => typeof target === 'string'
      ? [target]
      : Object.values(target));
}

/**
 * Builds a probe calling `defineConfig` to `out.js` under its own scratch
 * directory, whose `node_modules` links the package the repository
 * installed, with `external` naming the packages the build leaves to be
 * loaded at run time. Returns the bundle's text.
 */
function buildDefineConfigProbe(name: string, external: readonly string[]): string {
  const dir = join(tempRoot, `define-config-${name}`);
  mkdirSync(dir, { recursive: true });
  linkDefineConfig(dir);
  writeFileSync(join(dir, 'probe.ts'), [
    `import { defineConfig } from '${DEFINE_CONFIG}';`,
    'console.log(typeof defineConfig);',
    '',
  ].join('\n'), 'utf8');
  const flags = external.map((name) => `--external=${name}`);
  const built = run(
    [process.execPath, 'build', 'probe.ts', '--target=bun', '--outfile=out.js', ...flags],
    dir,
    withBunOnPath(),
  );
  expectExit(built, 0, { cwd: dir });
  return readFileSync(join(dir, 'out.js'), 'utf8');
}

/** `directory` and every directory above it that holds a `node_modules`. */
function nodeModulesAbove(directory: string): string[] {
  const found: string[] = [];
  for (let current = directory; ; current = dirname(current)) {
    if (existsSync(join(current, 'node_modules'))) found.push(current);
    if (dirname(current) === current) return found;
  }
}

/** Every file the build wrote, relative to `dist/`, sorted. */
function builtFiles(): string[] {
  return readdirSync(DIST, { recursive: true, encoding: 'utf8' })
    .filter((file) => statSync(join(DIST, file)).isFile())
    .sort();
}

/** A module of the build, imported into this process. */
async function importBuilt(path: string): Promise<Record<string, unknown>> {
  return await import(join(DIST, path)) as Record<string, unknown>;
}

/** What an import probe printed, and what its directory holds afterwards. */
interface ProbeRun extends CommandRun {
  readonly files: string[];
}

/**
 * Imports one module in a fresh process, from an empty directory of its
 * own, then prints the process's `SIGINT` and `SIGTERM` listener counts
 * and its exit code.
 */
function probeImport(modulePath: string): ProbeRun {
  const cwd = mkdtempSync(join(tempRoot, 'probe-'));
  writeFileSync(join(cwd, 'probe.ts'), [
    `await import(${JSON.stringify(modulePath)});`,
    'console.log(JSON.stringify([',
    '  process.listenerCount(\'SIGINT\'),',
    '  process.listenerCount(\'SIGTERM\'),',
    '  process.exitCode ?? null,',
    ']));',
    '',
  ].join('\n'), 'utf8');
  const probe = run([process.execPath, 'probe.ts'], cwd, process.env);
  return { ...probe, files: readdirSync(cwd).sort() };
}

/** Everything one `rafa plan` run lives in. */
interface PlanScratch {
  readonly root: string;
  /** The repository the command runs in. */
  readonly repo: string;
  /** Where the stand-in keeps the prompt it is handed, outside the repository. */
  readonly prompt: string;
  /** Where the stand-in keeps the arguments it is handed, one per line. */
  readonly args: string;
  /** The stand-in, then git, on PATH, and a HOME of its own. */
  readonly env: Record<string, string>;
}

/**
 * A scratch repository holding the spec, beside a stand-in `claude` that
 * keeps its prompt and exits 0 having written no plan.
 */
function plantPlanScratch(name: string): PlanScratch {
  const root = join(tempRoot, `plan-${name}`);
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  for (const dir of [repo, bin, home]) mkdirSync(dir, { recursive: true });

  const prompt = join(root, 'prompt.md');
  const args = join(root, 'args.txt');
  const claude = join(bin, 'claude');
  const keepArgs = `for arg in "$@"; do printf '%s\\n' "$arg"; done > '${args}'`;
  writeFileSync(claude, ['#!/bin/sh', keepArgs, `/bin/cat > '${prompt}'`, 'exit 0', ''].join('\n'), 'utf8');
  chmodSync(claude, 0o755);

  const init = Bun.spawnSync(['git', 'init', '-q', '.'], { cwd: repo });
  if (init.exitCode !== 0) throw new Error(`git init: ${init.stderr.toString()}`);
  writeFileSync(join(repo, 'spec.md'), SPEC, 'utf8');
  plantProjectConfig(repo);

  const git = Bun.which('git');
  if (git === null) throw new Error('git is not on the PATH this suite runs under');
  const path = [bin, ...hostToolDirs()].join(delimiter);
  const resolved = Bun.which('claude', { PATH: path });
  if (resolved !== claude) throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);

  return { root, repo, prompt, args, env: { TMPDIR: tmpdir(), PATH: path, ...scratchHomeEnv(home) } };
}

/** The paths of `scratch` a red plan run prints beside its streams. */
function planScratchPaths(scratch: PlanScratch): ScratchPaths {
  return { root: scratch.root, repo: scratch.repo, prompt: scratch.prompt, args: scratch.args };
}

/** The arguments the stand-in keeps for a plan session under `sources`, one per line. */
function planSessionArgs(sources: string): string {
  return ['-p', '--dangerously-skip-permissions', '--setting-sources', sources, ''].join('\n');
}

/** Writes `text` as the user scope's `.rafa/config.yaml` under the scratch HOME. */
function plantUserConfig(scratch: PlanScratch, text: string): void {
  const home = scratch.env['HOME'] ?? '';
  expect(home.startsWith(tempRoot)).toBe(true);
  mkdirSync(join(home, '.rafa'), { recursive: true });
  writeFileSync(join(home, '.rafa', 'config.yaml'), text, 'utf8');
}

/**
 * A copy of the build at `dist/` under a scratch root, outside the
 * scratch package, with `removed` taken out of it.
 */
function copyBuildOutsidePackage(scratch: PlanScratch, removed: string | null): string {
  const copy = join(scratch.root, 'dist');
  cpSync(DIST, copy, { recursive: true });
  if (removed !== null) rmSync(join(copy, removed));
  return copy;
}

/** Every file under `directory`, relative to it, sorted. */
function filesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((file) => statSync(join(directory, file)).isFile())
    .sort();
}

/**
 * The prompt `rafa plan` builds from the source template and skill for
 * {@link SPEC}, with the skill index read for `scratch` under the config
 * it resolves there, over the source rafa tier. The plans directory is
 * absolute, as the `claude` planner hands it to the builder: under
 * `root`, the root the planner was made with, as that root is spelled.
 * The planner resolves it absolute and follows no symlink, so the two
 * callers name different roots for one scratch repository wherever its
 * path holds a link, as every temporary directory does on macOS
 * (`/var` for `/private/var`): `rafa plan` runs on {@link dispatchedRoot},
 * and `planCommand` on the root its caller hands it.
 */
async function expectedPlanPrompt(scratch: PlanScratch, root: string): Promise<string> {
  const template = readFileSync(join(REPO_ROOT, 'src', 'plan-prompt.md'), 'utf8');
  const skill = readFileSync(join(REPO_ROOT, SKILL), 'utf8');
  const home = scratch.env['HOME'] ?? '';
  const { config } = await loadConfig({ root: scratch.repo, home });
  const index = readPlanSkillIndex(scratch.repo, home, config, join(REPO_ROOT, 'src', 'plan.ts'));
  const planDir = join(root, '.rafa', 'plans');
  return buildPlanPrompt(template, skill, SPEC, 'spec', planDir, undefined, undefined, index);
}

/**
 * The root `rafa plan` runs on when spawned in the scratch repository:
 * the project the dispatcher resolved, a real path with every symlink
 * followed (`src/project/scope.ts`).
 */
function dispatchedRoot(scratch: PlanScratch): string {
  return realpathSync(scratch.repo);
}

describe('the package manifest', () => {
  it('maps the rafa binary to the built CLI', () => {
    expect(readManifest()['bin']).toEqual(BIN);
  });

  it('maps the root and the six subpaths to their builds, the core subpaths the declarations name to their types, and nothing else', () => {
    expect(readManifest()['exports']).toEqual(EXPORTS);
  });

  it('publishes the build directory and nothing else', () => {
    expect(readManifest()['files']).toEqual(FILES);
  });

  it('is publishable, and publishes the scoped name publicly', () => {
    const manifest = readManifest();

    expect(manifest['private']).toBe(false);
    expect(manifest['publishConfig']).toEqual(PUBLISH_CONFIG);
    expect(String(manifest['name']).startsWith('@')).toBe(true);
  });

  it('names bun as its engine, and no node version', () => {
    expect(readManifest()['engines']).toEqual(ENGINES);
  });

  it('declares no sideEffects field, which bun 1.3.14\'s split build cannot take (#1213); the entries call the composition roots regardless', () => {
    expect('sideEffects' in readManifest()).toBe(false);
  });

  it('points module at the built root export, not at a source placeholder', () => {
    expect(readManifest()['module']).toBe(MODULE);
    expect(MODULE).toBe(EXPORTS['.']);
    expect(existsSync(join(PACKAGE_DIR, MODULE))).toBe(true);
  });

  it('declares no runtime dependency, so an install resolves nothing but the package', () => {
    const manifest = readManifest();

    expect(DEPENDENCY_KEYS.filter((key) => key in manifest)).toEqual([]);
    expect(Object.keys(manifest['devDependencies'] as Record<string, unknown>).length).toBeGreaterThan(0);
  });
});

describe('the config library, folded into the build', () => {
  it('is a devDependency at the version the plan pins, and the packed manifest declares no runtime dependency', () => {
    const destination = mkdtempSync(join(tempRoot, 'packed-'));
    const pack = run(
      [process.execPath, 'pm', 'pack', '--ignore-scripts', '--quiet', '--destination', destination],
      PACKAGE_DIR,
      withBunOnPath(),
    );
    const tarball = readdirSync(destination).find((file) => file.endsWith('.tgz')) ?? '';
    const extract = run(['tar', '-xzf', tarball, 'package/package.json'], destination, withBunOnPath());
    const packed = JSON.parse(readFileSync(join(destination, 'package', 'package.json'), 'utf8')) as Record<string, unknown>;
    const devDependencies = readManifest()['devDependencies'] as Record<string, unknown>;

    expectExit(pack, 0, { cwd: PACKAGE_DIR });
    expectExit(extract, 0, { cwd: destination });
    expect(devDependencies[DEFINE_CONFIG]).toBe(DEFINE_CONFIG_VERSION);
    expect(packed['name']).toBe(readManifest()['name']);
    expect(packed['dependencies'] ?? {}).toEqual({});
  }, 30_000);

  it('leaves dist/cli.js carrying no import or require of the library', () => {
    expect(defineConfigLoads(readFileSync(join(DIST, 'cli.js'), 'utf8'))).toEqual([]);
  });

  it('sees a load the build leaves external, and none once the build folds the library in', () => {
    const external = buildDefineConfigProbe('external', [DEFINE_CONFIG]);
    const folded = buildDefineConfigProbe('folded', []);

    expect(defineConfigLoads(external)).toEqual([`from "${DEFINE_CONFIG}"`]);
    expect(folded).toContain('function defineConfig(');
    expect(defineConfigLoads(folded)).toEqual([]);
  }, 30_000);

  it('answers --version from a copy of the build where no node_modules sits at or above it', () => {
    const copy = join(tempRoot, 'version-outside', 'dist');
    cpSync(DIST, copy, { recursive: true });
    const env = { TMPDIR: tmpdir(), PATH: withBunOnPath()['PATH'], ...scratchHomeEnv(tempRoot) };
    // `--no-install`: with no node_modules found, bun fetches a missing package by itself; see the module note.
    const version = run([process.execPath, '--no-install', 'cli.js', '--version'], copy, env);

    expect(nodeModulesAbove(copy)).toEqual([]);
    expectExit(version, 0, { cwd: copy });
    expect(version.stdout).toBe(`rafa ${String(readManifest()['version'])}\n`);
  }, 30_000);
});

describe('the README', () => {
  it('gives both global install commands, each naming the package the manifest does', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
    const name = String(readManifest()['name']);
    const commands = [`npm i -g ${name}`, `bun add -g ${name}`];

    expect(commands.filter((command) => !readme.includes(command))).toEqual([]);
  });
});

describe('the build script, run in a copy of the package', () => {
  it('exits 0', () => {
    expect(build.exitCode).toBe(0);
  });

  it('writes every file the binary and the exports map name', () => {
    const targets = [...new Set(manifestTargets().map((target) => join(PACKAGE_DIR, target)))];
    const missing = targets.filter((target) => !existsSync(target));

    expect(targets).toHaveLength(14);
    expect(missing).toEqual([]);
  });

  it('writes the files the build at c920603 wrote and has since, chunk hashes set aside', () => {
    const before = readFileSync(join(import.meta.dir, DIST_FILES_BEFORE_MOVE), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .sort();
    // The board template the suite plants before its build is no file of the package's.
    const now = builtFiles()
      .filter((file) => file !== `templates/${PLANTED_BOARD_TEMPLATE}`)
      .map((file) => file.replace(HASHED_CHUNK, '$1-<hash>.js'))
      .sort();

    expect(before).toHaveLength(157);
    expect(before.filter((file) => file.endsWith('-<hash>.js')).length).toBeGreaterThan(0);
    expect(now).toEqual(before);
  });

  it('clears dist before it writes, so an earlier build leaves no chunk behind', () => {
    expect(plantedBeforeBuild).toBe(true);
    expect(existsSync(STALE_CHUNK)).toBe(false);
  });

  it('packs the manifest, the README and the build, and nothing else', () => {
    const pack = run([process.execPath, 'pm', 'pack', '--dry-run'], PACKAGE_DIR, withBunOnPath());
    const packed = [...pack.stdout.matchAll(/^packed \S+ (.+)$/gm)]
      .map((match) => match[1] ?? '')
      .sort();
    const expected = ['README.md', 'package.json', ...builtFiles().map((file) => `dist/${file}`)].sort();

    expect(pack.exitCode).toBe(0);
    expect(expected.length).toBeGreaterThan(2);
    expect(packed).toEqual(expected);
  }, 30_000);
});

describe('the built CLI', () => {
  it('keeps the bun shebang and runs as the binary, answering as src/rafa.ts does', () => {
    const cli = join(DIST, 'cli.js');
    const fromSource = run([process.execPath, join(REPO_ROOT, 'src', 'rafa.ts'), '--help'], tempRoot, withBunOnPath());
    const fromBuild = run([cli, '--help'], tempRoot, withBunOnPath());

    expect(readFileSync(cli, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env bun');
    expectExit(fromSource, 0, { cwd: tempRoot });
    expect(fromSource.stdout).toContain('rafa <subject> <action> [args] [flags]\n');
    expect(fromBuild).toEqual(fromSource);
  }, 30_000);

  it('gives the roster from a copy of the build outside the package as src/rafa.ts does, stamped with the manifest version', () => {
    const copy = join(tempRoot, 'describe-outside', 'dist');
    cpSync(DIST, copy, { recursive: true });
    const env = {
      TMPDIR: tmpdir(),
      ...Object.fromEntries(Object.entries(withBunOnPath()).filter(([name]) => !name.startsWith('RAFA_'))),
      ...scratchHomeEnv(tempRoot),
    };
    const fromSource = run([process.execPath, join(REPO_ROOT, 'src', 'rafa.ts'), 'describe'], tempRoot, env);
    const fromBuild = run([process.execPath, join(copy, 'cli.js'), 'describe'], tempRoot, env);

    expectExit(fromSource, 0, { cwd: tempRoot });
    expect(existsSync(join(copy, '..', 'package.json'))).toBe(false);
    expect((JSON.parse(fromBuild.stdout) as { version?: unknown }).version).toBe(readManifest()['version']);
    expect(fromBuild).toEqual(fromSource);
  }, 30_000);

  it('answers describe --output=json with pr merge among the pr actions, so both roots survived the bundle', () => {
    const env = {
      TMPDIR: tmpdir(),
      ...Object.fromEntries(Object.entries(withBunOnPath()).filter(([name]) => !name.startsWith('RAFA_'))),
      ...scratchHomeEnv(tempRoot),
    };
    const fromBuild = run([process.execPath, join(DIST, 'cli.js'), 'describe', '--output=json'], tempRoot, env);

    expectExit(fromBuild, 0, { cwd: tempRoot });
    const last = eventsOf(fromBuild.stdout).at(-1);
    expect(last?.type).toBe('result');
    expect(last?.type === 'result' && last.ok).toBe(true);
    const document = (last?.type === 'result'
      ? last.data
      : undefined) as {
      subjects: { name: string; actions: { name: string }[] }[];
    };
    const pr = document.subjects.find((subject) => subject.name === 'pr');
    expect(pr?.actions.map((action) => action.name)).toContain('merge');
  }, 30_000);

  it('prints its help when imported and sets the exit code it answers, which the import probe can see', () => {
    const probe = probeImport(join(DIST, 'cli.js'));

    expect(probe.exitCode).toBe(0);
    expect(probe.stdout).toContain('rafa <subject> <action> [args] [flags]\n');
    expect(probe.stdout.endsWith('\n[0,0,0]\n')).toBe(true);
  }, 30_000);
});

describe('the built library entries', () => {
  it.each(LIBRARY_ENTRIES)('export from dist/%s the runtime names their source does', async (path, source) => {
    expect(Object.keys(await importBuilt(path)).sort()).toEqual(Object.keys(source).sort());
  });

  it.each(CONTAINED_SUBPATHS)('keep every name of dist/%s the root bundle binding itself', async (subpath) => {
    const root = await importBuilt('index.js');
    const bundle = await importBuilt(subpath);
    const names = Object.keys(bundle);
    const copied = names.filter((name) => root[name] !== bundle[name]);

    expect(names.length).toBeGreaterThan(0);
    expect(copied).toEqual([]);
  });

  it.each(LIBRARY_ENTRIES)('import dist/%s in a fresh process without running anything', (path) => {
    expect(probeImport(join(DIST, path))).toEqual({
      exitCode: 0,
      stdout: '[0,0,null]\n',
      stderr: '',
      files: ['probe.ts'],
    });
  }, 30_000);
});

describe('the names phase 1 adds, in the built entries', () => {
  it('carries the preflight and the PREREQUISITES parser in dist/plan/index.js, as the same bindings in dist/index.js', async () => {
    const plan = await importBuilt('plan/index.js');
    const root = await importBuilt('index.js');

    expect(PLAN_PREFLIGHT_NAMES.filter((name) => !(name in plan))).toEqual([]);
    expect(PLAN_PREFLIGHT_NAMES.filter((name) => root[name] !== plan[name])).toEqual([]);
  });

  it('carries the config resolver, scope resolution, the adapter registry and the manifest validator in dist/index.js', async () => {
    const root = await importBuilt('index.js');
    const start = mkdtempSync(join(tempRoot, 'scope-'));
    const resolveScope = root['resolveScope'] as (start: string, seams: { home: string }) => unknown;
    const validateManifest = root['validateManifest'] as (raw: unknown) => { ok: boolean };

    expect(ROOT_SEAM_NAMES.filter((name) => !(name in root))).toEqual([]);
    expect(root['PORT_VERSIONS']).toEqual(rootSource.PORT_VERSIONS);
    expect(root['RUNNING_MANIFEST_SEAMS']).toEqual({
      rafaVersion: readManifest()['version'],
      portVersions: rootSource.PORT_VERSIONS,
    });
    expect(resolveScope(start, { home: tempRoot })).toMatchObject({ found: false, start, home: tempRoot });
    expect(validateManifest({})).toMatchObject({ ok: false });
  });

  it('loads dist/plan/index.js under node with the names its source exports, where node refuses dist/index.js', () => {
    const node = Bun.which('node');
    if (node === null) throw new Error('node is not on the PATH this suite runs under');
    const load = (path: string) => run([
      node,
      '--input-type=module',
      '-e',
      `console.log(JSON.stringify(Object.keys(await import(${JSON.stringify(pathToFileURL(path).href)})).sort()));`,
    ], tempRoot, process.env);

    expect(load(join(DIST, 'plan', 'index.js'))).toEqual({
      exitCode: 0,
      stdout: `${JSON.stringify(Object.keys(planSource).sort())}\n`,
      stderr: '',
    });
    const root = load(join(DIST, 'index.js'));
    expect(root.exitCode).not.toBe(0);
    expect(root.stderr).toContain('ERR_UNSUPPORTED_ESM_URL_SCHEME');
    expect(root.stderr).toContain('bun:');
  }, 30_000);
});

describe('the learning subpath, imported by the package name', () => {
  /** A scratch directory whose `node_modules` links the package's name to the scratch package. */
  function plantConsumer(name: string): string {
    const consumer = mkdtempSync(join(tempRoot, `${name}-`));
    mkdirSync(join(consumer, 'node_modules', '@open-tomato'), { recursive: true });
    symlinkSync(PACKAGE_DIR, join(consumer, 'node_modules', '@open-tomato', 'rafa'), 'dir');
    return consumer;
  }

  /** A module printing the sorted names `specifier` exports, then `actionHash` of {@link HASHED_ACTION}. */
  function printNames(specifier: string): string {
    return [
      `const entry = await import(${JSON.stringify(specifier)});`,
      `console.log(JSON.stringify([Object.keys(entry).sort(), entry.actionHash(${JSON.stringify(HASHED_ACTION)})]));`,
      '',
    ].join('\n');
  }

  /** What {@link printNames} prints for the source entry. */
  function expectedNames(): string {
    return `${JSON.stringify([Object.keys(learningSource).sort(), learningSource.actionHash(HASHED_ACTION)])}\n`;
  }

  it('imports under bun, with the names and the action hash its source gives', () => {
    const consumer = plantConsumer('learning-bun');
    writeFileSync(join(consumer, 'unmapped.mjs'), printNames('@open-tomato/rafa/unmapped'), 'utf8');
    writeFileSync(join(consumer, 'probe.mjs'), printNames('@open-tomato/rafa/learning'), 'utf8');

    const unmapped = run([process.execPath, 'unmapped.mjs'], consumer, process.env);
    expect(unmapped.exitCode).not.toBe(0);
    expect(unmapped.stderr).toContain('@open-tomato/rafa/unmapped');

    expect(run([process.execPath, 'probe.mjs'], consumer, process.env)).toEqual({
      exitCode: 0,
      stdout: expectedNames(),
      stderr: '',
    });
  }, 30_000);

  it('imports under node, with the names and the action hash its source gives', () => {
    const node = Bun.which('node');
    if (node === null) throw new Error('node is not on the PATH this suite runs under');
    const consumer = plantConsumer('learning-node');
    writeFileSync(join(consumer, 'unmapped.mjs'), printNames('@open-tomato/rafa/unmapped'), 'utf8');
    writeFileSync(join(consumer, 'probe.mjs'), printNames('@open-tomato/rafa/learning'), 'utf8');

    const unmapped = run([node, 'unmapped.mjs'], consumer, process.env);
    expect(unmapped.exitCode).not.toBe(0);
    expect(unmapped.stderr).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');

    expect(run([node, 'probe.mjs'], consumer, process.env)).toEqual({
      exitCode: 0,
      stdout: expectedNames(),
      stderr: '',
    });
  }, 30_000);
});

describe('the config subpath in the build', () => {
  it('gives dist/config/index.js the defaults and the defineConfig its source does', async () => {
    const built = await importBuilt('config/index.js');
    const defineConfig = built['defineConfig'] as (config: unknown) => unknown;
    const entries = [{ plan: { inject: 'stage' } }];

    expect(built['defaults']).toEqual(configSource.defaults);
    expect(defineConfig(entries)).toBe(entries);
  });

  it('loads dist/config/index.js under node with the names its source exports', () => {
    const node = Bun.which('node');
    if (node === null) throw new Error('node is not on the PATH this suite runs under');
    const href = pathToFileURL(join(DIST, 'config', 'index.js')).href;
    const load = run([
      node,
      '--input-type=module',
      '-e',
      `console.log(JSON.stringify(Object.keys(await import(${JSON.stringify(href)})).sort()));`,
    ], tempRoot, process.env);

    expect(load).toEqual({
      exitCode: 0,
      stdout: `${JSON.stringify(Object.keys(configSource).sort())}\n`,
      stderr: '',
    });
  }, 30_000);

  it('writes the declaration the types condition of ./config names, carrying the entry\'s names', () => {
    const declaration = readFileSync(join(DIST, CONFIG_TYPES), 'utf8');

    expect(EXPORTS['./config'].types).toBe(`./dist/${CONFIG_TYPES}`);
    expect(declaration).toContain('export { defineConfig } from \'./entry.js\';');
    expect(declaration).toContain('export declare const defaults: ConfigEntry;');
    expect(declaration).toContain('export type { Config, ConfigEntry } from \'./entry.js\';');
  });

  it('reaches no specifier outside rafa from dist/config/index.d.ts, and no declaration that is not there', () => {
    const reach = declarationReach(DIST, CONFIG_TYPES);

    expect(reach.reached).toContain('config/shape.d.ts');
    // Reached through a core subpath's `types` entry, as a consumer of the tarball resolves it.
    expect(reach.reached).toContain('core/config/index.d.ts');
    expect(reach.reached).toContain('core/config/config-schema.d.ts');
    expect(reach.missing).toEqual([]);
    expect(reach.outside).toEqual([]);
  });

  it('reaches the thirteen section declarations and the LogLevel leaf, and not ports/index.d.ts', () => {
    const reach = declarationReach(DIST, CONFIG_TYPES);
    const sections = [
      'board-project', 'checks', 'errors', 'features', 'hub', 'issues', 'logger', 'loop-continue',
      'loop-retries', 'release', 'tests', 'triage', 'wrap-up',
    ].map((name) => `config-schema-${name}.d.ts`);

    expect(sections).toHaveLength(13);
    expect(reach.reached).toEqual(expect.arrayContaining([...sections, 'ports/log-level.d.ts']));
    expect(reach.reached).not.toContain('ports/index.d.ts');
    expect(reach.outside).toEqual([]);
  });

  it('sees a specifier outside rafa planted two hops from the entry, as a static and as a type import, and a subpath no entry names', () => {
    const copy = mkdtempSync(join(tempRoot, 'declarations-'));
    cpSync(DIST, copy, { recursive: true });
    const plant = (file: string, line: string) => writeFileSync(
      join(copy, file),
      `${line}\n${readFileSync(join(copy, file), 'utf8')}`,
      'utf8',
    );
    plant('config/shape.d.ts', 'export type Planted = import(\'bun:sqlite\').Database;');
    plant('core/config/index.d.ts', `import type { StandardSchemaV1 } from '${DEFINE_CONFIG}';`);
    plant('core/config/config-schema.d.ts', `import type { Absent } from '${OWN_SUBPATH}core/absent';`);
    const reach = declarationReach(copy, CONFIG_TYPES);

    expect(reach.outside).toEqual([
      'config/shape.d.ts: bun:sqlite',
      `core/config/index.d.ts: ${DEFINE_CONFIG}`,
    ]);
    // A subpath of the package's own name that no exports entry names is a declaration that is not there.
    expect(reach.missing).toEqual([`core/config/config-schema.d.ts: ${OWN_SUBPATH}core/absent`]);
  });
});

describe('the config subpath, installed from the packed tarball', () => {
  /** The entries both config files hold; `plan.inject` is a setting the defaults entry names. */
  const ENTRIES = '[{ plan: { inject: \'stage\' } }]';

  /** A scratch project with the tarball of the built copy installed into it, and nothing else. */
  function installFromTarball(): string {
    const destination = mkdtempSync(join(tempRoot, 'tarball-'));
    const pack = run(
      [process.execPath, 'pm', 'pack', '--ignore-scripts', '--quiet', '--destination', destination],
      PACKAGE_DIR,
      withBunOnPath(),
    );
    expectExit(pack, 0, { cwd: PACKAGE_DIR });
    const tarball = readdirSync(destination).find((file) => file.endsWith('.tgz')) ?? '';
    expect(tarball).not.toBe('');

    const project = mkdtempSync(join(tempRoot, 'consumer-'));
    writeFileSync(join(project, 'package.json'), '{"name":"consumer","private":true,"type":"module"}\n', 'utf8');
    const add = run(
      [process.execPath, 'add', join(destination, tarball), '--no-progress'],
      project,
      { ...withBunOnPath(), TMPDIR: tmpdir(), ...scratchHomeEnv(join(project, 'home')) },
    );
    expectExit(add, 0, { cwd: project });
    return project;
  }

  it('type-checks both rafa.config.ts forms with tsc --noEmit, and imports the first under bun', () => {
    const project = installFromTarball();
    writeFileSync(join(project, 'rafa.config.ts'), [
      'import { defineConfig } from \'@open-tomato/rafa/config\';',
      '',
      `export default defineConfig(${ENTRIES});`,
      '',
    ].join('\n'), 'utf8');
    writeFileSync(join(project, 'typed.config.ts'), [
      'import type { Config } from \'@open-tomato/rafa/config\';',
      '',
      `export default ${ENTRIES} satisfies Config;`,
      '',
    ].join('\n'), 'utf8');
    writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
      },
      files: ['rafa.config.ts', 'typed.config.ts'],
    }), 'utf8');
    const env = withBunOnPath();

    const check = run([process.execPath, installedTsc(), '--noEmit', '--pretty', 'false'], project, env);
    const load = run([
      process.execPath,
      '-e',
      'console.log(JSON.stringify((await import(\'./rafa.config.ts\')).default));',
    ], project, env);

    expectExit(check, 0, { cwd: project });
    expectExit(load, 0, { cwd: project });
    expect(load.stdout).toBe(`${JSON.stringify([{ plan: { inject: 'stage' } }])}\n`);
  }, 120_000);

  it('refuses a config entry the type does not allow, so the check can fail', () => {
    const project = installFromTarball();
    writeFileSync(join(project, 'bad.config.ts'), [
      'import type { Config } from \'@open-tomato/rafa/config\';',
      '',
      'export default [{ plan: { inject: 42 } }] satisfies Config;',
      '',
    ].join('\n'), 'utf8');
    writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true, skipLibCheck: true, types: [] },
      files: ['bad.config.ts'],
    }), 'utf8');

    const check = run([process.execPath, installedTsc(), '--noEmit', '--pretty', 'false'], project, withBunOnPath());

    expect(check.exitCode).not.toBe(0);
    expect(check.stdout).toContain('bad.config.ts');
  }, 120_000);
});

describe('the prompt templates in the build', () => {
  it.each(TEMPLATES)('copies %s into dist as %s, unchanged', (source, name) => {
    const built = join(DIST, name);

    expect(existsSync(built)).toBe(true);
    expect(readFileSync(built, 'utf8')).toBe(readFileSync(join(REPO_ROOT, source), 'utf8'));
  });

  it('writes every built file that reads import.meta.url directly into dist', () => {
    const readers = builtFiles()
      .filter((file) => file.endsWith('.js'))
      .filter((file) => readFileSync(join(DIST, file), 'utf8').includes('import.meta.url'));

    expect(readers.length).toBeGreaterThan(0);
    expect(readers.filter((file) => file.includes('/'))).toEqual([]);
  });

  it('lands the epic verification prompt where readVerifyPrompt looks for it from a bundle in dist', () => {
    const source = readFileSync(join(PACKAGE_DIR, 'src', VERIFY_PROMPT_FILE), 'utf8');

    expect(readVerifyPrompt(DIST)).toBe(source);
  });

  it.each([[DECISION_PROMPT_FILE], [CONTINUE_CRITERIA_FILE]])('lands %s where readBundledFile looks for it from a bundle in dist', (name) => {
    const source = readFileSync(join(PACKAGE_DIR, 'src', name), 'utf8');

    expect(readBundledFile(name, DIST)).toBe(source);
  });

  it('hands rafa plan the template beside dist/cli.js', async () => {
    const scratch = plantPlanScratch('cli');
    const plan = run([process.execPath, join(DIST, 'cli.js'), 'plan', ...PLAN_ARGS], scratch.repo, scratch.env);

    expect(readFileSync(scratch.prompt, 'utf8')).toBe(await expectedPlanPrompt(scratch, dispatchedRoot(scratch)));
    expect(readFileSync(scratch.args, 'utf8')).toBe(planSessionArgs('project,local'));
    expectExit(plan, 1, planScratchPaths(scratch));
  }, 30_000);

  it('spawns rafa plan under the setting sources a user config names', async () => {
    const scratch = plantPlanScratch('sources');
    plantUserConfig(scratch, 'loop:\n  settingSources: local,user\n');
    const plan = run([process.execPath, join(DIST, 'cli.js'), 'plan', ...PLAN_ARGS], scratch.repo, scratch.env);

    expect(readFileSync(scratch.args, 'utf8')).toBe(planSessionArgs('local,user'));
    expect(readFileSync(scratch.prompt, 'utf8')).toBe(await expectedPlanPrompt(scratch, dispatchedRoot(scratch)));
    expectExit(plan, 1, planScratchPaths(scratch));
  }, 30_000);

  it('refuses rafa plan on a config it cannot run on, before any session starts', () => {
    const scratch = plantPlanScratch('refused-config');
    plantUserConfig(scratch, 'loop:\n  settingSources: everyone\n');
    const plan = run([process.execPath, join(DIST, 'cli.js'), 'plan', ...PLAN_ARGS], scratch.repo, scratch.env);

    expectExit(plan, 1, planScratchPaths(scratch));
    expect(plan.stderr).toContain('Refusing to generate a plan on this configuration');
    expect(plan.stderr).toContain('loop.settingSources is "everyone"');
    expect(existsSync(scratch.prompt)).toBe(false);
    expect(existsSync(scratch.args)).toBe(false);
  }, 30_000);

  it('hands planCommand the template beside dist/index.js', async () => {
    const scratch = plantPlanScratch('library');
    const probe = join(scratch.root, 'probe.ts');
    writeFileSync(probe, [
      `const { planCommand } = await import(${JSON.stringify(join(DIST, 'index.js'))});`,
      `await planCommand(${JSON.stringify(PLAN_ARGS)}, ${JSON.stringify(scratch.repo)});`,
      '',
    ].join('\n'), 'utf8');
    const plan = run([process.execPath, probe], scratch.repo, scratch.env);

    expect(readFileSync(scratch.prompt, 'utf8')).toBe(await expectedPlanPrompt(scratch, scratch.repo));
    expect(plan.exitCode).toBe(1);
  }, 30_000);

  it('names the plan under the root planCommand is handed through a link, as that root is spelled', async () => {
    const scratch = plantPlanScratch('library-link');
    const link = join(scratch.root, 'link');
    symlinkSync(scratch.repo, link, 'dir');
    const probe = join(scratch.root, 'probe.ts');
    writeFileSync(probe, [
      `const { planCommand } = await import(${JSON.stringify(join(DIST, 'index.js'))});`,
      `await planCommand(${JSON.stringify(PLAN_ARGS)}, ${JSON.stringify(link)});`,
      '',
    ].join('\n'), 'utf8');
    const plan = run([process.execPath, probe], link, scratch.env);

    expect(realpathSync(link)).not.toBe(link);
    expect(readFileSync(scratch.prompt, 'utf8')).toBe(await expectedPlanPrompt(scratch, link));
    expect(plan.exitCode).toBe(1);
  }, 30_000);

  it('hands rafa plan the format from a copy of the build outside the package', async () => {
    const scratch = plantPlanScratch('outside');
    const copy = copyBuildOutsidePackage(scratch, null);
    const plan = run([process.execPath, join(copy, 'cli.js'), 'plan', ...PLAN_ARGS], scratch.repo, scratch.env);

    expect(planFormatPath(copy)).toBe(join(copy, PLAN_FORMAT_IN_TIER));
    expect(existsSync(join(copy, '..', 'src'))).toBe(false);
    expect(readFileSync(scratch.prompt, 'utf8')).toBe(await expectedPlanPrompt(scratch, dispatchedRoot(scratch)));
    expectExit(plan, 1, planScratchPaths(scratch));
  }, 30_000);

  it('refuses before any session when the template is missing beside the bundle', () => {
    const scratch = plantPlanScratch('control');
    const bare = copyBuildOutsidePackage(scratch, 'plan-prompt.md');
    const plan = run([process.execPath, join(bare, 'cli.js'), 'plan', ...PLAN_ARGS], scratch.repo, scratch.env);

    expect(plan.exitCode).not.toBe(0);
    expect(plan.stderr).toContain('ENOENT');
    expect(plan.stderr).toContain('plan-prompt.md');
    expect(existsSync(scratch.prompt)).toBe(false);
  }, 30_000);

  it('refuses before any session when the skill is missing from the tier of a bundle outside the package', () => {
    const scratch = plantPlanScratch('control-skill');
    const bare = copyBuildOutsidePackage(scratch, PLAN_FORMAT_IN_TIER);
    const plan = run([process.execPath, join(bare, 'cli.js'), 'plan', ...PLAN_ARGS], scratch.repo, scratch.env);

    expect(existsSync(planFormatPath(bare))).toBe(false);
    expect(plan.exitCode).not.toBe(0);
    expect(plan.stderr).toContain('The plan format is missing');
    expect(plan.stderr).toContain(join(bare, PLAN_FORMAT_IN_TIER));
    expect(existsSync(scratch.prompt)).toBe(false);
  }, 30_000);
});

describe('the rafa tier in the build', () => {
  it('copies every file of src/bundled into dist/bundled, unchanged, and nothing else', () => {
    const [source, name] = BUNDLED;
    const sourceDir = join(PACKAGE_DIR, source);
    const builtDir = join(DIST, name);
    const names = filesUnder(sourceDir);
    const differing = names.filter(
      (file) => !existsSync(join(builtDir, file))
        || readFileSync(join(builtDir, file), 'utf8') !== readFileSync(join(sourceDir, file), 'utf8'),
    );

    const built = TS_SYMBOLS[1].slice(`${name}/`.length);

    expect(names).toContain(PLAN_FORMAT_IN_TIER.slice(`${name}/`.length));
    expect(names).not.toContain(built);
    expect(differing).toEqual([]);
    expect(filesUnder(builtDir)).toEqual([...names, built].sort());
  });

  it('writes no dev-planner copy beside the bundles, so the tier is the only one read', () => {
    expect(existsSync(join(DIST, 'SKILL.md'))).toBe(false);
  });
});

describe('the ts-symbols program in the build', () => {
  it('keeps the bun shebang and is written executable', () => {
    const program = join(DIST, TS_SYMBOLS[1]);

    expect(existsSync(program)).toBe(true);
    expect(readFileSync(program, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env bun');
    expect(statSync(program).mode & 0o111).toBe(0o111);
  });

  it.each(TS_SYMBOLS_RUNS)('runs by path and answers %s as its source does', (_label, args) => {
    const fromSource = run([process.execPath, join(REPO_ROOT, TS_SYMBOLS[0]), ...args], tempRoot, withBunOnPath());
    const fromBuild = run([join(DIST, TS_SYMBOLS[1]), ...args], tempRoot, withBunOnPath());

    expect(fromSource.stdout).toContain('usage: ts-symbols <command> <target>');
    expect(fromBuild).toEqual(fromSource);
  }, 30_000);
});

describe('the built ts-symbols over a project', () => {
  /** A copy of the ts-symbols fixture under the temp root, so resolution never walks into rafa's own node_modules. */
  function plantProject(name: string): string {
    const root = realpathSync(mkdtempSync(join(tempRoot, `${name}-`)));
    cpSync(join(REPO_ROOT, 'src/tools/ts-symbols/fixtures/proj'), root, { recursive: true });
    writeFileSync(join(root, 'package.json'), '{ "name": "fixture", "private": true }\n');
    return root;
  }

  it('outlines a TypeScript fixture that has typescript, exiting 0', () => {
    const root = plantProject('with-ts');
    const typescript = dirname(Bun.resolveSync('typescript/package.json', REPO_ROOT));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(typescript, join(root, 'node_modules', 'typescript'), 'dir');

    const result = run([join(DIST, TS_SYMBOLS[1]), 'outline', 'src/util.ts'], root, withBunOnPath());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('7: export function makeChunk');
    expect(result.stdout).toContain('11: export class ChunkStore');
  }, 30_000);

  it('exits 3 naming the root in a temp project without typescript', () => {
    const root = plantProject('no-ts');

    const result = run([join(DIST, TS_SYMBOLS[1]), 'outline', 'src/util.ts'], root, withBunOnPath());

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain(`no typescript under ${root}: add it to the project`);
    expect(result.stdout).toBe('');
  }, 30_000);
});

describe('the asset trees in the build', () => {
  it.each(ASSET_TREES)('copies every markdown and YAML file of %s into dist/%s, unchanged', (tree, name) => {
    const source = join(PACKAGE_DIR, tree);
    const built = join(DIST, name);
    const names = readdirSync(source)
      .filter((file) => ASSET_EXTENSIONS.some((extension) => file.endsWith(extension)))
      .sort();
    const differing = names.filter(
      (file) => !existsSync(join(built, file))
        || readFileSync(join(built, file), 'utf8') !== readFileSync(join(source, file), 'utf8'),
    );

    expect(names.length).toBeGreaterThan(0);
    expect(differing).toEqual([]);
    expect(readdirSync(built).sort()).toEqual(names);
  });

  it('copies the planted board template, so the board tree is read on a tree with a file in it', () => {
    const built = join(DIST, 'templates', PLANTED_BOARD_TEMPLATE);

    expect(existsSync(built)).toBe(true);
    expect(readFileSync(built, 'utf8')).toBe(PLANTED_BOARD_BODY);
  });

  it('copies no TypeScript out of src/pr/plans, so the reader modules stay unpublished', () => {
    const source = readdirSync(join(PACKAGE_DIR, 'src/pr/plans')).sort();
    const copied = readdirSync(join(DIST, 'plans')).filter((file) => file.endsWith('.ts'));

    expect(PLAN_READER_MODULES.filter((module) => !source.includes(module))).toEqual([]);
    expect(copied).toEqual([]);
  });

  it('lands each pinned plan where readPinnedPlan looks for it from a bundle in dist', () => {
    const differing = PINNED_PLAN_CLASSES.filter(
      (triageClass) => readPinnedPlan(triageClass, { moduleDir: DIST })
        !== readFileSync(join(PACKAGE_DIR, 'src/pr/plans', pinnedPlanFileName(triageClass)), 'utf8'),
    );

    expect(PINNED_PLAN_CLASSES.length).toBeGreaterThan(0);
    expect(differing).toEqual([]);
  });

  it('lands the epic guard workflow where readEpicGuard looks for it from a bundle in dist', () => {
    const source = readFileSync(join(PACKAGE_DIR, 'src/board/templates', EPIC_GUARD_FILE), 'utf8');

    expect(readEpicGuard(DIST)).toBe(source);
  });
});
