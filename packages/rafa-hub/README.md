# rafa-hub

The rafa hub server syncs effort stores between a team's devices and serves the
settings every device must share. This package provides `rafa-hub`, a container
that listens on port 7373 and answers the four routes of the first plan for
[#325](https://github.com/open-tomato/rafa/issues/325): `/health`, `/v1/status`,
`/v1/effort/push` and `/v1/effort/pull`.

`rafa-hub` is one package of two under `packages/`; the other is
`@open-tomato/rafa-sync-service`, the client module that provides the `service`
sync strategy.

## Building and running

Build the container from the repository root:

```shell
docker build -f packages/rafa-hub/Dockerfile -t rafa-hub .
```

Run it with a volume on `/data` holding the config file:

```shell
docker run -d -p 7373:7373 -v rafa-hub-data:/data rafa-hub
```

The hub needs `/data/rafa-hub.yaml`, described below. With `hub.storePath` left
out, the SQLite store is opened beside the config, in `/data`, so the store
outlives the container restart. The hub writes its logs as JSON lines on
standard output; read them with `docker logs`.

The container includes a health check that asks `/health` every 30 seconds once
the startup period ends. The hub answers `503` until its store opens, so a
failing check means the store did not open; read the logs to see why.

## Configuration

The hub reads `RAFA_HUB_CONFIG`, an absolute or relative path to the YAML config
file, resolving relative paths against the working directory. In Docker, the
environment variable is set to `/data/rafa-hub.yaml`.

### `hub.repository`

The GitHub repository whose permission decides who may sync with the hub, as
`owner/name`. A caller needs `write`, `maintain` or `admin` on it; `read` and
`triage` are refused. This key is required unless `hub.projects` is set, and
refused beside it; there is no default. It is kept as written; GitHub's
characters are accepted.

### `hub.port`

The port the hub listens on. Must be a whole number from 1 to 65535. Defaults to
`7373`. The port `0`, which asks the system for a free one, is refused.

### `hub.storePath`

The absolute or relative path of the hub's SQLite store. Relative paths are
resolved against the config file's directory, so the hub opens the same store
however it is started. Defaults to `rafa-hub.sqlite` beside the config file.
Refused beside `hub.projects`, where each project names its own.

### `hub.projects`

The projects the hub serves, as a non-empty list. Each entry holds exactly
four keys: `id`, the project's root commit sha as 40 lowercase hex characters;
`name`, any non-empty text; `repository`, read as `hub.repository` is; and
`storePath`, required and resolved as `hub.storePath` is. Two entries with one
`id`, or whose `storePath` names one file, are refused. Set, it replaces
`hub.repository` and `hub.storePath`, and either key beside it is refused.

A push or a pull names its project by `project`, and one naming none is the
first listed project's. A push or a pull naming a project that is not listed is
answered `404` with this line:

```text
rafa-hub: project <id> is not served here; add it under hub.projects
```

Left out, the hub serves one project, with id `default`, named `hub.repository`,
in `hub.storePath`. That one project answers every request in it, whatever
`project` the request names or leaves out, so the refusal above never comes up.

### `hub.auth.adapter` and `hub.auth.apiKeys`

`hub.auth.adapter` names how the hub identifies a caller: `github`, the
default, or `api-key`; any other value is refused. `hub.auth.apiKeys` lists the
names of environment variables, never the keys themselves, each matching
`^[A-Z_][A-Z0-9_]*$`, such as `RAFA_HUB_KEY`. It is required and non-empty under
`api-key`, and refused under `github`. An entry that is no variable name is
refused by its position, such as `hub.auth.apiKeys[1]`, and the refusal never
repeats what was written, in case a key was pasted in place of its name.

Under `api-key`, the hub reads each named variable once, when it starts, and
serves a request whose `Authorization: Bearer` equals one of their values, or
one of the keys created through its key routes, which it keeps hashed in
`rafa-hub.keys.sqlite` beside `hub.storePath`. If a named variable is unset or
empty, the hub logs one `config.refused` line naming the variable and exits 1. Under `github`, a push or a pull naming a listed
project is checked against that project's `repository`. Every other request is
checked against the first listed project's.

### `hub.auth.cacheFor`

How long a served token's answer is kept in memory before asking GitHub again.
Accepts whole digits then `s`, `m` or `h` — for example, `10m` or `24h` — from
`1m` to `24h`. Defaults to `10m`. Set to `false` to ask GitHub on every request;
`true` and invalid durations are refused. The unit names `s` (seconds), `m`
(minutes) and `h` (hours), and fractional durations like `1.5h` are refused.

### `hub.store.sqliteLibrary`

The absolute path of a vanilla `libsqlite3` that the hub loads for its index,
on macOS only, as in `/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib`. A relative
path is refused, since the library is loaded once, before any database opens in
the process. Left out, it is null. Linux loads its extension through the SQLite
it already has, so the line is checked there and then not used. Vector search
stays off with this line set, because no embedder ships in this release; see
[The index](#the-index).

### `hub.index.rebuildAfterPush`

Whether the hub rebuilds the index of the pushed project after a push that added
rows. `true`, the default, rebuilds it after each such push; `false` leaves
rebuilds to `rafa-hub index rebuild`, run by the operator. Only the two booleans
are read: `'false'` and `0` are refused.

### Example configuration

The lightest configuration names only the repository:

```yaml
hub:
  repository: open-tomato/rafa
```

It serves one project from `rafa-hub.sqlite` beside the config, on port `7373`,
with a `10m` token cache, the index rebuilt after each push, and GitHub asked
about each token's permission. The lightest one that runs without GitHub is in
[Running a local hub](#running-a-local-hub).

A macOS hub that leaves rebuilds to the operator:

```yaml
hub:
  repository: open-tomato/rafa
  port: 7373
  storePath: /data/rafa-hub.sqlite
  auth:
    cacheFor: 10m
  store:
    sqliteLibrary: /opt/homebrew/opt/sqlite/lib/libsqlite3.dylib
  index:
    rebuildAfterPush: false
```

This example is a macOS hub that leaves rebuilds to the operator. With `port`,
`auth.cacheFor`, `store.sqliteLibrary` and `index.rebuildAfterPush` left out,
they take their defaults: `7373`, `10m`, none and `true`. The lightest
configuration above has neither index key: it answers `fts`, and `graph` when
the store holds `ref_links`, and `vector: false` with the notice below.

## Running a local hub

A hub on this machine for one device takes one config, one exported key and a
`hub.url` in the device's config. The config names the `api-key` adapter, so
the hub asks GitHub about nothing and the key is the only caller it knows:

```yaml
hub:
  repository: open-tomato/rafa
  auth:
    adapter: api-key
    apiKeys: [RAFA_HUB_KEY]
```

Save it as `rafa-hub.yaml`, export the key the config names, and start the hub
over the config:

```shell
export RAFA_HUB_KEY=<a long random value>
RAFA_HUB_CONFIG=./rafa-hub.yaml bun packages/rafa-hub/src/bin.ts
```

The device's project names the hub and the secret holding the key. The device
sends its secret as the bearer token, so the secret must hold the same value as
`RAFA_HUB_KEY`:

```yaml
effort:
  sync: service
hub:
  url: http://127.0.0.1:<port>
  tokenSecret: rafa-hub-key
```

`<port>` is the port the hub config names, `7373` when `hub.port` is left out.
The secret is read from the system secret store, not from the environment.

## The index

The hub keeps its index in `<store>.index.sqlite`, a file beside the store. For
the default store, `rafa-hub.sqlite` beside the config, that is
`rafa-hub.index.sqlite`. The devices table sits beside the store as well, in
`rafa-hub.devices.sqlite`. A push that adds rows writes a new store file and
renames it over the old one, so tables inside the store would vanish on the next
push; that is why the index is a file of its own. The index is never migrated. A
rebuild builds `<store>.index.sqlite.rebuild-<stamp>` beside the live file,
checks its counts and renames it over the live file in one step, so a search
reads a whole index. Deleting the index file is safe: a hub that starts builds
the index again, and a running hub's searches fail with a message naming
`rafa-hub index rebuild` until the rebuild runs.

The hub rebuilds the index after a push that adds rows, unless
`hub.index.rebuildAfterPush` is `false`. To rebuild by hand, run this on the
hub's host:

```shell
rafa-hub index rebuild
```

It reads the same config as the server and rebuilds the index of every listed
project in turn. For each one it prints one line on standard output, and exits 0
once all of them are rebuilt. A line names the project (`hub.repository` with
`hub.projects` left out, the project's id otherwise), the stamp, the row and
vector counts per table, and the vector state, which reads `vector off: no
embedder configured` in this release.

A failed rebuild prints one line on standard error and leaves that project's
live index as it was. The other projects are still rebuilt, and the command
exits 1. A refused config or a store that does not open prints one line on
standard error and exits 1 without rebuilding anything. A server
already running over the store picks up the new index file on its next query,
so it needs no restart. In the Docker container, run it with
`docker exec <container> bun /app/rafa-hub.js index rebuild`.

Vector search needs an embedder, which this release does not ship, so `vector`
is `false` on every hub, macOS included. A `vector` or `hybrid` search falls back
to full text and prints this notice once per process: `hub index: vector
search is off on this hub (no embedder configured); answering with full text`.

The reason reads `no embedder configured` once the sqlite-vec extension loads.
When it does not, the loader's own reason is printed: on macOS without
`hub.store.sqliteLibrary`, it reads `no SQLite library is named, and macOS's own
SQLite loads no extension`.

## Who may sync

Under `github`, a caller whose permission on the repository a project's
`repository` key names is `write`, `maintain` or `admin` may sync with that
project; `read` and `triage` are refused. With `hub.projects` left out, that is
`hub.repository`. The hub asks GitHub's public API about the caller's
permission; no deploy keys or personal access tokens are needed on the hub side.
The client's token (a GitHub token read with `Bun.secrets`) is sent by each
device in the `Authorization` header of each request. Under `api-key`, GitHub is
not asked: a caller is served by holding one of the keys `hub.auth.apiKeys`
names, or a key the hub's key list holds and has neither paused nor deleted.

## The device's `hub.project`

A device names the project it syncs on the hub with `hub.project` in its
`.rafa/config.yaml`, sent as `project` on each push and pull. Left out, it is
the root commit sha of the repository holding the store, the `id` that
`hub.projects` lists for that project, so nobody is expected to set it.

## What the ad-hoc recipe lacks

The `docker build` and `docker run` lines above provide a running hub with no
orchestration, image publishing, or log shipping. For a production deployment,
see [#503](https://github.com/open-tomato/rafa/issues/503).
