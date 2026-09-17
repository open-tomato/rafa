## CLI

How a line reaches a command under `src/cli/`: `RafaCommand`, the
registry, routing, module command entries, the dispatcher, help and
`describe`.
`.specs/cli-surface.md` owns the command tree, the aliases, the help
levels and `describe`; this page holds what the code does. Each
module's note is the long form.

### Modules

| Module | Holds |
| --- | --- |
| `src/cli/core/` | `types.ts`, `parseArgs.ts` and `assembleContext.ts`, copied from open-tomato's `cli-core` |
| `src/cli/command.ts` | `RafaCommand`, `RafaContext`, `CommandExit`, and the shape check `commandProblem` |
| `src/cli/registry.ts` | subjects, core commands, aliases, and the `module/<name>` mounts |
| `src/cli/route.ts` | a line read into a command, a help request or a refusal, with no side effect |
| `src/cli/modules.ts` | module command entries imported and mounted, one warning per file skipped |
| `src/cli/dispatch.ts` | one invocation: the context, the events, the deprecation line and the exit code |
| `src/cli/help.ts` | `renderHelp`, the three help levels rendered from the registry, and `GLOBAL_FLAGS` |
| `src/cli/describe.ts` | `describeRegistry`, the schema 2 roster built from the registry, module-provided actions included |
| `src/cli/testdata/help/` | the frozen text of `rafa --help`, `rafa loop --help` and `rafa loop start --help` |
| `src/modules/load.ts` | the modules `allowList:` names, loaded from their `modules:` sources: manifests checked, adapters registered, command entries handed on |
| `src/commands/module/` | `module list`, what each configured module came to, and `module exec`, the `exec` action mounted modules are reached through |
| `src/commands/index.ts` | the core roster: `CORE_SUBJECTS`, `CORE_COMMANDS` and `CORE_REGISTRY` |
| `src/commands/wrap.ts` | `wrapPhaseZeroCommand`: a phase 0 command behind a declaration |
| `src/commands/plan/plan-files.ts` | what `plan list`, `plan show` and `plan validate` share: `.plans/`, the task counts, an issue as a line and the argument refusals |
| `src/commands/issue/issue-tracker.ts` | what the five `issue` actions share: the tracker resolved through the chain, the ref an id names, the line readers and the refusals |
| `src/commands/loop/loop-sessions.ts` | what `loop stop`, `pause`, `resume`, `status` and `list` share: the session a line picks, a session's checklist and rough ETA, and the refusals |
| `src/commands/init.ts` | `rafa init`: the root chosen by `--root`, `--yes` or a prompt, and the scopes written through `src/project/` |
| `src/commands/doctor.ts` | `rafa doctor`: the preflight `loop start` checks, checked for the config and a plan with no run started, and the two install warnings |
| `src/commands/self-update.ts` | `rafa self-update`: the checkout built and installed through `src/runtime/install.ts`, which `scripts/snapshot-runtime.ts` calls too |
| `src/rafa.ts` | the entry: `process.argv` dispatched through `CORE_REGISTRY` with `renderHelp`, and the exit code set |

### The core roster

- **Core commands are a static list** in `src/commands/index.ts`, because
  `dist/cli.js` bundles only what static imports reach. An action sits at
  `src/commands/<subject>/<action>.ts` and a top-level command at
  `src/commands/<name>.ts`, each module's default export its command.
- **Registered**: `plan create`, aliased `plan`; `plan list`, `plan show`
  and `plan validate`; `loop start`, aliased `start`; `loop stop`,
  `loop pause`, `loop resume`, `loop status` and `loop list`; `issue list`,
  `issue show`, `issue create`, `issue comment` and `issue move`;
  `effort collect`, `effort report`, `module list`, `module exec`, `init`,
  `doctor`, `self-update`, `usage` and `describe`. The subjects are `plan`,
  `loop`, `issue`, `effort` and `module`: a
  subject is declared with its first action, never ahead of it.
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
  `loop` session actions and the `issue` actions wrap none: `describe`
  reads the registry off its context, and `init`, `doctor`, `self-update`,
  each plan reader, each `loop` session action and each `issue` action
  their `args` and `flags`.
- **Where a wrapped command writes**: through the active output, in every
  module it prints from. For `loop start` those are `src/start.ts`,
  `start/run-config.ts`, `start/runtime.ts`, `start/session.ts`, `start/pause.ts`,
  `start/preflight.ts`, `preflight/run.ts`, `start/commit.ts`,
  `start/wrap-up.ts`,
  `start/dispatch.ts`, `start/triage.ts`, `adapters/tracker/resolve.ts`,
  `adapters/tracker/local.ts`, `start/pr-lifecycle.ts`, `utils/claude.ts`
  and `utils/schedule.ts`.
  For the others they are `src/plan.ts`,
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
- **The plan readers start no session.** `plan list` and `plan show` read
  `.plans/` under the git root. `plan create` writes and `loop start`
  finds its default plan in `plan.dir` under the project root,
  `.rafa/plans` unless a config names another, and `effort collect`
  attributes sessions by the plan stubs there, so the readers read where
  those write only while `plan.dir` is `.plans` and the project root is
  the git toplevel (`src/commands/plan/plan-files.ts`).
  `plan list` names each `PLAN-<stub>.md`, its tasks counted from its
  `PLAN_TRACKER-<stub>.md` when there is one. `plan show <stub>` gives one
  plan as `parsePlan` reads it, or its tracker with `--tracker`.
  `plan validate <file>` resolves the file against the working directory
  and reads no repository, though like every command but `module exec`,
  `init` and `describe` it runs only inside a project. It writes each `parsePlan` issue at `error` as
  `<file>:<line>: <reason>: <text>`, then throws exit code 1 when there is
  one. In json mode a list, a plan and a clean validation are the terminal
  result's `data`, and each issue is an `error` `log` event; text mode
  writes lines and no `result: ` line.
  `src/commands/plan/validate.test.ts` spawns `plan validate` with a
  stand-in `claude` first on the PATH and finds it never called, where
  `plan create` calls it.
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
  context's `PATH` (`src/project/bin-path.ts`). In json mode the result's
  `data` holds the root, its source, the working directory, whether the
  config existed, every path checked with its change, and that reading.
- **`doctor` checks what `loop start` would, and starts no run**
  (`src/commands/doctor.ts`). It resolves the config as `loop start`
  does, then the plan `--plan=<file>` names against the project root, or
  the default plan; a plan named that is no file is refused, and with no
  default plan there the config's items are checked alone. `PLAN.md`
  carries no stub, so a plan's `PREREQUISITES-<stub>.md` is merged in
  through `--plan` only. Every item goes through `runPreflight` in the
  project root with the context's environment, an optional failure warned
  about as `loop start` warns. It generates no run id and writes no
  `preflight` row, so `rafa effort report` lists the halts of `loop start`
  runs alone. It exits 1 when a required item fails, the halt being the
  refusal, and 0 otherwise. After the report, whatever the preflight did,
  it warns when `.ralph/effort/` holds a store file and `.rafa/effort/`
  none (`src/effort/store/legacy.ts`), and when `~/.rafa/bin` is not
  ahead of `~/.bun/bin` on the context's `PATH` (`readBinPath`); text
  mode says so in an `info` line when the order holds. In json mode a
  preflight that did not halt gives the checks, the `known-missing:`
  lines, the reminders and both readings as the result's `data`, and a
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
  reads**, as the line types them. `src/commands/index.test.ts` holds
  each list equal to the quoted `--` literals of the modules reading that
  line. A wrapped command's `outputs` is `['text']` until it writes
  through the active output, and each now declares `text` and `json`, as
  `describe` does. `module list` declares neither a flag nor an argument, and `module exec` the arguments `module` and `action`, neither required, and no flag, each with `text` and `json`. `describe` declares no flag, `init` the flags `root` and `yes` and no argument, `doctor` the flag `plan` and no argument, and `self-update` the flag `force` and no argument, each with `text` and `json`. `loop stop`, `loop pause`, `loop resume` and `loop status` each declare the flag `session-id`, aliased `s`, and `loop list` no flag, none of the five an argument, each with `text` and `json`. Of the plan readers,
  `plan show` declares the argument `stub` and the flag `tracker`,
  `plan validate` the argument `file`, and `plan list` neither; each
  declares `text` and `json`. Of the `issue` actions, `list` declares the
  flags `state`, `type`, `module`, `search` and `limit`, `show` the
  argument `id`, `create` the flags `title`, `body`, `type`, `module` and
  `priority`, `comment` the argument `id` and the flag `body`, and `move`
  the arguments `id` and `state`; each declares `text` and `json`.
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
  preflight that halts before any session: a failed required
  prerequisite, a PREREQUISITES file that cannot be read, or checks the
  store refused (`start/preflight.ts`). A record of the plan refuses the
  run when it names another branch, whatever its state, or names this
  branch and reads `running` or `paused`, a pid that is gone reading
  `stopped` (`start/session.ts`, `loop/sessions.ts`). `plan create` throws 1
  for an unusable config, a missing `--spec`, a spec found neither against
  the project root nor under `specs.dir`, and a plan already there, and
  for a planner's rejection the exit code a `claude` planner's rejection
  carries, or 1. `effort collect` and
  `effort report` throw 1 for an unrecognised argument and an unusable
  config, one line per problem. An interrupted task throws
  `CommandExit(0)` once it is marked and its report stored; a failed,
  blocked or unstored task still returns, and ends with exit code 0.
  The plan readers throw 1 for a line handing them the wrong number of
  arguments, `plan show` also for a stub no plan stamp can carry, a stub
  naming no plan or no tracker and a `--tracker` value other than `true`
  or `false`, and `plan validate` also for a path that is no file and for
  a plan with an issue. `init` throws 1 for a positional word, a `--yes`
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
  `needsProject: false`, as `module exec`, `init` and `describe` do; the dispatcher
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
- **An action declaring `exec` reads on**: `<module> <action>` routes to
  the command mounted under `module/<module>`. With no module word, the
  `exec` action runs itself. A mounted command's own subject and aliases
  route nothing.
- **The refusal codes** are `unknown_subject`, `missing_action`,
  `unknown_action` and `unknown_module`.

### The registry

It is built from code, so a collision throws when it is built. It
refuses `help` as a subject, as a top-level command and as an alias's
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
- **The result error codes** are the four refusals, `invalid_spec` (a
  spec `parseArgs` refuses), `no_project` (a command run outside a
  project), `command_exit`, `command_error` and `result_unwritable`.
- **Help is text only.** `renderUsage`, one usage line per level, renders
  it for a caller naming no renderer; `src/rafa.ts` hands in `renderHelp`.

### Help

- **One renderer for the three levels.** `renderHelp` reads the request
  and the registry it is handed and nothing else, so every command a level
  names is one that dispatches. `rafa --help` lists the usage lines, a
  quick start, the subjects, the top-level commands and the global flags.
  `rafa <subject> --help` lists the actions and two examples.
  `rafa <subject> <action> --help` gives the usage line, the description,
  the argument and flag tables, the examples, the outputs and `See also`.
- **Derived where the spec draws by hand.** The quick start is the first
  example of each subject's first visible action, then of each top-level
  command, so it reads `rafa effort collect` where the spec draws
  `rafa loop status`, which is no subject's first action. A subject's two
  examples are taken
  across its actions, the first of each before the second of any. The
  global flags are `--output=json` and `-v, --verbose`, the two
  `assembleContext` reads. The spec's `--runtime=<v>` is no global flag:
  `loop start` alone reads it and declares it, since a flag typed ahead of
  the subject reaches the context's `flags` and never the `argv` a wrapped
  command is handed.
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
  `outputs`, `aliases`, `deprecated` and `module`. Every field is on every
  entry, with `null` or an empty list for what a declaration leaves out.
  An argument or a flag carries `required` as a boolean and `default` as
  a value or null, and a flag its `aliases`.
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
