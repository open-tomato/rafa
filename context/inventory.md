## Inventory

The inventory is a record of skills and agents the loop can invoke. Every
command that reads skills or agents reads this inventory; it is the single
source of truth for which items exist, where they live, what they cost to
run, and whether they are visible to a particular session.

### The record

Each item in the inventory holds these fields:

| Field | Meaning |
|-------|---------|
| `kind` | `skill` or `agent` |
| `name` | item name, as implied by its place in the filesystem |
| `source` | where it comes from: `project`, `rafa`, `user`, `plugin:<name>`, `addon:<name>` |
| `path` | absolute path to the item's file |
| `summary` | item's frontmatter `description`, cut at 130 characters, never generated |
| `stack` | frontmatter list of technology tags; empty when absent |
| `tags` | frontmatter list of domain tags; empty when absent |
| `check` | `pass`, `warn`, or `fail`, from `checkDirectory` for skills only |
| `state` | `enabled`, `collision`, `shadowed-by:<source>`, or `disabled:<how>` |
| `visibleToLoop` | boolean: true when a session spawned under this project's `loop.settingSources` resolves it, or is served it |

### Sources and precedence

Precedence is nearest-first: **project**, **rafa**, **user**,
**addon:\<name\>**, **plugin:\<name\>**. The three tiers' rows take their
state from `resolveTiers` (`src/tiers/resolve.ts`) under
`loop.settingSources`, `tiers.rafa`, `tiers.skills` and `tiers.agents`, so
the inventory restates none of its rules:

- a name one holder serves: the winner is `enabled` (unless explicitly
  disabled), and every other holder, a byte-identical copy included, is
  `shadowed-by:<winner's source>`. Under a pin the winner can be the
  farther tier;
- a name two or more loaded tiers hold with different contents and no pin:
  each loaded tier's holder is `collision`, and nothing serves it;
- a name `tiers.skills` or `tiers.agents` sets to `false`: its nearest
  holder is `disabled:tiers.skills` or `disabled:tiers.agents`;
- a name only the rafa tier holds while `tiers.rafa` is `off`:
  `disabled:tiers.rafa`.

Add-on and plugin rows, which `resolveTiers` leaves out, come after: a name
a tier holds shadows them, and otherwise the first holder of a name and kind
is `enabled` (unless explicitly disabled) and each later one
`shadowed-by:<first source>`. A tier row's state can therefore move with
`loop.settingSources`: a project item and a different user item of one name
are `enabled` and `shadowed-by:project` without `user`, and both `collision`
with it. A shadowed, colliding or disabled item is never visible
(`src/inventory/index.ts`).

### Disabled readings

`disabled:<how>` reads from the tier settings above, and from two places
outside the config:

- **`skillOverrides` setting**: when set to `off`, reads as
  `disabled:skillOverrides`; other values (`name-only`, `user-invocable-only`,
  `on`) do not disable. Reads from `.claude/settings.json`,
  `.claude/settings.local.json`, and `~/.claude/settings.json` (in that order
  of precedence). This plan only READS; it never writes.
- **Frontmatter switches**: a frontmatter key that switches the item off
  reads as `disabled:<key>`. The one read today is
  `disable-model-invocation: true`, as
  `disabled:disable-model-invocation` (`src/inventory/disabled.ts`).

An item cannot be shadowed AND disabled; once shadowed, shadowing takes
precedence in `state`. A colliding item reads `collision` even when a
switch would disable it, since the loop refuses the name either way.

### visibleToLoop

An item is visible to a loop session if and only if:

- It is `enabled`, AND
- Its source passes the visibility rule:
  - **project** items are always visible
  - **user** and **plugin:\<name\>** items are visible only when
    `loop.settingSources` includes `user`
  - **rafa** items are visible when they are served: the winner of their
    name, admitted by `serveVerdict` (`src/tiers/serve.ts`), the check
    `serveResolution` makes before it copies one. An unreviewed third-party
    rafa item is therefore not visible
  - **addon:\<name\>** items are never visible, because `claudeArgs` in
    `src/utils/claude.ts` passes no directory of theirs to a session

Plugins are recorded in the user scope at
`~/.claude/plugins/installed_plugins.json`; the plugin reader scans that file
to discover installed plugins and records each with `source: plugin:<name>`.
The reader pins the Claude Code version it was written against
(`PLUGINS_CLI_VERSION`) and the file's own `version` key
(`PLUGINS_RECORD_VERSION`) in `src/inventory/plugins.ts`; a record under any
other `version` is one warning row, not a guess. The MCP reader pins its own
(`MCP_CLI_VERSION`, `src/inventory/mcp.ts`).

### Search

`skill search` and `agent search` rank inventory rows in code, then start
one session over a scratch copy of the top twelve (`src/inventory/search/`).
The session's reach is narrower in intent than in fact:

- `--tools Read,Grep,Glob` limits which tools exist, not which paths they
  reach. `claudeArgs` always prepends `--dangerously-skip-permissions`, so
  only the working directory and the prompt keep the session inside the
  scratch copy. Accepted by design; a hard limit needs a sandbox or a deny
  rule.
- No `--strict-mcp-config` is passed, so MCP servers from an included
  setting source may still load into the session. Unverified; if a
  user-level server shows up, add the flag to `searchFlags`.
- Claude Code files the session log under the REAL path of its cwd, so on
  macOS the scratch directory is encoded through `realpathSync`
  (`/private/var/folders/…`) before `sessionLogDir` finds the log.
- The runner sets `kind: 'search'` on the collected effort row itself,
  since the prompt-prefix classifier reads such a log as `other`.

### Plan needs

`rafa plan needs` reports every agent and skill a plan names whether or not
a run can see it; `visibleToLoop` is a column, not a filter, and `--missing`
fails on an item that is absent or not visible. Two limits of
`src/plan/needs.ts`:

- It parses `PLAN-<stub>.md` alone. The loop ticks tasks in
  `PLAN_TRACKER-<stub>.md` and leaves the plan unticked, so over a plan the
  loop has run, done tasks read as open and `--missing` over-reports. Not
  fixed: the reading should take status from the tracker when one exists.
- The declaration grammar refuses a prefixed name (`agent=alpha:rev` is an
  `unusable-value`), so a plan can never name a plugin item and needs only
  ever meets bare names.

MCP server lookup (`src/inventory/mcp.ts`) models the `claude -p` path: a
pending `.mcp.json` server nobody approved still starts there, so approval
and trust are not read; a pending or rejected declaration does not hold its
name against a farther scope; and `disabledMcpjsonServers` counts only when
its settings file's source is on, while `disabledMcpServers` in
`~/.claude.json` applies under any sources.

This section replaces the former "Search and plan needs" paragraphs, which
said both commands offered only visible items; neither filters on
`visibleToLoop`.

**Settings files are read against the project root, sessions read them
against their cwd.** `overrideSettingsPath` joins `.claude/settings.json`
and `.claude/settings.local.json` onto `projectRoot`, while Claude Code
resolves them from the session's working directory, so for a session
started from a subdirectory every reader here — `visibleToLoop`, the MCP
switches and `rafa doctor --deep`'s Environment overlay — can name a file
that session never loads. The deep reading carries both directories and
notes the mismatch rather than resolving it. It also leaves out the `env`
of `~/.claude.json`, which Claude Code applies before any settings file,
and the keys Claude Code drops from a project-scoped `env`; its module
note in `src/commands/doctor-deep-env.ts` lists both. This paragraph
replaces nothing.

### Serving

A winner Claude Code would not load by itself reaches a loop session
through a session-only flag. Which flag keeps a skill's bare name was
measured, not read from documentation. The probe ran on 2026-09-24
against Claude Code 2.1.280. That is the installed CLI; the plan named
2.1.281. There was one `claude -p --dangerously-skip-permissions
--setting-sources project,local` session per flag, started in an empty
git repository outside this one with the nested-session variables
unset. Each run read the `skills` and `agents` of the stream-json
`init` message, and the session was asked to list both. Every planted
name began `zqprobe-`, which nothing installed carries.

| Flag and argument | Planted | Listed as |
|---|---|---|
| none (negative control) | nothing | no probe name |
| none, skill in the cwd's `.claude/skills/` (positive control) | skill | bare |
| `--agents '<inline JSON object>'` | agent | bare |
| `--agents <path to that JSON>` | agent | exit 1, `Invalid --agents configuration` |
| `--add-dir <dir>` | `<dir>/.claude/skills/<n>/SKILL.md` | bare |
| `--add-dir <dir>` | `<dir>/.claude/agents/<n>.md` | bare |
| `--add-dir <dir>` | `<dir>/skills/<n>/SKILL.md` | not listed |
| `--plugin-dir <dir>` with `.claude-plugin/plugin.json` | skill, agent | `<plugin>:<n>` |

So `SKILL_DELIVERY` is `add-dir`, pinned with `SERVE_CLI_VERSION` in
`src/tiers/delivery.ts`. `src/tiers/delivery.test.ts` reads this section
and fails when the section and the constants disagree. What the reading
implies for the served directory:

- It keeps the `.claude/` layout. A bare `skills/` directory under an
  added directory is not loaded.
- `--add-dir` carries agents as well, under their bare names, so
  `--agents` is not the only route for agents. The plan did not predict
  this.
- `--plugin-dir` namespaces agents as well as skills, and this probe
  measured it. The note in `src/inventory/plugins.ts` still calls the
  agent prefix documented rather than measured.
- The CLI's help lists `--add-dir <directories...>` as variadic, as
  `--tools` is, so the flag must not come before a token it would
  swallow. `--agents <json>` takes one value. `--plugin-dir` is
  repeatable. This was read from the help, not measured.
- A skill served under `plugin-dir` would be named `rafa:<name>` in a
  session. `src/tiers/skill-names.ts` maps between that name and the
  bare name, and under `add-dir` it returns names unchanged.

Not measured: delivery under setting sources other than
`project,local`, a served name that collides with a project or user
name, and whether an added directory's own settings or `CLAUDE.md` load
alongside its skills. A CLI version other than `SERVE_CLI_VERSION` means
running the probe again before trusting the pin. This section replaces
nothing.
