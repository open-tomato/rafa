## Logging

`Logger` is the port for diagnostics (#950): errors, warnings, debug lines
and `api` exchanges, each with its module, cause code and hint when known.
It sits beside `Output`, and the two never share a job.

### What goes where

- **`Output.info` and `Output.result` are a command's own answer.** A
  listing, a report, the json result. They are never filtered: with
  `logger.level: error`, a listing still prints.
- **The logger carries everything said ABOUT the work.** Its levels are
  `error`, `warn` and `debug`, in that order, quietest first, plus `api`.
  There is no `info` level.

### The port

`src/ports/index.ts` declares it:

- `log(entry)` writes a `LogEntry`: `level`, `message`, and optionally
  `module`, `action`, `code` (a cause code, `context/error-codes.md`),
  `hint`, `data`, `error` and `api`.
- `child(bindings)` answers a logger that adds `module` and `action` to
  every entry. An entry's own fields win over the bindings, for the level
  that applies as well.
- `enabled(level, module)` says whether an entry would be written.

`logger` is the seventh port type of the adapter registry
(`src/adapters/registry.ts`), at version 1, and core registers
`logger/console`.

### Which entries are written

`src/adapters/logger/settings.ts` holds the rule, `levelEnabled`:

- An entry is on when its level is at or quieter than the threshold: the
  level its module has under `logger.modules`, else `logger.level`.
- `debug` is also on from verbosity 2 (`-v -v`).
- `api` sits outside the order. It is on with `logger.api: true` or from
  verbosity 3, and nothing else turns it on: `logger.level: debug` asks
  for rafa's reasoning, never for the traffic to a service.

### The `api` type

An `api` entry is the metadata of one request to a service and what came
back, for debugging background calls such as the hub's. It carries an
`ApiExchange`: `service`, `method`, `url`, and when known `status`,
`durationMs`, `requestBytes`, `responseBytes`, `requestId` and `headers`.
The type has no field for a body, and the filter answers the named
members and no other, so a record that carries a `body` past the type
still has it dropped.

`src/adapters/logger/api-filter.ts` filters every exchange before it is
written:

- the URL's user info and its fragment are dropped
- the value of a query parameter with a sensitive name becomes
  `[redacted]`. The name is matched loosely (`token`, `key`, `secret`,
  `sig`, `passw`, `pwd`, `auth`, `code`, `jwt`, `session`, `credential`),
  read through its percent-encoding, and split on `;` as well as `&`. A
  name that cannot be decoded is redacted, and so is a part with no name
- only the headers of `API_HEADER_ALLOW_LIST` are kept. It is an
  allow-list on purpose: a new secret header stays unwritten until someone
  adds its name
- a string that is no http or https URL is written as `[unreadable url]`
- every URL inside the entry's message, and inside the message of its
  error, goes through the same filter

The filter reads names, so it has limits. A secret that is part of the
path (`/v1/tokens/abc123`) passes, as does one a caller puts in `service`,
`method`, `requestId` or the entry's `data`. Those are the caller's to
keep clean.

Nothing writes an `api` entry yet. A request handler for services is where
it starts. `gh` runs as a child process, so rafa never sees its requests.

### The console adapter

`src/adapters/logger/console.ts` writes through the active output, in the
shape its mode reads.

Text mode writes a line of its own through `info`, so a `debug` entry a
module's level turned on is not dropped again by the text output's
verbosity:

```text
warn: tracker chain: github unavailable: down [tracker:unavailable]
warn: git commit: no author identity is set [git:no-identity]
  hint: set user.name and user.email where the commit runs
api: hub: hub POST https://hub.example/v1/sync?token=[redacted] → 201 in 42 ms — push
```

The first line is what a `rafa issue` action writes today when the chain
passes a tracker over. The second shows an entry that carries a hint, and
the third an `api` entry.

Text mode writes neither `data` nor the error behind an entry: the
message is the line.

The label is the module and the action. The code is in brackets, the hint
is on a second line, and each part is left out when the entry lacks it.

Json and events modes emit today's `log` event. `message` is the label and
the message, as a text line carries them. Everything else goes under an
optional `fields` member, which is left out when there is nothing. An
error is kept as its message under `fields.error`, never its stack. A
`data` that JSON cannot write, a cycle or a bigint, is left out, and
`fields.dataUnwritable` says so:

```json
{"type":"log","level":"warn","message":"tracker chain: github unavailable: down","fields":{"module":"tracker","action":"chain","code":"tracker:unavailable"},"ts":"…"}
```

An `api` entry's event is written at level `debug`, because the event's
level list is a published shape, with `fields.type` set to `api` and the
filtered exchange under `fields.api`.

### Colour

Only the level prefix of a text line is coloured, and only when
`colourEnabled` says so (`src/adapters/logger/colour.ts`):

1. `FORCE_COLOR` set to anything but `0`, `false` or nothing turns colour
   on. Set to `0` or `false`, it turns colour off.
2. Else `NO_COLOR` set to anything but nothing turns colour off.
3. Else colour is on when stdout is a terminal.

`logger.theme: plain` writes no colour at all.

### The call site

With `logger.callSite` on, a `debug` line ends with the file and line that
wrote it. The adapter records the stack with
`Error.captureStackTrace(holder, log)`, `log` being the function the
caller invoked, so the first frame is the caller's and never the
adapter's. The contract suite holds that, and a logger that reads the
wrong frame fails it. A frame of the runtime's own code is skipped, so
`items.forEach((x) => logger.log(…))` names the line of the `forEach`.
Where the runtime removes the calling frame altogether, as for
`.then(() => logger.log(…))`, no site is written.

### The active logger, and when config reaches it

`src/adapters/logger/active.ts` holds the logger the process writes
through, beside the active output. The dispatcher sets one per command
(`setCommandLogger`, `src/cli/dispatch.ts`), made with the invocation's
verbosity and colour, and puts the previous one back afterwards.

A command's logger exists before the project is found, and the command
loads its config later. So the settings are module state: `loadConfig`
hands them over once a config is read, before it prints that load's own
warnings, and a logger reads them at each entry. Until then the defaults
and the verbosity flags apply. Every invocation starts from the defaults,
so a command that loads no config runs at the defaults whatever the file
says.

### The gate on `Output`

The existing `warn`, `error` and `debug` call sites keep calling `Output`.
The dispatcher's wrapper around a command's output lets a `warn` or an
`error` line through only when `activeLogger().enabled(<level>)`. So
`logger.level: error` quiets every warning a command writes through its
output, with no module changed. That gate knows no module: a per-module
level reaches only the modules that moved to a child logger.

`Output.debug` is handled by mode. Json and events mode write it as they
always did, at every verbosity. In text mode the logger decides: the line
is written, as `debug: <message>`, at verbosity 2 or with `logger.level:
debug`.

A logger whose `enabled` throws hides nothing: the line is written.

### Moving a module

`src/adapters/tracker/resolve.ts` is the first one moved, and the `rafa
issue` actions reach it (`resolveIssueTracker` names no sink of its own).
Its default warning sink was a function calling `activeOutput().warn`
with a `PREFIX`-led string. It is now:

```ts
activeLogger().child({ module: 'tracker', action: 'chain' })
  .log({ level: 'warn', message, code: 'tracker:unavailable' });
```

A caller that passes its own `log` sink still gets the plain string, so
the `PREFIX` stays for that path and for the thrown error. The other
modules move when a change touches them.

### Config

`src/config-schema-logger.ts` reads six keys:

```yaml
logger:
  level: warn          # error | warn | debug
  modules:
    board: { level: debug }
  api: false
  theme: default       # default | plain
  callSite: false
  kind: console
```

`logger.modules` is merged across the user and project layers by module
name, the project's entry winning for a module both name.

### Another kind

`logger.kind` names the adapter. The active logger asks its resolver for
any kind but `console` once, and when the registry holds none it warns
once and stays on `console`: a diagnostic channel that cannot be made
never ends the run it reports on.

A module can provide a logger adapter in its manifest, as it provides a
tracker (`rafa.provides.logger` with a `kind` and an `entry`). Its kind is
registered when the module loads. It is not selected yet: the registry a
module fills reaches no reader today, for any port, and the dispatcher
resolves through `CORE_ADAPTER_REGISTRY`. `context/cli.md` says the same
of every port.

### The contract

`src/adapters/logger/contract.ts` holds eleven cases every adapter passes,
run with `runLoggerContract`. They ask what was written, never its shape.
`contract.test.ts` runs them over loggers broken on purpose, so each case
is shown able to fail.
