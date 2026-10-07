# Trace: `c19-context-page-imports.sweep.test`

Coverage: 1 of 1 cluster members read, the 1 file `docs/survey/import-graph.json` lists for `c19-context-page-imports.sweep.test`; it is tracked by `git ls-files`, and no tracked member was left unread. The file is a test (`src/tests/context-page-imports.sweep.test.ts`, 346 lines); because the cluster is that one file it was read in full, and the cluster facts below come from the graph and `docs/survey/test-index.json`.

By size this is the 19th cluster of the 32 in the graph, a one-file cluster; every cluster in the JSON has its own `trace-<cluster>.md` beside this one. The cluster is **the check that the `context/` pages are pointed at and never imported**: the whole saving of the `AGENTS.md` split rests on one property no other check sees. `CLAUDE.md` line 1 reads `Refer to @AGENTS.md`, and that `@` prefix is the harness's import form, which inlines the file into every turn, recursively; a map that pointed at its pages the same way (`@context/gates.md` and not a plain `context/gates.md`) would pull every page back into every turn and save nothing while looking exactly like a split. `AGENTS.md` itself says its pointers are "plain paths on purpose". The file reads the live maps (the repository's `AGENTS.md` and every `packages/<pkg>/AGENTS.md` there is) and asks that one question. It is its own hub, with 0 edges in or out of the graph and betweenness 0: its only imports are `node:fs`, `node:path`, `node:url` and `bun:test`.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. None has landed, as `trace-c03-config.md` to `trace-c05-sessions.md` record, and it was checked again here: `src/steps/` and `src/flows/` do not exist, no source file imports `@open-tomato/define-config` (the name appears only in prose in `src/preflight/prerequisites-md.ts` and in two tests' strings), and `gh issue view` reads #118, #119 and #71 as open. The test owns no command, step, config key or flow; it is a repository-level check on the shape of the project's own documentation.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/tests` | 1 | `context-page-imports.sweep.test.ts`: 9 cases, and four exported helpers (`maskCodeRegions`, `importReferences`, `contextPointers`, `findAgentsMaps`) |

The helpers are exported and nothing imports them (the graph has no edge into the file), so the export is for the cases beside them. `maskCodeRegions` blanks fenced blocks and inline code spans while keeping every character position, pairing backtick runs across line breaks within a paragraph (a blank line abandons an unclosed run), since the obvious per-line masker misreads a span that wraps and the header measured it: 12 bare `@` tokens by a per-line masker where a cross-line one finds 5. The `src/tests` folder has 188 members in the graph in 26 clusters.

## What crosses the boundary

No edge, in or out, in the graph: 0 outbound, 0 inbound, 0 inside. The reach is by path and by text, to files the graph does not hold:

| What it reads | By | Today |
| --- | --- | --- |
| the repository's `AGENTS.md`, and `packages/<pkg>/AGENTS.md` for each directory of `packages/` (`findAgentsMaps`) | `readFileSync` over `REPO_ROOT` | one map: the root's, 73 lines; `packages/rafa-hub` and `packages/rafa-sync-service` have no `AGENTS.md` |
| the `context/` directory beside each map, as the list of its `*.md` pages | `readdirSync` | the root's, 14 pages (`cli.md` to `workflow.md`) |
| `CLAUDE.md` at the root and in each package (`findImporters`), the files that deliberately use the import form | `readFileSync` | the root's, whose line 1 is `Refer to @AGENTS.md` |

A map counts as split when a `context/` directory sits beside it, so a package split in the future is covered the day it lands, with no name added to the file. The pointers it extracts are those of the shape `context/<page>.md` (`CONTEXT_POINTER`), read from the raw text because a pointer is written inside a code span and masking first would hide it.

Test reach, from `docs/survey/test-index.json`: index 0, source count 0, does not spawn. It imports no project file and reads the tree at run time, so it carries the sweep suffix, and the default `tests.alwaysRun` pattern (`src/**/*.sweep.test.ts`, `src/config-schema-tests.ts`) runs it beside every scoped check, which is the mechanism a sweep needs and the reason a `changed` run would never select it.

## Entry points

No member is imported from outside the cluster, no `RafaCommand` is registered from it, and it provides no hook or engine. It is run by the always-run list. Its sibling `src/tests/agents-split-accounting.test.ts` (`c18-agents-split-accounting.test`) names it in its own header as the other half: that file checks the split's arithmetic on a fixture, this one reads the live maps.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none | no command; no `rafa` command reads or checks the documentation's pointers |
| Steps with guards | **partial** | the nine cases of `src/tests/context-page-imports.sweep.test.ts` (no import-form reference on a map line; every `context/` pointer a plain path; every pointer a bijection with the sibling pages; a positive control on the `CLAUDE.md` importers; a planted import found in each split map; the masker's own cases) | the claims are source checks run by the test runner, not guards a loop applies; no registry, no guard class |
| Config section | **missing** | none | no key; the file names `AGENTS.md`, `CLAUDE.md`, `packages/` and `context/` as constants |
| Flows | **missing** | none | no multi-step path of the project |

### Commands

None. The check is a sweep: no command runs it.

### Steps with guards

Nothing registered, and no guard that refuses a run. The claims and the controls that keep each from being vacuous (every claim is a zero, and a dead needle also answers zero):

| Case | Holds | Control |
| --- | --- | --- |
| `derives a non-empty map set with the root map split` | the map set is derived from the tree and contains `AGENTS.md`, split | a map set of zero would pass every case below |
| `carries no import-form reference on any map line` | no `@`-prefixed token survives the mask on any map | `finds the deliberate import in the CLAUDE.md files it is aimed at`: the matcher must find `@AGENTS.md` in the real `CLAUDE.md` |
| `writes every context/ pointer as a plain path` | no pointer is `@`-prefixed | `reports a pointer rewritten into the import form in %s`: each split map has a pointer rewritten in memory that the matcher must find |
| `%s points at every one of its pages and at no page that is missing` | the map's pointers and its `context/` pages are the same set | "no pointer is `@`-prefixed" is satisfied by a map with no pointers, so the bijection is required |
| `masks a span without blinding the matcher beside it`, `abandons an unclosed span at the blank line rather than masking on`, `masks a code span that wraps across a line break` | the masker's three behaviours | a masker that blanked everything would make every zero vacuous |

The header records a mutation grid of sixteen legs over the file's own helpers, fifteen reddening at least one case, and names the one that stayed green (`scan-fenced-lines`) as a semantic no-op; those are the file's measurements and were not re-run here. The 9 cases pass today. The classes of #119's vocabulary do not fit: nothing here is 🔒, ⚠️ or 🧭, though the property it holds is a cost one, per turn of every session.

### Config section

None. The directory names and the `@` form are constants of the file; the cap on `AGENTS.md`'s length that the map states for itself (80 lines) is not read here.

### Flows

None of the project's.

## Gaps

Gaps 1 to 3 are the contract and would be the same for any cluster; gaps 4 to 6 are specific to this one.

1. **No `run(ctx, options)`** (commands, missing). Nothing to change in this file.
2. **No step registry or guard class** (steps, missing). The claims are checks over documents; a cut that gives the contract a document-check kind lifts them out of this file, and `src/tests/context-page-imports.sweep.test.ts` is the one to change.
3. **No consent in the context** (steps, missing). Nothing here asks a question.
4. **The header describes a tree this repository does not have** (cut boundary). It says three maps are split today and that `packages/ui` is the one that is not, and counts 13 cases and 5 bare `@` tokens; here `packages/` holds `rafa-hub` and `rafa-sync-service` with no `AGENTS.md`, one map is split, and the file has 9 cases (the `it.each` over the split maps runs once). The cases are correct for the tree, because the map set is derived; the prose is the file to change, and the bijection and planted-import cases cover a package's map the day one is added.
5. **The repository root is hard-wired through `REPO_ROOT`** (cut boundary). `findAgentsMaps(root)` and `findImporters(root)` take a root, but the cases pass `REPO_ROOT`, which is `../../` from the test's directory (`src/tests/`). A package that carries its own `AGENTS.md` and `context/` would be found only because `packages/` sits under the repository root; a cut that moves a package out of this repository takes its own copy of the test, and the root's copy then covers the root map alone.
6. **A sweep that is also the one place the harness's import form is guarded** (cut boundary; test index). Index 0 and the sweep suffix are what keep it running in scoped checks: a package that renames the suffix or drops `tests.alwaysRun` loses the only guard against an `@`-prefixed pointer, and nothing else would turn red, since every page lints clean on its own (the file's own argument). The files to change are the package's config and this one.

## Cut order this implies

The cluster has no line through it and no dependency in either direction. It stays at the repository root as a repo-level check for as long as the root has an `AGENTS.md` with a `context/` directory, and a package that gets its own `AGENTS.md` and `context/` is covered by it unchanged while the package stays under `packages/`. It moves, with `c18-agents-split-accounting.test`, only if the documentation gets a package of its own. Nothing waits on it and it waits on nothing; the one edit worth making before any cut is the header's (gap 4), since a reader checking a split by it will count the wrong maps.
