## Inventory

The inventory is a record of skills and agents the loop can invoke. Every
command that reads skills or agents reads this inventory; it is the single
source of truth for which items exist, where they live, what they cost to
run, and whether they are visible to a particular session.

### The three tiers

Skills and agents live in three tiers, nearest-first:

| Tier | Location | Loaded when |
|------|----------|-------------|
| **project** | `<root>/.claude/skills` and `.claude/agents` | always |
| **rafa** | `bundled/skills` and `bundled/agents` beside entry | `tiers.rafa` is not `off` |
| **user** | `~/.claude/skills` and `~/.claude/agents` | `loop.settingSources` includes `user` |

The rafa tier is measured from the running entry (resolved through symlinks),
so `~/.rafa/bin/rafa` carries skills in `~/.rafa/runtime/<version>/bundled/`.
Running as `bun src/rafa.ts` carries `src/bundled/`. Plugins and add-ons are
outside these three tiers and keep the inventory's own separate precedence.

### The resolver: `resolveTiers`

`resolveTiers(rows, settings)` in `src/tiers/resolve.ts` is a pure resolver
that decides which holder of a skill or agent name a loop session is served.
It works in tier order (project, rafa, user) and only counts tiers the session
loads.

For each kind (`skill`, `agent`) and bare name, the resolver checks in order:

1. **`false` turns it off.** A name in `tiers.skills: { name: false }` or
   `tiers.agents: { name: false }` is off in every tier and never served.
2. **Unloaded.** No loaded tier holds the name.
3. **Pinned.** A `tiers.skills` or `tiers.agents` map names a tier to serve,
   and that tier holds it. The pin is the declared winner.
4. **Order wins.** All loaded holders are byte-identical copies (see below), so
   the nearest tier serves it, and the rest are its copies.
5. **Collision.** Two or more loaded tiers hold different items under the name,
   with no pin. Nothing serves it; `loop start` preflight and `plan validate`
   refuse before any session starts.

### Collisions and the byte-identical rule

Two or more loaded tiers holding the same kind and name with different contents
is a collision. The loop refuses it with a message naming both paths and
the one config line that settles it:

```yaml
tiers.skills: { documentation: project }
```

The pin names the nearest holder's tier as a default, since that holder would
have won by order. A project and a user item of one name are both `collision`
without a pin, but `enabled` and `shadowed` with `loop.settingSources` narrowed
to exclude `user`.

**The byte-identical rule.** Two holders are the same when their definition
files are byte-identical after removing every line of rafa's vendoring header
(`<!-- vendored by rafa from … on YYYY-MM-DD -->`). `rafa agent vendor` writes
that header when copying, so a copy it made compares equal to its source. The
comparison reads the bytes as `latin1`, which maps each byte to one character,
so it is exact where a UTF-8 decode would fold invalid sequences into U+FFFD.

Only the row's own file is compared (an agent's file, or a skill's `SKILL.md`).
Supporting files beside `SKILL.md` are not read, so two skill directories with
one `SKILL.md` and different scripts count as one item, served by the nearer.
A file the reader cannot read equals nothing. When all loaded holders of a name
are byte-identical, the nearest serves it and `doctor` suggests deleting the
copies.

This covers projects that took #127's workaround (copying bundled items
into `.claude/`), and this repository's own links from `.claude/` into
`src/bundled/`.

### Serving and provenance

Before each task or wrap-up session, rafa copies the tier winners Claude Code
would not load by itself into `.rafa/runs/<run>/served/` and hands them to the
session with session-only flags. Today that means rafa-tier winners only: a
user-tier winner is never served while `user` is not a loaded source. Project
items are left for Claude Code to load by itself.

**What is served.** Only winners are copied, so a collision, an item switched
off and a name set aside by a pin never reach a session. Because only winners
are passed, Claude Code's own precedence between flags never decides anything.
Copies are made with links followed, so the served tree holds no symlink.
A `self-update` during a run therefore cannot change what a running session was
given.

**The delivery mechanism.** Agents go through `--agents <file>` with JSON
mapping names to `{ description, prompt, ... }`. Skills go through `--add-dir
<served>` if the probed Claude Code version lists a skill from
`<served>/.claude/skills/` by its bare name under `--setting-sources
project,local`. The probe ran on 2026-09-24 against Claude Code 2.1.280
(`SERVE_CLI_VERSION`):

| Flag and argument | Planted where | Listed as |
|---|---|---|
| none (negative control) | nothing | no probe name |
| none, skill in cwd's `.claude/skills/` (positive control) | skill | bare |
| `--agents '<inline JSON>'` | agent | bare |
| `--add-dir <dir>` | `<dir>/.claude/skills/<n>/` | bare |
| `--add-dir <dir>` | `<dir>/.claude/agents/<n>.md` | bare |
| `--add-dir <dir>` | `<dir>/skills/<n>/` | not listed |
| `--plugin-dir <dir>` with `.claude-plugin/plugin.json` | skill, agent | `<plugin>:<n>` |

So `SKILL_DELIVERY` is `add-dir` in `src/tiers/delivery.ts`, pinned with
`SERVE_CLI_VERSION`. The served directory keeps the `.claude/` layout. A skill
served under `plugin-dir` would be named `rafa:<name>` in a session, but
`--add-dir` keeps the bare name. Agents are prefixed in either delivery, and
under `add-dir` are stored in `agents.json`. A CLI version other than
`SERVE_CLI_VERSION` means running the probe again before trusting the pin.

**Provenance and what blocks serving.** Each bundled skill and agent carries
`provenance:` in its frontmatter: either `first-party` or
`{ origin, license, reviewed? }` where `reviewed` is `<who> YYYY-MM-DD`. An
unreviewed third-party item is not served from the rafa tier. A rafa-tier
winner's verdict, from `serveVerdict` in `src/tiers/serve.ts`, is one of:

- **served**: a skill admitted, or an agent with its JSON entry
- **unreviewed**: third-party `provenance` with no `reviewed`
- **invalid-provenance**: a `provenance` value the checker refuses
- **unreadable**: the definition file cannot be read or lacks frontmatter
- **not-loadable**: a skill loose file rather than `<name>/SKILL.md`
- **invalid-definition**: an agent the CLI would refuse (empty description,
  empty body, or tools neither a list nor a comma string)

Only `served` items reach the session. The skipped item and reason appear in
`doctor` output and in test captures of what was served.

### Visibility to loop

An item is visible to a loop session if and only if:

- It is not shadowed by a nearer holder, AND
- It is not a collision, AND
- It is not switched off (`false`), AND
- Its source passes the visibility rule:
  - **project** items: always visible
  - **rafa** items: visible only when they are served (`serveVerdict` answered
    `served`)
  - **user** and **plugin:\<name\>** items: visible only when
    `loop.settingSources` includes `user`
  - **addon:\<name\>** items: never visible, because `claudeArgs` in
    `src/utils/claude.ts` passes no directory of theirs to a session

The inventory answers `visibleToLoop` as a boolean; `sourceVisibleToLoop` in
`src/inventory/index.ts` computes it. The loop reads the inventory to decide
which items a session can invoke.

### Disabled readings

`disabled:<how>` reads from the tier settings above, and from two places
outside the config:

- **`skillOverrides` setting**: when set to `off`, reads as
  `disabled:skillOverrides`; other values (`name-only`, `user-invocable-only`,
  `on`) do not disable. Reads from `.claude/settings.json`,
  `.claude/settings.local.json`, and `~/.claude/settings.json` (in that order
  of precedence). This code only READS; it never writes.
- **Frontmatter switches**: a frontmatter key that switches the item off
  reads as `disabled:<key>`. The one read today is
  `disable-model-invocation: true`, as
  `disabled:disable-model-invocation` (`src/inventory/disabled.ts`).

An item cannot be shadowed AND disabled; once shadowed, shadowing takes
precedence in `state`. A colliding item reads `collision` even when a
switch would disable it, since the loop refuses the name either way.

### Search and plan needs

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

### Settings files and the project root

**Settings files are read against the project root, sessions read them against
their cwd.** `overrideSettingsPath` joins `.claude/settings.json` and
`.claude/settings.local.json` onto `projectRoot`, while Claude Code resolves
them from the session's working directory, so for a session started from a
subdirectory every reader here — `visibleToLoop`, the MCP switches and
`rafa doctor --deep`'s Environment overlay — can name a file that session
never loads. The deep reading carries both directories and notes the mismatch
rather than resolving it. It also leaves out the `env` of `~/.claude.json`,
which Claude Code applies before any settings file, and the keys Claude Code
drops from a project-scoped `env`; its module note in
`src/commands/doctor-deep-env.ts` lists both.

### Plugins and add-ons

Plugins are recorded at `~/.claude/plugins/installed_plugins.json`; the
plugin reader scans that file to discover plugins and records each with
`source: plugin:<name>`. The reader pins the Claude Code version it was
written against (`PLUGINS_CLI_VERSION`) and the file's own `version` key
(`PLUGINS_RECORD_VERSION`) in `src/inventory/plugins.ts`; a record under
any other `version` is one warning row, not a guess. The MCP reader pins
its own (`MCP_CLI_VERSION`, `src/inventory/mcp.ts`).

Each inventory row carries these fields:

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
| `state` | `enabled`, `collision`, `shadowed-by:<source>`, `disabled:<how>`, or `off` |
| `visibleToLoop` | boolean: true when a session spawned under this project's `loop.settingSources` resolves it and loads it |
