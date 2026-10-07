# Trace: `c17-agent-gates.test`

Coverage: 1 of 1 cluster members read, the 1 file `docs/survey/import-graph.json` lists for `c17-agent-gates.test`; it is tracked by `git ls-files`, and no tracked member was left unread. The file is a test (`src/tests/agent-gates.test.ts`, 163 lines); because the cluster is that one file it was read in full, and the cluster facts below come from the graph and `docs/survey/test-index.json`.

By size this is the 17th cluster of the 32 in the graph, a one-file cluster; every cluster in the JSON has its own `trace-<cluster>.md` beside this one. The cluster is **a test over the gate prose four agents carry in two copies**: `.claude/agents/<name>.md` and `src/bundled/agents/<name>.md` for `loop-implementer` (a `## Verification` section) and for `build-error-resolver`, `code-reviewer` and `tdd-guide` (a `## Rafa Gates` section, plus `tdd-guide`'s `## TDD Workflow`). It reads every command a gate section names in an inline code span and holds it to the rules `context/verification.md` states: no pipe without `set -o pipefail` or an `exit=$?` capture, no `until` or `while` paired with `sleep` inside one command, no bare full-suite `bun test`, `--changed=` present, and the two copies of each section identical. It is its own hub, with 0 edges in or out of the graph and betweenness 0: its only imports are `node:fs`, `node:path`, `node:url` and `bun:test`.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. None has landed, as `trace-c03-config.md` to `trace-c05-sessions.md` record, and it was checked again here: `src/steps/` and `src/flows/` do not exist, no source file imports `@open-tomato/define-config` (the name appears only in prose in `src/preflight/prerequisites-md.ts` and in two tests' strings), and `gh issue view` reads #118, #119 and #71 as open. The test owns no command, step, config key or flow; the rules it holds are about what agents are told to run, which is prose.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/tests` | 1 | `agent-gates.test.ts`: 28 cases over five (agent, heading) pairs |

`src/tests` has 188 members in the graph, spread over 26 clusters (`trace-c05-sessions.md` counts the same folder); this is one of the files of it that imports no project code. The cases: four `both copies carry the same gate sections` (one per agent), four rule cases for each of the five sections (`names --changed= for bun test`, `never runs a bare full-suite bun test`, `never pipes a command without set -o pipefail or an exit=$? capture`, `never pairs until/while with sleep inside one command`: 20), and four `states the exit-code and no-polling rules` cases over the four `Verification` and `Rafa Gates` sections. Helpers are `readCopies`, `extractSection` (throws when a heading is missing, so a rename fails loud and does not check nothing), `codeSpans` and `commandSpans` (spans whose first word is a command, minus a span followed by prose such as "runs files one after another").

## What crosses the boundary

No edge, in or out, in the graph: 0 outbound, 0 inbound, 0 inside. The reach is by path, to non-TypeScript files the graph does not hold:

| What it reads | Where | By |
| --- | --- | --- |
| `.claude/agents/{loop-implementer,build-error-resolver,code-reviewer,tdd-guide}.md` | the repository's own agent files, used by the loop and by this repository's sessions | `CLAUDE_AGENTS_DIR`, `readFileSync` |
| `src/bundled/agents/{same four}.md` | the copies rafa ships (the build script runs `cp -R src/bundled dist/bundled`) and the roster reads as the `rafa` tier (`src/agents/roster.ts`, `c03-config`) | `BUNDLED_AGENTS_DIR`, `readFileSync` |

Today the four pairs are byte-identical (`cmp`), and so are the pair for `doc-updater` and the pair for `qa-bug-reporter`, which the test does not read; `.claude/agents/` has 12 agent files and `src/bundled/agents/` 6. The rules are those of `context/verification.md` (the redirect and `exit=$?` form, and "Never use `until` or `while` + `sleep` to poll for completion"), which the test states by name in its header and does not import.

Test reach, from `docs/survey/test-index.json`: index 0, source count 0, does not spawn. No source file is in its reach, so no changed `.ts` file selects it; it does not carry the sweep suffix either, so the default `tests.alwaysRun` pattern (`src/**/*.sweep.test.ts`, `src/config-schema-tests.ts`) does not add it. It reads fixed paths and not a tree walk; by its header, `src/tests/sweep-suffix.sweep.test.ts` asks for the suffix of a test that calls `git ls-files` or walks the repository root constant, which this one does not. It runs in the full suite only.

## Entry points

No member is imported from outside the cluster, no `RafaCommand` is registered from it, and it provides no hook or engine. Its subject is the two directories above: what is read from `src/bundled/agents/` is served to a loop session through the roster, and `src/tests/bundled-tier.test.ts` reads the same folder as the shipped tier (the agent check over `src/bundled/agents`), not for gate prose.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none | no command; the agents it reads are served through the roster (`src/agents/roster.ts`), not defined here |
| Steps with guards | **partial** | `src/tests/agent-gates.test.ts` holds six rules over the gate sections of four agents (identical copies, `--changed=` named, no bare full-suite `bun test`, no unguarded pipe, no polling, and the rules stated in prose) | the rules are checks over prose a session reads, not guards a loop run applies; no registry, no guard class, and only the `.claude` copy is held to the command rules (the bundled copy is held equal to it) |
| Config section | **missing** | none | no key; the four agents, the five (agent, heading) pairs and the rules are constants of the file |
| Flows | **missing** | none | no multi-step path; the sequence is read two copies, slice a section, scan its spans |

### Commands

None. The commands the test inspects are the gate commands an agent is told to run (`bunx tsc --noEmit`, `bunx eslint <changed files>` and `bun test --changed=<base>`, each read for its exit code through a redirect and `exit=$?` or under `set -o pipefail`), which are rafa's gates and not rafa commands.

### Steps with guards

The six rules, and what each refuses:

| Rule | What it refuses | Over |
| --- | --- | --- |
| two copies identical | a `## Verification`, `## Rafa Gates` or `## TDD Workflow` section that differs between `.claude/agents/<name>.md` and `src/bundled/agents/<name>.md` | five (agent, heading) pairs; four cases |
| `--changed=` named | a gate section that never says `bun test --changed=` | five sections |
| no bare full-suite `bun test` | a command span that is exactly `bun test` | five sections |
| no unguarded pipe | a command span holding a pipe and neither `pipefail` nor `exit=$?` | five sections |
| no polling | a command span with `until` or `while` and `sleep` together | five sections |
| rules stated in prose | a `Verification` or `Rafa Gates` section missing `set -o pipefail`, `exit=$?` or "never poll with ... until ... while ... sleep" | four sections; four cases |

The classes of #119's vocabulary do not fit: nothing here is 🔒, ⚠️ or 🧭; the gates the agents run (`changed`, `related`, the full suite) are rafa's, and `context/verification.md` is their authority.

### Config section

None. The agent list, headings and rules are constants of the file; `tests.alwaysRun` (`src/config-schema-tests.ts`) decides whether the file runs in a scoped check, and it does not name this one.

### Flows

None of the project's.

## Gaps

Gaps 1 to 3 are the contract and would be the same for any cluster; gaps 4 to 7 are specific to this one.

1. **No `run(ctx, options)`** (commands, missing). Nothing to change in this file.
2. **No step registry or guard class** (steps, missing). The gates an agent names are rafa's own steps in prose; a cut that registers the loop's gates as steps makes `context/verification.md` and the six rules generated from, or checked against, the step list, and the files to change are this one and the two agent folders.
3. **No consent in the context** (steps, missing). Nothing here asks a question.
4. **The test is not selected by a change to the files it reads** (cut boundary; test index). It imports no project file and has no sweep suffix, so an edit to `.claude/agents/code-reviewer.md` or `src/bundled/agents/tdd-guide.md` is not followed by this test in a `changed` run, only in the full suite. A cut either names it in `tests.alwaysRun`, or renames it `agent-gates.sweep.test.ts` (the file to change is this one), or keeps `related` as the habit for edits under `.claude/agents/` and `src/bundled/agents/`.
5. **Only four of the six bundled agents are in the test's list** (steps, partial). `doc-updater` and `qa-bug-reporter` have copies in both folders (identical today) and their sections are not read. A cut that makes `GATE_SECTIONS` derive from the folder (every bundled agent with a gate heading) changes `src/tests/agent-gates.test.ts` alone.
6. **Two copies of one text** (cut boundary). `.claude/agents/` is the repository's own set and `src/bundled/agents/` what ships under `@open-tomato/rafa`; the test is what keeps four of the six copies from drifting. A cut that makes one a build-time copy of the other removes the identical-copies cases and the `BUNDLED_AGENTS_DIR` constant (this file), and `package.json`'s `build` script (`cp -R src/bundled dist/bundled`) is the place the copy would be made.
7. **The rules are a second statement of `context/verification.md`** (cut boundary). The test names the rules by prose in its header and by regular expression in its cases; a change to the gate form on the page (the `exit=$?` redirect, the polling rule) changes the cases by hand. The page and this file are the two to change together.

## Cut order this implies

The cluster has no line through it and no dependency in either direction. It stays at the repository root as a repo-level check as long as the agents are the root's, and moves with the agents if the roster and `src/bundled/agents/` become a package of their own (`c03-config` holds `src/agents/roster.ts`). The one change worth making before any cut is gap 4: a test that guards prose a session is served should run when that prose changes, and it does not run in a scoped check today.
