# Trace: `c31-cli.test`

Coverage: 1 of 1 cluster member read, the 1 file `docs/survey/import-graph.json` lists for `c31-cli.test`; it is tracked by `git ls-files`, and no tracked member was left unread. The member is a test (`src/tools/ts-symbols/cli.test.ts`, 178 lines), read in full for what it spawns and asserts, and through the graph and `docs/survey/test-index.json` for its place in them. The program it spawns (`src/tools/ts-symbols/cli.ts`, `c32-cli`) and the fixture it runs over (`src/tools/ts-symbols/fixtures/proj/`, two files in `c13-main` and a `tsconfig.json` the graph does not scope) were read for the answers the test expects.

Cluster 31 of 32 by the `NN` of its name, and one of the 19 single-file clusters (`c14` to `c32`). Every cluster in the JSON has its own `trace-<cluster>.md` beside this one. The cluster is **the test of the `ts-symbols` program, and it tests it from outside**: `src/tools/ts-symbols/cli.test.ts` spawns `bun src/tools/ts-symbols/cli.ts <args>` with `Bun.spawnSync` in the fixture project and asserts exit code, stdout and stderr. It holds 14 tests in six `describe` blocks: `outline` (3: line order, container members nested but not function internals, `--json`), `def` (2: a call site resolves to its declaration, exit 2 where nothing is at the position), `refs` (1: references with roles across the tsconfig project, five of them), `type` (2: the declared type, `--full` expanding an alias), `cli surface` (2: a bad target format and an unknown command, both exit 1) and `typescript from the project root` (4, over scratch projects planted under the OS temp directory: exit 3 naming the root when the project has no `typescript`, `help` answered without one, the project's own `typescript` loaded rather than rafa's, and the walk up to the project's `node_modules` from a subdirectory). Its hub is itself, being the only member; its betweenness is 0, as it has no edge to carry a path through.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. Neither has landed: `src/steps/` and `src/flows/` do not exist, no source file imports `@open-tomato/define-config` (the name appears only as text in `src/preflight/prerequisites-md.ts` and `src/start/preflight.test.ts`), and `gh issue view 119` and `gh issue view 71` both read OPEN. This cluster would give the contract nothing: it is the test of a standalone program, and the program is not a `RafaCommand`.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/tools/ts-symbols` | 1 | `cli.test.ts`: `runIn(cwd, ...args)` and `run(...args)` (a `Bun.spawnSync` of `bun cli.ts`), `plantProject()` and `plantTypeScript(root)` for the scratch projects |

`src/tools/ts-symbols` is a four-file folder split over three clusters: this test, the program (`c32-cli`) and the fixture project's `main.ts` and `util.ts` (`c13-main`, kind `test-support`), plus `fixtures/proj/tsconfig.json`, which the graph does not scope. The member imports `node:fs`, `node:os`, `node:path` and `bun:test`, and no project file and no package beyond them: it reaches the program and the fixture by `path.join(import.meta.dir, ...)`, which is why the program is not in its import graph. It also calls `Bun.resolveSync('typescript/package.json', import.meta.dir)` to find rafa's own `typescript` and wrap it in the planted one.

## What crosses the boundary

Outbound: no imports of project files, so 0 edges to any cluster (0 value, 0 type). Inbound: 0 edges; nothing imports it.

By path, and not by import, it crosses to two clusters: it spawns `c32-cli` (`src/tools/ts-symbols/cli.ts`) and it copies and runs over the two fixture files of `c13-main` (`src/tools/ts-symbols/fixtures/proj/src/main.ts`, `util.ts`), whose line numbers it asserts (`7: export function makeChunk`, `src/main.ts:3:29`, `5 reference(s)`), so editing a fixture file by a line moves several assertions. `src/tests/package-build.test.ts` (`c08-cli-capture`) is the other test that spawns the program, from the built `dist/bundled/bin/ts-symbols`, and it copies the same fixture; it asserts a subset of the same answers (usage text, exit 0 over a project with `typescript`, exit 3 over one without) and does not import this test.

Test reach, from `docs/survey/test-index.json`: the test has index 0 and `spawns` true, with itself as the only `spawnsVia` (its `Bun.spawnSync` call). Index 0 means no source file is reached through its imports, which is true of the test and misleading about the program: `docs/survey/test-index.json` lists `src/tools/ts-symbols/cli.ts` as reached by no test at all. It is one of 44 of the 908 indexed tests at 0. Its name does not match `**/*-cli.test.ts` (the `-` is part of the pattern; `cli.test.ts` has none), `tests.integration`'s other defaults or `tests.alwaysRun` (`TESTS_DEFAULTS` in `src/config-schema-tests.ts`), and it imports no project file, so a change to `cli.ts` selects it neither under `bun test --changed=<base>` nor as an always-run sweep. A stage that touches `src/tools/ts-symbols/` runs the folder's tests, this one included; any other change to the program runs it in a full pass only.

## Entry points

No member is imported from outside the cluster. No `RafaCommand` is registered from it, and it provides no hook or engine to code outside it.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none | the cluster is a test; the program it tests is not a `RafaCommand` |
| Steps with guards | **missing** | none; the test is a gate, run by `bun test` | no step, no guard class; the program's exit 3 (no `typescript`) is a refusal it asserts and does not own |
| Config section | **missing** | none; reads no config key | none needed |
| Flows | **missing** | none | no multi-step path; each test is one spawn and its assertions |

### Commands

None. It asserts the surface of `ts-symbols` (`outline`, `def`, `refs`, `type`, `help`, `--json`, `--full`), a program of its own with its own exit codes (0, 1, 2, 3).

### Steps with guards

None. The test is a gate in the sense of `context/verification.md`: a test in the suite, not a step a loop run contributes. The behaviour it holds is the program's own guard, that a project with no `typescript` is refused with exit 3 and nothing on stdout, and that `help` and a usage error are answered before any `typescript` is loaded.

### Config section

None, and no config read. The test plants its own environment (a `package.json` that depends on nothing, a `node_modules/typescript` that prints a marker) under `os.tmpdir()`, never inside the repository, so a walk up would not reach rafa's own `node_modules`.

### Flows

None. Each case is a single spawn over the fixture project.

## Gaps

Every export is missing; the cluster is a test, so a cut moves it and does not fill the exports.

1. **No command, step, config key or flow** (all four, missing). Nothing to add; the test of a program is not one of the four exports.
2. **The test and the program are in different clusters** (cut boundary). The graph puts `cli.test.ts` (`c31`) and `cli.ts` (`c32`) apart because the test reaches the program by a `Bun.spawnSync` of a path and not by an import; a cut has to move `src/tools/ts-symbols/cli.test.ts`, `cli.ts` and `fixtures/proj/` together, as one folder, or the test's `CLI` and `PROJ` constants (`path.join(import.meta.dir, 'cli.ts')`, `'fixtures', 'proj'`) break. The build line in the root `package.json` (`bun build src/tools/ts-symbols/cli.ts ... --outfile=dist/bundled/bin/ts-symbols`) and `src/tests/package-build.test.ts` (`TS_SYMBOLS`, `src/tools/ts-symbols/fixtures/proj`) name the same paths.
3. **A change to the program selects no test** (test index, flows). `cli.test.ts` has index 0, no project import and no suffix the setting reads, and `cli.ts` is reached by no test. Under `bun test --changed=<base>` a change to `src/tools/ts-symbols/cli.ts` runs nothing. The file a cut would have to change to close it is `src/config-schema-tests.ts` (the default of `tests.integration` or a `tests.alwaysRun` pattern naming this test), or the test's own name (a `-spawned` or `-cli.test.ts` spelling, which `tests.integration` already takes at a stage).
4. **The fixture's line numbers are the contract** (cut boundary). The assertions name `7: export function makeChunk`, `11: export class ChunkStore`, `19: const HIDDEN_LIMIT`, `src/main.ts:3:29`, `src/main.ts:6:14` and `5 reference(s)`; `src/tests/package-build.test.ts` asserts the first two of those lines (`7:` and `11:`) over the same fixture. A cut that edits `fixtures/proj/src/util.ts` or `main.ts` has to change both tests together, or the fixture is generated from one table the tests read.
5. **Spawn asserts bare, outside the sweep's reach** (cut boundary). `run(...)` returns `{ exitCode, stdout, stderr }` and the cases assert `expect(r.exitCode).toBe(n)`. `src/tests/spawned-exit-code.sweep.test.ts` (`c28`) flags a bare assertion only on a spawn of rafa (the `rafa.ts` or `cli.js` entry), not of this program; `cli.test.ts` is outside that rule today, and a red case prints two numbers and not the child's streams. A cut that gives this test `expectExit`-style output changes this file's `run` helper.

## Cut order this implies

Taken with `c32-cli` and the two fixture files of `c13-main`, as one tool: `src/tools/ts-symbols/` is the unit, a standalone program with its own test, its own fixture project and its own build line, and a folder that imports nothing from the rest of the tree (it loads the project's `typescript`, not rafa's). It has no edge into the rest of the tree and the rest of the tree has none into it, so it can leave at any point of the order; what ties it is the build line, one test in `c08-cli-capture` and the skill and `PATH` conventions that name the binary. Gap 3 is independent of any cut, and the cheapest change in the cluster.
