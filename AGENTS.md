# rafa

The agent task loop for ralph, packaged and ready to ship. A single-package
implementation of the loop from `agentic-research`, with all the pieces
running under bun and ready for publishing to npm as `@open-tomato/rafa`.
The hub's two packages sit beside it as bun workspaces under `packages/`.

The `rafa` CLI is installed here: read `.claude/skills/rafa-tooling/SKILL.md`
before running or suggesting any `gh`, `rafa` or branch-cleanup command.

## Context pages

One page per tag, each the authority for its own subject; read the page your
task touches. The pointers below are plain paths on purpose — written in
the import form `CLAUDE.md` uses for this file, they would pull all pages
back into every turn and the split would save nothing.

- `context/workflow.md` — branch, PR and merge, the task-shape routing
  table, and what each agent does.
- `context/verification.md` — the gate order and how to read their
  captures.
- `context/effort-store.md` — the store port, its two backends, row
  origins, store metadata, copy detection, sync (push, pull, registry,
  file exchange, locked keys), and what a new kind or field has to touch.
- `context/effort-merge.md` — merge rules, the `rafa effort merge` and
  `rafa effort move` commands, and the merge trail.
- `context/source.md` — import paths under `src/` and `packages/`, and the
  shapes the lint config forces.
- `context/inventory.md` — the record, sources and precedence, disabled
  readings, `visibleToLoop`, plugin discovery, and how search and plan needs
  use the inventory.
- `context/learning.md` — the library and its rules, the conversion from
  finding to lesson, the adapter's held set and logs, the wrap-up's
  promotion check, the config keys and trigger identity.
- `context/cli.md` — `RafaCommand`, the command registry, routing, module
  command entries, the core roster, the dispatcher's events and exit code,
  the help levels with their snapshots, and the `describe` roster.
- `context/pull-requests.md` — the `pr` subject, the provider and its
  preflight items, merge, triage assessment and --resolve, trust, and the
  readiness gate for plans from the board.
- `context/triage.md` — the channels, the two-step match and the keys,
  inherited failures, the state read on a repeat, and similarity settings.
- `context/terminology.md` — formal and colloquial names: the ledger,
  lore and hindsight, and how prose introduces them.
- `context/release.md` — fragments and the fold, settle and its deliveries,
  the receipt rule with adoption boundary, the guards, readers, and seven keys.
- `context/notices.md` — the alpha and skip-permissions notices: where they
  are shown, how they are dismissed, and what a test's HOME must hold.
- `context/operators.md` — the alpha operators under `bundled/operators/`:
  why no loop sees them, the stretch folder, and the events output.

## This file is capped

**80 lines.** `CLAUDE.md` imports it into every turn of every session, so
it carries the project context and the pointers above and nothing else.
A finding promoted out of `progress.txt` therefore goes to the `context/`
page that owns its subject, or to a new page listed above; never inline
here.
