---
name: drizzle-orm
description: Use when touching the database layer — generating Drizzle migrations or resolving migration conflicts during a rebase.
prevents: hand-written migrations and a journal or snapshot chain broken by a rebase
signal: loud
when_to_use: "You are changing the database schema, generating a migration, or untangling migration files during a rebase. Prevents: hand-written migrations and a journal or snapshot chain broken by a rebase"
tags:
  - drizzle
  - orm
  - shell
  - sql
stack:
  - shell
  - sql
---

> Scope: file paths in this document are relative to `packages/service/` (the `@ar/service` package), except `.claude/`, the plans directory, the specs directory, and `tools/`, which live at the umbrella repo root.

# Database & Drizzle ORM

This app uses SQL databases (SQLite or Postgres) and drizzle ORM.

Generate SQL migrations by running this:

```sh
bun db:generate
```

IMPORTANT: Do NOT generate SQL migration files by hand! This is wrong.

## Drizzle migration conflicts during rebase

When rebasing a branch that has drizzle migrations conflicting with upstream (e.g., both have `0023_*.sql`):

1. Keep upstream's migration files (they're already deployed to production)
2. Rename the PR's conflicting migration to the next available index (e.g., `0023_romantic_mantis.sql` → `0025_romantic_mantis.sql`)
3. Update `_journal.json` to include all migrations with correct indices
4. Create/update the snapshot file (`00XX_snapshot.json`) with the new index, updating `prevId` to reference the previous snapshot's `id`
5. If the PR had subsequent commits that deleted/modified its migration files, those changes become no-ops after renaming — just accept the deletion conflicts by staging the renamed files

## Guides
Additional guides can be found in the [Guides](https://orm.drizzle.team/docs/guides) section of Drizzle documentation.
