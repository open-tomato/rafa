# Trace: `c03-config`

Coverage: 180 of 180 cluster members read, the 180 files `docs/survey/import-graph.json` lists for `c03-config`; all 180 are tracked by `git ls-files`, and no tracked member was left unread. The 85 non-test members (82 source, 3 test support) were read for their module notes and exports; the 95 test files were read through the graph and `docs/survey/test-index.json` only.

The largest cluster in the import graph with no trace file once `trace-c01-github.md` and `trace-c02-active.md` exist: 180 files, 85 of them source or support and 95 tests, 518 edges inside it. The cluster is **settings and the inventory read through them**: the config (`src/config.ts`, `config-load.ts`, `config-sections.ts`, `config-schema.ts` and its section files), the module loader and manifest (`src/modules/`), the skill and agent inventory with its three tiers and routing (`src/inventory/`, `src/tiers/`, `src/agents/`), `rafa doctor` with its deep readings, the plan risk and needs readings (`src/plan/risk*`, `src/plan/needs.ts`), the effort collector and the hub contact (`src/effort/collect.ts`, `src/effort/sync/`), and `src/index.ts`, the package's `.` entry. Its hub is `src/config.ts` (61 in-cluster edges, `config-sections.ts` close behind with 59); the highest betweenness belongs to `src/config-schema.ts` (18,676, rank 22 of the whole graph), `src/commands/doctor.ts` (18,030, rank 23) and `src/config.ts` (14,853, rank 25).

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. Neither has landed: `src/steps/` and `src/flows/` do not exist, `package.json` has no `dependencies` and no source file imports `@open-tomato/define-config` (the name appears only in prose in `src/preflight/prerequisites-md.ts`), there is no `rafa config show`, and `src/config-load.ts` still does its own merge of `.rafa/config.yaml` into `SETTINGS`. This cluster is the one #118 rewrites: it replaces `config-load.ts`'s merge with `createLoader`, adds a `@open-tomato/rafa/config` subpath, a Standard Schema object over `SETTINGS`, and the `dangerous.*` and `merge.*` sections. So every "present" below means present in today's shape, and every gap is what a cut has to change to reach the contract.

## Members and folders

85 non-test members by folder:

| Folder | Files | Holds |
| --- | --- | --- |
| `src` | 12 | the config: `config.ts`, `config-load.ts`, `config-sections.ts`, `config-items.ts`, `config-locked.ts`, `config-schema.ts` and five section files (`-hub`, `-release`, `-tests`, `-triage`, `-wrap-up`); and `index.ts`, the library entry |
| `src/commands` | 12 | `doctor.ts` and its eleven side files: `doctor-deep*.ts` (six), `doctor-tiers.ts`, `doctor-effort-sync.ts`, `doctor-release.ts`, `doctor-render.ts`, `doctor-description.ts` |
| `src/inventory` | 7 | `index.ts` (`buildInventory`), `trees.ts`, `plugins.ts`, `disabled.ts`, `mcp.ts`, `record.ts`, `show.ts` |
| `src/inventory/search` | 6 | the search runner: `index.ts`, `rank.ts`, `scratch.ts`, `prompt.ts`, `block.ts`, `quote.ts` |
| `src/tiers` | 6 | `resolve.ts`, `serve.ts`, `routing.ts`, `routing-table.ts`, `delivery.ts`, `skill-names.ts` |
| `src/plan/risk` | 4 | `accounts.ts`, `commands.ts`, `patterns.ts`, `secrets.ts` |
| `src/effort` | 4 | `collect.ts`, `collect-args.ts`, `collect-skills.ts`, `skill-use.ts` |
| `src/commands/agent`, `src/commands/skill` | 3 + 3 | `agent list`, `show`, `vendor`; `skill list`, `show`, `search` |
| `src/schema` | 3 | `agent.ts`, `provenance.ts`, `tiers.ts` |
| `src/start` | 3 | `plan-path.ts`, `preflight-sync.ts`, `risk-total.ts` |
| two files each | 2 × 8 | `src/agents` (`roster.ts`, `vendorable.ts`), `src/check` (`references.ts`, `shell-lines.ts`), `src/commands/plan` (`needs.ts`, `risk.ts`), `src/effort/sync` (`select.ts`, `contact.ts`), `src/modules` (`load.ts`, `manifest.ts`), `src/plan` (`needs.ts`, `risk.ts`), `src/utils` (`agent-definition.ts`, `session-env.ts`) |
| one file each | 8 | `src/adapters/registry.ts`, `src/commands/module/list.ts`, `src/effort/store/settings.ts`, `src/project/pre-init-dirs.ts`, `src/task/skill-index.ts`, `src/tests/parity-fixture.ts` (support), and the two `sync.ts` fixtures under `src/modules/testdata/` (support) |

The full member list, with the 95 test files, is the `members` array of `c03-config` in `docs/survey/import-graph.json`. The cluster spans 31 folders and splits most of the ones it shares:

| Folder | Here | Of | The rest |
| --- | --- | --- | --- |
| `src/commands` | 24 | 86 | `c01-github` 29, `c06-command` 11, `c05-sessions` 10, `c08-cli-capture` 6, `c04-sqlite` 4, `c11-frontmatter` 2 |
| `src/start` | 6 | 122 | `c02-active` 68, `c08-cli-capture` 16, `c07-index` 13, `c09-version` 6, `c05-sessions` 5, `c10-index` 4, `c01-github` 3, `c06-command` 1 |
| `src/tests` | 11 | 188 | `c08-cli-capture` 71, `c02-active` 26, `c01-github` 25, and 15 more clusters |
| `src/effort` | 5 | 53 | `c04-sqlite` 28, `c05-sessions` 12, `c02-active` 5, `c12-index` 2, `c10-index` 1 |
| `src/plan` | 3 | 14 | `c02-active` 10, `c01-github` 1 |
| `src/schema` | 4 | 17 | `c11-frontmatter` 10, `c07-index` 2, `c02-active` 1 |
| `src/commands/plan` | 4 | 31 | `c01-github` 10, `c05-sessions` 6, `c02-active` 6, `c06-command` 3, `c07-index` 2 |
| `src/project` | 4 | 25 | `c08-cli-capture` 15, `c05-sessions` 3, `c01-github` 2, `c10-index` 1 |

Four folders sit whole in the cluster (`src/agents`, `src/modules`, `src/tiers`, `src/inventory/search`), with the two `src/modules/testdata` folders and `src/inventory` but for three files; the `src/config*.ts` family is split by one file: `src/config-readers.ts` is in `c09-version` and `src/config-schema-readings.ts` is alone in `c15-config-schema-readings` (a note that exports nothing and so has no edge).

## What crosses the boundary

Non-test imports leaving the cluster (153 edges, 50 distinct files), by the cluster they reach:

| Target cluster | Edges | Distinct files | Files a cut would have to give `c03-config` access to |
| --- | --- | --- | --- |
| `c02-active` | 32 | 18 | `src/adapters/output/active.ts`, `src/adapters/learning/local.ts`, `src/adapters/planner/claude.ts`, `src/effort/{attribution,classify}.ts`, `src/learning/identity.ts`, `src/plan.ts`, `src/plan/{blocks,index,parse}.ts`, `src/preflight/{first-dispatch,prerequisites-md,run}.ts`, `src/start.ts`, `src/start/dispatch.ts`, `src/utils/{claude,declaration,tracker}.ts` |
| `c05-sessions` | 26 | 16 | `src/commands/doctor-cleanup.ts`, `src/commands/plan/plan-files.ts`, `src/loop/sessions.ts`, `src/pr/types.ts`, `src/project/{bin-path,scope}.ts` |
| `c06-command` | 19 | 15 | `src/cli/command.ts`, `src/cli/modules.ts`, `src/cli/prompt/terminal.ts`, `src/adapters/output/{events,json,stream}.ts`, `src/inventory/browse.ts` |
| `c04-sqlite` | 17 | 9 | `src/effort/store/{legacy,ndjson,skill-invocations,sqlite,types}.ts`, `src/effort/{commits,report,session-log}.ts`, `src/effort/sync/file.ts`, `src/cli/version.ts`, `src/commands/{doctor-effort-schema,doctor-install}.ts` |
| `c01-github` | 16 | 10 | `src/adapters/tracker/github.ts`, `src/board/status.ts`, `src/commands/{doctor-board,doctor-previous,doctor-refs,init-board}.ts`, `src/commands/plan/spec-route.ts`, `src/pr/git.ts` |
| `c11-frontmatter` | 15 | 13 | `src/check/run.ts`, `src/schema/{frontmatter,skill,stack}.ts` |
| `c10-index` | 9 | 7 | `src/ports/index.ts`, `src/adapters/output/text.ts`, `src/adapters/tracker/local.ts` |
| `c07-index` | 9 | 5 | `src/pr/{index,preflight-items,provider}.ts`, `src/board/trust.ts`, `src/schema/project-id.ts` |
| `c12-index` | 5 | 4 | `src/effort/store/index.ts`, `src/effort/session-log-dirs.ts` |
| `c09-version` | 5 | 3 | `src/config-readers.ts`, `src/release/enabled.ts`, `src/commands/release/{status,status-fragments}.ts` |

Non-test imports entering the cluster (370 edges, 45 distinct members) come from `c02-active` (82), `c01-github` (80), `c06-command` (40), `c05-sessions` (38), `c04-sqlite` (33), `c07-index` (31), `c09-version` (22), `c08-cli-capture` (21), `c10-index` (13), `c11-frontmatter` (8) and `c12-index` (2). That is more than twice what leaves: the cluster is depended on, not dependent, which is what a settings cluster should be and why it cannot be cut late.

Two links are specific to this cluster:

- **The doctor is split four ways.** Its 23 `src/commands/doctor*.ts` files sit 12 here, 8 in `c01-github` (the board readings: `doctor-blocked`, `-boards`, `-board`, `-epics`, `-marks`, `-relations`, `-previous`, `-refs`), 2 in `c04-sqlite` (`doctor-effort-schema`, `doctor-install`) and 1 in `c05-sessions` (`doctor-cleanup`). The 12 doctor files here import 38 edges into eight other clusters (`c01-github` 8, `c07-index` 7, `c02-active` 7, `c05-sessions` 6, `c04-sqlite` 4, `c09-version` 3, `c06-command` 2, `c11-frontmatter` 1); it is the one place every domain's reading meets.
- **The config reaches out.** The schema's readers import `src/learning/identity.ts` and `src/utils/declaration.ts` (`c02-active`) and `src/pr/types.ts` (`c05-sessions`) from `config-sections.ts`, `src/tiers/routing.ts` from `config-schema.ts` (`DEFAULT_ROUTING`), and `src/adapters/output/active.ts` from `config-load.ts`. So the config is not a leaf: a package that owns it needs those values (the confidence range, the merge methods, the budget parser, the default routing) and the active output moved down or inverted.

Test reach, from `docs/survey/test-index.json`: the 95 member tests have indexes from 0 to 128 with a median of 22; 14 are at 10 or below, 62 between 11 and 63, 13 between 64 and 127 and 6 at the 128 ceiling. 18 of them spawn a process, 14 of those through `src/tests/cli-capture.ts`. The six at the ceiling are `src/index.test.ts`, `src/commands/doctor-release.test.ts`, `src/commands/plan/needs.test.ts`, `src/commands/skill/search.test.ts`, `src/commands/tiers-scratch.test.ts` and `src/commands/issue/issue-tracker.test.ts`; the config's own tests are small (`config.test.ts` and `config-schema.test.ts` at 21, `config-sections.test.ts` at 5), but the Known suspects table in `docs/survey/import-graph.md` records that each of the six schema modules is reached by 756 of the 908 tests, 743 from other folders. A test of the schema is cheap; a schema change is not.

## Entry points

An entry point is a member imported from outside the cluster, or a command registered from it. 56 members are imported from outside the cluster, 45 of them by at least one non-test file. Ten registered commands are in the cluster; one more is built from a factory here, and one more runs its engine from a file here (`init` reads the cluster's config files and routing defaults but owns none of its engine).

### Registered commands

Each is a default export `createXCommand()` of a `RafaCommand`, listed in `CORE_COMMANDS` (`src/commands/index.ts`, imports at lines 325–401, the array at 432).

| Command | File | Outputs | Spends | Refusal exit |
| --- | --- | --- | --- | --- |
| `doctor` | `src/commands/doctor.ts` | text, json | no | exit 1 on a config `loadConfig` refuses, a plan named that is no file, a malformed `auto` or `start` item, a halted preflight (a failed required item) or a failing row; `--deep` never changes it |
| `plan risk` | `src/commands/plan/risk.ts` | text, json | no | exit 1 only under `--strict` with a `high` finding |
| `plan needs` | `src/commands/plan/needs.ts` | text, json | no | exit 1 on a plan not found, a bad `--source`, a config refused, and with `--missing` when anything is kept |
| `skill list` | `src/commands/skill/list.ts` | text, json | no | exit 1 on a bad `--source` or `--state`, a flag with no value, `-i` with `--output=json` |
| `skill show` | `src/commands/skill/show.ts` | text, json | no | exit 1 on an unknown name |
| `skill search` | `src/commands/skill/search.ts` | text, json | `unless --no-model`, one search session | exit 1 on a blank question |
| `agent list` | `src/commands/agent/list.ts` | text, json | no | as `skill list`, and a config refused |
| `agent show` | `src/commands/agent/show.ts` | text, json | no | exit 1 on an unknown name |
| `agent vendor` | `src/commands/agent/vendor.ts` | text, json | no | exit 1 on no name, an agent no tier holds or a copy that cannot be written |
| `module list` | `src/commands/module/list.ts` | text, json | no | exit 1 outside a project or on a config refused |

All ten build with a seams argument (`createDoctorCommand(seams)`, `createSkillListCommand(seams)`), so they are testable without a project. `agent search` is an eleventh command whose file (`src/commands/agent/search.ts`) is in `c06-command` and whose body is `createSearchCommand('agent', seams)` from `src/commands/skill/search.ts` here, so `skill search` and `agent search` are one definition in two clusters.

### Commands whose engine is in the cluster

| Command | Definition (outside) | Engine (inside) | What the definition passes |
| --- | --- | --- | --- |
| `effort collect` | `src/commands/effort/collect.ts` (`c04-sqlite`), a phase-0 command through `wrapPhaseZeroCommand` | `src/effort/collect.ts` (`collect(args, repoRoot)`), `collect-args.ts`, `collect-skills.ts`, `skill-use.ts` | the line's words and the project root |

`src/index.ts` also exports `effortCollectCommand` and reads `src/effort/collect.ts` directly, so a cut that moves the collector has to move or re-point that export too. The one place modules are mounted is `src/rafa.ts:47`, which calls `loadInvocationModules` (`src/modules/load.ts`) before the dispatcher routes anything.

### Other callers that the cluster serves

| Caller (cluster) | Calls | Members used |
| --- | --- | --- |
| every command that resolves a project's config (`c01-github` to `c11-frontmatter`) | the config | `config.ts` (65 non-test importers), `config-load.ts` (20), `config-schema.ts` (8) |
| `src/commands/plan/plan-files.ts` (`c05-sessions`), `resolveProjectConfig` | the config with a warning sink | `config-load.ts`, `config.ts` |
| the loop's `start()` (`c02-active`) | plan path, risk total, sync refusal, tier serving, hub contact | `start/plan-path.ts`, `start/risk-total.ts`, `start/preflight-sync.ts`, `tiers/serve.ts`, `effort/sync/contact.ts` |
| the loop's preflight (`src/start/preflight.ts`, `c02-active`) | the agent roster refusal | `agents/roster.ts` (`resolveAgentRoster`, `missingPlanAgents`, `collidingPlanSkills`, `unresolvedPlanSkills`) |
| `plan validate` (`c06-command`) and `agents/vendorable.ts` | the same roster | `agents/roster.ts` |
| `plan create` (`src/plan.ts`, `c02-active`) | the skill index and the routing defaults | `task/skill-index.ts` (`renderSkillIndex`), `tiers/routing.ts` (`DEFAULT_ROUTING`) |
| `dispatchTask` (`src/start/dispatch.ts`, `c02-active`) | the agent definition's effort | `utils/agent-definition.ts` (`agentEffortLookup`) |
| the `claude` spawn (`src/utils/claude.ts`, `c02-active`) | the session environment | `utils/session-env.ts` (`sessionSpawnEnv`), also read by `doctor-deep-env.ts` |
| `rafa next`, `rafa status` and `src/effort/report.ts` | a pull from the hub before they read | `effort/sync/contact.ts` (`pullBeforeRead`) |
| the adapter registry's callers (`c10-index`, `c01-github`, `c06-command`) | the core registry and the module registry | `adapters/registry.ts` (10 non-test, 13 test importers) |
| `skill backfill`, `skill demote` and `src/demote/classify.ts` (`c11-frontmatter`) | the reference checks | `check/references.ts`, `check/shell-lines.ts` |
| `src/project/scaffold.ts`, `rafa init`'s template (`c08-cli-capture`) | the routing rows and the defaults it writes into the template | `tiers/routing.ts` (`DEFAULT_ROUTES`), `config-schema.ts` (`CONFIG_DEFAULTS`) |

### Most imported from outside

The members with the most non-test importers outside the cluster:

| Member | Non-test importers | Test importers |
| --- | --- | --- |
| `src/config-sections.ts` | 196 | 14 |
| `src/config.ts` | 65 | 33 |
| `src/config-load.ts` | 20 | 7 |
| `src/adapters/registry.ts` | 10 | 13 |
| `src/config-schema.ts` | 8 | 8 |
| `src/tiers/resolve.ts` | 7 | 2 |
| `src/schema/tiers.ts` | 5 | 0 |
| `src/check/references.ts` | 5 | 0 |
| `src/effort/sync/contact.ts` | 4 | 2 |
| `src/effort/store/settings.ts` | 4 | 0 |
| `src/effort/collect.ts` | 3 | 7 |
| `src/inventory/record.ts` | 3 | 3 |

`config-sections.ts` is the surprise. Its 196 outside importers do not read config: 162 import `messageOf` (the error-to-text helper), 41 `describeValue` and 28 `isMapping`, three general utilities that happen to live beside the value readers, from every adapter, board, command and effort file. The setting types come next (`BoardRelationshipMode` 20, `ClaudeSettingSource` 13). `config.ts` is read for `RafaConfig` (41 importers), `ConfigError` (20), `ClaudeSettingSource` (14) and `configFilePath` (9). The rest of the list is the tier resolution, the adapter registry, the sync contact and the inventory record, shared by their own weight.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **partial** | 10 `RafaCommand` definitions here (`doctor`, `plan risk`, `plan needs`, `skill list/show/search`, `agent list/show/vendor`, `module list`); `agent search` is built here and defined in `c06-command`; `effort collect` runs this cluster's `collect` from a definition in `c04-sqlite` | `run` is `run(context: RafaContext): Promise<void>`, not `run(ctx, options) → { outcome, context?, message? }`; every refusal is a thrown `CommandExit`; registration is a central static import in `src/commands/index.ts` |
| Steps with guards | **partial** | the step-shaped units are `start/plan-path.ts`, `start/risk-total.ts`, `start/preflight-sync.ts`, the roster refusal of `agents/roster.ts`, `effort/sync/contact.ts` and `tiers/serve.ts`; guards are code inside them | no registry, no step id, no guard class declared, no `expect`, no `ctx.answered`; the loop calls them from `start()` and `runStartPreflight()` in `c02-active` |
| Config section | **partial** | the whole schema: 64 settings in 26 sections, declared in `src/config-schema.ts` (40) and five section files (`hub` 3, `pr` and `release` 15, `tests` 3, `triage` 2, `loop.wrapUp` 1, 24 in all); readers in `config-sections.ts` and `config-items.ts`; layering and files in `config.ts` and `config-load.ts` | no `rafa.config.ts`, no `defineConfig`, no Standard Schema object, no per-package section; 19 of 26 sections share `config-schema.ts`, and nothing here is a package's own slice |
| Flows | **partial** | eight multi-step paths the cluster drives end to end (below) | each is a hand-ordered function chain; no flow list, no `flow show`, no step id to drop or swap |

### Commands

All ten satisfy the superset shape `commandProblem` checks (`subject`, `action`, `summary`, `flags`, `examples`, `outputs`). Three things a package has to take on:

- The `RafaCommand` type, `RafaContext`, `CommandExit` and the output events live in `c06-command` (`src/cli/command.ts`, `src/adapters/output/{events,json,stream}.ts`). The 19 edges into `c06-command` are the exit and output contract, not the command type alone, and every command of the cluster reads `context.output`, `context.flags` and `context.project`.
- Five of the ten read the module registry (`loadModules` in `agent list`, `skill list`, `module list`, `plan needs` and `doctor`, through `doctor-deep.ts` and `doctor-effort-sync.ts`), as does `effort/sync/contact.ts`, so a command package that does not own `src/modules/` has to import it. `module list` is the command of that subject, and `module exec` is in `c06-command`.
- Subjects are shared: `skill` holds three more commands in `c11-frontmatter` (`check`, `backfill`, `demote`), `agent` one in `c06-command` (`search`), and `src/commands/plan/` holds 31 files across six clusters.

### Steps with guards

Nothing here is a registered step. These are the units the cluster contributes to a run or a check, with the guard that decides each and the class #119's vocabulary would give it. The classes are an assignment from `docs/workflow-checks.md` §2 and §5 and the source; no code declares them. "Behaviour" means no setting or flag turns the refusal off.

| Step (today's unit) | File | Guard that decides it | Class |
| --- | --- | --- | --- |
| config loads | `src/config-load.ts` (`loadConfig`), `src/config.ts` (`parseConfigText`, `resolveConfig`) | a `ConfigError` names every problem of the first file with one and refuses the run; an unknown key is a warning | 🔒 |
| plan path | `src/start/plan-path.ts` (`resolvePlanPath`) | resolves the file `--plan` names, or the default plan, and refuses nothing itself; the missing-file refusal is in the callers (`src/start.ts`, `doctor`, `plan needs`, `plan risk`) | 🔒 |
| risk total | `src/start/risk-total.ts` (`announceRiskTotal`) | printed for the run; a reading that throws is a warning | reading |
| preflight, sync strategy | `src/start/preflight-sync.ts` (`refuseUnservedSync`) | an `effort.sync` no core or module adapter serves refuses before any probe | 🔒 |
| preflight, agent roster | `src/agents/roster.ts` (`missingPlanAgents`, `collidingPlanSkills`, `unresolvedPlanSkills`), run from `src/start/preflight.ts` | an `agent=` or `skills=` no tier serves, a switched-off one, or one two tiers hold with different contents refuses | 🔒 |
| serving | `src/tiers/serve.ts` (`serveResolution`), run from `src/start/serving.ts` | copies the rafa-tier winners a session would not load, each skipped item named with a reason; never refuses | reading |
| device sync | `src/effort/sync/contact.ts` (`createHubContact`, `pullBeforeRead`) | a module strategy only (`git`, `service`, `p2p`); never throws and never sets the exit code, one unreachable-hub line per contact | 🧭 |
| module loads | `src/modules/load.ts` (`loadModules`, `loadInvocationModules`) | a manifest that fails `validateManifest`, a path outside the module directory, a kind core holds or a port version core does not serve refuses that module whole; a name two sources give is refused at the second | 🔒 |
| inventory precedence | `src/inventory/index.ts` (`buildInventory`), `src/tiers/resolve.ts` (`resolveTiers`) | project over rafa over user; a pin, a `false`, a collision or a byte-identical copy decide each row's state | reading |
| `skill search` | `src/inventory/search/index.ts` (`runSearch`), `quote.ts` | `no-candidates` starts no session; a match whose quote is not in its file near its line is dropped; a failed session falls back to the ranking | behaviour |
| plan risk | `src/plan/risk.ts` (`assessPlanRisk`) and `src/plan/risk/*` | `high` and `note` findings; `plan risk --strict` exits 1 on a `high` one | 🧭 (`--strict`) |
| plan needs | `src/plan/needs.ts` (`readPlanNeeds`, `readSpecNeeds`) | `present` or `missing` against the inventory, the MCP configuration and `PATH`; `--missing` exits 1 when anything is kept | reading |
| effort collect | `src/effort/collect.ts` | an unrecognised argument, a `--since` that is no date and a config the loop cannot run on are refused; a session id is read once and never again | behaviour |

The ⚠️ class has a home here and no user: `dangerous.acceptStaleRefs`, `dangerous.acceptVersionCollision` and `dangerous.selfUpdateDuringLoop` are declared in `src/config-schema.ts` and `src/config-schema-release.ts`, which is the `passedBy` list #119 asks for; the guards they pass are read outside it (`dangerous.acceptStaleRefs` in `src/board/refs-gate.ts` and `src/commands/plan/refs-check.ts`, `c01-github`; `selfUpdateDuringLoop` in `src/commands/self-update.ts`). `src/config-locked.ts` declares four settings (`effort.sync`, `prerequisites.required`, `claims.staleAfter`, `claims.ahead`) as shared by every device of a project, and nothing in `src` reads it (only its own test): the closest thing to the contract's `required` set is declared and unused. #118 expects a package's config layer to be able to drop a ⚠️ or 🧭 guard for its own package and never a 🔒 one; `LOCKED_SETTINGS` is a different list (team-shared values, not never-passed guards) and would need a second one.

Consent: no unit of this cluster asks a question. `doctor`, `plan risk`, `plan needs` and the lists are readings; `agent vendor` writes after its flags (`--force`), not after a prompt.

### Config section

The cluster does not use a slice of the config: it **is** the config. 64 settings in 26 sections (`SECTIONS` in `src/config-schema.ts`), and the table below lists them by who declares them and who in the cluster reads them. Five files cover seven of the 26 sections (`hub`, `loop.wrapUp`, `pr`, `release`, `tests`, `triage` and `triage.similarity`, 24 keys); the other 19 sections, 40 keys, sit in `src/config-schema.ts`.

| Section | Keys | Declared in | Read in the cluster by |
| --- | --- | --- | --- |
| `version`, `store`, `output.mode` | 3 | `src/config-schema.ts` | named in 10, 14 and 11 cluster files (`adapters/registry.ts`, `doctor*.ts`, `effort/collect*.ts`, the commands); a name match, so an upper bound |
| `effort` | `effort.sync`, `effort.busyTimeoutMs` | `src/config-schema.ts` | `effort/sync/select.ts`, `contact.ts`, `doctor-effort-sync.ts`, `effort/store/settings.ts` |
| `hub` | `hub.url`, `hub.tokenSecret`, `hub.timeout` | `src/config-schema-hub.ts` | `effort/sync/select.ts`, `contact.ts` |
| `plan`, `specs` | `plan.dir`, `plan.inject`, `specs.dir` | `src/config-schema.ts` | `plan.dir` in 8 files (`doctor`, `plan/needs`, `plan/risk`, `adapters/registry`, `agents/vendorable`, `effort/collect`, …), `specs.dir` in 3; `plan.inject` in none here |
| `tracker`, `pr`, `board`, `roadmap` | `tracker.default`, `tracker.fallback`, `pr.provider`, `pr.base`, `board.trustedAuthors`, `board.relationships`, `roadmap.issue`, and the other `pr.*` | `src/config-schema.ts`; the `pr` and `release` keys in `src/config-schema-release.ts` | `plan/risk/accounts.ts`, `start/risk-total.ts`, `doctor-deep-providers.ts`, `doctor.ts`, `doctor-release.ts`, `plan/needs.ts` |
| `loop` | `loop.settingSources`, `loop.worktreeDir`, `loop.wrapUp.retries` | `src/config-schema.ts`; `wrapUp` in `src/config-schema-wrap-up.ts` | `settingSources` in 23 files (the roster, the inventory, the tiers, every agent and skill command, `doctor-deep-*`); `worktreeDir` in `effort/collect.ts` |
| `tiers`, `routing` | `tiers.rafa`, `tiers.skills`, `tiers.agents`, `routing` | `src/config-schema.ts` (the default is `DEFAULT_ROUTING` from `src/tiers/routing.ts`) | `tiers.*` in 6 files each (`tiers/resolve.ts`, `inventory/index.ts`, `doctor-deep.ts`, `skill/list`, `agent/list`, `plan/needs`); `routing` in `tiers/routing.ts`, `routing-table.ts` |
| `modules`, `allowList` | 2 | `src/config-schema.ts`, with `ModuleSource` in `src/config-items.ts` | `modules/load.ts` and 12 other files that read the key |
| the rest: `learning.*`, `task.*`, `prerequisites.*`, `tracking.*`, `claims.*`, `triage.*`, `cleanup.*`, `dangerous.*`, `status.notice`, `tests.*`, `loop.wrapUp.retries`, `pr.mergeMethod`, `pr.resolveBudget`, `pr.versionCollision`, `release.settle`, `release.tag`, `release.publishCommand` | 32 | `src/config-schema.ts` and the `-triage`, `-release`, `-tests`, `-wrap-up` files | no file of the cluster; the readers are in the other clusters (`c02-active`, `c01-github`, `c05-sessions`, `c07-index`, `c09-version`) |

So the cluster holds the declaration of every key, and by a name match 32 of the 64 are read by no member of it (the other 32 are read here, though many of those by one file). The readers of those sit in the other eleven clusters through `RafaConfig`, `ResolvedConfig` and `Pick<RafaConfig, …>`, the 370 edges entering the cluster. `src/config-schema.ts` already says what each section's file is for: `config-schema-tests.ts` holds "its field, its default, its spec and its reader", the same four parts every key has, so a section file is already the shape of a package's section. What stops the other 19 sections from leaving is that `RafaConfig` is one interface (`src/config-schema.ts:209`), `CONFIG_DEFAULTS` one frozen object (354) and `SETTINGS` one closed record keyed by `ConfigSetting = keyof RafaConfig` (424); a section file's fields are folded into all three by hand.

Tests: `config-schema.test.ts`, `config.test.ts`, `config-sections.test.ts`, `config-load.test.ts`, `config-items.test.ts`, `config-locked.test.ts` and one test per section file (`config-schema-{board,hub,release,tests,triage,wrap-up}.test.ts`). `config-schema-board.test.ts` tests `board.relationships`, a key `config-schema.ts` holds: it has a test file named for a section that has no file.

### Flows

Multi-step paths the cluster drives end to end. Each is an ordered chain of functions with a refusal or a reading between steps and no flow declaration.

1. **Config resolution:** home and root → the user file, then the project file (a root that is the home is read once) → each parsed and judged whole, the user's first, every problem of the first file with one named in one `ConfigError` → the command line over the project over the user over the default, key by key → unknown keys warned → the effort store's open settings set as a side effect (`setActiveStoreSettings`, `src/effort/store/settings.ts`). `loadConfig` in `src/config-load.ts`, called by every command through `resolveProjectConfig` (`src/commands/plan/plan-files.ts`).
2. **`rafa doctor`:** config → plan (`--plan`, or the default) → PREREQUISITES merge → provider's automatic items → start-only items → `runPreflight` over every item → install rows → board readings (`c01-github`) → cleanup row (`c05-sessions`) → references row → release row → effort sync row → risk total (`start/risk-total.ts`) → `--deep` sections (environment, settings, providers, stack tools, plan needs) → one exit code. About 15 readings in `runDoctor` (`src/commands/doctor.ts:688`), which answers what `loop start`'s preflight would do and starts no run.
3. **Module loading:** `modules:` and `allowList:` → each `path` source's `package.json` read → `validateManifest` for every source, enabled or not → for an enabled one, each adapter entry imported and registered under its port type and kind at its port version → the `commands` entry handed to the dispatcher for `module/<name>` (`src/cli/modules.ts`, `c06-command`). `loadModules` in `src/modules/load.ts`; `src/rafa.ts:47` makes the one call before routing.
4. **Inventory and tier resolution:** trees (project, rafa, user) → plugins and loaded add-ons → disabled switches → `resolveTiers` → precedence, `shadowed-by:`, `disabled:` and `visibleToLoop` decided over all rows at once → `rafa skill list`/`show`, `agent list`/`show`, the browse view, the roster (`agents/roster.ts`) and the served set (`tiers/serve.ts`). `buildInventory` in `src/inventory/index.ts`.
5. **`skill search` and `agent search`:** rank the inventory by the question (top twelve) → copy the files to a scratch directory → one Claude session under the fixed template → read the `rafa:search` block → quote check against the copies → one effort row of kind `search` → print. `runSearch` in `src/inventory/search/index.ts`; `--no-model` stops after the ranking.
6. **`plan risk` and `plan needs`:** plan path → config → the plan's tasks, command spans and shell fences, the accounts (push remote and its visibility, tracker, provider), the environment's credential-looking names → findings. `assessPlanRisk` (`src/plan/risk.ts`) and `readPlanNeeds` (`src/plan/needs.ts`); no session starts.
7. **`effort collect`:** the main checkout's session-log folder and each worktree's → sessions already in the store skipped → new session and commit rows appended → skills each session invoked counted into the `skill_invocations` table. `collect` in `src/effort/collect.ts`.
8. **Device sync contact:** the strategy `effort.sync` names → `local` and `file` skipped → `loadModules` for the others → push then pull, or a pull alone → at most one unreachable-hub line. `createHubContact` in `src/effort/sync/contact.ts`.

## Gaps

Every export that is missing or partial, with the file a cut would have to change. Gaps 1 to 3 are the contract itself and would be the same for any cluster; gaps 4 to 12 are specific to this one.

1. **No `run(ctx, options)` for the cluster's commands** (commands, partial). `run` takes `RafaContext` and returns `Promise<void>`. A cut changes `src/cli/command.ts` (the type) and the ten files under *Registered commands*; for the two commands whose definition is outside, `src/commands/agent/search.ts` (`c06-command`) takes the factory from `src/commands/skill/search.ts`, and `src/commands/effort/collect.ts` (`c04-sqlite`) passes words to `collect(args, repoRoot)` in `src/effort/collect.ts`.
2. **No step registry or guard class** (steps, missing). Guards are code inside the units. A cut adds the registry (`src/steps/registry.ts`, not yet present) and moves each guard in the *Steps with guards* table into a step: `src/start/preflight-sync.ts`, `src/agents/roster.ts`, `src/modules/load.ts`, `src/effort/sync/contact.ts` and `src/config-load.ts`. The `required` set a loader needs is every row marked 🔒 above, and no file of the cluster can say today which of its refusals those are.
3. **No consent in the context** (steps, missing). Nothing here asks, so the cluster adds no second question and a cut owes it nothing on the read side; the one writer, `src/commands/agent/vendor.ts`, takes `--force` as a flag, which stays a flag.
4. **The config has no `rafa.config.ts`, no `defineConfig` and no Standard Schema object** (config, missing). #118 replaces the merge in `src/config-load.ts` and the layering in `src/config.ts` (`resolveConfig`, `ConfigLayers`, `parseConfigText`) with `createLoader`, adds the `./config` subpath to `package.json`, and derives a Standard Schema from `SETTINGS` in `src/config-schema.ts`. It also adds `dangerous.allowLoopsOnMain` and `merge.*` to the schema and the files it lists (`src/config-schema-release.ts` holds today's `dangerous` key, `src/config-schema.ts` the other two). Every one of the 370 entering edges reads through `ResolvedConfig` or `RafaConfig`, so the shape has to survive the change.
5. **19 of 26 sections share one declaration** (config, partial). `RafaConfig`, `CONFIG_DEFAULTS` and `SETTINGS` in `src/config-schema.ts` are one interface, one object and one closed record, and the five section files are folded in by spreading into `SETTINGS` (`...HUB_SETTINGS` and its four siblings, `src/config-schema.ts:424`). A package's own config section needs a file per section for `effort`, `plan`, `specs`, `tracker`, `learning`, `output`, `prerequisites`, `tracking`, `loop`, `board`, `roadmap`, `claims`, `cleanup`, `dangerous`, `status`, `tiers` and `task`, folded the same way (`routing`, `modules` and `allowList` are top-level keys with no section); `src/config-schema.ts` (599 lines) and `src/config-sections.ts` (705) are the two files that would change for every one. `src/config-schema-readings.ts` is the prose that goes with them and is in no cluster with them (`c15-config-schema-readings`); a cut has to move it by name, because the graph will not.
6. **Three general helpers sit in the value readers** (cut boundary). `messageOf` (162 outside importers), `describeValue` (41) and `isMapping` (28) are exported by `src/config-sections.ts` and are not config. Left there, every package that formats an error depends on the config package. A cut moves them to a leaf module (`src/utils/`) and re-exports them from `src/config-sections.ts` until the importers move; the 196 importing files are the work.
7. **The config reaches into other domains** (cut boundary). `src/config-sections.ts` imports `src/learning/identity.ts`, `src/utils/declaration.ts` and `src/pr/types.ts`; `src/config-schema.ts` imports `src/tiers/routing.ts` for `DEFAULT_ROUTING`; `src/config-load.ts` imports `src/adapters/output/active.ts` and `src/effort/store/settings.ts`. The first three are the values a reader validates against (`CONFIDENCE_MIN` and `CONFIDENCE_MAX` from the learning identity, `MERGE_METHODS` from the pull request port's types, `parseBudgetUsd` from the declaration grammar, and `SKILL_TIERS` from `src/schema/tiers.ts`, which is in the cluster); the load-time pair makes `loadConfig` set the effort store's open settings as a side effect. A cut either moves those into the config package as types and constants or turns them into arguments, and `src/config-load.ts` stops being the place that configures the store.
8. **`src/commands/doctor.ts` is a 771-line aggregator over every domain** (steps and flows, partial). Its 15 readings come from this cluster (12 files), `c01-github` (8), `c04-sqlite` (2) and `c05-sessions` (1). A cut that gives each package its own doctor reading changes `src/commands/doctor.ts` into a loop over a list the packages contribute, and the readings in `src/commands/doctor-board.ts`, `doctor-blocked.ts`, `doctor-boards.ts`, `doctor-epics.ts`, `doctor-marks.ts`, `doctor-relations.ts`, `doctor-previous.ts`, `doctor-refs.ts` (`c01-github`), `doctor-effort-schema.ts`, `doctor-install.ts` (`c04-sqlite`) and `doctor-cleanup.ts` (`c05-sessions`) move into their own packages. This is the one command that no single package can own as it stands.
9. **The module manifest has no `steps` or `flows` feature type** (steps and flows, missing). `FEATURE_TYPES` in `src/modules/manifest.ts:106` is `output`, `tracker`, `store`, `planner`, `learning`, `skills`, `agents`, `mcp`, `commands` and `sync`; #71 says #29 gains a `steps` type. A cut changes `src/modules/manifest.ts` (the list and `validateManifest`), `src/modules/load.ts` (what an enabled module hands the dispatcher, today only a `commands` entry) and `src/cli/modules.ts` (`c06-command`). Until then a package contributes commands through the manifest and nothing else.
10. **The inventory, the tiers and the roster are one subsystem in three folders** (cut boundary, flows partial). `src/inventory/`, `src/tiers/` and `src/agents/` import one another (`inventory/index.ts` calls `tiers/resolve.ts`; `agents/roster.ts` calls `tiers/serve.ts`; `tiers/resolve.ts` is imported by seven outside files), and the loop's preflight, `plan validate` and the serving step in `c02-active` read the roster and the served set. They want one package (24 non-test files with `src/schema/tiers.ts` (five outside importers), `src/schema/agent.ts` and `src/schema/provenance.ts`). It reaches the settings code only through `config-sections.ts`'s helpers (gap 6), one value import from `src/config-schema.ts` in `inventory/index.ts` and types from `src/config.ts`; it also imports `src/modules/` (`inventory/plugins.ts` reads the loaded add-ons) and `src/effort/collect.ts` (the search runner), so it is not a leaf. Its public surface is `buildInventory`, `resolveTiers`, `resolveAgentRoster` and `serveResolution`; `src/start/serving.ts` would import them rather than reach into folders.
11. **Several step-shaped units live in the loop's folder** (steps, partial). `src/start/plan-path.ts`, `risk-total.ts` and `preflight-sync.ts` are in the cluster only because `doctor`, `plan risk` and `plan needs` import them (`plan-path.ts` is imported by three commands here and by `src/start.ts`). A cut either keeps them in the loop package and lets the doctor and the plan commands import it, or moves `resolvePlanPath` and the risk total beside `src/plan/risk.ts`; both are small, and the first is the one that adds an edge from the settings package to the loop.
12. **Existing subpath entries cover almost none of it** (commands and config, partial). `package.json` exports `.`, `./cli`, `./plan`, `./store`, `./ports` and `./learning`; the `.` entry (`src/index.ts`, a member) re-exports `loadConfig`, `readConfigFile`, the config types and readers, `CORE_ADAPTER_REGISTRY`, `createAdapterRegistry`, `PORT_VERSIONS`, the manifest validator and `effortCollectCommand`. None exports a step, a flow or a config section, and `./config` does not exist. A cut keeps `src/index.ts` as the shim #801 asks for, adds the four exports to the package entry, and changes `package.json` and `src/index.ts`. `src/index.test.ts` is at the 128 ceiling and is the test that holds that entry: it moves with it.
13. **No `--dry-run` for any of the flows** (flows, partial). Nothing in the cluster reads `dryRun`. `doctor`, `plan risk`, `plan needs` and the list commands are already readings that change nothing, so they are the nearest thing to a dry-run walk; the two that are not pure are `agent vendor` (`src/commands/agent/vendor.ts`, writes) and `effort collect` (`src/effort/collect.ts`, appends rows). A `--dry-run` walk changes those two and gives the readings a `would-run` outcome.
14. **The tests reach the whole tree through the schema** (cut boundary). Of the 95 member tests, six are at 128 and 18 spawn a process (14 through `src/tests/cli-capture.ts`); the six config files are each reached by 756 tests. A cut keeps the epic's fourth criterion only if the 756 tests import the config package as one folder rather than the files of this cluster as 30, and `src/tests/parity-fixture.ts` (support, four importers) moves with the package whose session logs it reads (`src/effort/collect.ts`).

## Cut order this implies

The cluster has two lines through it that a cut can use. The inner one is the config itself: `config-items.ts`, `config-locked.ts` and the five section files already hold their own fields, defaults, specs and readers, so a section leaves as a file without being rewritten, and `config-sections.ts`'s three helpers (gap 6) and its three outward imports (gap 7) are the only things that make the config package heavier than a list of settings. The outer one is the inventory, tiers and roster subsystem (gap 10): 24 non-test files with one public surface and almost no import of the settings code beyond the helpers of gap 6, which can leave as its own package once `src/modules/` and `src/effort/collect.ts` are reachable, and take the doctor's tier rows (`src/commands/doctor-tiers.ts`) with it.

Taken first, the helpers move out of `config-sections.ts` and the outward imports of the config are cut, because 196 files depend on them and nothing else in the cut can begin while they do. Taken last, `src/commands/doctor.ts` (gap 8) and `src/index.ts` (gap 12), because they import every other package and one is the shim that keeps `rafa` installs working.
