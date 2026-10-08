# Trace: `c15-config-schema-readings`

Coverage: 1 of 1 cluster members read, the 1 file `docs/survey/import-graph.json` lists for `c15-config-schema-readings`; it is tracked by `git ls-files`, and no tracked member was left unread. The file (`src/config-schema-readings.ts`, 265 lines) is source with no test; it was read in full for its exports, and it has none.

By size this is the 15th cluster of the 32 in the graph, a one-file cluster; every cluster in the JSON has its own `trace-<cluster>.md` beside this one. The cluster is **a module that is one comment**: `src/config-schema-readings.ts` has no import, no export and no statement (`grep -c "^import\|^export"` reads 0), and holds the per-section readings of rafa's settings that `src/config-schema.ts` moved out when it neared the 800-line cap (the note in `config-schema.ts` records 780 lines at the move; `config-schema.ts` is 599 lines now). For each section the schema opens after the spec's first block it argues once what the spec left to the reader: which default, why null or never null, and why a key is or is not a `CommandLineSetting`. It is its own hub, with 0 edges in or out of the graph and betweenness 0, which is exactly what a file with no import and no export is: three source files name it in their notes (`src/config-schema.ts`, `src/config.ts` and `src/cleanup/branches.ts`) and the graph, which follows imports, sees none of it.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. None has landed, as `trace-c03-config.md` records for the config it belongs to, and it was checked again here: `src/steps/` and `src/flows/` do not exist, no source file imports `@open-tomato/define-config` (the name appears only in prose in `src/preflight/prerequisites-md.ts` and in two tests' strings), and `gh issue view` reads #118, #119 and #71 as open. The file owns no command, step or flow, and no key of its own; it argues the readings of keys that `src/config-schema.ts` and its section files declare, and #118's schema would take over that prose.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src` | 1 | `config-schema-readings.ts`: one block comment with 13 `##` headings |

The headings are the sections whose readings it argues: `pr`, `board`, `roadmap`, `release`, `cleanup`, `dangerous`, `status`, `effort`, `claims`, `tiers`, the `routing` setting, `task` and `learning`. Two of them, `pr` and `release`, are a pointer only: their readings sit in `src/config-schema-release.ts`'s note beside their fields. The readings of the `tests` and `triage` sections sit in `config-schema-tests.ts` and `config-schema-triage.ts`, as `src/config.ts` records, and `config-schema-hub.ts` and `-wrap-up.ts` carry their own sections' notes. Of the seven `src/config-schema*.ts` source files this is the only one outside `c03-config`, which holds `config-schema.ts`, the five section files and seven tests; the graph put it alone because no other file of the family imports it.

## What crosses the boundary

No edge, in or out, in the graph: 0 outbound, 0 inbound, 0 inside. Three references cross by name in prose, none of them an import:

| Referrer | Cluster | What it says |
| --- | --- | --- |
| `src/config-schema.ts` (lines 32, 47, 86) | `c03-config` | the readings of each later section's spec "are argued in `config-schema-readings.ts`", and the file's own growth history |
| `src/config.ts` (line 48) | `c03-config` | the same pointer, "a note that exports nothing", with the exceptions that sit in the section files |
| `src/cleanup/branches.ts` (line 60) | `c05-sessions` | `cleanup.keep` entries are kept as written (`src/config-schema-readings.ts`) and `Bun.Glob` reads them |

Test reach, from `docs/survey/test-index.json`: no test reaches it (0 tests, 0 from other folders), and there is no `config-schema-readings.test.ts`; `src/config-schema.test.ts` pins the key set the readings are about, not the prose.

## Entry points

No member is imported from outside the cluster, no `RafaCommand` is registered from it, and it provides no hook or engine. It is read by people: the three pointers above send a maintainer from a key's declaration to the argument for it. The file's reason to exist is the 800-line convention of `context/source.md`, which says "a note that has outgrown its module can move".

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none | the file holds no code; `rafa cleanup` and `rafa status` have their readings argued here but are defined in `src/commands/cleanup.ts` and `src/commands/status.ts` (`c05-sessions`) |
| Steps with guards | **missing** | none | the readings of `dangerous.*` and `status.notice` say what a flag-gated refusal and a notice are, and the refusals are in the code of the commands that read the settings, not here |
| Config section | **partial** | the prose for thirteen sections, here; the schemas in `src/config-schema.ts` (599 lines) and its five section files (`-hub`, `-release`, `-tests`, `-triage`, `-wrap-up`) | no schema, no default, no reader: this file is the argument beside the key and carries none of them, so a section cut out of `config-schema.ts` has to carry its argument by hand |
| Flows | **missing** | none | no path; the file runs nothing |

### Commands

None. The file names `rafa cleanup` ("the command rafa-94 builds lists local branches and worktrees"), `rafa status` and `rafa self-update` as readers of settings, and defines none.

### Steps with guards

None. The `dangerous` section is the file's one text about guards: each of its settings "turns a refusal off for every run, where a flag turns it off for the one run a person typed it on", `dangerous.acceptStaleRefs` for check 4 of the readiness gate and `dangerous.selfUpdateDuringLoop` for `rafa self-update`. That is the ⚠️ class of #119's vocabulary stated in the project's own words (`trace-c05-sessions.md` places `selfUpdateDuringLoop` with `src/commands/self-update.ts`), with no code behind it in this file.

### Config section

The cluster is the argument for a slice, not the slice. What it argues, by section, and where the key is declared:

| Section | Keys it argues | Declared in |
| --- | --- | --- |
| `board` | `trustedAuthors` (default empty), `relationships` (default `labels`) | `src/config-schema.ts` |
| `roadmap` | `issue` (default null, a number) | `src/config-schema.ts` |
| `cleanup` | `staleDays` (30), `worktreeIdleDays` (7), `keep` (empty) | `src/config-schema.ts` |
| `dangerous` | `acceptStaleRefs` (false), `selfUpdateDuringLoop` (false); `acceptVersionCollision` by reference | `src/config-schema.ts`; `acceptVersionCollision` in `src/config-schema-release.ts` |
| `status` | `notice` (true) | `src/config-schema.ts` |
| `effort` | `busyTimeoutMs` (5000), `sync` (`local`) | `src/config-schema.ts` |
| `claims` | `staleAfter` (`3d`), `ahead` (`off`) | `src/config-schema.ts` |
| `tiers`, `routing` | `tiers.rafa` (`on`), `tiers.skills` and `tiers.agents` (empty maps), `routing` (the five rows of `DEFAULT_ROUTING`) | `src/config-schema.ts` |
| `task` | `skills` (`planner`, a `CommandLineSetting`), `lessons` (`on`) | `src/config-schema.ts` |
| `learning` | three floors, numbers and never null: `bless.minConfidence`, `promote.after`, `promote.minConfidence` | `src/config-schema.ts` |

Defaults and the closed lists are the ones the note states; what a value may be stays `config-sections.ts`'s to say, as the note repeats for each section. The `pr` and `release` entries are pointers to `src/config-schema-release.ts`. The note's rule used across sections is that a setting is no `CommandLineSetting` for the reason the `pr` section gives; `task.skills` is the one setting it argues that is one.

### Flows

None. The file is read, not run.

## Gaps

The cluster is one note, so the gaps are about where its argument goes in a cut. Gaps 1 and 2 are the contract and would be the same for any cluster; 3 to 5 are specific to this one.

1. **No `run(ctx, options)`** (commands, missing). Nothing to change in this file; the commands whose settings it argues change in `c05-sessions` and `c03-config` (`src/commands/cleanup.ts`, `status.ts`, `self-update.ts`, `plan create`).
2. **No step registry or guard class** (steps, missing). The `dangerous` section's argument is the closest text in the repository to a guard's `passedBy`; a cut writes the class beside each guard in the package that owns it, and edits this file's `dangerous` section to stop saying where the section's settings are read.
3. **The readings are not tied to the keys by any import** (config, partial). The file has no import, so nothing breaks when a key is renamed or removed in `src/config-schema.ts`; the prose goes stale silently, and `src/config-schema.test.ts` (which pins the key set) does not read it. A cut either moves each section's note into the section file that declares the key, as `config-schema-release.ts`, `-tests.ts`, `-triage.ts`, `-hub.ts` and `-wrap-up.ts` already do, or gives the file a test that its headings are the sections of `SETTINGS`.
4. **A section with no file of its own has its argument here** (config, partial). `cleanup`, `status`, `claims`, `effort`, `board`, `roadmap`, `tiers`, `task`, `learning` and `dangerous` are declared in `src/config-schema.ts` and argued here; a package that takes one (`cleanup` and `status` with `c05-sessions`, `effort` with `c04-sqlite`, per `trace-c05-sessions.md` and `trace-c04-sqlite.md`) has to take its readings with it, and the file is cut in pieces, one per package. `src/config-schema.ts` (lines 32, 47 and 86), `src/config.ts` (line 48) and `src/cleanup/branches.ts` (line 60) are the three notes that point at it and change when it does.
5. **The file is a module by name only** (cut boundary). It holds no code, is included in the root `tsconfig.json` as a source file (`include: ["src", ...]`), and counts as one of the 646 non-test `.ts` files under `src/`; a cut that moves its content into the section files or a `context/` page lets it be deleted with the three pointers rewritten, and no import changes.

## Cut order this implies

The cluster has no line through it and no dependency in either direction, so it moves last and without risk: after each section's schema has a home (the config package's `src/config-schema*.ts` for most, then `cleanup` and `status` with `c05-sessions`), its text for that section moves to the same file, and what remains is deleted. The first move is gap 3's: bring the four sections that have the most readers outside `c03-config` (`cleanup`, `status`, `dangerous`, `effort`) into their section files, since those are the ones a package cut would otherwise strand.
