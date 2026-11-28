# Requirements: the Postgres connector

Written 2026-11-27 for #1429. This page sets out the database options for the
hub's `postgres` connector, two image examples, the two client shapes, and what
a Raspberry Pi, a Kubernetes pod and a sandbox under 200 MB can carry. It gives
options and ballpark figures. It is not a sizing contract.

The hub promises contract 1 and not an engine. Every device keeps `bun:sqlite`,
so a device syncs with a Postgres hub the way it syncs with a sqlite one. The
setup steps are in [the connector's README](../README.md). The operator's keys
are in [the hub's README](../../rafa-hub/README.md), under "The Postgres
engine".

The hub reads five keys for this connector: `hub.store.engine`,
`hub.store.postgres.urlVariable`, `hub.index.embedding.model`,
`hub.index.embedding.precision` and `dangerous.hub.maxPayloadRows`. The URL is
not a key. It comes from the environment variable that
`hub.store.postgres.urlVariable` names, `POSTGRES_URL` by default.

## How to read the figures

Each figure carries one mark:

- **measured**: read from the spike of 3 and 5 November 2026, on an Apple M1
  Pro laptop and a 15 GB Linux host, over an anonymised extract of a real store.
- **derived**: arithmetic on measured figures.
- **projected**: scaled from those runs, and never run.

The extract held 12,660 rows. The store held 23,853 rows on 26 November, about
1.9 times that, so the figures describe fewer rows than the store now holds.
Every figure here is a ballpark until the real hub is measured.

## Options for the database

The connector needs a Postgres database with two extensions. The first is
`pg_search` (AGPL-3.0), ParadeDB's BM25 index, which answers full text. The
second is `pgvector`, which answers vectors. The hub refuses to start on a
database missing either one, and names each one it lacks.

**Licence.** `pg_search` is AGPL-3.0. Anyone shipping or hosting the connector
for others should have that position reviewed. The review is open, and this page
does not assess it.

| Option | Pros | Cons |
|---|---|---|
| The `paradedb` image | Both extensions in one image, built for amd64 and arm64 | `pg_search` (AGPL-3.0) releases often, so pin the image by digest |
| Official Postgres on Debian, plus the `pgvector` and `pg_search` (AGPL-3.0) packages | Follows the official image; one image of your own for each extension you add | You build and update the image. No Alpine base, since `pg_search` (AGPL-3.0) has no Alpine build |
| A separate cluster beside an existing shared Postgres | Nothing changes for the databases already there; its own port or domain | One more server to run, back up and give memory |
| Both extensions added to an existing shared Postgres | One server for everything | Needs a Debian base, a restart for `shared_preload_libraries`, and a `REINDEX` of text indexes if the base moves from Alpine. `pg_search` (AGPL-3.0). One upgrade pace for every database on the server |
| A managed Postgres service | No server to run | `pgvector` is widely offered. `pg_search` (AGPL-3.0) is not everywhere, so check the provider first |

A team that already shares a Postgres usually runs the separate cluster beside
it, so nothing the shared server holds changes.

## Two image examples

Both examples pass the URL to the hub as `POSTGRES_URL`. Neither puts the URL in
a config file.

### The `paradedb` image

```yaml
# compose: the paradedb image. It ships pg_search (AGPL-3.0) and pgvector.
services:
  hub-db:
    image: paradedb/paradedb:0.26.4-pg18
    environment:
      POSTGRES_PASSWORD: ${HUB_DB_PASSWORD}
    ports: ["127.0.0.1:55433:5432"]
    volumes: ["hub-db:/var/lib/postgresql"]
volumes:
  hub-db: {}
```

A hub on the same host reads the URL from its environment:

```shell
export POSTGRES_URL=postgres://postgres:<the password>@127.0.0.1:55433/postgres
```

This example has no small-hub settings. For a small hub, add the settings block
from the connector's README as server flags, as that README's compose file does.

### The official Postgres image with both extensions

```dockerfile
# The official image plus the two extensions. pg_search (AGPL-3.0) is
# installed from ParadeDB's release, and the CMD below preloads it.
FROM postgres:18-trixie
ARG PG_SEARCH=0.26.4
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-18-pgvector curl ca-certificates \
 && curl -fsSL -o /tmp/pg-search.deb \
    "https://github.com/paradedb/paradedb/releases/download/v${PG_SEARCH}/postgresql-18-pg-search_${PG_SEARCH}-1PARADEDB-trixie_$(dpkg --print-architecture).deb" \
 && apt-get install -y /tmp/pg-search.deb && rm /tmp/pg-search.deb \
 && rm -rf /var/lib/apt/lists/*
# pg_search (AGPL-3.0) must be preloaded at server start.
CMD ["postgres", "-c", "shared_preload_libraries=pg_search"]
```

Run the image with `POSTGRES_PASSWORD` set. Give the hub `POSTGRES_URL` as
in the first example.

## Client shapes

A device runs one of two shapes. A client does not fetch vectors from the hub: a
fetched vector cannot answer a typed question without a model, so a device that
wants vector search runs its own model.

| Client shape | Memory | Works offline | Use it when |
|---|---|---|---|
| Full text only | about 35 MB (projected) | yes | the device is a sandbox under 200 MB |
| Local model | about 210 MB (derived) | yes | a laptop, or a pod with room |

The local model's figure is the client's 60 MB process peak, measured in the
spike, plus the model's about 150 MB resident, as the spike reported it. The
model adds its memory to whichever role runs it, so a role that must stay under
200 MB cannot also hold one.

## What a build costs

A build's cost is quoted per row, never as one total. A row costs 8.2 KB under
`vector` and 4.1 to 4.3 KB under `halfvec`, at 768 dimensions (derived), because
each vector is stored twice: in the table and in the HNSW index. A build is its
rows times that cost. Today a build covers every row. Once #1653 lands, it
covers the quotable rows only.

A rebuild fills a new build while the serving build answers, then points the
project at the new build in one step. This release keeps one build per project.
Keeping older builds for rollback is #1463's, and so is the setting that says
how many to keep.

## Small-hub settings

The spike ran with these values, in a 200 MiB container (measured). A real hub
has not been measured with them. The `paradedb` image's defaults assume a large
host, with 3.8 GB of `shared_buffers`.

| Setting | Value |
|---|---|
| `shared_buffers` | `64MB` |
| `maintenance_work_mem` | `64MB` |
| `work_mem` | `4MB` |
| `max_connections` | `20` |
| `max_parallel_workers_per_gather` | `0` |
| `max_parallel_maintenance_workers` | `0` |
| `effective_cache_size` | `128MB` |

`shared_buffers` takes effect only after a restart. The HNSW build needs
`maintenance_work_mem` above the graph's size, or it spills to disk. The
connector's README has the rule.

## Raspberry Pi class device

A Pi 5 with 4 to 8 GB and an SSD runs the hub with the small-hub settings and
either client shape. A Pi 4 with 2 to 4 GB and an SSD runs it too, with slow
index builds, and its clients use full text only.

| Device | Hub on Postgres | Client shape |
|---|---|---|
| Raspberry Pi 5, 4 to 8 GB, SSD | yes, with the small-hub settings | both shapes |
| Raspberry Pi 4, 2 to 4 GB, SSD | yes, slow builds | full text only |
| Any Pi on an SD card | avoid: wear and slow builds; a cold scan takes seconds (derived) | full text only |

Once an embedder runs on the hub, its embedding job for today's rows is
projected at 12 to 20 minutes on a Pi 5 and 31 to 47 minutes on a Pi 4. No
figure here comes from a Pi: the spike ran on a laptop.

## Kubernetes pod

A pod of 256 to 512 MiB runs the hub with the small-hub settings. Its clients
use full text only.

- Request the working set, and set the limit about 1.3 to 1.6 times the
  request. The spike's figures give a request of 192 MiB and a limit of 256 MiB
  at 12,660 rows, and 320 MiB and 512 MiB at 63,000 rows (derived, the second
  from a projection). The 1.5 of the rule of thumb sits inside that range.
- Set `shared_buffers` and `maintenance_work_mem` in the pod's command, rather
  than leaving the image's defaults.
- Run the index rebuild as its own job. A rebuild beside the live index needs
  more memory than serving does.
- If parallel workers are on, mount an in-memory `emptyDir` at `/dev/shm`. The
  small-hub settings turn them off, so the mount is needed only when they are
  raised.
- Use a persistent volume on SSD-class storage.
- A container reading full is normal, because the page cache counts toward the
  limit. A restart with the reason `OOMKilled` is the signal to act on.

None of this has run in a real cluster.

## Sandbox under 200 MB

A sandbox under 200 MB holds a client on full text only, about 35 MB
(projected). The local model shape, at about 210 MB, does not fit.

No measurement here shows a hub under 200 MB. The spike's hub ran inside a 200
MiB container with 12,660 rows and `halfvec` at 768 dimensions: 47 MiB idle, a
sampled peak of 141 MiB, 92 MiB afterwards, and 55 MB on disk (measured). 200
MiB is about 210 MB, above a sandbox's limit, so a hub under 200 MB is not
measured.

## Not measured yet

Left for the real hub: embedding speed on arm64, cold-cache queries on an SD
card, retrieval quality and `halfvec` recall with a real model, concurrent
writes during reads, and a real Kubernetes cluster. The Pi and pod rows drop
the word "projected" only once the real hub has been measured.
