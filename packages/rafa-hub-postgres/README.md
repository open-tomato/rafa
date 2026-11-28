# rafa-hub-postgres

The hub's `postgres` connector. It keeps a hub's rows and its search index in
Postgres, through `connectPostgresHub`, on Drizzle over the `Bun.sql` driver
(`drizzle-orm/bun-sql`). The hub starts it under `hub.store.engine: postgres`;
nothing else starts it. Every device keeps `bun:sqlite`: the hub promises the
wire contract, not an engine.

This page is the setup guide for an operator. The config keys are described in
[`packages/rafa-hub/README.md`](../rafa-hub/README.md), in "The Postgres
engine". The sizing options and the hardware sections are in
`docs/requirements.md`, the requirements page.

## Which setup to pick

Three shapes, lightest first:

1. **One machine, no hub.** Leave `hub.store.engine` unset. The hub keeps its
   store in `bun:sqlite`, as before, and this package is not used.
2. **A small hub.** Postgres with the small-hub settings block below. Full text
   only (`fts`) until the hub has room for an embedding model.
3. **An organisation's hub.** Many teams on one Postgres with `pg_search` and
   `pgvector`, with vectors on once a model is configured.

## Setup

The connector needs a Postgres database with two extensions available:

- `pg_search`, ParadeDB's BM25 index, which answers `fts`.
- `pgvector`, listed in `pg_extension` as `vector`, which answers `vector` once
  an embedder is given.

**Licence review is open.** `pg_search` is licensed under AGPL-3.0. Anyone who
ships or hosts this connector for others should have that licence reviewed
before they do. That review has not been done.

### 1. Run the database

The CI service uses the `paradedb` image, pinned by digest. A compose file for
a small hub looks like this:

```yaml
services:
  postgres:
    image: paradedb/paradedb:0.26.4-pg18
    environment:
      POSTGRES_USER: rafa
      POSTGRES_PASSWORD: <a long random value>
      POSTGRES_DB: rafa
    command:
      - postgres
      - -c
      - shared_buffers=64MB
      - -c
      - maintenance_work_mem=64MB
      - -c
      - work_mem=4MB
      - -c
      - max_connections=20
      - -c
      - max_parallel_workers_per_gather=0
      - -c
      - max_parallel_maintenance_workers=0
      - -c
      - effective_cache_size=128MB
```

The `command` list passes the settings block below as server flags. The same
keys can go in a `postgresql.conf` instead. The image's own defaults assume a
large host, so leaving them out is not a small-hub setup.

### 2. Install the extensions

The hub does not create the extensions. Install both on the database the URL
names:

```sql
CREATE EXTENSION pg_search;
CREATE EXTENSION vector;
```

A database missing either one refuses the hub's start and the message names
each one it lacks, for example:

```text
hub postgres: the database lacks the extension pg_search; install pg_search on it (CREATE EXTENSION) before the hub starts on postgres
```

### 3. Give the hub the URL

The URL comes from an environment variable, never from the config file. The
variable is `POSTGRES_URL` unless `hub.store.postgres.urlVariable` names
another. An unset or empty variable refuses the start, and the message names the
variable, never its value.

```shell
export POSTGRES_URL=postgres://rafa:<the password>@localhost:5432/rafa
```

### 4. Point the hub's config at Postgres

```yaml
hub:
  repository: open-tomato/rafa
  store:
    engine: postgres
```

With the URL exported and the extensions installed, the hub opens the connector
before it listens. The connector reads `pg_extension` first, then applies its
migrations to the project's own schema. A project has one schema for its rows,
so projects never share tables.

`hub.store.postgres` written under the default `sqlite` engine is refused,
since nothing would read it.

### Models: with or without one

Without `hub.index.embedding.model`, `vector` is `false` and `fts` and `graph`
serve. That is a working hub, not a degraded one. This release hands no embedder
to either engine, so `vector` stays `false` with a model named too; see
[the hub's README](../rafa-hub/README.md#the-postgres-engine). The rest of this
section is what a hub does once an embedder is given. Changing the model or the
precision restarts the hub with `vector` `false`, and a job re-embeds the rows
from their text while `fts` answers. A vector written under another stored
record is refused, and the refusal names both records.

## The small-hub settings block

These are the settings for a host of about 512 MiB:

| Setting | Value |
|---|---|
| `shared_buffers` | `64MB` |
| `maintenance_work_mem` | `64MB` |
| `work_mem` | `4MB` |
| `max_connections` | `20` |
| `max_parallel_workers_per_gather` | `0` |
| `max_parallel_maintenance_workers` | `0` |
| `effective_cache_size` | `128MB` |

The spike ran with these values, in a 200 MiB container on a laptop (measured).
The real hub has not been measured with them yet, so treat them as a starting
point. The `paradedb` image's defaults assume a large host, with 3.8 GB of
`shared_buffers`, which does not fit a small one.
`shared_buffers` takes effect only after a restart.

## `maintenance_work_mem`: the HNSW build

A vector index is an HNSW graph, and Postgres builds it in
`maintenance_work_mem`. When the graph is larger than that setting, the build
spills to disk, and it runs far slower. So the rule is: keep
`maintenance_work_mem` above the size of the graph the build makes.

The 64 MB in the block holds a graph for only a few rows. As a rough check,
multiply the rows by the build's cost per row, which is 8.2 KB under `vector`
and 4.1 to 4.3 KB under `halfvec` at 768 dimensions, each vector stored twice.
That product is derived from the per-row cost and is not the graph's size. It
says when the 64 MB is certainly too small, at about 15,000 rows under `halfvec`
(derived). Measure the real graph on the hub before relying on any figure.

The connector does not set this value itself, so a build runs with the
server's setting. A server-wide change is one way to raise it; a session can
also set a larger value for itself with `SET` before a rebuild, which leaves
the server's setting alone. Check what a session has with:

```sql
SHOW maintenance_work_mem;
```

## Reading a container's memory

A container's memory reading sits near its limit under normal use. The kernel
counts the page cache against the container, and Postgres reads fill that
cache, so a full reading in `docker stats` is not a fault. The cache is given
back when memory is needed.

The signal is a restart. If the kernel kills the database for running out of
memory, the container's state shows it:

```shell
docker inspect -f '{{.State.OOMKilled}} {{.State.ExitCode}}' <container>
```

`true 137` means the kernel killed the process. A restart with that reading is
the thing to act on: lower the settings, or give the container more memory.
Nothing else in the reading is.

## Tests

The connector's tests reach a database only through `POSTGRES_URL`, and each
test drops only the schemas it created. Run them from this package's folder:

```shell
POSTGRES_URL=postgres://rafa:<the password>@localhost:5432/rafa bun test
```

## Drizzle files

Drizzle owns the connector's schema and migrations. The schema is
`src/schema.ts`, and the migrations, their journal and their snapshots sit in
`drizzle/`, checked in. A schema change is a new migration from
`bun run db:generate`. A shipped migration file is never edited by hand, since
the migrator refuses a logged migration whose file has changed.
