# rafa

The agent task loop for ralph, packaged and ready to ship. A single-package
implementation of the loop from `agentic-research`, with all the pieces
running under bun and ready for publishing to npm as `@open-tomato/rafa`.

## Context pages

One page per tag, each the authority for its own subject; read the page your
task touches. The pointers below are plain paths on purpose — written in
the import form `CLAUDE.md` uses for this file, they would pull all pages
back into every turn and the split would save nothing.

- `context/workflow.md` — branch, PR and merge, the task-shape routing
  table, and what each agent does.
- `context/verification.md` — the gate order and how to read their
  captures.
- `context/effort-store.md` — the store port, its two backends, the
  SQLite-only tables, and what a new kind or field has to touch.
- `context/source.md` — import paths under `src/` and the shapes the lint
  config forces.
- `context/cli.md` — `RafaCommand`, the command registry, routing, module
  command entries, and the dispatcher's events and exit code.

## This file is capped

**80 lines.** `CLAUDE.md` imports it into every turn of every session, so
it carries the project context and the pointers above and nothing else.
A finding promoted out of `progress.txt` therefore goes to the `context/`
page that owns its subject, or to a new page listed above; never inline
here.
