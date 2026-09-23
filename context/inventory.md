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
- **Frontmatter switches**: a frontmatter key that signals the item is disabled
  reads as `disabled:<key>`. Examples: `disabled:alpha`, `disabled:draft`.

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

### Search and plan needs

The `skill search` and `agent search` commands query the inventory to find
items matching a query. The `rafa plan needs` command reads the inventory to
populate a form that lists available skills and agents, helping a person
choose what to bind into their plan.

Both commands respect `visibleToLoop`: only items with `visibleToLoop: true`
are offered to search or bound into a plan's `needs` field.
