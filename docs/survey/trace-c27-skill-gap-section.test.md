# Trace: `c27-skill-gap-section.test`

Coverage: 1 of 1 cluster member read, the 1 file `docs/survey/import-graph.json` lists for `c27-skill-gap-section.test`; it is tracked by `git ls-files`, and no tracked member was left unread. The member is a test (`src/tests/skill-gap-section.test.ts`, 40 lines), so it was read in full for what it asserts and for the files it names, and through the graph and `docs/survey/test-index.json` for its place in them; the two files it compares were read for the section it reads.

Cluster 27 of 32 by the `NN` of its name, and one of the 19 single-file clusters (`c14` to `c32`) that follow the 12 multi-file clusters and the two-file `c13-main`. Every cluster in the JSON has its own `trace-<cluster>.md` beside this one. The cluster is **one test that keeps two copies of a skill file in step**: `src/tests/skill-gap-section.test.ts` reads the `## Gap reports` section of `.claude/skills/rafa-tooling/SKILL.md` (the copy this checkout's agents read) and of `extras/claude-code/rafa-hookify/files/rafa-tooling-skill.md` (the copy `rafa-hookify`'s `install.ts` writes into a project's `.claude/skills/rafa-tooling/SKILL.md`), and asserts that both hold one and that the two are identical. Its hub is itself, being the only member; its betweenness is 0 (992 of the 1577 files in the graph have none), as it has no edge to carry a path through.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. Neither has landed: `src/steps/` and `src/flows/` do not exist, no source file imports `@open-tomato/define-config` (the name appears only as text in `src/preflight/prerequisites-md.ts` and `src/start/preflight.test.ts`), and `gh issue view 119` and `gh issue view 71` both read OPEN. This cluster would have nothing to give the contract in either case: it is a check on two documents, not a unit of behaviour.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/tests` | 1 | `skill-gap-section.test.ts`: the `gapSection(text)` helper (exported from the test file, used only inside it) and three tests in one `describe` |

`src/tests` holds 188 files, of which this is one; the rest are spread over 25 other clusters (`c08-cli-capture` has 71, `c02-active` 26, `c01-github` 25). The member imports `node:fs` and `bun:test` and no project file, which is why it has no edge in the graph. It names two files by repository-relative path, both tracked and neither in the graph's scope (a Markdown skill and its source copy): `.claude/skills/rafa-tooling/SKILL.md` and `extras/claude-code/rafa-hookify/files/rafa-tooling-skill.md`. The paths resolve against the working directory, so the test runs from the repository root, as `bun test` does.

What it asserts, by test:

- `gapSection` returns undefined without the heading and stops at the next level-2 heading (a planted pair of strings).
- both copies carry a non-empty gap-report section.
- the section is identical in both copies, byte for byte after a trim.

## What crosses the boundary

Outbound: no imports of project files, so 0 edges to any cluster (0 value, 0 type). Inbound: 0 edges; nothing imports the test file, and `gapSection` is exported but has no importer.

By path and not by import, the cluster touches the two copies of the skill, the section's other readers being `extras/claude-code/rafa-hookify/install.ts` (copies the file by name) and `extras/claude-code/rafa-hookify/files/rafa-tooling-hook.ts` (whose message text names `module:cli-gap` and `rafa issue list --module=cli-gap`, which the section tells an agent to run). Neither is in the graph.

Test reach, from `docs/survey/test-index.json`: the test has index 0 (no source file reached, no folder counted, `spawns` false). It is one of 44 of the 908 indexed tests at 0. Index 0 is the cheapest a test can be, and also means that `bun test --changed=<base>` never selects it by import graph: a change to either skill file selects nothing, and the test runs only in a full pass or when the test file itself changes. `src/config-schema-tests.ts` (`tests.alwaysRun`, default `src/**/*.sweep.test.ts`, line 135) is the setting that rescues a test of this shape, and this one does not carry the `.sweep.test.ts` suffix, so the pattern does not match it; `src/tests/sweep-suffix.sweep.test.ts` does not flag it either, because its detectors look for `git ls-files` calls and walks of the repository root, not a `readFileSync` of two fixed paths.

## Entry points

No member is imported from outside the cluster. No `RafaCommand` is registered from it: `CORE_COMMANDS` in `src/commands/index.ts` holds commands, and this file is a test. It provides no hook and no engine to code outside it.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none | the cluster is a test; no `RafaCommand` |
| Steps with guards | **missing** | none; the test is a gate on a document, run by `bun test` | no step, no guard class; what it guards is a property of two files, not a refusal in a run |
| Config section | **missing** | none; reads no config key | none needed; `tests.alwaysRun` (`src/config-schema-tests.ts`) is the key that would make it a sweep, and it belongs to the tests section |
| Flows | **missing** | none | no multi-step path; one read, one compare |

### Commands

None. The skill the test guards describes commands (`rafa issue list --module=cli-gap`, `rafa issue create --type=bug --module=cli-gap`), but defines none.

### Steps with guards

None. The check is a gate in the sense of `context/verification.md`: a test in the suite, not a step a loop run contributes. Its class, if the contract gave it one, would be a reading.

### Config section

None, and no config read. The file is selected or skipped by `tests.alwaysRun` and `tests.integration`, both declared in `src/config-schema-tests.ts`, which owns them.

### Flows

None. A `readFileSync` of each copy, `gapSection` on each, `toBe` on the pair.

## Gaps

Every export is missing; the cluster is a test, so a cut moves it and does not fill the exports.

1. **No command, step, config key or flow** (all four, missing). Nothing to add; a test of two documents is not one of the four exports, and no cut should invent one.
2. **The test names two paths from different trees** (cut boundary). `.claude/skills/rafa-tooling/SKILL.md` belongs to the checkout's agent setup and `extras/claude-code/rafa-hookify/files/rafa-tooling-skill.md` to the extras package. A cut that moves `extras/claude-code/rafa-hookify/` out as a package has to change the `COPIES` constant in `src/tests/skill-gap-section.test.ts` (the path of the source copy), or move the test with the package and read the installed copy from the repository by path.
3. **The test runs only in a full pass** (test index, flows). It has index 0 and no `.sweep.test.ts` suffix, and imports no project file, so neither `--changed` nor `tests.alwaysRun` selects it when a skill file changes. The file a cut would have to change is `src/tests/skill-gap-section.test.ts` (a rename with `git mv` to `skill-gap-section.sweep.test.ts`, which the default `tests.alwaysRun` pattern then takes), or the `src/tests/sweep-suffix.sweep.test.ts` detector (which would then have to know a fixed-path `readFileSync` is a tree read).
4. **`gapSection` is exported for no importer** (cut boundary). It is a helper that sits in the test file; nothing outside imports it. Left as it is; a cut that wanted the same section reader for the hook has to lift it to a leaf.

## Cut order this implies

Taken last and alone: the test has no edge to cut, so it goes where the document it guards goes. It stays at the repository root's tests as a repo-level check while both skill copies live in this repository. If `rafa-hookify` becomes its own package, it moves with `rafa-tooling-skill.md` and reads the checkout's copy by a path argument, or the checkout's copy becomes a symlink or a build output of the source copy and the test is dropped. Gap 3 (the rename) is independent of any cut and the cheapest change in the cluster.
