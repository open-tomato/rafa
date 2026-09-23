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
| `src/cli/testdata/help/` | the frozen text of `rafa --help`, `rafa loop --help`, `rafa loop start --help` and `rafa next --help` |
| `src/modules/load.ts` | the modules `allowList:` names, loaded from their `modules:` sources: manifests checked, adapters registered, command entries handed on |
| `src/commands/module/` | `module list`, what each configured module came to, and `module exec`, the `exec` action mounted modules are reached through |
| `src/commands/agent/` | `agent vendor`, a `~/.claude/agents` definition copied into the project with a source header, `agent list`, the agents `buildInventory` (`src/inventory/`) reads from every source; `agent show`, one of them through the show view of `src/inventory/show.ts`; and `agent search`, the agents that answer a question, built by `skill/search.ts` |
| `src/commands/skill/` | `skill check`, the checker over a skills directory, with `--fix` and `--project`; `skill list`, the skills `buildInventory` (`src/inventory/`) reads from every source; `skill show`, one of them through the show view of `src/inventory/show.ts`; `skill search`, the skills that answer a question through the runner of `src/inventory/search/`; `skill demote`, the demotion pass of `src/demote/` over one directory; and `skill backfill`, the plan, the proposal pass and the apply of `src/backfill/` over one directory |
| `src/commands/instinct/` | `instinct check`, the checker over an instincts directory, and `instinct list` and `instinct show`, the records the two scopes hold |
| `src/commands/instinct/instinct-records.ts` | what `instinct list` and `instinct show` share: the scopes read, which files in them are records, and the id lookup |
| `src/commands/release/` | `release status`, the version `release.versionFile` declares, the latest release tag by semantic version precedence, the versions `release.changelog` calls released that carry no tag and the change notes pending for the current plan, writing nothing; and `release tag`, the one write of the subject, which puts `v<version>` on the release branch's HEAD and prints the push and publish lines rather than running them |
| `src/commands/check-report.ts` | what `skill check` and `instinct check` share: the words each reads off a line, the seams, the lines a run prints and the exit code |
| `src/commands/index.ts` | the core roster: `CORE_SUBJECTS`, `CORE_COMMANDS` and `CORE_REGISTRY` |
| `src/commands/wrap.ts` | `wrapPhaseZeroCommand`: a phase 0 command behind a declaration |
| `src/commands/plan/plan-files.ts` | what `plan list`, `plan show`, `plan validate` and `plan risk` share: the plans directory, the config a project resolves (`resolveProjectConfig`), the task counts, an issue as a line, the argument refusals and `readSwitch`, which refuses a word the parser read into a flag taking no value |
| `src/commands/plan/risk.ts` | `rafa plan risk [<plan>] [--strict]`: the reading of `src/plan/risk.ts` over one plan, in code and starting no session, so it declares no `spends`. The plan resolves against the project root as `loop start --plan=` resolves it, and with none named is the default plan `loop start` falls back to; a plan named that is no file, no default plan, two plans and `--strict` typed ahead of the plan (which the parser reads as its value) are refused with exit code 1. The config gives `loop.settingSources` and the account settings; git and `gh` run at the project root; the environment is `RafaContext.env`, of which only the keys are read. Text mode prints `renderRiskText` a line at a time; json mode gives the `RiskReport` as the terminal result's data. Exit code 0 whatever it finds; 1 under `--strict` when any finding is `high`, where text mode prints the whole report first and json mode writes each `high` as an `error` log event, since a failed result carries no data. Every code span of an open task line is read as a command, so a span that only names one reports it: the rafa-69 plan's own `git push --force` fixture task reads `high` `destructive`, by design |
| `src/commands/plan/ready-offer.ts` | the offer `plan create --issue` and `plan create --next` make on an issue carrying no `spec:ready` label: `rafa issue ready`'s run over the issue the route already read, made only where there is a terminal, and never under `--dry-run` |
| `src/commands/plan/blocked-offer.ts` | the offer `plan create --next` makes past a blocked line: `Plan #<n> instead? [y/N]` over the line `src/board/blocked-line.ts` found, made only where there is a terminal, and never under `--dry-run` |
| `src/commands/plan/refresh-offer.ts` | the offer `plan create --issue` and `plan create --next` make on a body changed since its saved copy: `Issue #<n> changed since the saved copy of <date>. Plan from it as it reads now? [y/N]`, the text `refreshQuestion` in `src/board/snapshot-settle.ts` owns, made only where there is a terminal, never under `--dry-run` and never under `--refresh` |
| `src/commands/issue/ready.ts` | `rafa issue ready <n>`: the two checks a person would otherwise make by eye before marking an issue ready — whether the account that opened it has write access and whether its body fills the spec template — printed on `stdout` in text mode, and one label swap, `spec:needs-work` off and `spec:ready` on, made after the yes. Exit code 0 for the normal completion; 1 for an unusable config or a swap `gh` refused; 2 for an untrusted author and for a body with gaps. The four status values are `marked`, `declined` (question answered no), `unasked` (no terminal), and `already` (label already on). There is no `--yes` flag; the question is always asked where there is a terminal. The run's status and lines are the data of a json-mode terminal result. See `--no-hint` under the ending hint. |
| `src/commands/issue/unblock.ts` | `rafa issue unblock [<n>] [--all]`: the issues whose blockers have all closed, asked about one at a time, and `spec:blocked` taken off each one the answer says yes for. It reads the issue or `--all` open blocked issues, checks each named blocker against the board's state, and asks only when every blocker is closed. Exit code 0 on successful completion; 1 when the board could not be read. The eight status values are `removed` (label taken off), `declined`, `unasked` (no terminal), `waiting` (blocker still open), `fault` (line unreadable), `not-blocked` (label not on), and `failed` (read or write error). The outcome of each issue is the data of a json-mode terminal result. Nothing is written without a terminal. |
| `src/commands/issue/issue-tracker.ts` | what the seven `issue` actions share: the tracker resolved through the chain, the ref an id names, the line readers and the refusals |
| `src/commands/loop/loop-sessions.ts` | what `loop stop`, `pause`, `resume`, `status` and `list` share: the session a line picks, a session's checklist and rough ETA, and the refusals |
| `src/commands/pr/` | `pr current`, the open pull request of the branch checked out at the project root on one line; `pr show`, it in full with its checks and its last triage; `pr view`, it opened in the browser; `pr list`, the open pull requests as rows; `pr merge`, one merged, its `Closes #<n>` line ticked on the roadmap and both branches cleaned up after it; `pr triage`, one assessed in code into a class with its evidence and a follow-up prompt, and under `--resolve` handed to the ordinary loop over the pinned plan for its class; and `pr wait`, its checks polled until they settle, the deadline passes or it turns out to have none, exiting 0 green, 1 red and on no checks at all, and 3 at the deadline |
| `src/commands/pr/wait.ts` | `rafa pr wait [<n>] [--timeout=<minutes>]`: polls one pull request's checks until they settle or the deadline passes, reading and writing nothing else. Exit code 0 for green (every check passed); 1 for red (a check failed) or none (no checks at all); 3 for a deadline that passed with checks still running or pending. The `--timeout` flag takes a minute count from 1, defaulting to `DEFAULT_CI_TIMEOUT_MIN`; the number is read from the line, so `rafa pr wait --timeout 41` is a 41-minute wait on the branch's own PR, not a wait on #41. The verdict state values are `green`, `red`, `none`, `pending`, and `timeout`. A green run ends with the one step that follows; the other four each carry their report as the message of their `CommandExit`. The poll is the same `waitForChecks` the loop's own CI gate uses, so one wait and the loop agree about what green means and how often a pull request is asked. The report is the data of a json-mode terminal result when green, or its error message when not. See `--no-hint` under the ending hint. |
| `src/commands/pr/triage-read.ts` | what `pr triage` gathers that is neither the line nor the pull request: the Actions run id off a check link, the `--log-failed` capture of each failing run, the repository's workflow count when no check reported, and the conflicting file list, read with `git merge-tree` between refs resolved first and never fetched |
| `src/commands/pr/triage-resolve.ts` | what `--resolve` does with an assessment: the worktree added and removed, the pinned plan filled and capped at `pr.resolveBudget`, one loop run an attempt, the CI wait after each, the attempt guard's two stops, the comment with its dependabot rebase note, and the exit code 3 a run that gave up ends with |
| `src/commands/pr/triage-trust.ts` | board trust as `pr triage` asks it, over `src/board/trust.ts`: the newest `rafa:pr-triage` marker comment whose author holds write access or is listed in `board.trustedAuthors`, with every newer one passed over and reported rather than read, and the exit-2 refusal `--resolve` makes over a pull request whose own author is neither trusted nor a known dependency-bump bot |
| `src/commands/pr/resolve-loop.ts` | one `--resolve` attempt's loop: the filled plan written under `~/.rafa/resolve/pr-<n>/attempt-<k>`, outside the worktree so the loop's own commit cannot push it, and `rafa loop start --plan=<file> --no-ci-wait` spawned in the worktree with its stdout forwarded a line at a time |
| `src/commands/pr/triage-report.ts` | the one pure renderer of a triage: the head line, the re-run sentence, the class with its evidence or the stored triage, what was written, and the follow-up prompt whole |
| `src/commands/pr/merge-tick.ts` | what `pr merge` decides about the roadmap tick: the issues the merged pull request closes, the roadmap issue `roadmap.issue` names or the search finds, and every failure on the way turned into a warning |
| `src/commands/pr/merge-unblock.ts` | the unblock reading `pr merge` ends with: the open `spec:blocked` issues whose `Blocked by:` line names an issue the merged pull request closes, run through `runUnblock`, with every failure turned into a warning naming the reading |
| `src/commands/pr/merge-followups.ts` | what `pr merge` names after a clean-up that finished: `rafa release tag` while the version on the base carries no `v<version>` tag, and `rafa self-update` while the project's `package.json` names rafa's own package and the version is not installed under the home |
| `src/commands/pr/pr-context.ts` | what the seven `pr` actions share: the usage lines, the line readers, the provider check and its exit-2 refusal, and the pull request `<n>` or the branch names |
| `src/commands/pr/last-triage.ts` | the `<!-- rafa:pr-triage v1 -->` comment and its `rafa:triage` block as one record, which `pr show` ends with; the marker, the block and the writer that posts and edits the comment are `src/pr/triage/comment.ts`'s |
| `src/commands/init.ts` | `rafa init`: the root chosen by `--root`, `--yes` or a prompt, and the scopes written through `src/project/` |
| `src/commands/init-board.ts` | the board step `rafa init` ends with: `--board`, `--no-board` and the one question with its public-repository line, over `src/board/setup.ts` |
| `src/commands/init-release.ts` | the release step `rafa init` takes once the scopes are written: `--release`, `--no-release` and the one question, written as `release.enabled` through `src/release/setting.ts` |
| `src/commands/doctor.ts` | `rafa doctor`: the `rafa <version>` line it opens with, the preflight `loop start` checks, checked for the config and a plan with no run started, the risk total of a plan `--plan` names over `src/start/risk-total.ts`, the GitHub board rows over `src/board/status.ts`, the blocked issues over `src/commands/doctor-blocked.ts`, and the two install warnings |
| `src/commands/doctor-render.ts` | the lines of `rafa doctor`'s plan section: the head, a line per check, the start-only items a resume passed over, the PREREQUISITES steps nothing checks, and the verdict |
| `src/commands/doctor-blocked.ts` | the blocked-issue reading `rafa doctor` ends with, over `src/board/blocked.ts`: the open issues labelled `spec:blocked` listed with their bodies, the board's issue numbers read only once a line named ids, and the `Blocked issues:` lines a fault is named in |
| `src/commands/self-update.ts` | `rafa self-update`: the checkout built and installed through `src/runtime/install.ts`, which `scripts/snapshot-runtime.ts` calls too |
| `src/commands/next.ts` | `rafa next [--dry-run] [--yes[=<action ids>]]`: reads the project once — the running loops, the branch and its base, the plans and their trackers, the open pull request and its checks, the roadmap — and prints where it stands on one line and the one thing to do about it on the next, then runs that action and reads again, until the answer is no, an action fails, there is nothing to run, or a loop has started. Exit code 0 for every ending (dry-run, nothing-to-run, declined, unasked, loop-started, unchanged, capped); 1 for a line it refuses and for a `sync` that would not fast-forward; 2 for a `--yes` list that is refused and for a repository whose `pr.provider` is not `gh`; or whatever an action threw. The `--dry-run` flag prints the two lines and stops. The `--yes` flag takes an optional comma-list of action ids, allowing those steps unasked and stopping at the first action the list leaves out. A list may name the eight ids of `YES_ACTIONS` (`src/next/ceiling.ts`): `sync`, `resume`, `wait`, `triage`, `merge`, `start`, `plan` and `unblock`; bare `--yes` allows `sync`, `wait`, `unblock` and `plan`. A list naming an id of the always-asked set `ALWAYS_ASKED`, `ready` or `merge-unchecked`, is refused with exit 2. `rafa next` asks no question of its own before `merge-unchecked`: it closes its prompter and hands the question to `pr merge <n> --skip-checks`. The state table has rows indexed by id (a `NextAnswerId`), each holding `state.action` and `state.problems`, read afresh each turn; a pull request reporting no checks and not conflicting is row `pr-no-checks`, whose action is `merge-unchecked`. Each run step is recorded with its state id, the action it proposed, the command that ran it (or null for `sync`), whether `rafa next` asked about it, and whether it ran. The report is the data of a json-mode terminal result. See `--no-hint` under the ending hint. |
| `src/rafa.ts` | the entry: `process.argv` dispatched through `CORE_REGISTRY` with `renderHelp`, and the exit code set |


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
  command.
- **A mapped action can be listed under `--yes` straight away.**
  `YES_ACTIONS` is `NEXT_COMMAND_ACTIONS` minus `ALWAYS_ASKED`, so an
  action that must never run from a list goes into `ALWAYS_ASKED` and
  `ALWAYS_ASKED_WHY` in the same change.
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
  Registration itself reddens exactly three: `OWN_DECLARATIONS` and the
  roster expectations in `src/commands/index.test.ts`, `COMMAND_MODULES`
  in `src/index.test.ts`, and the frozen help snapshots — the last only
  for a new subject or top-level command, or a subject summary that
  changes with it. A changed subject summary reddens a fourth file as
  well, `src/tests/spends-cli-surface.test.ts`, whose spawned `--help`
  case pins each roster line whole, spend mark included. An action
  registered under a subject already there moves no snapshot: registering `plan risk` left all four byte-identical
  and `src/cli/help.test.ts` green before the updater ran (measured on
  2026-09-23); the `plan` summary rewritten beside it is what moved
  `rafa.txt`. The exception is an action declaring `spends` under a
  subject none of whose actions did: its subject's line gains the `🪙`
  mark, which moves `rafa.txt`. A new spender also reddens the spender
  rosters, `src/cli/spends-roster.test.ts`, the spawned `describe` case
  of `src/tests/spends-cli-surface.test.ts` and the README table
  `src/tests/readme-spenders.test.ts` reads (measured on 2026-09-24,
  registering `agent search` and `skill search`).
- **Registered**: `plan create`, aliased `plan`; `plan list`, `plan show`,
  `plan validate` and `plan risk`; `loop start`, aliased `start`; `loop stop`,
  `loop pause`, `loop resume`, `loop status` and `loop list`; `issue list`,
  `issue show`, `issue create`, `issue comment`, `issue move`,
  `issue ready` and `issue unblock`;
  `pr current`, `pr show`, `pr view`, `pr list`, `pr wait`, `pr merge`
  and `pr triage`;
  `effort collect`, `effort report`, `module list`, `module exec`,
  `agent vendor`, `agent list`, `agent show`, `agent search`, `skill check`,
  `skill list`, `skill show`, `skill search`, `skill demote`, `skill backfill`, `instinct check`, `instinct list`,
  `instinct show`, `release status`, `release tag`, `next`, `init`,
  `doctor`, `self-update`, `usage` and
  `describe`. The subjects are `plan`, `loop`, `issue`, `pr`, `effort`,
  `module`, `agent`, `skill`, `instinct` and `release`: a subject is
  declared with its first action, never ahead of it.
  `skill index`, `instinct flag` and `instinct promote` are in the
  command tree and are registered by none of it yet, so no roster names
  them.
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
- **Five wrap a phase 0 command** through `wrapPhaseZeroCommand`:
  `plan create`, `loop start`, `effort collect`, `effort report` and
  `usage`. The command is handed a fresh copy of `argv`
  without the global `--output` flag, then the root of the project the
  dispatcher resolved, and nothing else, so it keeps its own parser and
  acts on that root where it took the git root before; `usage` ignores
  it. Each word `parseArgs` reads as `--output` ahead of a `--`
  is dropped, a value typed as the next word included, so
  `rafa effort report --output=json` never reaches a parser refusing the
  words it does not read. A declared `default` or flag alias fills the
  context's `flags` alone: `rafa loop start -p x.md` hands `start`
  `-p x.md`, which it does not read. `describe`, `init`, `doctor`, `self-update`, the plan readers, the
  `loop` session actions, the `issue` actions, the two checkers, the
  three listings (`skill list`, `instinct list` and `instinct show`),
  `agent show`, `agent search`, `skill show`, `skill search`, `skill demote`,
  `skill backfill` and the `pr` actions wrap none: `describe` reads the registry off its context, and `init`,
  `doctor`, `self-update`, each plan reader, each `loop` session action,
  each `issue` action, each checker, each listing, `agent show`, `agent search`, `skill show`,
  `skill search`, `skill demote`, `skill backfill` and each `pr` action their `args` and `flags`.
- **Where a wrapped command writes**: through the active output, in every
  module it prints from. For `loop start` those are `src/start.ts`,
  `start/run-config.ts`, `start/runtime.ts`, `start/session.ts`, `start/pause.ts`,
  `start/preflight.ts`, `preflight/run.ts`, `start/commit.ts`,
  `start/wrap-up.ts`,
  `start/dispatch.ts`, `start/triage.ts`, `start/release-stage.ts`,
  `adapters/tracker/resolve.ts`,
  `adapters/tracker/local.ts`, `start/pr-lifecycle.ts`, `utils/claude.ts`
  and `utils/schedule.ts`.
  For the others they are `src/plan.ts`,
  `commands/plan/plan-record.ts`,
  `src/usage.ts`, `effort/collect.ts` and `effort/report.ts`, and for
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
  budgeted sessions added, and
  writes no table line. `plan create`, `effort collect` and
  `usage` write each line as a `log` event of its level and give no
  result.
- **The plan readers start no session, and read the configured
  directory.** `plan list` and `plan show` read the directory
  `resolvePlansDir` (`src/commands/plan/plan-files.ts`) answers:
  `plan.dir` of the config that resolves for the project, resolved
  against the project root the dispatcher found, `.rafa/plans` unless a
  config names another. That is where `plan create` writes and where
  `loop start` looks for its default plan, and the directory whose plan
  stubs `effort collect` attributes sessions by, so the readers and the
  writers are on one directory whatever `plan.dir` is set to. A config
  `loadConfig` refuses is refused with exit code 1, and a line handing
  the wrong number of arguments is refused before the config is read.
  The sweep guard in `src/tests/default-plan-dirs.test.ts` still spells
  its forbidden tokens with a trailing slash, so the slashless spelling
  of either swept directory passes it in a tracked file; widening those
  tokens is a separate change.
  `plan list` names each `PLAN-<stub>.md`, its tasks counted from its
  `PLAN_TRACKER-<stub>.md` when there is one. `plan show <stub>` gives one
  plan as `parsePlan` reads it, or its tracker with `--tracker`.
  `plan validate <file>` resolves the file against the working directory,
  and like every command but `module exec`, the two checkers, `init` and
  `describe` it runs only inside a project. It writes each `parsePlan` issue at `error` as
  `<file>:<line>: <reason>: <text>`, then the `agent=` of each
  still-to-run task that no scope the project's `loop.settingSources`
  loads defines, as `<file>: <the line `missingAgentLine` words>` naming
  the agent, the lines that asked for it and its `rafa agent vendor`
  fix or that no user definition carries it
  (`src/agents/roster.ts`). It throws exit code 1 when there is either,
  with a message counting both. That is the check `loop start`'s
  preflight halts on, so a plan the loop would refuse is refused here
  too. The roster is the project the dispatcher found and the config that
  resolves there, which is the only thing this command reads beyond the
  file; handed no project it says so and checks no agent. In json mode a
  list, a plan and a clean validation are the terminal result's `data`,
  the validation carrying an empty `issues` and an empty `missingAgents`,
  and each issue and each missing agent is an `error` `log` event; text
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
  `src/board/plan-spec.ts`).
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
  `<specs.dir>/previous/`. `--next` reads the roadmap issue
  `roadmap.issue` names, else the pinned issue titled `Roadmap`, prints
  each line it skipped with why, and exits 0 with a message when nothing
  is left. `--dry-run` does every read and every refusal and stops before
  the first write, on all three routes. The generated plan records
  `issue: "<n>"` in its `rafa:plan` block, quoted so the digits written
  survive the plan reader, which reads an unquoted number as the number
  YAML parsed (`src/board/plan-field.ts`), and the gate's
  comment and label swap go to that issue.
- **`pr merge` ticks the roadmap after it merges**
  (`src/commands/pr/merge-tick.ts`, `src/board/roadmap-tick.ts`). GitHub
  closes an issue a merged pull request says `Closes #<n>` for and ticks
  no `- [ ] #<n>` box, so the command reads the roadmap issue
  `roadmap.issue` names, else the issue titled `Roadmap`, and writes the
  box through `gh api repos/{owner}/{repo}/issues/<n>`, GET then PATCH.
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
  closing no issue are a warning or a silence. `--output=json` carries it
  as `roadmapTick`, null when the pull request closes nothing.
- **`pr merge` ends with the unblock reading**
  (`src/commands/pr/merge-unblock.ts`), over every open issue labelled
  `spec:blocked` whose `Blocked by:` line names an issue the merged pull
  request closes. It is `rafa issue unblock`'s own `runUnblock`, so the
  question, the state of each blocker and the one `removeLabel` are
  spelled once. It runs LAST, after the clean-up and the follow-ups,
  because it asks and a question among the step lines would interleave
  with them; a clean-up step that failed therefore never reaches it.
  `--yes` does not answer that question — it is declared as merging
  without asking — and without a terminal nothing is asked and nothing
  is written. Every failure is a warning naming the reading and none of
  them changes the exit code, since the merge has already happened.
  `--output=json` carries the report as `unblocked`, null when the pull
  request closes nothing.
- **Three of the readiness gate's four checks run on a board route**
  (`src/board/plan-spec.ts`): the author's trust (`src/board/trust.ts`),
  the `spec:ready` label, then the leak refusal and the completeness
  gaps (`requireCompleteSpec` in `src/board/readiness.ts`), in that
  order, each exit 2 and each before the body is snapshotted, so
  `--next` STOPS at a line that is not ready rather than skipping it.
  The completeness refusal names every template heading that is missing
  or empty, either of "Tasks the plan must carry" and "Definition of
  done" holding no list item, and every placeholder left in the text,
  in one sentence. It costs an issue
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
- **The spec issue template is `src/board/templates/spec.md`**, a
  package asset the build copies to `dist/templates/` and `rafa init
  --board` writes to `.github/ISSUE_TEMPLATE/spec.md`. Its front matter
  labels the issue `type:spec`, its first comment line says the issue is
  public and takes no local path, host or credential, and its six `##`
  headings are `TEMPLATE_HEADINGS` in that order, which is what the
  readiness reading recognises. `src/tests/spec-template-source.test.ts`
  holds the file to the code and the filled template to no gap.
- **The words `plan create` reads live in `src/board/flags.ts`**, the
  seven of the board routes and the gate, because
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
  carries is left to the preflight, which refuses on it. In json mode the
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
- **The board step runs last, and only where there is a board**
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
  refusal, and 0 otherwise. For a plan `--plan` names, halt or not, it
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
  the exit code, and a halt prints its rows before the refusal. Through
  that same runner it then reads the blocked issues
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
  nothing and never changes the exit code either. After
  the report, whatever the preflight did,
  it warns when `.ralph/effort/` holds a store file and `.rafa/effort/`
  none (`src/effort/store/legacy.ts`), and when `~/.rafa/bin` is not
  ahead of `~/.bun/bin` on the context's `PATH` (`readBinPath`); text
  mode says so in an `info` line when the order holds. In json mode a
  preflight that did not halt gives the checks, the `known-missing:`
  lines, the reminders, both readings, those rows and those blocked
  issues as the result's `data`, the rows and the issues null for a
  project with no GitHub board, and a
  halt gives the `command_exit` error and no `data`.
- **`self-update` installs the checkout it runs in**
  (`src/commands/self-update.ts`), as `bun run snapshot` does: both call
  `installRuntime` (`src/runtime/install.ts`), the script from the
  checkout and the command from the bundle. In the project root it reads
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
- **`agent vendor <name>... [--force]` copies a home definition into the
  project** (`src/commands/agent/vendor.ts`), which is the fix
  `loop start`'s preflight and `plan validate` name for an `agent=` no
  loaded scope defines. A name is a definition's frontmatter `name`, what
  `--agent` resolves by, so the source is the `~/.claude/agents/*.md`
  carrying it, whatever its stem, and the copy keeps that file's own name
  under `<root>/.claude/agents/`. The copy carries one line the original
  does not, an HTML comment naming the source file and the day, written
  directly after the frontmatter's closing `---` — never ahead of the
  opening one, which would leave the file carrying no frontmatter at all
  — and as the first line of a file that opens with none. The home is the
  project's and no config is read. Every name is checked before the first
  byte is copied, so a line naming one bad name copies none of the rest.
  It throws exit code 1 for a `--force` value that is neither `true` nor
  `false`, read ahead of the names so `--force` typed first, which
  `parseArgs` hands the next word as its value, meets that refusal; for a
  line naming no name; for a name no `~/.claude/agents` definition
  carries; and for a destination already there, which `--force` replaces
  whole. Each refusal ends with the line `Nothing was written.` In json
  mode the result's `data` holds the root, `<root>/.claude/agents` and
  one row per copy: the name, the file it came from, the file written and
  whether one was replaced. A declaration has no variadic spelling, so
  `rafa agent vendor --help` renders the argument as `<name>` where the
  refusals' usage line says `<name>...`.
- **`agent list [--source=<source>] [--state=<state>] [--hidden-from-loop] [-i]`
  lists every agent definition the inventory holds**
  (`src/commands/agent/list.ts`, over `buildInventory` in
  `src/inventory/index.ts`), built as `skill list` builds it and taking
  the same three filters, `--tier` alias included, read and matched by
  the helpers `src/commands/skill/list.ts` exports; its own refusals name
  its own usage line. A definition is keyed by its frontmatter `name`,
  as `--agent` resolves it, and each row prints the loop mark, name,
  source, state and summary. The Claude Code built-ins are no inventory
  row and are not listed. After the counts and the legend, when a `user`
  row's name is answered by no row visible to the loop, a trailing line
  names those definitions and points at `rafa agent vendor`; a home name
  the project also holds is not one of them, since the name resolves.
  The hint reads the whole inventory, so no filter hides it. It spawns
  nothing and exits 0 whatever the rows say; exit code 1 is kept for a
  positional word, a `--source` or `--state` it cannot take, and a
  config `loadConfig` refuses. In json mode the kept records, the
  filters, the pre-filter total, the agents trees, the vendor names as
  `unreachable` and the warnings are the result's `data`. `-i` browses
  the kept rows as `skill list -i` does, through the helpers that
  module exports, and prints no vendor hint.
- **`agent show <name> [--full]` shows the agent definition a name
  resolves to** (`src/commands/agent/show.ts`, over the show view of
  `src/inventory/show.ts`), as `skill show` shows a skill. The inventory
  is built through the `projectInventory` `src/commands/skill/list.ts`
  exports, the name is the frontmatter `name` `agent list` prints, and it
  shows its first holder in precedence order (`findShown`), the
  shadowed copies listed under the other holders. Text mode, `--full`,
  `--full` read ahead of the name through `readSwitch`, a file that no
  longer reads, the `warn:` lines, exit code 1 and the json `data` are
  those of `skill show`, the refusal of a name no agent holds pointing
  at `rafa skill show` when a skill holds it. The Claude Code built-ins
  are no inventory row, so no name shows one.
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
  config's `loop.settingSources` and the modules `loadModules` answers
  `loaded`; the rafa tier is measured from `Bun.main`, and the entry and
  the module loader's seams are the command factory's two seams. One row
  per skill, of every source (`project`, `rafa`, `user`, `addon:<name>`,
  `plugin:<name>`), prints `●` when a loop session resolves it and `○`
  when not, then its name, source, state (`enabled`,
  `shadowed-by:<source>` or `disabled:<how>`) and summary, the columns
  padded to the widest cell. `--source` keeps the rows of one whole
  source string and refuses a `plugin:` or `addon:` source no row or
  warning names; `--tier` is its alias, marked in the help for removal
  after one release. `--state` takes `enabled`, `shadowed` or `disabled`
  and matches the state's prefix; `--hidden-from-loop` keeps
  `visibleToLoop: false`. The filters combine. A skills tree whose
  directory is absent prints its path and `(no such directory)`, and an
  unreadable plugin record, plugin, add-on manifest, settings file or
  `skillOverrides` entry is one `warn:` line. The exit code is 0
  whatever the rows say — the listing reports and `skill check` gates —
  and exit code 1 is kept for a positional word, a `--source` or
  `--state` it cannot take, and a config `loadConfig` refuses. In json
  mode the kept records, each with its `check`, the filters, the
  pre-filter total, the skills trees and the warnings are the result's
  `data`. `-i | --interactive` browses the kept rows instead of printing
  them, through `browse` (`src/inventory/browse.ts`) on standard error:
  Enter shows a row, `f` its whole file, Escape goes back, `q` quits,
  `ctrl-c` is exit code 130. The warnings still go out first, and with
  no row kept the text listing is printed instead. Exit code 1, before
  the inventory is built, refuses `-i` when standard input is not a
  terminal, with a line naming `rafa skill list --output=json`, and
  refuses it beside `--output=json`. The terminal and the keys are the
  `terminal` and `keys` seams of the factory.
- **`skill show <name> [--full]` shows the skill a name resolves to**
  (`src/commands/skill/show.ts`, over the show view of
  `src/inventory/show.ts`). The inventory is built as `skill list`
  builds it, through the `projectInventory` that module exports, and
  the name shows its first holder in precedence order (`findShown`): the
  skill that answers, or the disabled one still holding the name. Text
  mode prints the record, every other skill of that name with its
  source, state and path, the frontmatter as written and the body's
  headings with their file lines; `--full` prints the whole file in
  place of the last two. `--full` is read ahead of the name through
  `readSwitch`, so `rafa skill show --full <name>`, which `parseArgs`
  hands the name as the flag's value, is refused naming the order that
  works. A file that no longer reads still shows the record and the
  other holders, with the reason, and exits 0. The inventory's warnings
  are `warn:` lines as `skill list` writes them. Exit code 1 is kept for
  no name or two, a value read into `--full`, a name no skill holds —
  whose refusal points at `rafa agent show` when an agent holds it — and
  a config `loadConfig` refuses. In json mode every part of the view,
  the project root, `loop.settingSources` and the warnings are the
  result's `data`, `text` holding the file under `--full` alone.
- **`skill search "<question>" [--all] [--no-model]` and
  `agent search` find the items that answer a question**
  (`src/commands/skill/search.ts`, whose `createSearchCommand` builds
  both, over `runSearch` and `rankSearch` of `src/inventory/search/`).
  The inventory is built through `projectInventory`, as `skill list`
  builds it. Each kind searched is one `runSearch`: the ranking, one
  `haiku` session in a scratch copy of the top twelve, the quote check
  and one `search` effort row, stored in the store `selectEffortStore`
  opens from the project's config. `--all` searches the other kind too,
  the command's own first, one session per kind, since a candidate is
  keyed by its name and a skill and an agent may share one.
  `--no-model` runs `rankSearch` alone and opens no store; both
  commands declare `spends` `unless --no-model`. Text mode prints, per
  kind, a heading, then the kept matches with each quote and its
  `path:line` and the dropped line, or "not answerable from these
  files", or the numbered ranking (under `--no-model`, and after the
  `warn:` notice of a fallback), or `(no skill ranks for these words)`,
  when no session starts. The parser's issues and an effort row that
  was not stored are `warn:` lines. The exit code is 0 whatever is
  found; 1 for no question or two, a blank one, a value read into
  `--all` or `--model`, and a config `loadConfig` refuses. The switches
  are read ahead of the question through `readSwitch`, since
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
  dispatcher resolved; neither declares a flag or a seam of its own. A
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
  `show` prints the fields, the two sections, the evidence and the
  `action_hash` computed from the action, which no file stores, and a
  line naming the other scope when it holds that id too; the project
  scope answers first. It refuses with exit code 1 an id no scope holds,
  naming both scopes, and a record that broke a rule, naming its issues,
  each as the `CommandExit` message. In json mode `list` gives the
  scopes, their records and the two counts as the result's `data`, and
  `show` the record.
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
  `create` files a draft of type `code`, module `unassigned` and no
  priority unless a flag names one; `comment` posts `--body`; and `move`
  moves an issue to a state, writing a `warning` the tracker answers at
  `warn` and still exiting 0. In json mode the result's `data` holds the
  tracker (its kind, whether the chain degraded, and why) beside the
  query and the issues, the issue, the ref, or the ref with the state and
  the warning; text mode writes lines. The registry and the `gh` runner
  are seams of each command's factory. `src/commands/issue/create.test.ts`
  spawns `issue create` and `issues list` under a stand-in `gh` failing
  the `github` preflight.
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
  reads no branch. In json mode each gives its reading as the result's
  `data`; text mode writes lines.
- **Type `--tracker` after the stub.** `parseArgs` gives a flag the next
  word as its value unless that word opens with `-`, whatever type the
  flag declares, so `rafa plan show --tracker my-plan` hands `plan show`
  no stub. The command reads `true` and `false` as the values of the flag
  and refuses any other with exit code 1, naming the order that works.
- **A wrapped command declares exactly the flags its phase 0 module
  reads**, plus the wrapper's own, as the line types them.
  `src/commands/index.test.ts` holds each list equal to the quoted `--`
  literals of the modules reading that line, with one flag held apart and
  named: `hint`, which `plan create` and `loop start` declare and no
  phase 0 parser reads, since `endingWith` (`src/next/ending.ts`) reads
  it off the parsed context once the phase 0 function has returned. A
  wrapped command's `outputs` is `['text']` until it writes through the
  active output, and each now declares `text` and `json`, as
  `describe` does. `module list` declares neither a flag nor an argument, and `module exec` the arguments `module` and `action`, neither required, and no flag, each with `text` and `json`. `agent vendor` declares the argument `name`, required and read as one or more words, and the flag `force`, `agent list` no argument and the flags `source`, aliased `tier`, `state`, `hidden-from-loop` and `interactive`, aliased `i`, `agent show` the argument `name`, required, and the flag `full`, and `agent search` and `skill search` each the argument `question`, required, and the flags `all` and `model`, the latter defaulting to true and so spelled `--no-model`, each with `text` and `json`. `describe` declares no flag, `init` the flags `root`, `yes` and `board` and no argument, `doctor` the flag `plan` and no argument, and `self-update` the flag `force` and no argument, each with `text` and `json`. `loop stop`, `loop pause`, `loop resume` and `loop status` each declare the flag `session-id`, aliased `s`, and `loop list` no flag, none of the five an argument, each with `text` and `json`. Of the plan readers,
  `plan show` declares the argument `stub` and the flag `tracker`,
  `plan validate` the argument `file`, and `plan list` neither; each
  declares `text` and `json`. `plan create` declares the flags `spec`,
  `issue`, `next`, `refresh`, `dry-run`, `skip-review`, `comment`, `stub`,
  `progress` and `hint`, three of them mutually exclusive (`spec`, `issue`
  and `next`), each with `text` and `json`. Of the `issue` actions, `list` declares the
  flags `state`, `type`, `module`, `search` and `limit`, `show` the
  argument `id`, `create` the flags `title`, `body`, `type`, `module` and
  `priority`, `comment` the argument `id` and the flag `body`, and `move`
  the arguments `id` and `state`; each declares `text` and `json`. Of the `pr` actions, `pr current` and `pr list`
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
  then, before anything else is read, for a `--runtime` with no value, a
  version with no `cli.js` under `~/.rafa/runtime/`, a path that is neither
  a file nor a directory holding `cli.js`, a runtime inside the `src/` of
  the working directory or of the project root, as typed or with its links
  resolved (`start/runtime.ts`), and, in the command before `start` runs, a
  `--runtime` typed ahead of the subject; then for an unusable config, a plan
  file that does not exist, a default branch, a session record refusing
  the run, session records that cannot be read or written, and a
  preflight that halts before any session: an `agent=` of a still-to-run
  task that no scope `loop.settingSources` loads defines, checked ahead
  of every probe, a failed required prerequisite — the two automatic
  items a `gh` pull request provider contributes, `gh` on `PATH` and
  `gh auth status` for `origin`'s host, checked ahead of the configured
  tiers, and the plan's `[start]` items, checked between the two on a
  first dispatch and named in one line each on a resume
  (`src/preflight/first-dispatch.ts`), included — a PREREQUISITES file
  that cannot be read, or checks the store refused
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
  config, one line per problem. An interrupted task throws
  `CommandExit(0)` once it is marked and its report stored; a failed,
  blocked or unstored task still returns, and ends with exit code 0.
  The plan readers throw 1 for a line handing them the wrong number of
  arguments, `plan show` also for a stub no plan stamp can carry, a stub
  naming no plan or no tracker and a `--tracker` value other than `true`
  or `false`, and `plan validate` also for a path that is no file, for
  a plan with an issue, for a plan naming an agent no loaded scope
  defines, and for a config `loadConfig` refuses. `init` throws 1 for a positional word, a `--yes`
  value other than `true` or `false`, a `--root` with no path, a refused
  root, no terminal with neither flag given, input ending before a root
  is chosen, a path the scopes cannot be written at, a config
  `loadConfig` refuses and a `.gitignore` it cannot place its block in,
  each message ending with the line `Nothing was written.`
  `doctor` throws 1 for a positional word, a `--plan` holding no file, a
  plan named that is no file, a plan path that cannot be checked, a
  config `loadConfig` refuses and a
  PREREQUISITES file that cannot be read, each message ending with the
  line `Nothing was checked.`, and for a failed required item, its message the runner's halt.
  `self-update` throws 1 for a positional word, for a `--force` value
  other than `true` or `false`, for a tracker in `plan.dir` holding a
  task, naming each, and for a `~/.rafa/runtime/<version>/` already there
  without `--force`, naming it and the version; and 2, the message naming the
  step and what it leaves changed, for a `package.json` that cannot be
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
  attempt guard gives up.
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
  its subject is top-level, reached by its one word: `usage` is subject
  `usage` and action `usage`. `name` routes nothing.
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
  it, the bare subject included.
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
subject and one of its actions. `mount` answers a new registry and
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
  problem has each `tracker`, `store`, `planner` and `output` entry
  imported, its default export the adapter's `create`, registered under
  the manifest's `kind` and `requires.ports` version on
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
home and the warnings read before the invocation are options.

- **A command runs inside a project, or not at all.** Once the spec of a
  command needing a project is read, `resolveScope` walks up from the
  working directory, `process.cwd()` unless the `cwd` option names
  another, to the nearest `.rafa/config.yaml`, passing over the home,
  `homedir()` unless `home` names another. The project found is the
  context's `project`. With none, the invocation ends as `no_project`
  with exit code 1: `rafa: ` and the `rafa init` hint on stderr in text
  mode, the hint as the result's message in json mode. The command never
  runs, so it prints no deprecation line. A relative working directory or
  home ends the same way with the walk's message. A help request, a
  routing refusal, `invalid_spec` and a command declaring
  `needsProject: false` read neither the working directory nor the home.

- **json mode writes one `start` event first and one terminal `result`
  last**, every line NDJSON. Text mode writes neither event. A failure's
  message goes to stderr, a `CommandExit` message as the command gave
  it and anything else as `rafa: <message>`. A result a command gave is
  written as the `text` adapter writes one.
- **The context's output** passes lines and `step` and `log` events
  through. It holds `result(payload)` for the terminal event, and refuses
  a second result and any `start` or `result` handed to `emit`. A refusal
  there ends the command as `command_error`.
- **While a command runs, its context's output is the active output**
  (`src/adapters/output/active.ts`), set in the invocation's output mode,
  which `activeOutputMode()` answers. The output and the mode active
  before are put back afterwards, when the command throws too.
- **An alias, or a command declaring `deprecated`, writes one line to
  stderr** before it runs, in either mode:
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
  `loop start`).
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
  global flags are `--output=json` and `-v, --verbose`, the two
  `assembleContext` reads, and `--version`, which routing reads and which
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
- **The frozen set is four files** — `rafa.txt`, `rafa-loop.txt`,
  `rafa-loop-start.txt` and `rafa-next.txt`, the list `SNAPSHOTS` in
  `src/cli/help.test.ts` spells — and none of them renders another
  command's flag list. A flag added to `init`, to `plan create` or to a
  `pr` action shows only in that command's own `--help`, which is not
  snapshotted, so the updater legitimately writes all four back
  BYTE-IDENTICAL. That is the expected reading and not a writer that
  never fired; the control that tells them apart is dirtying one snapshot
  with an extra line and re-running the updater, which returns the file
  to its original sha.
- **A new SUBJECT moves `rafa.txt` alone.** The root roster is the only
  one of the four that lists subjects; the other three render a single
  command or subtree and are untouched. Read which files actually differ
  off `git status`, never off the assumption that they all move
  together — registering a subject or a top-level command reddens
  exactly three cases in `src/cli/help.test.ts`, all of them on
  `rafa.txt`. So does rewriting a subject's summary alone: the `plan`
  summary changed with `plan risk` reddened those three and no other
  (measured on 2026-09-23). An action under an existing subject reddens
  none, and its summary shows only in its subject's roster, which is not
  snapshotted.

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
