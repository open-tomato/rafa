# Trace: `c18-agents-split-accounting.test`

Coverage: 1 of 1 cluster members read, the 1 file `docs/survey/import-graph.json` lists for `c18-agents-split-accounting.test`; it is tracked by `git ls-files`, and no tracked member was left unread. The file is a test (`src/tests/agents-split-accounting.test.ts`, 998 lines); because the cluster is that one file its header, fixture and helpers were read in full and its 12 cases through their titles and the plants they build, and the cluster facts below come from the graph and `docs/survey/test-index.json`.

By size this is the 18th cluster of the 32 in the graph, a one-file cluster; every cluster in the JSON has its own `trace-<cluster>.md` beside this one. The cluster is **the arithmetic of an `AGENTS.md` split, checked against a miniature fixture and not against the live files**: splitting a root `AGENTS.md` into `context/` pages is a move, and a move is the edit shape no other gate sees (every page lints clean on its own, and nothing compares two files), so the file holds four independent readings of a split (the partition, the range derivation, the arithmetic and the roster) with a positive control for each and a negative case for each way a split goes wrong. It is its own hub, with 0 edges in or out of the graph and betweenness 0: its only imports are `node:fs`, `node:os`, `node:path` and `bun:test`.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. None has landed, as `trace-c03-config.md` to `trace-c05-sessions.md` record, and it was checked again here: `src/steps/` and `src/flows/` do not exist, no source file imports `@open-tomato/define-config` (the name appears only in prose in `src/preflight/prerequisites-md.ts` and in two tests' strings), and `gh issue view` reads #118, #119 and #71 as open. The test owns no command, step, config key or flow; the helpers it defines (`accountForSplit`, `deriveBodies`, `balanceOf`, `assignHeadings`) are not exported and no file imports them.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/tests` | 1 | `agents-split-accounting.test.ts`: a 12-case suite, a five-page fixture (`tooling`, `security`, `verification`, `gates`, `workflow`) whose source is built by concatenation and whose pages are rebuilt by extraction, and the four readings |

At 998 lines the file is past the soft 800-line ceiling of the coding rules; `context/source.md` says the cap is a rule about modules and not about their tests ("Multiple colocated `*.test.ts` files exceed the cap by design"), and 723 of the lines come before the suite: the header note, the fixture and the helpers. The `src/tests` folder has 188 members in the graph in 26 clusters.

## What crosses the boundary

No edge, in or out, in the graph: 0 outbound, 0 inbound, 0 inside. It also reads nothing in the repository by path: the pre-split document is `sourceLines(PAGES)`, a constant built in the file, and every page is written to a `mkdtemp` directory (`ralph-split-`) under `tmpdir()` and read back, then removed in `afterAll`. The header says why: the live pages are not a stable subject (`context/` grows with every promoted finding) and the pre-split root file exists only in git history, so a test reaching for it would measure one commit and not the procedure.

What the fixture models is the split of a root map into pages, with the shape measured on the real one at the commit that landed it ("2,461 source lines == 2,437 carried onto five pages ... + 4 separators + 20 lines of residue"). The header's numbers, and the names `agentic-research`, `packages/service`, `packages/web` and `packages/ui` in it, are the origin repository's; here `AGENTS.md` is 73 lines with 14 pages under `context/`, and `packages/` holds `rafa-hub` and `rafa-sync-service`, neither with an `AGENTS.md`.

Test reach, from `docs/survey/test-index.json`: index 0, source count 0, does not spawn. No changed file selects it and it has no sweep suffix, which suits it: it reads no repository file, so there is no change that should select it except an edit to the test.

## Entry points

No member is imported from outside the cluster, no `RafaCommand` is registered from it, and it provides no hook or engine. It is run in the full suite and by a person editing the file. Its sibling `src/tests/context-page-imports.sweep.test.ts` (`c19-context-page-imports.sweep.test`) names it in its header as the other half: this file checks the split's arithmetic, that file reads the live maps.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none | no command; there is no `rafa` command that accounts a split, and none is asked for |
| Steps with guards | **missing** | none | the four readings are test helpers over a fixture; nothing runs them against a real split, and no guard in a loop run reads them |
| Config section | **missing** | none | no key; the fixture's pages and headings are constants of the file |
| Flows | **missing** | none | the one sequence (plant a split, read it back, account for it) is the test's own |

### Commands

None. The procedure is a function over line arrays; the header says it is "what those tasks get to run instead of an ad-hoc probe" for the two further splits it names, and no command or script in the repository wraps it.

### Steps with guards

None registered, and none that guard a run. The four readings and the controls that make them mean something:

| Reading | Sees | Cannot see | Control |
| --- | --- | --- | --- |
| the partition (`accountForSplit`) | a dropped line, a duplicated line, a page out of order, a lost separator | a swallow: one page's section folded into the page above it moves no byte | the owner histogram is held against the page line counts, so a walk that consumed nothing is a red |
| the range derivation (`deriveBodies`) | a swallow: each page rebuilt from the source's own headings, ending at the next heading of any level the page was not assigned | a page that matches itself | each range re-run shifted by one in both directions and required to differ |
| the arithmetic (`balanceOf`) | page lines plus residue plus separators (pages minus one) against the source total | which line is wrong | the separator count at pages minus one, since the last section leaves no trailing blank |
| the roster (`assignHeadings`) | a swallow, from the heading side: one page per tag, every source heading on exactly one page or in the residue | a changed line inside a page | the fixture guard case, which asserts the traps (the nested `###`, the adjacent pair on one page, the residue running into the first page, the shebang inside a fence) are still there |

The header records a mutation grid: 15 mutations of the file's own helpers, each run twice, each reddening at least one case, the union of the red sets covering all 12. These are the file's measurements and were not re-run for this survey; the 12 cases pass today (`bun test src/tests/agents-split-accounting.test.ts`). The classes of #119's vocabulary do not fit: nothing here is 🔒, ⚠️ or 🧭.

### Config section

None. `AGENTS.md` and `context/` are read by `CLAUDE.md` and by people, and no setting names them.

### Flows

None of the project's.

## Gaps

Gaps 1 to 3 are the contract and would be the same for any cluster; gaps 4 to 6 are specific to this one.

1. **No `run(ctx, options)`** (commands, missing). Nothing to change in this file; if the accounting became a command (`rafa` reading a split), it would be a `RafaCommand` in `src/commands/` registered in `CORE_COMMANDS` (`src/commands/index.ts`), with this file's helpers moved to a module the command and the test share.
2. **No step registry or guard class** (steps, missing). The readings are checks over documents, not steps; a cut that gives the contract a document-check kind adds it there, and this file's four readings are the first instances. Nothing in the loop calls them today.
3. **No consent in the context** (steps, missing). Nothing here asks a question.
4. **The helpers are private to a test** (cut boundary). `accountForSplit`, `deriveBodies`, `balanceOf` and `assignHeadings` are not exported, so the procedure cannot be run against `AGENTS.md` and `context/` of this repository: the 73-line map and its 14 pages are held by `src/tests/context-page-imports.sweep.test.ts` (no `@` import; every page pointed at) and by no accounting. A cut that wants the live split accounted moves the four helpers to a module (for example under `src/tests/`) and adds a case reading the real map; the file to change is this one, and the pre-split source it needs lives only in git history, as its header says.
5. **The file carries its origin's facts** (cut boundary). The header's counts (2,461 and 2,437 lines, five pages), the `ralph-split-` directory prefix and the `packages/service`, `packages/web` and `packages/ui` it names are from the repository it was ported from (it entered in `f9954e2`, `Phase 0 — package, parity, cutover (#1)`, the commit `docs/survey/provenance.md` counts as the import), and none matches this tree. The fixture is unaffected and the claims about the procedure hold; the prose is the file to change when it is next touched.
6. **998 lines in one file** (cut boundary; size). Past the 800-line ceiling, and exempt by `context/source.md` as a test; if the helpers move out (gap 4) most of the 723 lines before the suite go with them and the question of the cap does not arise.

## Cut order this implies

The cluster has no line through it and no dependency in either direction. It stays at the repository root as a repo-level check on the documents' structure for as long as the root has an `AGENTS.md` with a `context/` directory, and it moves, with `c19-context-page-imports.sweep.test`, to whichever package owns the root's documentation if there is one. There is nothing in it for a first cut to take apart, and nothing that waits on it; if the procedure is ever to run on the real split (gap 4), that change is made before any cut that moves a page, since a move is the edit it exists to check.
