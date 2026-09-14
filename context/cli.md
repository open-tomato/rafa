## CLI

How a line reaches a command under `src/cli/`: `RafaCommand`, the
registry, routing, module command entries and the dispatcher.
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
| `src/commands/index.ts` | the core roster: `CORE_SUBJECTS`, `CORE_COMMANDS` and `CORE_REGISTRY` |
| `src/commands/wrap.ts` | `wrapPhaseZeroCommand`: a phase 0 command behind a declaration |
| `src/rafa.ts` | the entry: `process.argv` dispatched through `CORE_REGISTRY`, and the exit code set |

### The core roster

- **Core commands are a static list** in `src/commands/index.ts`, because
  `dist/cli.js` bundles only what static imports reach. An action sits at
  `src/commands/<subject>/<action>.ts` and a top-level command at
  `src/commands/<name>.ts`, each module's default export its command.
- **Registered**: `plan create`, aliased `plan`; `loop start`, aliased
  `start`; `effort collect`, `effort report` and `usage`. The subjects
  are `plan`, `loop` and `effort`: a subject is declared with its first
  action, never ahead of it.
- **Each wraps a phase 0 command** through `wrapPhaseZeroCommand`. The
  command is handed a fresh copy of `argv` and nothing else, so it keeps
  its own parser and its own console writes. A declared `default` or flag
  alias fills the context's `flags` alone: `rafa loop start -p x.md`
  hands `start` `-p x.md`, which it does not read.
- **A command declares exactly the flags its phase 0 module reads**, as
  the line types them. `src/commands/index.test.ts` holds each list equal
  to the quoted `--` literals of the modules reading that line. Every
  `outputs` is `['text']` until the command writes through the active
  output.
- **How they refuse**: `effort collect` and `effort report` throw
  `CommandExit(1)` once the refusal is printed. `plan create` and
  `loop start` still call `process.exit`, which ends the process before a
  terminal event is written.
- **What changed for a phase 0 spelling**: `rafa effort` alone and
  `rafa effort help` refuse with exit code 1, where the phase 0 CLI
  printed its help and exited 0. An unknown first word writes
  `rafa: unknown subject or command "<word>"` and no help.
  `rafa start --help` answers help, where phase 0 handed `--help` to
  `start`, which ignored it and ran the loop.

### Commands

- **A command is routed by `subject` and `action`.** One whose action is
  its subject is top-level, reached by its one word: `usage` is subject
  `usage` and action `usage`. `name` routes nothing.
- **`run` takes a `RafaContext`**: `CliContext` plus `argv`, the words
  after the last routing word as typed, for a phase 0 command to hand to
  its own parser. `args` and `flags` are the rest of the line read
  against the command's `args` and `flags`, with flags typed ahead of
  the subject included.
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
leaves the old one unchanged. Help and `describe` are to read this
registry, never a second one.

### Module command entries

`loadModuleCommands` imports each `{ name, entry }`: an absolute file
whose default export is `RafaCommand[]`. It mounts that list under
`module/<name>`. The unit is the file. The file is skipped when importing
it throws (a syntax error included), when its default export is no list,
or when the registry refuses the mount. A skipped file gets one warning,
`module "<name>": skipped "<file>": <reason>`, and the entries after it
still load. The dispatcher writes each warning at warn level after the
start event. No caller passes an entry until phase 7 enables modules.

### One invocation

`dispatch(argv, { registry })` answers `{ exitCode, result }` and sets
no exit code: its caller ends the process. The streams, the environment,
the clock, the importer and the help renderer are options.

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
  (`src/adapters/output/active.ts`). The one active before is put back
  afterwards, when the command throws too.
- **An alias, or a command declaring `deprecated`, writes one line to
  stderr** before it runs, in either mode:
  `rafa: "rafa start" is deprecated; use "rafa loop start"`. A help
  request writes none.
- **The result error codes** are the four refusals, `invalid_spec` (a
  spec `parseArgs` refuses), `command_exit`, `command_error` and
  `result_unwritable`.
- **Help is text only.** The default renderer, `renderUsage`, writes one
  usage line per level until the three-level renderer is handed in.
