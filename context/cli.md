## CLI

How a line reaches a command under `src/cli/`: `RafaCommand`, the
registry, routing, module command entries, the dispatcher, help and
`describe`.
A specs directory owns the command tree, the aliases, the help
levels and `describe`; this page holds what the code does. Each
module's note is the long form.

### Modules

| Module | Holds |
| --- | --- |
| `src/cli/core/` | `types.ts`, `parseArgs.ts` and `assembleContext.ts`, copied from open-tomato's `cli-core` |
| `src/cli/command.ts` | `RafaCommand`, `RafaContext`, `CommandExit`, and the shape check `commandProblem` |
| `src/cli/registry.ts` | subjects, core commands, aliases, and the `module/<name>` mounts |
| `src/cli/route.ts` | a line read into a command, a help request, a version request or a refusal, with no side effect |
| `src/cli/modules.ts` | module command entries imported and mounted, one warning per file skipped |
| `src/cli/dispatch.ts` | one invocation: the context, the running command recorded while it runs (`running.ts`), the events, the deprecation line and the exit code |
| `src/cli/help.ts` | `renderHelp`, the three help levels rendered from the registry, and `GLOBAL_FLAGS` |
| `src/cli/version.ts` | `RAFA_VERSION`, the `package.json` version the build inlines, and `versionLine`, the `rafa <version>` line |
| `src/cli/describe.ts` | `describeRegistry`, the schema 2 roster built from the registry, module-provided actions included |
| `src/cli/testdata/help/` | the frozen text of `rafa --help`, `rafa loop --help`, `rafa loop start --help`, `rafa loop wait --help`, `rafa next --help`, `rafa issue ready --help`, `rafa issue edit --help` and `rafa release tag --help` |
| `src/cli/prompt/` | the prompt kit: `terminal.ts` the keys read, raw mode and SIGINT handling, and `text.ts`, `select.ts`, `multi-select.ts`, `confirm.ts` and `page.ts` the five prompts for text input, single selection, multi-selection, confirmation and paged lists in raw mode on standard error |
| `src/modules/load.ts` | the modules `allowList:` names, loaded from their `modules:` sources: manifests checked, adapters registered, command entries handed on |
| `src/commands/module/` | `module list`, what each configured module came to, and `module exec`, the `exec` action mounted modules are reached through |
| `src/commands/agent/` | `agent vendor`, a rafa-tier or `~/.claude/agents` definition copied into the project with a source header, naming its tier; `agent list`, the agents the inventory holds, with `--source` (aliased `--tier`), `--state` and `--hidden-from-loop` filters and `-i` browse; `agent show`, one definition whole through the show view; and `agent search`, the agents that answer a question through the same runner as skill search |
| `src/commands/skill/` | `skill check`, the checker over a skills directory, with `--fix` and `--project`; `skill list`, the skills the inventory holds, with `--source` (aliased `--tier`), `--state` and `--hidden-from-loop` filters and `-i` browse; `skill show`, one skill whole through the show view; `skill search`, the skills that answer a question; `skill demote`, the demotion pass of `src/demote/` over one directory; and `skill backfill`, the plan, the proposal pass and the apply of `src/backfill/` over one directory |
| `src/commands/instinct/` | `instinct check`, the checker over an instincts directory; `instinct list` and `instinct show`, the records the two scopes hold, `list` with its `--blessed` and `--conflicts` views; `instinct flag`, one held lesson flagged through the Learning adapter so no later bundle blesses it; and `instinct promote`, the lessons that recurred enough to promote under `learning.promote.*`, writing nothing |
| `src/commands/instinct/instinct-records.ts` | what `instinct list` and `instinct show` share: the scopes read, which files in them are records, and the id lookup |
| `src/commands/release/` | `release status`, the version `release.versionFile` declares, the latest release tag by semantic version precedence, the versions `release.changelog` calls released that carry no tag, the change notes pending for the current plan and the fragments waiting on `origin/<pr.base>` as last fetched with their settle forecast (`status-fragments.ts`) and the audit of the changelog's released history (`src/release/audit.ts`), writing nothing; `release settle`, below; and `release tag [--push]`, which puts `v<version>` on the commit of the release branch that set the version and prints the push and publish lines rather than running them; with `--push` it pushes the tag to the remote the release branch tracks (`origin` when it tracks none) through `src/release/tag-push.ts` and drops the push line, and a push that fails exits 1 with git's words and keeps the local tag |
| `src/commands/release/settle.ts` | `rafa release settle [--dry-run]`: fetches `origin/<pr.base>` (`main` when unset) and works in the scratch worktree `withSettleWorktree` adds and removes (`src/release/settle-worktree.ts`), so the caller's checkout and index are never touched. `--dry-run` answers `readSettle` at the worktree's `HEAD` and writes nothing; otherwise `release.settle` picks `settleByPush` or `settleByPr`, the latter resolving the `gh` provider first as every `pr` action does (exit 2 without one), and `tagSettle` applies `release.tag`. Every run prints the strategy, the base commit and version, the fragments in fold order (path, level, title, add date and commit) and, for a fold that answered, `Version: <base> → <next>`, then one line for the delivery and one for a tag. Exit 0 for a dry run that folded or found nothing, a delivery that landed, a push another settle superseded and nothing to settle; exit 1 for an unfetchable or unreadable base, a fragment that does not parse (none is folded), a strategy that threw, an unbuilt commit, a refused or protected push, a failed pull request step and a failed tag after a landed push, the reading printed above the refusal either way. In json mode a run exiting 0 gives the reading, the delivery, the tag and the project refresh as the terminal result's data. With `board.project.number` set, a push that left the base without the folded fragments is followed by the project refresh of `settle-project.ts`: the issues closed by the pull requests that added them, read off `associatedPullRequests` through `gh api graphql`, each line a warning that keeps the exit code. Assembles no `git` or `gh` argv of its own, starts no session and declares no `spends` |
| `src/commands/board/` | `board list`, every open `type:roadmap` board and the default board when it lacks the label, one line each with its owner and whether GitHub resolves it, its epic count, and the `current` and `home` marks, read off one board listing and writing nothing; `board sync [--dry-run] [--output=json]`, every item of the repository's GitHub project refreshed (over `src/board/project/refresh.ts`) and every open issue missing from it added (no refresh with `board.project.number` unset), reading nothing and starting no session so it declares no `spends`. `--dry-run` prints each change without writing; `--output=json` prints the changes as the result's data. Each run warns about failures (the `project` scope missing, a rate-limit refusal, an unknown field), names the fix, and keeps the exit code at 0. No auto-add rule is set, and with the project unset the command does nothing and exits 0 |
| `src/board/relations/port.ts` | the `BoardRelations` interface and its adapters: `mode` (one of `labels` or `native`), the three reading functions (`epicOf`, `membersOf`, `blockersOf` with their truncation reading, `freedBy`), the three writing functions' types (to be called through the `GhRunner` seam), and the per-mode listing fields that `BOARD_LIST_FIELDS` carries to the cache |
| `src/board/relations/labels.ts` | the `labels` adapter, delivering `labels` mode: membership from `epic:<slug>` labels, order from the epic's checklist, waiting from `spec:blocked` labels and `Blocked by:` lines with the four faults, and `readUnblockableIssues` read by the unblock step of `pr merge` |
| `src/board/relations/native.ts` | the `native` adapter, delivering `native` mode: membership from the `parent` field, order from the `subIssues` array if `gh` answers it (the checklist otherwise), waiting from `blockedBy` nodes each with their state, and `readFreedIssues` read by `pr merge` to print what a merge freed |
| `src/board/relations/select.ts` | `selectBoardRelations(config)`, shaped like `selectEffortStore`, a module-local table keyed by `board.relationships` kind (`labels` or `native`), a `TypeError` naming the kinds when the value is none of them, registered as no port type |
| `src/board/relations/contract.ts` | a test helper, not a test file, shaped like `src/adapters/tracker/contract.ts`: `relationsContractCases` answered as a list and `runRelationsContract` registering it, run by `labels.test.ts` and `native.test.ts` over fixture listings describing the same board, never adding to `src/adapters/registry.ts` |
| `src/commands/epic/` | `epic show`, one epic's issues as the Roadmap table, aliased `epic` for good, so `rafa epics`, `rafa epics <n>`, `rafa epic` and `rafa epic <n>` run it with no deprecation line; `epic new`, which creates an epic's issue from the epic template, its line on the current board and, in `labels` mode only, its `epic:<slug>` label; `epic defer` and `epic promote`, thin declarations over `horizon-change.ts`, which reads their line, asks the reason and the keep question, and makes the horizon swap, the comment and the pull request closes; and `epic move`, which moves an issue to another epic through the relationships port's `setParent` and exports its move core, `readEpicMove` and `applyEpicMove`, for `epic cancel`, with `move-native.ts` reading the mode off the config and the epic a native issue leaves off its parent; and `epic close`, the closing gate, the subject's one spender, which plans a check per acceptance criterion over `src/epic/verify-plan.ts`, runs the checks against `origin/main` over `src/epic/verify-run.ts`, files each failure through `triageReport`, and closes the epic with its cost printed beside its estimate; and `epic cancel`, which lists the epic's dependents off `src/board/epic-dependents.ts`, asks move, unblock or cancel for each, applies a move through `move.ts`'s core, and closes the epic as not planned, with `cancel-unblock.ts` reading what an unblocked dependent still waits on in each relationships mode; and `epic-project.ts`, the project refresh each of the six actions runs once its writes landed, over the epic, its members and every item whose Rank shifted, the new epic added to the project first, each line a warning that keeps the exit code |
| `src/commands/claim/` | `claim release <n>`, which releases a claim the store owns, leaving the issue claimable by other devices; `claim hand <n> --to=<store id>`, which hands over a claim to another device for acceptance; `claim accept <n>`, which accepts a handed-over claim from another device; and `claim take <n> [--stale]`, which takes a claim held too long, failing if the claimed issue was written in this run or if `--stale` is not named and the claim is not stale by `claims.staleAfter` |
| `src/commands/check-report.ts` | what `skill check` and `instinct check` share: the words each reads off a line, the seams, the lines a run prints and the exit code |
| `src/commands/index.ts` | the core roster: `CORE_SUBJECTS`, `CORE_COMMANDS` and `CORE_REGISTRY` |
| `src/commands/wrap.ts` | `wrapPhaseZeroCommand`: a phase 0 command behind a declaration |
| `src/commands/plan/plan-files.ts` | what `plan list`, `plan show`, `plan validate`, `plan risk` and `plan needs` share that reads a command's context, arguments or flags: the project it was handed, the config that project resolves (`resolveProjectConfig`), the plans directory by that config (`resolvePlansDir`), the argument refusals and `readSwitch`, which refuses a word the parser read into a flag taking no value. The task counts, the file names, an issue as a line and `rejectedPath` are its library half, `src/plan/plan-files.ts`, which imports nothing under `src/commands/` |
| `src/commands/plan/risk.ts` | `rafa plan risk [<plan>] [--strict]`: the reading of `src/plan/risk.ts` over one plan, in code and starting no session, so it declares no `spends`. The plan resolves against the project root as `loop start --plan=` resolves it, and with none named is the default plan `loop start` falls back to; a plan named that is no file, no default plan, two plans and `--strict` typed ahead of the plan (which the parser reads as its value) are refused with exit code 1. The config gives `loop.settingSources` and the account settings; git and `gh` run at the project root; the environment is `RafaContext.env`, of which only the keys are read. Text mode prints `renderRiskText` a line at a time; json mode gives the `RiskReport` as the terminal result's data. Exit code 0 whatever it finds; 1 under `--strict` when any finding is `high`, where text mode prints the whole report first and json mode writes each `high` as an `error` log event, since a failed result carries no data. Every code span of an open task line is read as a command, so a span that only names one reports it: the rafa-69 plan's own `git push --force` fixture task reads `high` `destructive`, by design |
| `src/commands/plan/needs.ts` | `rafa plan needs [<plan> | --spec=<file> | --issue=<n>] [--missing] [--source=<source>]`: the reading of `src/plan/needs.ts` over one plan or one spec, in code and starting no session, so it declares no `spends`. A plan resolves as `plan risk` resolves its own, the default plan when none is named. `--spec` and `--issue` go through `resolveCreateSpec` (`spec-route.ts`) handed no offer, so a spec is found and an issue checked and snapshotted under `specs.dir` exactly as `plan create` does, and an issue `plan create` refuses is refused with the same code. The inventory is built as `skill list` builds it, `PATH` read off `RafaContext.env`. `--missing` keeps what `isUnmet` reports and the stacks not met, prints nothing at all when nothing is kept, and exits 1 when anything is, json mode writing each kept row as an `error` log event first; `--source` keeps the agents and skills one source holds, so it drops every MCP server, program, missing item and stack row, and refuses only a value written as no source. A plan beside `--spec` or `--issue`, `--spec` beside `--issue`, `--missing` typed ahead of the plan, a plan that is no file, no default plan and a config `loadConfig` refuses are exit code 1. Exit code 0 otherwise, whatever it finds |
| `src/commands/plan/ready-offer.ts` | the offer `plan create --issue` and `plan create --next` make on an issue carrying no `spec:ready` label: `rafa issue ready`'s run over the issue the route already read, made only where there is a terminal, and never under `--dry-run` |
| `src/commands/plan/blocked-offer.ts` | the offer `plan create --next` makes past a blocked line: `Plan #<n> instead? [y/N]` over the line `src/board/blocked-line.ts` found, made only where there is a terminal, and never under `--dry-run` |
| `src/commands/plan/refresh-offer.ts` | the offer `plan create --issue` and `plan create --next` make on a body changed since its saved copy: `Issue #<n> changed since the saved copy of <date>. Plan from it as it reads now? [y/N]`, the text `refreshQuestion` in `src/board/snapshot-settle.ts` owns, made only where there is a terminal, never under `--dry-run` and never under `--refresh` |
| `src/commands/plan/claim-route.ts` | the claim `plan create` makes on its issue before its session: `resolveAndClaim` resolves the spec, runs the cheap refusals, claims through `src/claims/plan-claim.ts` and prints the answer; a refused `--issue` or `--spec` exits 1 naming the owner, a refused `--next` pick is passed over and the walk resolved again, and an unclaimed run warns and plans; a claim ahead report (`src/claims/ahead.ts`) is printed after the claim. `createPlanClaimContext` builds the seams: `git`, the `gh` issue board or none, the store id, `claims.staleAfter`, `claims.ahead` |
| `src/commands/plan/store-check.ts` | the effort-store rules of `src/plan/store-rules.ts` read over one plan and the `PREREQUISITES-<stub>.md` beside it (`checkStoreRules`), the one reading `plan validate` and `plan create` share; `enforceStoreRules` runs it on `plan create` straight after the planner answers and before the readiness gate settles, and on any problem moves both files into `rejected/` beside them and exits 1 with one `<file>:<line>: <rule>: <text>` line per problem, under `--skip-review` too |
| `src/commands/plan/refs-check.ts` | check 4 of the readiness gate on `plan create --issue` and `plan create --next`: the `dangerous.acceptStaleRefs` warn line printed first thing in the run, and `enforceRefsGate` run over the saved copy once the snapshot has settled and before the session, verifying every reference and refusing on drift, with the acceptance read off `--accept-refs` and the config and a verifier over `gh`, `git`, `ts-symbols` and a roster (`planRoster`): flags extracted only from code spans whose first word is `rafa`, symbols read at their declaration position in the source, the checkout's own roster read by running `bun src/rafa.ts describe --output=json` when the project root is `@open-tomato/rafa` with `src/rafa.ts` tracked, otherwise the core roster its caller hands in, built with `registryRoster` from `RafaContext.registry` (a parameter since a static import of `src/commands/index.ts` is a load-order cycle through `src/plan.ts`), with one warning line printed when the checkout's roster cannot be read; never under `--dry-run` or `--spec` |
| `src/commands/issue/ready.ts` | `rafa issue ready <n> [--yes]`: the two checks a person would otherwise make by eye before marking an issue ready — whether the account that opened it has write access and whether its body fills the spec template — printed on `stdout` in text mode, then a refusal for an issue carrying two or more `epic:` labels, naming each, with `readEpicProblems`'s own `several-epic-labels` sentence (`src/board/epic-problems.ts`), made under `board.relationships: labels` only (in `native` mode an epic is the one sub-issue parent, and the check is skipped), and one label swap, `spec:needs-work` off and `spec:ready` on, made after the yes, or under `--yes` with no question once every check has passed, terminal or not. Exit code 0 for the normal completion; 1 for an unusable config, a value given to `--yes` or a swap `gh` refused; 2 for an untrusted author, for a body with gaps and for two `epic:` labels. The four status values are `marked` (a typed yes or `--yes`), `declined` (question answered no), `unasked` (no terminal and no `--yes`), and `already` (label already on). `--yes` answers the question alone: the write-access, template and `epic:` checks refuse under it as they do without it, writing nothing. `rafa next` never passes it, and its ceiling still refuses `--yes=ready`. The run's status and lines are the data of a json-mode terminal result. See `--no-hint` under the ending hint. |
| `src/commands/issue/unblock.ts` | `rafa issue unblock [<n>] [--all]`: the issues whose blockers have all closed, asked about one at a time, and `spec:blocked` taken off each one the answer says yes for. It reads the issue or `--all` open blocked issues, checks each named blocker against the board's state, and asks only when every blocker is closed. Exit code 0 on successful completion; 1 when the board could not be read. The eight status values are `removed` (label taken off), `declined`, `unasked` (no terminal), `waiting` (blocker still open), `fault` (line unreadable), `not-blocked` (label not on), and `failed` (read or write error). The outcome of each issue is the data of a json-mode terminal result. Nothing is written without a terminal. With `board.relationships: native` it reads the line, then prints that GitHub clears a blocker when the blocking issue closes, reads no board, refreshes the named issue on the project when `board.project.number` is set (no issue under `--all`), and exits 0 (`src/commands/issue/unblock-native.ts`). |
| `src/commands/issue/check.ts` | `rafa issue check <n> [--stamp]`: the references issue `<n>`'s saved copy names, each with its state, read by the verifier check 4 builds (`createPlanRefsVerifier`) and starting no session, so it declares no `spends`. The copy is found by number, the one `rafa-<n>-<slug>.md` under `specs.dir` beside the notes file; none is refused naming `rafa plan create --issue=<n>`, two naming both, each with exit code 1, as are a line it refuses, a config refused, a board issue `gh` could not read and a refs block the codec will not read. A plain check is `readCopyRefs`, which writes the first stamps of a reference it has none for; `--stamp` prints the rows read against the old stamps and verifies each for drift, then re-stamps every reference (`restampCopyRefs`) over one memoised verifier. Exit code 0 whatever the states are. Json mode gives the issue, the copy's path, `stamped` and every reference with its `kind`, `text`, `line`, `state`, `fingerprint` and `stamp` as one word each |
| `src/commands/issue/edit.ts` | `rafa issue edit <n>`: one issue on the tracker the chain lands on appended to (`--append-file=<file>` or `--append=<text>`, with `--reason`, `--while-in-development` allowed), its body replaced (`--replace-file=<file>`, `--title` allowed beside it) or its title changed (`--title` alone), the run being `editIssue` in `./edit-run.ts`. The command prints `renderEditReport`'s lines in text mode, each gate's reading and the added part first under `--dry-run`, and gives the report with its tracker as the data of a json-mode terminal result. Exit code 0 for `appended`, `replaced`, `already` and `stale-copy`, the last naming `rafa plan create --issue=<n> --refresh`, which it never runs; 2 for a gate's refusal, `--dry-run` included; 1 for a line refusal, a tracker read or write rejected, and `conflict`, whose report is the message of the `CommandExit`, as `pr wait` carries a non-zero ending, so both `.rafa/scratch/` paths reach the person in either mode. It starts no session, so it declares no `spends` |
| `src/commands/issue/issue-tracker.ts` | what the nine `issue` actions share: the tracker resolved through the chain, the ref an id names, the line readers and the refusals |
| `src/commands/loop/loop-sessions.ts` | what `loop stop`, `pause`, `resume`, `status`, `list` and `wait` share that reads a context or flags: the `--session-id` flag, the session a line picks, the write to its record, a phase and an ETA as written, and the refusals, the two finding no session a `NoSessionRefusal`. Its library half is `src/loop/session-readings.ts`: the records under a root, a session's checklist and rough ETA, a session as a line and the seams, which any folder may import |
| `src/commands/loop/wait.ts` | `rafa loop wait [--session-id=<id>] [--until=<reasons>] [--timeout=<minutes>]`: follows one run until a reason `--until` asks for happens, in code and starting no session, so it declares no `spends`. The session is picked as `loop status` picks it; the two refusals finding none exit 2, every other refusal of the pick 1. `--until` is read by `src/loop/wait-reasons.ts`, whose `WAIT_REASONS` table the help, the json result and the exit code all read: `pr` 0, `no-pr` 10, `halt` 11, `error` 12, `blocked` (event `task-blocked`) 13, `exit` (the record's pid not alive, or the record reading `stopped` or `done`) 14, `quiet:<minutes>` 15; left out it is `pr,no-pr,halt,error,exit`. An entry it refuses, a `--timeout` that is no whole number from 1 and a stray word exit 1. Every `WAIT_POLL_MS` (5 s) a poll reads the events file from the last offset (`src/loop/events-file.ts`, from byte 0 so a run that already ended answers), then the record and its pid, reading the events once more before answering `exit`, then the awake clock (`src/loop/awake-clock.ts`) for `quiet`, counted from the last event read, and `--timeout`, counted from the wait's start, exit 16; both count awake minutes, and on macOS, where the clock counts through sleep, a long sleep can raise a false `quiet`, which the help says. A run with no events file is noted once as a warning and the wait goes on. It prints one `rafa·` line: the event's summary, or a line naming `exit`, `quiet` or `timeout`, the last two adding the minutes suspended. In json mode the result (reason, exit code, line, event, session id, state, pid and liveness, awake and suspended minutes) is a named `wait` event, and the terminal result's `data` for `pr` alone, since the dispatcher drops a payload on a non-zero exit; for any other reason the terminal error's message is the line. The branch reader, pid probe, record read, clock, sleep and poll length are seams |
| `src/commands/pr/` | `pr current`, the open pull request of the branch checked out at the project root on one line; `pr show`, it in full with its checks and its last triage; `pr view`, it opened in the browser; `pr list`, the open pull requests as rows; `pr merge`, one merged, its `Closes #<n>` line ticked on the roadmap and both branches cleaned up after it; `pr triage`, one assessed in code into a class with its evidence and a follow-up prompt, and under `--resolve` handed to the ordinary loop over the pinned plan for its class, or for `conflict-version` converted in code with no session; and `pr wait`, its checks polled until they settle, the deadline passes or it turns out to have none, exiting 0 green, 1 red and on no checks at all, and 3 at the deadline |
| `src/commands/pr/wait.ts` | `rafa pr wait [<n>] [--timeout=<minutes>]`: polls one pull request's checks until they settle or the deadline passes, reading and writing nothing else. Exit code 0 for green (every check passed); 1 for red (a check failed) or none (no checks at all); 3 for a deadline that passed with checks still running or pending. The `--timeout` flag takes a minute count from 1, defaulting to `DEFAULT_CI_TIMEOUT_MIN`; the number is read from the line, so `rafa pr wait --timeout 41` is a 41-minute wait on the branch's own PR, not a wait on #41. The verdict state values are `green`, `red`, `none`, `pending`, and `timeout`. A green run ends with the one step that follows; the other four each carry their report as the message of their `CommandExit`. The poll is the same `waitForChecks` the loop's own CI gate uses, so one wait and the loop agree about what green means and how often a pull request is asked. The report is the data of a json-mode terminal result when green, or its error message when not. See `--no-hint` under the ending hint. |
| `src/commands/pr/open.ts` | `rafa pr open --head=<branch> --base=<branch> --title=<text> --body-file=<path>`: the four flags read and a head equal to the base refused, the body file read whole and refused when it cannot be read or holds nothing but whitespace, then `findOpen(head)` asked before `PullRequests.create`, so a head already holding an open pull request has that pull request printed with `opened: false` and none opened, warned about when its base is another. The line and the body file are read before the config, so a refusal of either makes no provider. Exit code 0 for one opened or already open; 2 where `pr.provider` is not `gh`; 1 for every other refusal. Starts no session and declares no `spends` |
| `src/commands/pr/retarget.ts` | `rafa pr retarget <n> --base=<branch>`: the number and `--base` read first, then `get(n)` for the base the pull request is on now, then `PullRequests.editBase` only when that base differs (compared exactly), printing the line `retargetedLine` (`src/start/pr-retarget.ts`) builds. A pull request already on the base sends no edit and exits 0. A refused line makes no provider. Exit code 0 for one retargeted or already on the base; 2 where `pr.provider` is not `gh`; 1 for every other refusal, a refused edit and an absent pull request among them. Starts no session and declares no `spends` |
| `src/commands/pr/triage-read.ts` | what `pr triage` gathers that is neither the line nor the pull request: the Actions run id off a check link, the `--log-failed` capture of each failing run, the repository's workflow count when no check reported, and the conflicting file list, read with `git merge-tree` between refs resolved first and never fetched |
| `src/commands/pr/triage-resolve.ts` | what `--resolve` does with an assessment: the worktree added and removed, the pinned plan filled and capped at `pr.resolveBudget`, one loop run an attempt, the CI wait after each, the attempt guard's two stops, the comment with its dependabot rebase note, and the exit code 3 a run that gave up ends with; a `conflict-version` assessment is dispatched to `./triage-convert.ts` ahead of the pinned-plan check and the loop path |
| `src/commands/pr/triage-convert.ts` | the `conflict-version` run of `--resolve`: the resolve worktree added, `convertStampedVersion` (`src/pr/triage/version-convert.ts`) making one commit that turns the stamped changelog section into a release fragment and sets the version file and the changelog back to the merge base's, the branch pushed with `pushResolved` and never forced, and the worktree removed; no plan, no session, no CI wait, no attempt raised and no comment written, exit 0 when converted or already unstamped and 3 when the conversion or the push is refused |
| `src/commands/pr/triage-trust.ts` | board trust as `pr triage` asks it, over `src/board/trust.ts`: the newest `rafa:pr-triage` marker comment whose author holds write access or is listed in `board.trustedAuthors`, with every newer one passed over and reported rather than read, and the exit-2 refusal `--resolve` makes over a pull request whose own author is neither trusted nor a known dependency-bump bot |
| `src/commands/pr/resolve-loop.ts` | one `--resolve` attempt's loop: the filled plan written under `~/.rafa/resolve/pr-<n>/attempt-<k>`, outside the worktree so the loop's own commit cannot push it, and `rafa loop start --plan=<file> --no-ci-wait` spawned in the worktree with its stdout forwarded a line at a time |
| `src/commands/pr/triage-report.ts` | the one pure renderer of a triage: the head line, the re-run sentence, the class with its evidence or the stored triage, what was written, and the follow-up prompt whole |
| `src/commands/pr/merge-tick.ts` | what `pr merge` decides about the roadmap tick: the issues the merged pull request closes, each one's line on the checklist of the open epic its `epic:` label names (through `src/board/epic-checklist.ts`, one sentence per epic), every open `type:roadmap` board whose checklist lists one (with a `roadmap.issue` the listing does not hold), or while none is labelled the roadmap issue `roadmap.issue` names or the search finds, and every failure on the way turned into a warning |
| `src/commands/pr/merge-unblock.ts` | the unblock reading `pr merge` runs after its clean-up, ahead of the follow-ups: the open `spec:blocked` issues whose `Blocked by:` line names an issue the merged pull request closes, run through `runUnblock`, with every failure turned into a warning naming the reading |
| `src/commands/pr/merge-freed.ts` | what `pr merge` reads after its clean-up in the unblock reading's place under `board.relationships: native`: the board's repository by `gh repo view`, one native board listing, and the port's `freedBy` over it for the issues the merged pull request closes, printed under a line opening `board.relationships is native` with no question and no write, every failure a warning naming the reading |
| `src/commands/pr/merge-project.ts` | the project refresh `pr merge` runs after its board reading, ahead of the follow-ups, in both `board.relationships` modes: with `board.project.number` set, the issues the merged pull request closes and the issues those were blocking (read off one board listing through the relations port's `blockersOf`, plus the issues the unblock reading considered), refreshed together through `refreshProjectItems`; nothing sent with the number unset or a body closing no issue, and every failure a warning naming `rafa board sync` |
| `src/commands/pr/merge-refuse.ts` | what `pr merge` (`src/commands/pr/merge.ts`) reads off git before it asks anything: `refuseFromGit` reads `git status --porcelain`, `git ls-tree -r --name-only` over the head commit and `origin/<base>` when the tree has an untracked path, `git worktree list --porcelain` and `git rev-parse --show-toplevel` at the project root, runs the loop worktree step (`./merge-loop-worktree.ts`) and lists the worktrees again after it freed one, then hands those readings with the pull request and its checks to `readMergeRefusal` (`src/pr/merge.ts`) and refuses with exit 1 on its answer or on a git reading that failed, or else prints one line naming the untracked paths it leaves in place |
| `src/commands/pr/merge-cleanup.ts` | what `pr merge` runs after the provider merged: the `ls-remote` and `show-ref` probes of both branches, the clean-up steps walked and each reported, the exit-1 refusal naming the rest to paste at the first that failed, the line saying what is ready, and the follow-ups read off `package.json`, the runtime directory and the settle dry run (`readSettle`) over `origin/<base>` where `release.enabled` reads on, printed under `Follow-ups:` |
| `src/commands/pr/merge-guard.ts` | the release guard's step in `pr merge`, called from `runMerge` after `readMergeRefusal` and before the question, only where `release.enabled` reads on: `readMergeGuard` (`src/release/guard-merge.ts`) fetches the base and the head from `origin` and reads the guard over `origin/<head>`, and `guardReaction` picks what to do. `clean` prints its lines, the forecast among them; `missing` and `stale` follow `pr.versionCollision` (`allow` silent, `report` warns, `ask` asks `Merge #<n> with its release guard reading <answer>? [y/N]` before `Merge? [y/N]`, `refuse` refuses with exit 1); a `collision` refuses with exit 1 unless `dangerous.acceptVersionCollision` is true, when it warns and merges; a guard that could not read warns and never refuses. `--yes` does not answer the guard's question, and without a terminal `ask` refuses with exit 1. A refusal names the answer and the setting first, so a `stale` or `collision` one still ends with `rafa pr triage <n> --resolve`. `PrMergeResult.guard` carries the answer, the reaction and the lines, null where the release does not run |
| `src/commands/pr/merge-followups.ts` | what `pr merge` names after a clean-up that finished: `rafa self-update` while the project's `package.json` names rafa's own package and the version is not installed under the home, and `rafa release settle` — always last, so it is the merge's last line ahead of the ending hint — while the settle dry run folds the fragments waiting on the base into a version (`<n> fragments wait on <base> and fold into <version>`); a base holding only `level: none` fragments names nothing. It no longer names `rafa release tag`, which settle's own tag step names where it leaves the tag to the operator; `versionTag` stays spelled here |
| `src/commands/pr/pr-context.ts` | what the nine `pr` actions share: the usage lines, the line readers, the provider check and its exit-2 refusal, and the pull request `<n>` or the branch names |
| `src/commands/pr/last-triage.ts` | the `<!-- rafa:pr-triage v1 -->` comment and its `rafa:triage` block as one record, which `pr show` ends with; the marker, the block and the writer that posts and edits the comment are `src/pr/triage/comment.ts`'s |
| `src/commands/init.ts` | `rafa init`: the root chosen by `--root`, `--yes` or a prompt, the project scope (`.rafa/`, `.rafa/config.yaml` and `specs/`, `plans/`, `runs/`, `effort/`, `instincts/` directories under it), the user scope (`~/.rafa/` and its `config.yaml` and `instincts/`), and the `.gitignore` entry, written by `src/project/scaffold.ts` |
| `src/commands/init-board.ts` | the board step `rafa init` ends with: `--board`, `--no-board` and the one question with its public-repository line, over `src/board/setup.ts`. When `board.relationships` is set it runs the relationships move step: it reads the board listing in the configured mode and finds the other mode's marks (in `labels` mode every `parent` and `blockedBy` list, in `native` mode every `epic:` label on a non-epic and every `spec:blocked` label), prints every write that would move them (from `labels` to `native` each epic's members become sub-issues and each `Blocked by:` line becomes blocked-by, the reverse moves back), asks once whether to run them, writes nothing on a no, and removes the old mode's marks on a second question asked only after every write succeeded, finding nothing on a rerun. Then the epic guard step: `--epic-guard`, `--no-epic-guard` and its own question, writing `.github/workflows/epic-guard.yml` through `src/board/epic-guard.ts`; under `board.relationships: native` the guard step reads, asks and writes nothing (`native` status), and `--epic-guard` is refused with the warning `EPIC_GUARD_NATIVE_REFUSAL` naming the mode, exit 0 |
| `src/commands/init-release.ts` | the release step `rafa init` takes once the scopes are written: `--release`, `--no-release` and the one question, written as `release.enabled` through `src/release/setting.ts` |
| `src/commands/doctor.ts` | `rafa doctor [--plan=<file>] [--deep]`: the `rafa <version>` line it opens with, the preflight `loop start` checks, checked for the config and a plan with no run started, the risk total of a plan `--plan` names over `src/start/risk-total.ts`, the GitHub board readings over `src/commands/doctor-board.ts`, the project rows over `src/commands/doctor-project.ts`, the cleanup row over `src/commands/doctor-cleanup.ts`, the references row over `src/commands/doctor-refs.ts`, the release row over `src/commands/doctor-release.ts`, the skill tier rows over `src/commands/doctor-tiers.ts`, the `effort store schema` row over `src/commands/doctor-effort-schema.ts`, the `effort sync` row over `src/commands/doctor-effort-sync.ts`, and the install warnings over `src/commands/doctor-install.ts`; under `--deep` it hands each deep section module its seams and prints their readings |
| `src/commands/doctor-deep.ts` | `rafa doctor --deep`'s whole reading: each deep section read once per run into one `DeepReading`, the text lines both render, and the seams `DoctorSeams` takes for them; it decides what each section is read under, in which order, and how the Environment reading reads as rows |
| `src/commands/doctor-deep-env.ts` | the Environment reading of `--deep`: the environment a loop session would run with, the directory it would run in, and how that environment differs from the shell's, over `src/utils/session-env.ts` for the spawn layer and `src/inventory/disabled.ts` for the settings files |
| `src/commands/doctor-deep-settings.ts` | the Settings reading of `--deep`: the setting sources a loop session loads, and every agent, skill and MCP server configured on this machine that such a session is not handed, over `src/inventory/` and `src/inventory/disabled.ts`'s rules |
| `src/commands/doctor-deep-providers.ts` | the Providers reading of `--deep`: the configured tracker and pull request provider, and — when either goes through `gh` — whether `gh` answers under the environment it is handed |
| `src/commands/doctor-deep-needs.ts` | the Stack tools and Plan needs readings of `--deep`: every unmet stack tool and, for a plan `--plan` names alone, its unmet needs over `src/plan/needs.ts` |
| `src/commands/doctor-deep-row.ts` | the row every deep section is read into, the section holding them, and the text lines both render to; each status is `ok`, `warn` or `note`, never a failure or a `PreflightCheck` |
| `src/utils/session-env.ts` | the environment every Claude session is spawned with: `CLAUDE_CODE_ENTRYPOINT` set to `cli` over whatever `process.env` holds for it, `PATH` with the running entry's `bundled/bin` in front, and every other entry handed on as it is |
| `src/cleanup/index.ts` | the main cleanup reading module: `readCleanup` over the settings and seams reads and groups the merged, stale, not-pushed and worktree rows (the groups read with the settings' `release` paths, the config's defaults when left out, as `rafa doctor` and `rafa status` leave them; the worktrees read after the groups, which name the merged branches a clean worktree is ticked for, then `holdBranchRows` over each branch group, unticking a branch an untickable worktree holds and naming that worktree), then the run records `./runs.ts` lists (a run-record note follows the groups' notes); `cleanupSteps` renders the ticked rows into deletion steps; `runCleanupSteps` and `dryRunLines` run them or show what they would do; `defaultCleanupSeams` wires the git runner, the branch and worktree readers, and the pull request provider; and `cleanupCounts` counts the branch and worktree rows for `rafa doctor` and `rafa status`, never the run records |
| `src/cleanup/branches.ts` | reading merged, stale and not-pushed branches: over the config's `pr.base`, `cleanup.keep` and `cleanup.staleDays`; the current branch, the base, the branch `origin/HEAD` names whenever it resolves (beside a `pr.base` naming another) and every `cleanup.keep` match are never listed; merged rows are reachable from the base; stale rows have an upstream, are not merged and have no commit in the day count; not-pushed rows have no upstream or commits ahead of it; the provider tells merged from stale when the upstream is gone, and squash-merged rows are marked for `-D` instead of `-d` |
| `src/cleanup/worktrees.ts` | reading idle worktrees: under `.claude/worktrees/`, `~/.rafa/worktrees/` and the loop's `loop.worktreeDir` (`.rafa/worktrees/<stub>` by default, resolved from the project root by `worktreeDirAt`), filtering the current worktree, the ones locked or dirty, the ones running a loop session, and the ones modified within `cleanup.worktreeIdleDays`; each row carries its path, its last access time and what stops it from being ticked |
| `src/cleanup/runs.ts` | reading the removable run records under `.rafa/runs/`: every session record except a live one (`readState` reads it `running` or `paused`) and the newest of its plan among the rest (`planStub`, or `plan` when null, by `startedAt`); each row carries the record path, its events file when one sits beside it, the plan and the start time, and is ticked; a missing directory lists nothing, an unlistable one or a file holding no record answers a note, never a throw. `readCleanup` reads it last, from `projectRoot` |
| `src/cleanup/groups.ts` | grouping the merged, stale, not-pushed and worktree rows as one reading: each row carries its ticked state, which is true for every merged row save the two kinds below, every clean worktree on a merged branch, and nothing else, as the command's description names; a merged, stale or not-pushed row a listed worktree that cannot be ticked (dirty, locked, current, a live session, recent or unreadable) holds starts unticked, a merged one instead of ticked, carries that worktree as `heldBy`, and its reason ends `checked out in <worktree name> (<blocker>)`, applied by `holdBranchRows`, which `classifyBranches` runs over each group and the worktrees its settings name; a merged row listed only because its upstream is gone (the base does not reach its tip, no merged pull request has it as head) starts unticked too: when a merged pull request naming the branch has a head the tip descends from (`readPastHead` of `./past-head.ts`, over the `release.fragments` and `release.changelog` its settings name, the config's defaults when left out), the row carries that reading as `pastHead` and its reason ends `<n> commits past #<pr>'s head: <subjects>`; otherwise it ends `<base> does not reach its tip`; a past-head reading git refuses is a note, never a failure |
| `src/cleanup/past-head.ts` | reading what a branch holds past a merged pull request's head: `readPastHead` answers `not-descended` when the head commit is not an ancestor of the branch's tip (or the clone lacks it), else the commits past the head, oldest first, with their count, subjects and paths, each `held` when every path it touches (`git diff-tree -r -m`, so a merge counts its changes against every parent) is a release fragment directly under `release.fragments` that the base already holds, as the file in the base's tree or its id in a `<!-- rafa:fragments … -->` receipt of the base's `release.changelog`; a tip equal to the head counts zero and is held; a git failure answers `unread`, never a throw. `./groups.ts` calls it for a merged row listed only because its upstream is gone |
| `src/cleanup/steps.ts` | turning the ticked rows into deletion steps: one step per branch, one per worktree, and one `remove-run` step per ticked run record (`rm <record> [<events file>]`, after the branches, its files removed by the runner through the `CleanupFiles` seam rather than a spawned `rm`); a withheld row (one the deletion cannot run) is one warning each, among them a merged, stale or not-pushed branch an untickable worktree holds when it is ticked anyway (never a `git branch -D` step), and a merged branch whose commits past its pull request's head are not all release fragments the base holds, the warning naming each such commit by short hash and subject, so `--dry-run` prints no step for either, while a branch a ticked clean worktree holds is deleted after that worktree's removal; `needsForcedDelete` answers `-D` for a merged branch the base does not reach only when a merged pull request's head is its tip or every commit past that head is a held release fragment; both the force guard and the refusal to delete remote are here |
| `src/cleanup/scratch-repository.ts` | the test fixture, not a reader: a bare remote and a clone holding one merged, one squash-merged, one stale, one unpushed and one `[gone]` branch, and a clean merged, a dirty and a locked worktree under `.claude/worktrees/`. Not a test file so `check-types` opens it, and not re-exported from `./index.js`; the `readCleanup`, `rafa cleanup` and `rafa doctor` integration tests build it |
| `src/commands/cleanup-render.ts` | rendering the five groups as lines: `renderCleanup` prints the listing, Run records last under `CLEANUP_GROUP_TITLES.runs`; `branchRowLine`, `worktreeRowLine` and `runRowLine` each row as name, date and reason (a run record's name its plan, its date the day it started, its reason its session id and whether its events file goes with it), and `cleanupNameWidth(read, kind)` measures the longest name per kind of row (`branches` over Merged, Stale and Not pushed, `worktrees` over the paths, `runs` over the plans), so a long worktree path never pads a branch row; the listing and the `rafa cleanup` checklist pad each kind to its own column; `cleanupData` carries the run records as `runs`, beside counts that stay on branches and worktrees |
| `src/status/sections.ts` | the six readers `readStatusSections` holds and calls: branch and plan, loops, pull request, board (with the current place, `resolvePlace` over the one board listing, when the project has a position file or a `type:roadmap` issue), claims (wired from `src/status/claims.ts`), housekeeping, each with its own seams to the git, session, plan, pull request and GitHub providers |
| `src/status/claims.ts` | the claims section's reader: `readClaimBranches` lists the `origin` `feat/rafa-*` remote-tracking refs as last fetched, with no fetch, passing over a branch with no claim commit, and `readClaims` gives each claim its owner store id (or who released it, and a pending handover's receiver), the stage labels read off the one board listing, and `readClaimState`'s stale state; labels not read are a note and read as in development |
| `src/status/render.ts` | `renderStatus` and `statusData`, the text and json output formats of `rafa status` |
| `src/status/blocked-count.ts` | `readBlockedCount`, the count ending the Board line in the board's relationships mode: the open issues labelled `spec:blocked` in `labels` mode, or those a blocker still holds on the one board listing in `native` mode, which `render.ts` words as issues with an open blocker |
| `src/status/seen.ts` | the local reading `takeSeenSnapshot` takes at the start of every command and writes for the next, held in `<root>/.rafa/status-seen.json`, through `readSeenFile` and `writeSeenFile` |
| `src/status/notice.ts` | the since-last-command notice: `compareSeen` finds what changed between two snapshots (`idleWorktrees`, `mergedBranches`, `stoppedSessions`, `blockedSessions`), and `noticeLine` answers the one stderr line naming `rafa status` or `rafa cleanup` |
| `src/status/hook.ts` | the since-last-command notice as the dispatcher's command hook: `before` compares snapshots and returns the line, `after` writes the current snapshot so the next command finds what this one did |
| `src/commands/status.ts` | `rafa status`: where the project stands in six sections — branch and plan, loops, pull request, board, claims, housekeeping — read by the six readers of `src/status/sections.ts` and worded by `src/status/render.ts`. It is all code: it starts no Claude session and declares no `spends`. The six sections are run in order and the pull request, board and the claims' stage labels are read through `gh` under a short deadline with no fetch. Under the Claims line sits one line per claim branch on `origin` as last fetched, naming its issue, the store that owns the claim, the stage label on the issue and whether it is stale. A section that could not be read is one `warn` line saying why. Under the Board line, only when a position file exists or an open issue carries `type:roadmap`, sit the place line, while away from home the away line, and `waiting on #C (owner review)` while a `.rafa/hop.json` record in state `waiting` names a pull request still open whose owner gate lets no merge through (`src/status/place-line.ts`), then each fallback notice `resolvePlace` gave but the absent-file one as an indented `warn` line; the board listing is read once for both the place and the walk. A project with neither prints what it did before boards. Everything else is `info`. Exit code 1 only for a config `loadConfig` refuses; 2 for a positional word; 0 otherwise |
| `src/commands/cleanup.ts` | `rafa cleanup [--dry-run]`: the reading of `src/cleanup/` (`git fetch --prune` first, `pr.base`, the three `cleanup.*` settings, `loop.worktreeDir` for the loop's worktrees, `release.fragments` and `release.changelog` for the commits a merged branch holds past its pull request's head, git run in the directory the command runs from, the provider `resolvePrProvider` resolves at the project root, or none) shown in five groups, the fifth the run records `src/cleanup/runs.ts` lists under the project root's `.rafa/runs/` (one row per record naming its plan and start date; never a running or paused run, nor the newest of a plan), in code and starting no session, so it declares no `spends`. With a terminal the groups are one grouped `multiSelect`, each row the line `./cleanup-render.ts` prints and ticked as the reading ticks it, every run record ticked; each ticked Not-pushed row then asks a second `[y/N]` naming its commit count, and `Delete <n> branches, remove <m> worktrees and remove <r> run records? [y/N]` asks before `src/cleanup/steps.ts` runs the steps, a run record's step removing the record and its events file. Removing records lowers the count the `loop start` drift check reads its every-second-run cadence from (`src/start/preflight-drift.ts` counts the records left under `.rafa/runs/`), so the next due run after a cleanup is counted from what is left. The questions go through a line `Prompter` opened only after the checklist answers, so the two readers never share standard input. `--dry-run` asks the same checklist and second questions, then prints each step's command line in place of the final question. Without a terminal, or with `--output=json`, it prints the five groups (the json data being `cleanupData`, its `runs` the run records), asks nothing and removes nothing, `--dry-run` included. Exit code 0 for every run that removed what was answered or nothing; 1 for an argument, a value typed after `--dry-run`, a config `loadConfig` refuses, a repository git cannot read, and a step that did not run clean |
| `src/commands/doctor-render.ts` | the lines of `rafa doctor`'s plan section: the head, a line per check, the start-only items a resume passed over, the PREREQUISITES steps nothing checks, and the verdict |
| `src/commands/doctor-project.ts` | the project rows of `rafa doctor`, read only on a `gh` provider with `board.project.number` set, over the board's `gh` runner: the `project` scope (`holdsProjectScope`, `src/commands/init-board-project.ts`), the project at that number of the repository's owner (`createGhProjectPort`'s find) and its five fields (`matchProjectFields`), each `present`, `missing` or `unknown`; a row waiting on one not present sends nothing; it reads no item and never changes the exit code |
| `src/commands/doctor-cleanup.ts` | the cleanup row of `rafa doctor`: the four counts `rafa cleanup` would list (`cleanupCounts` over `readCleanup` with `fetch: false`, git in the project root, `loop.worktreeDir` from the config or `.rafa/worktrees` when the config handed in lacks it, as `rafa status`'s does, the provider the board's `gh` runner, or none), rendered as one line naming every count and `rafa cleanup`, only when any count is above zero |
| `src/commands/doctor-refs.ts` | the references row of `rafa doctor`: the drift and unknown references of every saved copy `rafa-<n>-<slug>.md` directly under `specs.dir` (notes file and `previous/` aside), verified through `src/refs/` and one memoised issue reader read by repository and number over the board's `gh` runner; a board issue `gh` cannot read, or any issue with no runner, reads `unknown` rather than failing the row, and a copy that cannot be read fails alone. One head line when there is any copy, and a line per copy holding a drift reference naming `rafa issue check <n>` |
| `src/commands/doctor-release.ts` | the release row of `rafa doctor`, read only where `resolveReleaseEnabled` says the release is on: the version `origin/<pr.base>` declares as last fetched, the waiting fragments and their forecast (`readWaiting`, `src/commands/release/status-fragments.ts`), the latest release tag (`readTags`) and the version of the changelog's top heading (`changelogVersions`), all through `rafa release status`'s readers, the last two in its library half `src/release/status-readings.ts`; one `Release:` line, a warning in both modes naming `rafa release settle` while any fragment waits, `info` in text mode otherwise, and a `?` with an indented reason for a part it could not read |
| `src/commands/doctor-effort-schema.ts` | the `effort store schema` row of `rafa doctor`: the store every other command would open, read through `readSchemaReport` (`src/effort/store/schema-report.ts`) and never brought forward; `fail` where `rafa effort schema --check` fails, with the refusal `doctor` exits 1 with, `warn` for each unknown additive migration and, in the project's own store alone, each `applied_by` holding `+dev:`, `ok` otherwise |
| `src/commands/doctor-effort-sync.ts` | the `effort sync` row of `rafa doctor`: the strategy `effort.sync` names, selected through `selectSync` (`src/effort/sync/select.ts`) over `CORE_ADAPTER_REGISTRY` for a kind core holds and over the registry `loadModules` answers for any other; `ok` naming the strategy and whether core or a module serves it, `fail` with the refusal `doctor` exits 1 with otherwise, `SyncModuleMissing`'s `modules:` and `allowList:` lines included for `git`, `service` and `p2p` |
| `src/commands/doctor-description.ts` | the help description of `rafa doctor`, moved out of `src/commands/doctor.ts` to keep that module under the 800-line cap; text alone |
| `src/commands/doctor-install.ts` | the install readings `rafa doctor` reads before its preflight and warns by after it: `~/.rafa/bin` on `PATH`, a store left under `.ralph/effort/`, a pre-init `plan.dir` or `specs.dir`, and the previous copies under `specs.dir` |
| `src/commands/doctor-board.ts` | the GitHub board readings of `rafa doctor`: the one `gh` runner opened for a `gh` provider and none for another (`boardRunner`), the board rows over `src/board/status.ts`, the blocked issues and the epic labels in `labels` mode or the relationships row in their place in `native` mode (`board.relationships`, handed in by `rafa doctor`), the other mode's marks when a config layer sets `board.relationships` (`modeSet`), and the boards, read over it in that order (`readDoctorBoard`, all four null with no runner, `relations` left out in `labels` mode, `marks` left out with the key unset), the board listing made once in that mode, or in the native fields whenever the key is set, and handed to the epic labels (or the relationships), the marks and the boards, their lines joined in that order (`renderDoctorBoard`), and the json result's `relations` key, left out in `labels` mode, and `marks` key, left out with the key unset (`relationsResultOf`) |
| `src/commands/doctor-relations.ts` | the relationships row of `rafa doctor`, `native` mode only: over the shared native listing and one `gh repo view --json nameWithOwner`, the `native` adapter's `blockersOf` for every open issue and `membersOf` for every epic, naming each whose `blockedBy` or `subIssues` list `gh` answered short of GitHub's `totalCount` under `Relationships:`; one line counting a board whose lists all read whole, nothing for one with no blocker and no sub-issue, and one line naming a listing or repository read that failed |
| `src/commands/doctor-epics.ts` | the epic labels row of `rafa doctor`, `labels` mode only: one board listing over `src/board/roadmap-board.ts`, the `several-epic-labels` and `orphan-label` problems of `readEpicProblems` (`src/board/epic-problems.ts`) kept and worded by `epicProblemMessage`, no orphan reported when the listing came back full, and the `Epic labels:` lines, none for a board carrying no `epic:` label |
| `src/commands/doctor-marks.ts` | the other mode's marks row of `rafa doctor`, run only when a config layer sets `board.relationships`: over the shared listing, in `native` mode every `epic:` label on an issue that is not `type:epic` and every `spec:blocked` label with whether a `Blocked by:` line sits beside it (a line without the label is not named: `labels` mode never reads it), and in `labels` mode, after one `gh repo view --json nameWithOwner`, every sub-issue `parent` and `blockedBy` list; named under `Other mode's marks:` in ascending issue number with `rafa init --board` as the fix, nothing for a board with none, and one line naming a listing or repository read that failed |
| `src/commands/doctor-boards.ts` | the boards row of `rafa doctor`: over the listing the epic labels row reads, every open `type:roadmap` board whose `Owner:` handle `src/board/owner-resolve.ts` answers `unresolved` (one `gh api` per distinct handle; `unknown` is a line saying it could not be checked), the `unlabelled` issues titled "Roadmap" of `resolveDefaultBoard` worded by `unlabelledRoadmapMessage` (`src/board/boards.ts`), and each `lost` notice `resolvePlace` (`src/board/place.ts`) raises for the position file, printed in its words under `Boards:`; nothing for a project with none of them, and nothing for a failed listing, which the epic labels row (the relationships row in `native` mode) names |
| `src/commands/doctor-blocked.ts` | the blocked-issue reading `rafa doctor` ends with in `labels` mode, over `src/board/blocked.ts`: the open issues labelled `spec:blocked` listed with their bodies, the board's issue numbers read only once a line named ids, and the `Blocked issues:` lines a fault is named in |
| `src/commands/doctor-tiers.ts` | the skill tier rows of `rafa doctor`, read on every run by `checkDoctorTiers` over the inventory seams `--deep` builds and the session's environment: one `warn` per collision (every holder's path, the pin line as the fix), per rafa-tier or add-on item `provenanceBlock` refuses, and for an installed Claude Code other than `SERVE_CLI_VERSION`, and again for one other than `SKILL_USE_CLI_VERSION`; a `note` per byte-identical copy to delete (the rafa holder kept, a link to the kept file not counted), per user-tier item with no `provenance` while `user` is loaded, and for a version that could not be read |
| `src/commands/doctor-stretch.ts` | the stretch row of `rafa doctor`, wired into `src/commands/doctor.ts` with no more than the row call: warns when `pr.base` names a `stretch/*` branch that no live stretch of the project holds, reading the live stretches through `src/stretch/folder.ts` and the base through the config |
| `src/commands/self-update.ts` | `rafa self-update`: the checkout built and installed through `src/runtime/install.ts`, which `scripts/snapshot-runtime.ts` calls too |
| `src/commands/update/current.ts` | `rafa update current [--dry-run] [--yes]` (#714): the project brought to the installed rafa when `rafa.lock` at the root records the same major and minor, or any older minor while both are below 1.0.0, or adopted when there is no lock; the missing `.rafa/` folders, the missing board labels on a `gh` board, the deprecations step (#718, empty) and the lock, read by `src/project/update-current.ts`, printed, then applied after one question or `--yes`; refusing with exit code 1 with no terminal and no `--yes`, for a newer minor or major or an older installed rafa (semver precedence, so a release candidate over its release is older), and for a label `gh` would not create once the rest is applied; exit code 2 for a `.rafa/` path holding something else, checked before asking, and for a folder or lock write that fails, naming the step and what stays written. The lock is the checkout's the command runs in (`checkoutLockRoot`), so in a linked worktree it lands on that branch, while `.rafa/` stays the main checkout's |
| `src/commands/update/stub.ts` | `createUpdateStub`, the other `update` actions until their specs land (#713): `self`, `project`, `board`, `next` and `latest`, with `rafa` and `port` hidden spellings of `project`, each refusing with exit code 1 in one line naming its issue |
| `src/commands/config/set.ts` | `rafa config set <key>=<value>`: the one word split at its first `=`, the project's `.rafa/config.yaml` edited through `withConfigSetting` (`src/config-set.ts`) with every comment kept and read back before it is written, and the key's old and new values printed, `(not set)` for a key the file did not set; a file already reading the value left byte-identical; exit code 1 with nothing written for a malformed argument and each `ConfigSetRefusal`. Starts no session and declares no `spends` |
| `src/commands/ci/status.ts` | `rafa ci status --branch=<branch> [--workflow=<name>]`: the newest run on the branch read by `readNewestRun` (`src/ci/runs.ts`), and for a finished run whose conclusion is not `success` its `gh run view <id> --log-failed` read by `readFailedCases` (`src/ci/failed-cases.ts`), both through one `GhRunner` made at the project root, the seam its tests replace; prints the state, the 7-character commit and the failed cases by file and case, a dropped log (`log not found`) still red with its cases null. Exit code 0 green, 1 red, 2 no run, 3 not finished, and 4 for a line it refuses and for every `gh` failure, a workflow `gh` does not know included, so no failure to read passes for red. Json mode writes the reading as a `ci-status` event on every verdict and as the terminal result's data when green. Starts no session and declares no `spends` |
| `src/commands/stretch/start.ts` | `rafa stretch start [--n=<n>] [--remote-control] [--role=<role>] [--dry-run]` (#816): opens stretch `--n`, else the next one (`nextStretch`, `src/stretch/folder.ts`). Refused with exit code 1, before any step, while a stretch of the project is live (`liveStretches`) or a loop of it runs (`readSessions`, `running` or `paused`), for a package with no operators (`findOperators`), for `claude` not on PATH outside `--dry-run`, and for a `pr.base` edit `withConfigSetting` refuses. Then, each printed as the line it runs: `git fetch origin <default>` (`origin/HEAD`'s target, else `main`); `git push origin origin/<default>:refs/heads/stretch/<n>` unless `git ls-remote` finds the branch there; the `pr.base` the project file held recorded in `.rafa/stretch/<n>/stretch.json` (`StretchRecord`, kept when one is there); `rafa config set pr.base=stretch/<n>`; the operators copied once (`copyOperators`, printed as `cp -R`) and the version line; the tmux lines of `src/stretch/launch.ts`, then `tmux switch-client` inside tmux, `tmux attach` on a terminal, or the attach line. Without tmux it prints the two `--role` lines for other terminals and starts the engineer here. `--role` starts that one operator session in this terminal with none of the refusals, the watchtower and analyst first waiting for the engineer's `agent.json`; `claude`'s exit code is the command's. `--dry-run` prints every step in order and runs none, the readings that decide them still read. Exit code 2 for a reading or step that failed, naming the steps already done. Every effect is a `StretchStartSeams` field. Declares `spends` unless `--dry-run` |
| `src/commands/stretch/item.ts` | `rafa stretch item <issue> [--wait] [--dry-run]`: plans and runs a loop on the integration branch the `pr.base` names, which must be a `stretch/*` branch. Refused with exit code 1 if `pr.base` names the default branch. Runs `plan create --issue` without `--accept-refs`, then starts the loop as a detached child with `--as-worktree --no-ci-wait` and `RAFA_OUTPUT=events`, logging to `.rafa/stretch/<n>/loop-<issue>.log`. With `--wait`, waits on the loop through `rafa loop wait`. Once the loop has a pull request, merges it with the `pr merge` logic and checks skipped, that merge allowed only into a `stretch/*` base, then waits for the run on the integration branch's new head and prints the pit-stop readings. With `--dry-run` prints every step and runs none. Exit code 0 for all steps successful; 1 for a refused base or a loop that ended with no pull request; 2 for other refusals. Every effect is a `StretchItemSeams` field. Declares `spends` unless `--dry-run` |
| `src/commands/stretch/end.ts` | `rafa stretch end [--dry-run]`: opens the pull request from `stretch/<n>` to the default branch through the `pr open` logic, its body being `report.md` with every ledger item's `Closes` lines appended. Refused with exit code 1 when there is no `report.md`, and with exit code 2 where `pr.provider` is not `gh`. Once that pull request has merged, puts back the `pr.base` recorded in `.rafa/stretch/<n>/stretch.json` through `src/config-set.ts`. With `--dry-run` prints every step and runs none. Exit code 0 for all steps successful; 1 for a refused refusal, 2 for provider or merge failure. Every effect is a `StretchEndSeams` field. Starts no session and declares no `spends` |
| `src/commands/next.ts` | `rafa next [--dry-run] [--roadmap [--claim-ahead]] [--yes[=<action ids>]]`: reads the project once — the running loops, the branch and its base, the plans and their trackers, the open pull request and its checks, the roadmap walked from the current place (`ghNextBoard`, `src/next/sources.ts`: the default board with no position file, else the place's board, or its epic's lines alone) — and prints where it stands on one line and the one thing to do about it on the next, then runs that action and reads again, until the answer is no, an action fails, there is nothing to run, or a loop has started. Exit code 0 for every ending (dry-run, nothing-to-run, declined, unasked, loop-started, unchanged, capped); 1 for a line it refuses and for a `sync` that would not fast-forward; 2 for a `--yes` list that is refused and for a repository whose `pr.provider` is not `gh`; or whatever an action threw. The `--dry-run` flag prints the two lines and stops. The `--yes` flag takes an optional comma-list of action ids, allowing those steps unasked and stopping at the first action the list leaves out. A list may name the eleven ids of `YES_ACTIONS` (`src/next/ceiling.ts`): `sync`, `resume`, `wait`, `triage`, `merge`, `settle`, `start`, `plan`, `unblock`, `hop` and `home`; bare `--yes` allows `sync`, `wait`, `unblock`, `plan` and `home`. Once a `merge` or `merge-unchecked` action has run, the settle step (`readSettleAfterMerge`, `src/next/settle-step.ts`) reads the settle dry run over `origin/<base>` that `pr merge`'s own follow-up is decided by (`settleWaitingOn`, composed as `OpenedNextSources.settle`) and, while the waiting fragments fold into a version, puts state `fragments-waiting` with action `settle` — `rafa release settle` with no words — as one more turn; it is asked like `merge`, bare `--yes` leaving it out since it pushes to the base, so it runs unasked only under a list naming `settle`, and the next turn is compared with the merge's state, so a merge that moved nothing still stops `unchanged`. A reading that throws is warned about and the chain goes on without the step. `hop` and `home` (`ROADMAP_ACTIONS`) are proposed only by the hop rows, and the stop lines (`src/next/lines.ts`) leave them out of the lists they print unless the run was typed with `--roadmap`, so a plain run prints what it printed before they were ids. The `--roadmap` flag opens the sources with `roadmap` (`openNextSources`: the board's hop reading, and `NextSources.roadmap` holding the owner gate `src/next/owner-gate.ts` composes), passes `--roadmap` last among the words of the `plan`, `start` and `resume` actions (`ROADMAP_PASSED_ACTIONS`, `src/next/actions.ts`), and, once a loop action has run while a hop is away, puts the `home` step (`readHomeAfterLoop`, `src/next/state.ts`) as one more asked or allowed turn before the chain stops `loop-started`; without the flag none of these happens and no key is added. The `--claim-ahead` flag, read beside it (`readClaimAhead`, `src/next/lines.ts`), adds `--claim-ahead` after `--roadmap` to the `plan` action's words alone (`CLAIM_AHEAD_WORD`), and a line giving it without `--roadmap` is refused with exit 1. A list naming an id of the always-asked set `ALWAYS_ASKED`, `ready` or `merge-unchecked`, is refused with exit 2. `rafa next` asks no question of its own before `merge-unchecked`: it closes its prompter and hands the question to `pr merge <n> --skip-checks`. The state table has rows indexed by id (a `NextAnswerId`), each holding `state.action` and `state.problems`, read afresh each turn; a pull request reporting no checks and not conflicting is row `pr-no-checks`, whose action is `merge-unchecked`. Each run step is recorded with its state id, the action it proposed, the command that ran it (or null for `sync`, `hop` and `home`, which run in-process), whether `rafa next` asked about it, and whether it ran. Under `--roadmap` the report also carries `hops`, what each `hop` and `home` action that ran wrote, in order; the key is left out without the flag. The report is the data of a json-mode terminal result. See `--no-hint` under the ending hint. |
| `src/commands/switch.ts` | `rafa switch <n | -> [--no-rehome]`: this checkout's place moved to a board or an epic by its number, or back to the previous place, decided off one board listing and written to `.rafa/position.json` through `src/project/position.ts`, starting from the place `src/board/place.ts` resolves |
| `src/rafa.ts` | the entry: `process.argv` dispatched through `CORE_REGISTRY` with `renderHelp`, and the exit code set |

### Project scope and configuration discovery

The dispatcher's `resolveProjectConfig` reads the git root, walks upward for
`.rafa/config.yaml`, and stops at the repository's top level (`src/project/scope.ts`).
When the start folder is inside a git working tree, the walk never leaves that
tree to read a `.rafa/` above it. A linked worktree answers its main checkout's
`.rafa/` through a fallback in `src/project/worktree-root.ts`, which is consulted
when the walk finds nothing. A project always has its own `.rafa/` if it runs at
all, so a setup relying on a parent config must keep the parent folder outside
any repository. The project root the dispatcher found is handed to every command,
so all reads are consistent even when run from a subdirectory.

### `rafa next --roadmap`: the hop rows

The `--roadmap` flag enables five additional rows in the state table
(`src/next/hop-rows.ts`, read under `--roadmap` alone), each proposing `hop`
or `home` and none read without it. They sit just before their corresponding
base rows in the action order:

- `pr-owner-review` (action `none`) sits just before row 7, `pr-no-checks`.
  It holds back an otherwise mergeable pull request when the owner gate
  (`src/next/owner-gate.ts`) answers anything but `not-gated` or `approved`.
  C is the hop record's target when the record names this pull request,
  else its own number since the issue it closes is not read there. The gate
  reading rejects a bad `gh` call and lets nothing through on it.
- `away-ended` (action `home`) sits just before row 9, `plan-unstarted`.
  It sends C back home when its work ended: C closed (closing `merged`), C
  has an open pull request (closing `waiting`), or C became the line and
  lacks `spec:ready` and is not blocked (closing `halted`).
- `hop-halt` (action `home`) and `hop-blocked` (action `hop`) both sit just
  before row 11, `issue-blocked`. `hop-halt` takes any halt the walk's
  decision carries and proposes `home`, reading the halt's chain
  (`halt: #H ← #C ← #B: …`). `hop-blocked` takes a hop decision at home
  and proposes `hop`, reading the spec line (`hop from epic #e: #H blocked by
  #C, in epic #f`).
- `hop-dry` (action `hop`) sits just before row 13, `nothing-left`.
  It takes a dry epic with a next `now` epic following it, when the move
  passes the one-hop rule, and proposes `hop` to that next epic.

The two rows `hop-halt` and `hop-blocked` partition a blocked-line reading
between them: one that halts, and one that hops. The walk that read C closed
never reaches either. When a loop action (`start`, `resume`) runs while a
hop is away, `readHomeAfterLoop` (`src/next/state.ts`) asks the board afresh
and answers `home` before the chain stops, reading the record's state as
`away-ended` does — `merged` for C closed, `waiting` for C's open pull
request — and `halted` where the loop left C open with no pull request.

The `hop` and `home` action ids can be listed under `--yes` (as `hop,home` in
the comma list), and they are proposed only by the hop rows, so a plain run
prints nothing but what it printed before these rows existed. The stop lines
that rafa prints omit the proposal words `hop` and `home` unless the run was
typed with `--roadmap`.

The hop record (`.rafa/hop.json`): Where a hop is under way, this per-project
file holds the one record `src/next/hop-record.ts` defines. It names the kind
(`blocker` for a hop to C's epic, `dry` for a hop to the next `now` epic),
the places the hop comes back to (the position's `home`) and leaves from,
the issue numbers H and C (null on a dry hop), the epic and board the hop
goes to, the state (`away` while working, `waiting` with C's pull request
open, `merged` with C closed, `halted` from a halt), C's open pull request
number or null, and the hop's start time. A person switched by hand
(`rafa switch <n>`), and the position's `home` no longer equals the record's,
when the record is `staleAgainst` the position. Every turn reads the position
and the record afresh; a stale record is dropped and no hop is away that
turn. The `home` action writes the record's `state`, `pullRequest` and
nothing else; every later write keeps the record.

The owner gate reading: The gate (`src/next/owner-gate.ts`, read once per
turn by `pr-owner-review`) composes `readOwnerApproval` (`src/pr/owner-approval.ts`)
over the home board (the position's `home`, or the default board when there is
no position file), every open `type:roadmap` board and their `Owner:` and `Owns:`
lines, and CODEOWNERS. The gate answers `not-gated`, `approved`, `waiting`,
`unresolved` or `unknown`; `waiting` and `unresolved` hold the merge back, and
a failed reading is read as `unknown`, which also holds it back.

The `--roadmap` flag passes through to `plan create` (so a hop can `--next`
instead of checking the roadmap by hand) and to `loop start` (so the loop
knows whether a hop is away), via `ROADMAP_PASSED_ACTIONS` (`src/next/actions.ts`).
The plan route reads it to decide how to pick an issue: with the flag, a hop
record that is `away` on a blocker names the target C to pick, and a C whose
blocker is still open stops `blocked`; without it, `plan create --next` picks
as a bare `--next` does. The loop reads it to read the hop record and stamp
it as its `hop` when the record is `away` of either kind and its `home` is
still the position's.

The session record's `hop` field: When `loop start --roadmap` runs while a hop
is `away`, its run record (`.rafa/runs/<session-id>.json`) carries the hop record
itself as `hop` (`start/session.ts`). A record that came back home, a stale one,
none, and no position file stamp nothing. `parseSessionRecord`
(`loop/session-record-parse.ts`) refuses a `hop` key holding anything but a hop
record, and every later write keeps it whole.

### `rafa next` row order

The state table is first-match and reads rows in order from `src/next/state.ts`,
stopping at the first row whose reading answers something (a found state or a
problem). The base rows are:

1. Branch sync (`git fetch --all || git ls-remote`)
2. Loop running (`rafa loop status`)
3. Working tree uncommitted edits
4. Plan unstarted or paused
5. Pull request merge checks
6. Pull request open (ready to merge)
7. Pull request no checks (`merge-unchecked` action)
8. Plan ready (issue picked, ready to start)
9. Plan blocked (issue blocked by another, can `hop` to parent)
10. Issue blocked (blocker still open, can unblock)
11. Nothing left (no unblocked issues on the roadmap)
12. Finally ready (nothing to do, would just exit 0)

With `--roadmap`, five hop rows are inserted before their corresponding base
rows, as the "hop rows" subsection describes above. Each row is read in a
`try-catch` and failures warn without stopping the chain. A turn is a loop:
one read through the table until a row answers, or reaching the end. Once a
command-based action finishes, the chain reads again from row 1, comparing
the new state with the last one to print a stop line or propose another action.

### Changing the `rafa next` table

New; it replaces no earlier text. What a row or an action added to
`src/next/` has to touch:

- **Row numbers are cited outside `state.ts`.** The table is first-match
  and its module note numbers the rows, but the notes of `actions.ts`,
  `readings.ts` and `sources.ts` and the titles in `state.test.ts` cite
  rows by number too. Inserting a row means grepping `src/next` for
  `rows\? [0-9]` and renumbering each hit.
- **A new `NextActionId` fails `check-types`** until `ACTION_COMMANDS`
  (`actions.ts`, a `Record` over `NextCommandActionId`) maps it to a
  command, or `NextCommandActionId` excludes it as an action that runs
  none, as it excludes `sync`, `hop` and `home`.
- **A mapped action can be listed under `--yes` straight away.**
  `YES_ACTIONS` is `sync`, then `NEXT_COMMAND_ACTIONS` minus
  `ALWAYS_ASKED`, then `hop` and `home`, so an action that must never
  run from a list goes into `ALWAYS_ASKED` and `ALWAYS_ASKED_WHY` in the
  same change. An action that runs in-process (`NEXT_IN_PROCESS_ACTIONS`
  in `actions.ts`: `sync`, `hop`, `home`) is spelled into `YES_ACTIONS`
  by hand.
- **An action whose command asks its own question is handed over.** The
  chain closes its prompter first (`handOver`, `prompter.close` in
  `runNext`). Two `createLinePrompter`s on one stdin both receive every
  line, and the idle one holds the answer and gives it back as its own
  next answer.
- **The dry-run reading is taken once per invocation.** `dryRunOf` runs
  once in `runNext`, so with no terminal and no `--yes` the run is a dry
  run from its first turn. A driven test of a handed-over action sets
  `isTerminal` to true.

### The core roster

- **Core commands are a static list** in `src/commands/index.ts`, because
  `dist/cli.js` bundles only what static imports reach. An action sits at
  `src/commands/<subject>/<action>.ts` and a top-level command at
  `src/commands/<name>.ts`, each module's default export its command.
- **Each command module's static imports are spelled out too**, in
  `src/index.test.ts`'s `COMMAND_MODULES`: per module, the exact
  specifiers and the exact names taken from each, in the order the module
  spells them. That is how the bundle's reach is held to a list rather
  than to a habit, so `reads the imports <path> takes as the ones spelled
  here` goes red the moment a module gains, drops or renames one import.
  `src/rafa.ts` is held the same way by `CLI_IMPORTS` in the same file,
  whose note also names those imports in words, so an import added to
  the entry point moves the list and the sentence.
  Adding an import to a command module is therefore a two-file change,
  the module and that roster — the sibling of the declared-flag roster
  `src/commands/index.test.ts` holds. Its `IMPORT_PATTERN` matches
  RELATIVE specifiers only, those opening `./` or `../`, so a module's
  `node:fs` and `node:path` imports are spelled nowhere in the roster and
  adding one reddens nothing. Only the registered command modules are
  listed, not the helpers they import: an import added to
  `src/commands/plan/spec-route.ts` reddens nothing, while one added to
  `src/commands/plan/create.ts` does.
- **Neither roster walks the filesystem.** Both are spelled lists checked
  against `CORE_REGISTRY`, so a module added under `src/commands/` and not
  yet registered reddens neither, and a plan can split "add the module"
  from "register it" across two tasks with the suite green between them.
  Registration itself reddens exactly three: `OWN_DECLARATIONS`, `OUTPUTS`,
  the roster expectations and `the module note's count word` (the note's
  number spelled in words, equal to `CORE_COMMANDS.length`) in
  `src/commands/index.test.ts`,
  `COMMAND_MODULES` in `src/index.test.ts`, and the frozen help snapshots — the last only
  for a new subject or top-level command, or a subject summary that
  changes with it. A spending subject's changed summary or a new top-level command
  reddens `src/tests/spends-cli-surface.test.ts` as well, whose spawned
  `--help` cases pin the marked subject lines and the root `Commands`
  line whole, spend mark included; a subject none of whose actions
  spends has no line there (measured on 2026-09-24: the `issue` summary
  rewritten for `issue check` moved `rafa.txt` and left that file
  green). A new top-level command also reddens the
  control case in `src/cli/help.test.ts` that pins the root `Commands`
  line as a literal: `RAFA_UPDATE_HELP_SNAPSHOTS=1` rewrites `rafa.txt`
  but not that string, which is edited by hand (measured on 2026-09-24,
  registering `roadmap`). Registering `epics` pushed that line past the
  help's width, so it wraps onto a second line, and both literals, there
  and in `src/tests/spends-cli-surface.test.ts`, hold the wrap (measured
  on 2026-09-27); registering `switch` moved `usage` onto that second
  line beside `describe`, and both literals moved with it (measured on
  2026-09-28); moving `epics` under the `epic` subject as `epic show`
  took it off that line, which moved `usage` back onto the first and
  left `describe` alone on the second, and both literals moved again
  (measured on 2026-09-28); removing `usage` brought `describe` back
  onto the first, so the `Commands` block is one line again, and both
  literals moved with it (measured on 2026-10-04). An action
  registered under a subject already there moves no snapshot but under `loop` and `issue`
  (`rafa-issue-ready.txt`'s and `rafa-issue-edit.txt`'s See also name the `issue` actions): registering `plan risk` left all four byte-identical
  and `src/cli/help.test.ts` green before the updater ran (measured on
  2026-09-23), while registering `loop wait` moved `rafa-loop.txt`, whose
  Actions block lists the subject's actions, and `rafa-loop-start.txt`,
  whose See also names them, beside adding `rafa-loop-wait.txt` (measured
  on 2026-10-04); the `plan` summary rewritten beside it is what moved
  `rafa.txt`. The exception is an action declaring `spends` under a
  subject none of whose actions did: its subject's line gains the `🪙`
  mark, which moves `rafa.txt` (measured again on 2026-09-28,
  registering `epic close`, whose subject summary moved with it). A
  summary rewritten under a subject moves it too: adding `or cancel it`
  for `epic cancel` wrapped the `epic` line onto a third row (measured on
  2026-09-28), and `src/tests/spends-cli-surface.test.ts` spells that
  line, so it moves with the snapshot. A new spender also reddens the spender
  rosters, `src/cli/spends-roster.test.ts`, the spawned `describe` case
  of `src/tests/spends-cli-surface.test.ts` and the README table
  `src/tests/readme-spenders.test.ts` reads (measured on 2026-09-24,
  registering `agent search` and `skill search`). The `describe` roster
  reddens for no registration: `src/cli/describe.test.ts` checks every
  command against the registry itself, so a new command passes it
  unseen. Add an explicit `toContain` and a `spends` null expectation for
  the command there, and prove them red by unregistering it once
  (measured on 2026-09-24, registering `cleanup`).
- **Registered**: `plan create`, aliased `plan`; `plan list`, `plan show`,
  `plan validate`, `plan risk` and `plan needs`; `loop start`, aliased `start`; `loop stop`,
  `loop pause`, `loop resume`, `loop status`, `loop list` and `loop wait`; `issue list`,
  `issue show`, `issue create`, `issue comment`, `issue move`,
  `issue ready`, `issue unblock`, `issue check` and `issue edit`;
  `pr current`, `pr show`, `pr view`, `pr list`, `pr wait`, `pr merge`
  and `pr triage`;
  `effort collect`, `effort report`, `effort dashboard`, `effort fix-schema`, `effort copy`, `effort schema`, `effort migrate`, `effort merge`, `effort import`, `effort move`, `module list`, `module exec`,
  `agent vendor`, `agent list`, `agent show`, `agent search`, `skill check`,
  `skill list`, `skill show`, `skill search`, `skill demote`, `skill backfill`, `instinct check`, `instinct list`,
  `instinct show`, `instinct flag`, `instinct promote`, `release status`, `release settle`, `release tag`, `board list`, `board sync`, `epic show`, aliased
  `epic` for good; `epic new`, `epic defer`, `epic promote`, `epic move`, `epic close`, `epic cancel`, `claim release`,
  `claim hand`, `claim accept`, `claim take`, `update current` with the
  stubs `update self`, `update project`, `update board`, `update next`,
  `update latest` and the hidden `update rafa` and `update port`,
  `config set`, `ci status`, `stretch start`, `stretch item`, `stretch end`, `roadmap`, `switch`, `next`, `init`,
  `doctor`, `status`, `cleanup`, `self-update` and
  `describe`. The subjects are `plan`, `loop`, `issue`, `pr`, `effort`,
  `module`, `agent`, `skill`, `instinct`, `release`, `board`, `epic`,
  `claim`, `update`, `config`, `ci` and `stretch`: a
  subject is declared with its first action, never ahead of it.
  `skill index` is in the command tree and is registered by none of it
  yet, so no roster names it.
  The module note of `src/commands/index.ts` says so in the words
  "`<names>` is/are in the command tree and is/are not registered", and
  `unregisteredNamed` in `src/commands/index.test.ts` reads that
  sentence and holds every name it lists absent from the registry; keep
  the wording when registering one of them. This replaces nothing.
- **`loop start --runtime=<path|version>` runs the loop from an installed
  rafa** (`start/runtime.ts`): a version names
  `~/.rafa/runtime/<version>/cli.js`, and a path, against the working
  directory, a `cli.js` or the directory holding it. When that file, links
  resolved, is not `Bun.main`, the run bun runs it in the working directory
  as `start` and the run's words without `--runtime`, with `RAFA_OUTPUT` set
  to the invocation's mode, and waits, ignoring SIGINT meanwhile. `start`
  because the `0.1.0` runtime routes that word alone. In text mode the child
  writes to the same streams and a nonzero exit code is thrown with no
  message; in json mode its `step` and `log` events are emitted as they come,
  its `start` dropped and its failed `result` thrown with its code and
  message. The child writes its own session record, so `loop stop` signals
  the child.
- **`loop start --create-branch` creates the feature branch when on main or
  master** (`start/run-config.ts`): when the working directory is checked
  out on `main` or `master`, the flag creates `feat/<stub>` from the latest
  `origin/<base>`, where `<base>` is the tracking branch of the default
  branch, instead of printing a checkout instruction. Without the flag, the
  loop prints the command to run. The flag is read from the parsed line and
  handed into `start`, which resolves the plan from `.rafa/plans/` unless
  `plan.dir` in the config names another directory, then uses that plan's
  stub to name the new branch.
- **`loop start --roadmap` stamps the away hop on the session record**
  (`start/session.ts`): `rafa next --roadmap` passes the flag to the loop
  it starts, and the run's `.rafa/runs/<session-id>.json` then carries the
  hop record (`.rafa/hop.json`) as its `hop` when that record is `away`,
  of either kind, and its home is still the position's. A record back
  home, a stale one, none, and no position file stamp nothing; a file
  that is no hop record is warned about in one line and stamps nothing.
  Without the flag neither file is read and the record carries no `hop`
  key; `parseSessionRecord` (`loop/session-record-parse.ts`) refuses a
  `hop` key holding anything but a hop record, and every later write keeps
  it.
- **`loop start --as-worktree` creates a new git worktree for the loop to run
  in, alongside the main checkout** (`start/run-config.ts`, `start/session.ts`):
  the worktree is created under `.rafa/worktrees/` by default, or in the
  directory `loop.worktreeDir` names when configured. Started again, the run
  reuses the worktree at `<loop.worktreeDir>/<stub>` when it holds
  `feat/<stub>`, with one line saying so, and refuses that path holding
  another branch or `feat/<stub>` held at another path, naming both
  (`start/worktree.ts`). The project root and
  checkout stay separate: the root owns `.rafa/`, the config and the store,
  while the checkout (the worktree) is where the loop creates the branch and
  runs; you stay on `main` in the original checkout and can work there while
  the loop runs beside you. The worktree carries its own checked-out branch
  (the feature branch the loop creates), and `loop list` names it in the
  `worktree` column, one per run. Worktrees on merged branches are left idle
  for `rafa cleanup` to find and remove. The loop guard compares the checkout's
  branch and HEAD against what the run was given when it started, and halts
  with the work kept if either changes externally; the guard fires on every
  loop, with or without `--as-worktree`, and never interferes with the loop's
  own commits. Without `--as-worktree` the checkout is the project root itself,
  and you run the loop where you already are.
- **`loop.wrapUp.retries` and the wrap-up pull request retry loop**
  (`start/wrap-up.ts`, `start/pr-lifecycle.ts`): After the wrap-up session
  ends, the runner reads the branch's open pull request. With none, it runs
  `loop.wrapUp.retries` more wrap-up sessions (the config key defaults to `1`,
  from 1 to 3; `false` skips straight to opening the pull request). Each
  retry session is told that the pull request is missing and given the
  previous session's final message, allowing the session to correct course.
  The wrap-up and each retry are told to open it with
  `gh pr create --base <base>`, the run's base (`pr.base`, else
  `origin/HEAD`'s target, else `main`) as `runWrapUp`
  (`start/wrap-up-run.ts`) resolves it once for them and for the runner's
  own open; a pull request already open is only pushed to and edited.
  If no retry succeeds in opening one, the runner opens it itself, titled
  `rafa-<n>: <plan title>`, with a body opening `Closes #<n>`, the release
  fragment's notes, and a line saying the wrap-up did not finish. A push or
  a create that fails ends the run `blocked`, naming the branch and the step.
  Whoever opened it, a delivered pull request whose `baseRefName` is not
  that same base is retargeted onto it (`retargetPullRequest`,
  `start/pr-retarget.ts`) before the CI wait, printing
  `↪ Retargeted pull request #<n> from <old> to <new> (pr.base).`; nothing
  is printed when the bases match, and a refused edit is one warning
  naming the pull request, both bases and what `gh` said, and the run goes
  on to the wait. A blocked or interrupted delivery reaches no retarget.
  With `pr.provider: none`, the pull request is never opened; a run ends `ok`
  once the wrap-up finishes.
- **`loop start --retry=<n>` and `loop.retries` re-enter the loop after a
  retry-safe stop** (`start/retry-budget.ts`, `config-schema-loop-retries.ts`):
  the run goes back to the top of its loop with `continue`, where
  `findNextTask` answers the `[BLOCKED]` line or the inserted repair, instead
  of returning, at most n times in a row. A task that finishes `done` sets
  the spent count back to 0 (`settleOnDone`) unless it is the task of the
  last stop, told apart by its text and its copy (`retryTaskOf`, over
  `taskRefIn` in `start/pass-over.ts`), or a repair task (`isRepairTask`,
  `start/suite-blocker.ts`): a plan task's red step, its repair done, the
  repair's own step red again spend on toward n, and only the next plan
  task done starts the count over, so a task that keeps failing still
  meets the cap. A red suite step before a session is the stop of no task,
  and the next task done resets. The key is `false` (the default) or
  a whole number from 1 to 3, and the flag outranks it for one run; any other
  flag value, a bare `--retry` and `--no-retry` are refused with exit code 1
  by `readRunArgs` (`start/run-setup.ts`), before the deferral and the
  session record. Four stops are retried: a red suite step before a session
  and a red task step after one (never one `stoppedOnSignal` reads as
  stopped by SIGINT, `start/suite-steps-run.ts`), a task session that exited
  nonzero (the budget exit and the interrupt end before it is asked), and a
  clean exit held only on its absences (`heldOnNothingLeftBehind`,
  `start/commit.ts`: every hold a no-report, background-wait or no-commit
  hold). A report that says `status: blocked` or lists a blocker, a refused
  commit, a moved checkout, a report left unstored, a pause, an interrupt
  and every refusal before the loop halt as before. Each retry writes one
  warning, `🔁 Retrying (retry <i> of <n> in a row) after the stop: <reason>.`, and one
  `retry` loop event after the stop's own lines and its stored report, and
  no `task-blocked` event: a task stop emits that only once its retry is
  refused, so `loop wait --until=blocked` never answers a run still going.
  A SIGINT received refuses every retry left, and once n are spent in a row
  the next such stop halts. A checkout moved from the loop's last commit,
  read by `guardCheckout` (`start/checkout-guard.ts`) only while a retry is
  left, refuses the retry without spending it, writing one warning line,
  `⚠️  No retry after the stop: <reason>. The checkout has moved ...`, so a
  session that committed and then exited nonzero stops on its own blocker,
  never the next pass's `checkout moved`. On a session that exited
  nonzero, `❌ Task failed (exit <n>). Marked as blocked. Run again to
  retry.` is written only once no retry or decision goes on.
- **`loop start --continue` hands a stop that would end the run to a
  decision** (`start/continue-args.ts`, `start/continue-run.ts`,
  `start/decision-session.ts`, `start/decision-prompt.ts`,
  `start/decision-parse.ts`, `start/pass-over.ts`,
  `config-schema-loop-continue.ts`): a report that holds its task
  (`status: blocked` or a listed blocker) at once, and a retry-safe stop
  once `RunRetries.lastRefusal` reads `spent`. A refused commit, a budget
  exit, an interrupt, a pause, a moved checkout, a report left unstored,
  every refusal before the loop and the wrap-up halt as before. The
  retries a `--continue` run opens without `--retry` are
  `loop.retriesOnContinue`'s (`false` or 1 to 3, default `1`). One
  session decides, spawned with `--tools Read,Grep,Glob`, the run's
  `loop.settingSources`, in the checkout, its prompt stamped, and ends on
  a `rafa:decision` block, the last one read: `retry` asks the run's
  retries for one first, and only once it is granted writes its
  `approach` as the task's blocker and emits its `decision` (a refusal,
  for no retry left, a moved checkout or an interrupt, leaves the tracker
  untouched and reads as `stop`, its reason naming which), `stop` ends
  the run, `jump` passes the task over for the run
  and `defer` until the task at its `after` line is ticked. An
  unreadable block, a session that exits nonzero and criteria that
  cannot be read are `stop`; a session SIGINT ended decides nothing,
  emits the stop's own `task-blocked` or `halt` with `interrupted` as
  its reason, and ends the run with exit code 0.
  Passed-over lines are `findNextTask`'s `skipLines`; the tracker keeps
  them `[BLOCKED]`, and the list is saved on the run record as
  `decisions` and read back by the plan's next `--continue` run on the
  same branch (and worktree, when the record names one), off the newest
  record that ended there, stopped or done: a `--force-wrap-up` run ends
  `done` with its list kept, and a newer run that ended with no list
  leaves nothing to read. That run drops
  each entry whose task no longer reads `[BLOCKED]` (`seedFrom`): a line
  put back to `- [ ]`, ticked, edited or removed is taken again. A second
  `defer` of a task is applied as a `jump`, and a task passed over that
  reaches a decision again is stopped, each reason saying so. The
  effort store gets no row for the decision session: `effort/classify.ts`
  has no kind for it, so `effort collect` reads its log as `other`.
  - **The line**: `--decide=retry|stop|jump|defer` names the decision,
    applied once in place of a session: on the loop's first pass to the
    `[BLOCKED]` task it opens on, before that task is dispatched again,
    or else at the run's first stop. When the plan's previous run on
    the branch ended on a `decision-needed` (read off its events file,
    `readPreviousDecisionNeeded`, past runs that reached no task) whose
    task's text is not that `[BLOCKED]` task's, the directive is refused
    with exit code 1 and a line naming both, nothing decided. A
    directive no decision point used is named in one warning line at
    the run's end. `--approach=<text>` goes with
    `--decide=retry` alone and is required by it, `--after=<line>`
    (counted from 1) with `--decide=defer` alone and required by it.
    `--decide` and `--force-wrap-up` without `--continue`, a bare value
    flag, a strategy that is none of the four and an `--after` that is no
    whole number from 1 are refused with exit code 1 by `readRunArgs`,
    before the deferral; so is a `--continue` run whose
    `loop.continue.criteriaMode: replace` names a missing or blank file,
    and a `--decide=retry` on a run whose retries, `--retry` over
    `loop.retriesOnContinue`, are `false` (`refuseRetryWithoutBudget`).
  - **json mode**: under `--output=json` no session is spawned. The stop
    emits `decision-needed` (the task, its line, why it stopped, the open
    tasks, the retries left and the rendered prompt), then its own
    `task-blocked` or `halt`, and the run ends with exit code 21, the
    tracker as the stop left it. The text and events modes decide
    through the session.
  - **The end**: when only passed-over tasks are left open, the run lists
    each with its strategy and reason, emits `passed-over` and a `halt`,
    and ends with exit code 22, before the pre-wrap-up step: no wrap-up
    and no pull request. Its last lines say how a task comes back: mark
    its tracker line `- [ ]` and run again, since a `--continue` run
    passes a `[BLOCKED]` one over again, or run without `--continue`,
    which resumes the first `[BLOCKED]` line. `--force-wrap-up` takes the pre-wrap-up step
    instead, its one repair included; a step red after that repair whose
    new failures (the baseline's left out) are within
    `loop.forceWrapUp.maxNewFailures` (`false`, the default, tolerating
    none, or 1 to 50) goes on, and one over it, or red with no failure to
    count, ends with exit code 20. The wrap-up then marks the delivered
    pull request a draft with `gh pr ready <n> --undo` and writes a
    `## Passed-over tasks` section into its body (`start/forced-draft.ts`),
    both before the run's `pr` event. A body write refused is a warning;
    a draft refused emits no `pr` event, and after the release's write
    and the retarget ends the run with a `halt`, exit code 20 and a line
    naming the pull request and `gh pr ready <n> --undo` to run by hand,
    before the CI wait, its record `stopped`.
  - **Exit codes and events** (`start/continue-exits.ts`): 20 for a
    decision's `stop`, a refused forced wrap-up and a refused draft, 21
    for a decision needed, 22 for a run ended on passed-over tasks; from
    20 so none meets a code `loop wait` answers (10 to 16, 2) or one
    every command shares (0 to 3). Each is thrown as a `LoopEnd` once
    the run has emitted its own events, `decision`, `decision-needed` or
    `passed-over` and then the stop's `task-blocked` or `halt`, so the
    run's catch writes no `error` event for it. `context/operators.md`
    shows their lines.
- **The `--continue` criteria** (`src/continue-criteria.md`,
  `start/decision-prompt.ts`): the decision session chooses by criteria
  read in order, the first that fits deciding and `stop` when none does.
  The bundled base, drawn from a survey of 29 loop stops, says: never
  `jump` or `defer` past a task a later open task imports, extends or
  tests (choose `retry` or `stop`); `stop` when the task text is
  contradicted by measured behaviour or the blocker asks for a design
  decision; `jump` a check or gate on a prerequisite a person owns (a
  file a person writes, an environment variable, an external account)
  that no later task depends on; `defer` when the blocker names
  something a later open task provides, `after` being that task; `retry`
  only when the blocker names a concrete alternative inside the task's
  own scope, the `approach` saying what to do differently. A project
  adds its own in `loop.continue.criteria`, `.rafa/continue-criteria.md`
  unless the config names another path, read from the project root on
  every decision, so an edit needs no rebuild. `loop.continue.criteriaMode:
  extend`, the default, appends it under the base after a
  `### Project criteria` heading, a missing or blank file leaving the
  base alone; `replace` uses it alone, and refuses a run whose file is
  missing or blank. The prompt's contract,
  `src/continue-decision-prompt.md`, is not overridable, so no project
  edit can break the parser; the build copies both files into `dist/`.
  It marks what it says of `retry` in two sections, `<!-- retry -->` and
  `<!-- no-retry -->`, and `renderDecisionPrompt` keeps the first while
  a retry is left and the second with none: a retry-safe stop is decided
  only once its retries are spent, so its prompt offers no `retry`.
- **A run record carries `phase: task | wrap-up | pull-request | ci | repair`**
  (`start/session.ts`, `loop/session-record-parse.ts`): each written at the
  phase's start. A record with no `phase`, from an older rafa, reads as `task`.
  The header shows `🍅 #<n> <task>/<total>` in `task` and `🍅 #<n> <phase>`
  otherwise, never counting past the total, and `rafa loop status` and
  `rafa loop list` print the phase beside `done/total`. On `loop resume` the
  record's phase is read to resume at the right place; a record in `task` or
  `wrap-up` resumes the loop, a record in `pull-request` or `ci` waits for
  checks, and a record in `repair` retries the CI repair.
- **Four wrap a phase 0 command** through `wrapPhaseZeroCommand`:
  `plan create`, `loop start`, `effort collect` and `effort report`.
  The command is handed a fresh copy of `argv`
  without the global `--output` flag, then the root of the project the
  dispatcher resolved, and nothing else, so it keeps its own parser and
  acts on that root where it took the git root before. Each word `parseArgs` reads as `--output` ahead of a `--`
  is dropped, a value typed as the next word included, so
  `rafa effort report --output=json` never reaches a parser refusing the
  words it does not read. A declared `default` or flag alias fills the
  context's `flags` alone: `rafa loop start -p x.md` hands `start`
  `-p x.md`, which it does not read. `describe`, `init`, `doctor`, `status`, `cleanup`, `self-update`, the plan readers, the
  `loop` session actions, the `issue` actions, the remaining `effort` commands, `module list`, `module exec`,
  `agent vendor`, `agent list`, `agent show`, `agent search`, `skill check`, `skill list`, `skill show`,
  `skill search`, `skill demote`, `skill backfill`, `instinct check`, `instinct list`, `instinct show`,
  `instinct flag`, `instinct promote`, the `release` commands, `board list`, the `epic` commands, the
  `claim` commands, the `update` commands, `config set`, `ci status`, `stretch start`, `stretch item`, `stretch end`, `next`, `roadmap`, `switch` and the `pr` actions wrap none:
  `describe` reads the registry off its context, and `init`, `doctor`, `status`, `cleanup`,
  `self-update`, each plan reader, each `loop` session action, each `issue` action, each remaining
  `effort` command, `module list`, `module exec`, each `agent`, `skill`, `instinct`, `release`, `epic`,
  `claim`, `update` and `pr` action, `config set`, `ci status`, `stretch start`, `stretch item`, `stretch end`, `board list`, `next`, `roadmap`, `switch` their `args` and `flags`.
- **Where a wrapped command writes**: through the active output, in every
  module it prints from. For `loop start` those are `src/start.ts`,
  `start/run-config.ts`, `start/runtime.ts`, `start/session.ts`, `start/pause.ts`,
  `start/preflight.ts`, `preflight/run.ts`, `start/commit.ts`,
  `start/wrap-up.ts`, `start/wrap-up-run.ts`,
  `start/dispatch.ts`, `start/triage.ts`, `start/release-stage.ts`,
  `start/retry-budget.ts`, `start/continue-run.ts`,
  `start/forced-draft.ts`, `adapters/tracker/resolve.ts`,
  `adapters/tracker/local.ts`, `start/pr-lifecycle.ts`, `utils/claude.ts`
  and `utils/schedule.ts`.
  For the others they are `src/plan.ts`,
  `commands/plan/plan-record.ts`,
  `effort/collect.ts` and `effort/report.ts`, and for
  every command `loadConfig`'s default warning sink in
  `src/config-load.ts`. `console.log`'s and `console.info`'s lines go at
  `info`, `console.warn`'s at `warn` and `console.error`'s at `error`,
  each message as it was. In text mode an `info` line is the bytes
  `console.log` wrote, and a warning or an error goes to stdout after
  `warn: ` or `error: `, where `console` wrote it bare on stderr. So
  `plan create` and `effort report` warn about an unknown config key on
  stdout in text mode.
- **What json mode adds for `loop start`**: each dispatched task first
  emits one `step` event named by its sentence, and a session's stdout,
  whether task, wrap-up or CI repair, arrives as one `info` `log` event
  per line. Text mode emits no step and echoes a session's bytes as
  before. Both read the mode the dispatcher sets beside the active
  output. `src/tests/loop-output.test.ts` spawns `loop start` in both
  modes.
- **A wrap-up that could not open its PR still ends `ok`.**
  `preserveProgress` (`start/wrap-up.ts`) reads only the wrap-up
  session's exit code, and a `gh pr create` failing inside that session,
  as it does with no GitHub remote, is the session's own tool use: it
  ends 0, so the terminal `result` reads `ok: true`. Only the wrap-up's
  `log` lines say the PR was not opened.
- **What json mode gives for the others**: `effort report` gives the
  report as the terminal result's `data`, the document phase 0's `--json`
  printed with the task report tallies, the preflight halts and the
  budgeted sessions added, or under `--skills` the `SkillsReport`
  (`src/effort/report-skills.ts`), or under `--trend` the `TrendReport`
  (`src/effort/report-trend.ts`), and
  writes no table line. `effort dashboard` gives the `Dashboard`
  (`src/effort/dashboard.ts`), one key per widget: `status`, `trend`,
  `loops`, `skills` and `totals`, beside `generatedAt`. `plan create` and `effort collect`
  write each line as a `log` event of its level and give no result.
- **The plan readers start no session, and read the configured
  directory.** `plan list` and `plan show` read the directory
  `resolvePlansDir` (`src/commands/plan/plan-files.ts`) answers:
  `plan.dir` of the config that resolves for the project, resolved
  against the project root the dispatcher found, `.rafa/plans` unless a
  config names another. That is where `plan create` writes and where
  `loop start` looks for its default plan, and the directory whose plan
  stubs `effort collect` attributes sessions by, so the readers and the
  writers are on one directory whatever `plan.dir` is set to.
  `resolvePlansDir` loads the config itself, so a command that also
  reads another key loads it once and passes `config.planDir` to
  `plansDirAt`, or the config's warnings are written twice. A config
  `loadConfig` refuses is refused with exit code 1, and a line handing
  the wrong number of arguments is refused before the config is read.
  The sweep guard in `src/tests/default-plan-dirs.sweep.test.ts` still spells
  its forbidden tokens with a trailing slash, so the slashless spelling
  of either swept directory passes it in a tracked file; widening those
  tokens is a separate change.
  `plan list` names each `PLAN-<stub>.md`, its tasks counted from its
  `PLAN_TRACKER-<stub>.md` when there is one; with `--open` it keeps only
  the plans `openPlans` keeps, those with a task still open or with
  issues, and a directory with plans but none kept writes `No plan in
  <dir>/ has open tasks.` `plan show <stub>` gives one
  plan as `parsePlan` reads it, or its tracker with `--tracker`.
  `plan validate <file>` resolves the file against the working directory,
  and like every command but `module exec`, the two checkers, `init` and
  `describe` it runs only inside a project. It writes each `parsePlan` issue at `error` as
  `<file>:<line>: <reason>: <text>`, then the `agent=` of each
  still-to-run task that no tier serves under the project's
  `loop.settingSources`, `tiers.rafa` and `tiers.agents` (`resolveTiers`,
  with the built-ins beside it), as `<file>: <the line `missingAgentLine`
  words>` naming the agent, the lines that asked for it and why: held by
  no tier; switched off, with the `false` line; held only by a tier the
  session does not load, with that tier's path and the setting that
  loads it, and `rafa agent vendor` for the user tier; held by two loaded
  tiers with different contents, with both paths and the pin line; or a
  rafa-tier holder the served directory refuses
  (`src/agents/roster.ts`). Then each `skills=` name of those tasks that
  two loaded tiers hold with different contents, under `tiers.skills`, as
  `<file>: <the line `skillCollisionLine` words>` with both paths and the
  pin line. Then each other `skills=` name the resolution resolves to no
  winner, as `<file>: <the line `unresolvedSkillLine` words>`: held by no
  tier, switched off, or held only by a tier the session does not load,
  each with what settles it. Then each effort-store rule the plan breaks
  (`src/plan/store-rules.ts`), as `<file>:<line>: <rule>: <text>`: a
  store change pinned by number anywhere in the plan, and, in a plan one
  of whose task lines names ``migration `<id>` ``, a still-to-run code
  span running `src/rafa.ts`, `dist/cli.js` or `bun run rafa` without a
  leading `RAFA_EFFORT_DIR=` (`effort copy` excepted), and a
  `PREREQUISITES-<stub>.md` with no `[auto]` probe of
  `rafa effort schema --check`. It throws exit code 1 when there is any
  of the five, with a message counting each. That is the check `loop
  start`'s preflight halts on, so a plan the loop would refuse is
  refused here too. The store rules are read by
  `src/commands/plan/store-check.ts`, which `plan create` refuses a
  generated plan with as well. The roster is the project the dispatcher found and the config that
  resolves there, which is the only thing this command reads beyond the
  file; handed no project it says so and checks no agent and no skill.
  In json mode a list, a plan and a clean validation are the terminal
  result's `data`, the validation carrying an empty `issues`, an empty
  `missingAgents`, an empty `skillCollisions`, an empty
  `unresolvedSkills` and an empty `storeProblems`, and each issue,
  missing agent, skill collision, unresolved skill and broken store rule
  is an `error` `log` event; text
  mode writes lines and no `result: ` line.
  `src/commands/plan/validate.test.ts` spawns `plan validate` with a
  stand-in `claude` first on the PATH and finds it never called, where
  `plan create` calls it.
- **`plan create` enforces the planner's own verdict on the spec**
  (`src/commands/plan/review-gate.ts`, `src/board/gate.ts`). The plan prompt asks the session
  to end its final message with a `rafa:spec-review` block, the `claude`
  planner reads it once and carries it back both on the plan it answers
  and on its rejections (`src/adapters/planner/claude.ts`), and this
  command is what acts on it. A `verdict: not-ready` naming a gap that
  blocks planning removes `PLAN-<stub>.md` and
  `PREREQUISITES-<stub>.md` when the session wrote them anyway,
  posts the gaps as one `<!-- rafa:spec-review v1 -->`
  comment on the issue, edited on a rerun unless the marker comment it
  found was written by an author the trust reading refuses, in which case
  it is reported, left alone and posted beside
  (`src/board/review-comment.ts`), swaps `spec:ready` for
  `spec:needs-work` over `src/board/issue-board.ts`, and throws exit code
  3 with every gap in the message. One whose gaps are ALL non-blocking
  keeps its plan instead: the gate opens the plan with the assumptions,
  records `review: assumed` in its block, posts the same gaps and moves
  no label. A comment or a label swap that fails is a warning and
  changes neither the other write nor the exit code.
  `--spec` names no issue, so that route removes, prints and exits 3. An
  `absent` or `malformed` review is NOT that verdict: on a rejection the
  session's own failure is what the command ends with, and on a plan the
  planner answered the gate weighs the plan itself with `plan validate`'s
  reader — one that reads as written stands, with one warning, nothing
  removed and no board write, and records `review: missing` in its
  `rafa:plan` block, while one that does not is removed and exits 3 with
  every parser issue named and still nothing posted. `--skip-review`
  bypasses that gate alone and records `review: skipped` in the same
  block (`src/commands/plan/plan-record.ts`,
  `src/board/review-stamp.ts`), where the plan reader keeps either
  word as a header extra; `--no-comment` keeps the gaps off the board and
  moves the labels anyway. Both flags are read in `src/board/gate.ts` and
  declared on `src/commands/plan/create.ts` beside the board flags.
- **`plan create` plans from a file, an issue or the roadmap**
  (`src/commands/plan/spec-route.ts`, `src/board/spec-source.ts`,
  `src/board/spec-source-roadmap.ts`, `src/board/plan-spec.ts`).
  `--spec=<file>`, `--issue=<n>` and `--next[=<roadmap-issue>]` are
  mutually exclusive, and a line naming two, or none, is refused with
  exit code 1 — the second with the command's usage and
  `noSourceMessage`. The two board routes read the issue through
  `gh issue view <n> --json number,title,body,state,labels`, refuse a
  closed one and one without `type:spec`, run the checks below, and write
  the body, with `<specs.dir>/rafa-<n>-notes.md` appended under
  "Local notes", to `<specs.dir>/rafa-<n>-<slug>.md`. The planner reads
  that snapshot, so the stub, the prompt, the session and the classifier
  keys are `--spec`'s own; a snapshot already there whose issue body
  differs is refused without `--refresh`, one whose local notes alone
  differ is rebuilt, and every rebuild first moves the old copy to
  `<specs.dir>/previous/`. `--next=<n>` reads roadmap issue `n`. A bare
  `--next` starts from the current place (`pickRoadmapIssue`,
  `src/board/spec-source-roadmap.ts`): with no position file, the
  default board — the issue `roadmap.issue` names, else the
  lowest-numbered open `type:roadmap` board, else the pinned issue
  titled `Roadmap` (`resolveDefaultBoard`, `src/board/boards.ts`) — and
  otherwise the place's board, or its epic's lines alone whatever its
  horizon, a place that no longer stands warned and fallen back from.
  `--roadmap`, which `rafa next --roadmap` passes, is refused with exit
  code 2 on a line without `--next`; with it, a hop record
  (`.rafa/hop.json`) that is `away` on a blocker, and whose home is
  still the position's, has the pick answer the record's target C on
  its own board with no roadmap read (`readAwayHop`), a C whose
  blocker is still open stopping `blocked`, and C then going through
  the same checks as any pick. Any other record, or none, picks as a
  bare `--next` does, a record that cannot be read warned first.
  `--claim-ahead` is refused with exit 2 on a line without `--next`
  (`claimAheadWithoutNextMessage`); a `--next` spec carries
  `ResolvedSpec.ahead`, the flag and the walk its pick came off (null
  for a hop's target), and with the flag or `claims.ahead: allow`
  `aheadRequestOf` (`src/commands/plan/claim-route.ts`) reads the line
  after the pick and hands it to the claim (`src/claims/ahead.ts`).
  It prints each line it skipped with why, and exits 0 with a message when nothing
  is left. `--dry-run` does every read and every refusal of checks 0–2
  and stops before the first write, on all three routes, so it never
  reaches check 4, which reads the saved copy it did not write. The generated plan records
  `issue: "<n>"` in its `rafa:plan` block, quoted so the digits written
  survive the plan reader, which reads an unquoted number as the number
  YAML parsed (`src/board/plan-field.ts`), and the gate's
  comment and label swap go to that issue.
- **`pr merge` ticks the roadmap after it merges**
  (`src/commands/pr/merge-tick.ts`, `src/board/roadmap-tick.ts`). GitHub
  closes an issue a merged pull request says `Closes #<n>` for and ticks
  no `- [ ] #<n>` box, so the command lists the open `type:roadmap`
  boards once and ticks EVERY one whose checklist, as the listing
  answered it, lists a closed issue, plus a `roadmap.issue` the listing
  does not hold, that one first; a board listing none of them is not
  read, and when labelled boards exist but none lists one the command
  prints `no open type:roadmap board lists #<n>, so nothing was ticked.`
  While no issue carries the label it reads the roadmap issue
  `roadmap.issue` names, else the issue titled `Roadmap`, as before.
  Each board's box is written through
  `gh api repos/{owner}/{repo}/issues/<n>`, GET then PATCH, one line
  printed per board, and a board that fails does not stop the next.
  Before the boards it ticks each closed issue's line on the checklist
  of the open `type:epic` issue its `epic:<slug>` label names, found in
  one board listing (`gh issue list --state all`) that a project with no
  open epic pays and prints nothing for; an epic whose listed checklist
  lists none of its closed members is not read, and each epic ticked
  prints one sentence (`epicTickSentence`), a failed one as a warning.
  Every unticked line naming a closed issue is ticked, a line inside a
  fenced block is none, and the line breaks are kept as the body spelled
  them. A write that failed, and a write whose answer is not the body
  that was sent — the one edit conflict `gh` can show, since the issues
  API takes no `If-Match` — re-reads the body and retries ONCE, so a
  roadmap somebody else ticked meanwhile comes back
  `nothing-to-tick` rather than being written over. The tick runs
  straight after the provider merged and before the clean-up, and
  nothing it comes to changes the exit code: a roadmap that cannot be
  resolved, a board that will not take the edit and a pull request
  closing no issue are a warning or a silence. `--output=json` carries
  every board's as `roadmapTicks`, null when the pull request closes
  nothing, and the first of them as `roadmapTick`, null when no board was
  ticked. Under `board.relationships: native` the epic checklist tick is
  left out, listing and all, since an epic keeps its order in its
  sub-issues; the boards are ticked as above.
- **`pr merge` runs the unblock reading after its clean-up**
  (`src/commands/pr/merge-unblock.ts`), over every open issue labelled
  `spec:blocked` whose `Blocked by:` line names an issue the merged pull
  request closes. It is `rafa issue unblock`'s own `runUnblock`, so the
  question, the state of each blocker and the one `removeLabel` are
  spelled once. It runs after the clean-up, and only the follow-ups
  come after it, so `rafa release settle` is the merge's last line; it
  waits for the clean-up because it asks and a question among the step
  lines would interleave with them, and a clean-up step that failed
  therefore never reaches it.
  `--yes` does not answer that question — it is declared as merging
  without asking — and without a terminal nothing is asked and nothing
  is written. Every failure is a warning naming the reading and none of
  them changes the exit code, since the merge has already happened.
  `--output=json` carries the report as `unblocked`, null when the pull
  request closes nothing.
- **`pr merge` prints the freed issues in native mode**
  (`src/commands/pr/merge-freed.ts`). Under `board.relationships: native`
  the unblock reading does not run: after the clean-up the command reads
  the board's repository and one native board listing, and prints the
  open issues the port's `freedBy` names for the issues the merged pull
  request closes, under a line opening `board.relationships is native`
  and one indented line per issue. It asks nothing and writes nothing,
  since GitHub clears a blocked-by link when the blocking issue closes;
  a merge that freed nothing prints nothing, and one closing no issue
  sends no call. Every failure is a warning. `--output=json` carries the
  reading as `freed`, a key left out in `labels` mode, with `unblocked`
  null.
- **`pr merge` refreshes the project after its board reading**
  (`src/commands/pr/merge-project.ts`). With `board.project.number` set,
  after the unblock reading, or the freed issues in native mode, it
  refreshes on the project the issues the merged pull request closes and
  the issues those were blocking, in one refresh, ahead of the
  follow-ups. It reads one board listing in the configured mode to find
  the blocked ones, adding in `labels` mode the issues the unblock
  reading considered, whose `spec:blocked` it may just have taken off.
  With the number unset, or a pull request closing no issue, it sends no
  call. Every line is a warning and none changes the exit code; a
  clean-up step that failed never reaches it, and `rafa board sync`
  catches the project up.
- **`release settle` refreshes the project after a push**
  (`src/commands/release/settle-project.ts`). With `board.project.number`
  set, after a push delivery that landed or that another settle beat to
  the same fragments, it reads the pull requests of the commits that
  added the folded fragments (`associatedPullRequests`, one
  `gh api graphql` query per 20 commits) and refreshes on the project the
  issues those pull requests close, so their Stage moves from In review
  to Done. A dry run, a `pr` delivery, whose fragments stay on the base
  until its pull request merges, and a delivery that failed send no call.
  Every line is a warning printed after the reading, none changes the
  exit code, and the json result carries the reading as `project`.
- **The `epic` actions refresh the project after their writes**
  (`src/commands/epic/epic-project.ts`). With `board.project.number`
  set, `epic new`, `promote`, `defer`, `move`, `cancel` and `close` each
  end a run that wrote with one refresh of the epic, its members and
  every item whose Rank shifted: `move` names the epic the issue left
  and the one it joined, `cancel` the epics its moved dependents left and
  joined and every dependent it answered, and `new` adds the epic to the
  project first. The refresh reads the members and the shifted Ranks
  itself, off its one board reading and the project's items
  (`RefreshWidening`, `src/board/project/refresh.ts`). A run that
  changed nothing, a refused one, and any run with the number unset
  send no call. Every line is a warning after the run's own lines and
  before json mode's result, and none changes the exit code. The json
  result of `epic cancel` now names the epic a moved dependent left, as
  `answer.from`.
- **`pr show` reads the issues a pull request closes** (`src/pr/gh.ts`,
  `src/commands/pr/show.ts`). The `closes` field of the JSON output lists
  each issue as a number, title, state and repository. In text mode, the
  `closes` line names each issue number and marks one not named by the
  pull request's body keywords (like "Closes" or "Fixes") as `(not named
  by the body)`, and marks one named only by keywords as `(named by the
  body only)`. The reading is parsed from `closingIssuesReferences` in
  the pull request data and from `closedIssuesIn` reading the body's
  keywords, refusing nothing when either fails, just falling back to an
  empty list.
- **Checks 0–2 of the readiness gate's five run in the board route's
  resolution** (`src/board/plan-spec.ts`): the author's trust (`src/board/trust.ts`),
  the `spec:ready` label, then the leak refusal and the completeness
  gaps (`requireCompleteSpec` in `src/board/readiness.ts`), in that
  order, each exit 2 and each before the body is snapshotted, so
  `--next` STOPS at a line that is not ready rather than skipping it.
  The completeness refusal names every template heading that is missing
  or empty, either of "Tasks the plan must carry" and "Definition of
  done" holding no list item, every placeholder left in the text, and
  every effort-store change pinned by number (`migration 12`, `schema
  version 9`, outside fences and code spans), in one sentence. It costs an issue
  opened before `src/board/templates/spec.md` a hand edit, since such a
  body carries none of the six headings and is refused whole; the module
  note in `src/board/plan-spec.ts` holds that trade. The WARNING that
  ran in its place is gone, and `findListSectionGaps` and
  `listSectionWarning` now have no caller outside their own tests. Check
  0 runs first and is the one that ASKS something: one
  `gh api repos/{owner}/{repo}/collaborators/<login>/permission` on the
  issue's `author`, or none at all for a login in
  `board.trustedAuthors`. A failed lookup is a refusal, and the
  repository a refusal names is read from `origin` through `git`. Check
  0 runs on the ROADMAP issue too, through `inspectRoadmapIssue` and
  before a line is parsed out of its body, so a `--next` run checks two
  authors and spends one lookup per login.
- **Check 4, the references, runs in `src/plan.ts` once the resolution
  has answered a spec** (`src/commands/plan/refs-check.ts` over
  `src/board/refs-gate.ts`): after the snapshot settles and the
  plan-already-there refusal passes, and before the `progress.txt`
  read, the notices and the session, on `--issue` and `--next` alone. A dangling
  or suspect reference refuses with exit 2; `--accept-refs`, or
  `dangerous.acceptStaleRefs: true`, re-stamps them all and plans. The
  setting's warn line is printed first thing in the run, before the
  resolution's first read. `context/pull-requests.md` holds the rules.
- **The claim runs in `src/plan.ts` right after check 4**
  (`src/commands/plan/claim-route.ts` over `src/claims/plan-claim.ts`),
  before the `progress.txt` read, the notices and the session, on a run
  that knows its issue: `--issue`, `--next`, or a `--spec` whose name opens
  `rafa-<n>-`. A claim another store holds refuses `--issue` and
  `--spec` with exit 1 naming the owner; under `--next` the pick is
  passed over and the spec resolved again with it handed in as
  `passOver`, which the walk reads as taken. A claim that could not be
  made or pushed writes the plan with a warning saying why. When `plan
  create` runs with `--claim-ahead` beside `--next`, it reads the issue
  that follows the pick on the roadmap walk (one handle ahead) and, when
  `claims.ahead: allow` or `--claim-ahead` names it, runs the same claim
  for it; each refusal, success or warning of the ahead claim is printed
  after the main claim report with context naming it as ahead.
- **The spec issue template is `src/board/templates/spec.md`**, a
  package asset the build copies to `dist/templates/` and `rafa init
  --board` writes to `.github/ISSUE_TEMPLATE/spec.md`. Its front matter
  labels the issue `type:spec`, its first comment line says the issue is
  public and takes no local path, host or credential, and its six `##`
  headings are `TEMPLATE_HEADINGS` in that order, which is what the
  readiness reading recognises. `src/tests/spec-template-source.test.ts`
  holds the file to the code and the filled template to no gap.
- **The words `plan create` reads live in `src/board/flags.ts`**, the
  ten of the board routes and the gate, because
  `src/commands/index.test.ts` holds the command's declared flags equal
  to the quoted `--` literals of the modules named for it and a module
  that also quotes a `gh` argument, as `src/board/issue.ts` does, cannot
  be one of them. `src/plan.ts` keeps `--stub` and `--no-progress`, and
  `hint` is the wrapper's, read by neither.
- **`init` sets up a project and needs none** (`src/commands/init.ts`),
  declaring `needsProject: false`.
  `--root=<path>` names the root, absolute or relative to the working
  directory, and `--yes` takes the first candidate `rootCandidates`
  answers. With neither, it lists the candidates on stderr and reads a
  number or a path, only when standard input is a TTY, and refuses
  otherwise. `--root` outranks `--yes`, and under `--yes` a refused first
  candidate is refused, never passed over. Nothing is written until the
  scope paths, the config and the `.gitignore` check out. Then it writes
  `.rafa/`, its `config.yaml` with every setting commented out at its
  default, and the tree (`src/project/scaffold.ts`); then the
  `.gitignore` block and its digest (`applyTracking`); then `~/.rafa/`,
  its `config.yaml` and `instincts/`. Each is written only when missing,
  so a rerun changes no byte and ends with the line `Nothing changed.`
  It warns when `~/.rafa/bin` is not ahead of `~/.bun/bin` on its
  context's `PATH` (`src/project/bin-path.ts`). It also warns, and never
  copies, when a plan under `plan.dir` routes to an agent that resolves
  only in `~/.claude/agents` under the resolved `loop.settingSources`,
  naming each plan, its lines and `rafa agent vendor <name>`
  (`src/agents/vendorable.ts`); a missing agent no user definition
  carries is left to the preflight, which refuses on it, and so is a
  name the rafa tier holds, even under `tiers.rafa: off`, whose fix is
  the setting and not a copy. `init` writes nothing under `.claude/`,
  in the project or the home. In json mode the
  result's `data` holds the root, its source, the working directory,
  whether the config existed, every path checked with its change, that
  reading, those vendorable uses, and what the release step and the
  board step each came to.
- **The release step asks once, and only where nobody has answered**
  (`src/commands/init-release.ts`). `--release` writes
  `release.enabled: true` and `--no-release` writes `false`, both
  without asking; a project config that already sets the setting is left
  exactly as it is; `--yes` and a run with no terminal ask nothing and
  leave it unset, printing the line naming `rafa init --release`; and
  otherwise the one question
  `Bump <versionFile> and add a <changelog> entry with every pull
  request? [Y/n]` is asked through `init`'s own prompter on stderr, with
  a line above it for each of the two configured files that is missing.
  Anything but `n` or `no` is a yes, and an input that ENDED is nobody
  answering and leaves the setting unset. The answer is written into the
  `.rafa/config.yaml` this run made by uncommenting that one line and
  leaving the other three `release` settings commented
  (`src/release/setting.ts`), and the text is parsed back as that answer
  before a byte is written. Nothing it comes to refuses `init`: a config
  it cannot read or edit is a warning. It runs after the scopes and
  before the board step. `--release=<value>` is refused at the top of
  the run, while nothing has been written.
- **The board step runs last, but for the epic guard, the
  relationships move and the project step after it, and only where
  there is a board**
  (`src/commands/init-board.ts`). The provider is resolved from
  `pr.provider` and the root's `origin` (`src/pr/provider.ts`), and
  anything but `gh` ends the step before a runner is opened, with a
  warning only when `--board` asked for one. `--no-board` declines,
  `--board` runs without asking, no terminal leaves the board alone and
  prints the line naming `rafa init --board`, and otherwise the one
  question `Set up the GitHub board for this repo? [y/N]` is asked
  through `init`'s own prompter on stderr, with the extra line saying
  issue bodies are public above it when `gh repo view --json visibility`
  reads `PUBLIC`. That probe is sent only when the question is asked,
  and a probe that fails leaves the line out and warns. What it makes is
  `src/board/setup.ts`'s, each part printed as
  `  <outcome>  <name>` under `GitHub board:`, with the detail of a part
  refused or made — a label this run made apart, whose detail is the
  shipped description. Nothing it comes to refuses `init`: a failed
  command is a refused part. It runs after the scopes are written,
  because the `roadmap.issue` it writes goes into the config this run
  made, and a run that creates no part leaves `Nothing changed.` true.
  `--board=<value>` is refused at the top of the run, while nothing has
  been written.
- **The epic guard step follows a board that ran**
  (`runEpicGuardStep` in `src/commands/init-board.ts`). It offers the
  optional workflow `src/board/templates/epic-guard.yml`, written to
  `.github/workflows/epic-guard.yml` by `src/board/epic-guard.ts`
  through `src/board/setup.ts`'s `writeShippedFile`. GitHub's checks
  belong to commits and pull requests, so the guard is a workflow on
  `issues: [labeled]`: when the label added starts with `epic:` and the
  issue carries another, it removes the one just added with
  `gh issue edit --remove-label` and comments why. The label kept is the
  one whose latest `labeled` event is oldest, so two labels added in one
  edit keep the same one whichever run reads first, and each run removes
  only its own event's label. The first answer wins: a board that did
  not run leaves it `not-run`, warning only when `--epic-guard` asked;
  `board.relationships: native` leaves it `native`, asking, reading and
  writing nothing, and `--epic-guard` there is refused with a warning
  opening `board.relationships is native:` (a warning, exit 0, since
  the project is set up by then); `--no-epic-guard` declines; anything already at the path is reported,
  `present` for a file and `refused` otherwise, and nothing is asked;
  `--epic-guard` writes it; no terminal leaves it `unasked` with the
  line naming `rafa init --board --epic-guard`; otherwise the question
  `Install the epic guard workflow, which removes a second epic: label
  from an issue? [y/N]` is asked. `--board` answers only the board's
  question. Its row is printed under the board rows, a written file
  counts as a change, and json mode carries it as `epicGuard`.
  `--epic-guard=<value>` is refused at the top of the run. The step's
  shell was measured on 2026-09-27 outside the suite, extracted with `yq`
  and run under bash against a fake `gh` on PATH: one `epic:` label,
  the added label kept, and the added label already gone each sent no
  edit; a second label added after the first, and a label re-added after
  another, each sent one `--remove-label` for the added label and one
  comment. As a control, `min_by` swapped for `max_by` flipped four of
  those seven readings. A failing `gh api` exits 1 with no edit.
- **The relationships move follows the epic guard, and only when
  `board.relationships` is set** (`runRelationsMoveStep` in
  `src/commands/init-board.ts`; the plan and the writer are
  `src/board/relations/move.ts`'s). With the key at its default (the
  config layers' `sources` say `default`) it answers null: nothing is
  read, asked or printed, and json mode leaves `relationsMove` out of the
  result. Otherwise, after a board that ran, it reads the board once in
  the `native` listing fields plus one `gh repo view --json
  nameWithOwner`, and plans moving the OTHER mode's relationships into
  the configured one. A read that failed is a warning naming
  `rafa init --board`; a plan with no write and no old mark prints
  `Board relationships: nothing to move from <from> to <to>.`; no
  terminal writes nothing and prints the line naming `rafa init --board`
  (no flag answers it for a script). On a terminal every write, and
  every relationship the plan skips, is printed on the prompter, and one
  `[y/N]` question asks whether to send them; anything but yes writes
  nothing. On a yes the writes are sent in order, the first refusal
  stopping the move with a warning naming what went through and what was
  left. Only once every write went through are the old marks printed and
  a second `[y/N]` question asked whether to remove them; kept marks are
  named under the rows. A plan whose writes are all on the board already
  asks the second question alone. The rows touched are dropped from a
  kept `native` listing (`invalidateRows`). The result prints under
  `Board relationships, <from> to <to>:` as `sent`, `left`, `removed`
  and `kept` rows, and json mode carries it as `relationsMove`.
- **The project step runs last of all, after a board that ran**
  (`runProjectStep` in `src/commands/init-board-project.ts`; its five
  parts are `setUpProject`'s in the same module). It follows the
  relationships move so the Blocked by values are read in the mode the
  move has just left the board in. The first answer wins: a board that
  did not run leaves it `not-run`, warning only when `--project` asked;
  `--no-project` declines; `--project` runs it; no terminal leaves it
  `unasked` with the line naming `rafa init --board --project`;
  otherwise the question `Also create a GitHub project with roadmap and
  kanban views? [y/N]` is asked. The `gh` runner is opened only once
  it runs, and the `roadmap.issue` the board step may just have written
  is read back off the file first. Its rows print under
  `GitHub project:`, a created part counts as a change, a refused part
  (the `project` scope among them) refuses nothing and exits 0, and json
  mode carries it as `project`. `--project=<value>` is refused at the
  top of the run.
- **`doctor` checks what `loop start` would, and starts no run**
  (`src/commands/doctor.ts`). In text mode it prints `rafa <version>`
  first, before anything is checked, so the build that answered is read
  whatever the preflight then does; json mode prints no such line. It
  resolves the config as `loop start`
  does, then the plan `--plan=<file>` names against the project root, or
  the default plan; a plan named that is no file is refused, and with no
  default plan there the config's items are checked alone. `PLAN.md`
  carries no stub, so a plan's `PREREQUISITES-<stub>.md` is merged in
  through `--plan` only. The two automatic items a `gh` pull request
  provider contributes go ahead of the configured required tier, as
  `runStartPreflight` puts them, and a configured `pr.provider: none`
  reads no `origin` at all (`src/pr/preflight-items.ts`). Every item goes
  through `runPreflight` in the project root with the context's
  environment, an optional failure warned about as `loop start` warns. A
  plan's start-only `[start]` items are checked between the provider's
  items and the configured required tier, where `runStartPreflight` puts
  them, on a FIRST DISPATCH alone: this command reads that one bit the way
  a run does, `isFirstDispatch` off the `PLAN_TRACKER-<stub>.md` beside
  the plan (`src/preflight/first-dispatch.ts`), which starts no run and
  writes nothing. A resume checks none of them, and prints one line
  saying how many of the plan's it passed over and which tracker decided
  it. It generates no run id and writes no
  `preflight` row, so `rafa effort report` lists the halts of `loop start`
  runs alone. It exits 1 when a required item fails, the halt being the
  refusal, when its `effort store schema` row fails, and when its
  `effort sync` row fails (both below), and 0
  otherwise. For a plan `--plan` names, halt or not, it
  then prints the one risk-total line `loop start` prints before its
  notices (`src/start/risk-total.ts`), at `info`, a `log` event in json
  mode, or a warning when the reading throws; the default plan gets
  none, and neither changes the exit code. Then, on a repository whose provider is
  `gh`, it reads the board `rafa init --board` sets up
  (`src/board/status.ts`) with one `gh label list` and, only when the
  config names no `roadmap.issue`, one `gh issue list`, and prints
  `  <outcome>  <name>` under `GitHub board:` for each of the six
  labels, the spec issue template, the Roadmap issue and
  `roadmap.issue`: `present`, `missing`, or `unknown` for a reading
  that failed or found two open Roadmap issues, with the sentence
  behind every outcome but `present`. A run with any row that is not
  present ends them with `Run rafa init --board to set up <n> parts of
  the board this run did not find.` The provider is the one reading the
  automatic items resolved, so `pr.provider: none` opens no runner and
  prints no row; nothing on the board is written, a row never changes
  the exit code, and a halt prints its rows before the refusal. In
  `labels` mode (`board.relationships`, the default), through that same
  runner it then reads the blocked issues
  (`src/commands/doctor-blocked.ts`): one
  `gh issue list --state open --label spec:blocked --limit 100 --json number,body`,
  and, only when a `Blocked by:` line actually named ids, one
  `gh issue list --state all --limit 500 --json number` for the board's
  own numbers. Under `Blocked issues:` it names every labelled issue
  whose line is missing, names no issue, names itself, or names an id
  the board has no issue for, each with what an author does about it
  (`src/board/blocked.ts`); a board whose lines all read is one line
  counting them, and a board carrying no such issue prints nothing at
  all. An id is called unknown only when the whole board was read: a
  numbers listing that failed or came back full leaves every id
  unchecked and says so in a line of its own. That reading writes
  nothing and never changes the exit code either. Through that same
  runner it then reads the epic labels (`src/commands/doctor-epics.ts`):
  one `gh issue list --state all --limit 1000 --json
  number,title,body,state,stateReason,labels`, the board listing the
  roadmap views read. Under `Epic labels:` it names every issue
  carrying two `epic:` labels and every `epic:` label no `type:epic`
  issue carries, in the words and order of `readEpicProblems`
  (`src/board/epic-problems.ts`), the only reader of either; the horizon
  and checklist faults are left to the board views. A board whose labels
  all read is one line counting them, a board carrying no `epic:` label
  prints nothing, and a failed listing is the heading and one line
  naming why. An orphan is reported only when the whole board was read:
  a listing that came back full reports none and says so in a line of
  its own. In `native` mode neither of those two rows runs, their json
  keys read null, and the relationships row
  (`src/commands/doctor-relations.ts`) runs in their place: the listing
  asked for the native fields and one `gh repo view --json
  nameWithOwner`, then under `Relationships:` every open issue whose
  `blockedBy` list and every epic whose `subIssues` list `gh` answered
  short of GitHub's `totalCount`, one line each, carried in the json
  result as `relations`, a key `labels` mode leaves out. A board whose
  lists all read whole is one line counting them, one with no blocker
  and no sub-issue prints nothing, and a failed read is the heading and
  one line naming why. Off that same listing, sent once per run for both
  rows, it then reads the boards (`src/commands/doctor-boards.ts`). Under
  `Boards:` it names every open `type:roadmap` board whose `Owner:`
  handle GitHub answers 404 for (`src/board/owner-resolve.ts`, one
  `gh api` per distinct handle), in one line each; every open issue
  titled "Roadmap" that lacks `type:roadmap` while labelled boards exist,
  in `unlabelledRoadmapMessage`'s one sentence (`src/board/boards.ts`,
  one `gh issue list --search "Roadmap in:title"`); and, when
  `.rafa/position.json` is set, each `lost` notice `resolvePlace`
  (`src/board/place.ts`) raises for `current` and `home`: a board closed,
  without `type:roadmap` or not on the listing, an epic closed, without
  `type:epic` or not on the listing, with the fallback. An owner lookup
  that failed other than with a 404, a title search that failed and a
  position that could not be checked are each a line saying why. A
  project with no open `type:roadmap` board and no position file sends
  nothing past the listing and prints no `Boards:` row, nor does one
  with boards and none of those faults; a failed listing prints nothing
  there either, since `Epic labels:` (or `Relationships:`) names it.
  The board readings live in `src/commands/doctor-board.ts`, which
  opens the runner, makes the one listing in the configured mode and
  joins their lines; that row writes nothing and
  never changes the exit code either. A repository whose
  `board.project.number` is set then gets `GitHub project:` with three
  rows, the `project` scope, the project at that number and its five
  fields, each `present`, `missing` naming its fix (`gh auth refresh -s
  project`, `rafa init --board --project`, or the fields of
  `board.project.template`) or `unknown` saying why, and with all three
  present the line naming `rafa board sync --dry-run`
  (`src/commands/doctor-project.ts`); it reads no item, sends nothing
  where the number is unset, is json's `project`, and never changes the
  exit code. Every repository
  then gets one row counting the branches and worktrees `rafa cleanup`
  would list, `Cleanup: <n> merged, <n> stale, <n> not pushed, <n>
  worktrees; run rafa cleanup to review and remove them.`
  (`src/commands/doctor-cleanup.ts`), read with no `git fetch`, git
  run in the project root, and the provider's merged listing sent only
  through the board's `gh` runner; it prints only when any count is
  above zero, prints nothing for a repository git cannot read, and
  never changes the exit code. Every repository with a saved copy under
  `specs.dir` then gets `References:` counting the suspect, dangling
  and unknown references of every copy, and a line per copy holding a
  suspect or dangling one naming `rafa issue check <n>`
  (`src/commands/doctor-refs.ts`); it writes no stamp, reads each issue
  once per run, reads an issue the board cannot answer as `unknown`,
  and never changes the exit code. A repository whose release is on
  (`src/release/enabled.ts`) then gets one row naming the version
  `origin/<pr.base>` declares as last fetched, the latest release tag,
  the version the changelog's top heading names and the fragments
  waiting on the base, `Release: origin/main at 0.25.0, latest tag
  v0.25.0, CHANGELOG.md tops at 0.25.0, no fragment waits.`
  (`src/commands/doctor-release.ts`); while any fragment waits, one
  that does not parse included, it names them and the release settle
  would fold them into, and goes out as a warning naming
  `rafa release settle`, in json mode too. It fetches nothing, marks a
  part it could not read `?` with the reason on an indented line, and
  never changes the exit code. Every run then prints the
  `Skill tiers` rows (`src/commands/doctor-tiers.ts`), when there is
  any, as json's `tiers`; they never change the exit code. Every run then
  prints the `effort store schema` row (`src/commands/doctor-effort-schema.ts`),
  `Effort store schema: <ok|warn|fail>, <status> (<path>)`, read
  read-only as `rafa effort schema --check` reads the store, under
  `RAFA_EFFORT_DIR` when it is set: it fails where that check fails,
  and `doctor` then exits 1 with `rafa doctor: effort store schema:
  this rafa refuses <path> (<status>): <why> Next safe step: <command>`,
  after a halt's text when both happen, and json mode gives no `data`;
  it warns, never changing the exit code, on each unknown additive
  migration in the preflight's words and, for the project's own store
  alone, on each migration whose `applied_by` names a development
  build. A project with no store yet prints no line. json mode gives
  the row as `effortSchema`. Every run then prints the `effort sync`
  row (`src/commands/doctor-effort-sync.ts`), `Effort sync: ok,
  <strategy>`, ` (module)` added for a strategy a loaded module serves,
  or `Effort sync: fail, <strategy>` with the problem indented under
  it: `selectSync` resolves `effort.sync` (`local` when unset) through
  core's registry for `local` and `file` and through the modules the
  config loads for any other kind, touching nothing on disk. A kind no
  adapter serves fails it, and `doctor` then exits 1 with
  `rafa doctor: effort sync: effort.sync is "<kind>", ...`, which for
  `git`, `service` and `p2p` names the `modules:` and `allowList:`
  lines that load a module providing it, after a halt's text and the
  schema row's refusal when those happen, and json mode gives no
  `data`. json mode gives the row as `effortSync`. Under the boolean
  `--deep` it then reads and prints the Environment, Settings,
  Providers and Stack tools sections, and Plan needs for a plan
  `--plan` names (`src/commands/doctor-deep.ts`), a halt's included,
  so they come before its refusal; they start no session and never
  change the exit code. After
  the report, whatever the preflight did,
  it warns when `.ralph/effort/` holds a store file and `.rafa/effort/`
  none (`src/effort/store/legacy.ts`), and when `~/.rafa/bin` is not
  ahead of `~/.bun/bin` on the context's `PATH` (`readBinPath`); text
  mode says so in an `info` line when the order holds. In json mode a
  preflight that did not halt gives the checks, the `known-missing:`
  lines, the reminders, both readings, those rows, those blocked
  issues, those epic labels (`epics`: `labelled`, `faults`,
  `problem`, `unchecked`) and those boards (`boards`: `boards`,
  `faults`, `problems`, `listing`) as the result's `data`, the rows, the
  issues, the labels and the boards null for a project with no GitHub board, the cleanup counts as its `cleanup`
  (`{ ok: false, detail }` for a repository git cannot read), the
  references counts as its `refs` (`{ ok: false, detail }` for a
  `specs.dir` that cannot be listed), the release row's reading as its
  `release` (`{ enabled: false }` where the release is off), the `--deep` sections as its `deep`,
  null without the flag, and a
  halt gives the `command_exit` error and no `data`.
- **`status` reads where the project stands in six sections**
  (`src/commands/status.ts`, `src/status/sections.ts`, `src/status/render.ts`).
  Each section is read in order: branch and plan (git at the project root,
  the plans directory named by the config, the task counts and stub if a
  branch is a feature branch); loops (the session records under `.rafa/runs/`,
  how many run and how many are blocked, each running or blocked one named);
  pull request (the branch's open pull request if any, whether it can be merged,
  its checks); board (the Roadmap's next unblocked issue if the provider is `gh`,
  whether it is ready, how many issues carry `spec:blocked`); claims (each
  `feat/rafa-<n>` claim branch on `origin` as last fetched, nothing fetched,
  with the store that owns it, the stage label its issue carries off the one
  board listing, and whether it is stale, from `src/status/claims.ts`);
  housekeeping (the branches and worktrees `rafa cleanup` would list,
  counted per group, nothing fetched). The pull request, board and claims' stage labels go through `gh` under a short deadline; the rest are read with no network. A section that could
  not be read — git refusing, `gh` timing out, a provider that is not `gh` —
  is one `warn` line saying why; everything else is `info`. A reading that
  answers `{ ok: false }` is thrown as an error and swallowed into a `warn`
  line, so nothing changes the exit code. Exit code 1 only for a config
  `loadConfig` refuses; 2 for a positional word, since it takes none;
  0 otherwise, whether it read everything or not. Text mode prints each line
  the level it names; json mode gives the six sections as data, each with
  `read` (true or false) and its reading or the problem.
  `createStatusHook` reads the project's config (with warnings dropped) and
  calls `createStatusCommand` by default, so a command can run with seams for
  the sections and the whole hook. No test needs a command factory seam.
- **`self-update` installs the checkout it runs in**
  (`src/commands/self-update.ts`), as `bun run snapshot` does: both call
  `installRuntime` (`src/runtime/install.ts`), the script from the
  checkout and the command from the bundle. The command alone first reads
  the session records under the project root's `.rafa/runs/` and refuses
  with exit code 1 when a live loop is found reading `running` or `paused`
  with its pid alive, naming each loop's branch, pid and session id so you
  know what is running. The wait can be bypassed with `dangerous.selfUpdateDuringLoop:
  true` in the config, allowing the binary to be swapped even during a loop run,
  or deferred until the loops complete; `--force` does not override the guard.
  In the project root it reads
  `package.json`, refusing one not named `@open-tomato/rafa`, then
  `plan.dir` as `loop start` resolves the config, then each
  `PLAN_TRACKER*.md` directly in `plan.dir`, refusing while one holds an
  open or blocked task; the project root and subdirectories of `plan.dir`
  are not looked in. Then, still before building, it refuses while
  `~/.rafa/runtime/<version>/` is already there, naming that directory and
  the version, unless `--force` is on the line: a version is installed
  once, and a loop may be running from that directory. Then it runs
  `bun run build`, copies `dist/` into a staging directory in
  `~/.rafa/runtime/` file by file, each by a rename, renames that
  directory into the version's place, removing what it held whole, and
  renames a new link over `~/.rafa/bin/rafa`, making the directory when
  missing. `~/.bun/bin/rafa` is not touched. The home is the project's. Each step
  is an `info` line; the build's stdout is written at `info` and its
  stderr at `warn` once it ends, so json mode's stdout stays NDJSON.
  After an install it warns when `~/.rafa/bin` is not ahead of
  `~/.bun/bin` on the context's `PATH` (`readBinPath`). In json mode the
  result's `data` holds the root, the version, the runtime directory, the
  link, where it resolves, the files copied and that reading.
- **`agent vendor <name>... [--force]` copies a rafa-tier or home
  definition into the project** (`src/commands/agent/vendor.ts`), which
  is the fix `loop start`'s preflight and `plan validate` name for an
  `agent=` only the user tier holds. It reads the rafa tier
  (`bundled/agents` beside the running entry) first and `~/.claude/agents`
  second, the resolution order with the project left out, so a name both
  hold is copied from the rafa tier; each copy's text line ends
  `(from the rafa tier)` or `(from the user tier)`. A name is a
  definition's frontmatter `name`, what `--agent` resolves by, so the
  source is the tier's `*.md` carrying it, whatever its stem, and the copy
  keeps that file's own name under `<root>/.claude/agents/`. The copy carries one line the original
  does not, an HTML comment naming the source file and the day, written
  directly after the frontmatter's closing `---` — never ahead of the
  opening one, which would leave the file carrying no frontmatter at all
  — and as the first line of a file that opens with none. The home is the
  project's and no config is read. Every name is checked before the first
  byte is copied, so a line naming one bad name copies none of the rest.
  It throws exit code 1 for a `--force` value that is neither `true` nor
  `false`, read ahead of the names so `--force` typed first, which
  `parseArgs` hands the next word as its value, meets that refusal; for a
  line naming no name; for a name neither tier carries, the refusal
  naming both directories; and for a destination already there, which `--force` replaces
  whole. Each refusal ends with the line `Nothing was written.` In json
  mode the result's `data` holds the root, `<root>/.claude/agents` and
  one row per copy: the name, the tier and the file it came from, the
  file written and whether one was replaced. A declaration has no variadic spelling, so
  `rafa agent vendor --help` renders the argument as `<name>` where the
  refusals' usage line says `<name>...`.
- **`agent list [--source=<source>] [--state=<state>] [--hidden-from-loop] [-i]`
  lists every agent definition the inventory holds**
  (`src/commands/agent/list.ts`, over `buildInventory` in
  `src/inventory/index.ts`), built as `skill list` builds it and taking
  the same three filters. `--source` names a whole source string
  (`project`, `rafa`, `user`, `plugin:<name>`, `addon:<name>`), aliased
  `--tier` for one release after this one; `--state` takes `enabled`,
  `collision`, `shadowed` or `disabled` and matches the prefix;
  `--hidden-from-loop` keeps `visibleToLoop: false`. A `plugin:` or
  `addon:` source the inventory does not know is refused. The filters
  are read and matched by the helpers `src/commands/skill/list.ts`
  exports. A definition is
  keyed by its frontmatter `name`, as `--agent` resolves it, and each row
  prints the loop mark (`●` when a run sees it, `○` when not), name,
  source, state and summary. The Claude Code built-ins are no inventory
  row and are not listed. After the counts and the legend, when a `user`
  row's name is answered by no row visible to the loop, a trailing line
  names those definitions and points at `rafa agent vendor`; a home name
  the project also holds is not one of them, since the name resolves to
  the project's copy. The vendor hint reads the whole inventory, so no
  filter hides it. It spawns nothing and exits 0 whatever the rows say;
  exit code 1 is kept for a positional word, a `--source` or `--state`
  it cannot take, and a config `loadConfig` refuses. In json mode the
  kept records, the filters, the pre-filter total, the agents trees, the
  vendor names as `unreachable` and the warnings are the result's `data`.
  `-i | --interactive` browses the kept rows instead of printing them,
  through `browse` (`src/inventory/browse.ts`) on standard error: Enter
  shows a row, `f` its whole file, Escape goes back, `q` quits, `ctrl-c`
  is exit code 130. The warnings still go out first, and with no row kept
  the text listing is printed instead. Exit code 1, before the inventory
  is built, refuses `-i` when standard input is not a terminal, with a
  line naming `rafa agent list --output=json`, and refuses it beside
  `--output=json`.
- **`agent show <name> [--full]` shows the agent definition a name
  resolves to** (`src/commands/agent/show.ts`, over the show view of
  `src/inventory/show.ts`). The inventory is built through the
  `projectInventory` `src/commands/skill/list.ts` exports, the name is
  the frontmatter `name` `agent list` prints, and it shows its first
  holder in precedence order (`findShown`): the agent definition that
  answers, or the disabled one still holding the name. A shadowed holder
  is listed under the other holders, with its path, rather than shown in
  its own right. Text mode prints the record, every other agent with its
  source, state and path, the frontmatter as written and the body's
  headings with their file lines; `--full` prints the whole file in
  place of the frontmatter and the headings. `--full` is read ahead of
  the name through `readSwitch`, so `rafa agent show --full <name>`,
  which `parseArgs` hands the name as the flag's value, is refused
  naming the order that works. A file that no longer reads still shows
  the record and the other holders, with the reason, and exits 0. The
  inventory's warnings are `warn:` lines. Exit code 1 is kept for no name
  or two, a value read into `--full`, a name no agent holds — whose
  refusal points at `rafa skill show` when a skill holds it — and a
  config `loadConfig` refuses. In json mode every part of the view, the
  project root, `loop.settingSources` and the warnings are the result's
  `data`, `text` holding the file under `--full` alone. The Claude Code
  built-ins are no inventory row, so no name shows one.
- **`agent search "<question>" [--all] [--no-model]` finds the agent
  definitions that answer a question** (`src/commands/agent/search.ts`,
  through `createSearchCommand` of `src/commands/skill/search.ts`). The
  same command as `skill search` over the inventory's agent rows. An
  agent is named by its frontmatter `name`, as `rafa agent list` prints
  it. The Claude Code built-ins are not inventory rows, so no search
  ranks one. `--all` searches skills as well, agents first, one session
  per kind. `--no-model` runs the ranking alone, prints it and stops: no
  session starts and no effort row is written. The command's `spends`
  declaration is `unless --no-model`, so the spend guard refuses a
  session a run carrying that flag would start. Text mode prints, per
  kind, a heading, then each kept match with its quote and its `path:line`
  and the dropped line, or "not answerable from these files", or the
  numbered ranking (under `--no-model`, and after a `warn:` notice of a
  fallback when the session gave no usable answer), or `(no agent ranks
  for these words)` when no session starts. The parser's issues and an
  effort row that was not stored are `warn:` lines. The exit code is 0
  whatever is found; 1 for no question or two, a blank one, a value read
  into `--all` or `--no-model`, and a config `loadConfig` refuses. The
  switches are read ahead of the question through `readSwitch`. In json
  mode the result's `data` holds the project, `loop.settingSources`, the
  question, `model`, the warnings and one entry per kind: the runner's
  outcome, or `status: ranked` with the ranking under `--no-model`.
- **`skill check <dir> [--fix] [--project=<root>]` and
  `instinct check <dir>` run the checker over one tier**
  (`src/commands/skill/check.ts`, `src/commands/instinct/check.ts`,
  sharing `src/commands/check-report.ts`). The five checks of
  `src/check/run.ts` run in order and all of them on every file, so one
  run names every rule a file breaks and the file counts once.
  Both declare `needsProject: false`: the checker's project seam is
  `--project` and nothing else, since a tier is often
  `~/.claude/skills`, which sits in no project, and without the flag a
  project-looking path in a body is counted `unchecked-path`, a warning.
  `instinct check` declares no flag at all, so its runs always read that
  way. `PATH`, which the fenced-tool lookup resolves against, is the
  context's `env`; `<dir>` and `--project` resolve against the working
  directory, which is the one seam of each command's factory. A command
  no `PATH` directory holds is `missing-tool`, a failure, only for a
  file whose frontmatter declares `stack: [agnostic]` or declares no
  `stack` at all; a file declaring any other `stack` gets
  `missing-tool-off-stack`, a warning, because the machine the run
  happened on need not install a stack-gated skill's toolchain. Nothing
  else the resolution and locality stages judge moves with the `stack`.
  A failing-file count is therefore a reading about the `PATH` it ran
  under and about nothing else. The same 221 files of the user tier
  answered 1 failing under one session's `PATH` and 9 under another's,
  the difference being nine off-stack toolchains that resolved in the
  first; so record the `PATH` beside any such count, and compare two
  counts only when both were taken under the same one.
  `--project` carries ONE root and knows no subpackage scope, so a body
  path a skill's own prose scopes one directory down — a borrowed
  cross-project skill declaring `Scope: packages/ui/` — resolves
  against neither tier and fails in every checkout that bundles it.
  The bundled cross-project skills have the leading directory stripped
  from each such mention for that reason, leaving the filename, which
  `isProjectPath` no longer reads as a path for want of a separator;
  restoring the directory reddens both tiers.
  `--fix` fills `tags` and `stack` on a file whose only failures are
  those two missing fields, through `src/schema/frontmatter.ts`, so the
  body survives byte for byte, and the report is the re-check of what
  was written. Both flags are read AHEAD of the directory, as
  `agent vendor` reads `--force` ahead of its names, so
  `rafa skill check --fix <dir>` — which `parseArgs` hands the directory
  as the value of `--fix` — meets the refusal naming the order that
  works rather than the one saying it named no directory.
  A clean entry prints nothing; an entry with issues prints its path and
  one line per issue in `CHECK_STAGES` order, and the run closes with a
  count. The exit code is the number of failing entries, capped at 255,
  and exit code 1 is kept for the refusals: no directory, a second word,
  a `--fix` or `--project` value the flag cannot take, and a path that
  is no directory. On a failing run those lines are the `CommandExit`
  message, as `doctor`'s halt is, because the dispatcher drops a nonzero
  exit's `result` payload; so json mode gives
  `CheckCommandResult` as the result's `data` on a CLEAN run alone.
  Help renders a string flag's placeholder from its type, so
  `rafa skill check --help` draws `[--project=<string>]` where the
  refusals' usage line says `[--project=<root>]`, as `agent vendor`
  draws `<name>` where its own says `<name>...`.
- **`skill list [--source=<source>] [--state=<state>] [--hidden-from-loop] [-i]`
  lists every skill the inventory holds** (`src/commands/skill/list.ts`,
  over `buildInventory` in `src/inventory/index.ts`). The inventory is
  built against the project the dispatcher resolved, its home, the
  config's `loop.settingSources`, `tiers.rafa`, `tiers.skills` and
  `tiers.agents`, and the modules `loadModules` answers `loaded`; the
  rafa tier is measured from `Bun.main`, and the entry and
  the module loader's seams are the command factory's two seams. One row
  per skill, of every source (`project`, `rafa`, `user`, `addon:<name>`,
  `plugin:<name>`), prints `●` when a loop session resolves it and `○`
  when not, then its name, source, state (`enabled`, `collision`,
  `shadowed-by:<source>` or `disabled:<how>`) and summary, the columns
  padded to the widest cell. `--source` keeps the rows of one whole
  source string and refuses a `plugin:` or `addon:` source no row or
  warning names; `--tier` is its alias, marked in the help for removal
  after one release. `--state` takes `enabled`, `collision`, `shadowed`
  or `disabled` and matches the state's prefix, `collision` keeping the
  holders of every name two loaded tiers hold different items under;
  `--hidden-from-loop` keeps `visibleToLoop: false`. A `rafa` row is
  marked `●` when it is served to a loop session and `○` when not
  (`sourceVisibleToLoop`, `context/inventory.md`). The filters combine
  and are read and matched by helpers the module exports. A skills tree
  whose directory is absent prints its path and `(no such directory)`,
  and an unreadable plugin record, plugin, add-on manifest, settings
  file or `skillOverrides` entry is one `warn:` line. The exit code is
  0 whatever the rows say — the listing reports and `skill check`
  gates — and exit code 1 is kept for a positional word, a `--source`
  or `--state` it cannot take, and a config `loadConfig` refuses. In
  json mode the kept records, each with
  its `check`, the filters, the pre-filter total, the skills trees and
  the warnings are the result's `data`. `-i | --interactive` browses the
  kept rows instead of printing them, through `browse` (`src/inventory/browse.ts`)
  on standard error: Enter shows a row, `f` its whole file, Escape goes
  back, `q` quits, `ctrl-c` is exit code 130. The warnings still go out
  first, and with no row kept the text listing is printed instead. Exit
  code 1, before the inventory is built, refuses `-i` when standard input
  is not a terminal, with a line naming `rafa skill list --output=json`,
  and refuses it beside `--output=json`. The terminal and the keys are
  the `terminal` and `keys` seams of the factory.
- **`skill show <name> [--full]` shows the skill a name resolves to**
  (`src/commands/skill/show.ts`, over the show view of
  `src/inventory/show.ts`). The inventory is built as `skill list`
  builds it, through the `projectInventory` that module exports, and
  the name shows its first holder in precedence order (`findShown`): the
  skill that answers, or the disabled one still holding the name. A
  shadowed holder is listed under the other holders, with its path,
  rather than shown in its own right. Text mode prints the record, every
  other skill of that name with its source, state and path, the
  frontmatter as written and the body's headings with their file lines;
  `--full` prints the whole file in place of the frontmatter and the
  headings. `--full` is read ahead of the name through `readSwitch`, so
  `rafa skill show --full <name>`, which `parseArgs` hands the name as
  the flag's value, is refused naming the order that works. A file that
  no longer reads still shows the record and the other holders, with the
  reason, and exits 0. The inventory's warnings are `warn:` lines as
  `skill list` writes them. Exit code 1 is kept for no name or two, a
  value read into `--full`, a name no skill holds — whose refusal points
  at `rafa agent show` when an agent holds it — and a config `loadConfig`
  refuses. In json mode every part of the view, the project root,
  `loop.settingSources` and the warnings are the result's `data`, `text`
  holding the file under `--full` alone.
- **`skill search "<question>" [--all] [--no-model]` finds the skills that
  answer a question** (`src/commands/skill/search.ts`, through `runSearch`
  and `rankSearch` of `src/inventory/search/`). The inventory is built
  through `projectInventory`, as `skill list` builds it. Each kind
  searched is one `runSearch`: the ranking by the question's words, one
  `haiku` session in a scratch copy of the top twelve, the quote check
  against the file and one `search` effort row, stored in the store
  `selectEffortStore` opens from the project's config. `--all` searches
  agent definitions as well, skills first, one session per kind, since a
  candidate is keyed by its name and a skill and an agent may share one.
  `--no-model` runs the ranking alone, prints it and stops: no session
  starts, no scratch copy is made and no effort row is written. The
  command's `spends` declaration is `unless --no-model`, so the spend
  guard refuses a session a run carrying that flag would start. Text mode
  prints, per kind, a heading naming the kind, the question and the
  project, then the kept matches with each quote and its `path:line` and
  the dropped line, or "not answerable from these files", or the numbered
  ranking (under `--no-model`, and after a `warn:` notice of a fallback
  when the session gave no usable answer), or `(no skill ranks for these
  words)` when no session starts. The parser's issues and an effort row
  that was not stored are `warn:` lines. The exit code is 0 whatever is
  found; 1 for no question or two, a blank one, a value read into
  `--all` or `--no-model`, and a config `loadConfig` refuses. The
  switches are read ahead of the question through `readSwitch`, since
  `--all "<question>"` hands the question to `--all`. In json mode the
  result's `data` holds the project, `loop.settingSources`, the
  question, `model`, the warnings and one entry per kind: the runner's
  outcome, or `status: ranked` with the ranking under `--no-model`.
- **`skill demote <dir> [--apply]` runs the demotion pass over one
  skills directory** (`src/commands/skill/demote.ts`, over
  `src/demote/`). `<dir>` must be a `<base>/.claude/skills`, and
  `<base>` decides the scope: the home makes it `user`, writing to
  `~/.rafa/`, and any other base a `project` one, writing under that
  base's `.rafa/`. Anything else is refused, which is why this command
  runs INSIDE a project where the two checkers do not — the home is
  what tells the scopes apart, and it is read off the project the
  dispatcher resolved, as `skill list` reads its own. `<dir>` resolves
  against the working directory, the command's one seam.
  Without `--apply` it selects every `<name>/SKILL.md` and, by
  `origin`, the `learned/*.md` files (`src/demote/select.ts`),
  classifies each (`src/demote/classify.ts`) and writes
  `<base>/.rafa/demoted/report.md` (`src/demote/draft.ts`,
  `src/demote/report.ts`), MOVING NOTHING. A report already there has
  each override carried onto the row for the same path whose hash is
  unchanged, and keeps `status: reviewed` only when the row set is
  identical; a report that does not parse is warned about and carried
  from not at all.
  With `--apply` it reads that report back and refuses the whole run
  when it is missing, does not parse, or is still `draft`. Then, one
  row at a time (`src/demote/apply.ts`): an observation becomes a
  record under `<base>/.rafa/instincts/`, run through `checkFile` with
  NO project root — which is how `instinct check` runs — before it is
  written, with the original moved under `<base>/.rafa/demoted/` at its
  relative path; a procedure `SKILL.md` is left where it is and a
  procedure `learned/<name>.md` moves to `<dir>/<name>/SKILL.md`; an
  unclassified row the review did not decide is left alone. A row whose
  file changed since the report, whose file is gone with nothing
  matching at its destination, whose record the conversion refuses and
  whose record the checker fails are each refused ALONE, so one stale
  row does not throw away a review of 124. A second `--apply` reads the
  moved rows as `done` and changes nothing.
  `skill backfill` rewrites the frontmatter of every skill the demotion
  KEPT, so once it has run every surviving row of that report carries a
  stale hash, and a re-`--apply` answers a wall of `file changed since
  the report was written` that is hash drift and no reading at all
  about the demotion. To count afterwards what a report turned into,
  read the report with `parseDemotionReport` and `effectiveVerdict` and
  match each observation row against the instinct scope's
  `evidence[].path` through `readFrontmatter`; never re-run `--apply`
  to measure.
  The exit code is the number of rows refused, capped at 255, and 1 is
  kept for the refusals above and for no directory, a second word and
  an `--apply` that read the directory as its value. In json mode the
  counts, or the per-row actions, are the result's `data` on a run that
  refused no row.
- **`skill backfill <dir> [--propose|--apply] [--project=<root>]` fills
  in the fields a skills directory lacks** (`src/commands/skill/backfill.ts`,
  over `src/backfill/`). `<dir>` is read as `skill demote` reads it —
  a `<base>/.claude/skills`, the home making it `user` and any other
  base a `project` one — and everything the run writes outside the
  skills directory goes under that `<base>/.rafa/backfill/`. So this
  command too runs INSIDE a project, and `<dir>` and `--project`
  resolve against the working directory, the command's one path seam;
  the spawner each session runs through is its other.
  With no flag the run PLANS: `planDerivation` (`src/backfill/derive.ts`)
  answers what `stack`, `paths` and `when_to_use` would be written,
  `selectProposals` (`src/backfill/proposal-batch.ts`) counts the files
  a session would be asked about, and NOTHING is written.
  With `--propose` it runs `runProposalPass` (`src/backfill/propose.ts`):
  one `claude -p` session per batch of twenty through the capturing
  spawner of `src/utils/claude.ts`, the setting sources
  `loop.settingSources` resolves to, and one
  `<base>/.rafa/backfill/proposals-<nn>.yaml` per batch, each
  `status: draft` and each row of a session that answered nothing
  readable marked `unanswered`. No skill is touched.
  With `--apply` it reads those files back — refusing the whole run
  when one does not parse — copies every file a reviewed row could
  rewrite under `<base>/.rafa/backfill/backup/` (`src/backfill/backup.ts`),
  writes the rows (`applyProposals`), then plans the derivation with
  the trigger sentences those rows carried, copies what it will rewrite
  and derives (`applyDerivation`). A file under the checkout the
  command runs in is copied nowhere: git holds it. A draft file, a
  file naming another skills directory, a skill that changed since its
  proposal and any write that fails a check the file passed before are
  each refused ALONE, and no body is ever written.
  The exit code is the number of rows and files refused, capped at 255,
  and 1 is kept for no directory, a second word, `--propose` and
  `--apply` together, a switch that read the directory as its value, a
  bare `--project`, a `<dir>` that is no `.claude/skills` or is not
  there, and a proposal file that does not parse. In json mode the
  actions and their counts are the result's `data` on a run that
  refused nothing.
- **`instinct list` and `instinct show <id>` read the two instinct
  scopes** (`src/commands/instinct/list.ts`,
  `src/commands/instinct/show.ts`, sharing
  `src/commands/instinct/instinct-records.ts`). The scopes are
  `src/schema/tiers.ts`'s — `<root>/.rafa/instincts` and
  `~/.rafa/instincts`, nearest the work first — and both commands run
  INSIDE a project, reading the home and the root off the project the
  dispatcher resolved; `show` declares no flag or seam of its own, and
  `list` declares the two views below and the adapter registry seam
  `--blessed` resolves through. A
  record is a top-level `<scope>/<id>.md`, so the local Learning
  adapter's `instincts.ndjson` and `flags.ndjson`, a dotfile and a
  subdirectory are all passed over without a word, and the id a lookup
  works on is the FILE NAME, never the frontmatter `id`, so a record the
  checker reddens for `name-mismatch` stays reachable.
  `list` prints one row per record — its id, its `kind/domain`, its
  `signal`, its `confidence` and its `trigger` — and for a record that
  broke a rule the number of rules instead; a scope whose directory is
  absent prints its path and `(no such directory)`. Its exit code is 0
  whatever the rows say, with exit code 1 kept for a positional word.
  `list --blessed` prints instead what the `learning.adapter` adapter's
  `pullBlessed` answers at `learning.bless.minConfidence`, made as
  `instinct promote` makes it (`makeLearningAdapter` in
  `instinct/promote.ts`), and `list --conflicts` each trigger a scope
  holds with more than one action — read through `toHeldRecords` and
  grouped by `triggerKey` — its actions side by side with their
  confidence and usage. The two views are one at a time: both together,
  a view flag typed with a value, an adapter that cannot be made and a
  pull it refuses are each exit code 1.
  `show` prints the fields, the two sections, the evidence and the
  `action_hash` computed from the action, which no file stores, and a
  line naming the other scope when it holds that id too; the project
  scope answers first. It refuses with exit code 1 an id no scope holds,
  naming both scopes, and a record that broke a rule, naming its issues,
  each as the `CommandExit` message. In json mode `list` gives the
  scopes, their records and the two counts as the result's `data` (or
  the view asked for: the adapter kind, floor and lessons, or the
  conflicts), and `show` the record.
- **`issue` acts on the tracker the chain lands on**
  (`src/commands/issue/`). Each action reads its line first, then the
  config as `loop start` resolves it, then hands `tracker.default` and
  `tracker.fallback` to `resolveTracker` with the project root as the
  repository (`issue/issue-tracker.ts`), so a line refused for its words
  reads no config and runs no preflight. Each kind passed over is
  written at `warn` as `tracker chain: <kind> unavailable: <reason>`
  before the action acts. An id is the issue's `externalId` on the
  tracker landed on, so a degraded chain reads the id on the tracker it
  fell back to, which numbers its issues on its own. `list` hands `find`
  the query its flags make and reads each ref it answers with `get`, and
  `github`'s `find` refuses every `--state`. `show` reads one issue;
  `create` files a draft with default type `code` (changed by `--type`),
  module `unassigned` and no priority unless a flag names one. Its body
  is `--body` or the bytes of the file `--body-file` names (standard input
  for `-`, a seam of the factory); the two are refused together and an
  unreadable path refused before the chain is resolved. When `--type=spec`,
  a body carrying a `Blocked by:` line is read through `readBlockedBy`
  (`issue/create-blocked.ts`) and filed with `specBlocked` when the line
  reads; the reading is refused naming its fault when it names no issue,
  the issue being filed, or an issue the board's `find` listing lacks,
  each refusal thrown before the chain is resolved or before `create`,
  respectively; `comment` posts `--body`; and `move`
  moves an issue to a state, writing a `warning` the tracker answers at
  `warn` and still exiting 0. In json mode the result's `data` holds the
  tracker (its kind, whether the chain degraded, and why) beside the
  query and the issues, the issue, the ref, or the ref with the state and
  the warning; text mode writes lines. The registry and the `gh` runner
  are seams of each command's factory. `src/commands/issue/create.test.ts`
  spawns `issue create` and `issues list` under a stand-in `gh` failing
  the `github` preflight.
- **`issue list --roadmap` prints the Roadmap in a table**
  (`src/board/roadmap-rows.ts`, `src/commands/issue/roadmap-table.ts`)
  with four new columns over the plain list. The board read is the
  current place's: `readRoadmapRows` finds the default board as before,
  then, when the project root holds `.rafa/position.json`, weighs it
  with `resolvePlace` (`src/board/place.ts`) through `readCurrentPlace`
  over the one board listing, kept and reused by the rows. Each
  fallback notice but the absent-file one is a `warn` line ahead of the
  rows' own, and a listing that failed with a position file there adds
  one saying the default board is read. With no position file nothing
  is weighed and the listing is not asked before the Roadmap. `--all` includes ticked
  lines; without it, only unticked lines are shown. The four columns:
  `spec` is the readiness gate's reading of the body — `ready`, `gaps:
  <heading>, …`, `outline` (fewer than three template headings, no
  label), or a disagreement with the label, `label: ready, gate: gaps`
  or `label: none, gate: ready` — and is read for every row whatever its
  type, not only `type:spec`. It prints as a symbol and, under
  `--texts` (`-t`), in words written for a reader who has never met the
  readiness gate, naming the stages a spec moves through: `📝` outline
  only, `🚧` needs refinement, `👀` refined, waiting for approval, `🚀`
  ready to dev, and `🟠` approved, needs refinement where label and body
  disagree — "refined" being a body the gate finds nothing missing in and
  "approved" the `spec:ready` label, and the legend printing them in that
  order. A green check is left out because it reads as done. `--texts`
  names the sections that need work after `needs refinement:`; #318
  specifies reading unchecked boxes and taking the words from config.
  `blocked by` groups the blockers by state, what still blocks first —
  `🔴 #20 ❔ o/r#3 🟢 #21`, or `open #20 · unknown o/r#3 · closed #21`
  under `--texts` — `unknown` for one not on the board listing or on
  another repository. The legend under the table has one line per
  column that printed a symbol, headed
  `spec:` or `blocked by:`, naming each symbol printed (`🔴` still open,
  `🟢` closed, `❔` state unknown for blockers), and none under
  `--texts`. Width is counted in terminal cells (`Bun.stringWidth`), so
  a symbol's two cells keep the columns aligned, and only `title` is
  cut. Labels are no column: `--labels` prints each issue's labels on a
  row of their own under it, led by `└→` and indented under `state`.
  `has` is every one of `plan`, `branch` and `pr #<n>` that exists,
  joined with `, `. `refs` is how many references of the issue's saved
  copies under `specs.dir` read `suspect` or `dangling`, `0` for a clean
  copy, `?` for a copy that could not be read (with a warning naming
  `rafa issue check <n>`), and `-` with no copy; it is `rafa doctor`'s
  references reading (`readDoctorRefs`, `src/commands/doctor-refs.ts`)
  narrowed to the selected lines' issues, reads a same-repository issue
  through the same `gh` runner, and writes nothing. A same-repository
  issue the board listing holds is answered from the listing already
  read (`listedIssueReader`), and a `ts-symbols` outline is kept by the
  outlined file's content under `.rafa/cache/outline/v2/`
  (`src/refs/outline-cache.ts`), so a second run outlines nothing that
  has not changed. In text mode over a Roadmap naming an epic the column
  is not read at all (`refsWhen: 'plain'` in `src/board/roadmap-rows.ts`),
  since nothing printed there shows it; json mode still reads it. The
  board listing is kept under `.rafa/cache/board.json`
  (`src/board/board-cache.ts`): a first read takes a watermark (the
  newest `updated_at` on the repository) and then the full listing, and
  every later read sends one `gh api --paginate` for the issues changed
  since, laying them over the kept rows, plus, in the `native` mode after
  `invalidateRows` recorded the issues a relationship write touched, one
  `gh api graphql` read of those issues by number; `--refresh` reads the
  whole board again, the only way to drop a deleted or transferred issue. A
  case planting `gh` reads uncached unless it sets
  `IssueSeams.boardCache`. One `gh` read of the board and one of the Roadmap
  body itself: when the board is unreachable, a `warn:` line is printed
  on stdout ahead of the rows in text mode, then the `Roadmap #<n> ·
  epics unknown: <reason>` line and the rows under `Specs`, read from the
  Roadmap body alone with `spec` and `blocked by` empty and `has` still
  filled, and the command exits 0. The branch reading is
  `scanClaimBranches`, which also runs `git ls-remote --heads`: a
  repository with no `origin` adds a warning, so a spawned case plants a
  bare `origin` (`src/tests/roadmap-cli.test.ts`). The other flags
  narrow after the Roadmap's selection keeps its order: `--type` and
  `--module` by the labels read with `typeOfLabels` and
  `moduleOfLabels`, exported from `src/adapters/tracker/github.ts` so
  the mapping is spelled once (`type:feature` reads `code`), `--search`
  by text case-folded in the title or body, and `--limit` keeps the
  first that many. `--state` beside `--roadmap` is refused on its
  presence, whatever its value. `rafa roadmap` (`src/commands/roadmap.ts`)
  is a top-level command that runs `issue list --roadmap` and is not an
  alias, so help, `describe` and the spends reading name one place
  rather than two. It leaves `--state` undeclared and still refuses it:
  `parseArgs` reads an undeclared `--flag` into the context rather than
  refusing it, so the shared run sees it. Its text output is the same
  bytes as `issue list --roadmap`; in json mode only the result events
  match, since the start event names the command as typed.
- **`issue list --roadmap` and `rafa roadmap` print the epics a Roadmap
  names** (`src/board/roadmap-epic-rows.ts`,
  `src/commands/issue/roadmap-epic-table.ts`). The reading is
  `readRoadmapEpicRows`, which asks `readRoadmapRows` for the rows and
  tells the lines whose issue the board listing labels `type:epic` from
  the spec lines over the same one listing, so the command still spends
  one board read. An epic's state counts a member claimed by a plan, an
  open pull request, or a branch weighed by the walk's taken reading
  (`claimsOf`, over `createRoadmapReadings`): a branch whose claim was
  released claims nothing, and weighing a claim branch the remote holds
  costs at most one `git fetch` per command. Epic rows print grouped by
  horizon under `Roadmap #<n> · <horizon>` with the columns `#`,
  `state`, `done/total`, `blocked`, `date` and `title`, the `now` horizon only; `--all` widens to every
  horizon as it widens to the ticked lines, and without it a line counts
  the epics a horizon hides. A Roadmap is a list of epics, so no issue
  row prints beside them: lines naming no epic are counted on one line,
  `Roadmap #<n> · <k> lines name no epic: #13 #14; --full lists them`,
  the first eight named, and `--full` lists them as the issue table
  under `Roadmap #<n> · no epic`. The `Roadmap: #<n>` head is dropped
  since each group names the Roadmap. `--type`, `--module`, `--search` and
  `--limit` narrow the spec rows only; an epic row is chosen by horizon
  alone. Each label problem `readEpicProblems` finds is a `warn` line
  (a `warn` log event in json mode), and the json result gains an
  `epics` key holding `groups`, `hidden`, `unknown` and `problems`.
  A Roadmap naming no epic, with the listing read, prints today's bytes
  and a json result with no `epics` key; a failed listing prints the
  epics `unknown` instead, since no line could be told an epic.
  `--full` (refused without `--roadmap`, as `--all` is) prints each
  shown epic's members under its row, after its disagreement line and
  indented under the `state` column: `#<n>`, the state (`open`,
  `closed`, or `not-planned` for one closed as not planned) and the
  title; then, only for an open member with blockers or under
  `--labels`, a row led by `└→` holding its blockers from a `Blocked
  by:` line that reads `blocked`, grouped by their state on the listing
  as the issue table groups them, and under `--labels` its labels after
  them. A closed member's blockers are history and are not printed.
  Members come in the epic's checklist order, then the rest by number;
  a member's title, then its second row, are cut toward their floors on
  a narrow terminal. It is the one listing that mixes two epics' issues,
  it changes text mode only (json's `epics` already carry every
  member), and a Roadmap naming no epic prints today's bytes with it.
  `--check` (refused without `--roadmap`, as `--all` is) prints what
  the line prints without it, then weighs every `type:epic` issue on
  the listing — not only the Roadmap's, whatever horizon is shown — its
  stored state against its computed one (`epicCheckFailure`,
  `src/commands/issue/roadmap-check.ts`), and exits 1 when one
  disagrees, naming each by the disagreement line the table prints, so
  CI can run it. A failed listing fails the check too, with its reason,
  since nothing was compared. The message is stderr in text mode and
  the terminal error's message in json mode, where the dispatcher
  drops the result's data on a non-zero exit; a check that passes
  changes nothing.
- **`rafa epic show [n]` prints one epic's lines as the Roadmap table**
  (`src/commands/epic/show.ts`). It was the top-level `rafa epics` until
  the `epic` subject was declared, and the registry refuses a top-level
  command spelled as a subject's plural; its lasting alias `epic`, typed
  by the subject or its plural, keeps `rafa epics` and `rafa epics <n>`
  printing what they printed before (`src/tests/epic-show-cli.test.ts`
  compares both against captures the top-level command wrote at
  `b32ebb4`, kept in `src/tests/fixtures/epics-pre-move.json`; never
  re-record them, since that command is gone). Since the table's own
  spelling changed after the move — the labels column left for
  `--labels`, spec and blocked by became symbols — the comparison holds
  the exit code, stderr and every line above the table byte for byte,
  and the rows by issue number and title. `--labels`, `--texts` and
  `--refresh` mean here what they mean on the Roadmap. Its refusals still name `rafa epics [<n>]`. In
  json mode the start event names `epic show`, as it names every
  command by its canonical spelling, and `rafa epics --help` is now the
  `epic` subject's roster. The epic is the `type:epic` issue numbered
  `n`, whatever its horizon and whether the Roadmap names it, or with no
  number the current place's epic (`readCurrentPlace`, as `rafa
  roadmap` reads its board), whatever its horizon and state, reading no
  board body; a place naming a board alone, or no position file, takes
  that board's (else the default board's) first unticked line naming an
  epic that is open,
  carries `horizon:now` alone (`isNowEpic`, the walk's own test) and is
  not computed `done` — the epic `rafa next` walks into. Each line is
  told an epic by the board listing's type, never by reading the issue,
  so the command spends one listing, plus one board read without `n`
  unless the place names its epic. Place notices are `warn` lines, in
  the result's `warnings` too.
  Its lines are `epicLines` (`src/board/epic-walk.ts`), the checklist
  then the open members missing from it by number, the walk's own order,
  read into rows by `readLineRows` (`src/board/roadmap-rows.ts`), the
  line-taking half of `readRoadmapRows`, so the `spec`, `blocked by`,
  `has` and `refs` columns mean what they mean on the Roadmap and ticked
  lines are left out. The seams are `onceSeams` and the claims
  `claimsOf` (`src/board/roadmap-epic-rows.ts`), so the listing, the pull
  request list, the plan dir and the branch scan are each asked once
  (measured: dropping `onceSeams` makes the spawned case count two
  listings). Text mode prints `Epic #<n> · <title> · <state>,
  <done>/<total> done`, the disagreement line indented under it, then
  today's table, or `No issues.`; no issue of another epic is named.
  Each failed reading of the rows and each label problem about this
  epic (its horizon, its checklist, its members, a member carrying a
  second `epic:` label; an orphan label is `rafa roadmap`'s) is a `warn`
  line, a `warn` log event in json mode, whose result is `EpicsResult`.
  In `native` mode (`EpicShowSeams.relations`) the listing is read with
  the native fields, the lines are the epic's open sub-issues in their
  order, the head counts GitHub's `subIssuesSummary` as `rafa roadmap`
  does (`readListedEpics`), the epic has no slug, and only its
  `horizon:` problems are warned.
  A Roadmap naming no open `now` epic that is not done prints one line
  and exits 0; a failed listing prints the epic, or the Roadmap's epics,
  `unknown` with the reason and exits 0; a number the listing holds that
  is no epic, or does not hold, is refused with exit 1; a Roadmap that
  cannot be read, with `ROADMAP_REFUSAL_EXIT`. It declares no flag and
  no `spends`.
- **`rafa epic new "<title>" --slug=<slug> [--horizon=now|next|later]`
  creates one epic whole** (`src/commands/epic/new.ts`): the
  `epic:<slug>` label, the epic issue, and its line on the current board.
  The title is the one argument, one line; `--slug` is required;
  `--horizon` defaults to `later`, so a new epic is not picked unasked.
  Those are refused with exit 1, but the slug's own refusals exit 2
  (`EPIC_NEW_REFUSAL_EXIT`), before `gh` is asked anything or before
  anything is written: a slug that is not a kebab word (`KEBAB_SLUG`,
  lowercase letters and digits joined by single hyphens), and a slug
  ALREADY LABELLED, one any issue on the board listing carries as
  `epic:<slug>`, open or closed, compared without case, the refusal
  naming the issues. A repository label `epic:<slug>` no issue carries is
  kept, not created again, so a rerun after a failed issue create goes
  through; the labels are read with `listBoardLabels`, the first
  `LABEL_LIST_LIMIT`. It reads the board listing once, for the slug check
  and for `resolvePlace` with `defaultBoardOnce` (`src/commands/switch.ts`);
  a listing, label list or default board that cannot be read also exits
  2 with nothing created. The writes then go in order through
  `IssueBoard` (`src/board/issue-board.ts`): `createLabel` when needed,
  then `createIssue` with the body `renderEpicBody` answers
  (`src/board/epic-template.ts`) and the labels `type:epic`,
  `epic:<slug>` and `horizon:<horizon>` in one `gh issue create`; then
  `- [ ] #<n> <title>` appended to the current board with `appendLine`
  and `editChecklist` (`src/board/epic-checklist.ts`), every other byte
  of the board kept. A failed label or issue create exits 1, the second
  naming the label it left; a board line that ends `failed` exits 1 after
  the epic exists, naming it, its URL and the line to add by hand. No
  comment is posted: `src/board/epic-trail.ts` holds none for a new epic.
  Text mode prints the epic with its horizon and label, where its line
  went, and its URL; json mode's result is `EpicNewResult`. All of that
  is the `labels` mode, the default. Under `board.relationships: native`
  (`epicNewMode` reads it off the config, its warnings dropped, `labels`
  for a config `loadConfig` refuses, so a labels line meets its refusals
  in the same order as before) an epic is named by its number and title:
  `readNativeEpicDraft` reads the title and horizon only, `--slug` is not
  required or checked and, when given, draws the warning
  `NATIVE_SLUG_WARNING`; no slug-in-use check, `gh label list` or
  `gh label create` is sent; the issue is created with `type:epic` and
  `horizon:<horizon>` only (`nativeEpicIssueLabels`), a failed create
  naming no label left; the listing read and the board line are the same.
  Text mode names the mode where it named the label, and json's
  `NativeEpicNewResult` carries `relationships: 'native'` with the
  `slug`, `label` and `labelOutcome` keys left out. It declares
  no `spends` and reads no terminal.
- **`rafa epic defer <n> --to=next|later` and `rafa epic promote <n>
  --to=now|next`, each with `[--reason="<why>"]`, move an epic between
  horizons** (`src/commands/epic/defer.ts`, `src/commands/epic/promote.ts`,
  both running `src/commands/epic/horizon-change.ts`). The line is one
  epic number and a required `--to` among the action's two targets,
  refused with exit 1. The board listing is read once
  (`createGhBoardListing`), and `readHorizonChange`
  (`src/board/epic-horizon.ts`) reads the change and the open work off
  it; a listing that cannot be read, an issue that is not an open epic,
  an epic whose standing horizon cannot be read, a target equal to it,
  and a move the other way (a defer has to move later, a promote
  earlier; the refusal names the other command) all exit 2
  (`EPIC_HORIZON_REFUSAL_EXIT`) before any question or write. Questions
  go through a line prompter on stderr, opened on the first and only
  where `isTerminal` (a seam) says stdin is a terminal. The reason is
  `--reason`, else `reasonQuestion` asked once (`readReason`,
  `src/board/epic-trail.ts`); no terminal and no `--reason` changes
  nothing and prints `unaskedReasonMessage`, and a blank reason changes
  nothing and warns `blankReasonMessage`; both exit 0 and json's
  `status` (`unasked`, `blank`, `moved`) tells them apart. A DEFER of an
  epic read `in-progress` whose open members have an open branch or pull
  request names them and asks `keepWorkQuestion`, spelled `[Y/n]`: only
  `n` or `no` closes; no terminal keeps and names the work. A promote
  asks no keep question. Every question comes before the first write.
  The writes: `applyHorizonChange`, one `gh issue edit` swapping the
  `horizon:` labels, then the trail's `Moved <from> → <to>: <reason>`
  comment on the epic (a failed write exits 1, a failed swap posting no
  comment); then, on a no, each open pull request closed through
  `IssueBoard.closePullRequest` (`gh pr close <n> --comment=…`, never
  `--delete-branch`) with `renderParkedPullRequestComment`. No branch is
  deleted and no `git` write is made. A close that fails is a `warn`
  line, the others still close, and the run exits 1 naming those left
  open. Json mode's result is `EpicHorizonResult`. Neither declares
  `spends`.
- **`rafa epic move <issue> --to=<epic> [--reason="<why>"]` moves an
  issue to another epic without recreating it** (`src/commands/epic/move.ts`).
  The line is one issue number and a required `--to`, the target epic's
  number, each a whole number from 1, refused with exit 1. The board
  listing is read once (`createGhBoardListing`); `readEpicMove` reads the
  move off it and refuses with exit 2 (`EPIC_MOVE_REFUSAL_EXIT`), before
  any question or write: an issue not on the listing, an epic, one with
  no `epic:` label or with several, a target that is not an open
  `type:epic` issue or carries no `epic:` label, a target whose slug the
  issue carries already (its own epic), and a slug no epic or several
  own (an epic's slug is its first `epic:` label, as `readEpics` reads
  it; the owner may be closed). A listing that cannot be read also exits
  2. For an OPEN issue it names the open work: branches `branchClaims`
  reads as the issue's (`scanClaimBranches`, named by `branchNameOf`)
  and open pull requests closing it or from such a branch; a failed
  reading is a `warn` line. The reason is `--reason`, else
  `reasonQuestion` asked once where `isTerminal` (a seam) says stdin is
  a terminal; no terminal and no reason prints `unaskedReasonMessage`,
  a blank one warns `blankReasonMessage`, both writing nothing and
  exiting 0. `applyEpicMove` then makes the move through the board's
  relationships port (`BoardRelations.setParent`,
  `src/board/relations/port.ts`) over the listing it read; in `labels`
  mode that is `setLabelsParent` (`src/board/relations/labels-writes.ts`),
  which writes, in order: one `gh issue edit` swapping the `epic:` labels
  (a failure exits 1 and sends nothing else); the line appended to the
  new epic's body, then removed from the old one's, each through
  `editChecklist` (`src/board/epic-checklist.ts`), carrying the old
  line's why and tick (or the title, and ticked for a closed issue, when
  the old body lists none), each answered with its `attempts`. Then the
  trail's `renderMoveComment` on the issue, naming the open work, posted
  once the label moved. No issue is created or closed and no `git` write
  is made. A body edit ending `failed` or a comment that could not be
  posted is a `warn` line, and the run exits 1 naming what to finish by
  hand. Json mode's result is `EpicMoveResult`. With
  `board.relationships: native` (read off the config by
  `src/commands/epic/move-native.ts`, which then reads the board's
  repository with one `gh repo view --json nameWithOwner`), the listing
  is read with the native fields, the epic left is the issue's sub-issue
  parent read through the port's `epicOf` (no parent, a parent that is
  no `type:epic` issue on the listing, and its own parent are refused
  with exit 2, naming the mode), no target is refused for lacking an
  `epic:` label, and the move is one `gh issue edit <n> --parent <epic>`
  with no label or checklist write; the comment is the same, the text
  line naming the mode replaces the two checklist lines, and the json
  result carries `relationships: native` and leaves out `removedLabel`,
  `addedLabel` and the checklist edits. `readEpicMove` and
  `applyEpicMove` are exported for `epic cancel`, whose move of a
  dependent is the same `labels` move, made through the `labels`
  adapter. It declares no `spends`.
- **`rafa epic close <n> [--accept-unchecked]` is the closing gate**
  (`src/commands/epic/close.ts`), and the one `epic` action declaring
  `spends`: `{ when: 'always', what: 'one verification planning session
  and one session per check' }`. The line is one epic number, a whole
  number from 1, and the flag, which takes no value; anything else is
  exit 1. Every refusal of the gate is exit 2
  (`EPIC_CLOSE_REFUSAL_EXIT`) and leaves the epic open. The board
  listing is read once; `readEpicToClose` refuses an issue not on it,
  one not `type:epic`, a closed epic, one with no `epic:` label, one
  with no member, and one with an OPEN member, naming each open member
  by number and title, before any session starts. Membership is the
  `epic:<slug>` label (`groupByEpicLabel`); in `native` mode
  (`EpicCloseSeams.relations`) it is the epic's sub-issues, no label is
  read or named, and an epic with a sub-issue off the listing is refused
  while GitHub's `subIssuesSummary` counts any not completed. An epic
  whose body has no acceptance criteria is refused with no session.
  Then ONE captured
  planning session, in the project root with `--tools Read,Grep,Glob`,
  answers a check or an uncheckable reason per criterion
  (`src/epic/verify-plan.ts`); when every criterion is still the
  template's placeholder no session starts and each is uncheckable. A
  planning session that exits non-zero or ends with no readable
  `rafa:verify` block is refused, running no check. Each uncheckable
  criterion is a `warn` line with its reason, and any refuses the close
  BEFORE a check runs unless `--accept-unchecked`. The checks then run
  through `runVerification` (`src/epic/verify-run.ts`): a detached
  worktree of `origin/main` under `<home>/.rafa/worktrees/epic-<n>`, one
  session per check, the worktree removed after; a git step it refuses
  is exit 1, and a removal it refuses a `warn` line. Each check that
  answered `fail` is filed through `triageReport` as one report holding
  one `security: false` bug and no blocker, its artifact the epic and the
  criterion on one line (`failedCheckArtifact`) and its key's file half
  `epic-<n>-close` (`closeTriageFile`, a name only: nothing is written
  there), so a second failing close comments on the first issue, or files
  one in its place when the first was closed as completed; the
  public tracker is resolved once, and only when a check failed. A failed
  check, and a check whose session answered nothing, which files
  nothing, each refuse the close. Otherwise one `IssueBoard.closeIssue`
  closes the epic as `completed` with `renderCloseComment`
  (`src/board/epic-trail.ts`), a refusal from `gh` being exit 1, and
  `renderEpicCost` prints the members' cost beside the body's estimate
  with the membership line (`src/effort/epic-cost.ts`); a store that
  cannot be read is a `warn` line after the close. Every line goes
  through the output in both modes; json mode's result on a close is
  `EpicCloseResult`. Git, `gh`, the spawner, the store and the tracker
  chain are `EpicCloseSeams`.
- **`rafa epic cancel <n> [--reason="<why>"]` cancels an epic, asking
  about each issue its open members block** (`src/commands/epic/cancel.ts`).
  The line is one epic number, a whole number from 1, and an optional
  `--reason` for the epic's comment; anything else is exit 1. The board
  listing is read once; `readEpicToCancel` refuses with exit 2
  (`EPIC_CANCEL_REFUSAL_EXIT`) an issue not on it, one not `type:epic`
  and an epic closed as completed, as it does a listing that cannot be
  read. An epic closed as NOT PLANNED already is not refused: its close
  is skipped and its dependents are asked about. The dependents are
  `readEpicDependents`'s (`src/board/epic-dependents.ts`), listed one a
  line with the members each waits on; an unreadable line naming a
  member is a `warn` line and is not asked about. Where `isTerminal` (a
  seam) says stdin is a terminal, each is asked `dependentQuestion` in
  turn on a line prompter: `m`/`move`, `u`/`unblock` or `c`/`cancel`,
  anything else told `CHOICE_HINT` and asked again. A move asks
  `targetQuestion` and reads the move with `readEpicMove`, saying a
  refusal, or the epic being cancelled, and asking again. Every answer
  is taken before any write, so an input that ends early writes nothing
  (`endedCancelMessage`, exit 0). With no terminal and a dependent, the
  list and `unaskedCancelMessage` are printed and nothing is written,
  exit 0; with no dependent there is nothing to ask and the cancel goes
  ahead. The writes, dependent by dependent, then the epic: a move is
  `applyEpicMove` with `cancelMoveReason`; an unblock appends
  `renderUnblockNote` below the body through `editChecklist` and
  `appendNote` (every other byte kept, the body's own line break), takes
  `spec:blocked` off when the dependent carries it and nothing its line
  still names is open or on another repository, and comments
  `renderDependentComment('unblocked')`; a cancel is one `closeIssue`
  as `not planned` with `renderDependentComment('cancelled')`. The epic
  is then closed as `not planned` with `renderCancelComment`, listing
  each dependent whose own write landed; one closed so already gets that
  comment only when a dependent was answered. A failed write is a
  `warn` line, the run goes on, and it exits 1 naming what to finish by
  hand. The epic's members are not touched. An answered dependent's
  `Blocked by:` line still names the member, and `readBlockedBy` reads
  that first line and not the note, so `readEpicDependents` keeps
  listing a moved or unblocked dependent. Json mode's result is
  `EpicCancelResult`. It declares no `spends`. In `native` mode
  (`EpicCancelSeams.relations`) the dependents are the open issues with a
  `blockedBy` link to one of the epic's open sub-issues, and an unblock
  clears nothing: it writes the note and the comment, takes no label off
  and removes no link, printing `keptLinksLine`
  (`src/commands/epic/cancel-unblock.ts`).
- **An epic closed as not planned is noticed by `rafa epic show`,
  `rafa roadmap` and `rafa next`** (`src/board/epic-cancel-notice.ts`),
  each over the board listing it already reads, so the notice sends no
  `gh` command of its own. `cancelledEpicNoticeLines` answers one `warn`
  line per `type:epic` issue closed as `NOT_PLANNED` whose
  `readEpicDependents` list, less each dependent whose body carries that
  epic's unblock note (`carriesUnblockNote`, `src/board/epic-trail.ts`),
  is not empty, naming them and `rafa epic cancel <n>`; a closed
  dependent is gone from the list already. A MOVED dependent is still
  named while its line names an open member, since nothing on the
  listing says which cancel it was answered for. `epic show` warns the
  lines last, in its result's `warnings` too, whichever epic it shows,
  in `labels` mode only;
  `rafa roadmap` (`issue list --roadmap`) carries them last in
  `readRoadmapEpicRows`' warnings, epic lines or none; `rafa next`
  carries them as board problems only when the walk or the place read
  the listing (`NextBoardOptions.noticeCancelled`, which `rafa status`
  leaves off). A board with no such epic, or a failed listing, writes
  no line, so a project that never cancels an epic prints what it
  printed before.
- **`rafa switch <n | -> [--no-rehome]` moves this checkout's place**
  (`src/commands/switch.ts`) and writes it to `.rafa/position.json`
  through `writePositionFile` (`src/project/position.ts`). It reads the
  board listing once, `createGhBoardListing` with every issue open and
  closed, and ranks the default board (`resolveDefaultBoard`) over that
  listing's open `type:roadmap` rows rather than a second
  `gh issue list --label`, asking it at most once and only when an
  answer needs it. The number is told a board or an epic by the
  listing's labels: `type:roadmap` is a board, else a row typed `epic`
  is an epic, else the default board (an unlabelled titled "Roadmap", or
  `roadmap.issue`, even one the listing does not hold) is a board. A
  board moves to its first `now` epic that is not done (`firstNowEpic`
  in `src/board/now-epic.ts`, null when none); an epic moves with the
  board whose checklist lists it, the current board first, then the
  default, then the lowest-numbered open board, else the default. `-`
  moves to the position's `previous`, checked as a number is. The move
  starts from
  the place `resolvePlace` (`src/board/place.ts`) answers, so with no
  file the first switch's `previous` is the fallback place and
  `rafa switch -` goes back there; every notice but the absent-file one
  is a `warn` line. A switch re-homes (`rehome`); `--no-rehome` keeps
  home (`hop`), and `-` re-homes too unless it is typed. Text mode
  prints `board #<b> · epic #<e> <title> (<horizon>) · <done>/<total>
  done`, or `board #<b> · no epic`; the `· next #<n>` the spec's status
  line ends with is not printed, since naming the next issue needs the
  claims the walk reads. Json mode's result is `SwitchResult`. A number
  that is no open board or epic, a closed one, `-` with no previous place
  or one that no longer stands, and a board listing, a `native` board's
  repository or a default board that cannot be read are refused with
  exit code 2 and write nothing; a line
  naming no target, an unusable config and a file that cannot be written,
  with 1. It declares no `spends`.
- **`rafa board list` lists the open boards**
  (`src/commands/board/list.ts`), the first action of the `board` subject.
  It reads the board listing once, as `switch` does, and ranks the
  default board over that listing through `defaultBoardOnce`, which it imports from
  `src/commands/switch.ts`, and `openBoards`, from
  `src/board/epic-board.ts`. The
  boards are the listing's open `type:roadmap` rows, lowest first, plus
  the default board when it is open on the listing without the label (an
  issue titled "Roadmap" while nothing is labelled, or `roadmap.issue`),
  so a project that never labelled a board lists its one Roadmap. A line
  is `#<n> <title> · <owner> · <count> epics`, then `· current` and
  `· home`. The owner is the `Owner:` line `readBoardBody` reads, asked
  of GitHub through one `createOwnerResolver` for the whole command, so
  a handle two boards name (in any case) is asked once: bare when it
  resolves, followed by `(unresolved)` on a 404 and `(unknown)` when it
  could not be asked, the last with a `warn` line naming why; a missing
  or malformed line reads `no owner`. The epic count is the distinct
  issues the checklist names that the listing types `epic`, a spec line
  left out. `current` and `home` are the boards of the places
  `resolvePlace` answers, so with no position file both mark the
  default; its notices are `warn` lines as `switch` prints them, the
  absent-file one left out. Json mode's result is `BoardListResult`: the
  rows, each owner with its `OwnerResolution`, and the two places. A
  board listing or default board that cannot be read, a project with no
  board at all among them, is refused with exit code 2; a stray word and
  an unusable config, with 1. An owner that does not resolve is a
  column, not a failure. It declares no `spends`.
- **`rafa board sync [--dry-run]` brings the GitHub project in step**
  (`src/commands/board/sync.ts` over `syncProject`,
  `src/board/project/sync.ts`). One refresh widened by `everyItem` and
  `openIssues` (`RefreshWidening`, `src/board/project/refresh.ts`)
  refreshes every item of the repository on the project and answers the
  open issues with no item; each is then added and a second refresh fills
  it. A line per change, `#<n> <field>: <from> → <to>` with `(empty)` for
  no value, a line per issue added, then a closing count, which counts
  the issues added and those of them filled apart (`2 issues added and
  filled`, or `2 issues added, 1 filled` with a `#<n> added but not
  filled: <reason>` warning for the other) and ends
  `; <n> issue(s) not refreshed` when issues were refused and never reads
  `in step` then. `--dry-run`
  sets the refresh's `dryRun`: the same lines, no write and no add. Json
  mode's result is `BoardSyncResult`, the changes without their write
  ids, the issues added and filled as `added` and `filled`, and the
  refused issues as `refused` (`issue`, `reason`). Exit code 1
  for a stray word, an unusable config and an unset
  `board.project.number`, which names `rafa init --board --project`; 2 for
  a missing `project` scope, a number naming no project, a rate-limit
  refusal (after the lines of what was read) and any `gh` failure outside
  one issue's facts. A field the project holds otherwise than the
  template is a `warn` line, exit 0. So is an issue whose facts could not
  be read, in either pass: `#<n> not refreshed: <reason>`, the other
  issues synced and the missing ones added, so a run whose only failures
  are refused issues exits 0 and the next run reads them again. It
  declares no `spends`.
- **`loop stop`, `pause`, `resume`, `status` and `list` reach a run
  through its session record** (`src/commands/loop/`). `--session-id=<id>`,
  aliased `-s`, names a record. Without it the session is the one reading
  `running` or `paused` on the branch checked out at the project root, as
  git reads it there, and `status` alone falls back on the newest record of
  that branch (`loop/loop-sessions.ts`). `stop` sends SIGINT to the
  record's pid; `loop start` passes it on to its running Claude session
  (`utils/claude.ts`) and marks that task `[BLOCKED]`. `stop` then waits up
  to 30 seconds for the record to read `stopped` or `done` and names what
  the tracker holds at the task's line; a run still going then is warned
  about, exit code 0. `pause` writes `paused` and nothing else, and the
  loop holds between tasks while its record reads so (`start/pause.ts`);
  `resume` writes `running`. Each moves a record only from the state it
  read (`onlyFrom`, `loop/sessions.ts`), and leaves a record already where
  it would put it unchanged, exit code 0. `status` counts the plan's tasks
  from its tracker and gives a live session a rough ETA from the store's
  `done` finishes since the session started
  (`effort/store/task-finishes.ts`). `list` lists every live record and
  reads no branch; a row names each session's branch and end with the
  `worktree` column (`src/commands/loop/loop-sessions.ts`): the path to the
  worktree if the run was started with `--as-worktree` (`start/session.ts`),
  or `in the main checkout` if the checkout is the project root. In json mode each gives its reading as the result's
  `data`; text mode writes lines.
- **Type `--tracker` after the stub.** `parseArgs` gives a flag the next
  word as its value unless that word opens with `-`, whatever type the
  flag declares, so `rafa plan show --tracker my-plan` hands `plan show`
  no stub. The command reads `true` and `false` as the values of the flag
  and refuses any other with exit code 1, naming the order that works.
- **A wrapped command declares exactly the flags its phase 0 module
  reads**, plus the wrapper's own, as the line types them.
  `src/commands/index.test.ts` holds each list equal to the quoted `--`
  literals of the modules its `READERS` entry names, so a flag added to a
  wrapped command such as `effort collect` moves that entry (adding the
  module that compares the new flag when it is a new one) and never
  `OWN_DECLARATIONS`, which holds only the commands wrapping no phase 0
  command; a spelling in both lists or in neither is red. This replaces
  nothing. The list is equal to those literals with one flag held apart and
  named: `hint`, which `plan create` and `loop start` declare and no
  phase 0 parser reads, since `endingWith` (`src/next/ending.ts`) reads
  it off the parsed context once the phase 0 function has returned. A
  wrapped command's `outputs` is `['text']` until it writes through the
  active output, and each now declares `text` and `json`, as
  `describe` does. `module list` declares neither a flag nor an argument, and `module exec` the arguments `module` and `action`, neither required, and no flag, each with `text` and `json`. `agent vendor` declares the argument `name`, required and read as one or more words, and the flag `force`, `agent list` and `skill list` no argument and the flags `source` (aliased `tier`), `state`, `hidden-from-loop` and `interactive` (aliased `i`), `agent show` and `skill show` the argument `name`, required, and the flag `full`, and `agent search` and `skill search` each the argument `question`, required, and the flags `all` and `model`, the latter defaulting to true and so spelled `--no-model`, each with `text` and `json`. `describe` declares no flag, `init` the flags `root`, `yes` and `board` and no argument, `doctor` the flags `plan` and `deep` and no argument, and `self-update` the flag `force` and no argument, each with `text` and `json`. `loop stop`, `loop pause`, `loop resume` and `loop status` each declare the flag `session-id`, aliased `s`, `loop list` no flag, and `loop wait` the flags `session-id`, aliased `s`, `until` and `timeout`, none of the six an argument, each with `text` and `json`. Of the plan readers,
  `plan show` declares the argument `stub` and the flag `tracker`,
  `plan validate` the argument `file`, `plan risk` the argument `plan`
  and the flag `strict`, `plan needs` the argument `plan` and the flags
  `spec`, `issue`, `missing` and `source`, and `plan list` no argument
  and the flag `open`; each
  declares `text` and `json`. `plan create` declares the flags `spec`,
  `issue`, `next`, `roadmap`, `claim-ahead`, `refresh`, `dry-run`, `skip-review`, `accept-refs`,
  `comment`, `stub`, `progress` and `hint`, three of them mutually exclusive (`spec`, `issue`
  and `next`), each with `text` and `json`. Of the `issue` actions, `list` declares the
  flags `roadmap`, `all`, `full`, `check`, `state`, `type`, `module`, `search` and `limit`,
  `show` the argument `id`, `create` the flags `title`, `body`, `body-file`, `type`,
  `module` and `priority`, `comment` the argument `id` and the flag `body`,
  and `move` the arguments `id` and `state`; each declares `text` and
  `json`. `roadmap` is also a top-level command that runs `list` with
  `--roadmap` set. Of the `pr` actions, `pr current` and `pr list`
  declare no argument and no flag, each with `text` and `json`. `pr show` and `pr view`
  declare the argument `n` and no flag. `pr merge`
  declares the argument `n` and the flags `yes`, `skip-checks`, `method` and `hint`, and
  `pr triage` the argument `n` and the flags `comment`, `resolve`,
  `max-attempts` and `hint`; each declares `text` and `json`.
- **How they refuse**: each wrapped command throws `CommandExit` with the
  whole refusal as its message, so text mode writes it to stderr as the
  phase 0 command printed it and json mode carries it in the terminal
  result. `loop start` throws exit code 1 for a line asking for
  `-d|--detached`, before anything else is read (`start/run-config.ts`);
  then, in the same module, while `RAFA_EFFORT_DIR` is set to anything but
  the empty string: `❌ RAFA_EFFORT_DIR is set (<dir>); a loop records to
  the project's own store. Unset it and run again.`, ahead of `--runtime`
  so no runtime is handed a run bound for a copy;
  then, before anything else is read, for a `--runtime` with no value, a
  version with no `cli.js` under `~/.rafa/runtime/`, a path that is neither
  a file nor a directory holding `cli.js`, a runtime inside the `src/` of
  the working directory or of the project root, as typed or with its links
  resolved (`start/runtime.ts`), and, in the command before `start` runs, a
  `--runtime` typed ahead of the subject; then for an unusable config, a plan
  file that does not exist, a default branch, a session record refusing
  the run, session records that cannot be read or written, and a
  preflight that halts before any session: an `effort.sync` naming a
  kind no adapter serves, checked first and worded as `rafa doctor`'s
  `effort sync` row words it (`start/preflight-sync.ts`), an `agent=` of a still-to-run
  task that no scope `loop.settingSources` loads defines, checked ahead
  of every probe, a claim on the issue the plan's stub names that this
  device does not own, named with its owner, or that it left unpushed on
  the local `feat/<stub>` and cannot push, also checked ahead of every
  probe (`start/preflight-claim.ts`): it reads the claim on the branch from
  `origin`, retries its push if held unpushed locally, and refuses the run
  naming the owner when another store holds the claim or when the push still
  fails (a "claim lost" halt), so no two devices work the same issue; a
  failed required prerequisite — the two automatic items a `gh` pull request
  provider contributes, `gh` on `PATH` and `gh auth status` for `origin`'s
  host, checked ahead of the configured tiers, and the plan's `[start]`
  items, checked between the two on a first dispatch and named in one line
  each on a resume (`src/preflight/first-dispatch.ts`), included — a
  PREREQUISITES file that cannot be read, or checks the store refused
  (`start/preflight.ts`). A record of the plan refuses the
  run when it names another branch, whatever its state, or names this
  branch and reads `running` or `paused`, a pid that is gone reading
  `stopped` (`start/session.ts`, `loop/sessions.ts`). `plan create` throws 1
  for an unusable config, none of `--spec`, `--issue` and `--next` named, a
  spec found neither against the project root nor under `specs.dir`, a plan
  already there, and for a planner's rejection the exit code a `claude`
  planner's rejection carries, or 1; 2 for an issue author without write
  access to the repository, an issue without `spec:ready`, and an issue
  whose body matches a home path or a token shape; and 3 for a spec the
  planner's own review judged not ready, whatever the rejection would have
  carried. `effort collect` and
  `effort report` throw 1 for an unrecognised argument and an unusable
  config, one line per problem; `effort report` also throws 1 for
  `--plan=` without `--skills`, and for `--kind` or `--entrypoint` beside
  it. An interrupted task throws
  `CommandExit(0)` once it is marked and its report stored; a failed,
  blocked or unstored task still returns, and ends with exit code 0.
  The plan readers throw 1 for a line handing them the wrong number of
  arguments, `plan show` also for a stub no plan stamp can carry, a stub
  naming no plan or no tracker and a `--tracker` value other than `true`
  or `false`, and `plan validate` also for a path that is no file, for
  a plan with an issue, for a plan naming an agent no loaded tier
  serves, and for a config `loadConfig` refuses. `plan needs` also
  throws 1 under `--missing` when a need is unmet, and whatever
  `resolveCreateSpec` throws for `--spec` and `--issue`, 2 for the
  board's own state included. `init` throws 1 for a positional word, a `--yes`
  value other than `true` or `false`, a `--root` with no path, a refused
  root, no terminal with neither flag given, input ending before a root
  is chosen, a path the scopes cannot be written at, a config
  `loadConfig` refuses and a `.gitignore` it cannot place its block in,
  each message ending with the line `Nothing was written.`
  `doctor` throws 1 for a positional word, a `--plan` holding no file, a
  `--deep` holding a value, a plan named that is no file, a plan path that cannot be checked, a
  config `loadConfig` refuses and a
  PREREQUISITES file that cannot be read, each message ending with the
  line `Nothing was checked.`, and for a failed required item, its message the runner's halt.
  `self-update` throws 1 for a positional word, for a `--force` value
  other than `true` or `false`, for a live loop of the project without
  `dangerous.selfUpdateDuringLoop`, naming each loop's branch and pid, for a tracker in `plan.dir` holding a
  task, naming each, and for a `~/.rafa/runtime/<version>/` already there
  without `--force`, naming it and the version; and 2, the message naming the
  step and what it leaves changed, for a session record under `.rafa/runs/`
  that cannot be read, for a `package.json` that cannot be
  read or names another package or no usable version, a config
  `loadConfig` refuses, a `plan.dir` that cannot be read, and a build,
  copy or link that failed.
  The `issue` actions throw 1, before any config is read, for a line
  handing the wrong number of arguments, a flag typed with no value,
  holding nothing but whitespace where it takes text or a value outside
  its set, a `--limit` that is no positive whole number, a `create` with
  no `--title` and a `comment` with no `--body`; then for a config
  `loadConfig` refuses, a chain landing nowhere, and an adapter call
  that rejects, naming what was being done and the tracker's kind.
  The `loop` session actions throw 1, before any record is read, for an
  argument and for a `--session-id` with no value or naming no record
  file; then for records that cannot be read, an id no record has, a
  branch that cannot be read, no live session on the branch or two of
  them, and a record whose state changed between the read and the write.
  `stop`, `pause` and `resume` also throw 1 for a session reading
  `stopped` or `done`, and `stop` for a signal refused for any reason but
  the pid being gone.
  The `pr` actions throw 2 when `pr.provider` is not `gh`. `pr current`,
  `pr show` and `pr view` throw 1 for a stray word, a config that cannot
  be used, a branch that cannot be read, a detached HEAD, and a branch
  with no open pull request. `pr list` throws 1 for a stray word, a config
  that cannot be used, and an adapter call that rejects. `pr merge` throws
  1 for a second word, a word that is no whole number from 1, a flag that
  swallowed the number, a config that cannot be used, a branch that cannot
  be read, a detached HEAD, a branch with no open pull request, a `--method`
  that is none of the three GitHub merge methods, a number the repository
  has no pull request for, a git reading that failed, each of the four
  merge refusals (dirty tree, not green, not mergeable, branch in another
  worktree), `--skip-checks` on a pull request that reports checks, no
  terminal to ask on without `--yes`, `--yes` beside `--skip-checks` where
  workflows exist or their count could not be read, a provider that would
  not merge, and a clean-up step that failed. `pr triage` throws 1 for a
  stray word, a word that is no whole number from 1, a flag that swallowed
  the number, a config that cannot be used, a `--max-attempts` that is no
  whole number from 1, `--resolve` beside `--no-comment`, a number the
  repository has no pull request for, and a provider call that rejected; 2
  for more than one red candidate with `--resolve`, a cross-repository pull
  request with `--resolve`, and a pull request whose author is neither
  trusted nor a known dependency-bump bot with `--resolve`; and 3 when the
  attempt guard gives up, and when a `conflict-version` conversion or its
  push is refused.
- **What changed for a phase 0 spelling**: `rafa effort` alone and
  `rafa effort help` refuse with exit code 1, where the phase 0 CLI
  printed its help and exited 0. An unknown first word writes
  `rafa: unknown subject or command "<word>"` and no help.
  `rafa start --help` answers help, where phase 0 handed `--help` to
  `start`, which ignored it and ran the loop. `rafa effort report --json`
  writes one deprecation line and runs in json mode, where phase 0
  printed the report as indented JSON with no event around it.

### Commands

- **A command is routed by `subject` and `action`.** One whose action is
  its subject is top-level, reached by its one word: `status` is subject
  `status` and action `status`. `name` routes nothing.
- **`run` takes a `RafaContext`**: `CliContext` plus `argv`, the words
  after the last routing word as typed, for a phase 0 command to hand to
  its own parser. `args` and `flags` are the rest of the line read
  against the command's `args` and `flags`, with flags typed ahead of
  the subject included. `registry` is the registry the line was routed
  through, each module mounted for the invocation included. `project` is
  the project the dispatcher resolved for the command, as `resolveScope`
  answers it (`src/project/scope.ts`), or null for a command declaring
  `needsProject: false`.
- **A command runs inside a project** unless it declares
  `needsProject: false`, as `module exec`, `skill check`, `instinct check`,
  `init` and `describe` do; the dispatcher
  resolves none for such a command. `commandProblem` refuses a
  `needsProject` that is no boolean.
- **A command refuses by throwing `CommandExit(code, message)`.** It
  calls no `process.exit`. The dispatcher never reads `process.exitCode`,
  so a command that sets it and returns ends as a success.
- **`hidden` keeps an action out of every roster and every refusal's
  list of actions**, and it still dispatches.

### Routing

- **The routing words are the words not opening with `-`, up to a
  `--`.** A flag never takes a routing word as its value, so
  `rafa -v loop start` routes `loop start`. Ahead of the last routing
  word a flag's value is joined with `=`: `rafa --output json loop start`
  refuses `json` as a subject.
- **A subject is also reached by its plural**, the name plus `s`.
- **The longest spelling wins** among a subject and one of its actions,
  a top-level command, and an alias. On equal length the subject action
  wins, then the top-level command.
- **An alias spelled as a subject**, as `plan` is for `plan create`,
  catches every line under that subject whose next word is no action of
  it, the bare subject included, typed by the subject's name or by its
  plural: `rafa plans --spec=<file>` runs `plan create`, and
  `rafa epics 252` runs `epic show` through `epic`. An alias declared as
  the plural itself wins over that plural reading of another.
- **A lasting alias**, one a command lists in `lastingAliases` as well
  as in `aliases`, routes as any alias does but leaves the route's
  `alias` null, so it writes no deprecation line: `epic` for
  `epic show` is the one. The others are kept for one release.
- **Help**: no routing word, a first word `help`, or `--help` or `-h`
  before a `--`. A subject alone asks for its roster before an alias
  spelled as that subject is tried.
- **The version**: `--version` before a `--`, read ahead of every other
  rule. It is typed alone: beside a routing word, `rafa loop --version`
  included, it is the `unexpected_version` refusal. There is no short
  form, since `-v` is the verbosity and `-V` is not read.
- **An action declaring `exec` reads on**: `<module> <action>` routes to
  the command mounted under `module/<module>`. With no module word, the
  `exec` action runs itself. A mounted command's own subject and aliases
  route nothing.
- **The refusal codes** are `unknown_subject`, `missing_action`,
  `unknown_action`, `unknown_module` and `unexpected_version`.

### The registry

It is built from code, so a collision throws when it is built — and
because it builds silently when nothing collides, a clean build is no
evidence the check ran. To prove one absent, force one: register a
deliberately colliding subject and read the named refusal it throws
(`command registry: subject "releases" is spelled as the plural of
subject "release"`). It refuses `help` as a subject, as a top-level command and as an alias's
first word. It also refuses a subject, command or alias declared twice,
a subject spelled as another's plural, and a top-level command spelled
as a subject. So is an alias spelled as a top-level command or as a
subject and one of its actions, and a lasting alias a command does not
also list in `aliases`. `mount` answers a new registry and
leaves the old one unchanged. Help and `describe` read this registry,
never a second one: `describe` through `RafaContext.registry`, which
holds the invocation's mounts.

### Module command entries

`loadModuleCommands` imports each `{ name, entry }`: an absolute file
whose default export is `RafaCommand[]`. It mounts that list under
`module/<name>`. The unit is the file. The file is skipped when importing
it throws (a syntax error included), when its default export is no list,
or when the registry refuses the mount. A skipped file gets one warning,
`module "<name>": skipped "<file>": <reason>`, and the entries after it
still load. The dispatcher writes each warning at warn level after the
start event. `src/rafa.ts` passes the entries `src/modules/load.ts`
answers, described under "Loading modules".

### Loading modules

`src/rafa.ts` calls `loadInvocationModules` before it dispatches, with
`process.cwd()` and the home. It resolves the project as the dispatcher
does, reads its config with the unknown-key warnings dropped, since a
command reading the config warns once, and hands `loadModules` the
config's `modules:` and `allowList:`. Outside a project nothing is loaded
or warned, and a config `loadConfig` refuses or a walk the scope refuses
loads nothing and warns nothing: the command reading the config, or the
dispatcher placing a command in a project, says why once. So
`rafa describe` and help under a refused config list no module action and
say nothing of why.

- **A source's name** is its `package.json` `name` for `path`, the package
  for `npm`, and `owner/repo` for `github`; `allowList:` matches it. A
  relative `path` resolves against the project root, or the home when the
  user scope's config gave `modules:`.
- **`npm` and `github` are refused** by name,
  `npm source "<name>" is refused: phase 1 loads path sources alone, ...`.
- **Every `path` source is validated**, enabled or not, with
  `validateManifest` (`src/modules/manifest.ts`). An enabled one with no
  problem has each `tracker`, `store`, `planner`, `output` and `sync`
  entry imported, its default export the adapter's `create`, registered
  under the manifest's `kind` and `requires.ports` version on
  `CORE_ADAPTER_REGISTRY`, and its `commands` entry handed to
  `loadModuleCommands`. An entry outside the module directory, an import
  that throws, a default export that is no function and a registry refusal
  (a kind already held, a port version core does not serve) refuse the
  module whole: none of its adapters and no command entry.
- **States**: `loaded`, `refused`, or `disabled` off `allowList:`. Each
  problem of an enabled module is one warning,
  `module "<name>": <problem>`, where a problem read off the manifest
  opens with the absolute `<directory>/package.json` path (`readPathSource`
  in `src/modules/load.ts`), written after the start event ahead of the
  command-entry warnings (`DispatchOptions.warnings`); a disabled module
  warns nothing. A second source giving a name is refused, and an
  `allowList:` name no source gives is warned about.
- **The adapter registry reaches no reader.** `resolveTracker`,
  `selectEffortStore` and `rafa plan` still resolve through
  `CORE_ADAPTER_REGISTRY`, so a module's adapter is registered and listed
  by `module list` and selected by nothing.
- **`module list`** loads the modules again from the config and lists
  each source's name, version, types, whether it is enabled, its state,
  adapters, command entry and problems, with `mounted` read off the
  context's registry. Exit code 1 for an argument and a refused config.
- **`module exec`** declares `exec` and `needsProject: false`. Typed with
  no module word it refuses with exit code 1, naming each mount and its
  actions, or that none is mounted.

### One invocation

`dispatch(argv, { registry })` answers `{ exitCode, result }` and sets
no exit code: its caller ends the process. The streams, the environment,
the clock, the importer, the help renderer, the working directory, the
home, the warnings read before the invocation and the command hook
(`commandHook`, called around a command that runs inside a project in
text mode; see `src/cli/dispatch.ts`'s module note) are options.

- **A command runs inside a project, or not at all.** Once the spec of a
  command needing a project is read, `resolveScope` walks up from the
  working directory, `process.cwd()` unless the `cwd` option names
  another, to the nearest `.rafa/config.yaml`, passing over the home,
  `homedir()` unless `home` names another. The walk stops at the top
  level of the git working tree holding the working directory, the first
  directory with a `.git`. When it finds none up to there, the main
  checkout of the repository is the project if it holds
  `.rafa/config.yaml`, so a linked worktree beside it, which has no
  `.rafa/` of its own, runs in the main checkout's project even under a
  parent folder holding its own `.rafa/config.yaml`; only then does the
  walk go on above the top level. The project found is the context's
  `project`. With none, the invocation ends as `no_project`
  with exit code 1: `rafa: ` and the `rafa init` hint on stderr in text
  mode, the hint as the result's message in json mode. The command never
  runs, so it prints no deprecation line. A relative working directory or
  home, and a git that cannot name the main checkout, end the same way
  with the walk's message. A help request, a
  routing refusal, `invalid_spec` and a command declaring
  `needsProject: false` read neither the working directory nor the home.

- **json mode writes one `start` event first and one terminal `result`
  last**, every line NDJSON. Text mode writes neither event. A failure's
  message goes to stderr, a `CommandExit` message as the command gave
  it and anything else as `rafa: <message>`. A result a command gave is
  written as the `text` adapter writes one.
- **events mode is given only to a command declaring `events` among its
  outputs**, which today is `loop start` alone; any other command reads
  `--output=events` or `RAFA_OUTPUT=events` as text
  (`assembleContext`'s `eventsAllowed`). Its adapter
  (`src/adapters/output/events.ts`) prints one `rafa· ` line per named
  `event` and one per error, and nothing else; a session's stdout goes
  to `info` there, so it never reaches the screen. The loop's events are
  `src/start/loop-events.ts`'s, and `context/operators.md` lists their
  line shapes.
- **The context's output** passes lines and `step`, `log` and named
  `event` events through; text drops a named event, json writes it. It holds `result(payload)` for the terminal event, and refuses
  a second result and any `start` or `result` handed to `emit`. A refusal
  there ends the command as `command_error`.
- **While a command runs, its context's output is the active output**
  (`src/adapters/output/active.ts`), set in the invocation's output mode,
  which `activeOutputMode()` answers. The output and the mode active
  before are put back afterwards, when the command throws too.
- **An alias but a lasting one, or a command declaring `deprecated`,
  writes one line to stderr** before it runs, in either mode:
  `rafa: "rafa start" is deprecated; use "rafa loop start"`. A help
  request writes none, nor does a command refused outside a project.
- **A flag declaring `deprecated` is read as its `use`** when typed bare
  ahead of a `--`, as `--<name>` or `-<name>` or as one of its aliases:
  the words of `use` take its place in the line the context is assembled
  from, and `argv` keeps it as typed. It writes one line to stderr after
  the command's own, however often it is typed:
  `rafa: "rafa effort report --json" is deprecated; use "rafa effort report --output=json"`.
  `effort report`'s `--json` is the one such flag, so it runs in json
  mode. `deprecated` sits on `RafaFlagSpec` (`src/cli/command.ts`), not
  on the copied `FlagSpec`, and `commandProblem` refuses one naming no
  `use`.
- **The result error codes** are the five routing refusals, `invalid_spec` (a
  spec `parseArgs` refuses), `no_project` (a command run outside a
  project), `command_exit`, `command_error` and `result_unwritable`.
- **Help is text only.** `renderUsage`, one usage line per level, renders
  it for a caller naming no renderer; `src/rafa.ts` hands in `renderHelp`.
- **So is the version.** A version route writes `rafa <version>`
  (`src/cli/version.ts`) to stdout and ends 0; json mode writes its two
  events and no text, where `rafa describe` gives the same version as
  data.

### The spends declaration

A command that can start a Claude session declares it with a `spends` field
of type `CommandSpend` (`src/cli/spends.ts`). The declaration has four forms,
each named by `when` and carrying `what`, a short phrase describing what the
session does:

- `always`: the command may start a session on any run (`plan create`,
  `loop start`, `epic close`).
- `with`: the command may start a session only when a specific `flag` is
  typed on the run (`pr triage --resolve`). `flag` is written as typed,
  with its two leading dashes. `pr triage` itself never spawns: its
  `--resolve` shells out to a child `rafa loop start`
  (`resolve-loop.ts`), whose own dispatcher records `loop start`, so the
  guard checks triage's `with` only against a planted stand-in
  (`src/tests/spend-guard-dispatch.test.ts`), never a production path.
- `unless`: the command may start a session on any run except one carrying
  a specific `flag`. That flag is written as typed, with its two leading
  dashes.
- `through`: the command starts no session itself, but runs another command
  in-process whose own `spends` may apply (`rafa next`, whose actions
  `sync`, `resume`, `merge`, `plan`, `start` may start a session).

A command without a `spends` declaration declares nothing.

The spend guard in `src/utils/claude.ts` refuses to start a session for a
running command when its `spends` declaration does not cover the run. The
running command is the one the dispatcher recorded with its parsed flags
(`src/cli/running.ts`), checked before `Bun.spawn` so a refused run starts
no process:

- A command declaring `always` or `through` covers every run.
- A command declaring `with <flag>` covers only a run carrying that `flag`,
  matched by name without the dashes. For a `--no-<name>` flag, the parser
  records `<name>` set to `false`; a run carries the flag when that
  recorded value is anything but `false`, or when `<name>` is recorded as
  `false` and the flag is `--no-<name>`.
- A command declaring `unless <flag>` covers any run that does not carry
  that `flag`, by the same matching.
- A run with no recorded command, as for a caller that never went through
  the dispatcher, is not checked.

A refusal throws `UndeclaredSpendError` (`src/utils/claude.ts`) with a
message naming the command as typed after `rafa` and saying to declare
`spends` on it, with the flag missing for a `with` form and present for an
`unless` one. Thrown from a command's `run`, it ends the invocation as
`command_error` with exit 1 (`src/cli/dispatch.ts`).

### Help

- **One renderer for the three levels.** `renderHelp` reads the request
  and the registry it is handed and nothing else, so every command a level
  names is one that dispatches. `rafa --help` lists the usage lines, a
  quick start, the subjects, the top-level commands and the global flags,
  and closes on the spend legend when a visible command declares `spends`
  (see "The spends declaration").
  `rafa <subject> --help` lists the actions and two examples.
  `rafa <subject> <action> --help` gives the usage line, the description,
  a `Spends:` block when it declares `spends`, the argument and flag
  tables, the examples, the outputs and `See also`.
- **Derived where the spec draws by hand.** The quick start is the first
  example of each subject's first visible action, then of each top-level
  command, so it reads `rafa effort collect` where the spec draws
  `rafa loop status`, which is no subject's first action. A subject's two
  examples are taken
  across its actions, the first of each before the second of any. The
  global flags are `--output=json`, `--output=events` and
  `-v, --verbose`, the three `assembleContext` reads, and `--version`, which routing reads and which
  takes no subject beside it. The spec's `--runtime=<v>` is no global flag:
  `loop start` alone reads it and declares it, since a flag typed ahead of
  the subject reaches the context's `flags` and never the `argv` a wrapped
  command is handed.
- **The spend mark ends a roster line**, after the summary, so the
  summary column is untouched. The mark is `🪙` for `always` and `through`
  forms, and `🪙 with --resolve` or `🪙 unless --no-model` for `with` and
  `unless` forms (showing the `flag`). It appears on an action's line in
  its subject's roster, on a top-level command in the root `Commands:` list
  (`next 🪙`), and bare on a subject's line when a visible action of it
  spends. The mark wraps as one word, never split from its condition.
- **An action's `Spends:` block** appears after its description, one line
  wrapped at the block's indent: the mark, then `what`. For `always` and
  `through` forms the mark is the bare glyph (`🪙 one planning session`),
  and for `with` and `unless` forms the mark ends in a colon, showing the
  condition (`🪙 with --resolve: runs a small fixed plan through the loop`).
  The mark wraps as one word. An action declaring no `spends` has no block.
- **A hidden action** is in no roster, quick start, example list or
  `See also`, and its own help still renders.
- **Prose wraps at 80 columns.** An example's command is never wrapped.
- **The snapshots** under `src/cli/testdata/help/` are written by
  `src/cli/help.test.ts` only when `RAFA_UPDATE_HELP_SNAPSHOTS=1` is set.
  Unset, a missing or stale one is red and nothing is written. A task
  that registers or changes a command, or a constant a declaration's
  default reads, runs
  `RAFA_UPDATE_HELP_SNAPSHOTS=1 bun test src/cli/help.test.ts`, reads the
  diff, and keeps this page true.
- **The frozen set is seven files** — `rafa.txt`, `rafa-loop.txt`,
  `rafa-loop-start.txt`, `rafa-loop-wait.txt`, `rafa-next.txt`,
  `rafa-issue-ready.txt` and `rafa-issue-edit.txt`, the list `SNAPSHOTS` in
  `src/cli/help.test.ts` spells — and none of them renders another
  command's flag list. A flag added to `init`, to `plan create` or to a
  `pr` action shows only in that command's own `--help`, which is not
  snapshotted, so the updater legitimately writes all seven back
  BYTE-IDENTICAL. That is the expected reading and not a writer that
  never fired; the control that tells them apart is dirtying one snapshot
  with an extra line and re-running the updater, which returns the file
  to its original sha.
- **A new SUBJECT moves `rafa.txt` alone.** The root roster is the only
  one of the seven that lists subjects; the other six render a single
  command or subtree and are untouched. Read which files actually differ
  off `git status`, never off the assumption that they all move
  together — registering a subject or a top-level command reddens
  exactly three cases in `src/cli/help.test.ts`, all of them on
  `rafa.txt`. So does rewriting a subject's summary alone: the `plan`
  summary changed with `plan risk` reddened those three and no other
  (measured on 2026-09-23). An action under an existing subject reddens
  none but under `loop` and `issue`, and its summary shows only in its
  subject's roster, which is not snapshotted; `rafa-issue-ready.txt`'s
  and `rafa-issue-edit.txt`'s See also name every other `issue` action,
  so registering one moves both files. Registering `issue edit` moved
  `rafa-issue-ready.txt` by its See also line and `rafa.txt` by the
  `issue` summary rewritten beside it (measured on 2026-10-06).
  Registering the `board` subject with `board list`
  reddened the same three and moved `rafa.txt` alone, by one Quick start
  line and one Subjects entry (measured on 2026-09-28). Adding `board
  sync` with `board`'s summary lengthened reddened the same three and
  moved `rafa.txt` alone, by the one wrapped Subjects line (measured on
  2026-10-07).

### Describe

- **One document, from the registry the line was routed through.**
  `rafa describe` reads `RafaContext.registry`, so every module mounted
  for the invocation is in it, and `describeRegistry` reads that registry
  and the version and nothing else. The version is `package.json`'s,
  imported by name, so `bun build` inlines it into `dist/cli.js`.
- **json mode gives the document as the terminal result's `data`**, the
  start event its only other line. Text mode prints the same document as
  JSON indented by two spaces, one `info` line with no `result: ` prefix.
- **Schema 2** holds `schemaVersion`, `binary`, `version`, `subjects`
  (each a `name`, a `summary` and its `actions`) and `commands`, the
  top-level ones. An action and a top-level command share one shape:
  `name`, `summary`, `description`, `args`, `flags`, `examples`,
  `outputs`, `aliases`, `deprecated`, `module` and `spends`. The `spends`
  field holds the command's `spends` declaration as written (see "The
  spends declaration"): one of four forms with `when` and `what`, where
  `with` and `unless` forms carry `flag` as typed with its dashes, or null
  for a command declaring none. Every field is on every entry, with `null`
  or an empty list for what a declaration leaves out. An argument or a flag
  carries `required` as a boolean and `default` as a value or null, and a
  flag its `aliases`.
- **A module's action is listed where it is typed**: after the actions of
  the subject whose `exec` action reaches it, or after the top-level
  commands for a top-level `exec`. It is named by the words after the
  subject (`exec linear next` under `module`), with `module` its mount's
  name and `aliases` empty. A mount no visible `exec` action reaches is in
  no entry. The core roster's `exec` action is `module exec`, so
  `rafa describe` lists the actions of every module `src/rafa.ts`
  loaded after `module list` and `module exec`.
- **A hidden command is in no entry**, nor is an action typed through a
  hidden `exec` action.
- **The completeness case** in `src/cli/describe.test.ts` is red when a
  command the core registry holds, hidden ones included, or an entry of
  its document lacks a summary, a description, an example or its
  outputs. A blank string counts as missing: `commandProblem` checks shape
  only, so the registry accepts an empty one.
