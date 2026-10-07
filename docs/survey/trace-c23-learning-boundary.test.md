# Trace: `c23-learning-boundary.test`

Coverage: 1 of 1 cluster members read, the 1 file `docs/survey/import-graph.json` lists for `c23-learning-boundary.test` (`src/tests/learning-boundary.test.ts`, 115 lines); it is tracked by `git ls-files`, and no tracked member was left unread. The one member is a test, so no source export was read; the test was read in full as well as through the graph and `docs/survey/test-index.json`, and so was the rule it reads (the `src/learning/` block of `eslint.config.mjs`).

`c23` ranks 23rd of the 32 clusters in the import graph by number, and by size it sits among the 19 one-file clusters (`c14` to `c32`) that follow the twelve real ones; every cluster in the JSON has its own `trace-<cluster>.md` beside this one. 0 edges inside it, 0 leaving, 0 entering; betweenness 0, as for the 992 of the graph's 1577 files that no shortest path runs through. The cluster is **the lint rule that makes `src/learning/` a library, read through ESLint itself**: the test lints scratch sources as if they sat under `src/learning/` and asserts which refusals come back. It imports no project file because the thing it tests is a configuration, `eslint.config.mjs`, which ESLint loads from the repository root. Its hub is itself.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. None has landed, as the earlier traces record, and as rechecked here: `src/steps/` and `src/flows/` do not exist, no source or `package.json` file imports `@open-tomato/define-config` (the name appears only in `src/preflight/prerequisites-md.ts` and two tests, as an npm availability probe in prose), and `gh issue view` shows #118, #119 and #71 still open. This cluster owns none of the four exports; what it guards is the one folder of `src/` that is already shaped like a package.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/tests` | 1 | `learning-boundary.test.ts`: one `describe` ("the src/learning/ boundary rule") with five `test` calls and one `test.each` over four module names, 9 tests in all (run: 9 pass, 14 assertions); helpers `messagesFor`, `ruleIds` and the constants `ROOT` and `SCRATCH` |

The nine tests are the rule and its controls:

| Test | Scratch path | Source | Expected |
| --- | --- | --- | --- |
| refuses `../config.js` from the library | `src/learning/boundary-scratch.ts` | re-export of `loadConfig` from `../config.js` | one message, `import/no-restricted-paths`, text "src/learning/ imports nothing from the rest of src/." |
| lets the same import through outside the library (control) | `src/plan/boundary-scratch.ts` | the same line | no message |
| lets a sibling import through (control) | `src/learning/boundary-scratch.ts` | `actionHash` from `./identity.js` | no message |
| lets a parent import that stays in the library through (control) | `src/learning/testdata/boundary-scratch.ts` | `actionHash` from `../identity.js` | no message |
| refuses `node:fs`, `node:fs/promises`, `fs`, `fs/promises` (4 cases) | `src/learning/boundary-scratch.ts` | `readFile` from each | one message each, `no-restricted-imports`, text "src/learning/ touches no filesystem." |
| lets `node:crypto` and `bun:test` through (control) | `src/learning/boundary-scratch.ts` | `createHash` and `expect` | no message |

The scratch sources are linted with `new ESLint({ cwd: ROOT }).lintText(source, { filePath })` and written nowhere: the paths need not exist (`src/learning/testdata/` does not exist today), so no stray file can turn `eslint .` red. The test imports `node:path`, `bun:test` and the `eslint` package (a value, `ESLint`, and a type, `Linter`), nothing of the project. It runs in about 0.9 s, ESLint's load time, and spawns no process (the index says `spawns: false`).

The rule is the one custom block of the root config (`eslint.config.mjs`, `files: ['src/learning/**/*.ts']`, from line 24) beyond the ignores and the shared base: an `import/no-restricted-paths` zone (target `./src/learning`, from `./src`, except `./learning`) and a `no-restricted-imports` list of the four filesystem module names. Only `eslint.config.mjs` is a root leaf; the config for `packages/**` is ignored by it, and no `packages/*/eslint.config.mjs` is tracked.

## What crosses the boundary

- Outbound: none by import. The test reaches its subject by two paths that are not imports: `eslint.config.mjs` (and `eslint.base.mjs` through it), and the scratch file paths under `src/learning/` and `src/plan/`. The ten files of `src/learning/` (`bless.ts`, `identity.ts`, `index.ts`, `merge.ts`, `types.ts` and five tests) are all in `c02-active`, and the graph confirms the rule from the other side: those files have 0 edges to any file outside `src/learning/`.
- Inbound: none. Nothing imports a test.
- What the rule protects, from the graph: 32 edges enter `src/learning/` from outside (29 into `index.ts`, 2 into `identity.ts`, 1 into `types.ts`), from `c02-active` (28), `c10-index` (2), `c03-config` (1) and `c08-cli-capture` (1), tests included; `package.json` exports the folder as `./learning` (`./dist/learning/index.js`) and the `build` script bundles `src/learning/index.ts` as its own entry. The library is the one folder of `src/` that is already shipped as a package subpath, with an enforced rule that it imports nothing back.
- Test reach, from `docs/survey/test-index.json`: index 0, 0 source files reached, no folders, no process spawned. A change to `eslint.config.mjs`, `eslint.base.mjs` or any file of `src/learning/` leaves it unselected by `bun test --changed=<base>`, and its name (`.test.ts`, not `.sweep.test.ts`) keeps it out of the default `tests.alwaysRun` glob, so it runs in the full suite and in a run that names it. The lint itself (`bun run lint`, `eslint .`) catches a real violation in a real file; this test is what proves the rule is switched on and is not a rule that refuses everything.

## Entry points

An entry point is a member imported from outside the cluster, or a command registered from it. None of its members is imported, 0 registered commands are in it, and it provides no hook or engine. The comment above the rule in `eslint.config.mjs` (line 30) names this file as the test that lints a file planted under `src/learning/` against that block; that is the one reference, by path in prose.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none | a test of a lint rule is not a command |
| Steps with guards | **missing** | none | the rule is a guard on imports, enforced by lint, not a step with a class a run could consult |
| Config section | **missing** | none; it reads no `src/config-schema*.ts` key; the rule it tests sits in `eslint.config.mjs`, which is lint config and not rafa's | no section of its own |
| Flows | **missing** | none | no multi-step path is driven; each test is one `lintText` call |

### Commands

None. The cluster owns no `RafaCommand`. (`src/adapters/learning/` and `src/commands/instinct/` are where the library is used, in `c02-active`; neither is here.)

### Steps with guards

None registered. The rule is the closest the repository has to a package boundary enforced mechanically, a guard on every import in a folder, but it runs in lint, outside any loop run, and has no class in the contract's sense.

### Config section

None in rafa's own config. The boundary is lint config: the zone and the four forbidden module names are literals in `eslint.config.mjs`, and the test holds their messages by text ("src/learning/ imports nothing from the rest of src/.", "src/learning/ touches no filesystem.").

### Flows

None.

## Gaps

1. **The test is bound to the root lint config by `cwd` and by path** (cut boundary). `ROOT = join(import.meta.dir, '..', '..')` and the scratch paths `src/learning/...` assume the library lives at `src/learning/` under the repository's `eslint.config.mjs`. If `src/learning/` becomes a package under `packages/` (it already has the `./learning` subpath), the rule moves into that package's own leaf config (the root config ignores `packages/**` and none is tracked there today), and this test moves with it with `ROOT` and `SCRATCH` changed; leaving it at the root would lint paths the root config no longer covers and the first test would fail by finding no rule.
2. **Not selected by what it guards** (test index). Index 0 and a `.test.ts` name mean that editing `eslint.config.mjs` or the library does not select it; only the full suite and a named run do. A rule edit that turns the boundary off passes `bun test --changed=<base>` and fails the full suite late. A cut that wants a boundary edit to fail the same task renames the file `src/tests/learning-boundary.sweep.test.ts`, or adds the glob under `tests.alwaysRun` (`src/config-schema-tests.ts`); `src/tests/sweep-suffix.sweep.test.ts` does not require it, since the test reads no repository tree.
3. **The rule is the model for the other boundaries and is the only one** (cut boundary). `package.json` exports six entries (`.`, `./cli`, `./plan`, `./store`, `./ports`, `./learning`), and `import/no-restricted-paths` appears once in the lint config (`eslint.config.mjs` line 34, for `src/learning/`); the folders behind `./plan`, `./store` and `./ports` have no rule that keeps them from importing the rest of `src/`, and the effort store's trace (`trace-c04-sqlite.md`) counts 87 edges out of its cluster. A cut that makes a cluster a package should add the same two-part rule (a restricted-paths zone and the forbidden built-ins) and a test shaped like this one: a refusal beside controls that must pass.
4. **No contract surface** (the four exports, all missing). There is nothing to port to `run(ctx, options)`, a step registry or a config section from here.

## Cut order this implies

This test is the first thing a cut of the learning library needs and the last that has to move. The library (`c02-active`'s ten files, with `src/adapters/learning/` as a caller) is a cheap cut: 0 edges out, one entry file taking 29 of the 32 inbound edges, and a published subpath already. When it is cut, the rule and this test go with it, in the same commit, to the new package's lint config and test folder; before that, it stays at the repository root and keeps `src/learning/` honest. For every later cut, this file is the template for the boundary check each package takes with it (gap 3).
