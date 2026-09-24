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
| `state` | `enabled`, `shadowed-by:<source>`, or `disabled:<how>` |
| `visibleToLoop` | boolean: true when a session spawned under this project's `loop.settingSources` resolves it |

### Sources and precedence

Precedence is nearest-first: **project**, **rafa**, **user**,
**addon:\<name\>**, **plugin:\<name\>**. The first holder of a given name and
kind is `enabled` (unless explicitly disabled); each later holder of that
name and kind is `shadowed-by:<source>` where `<source>` is the first holder's
source. A shadowed or disabled item is never visible.

### Disabled readings

`disabled:<how>` reads from two places:

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
precedence in `state`.

### visibleToLoop

An item is visible to a loop session if and only if:

- It is not disabled or shadowed, AND
- Its source passes the visibility rule:
  - **project** items are always visible
  - **user** and **plugin:\<name\>** items are visible only when
    `loop.settingSources` includes `user`
  - **rafa** and **addon:\<name\>** items are never visible, because
    `claudeArgs` in `src/utils/claude.ts` passes no directory of theirs to
    a session

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
