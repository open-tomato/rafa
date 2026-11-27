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

The build copies every workspace's `package.json` with `bun.lock`, installs the
hub's graph from the lockfile alone, and then copies the sources of the hub and
the workspace packages it imports. The container runs those sources, not a
bundle, through the `rafa-hub` command on its `PATH`, so `sqlite-vec` loads from
its installed package. Each start runs `rafa-hub install --data-dir=/data`
before the server, which writes the install record
`/data/rafa-hub.install.json`.

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
`rafa-hub.keys.sqlite` in the install record's `dataDir`, the config file's
directory by default. For one release, a keys file found only beside
`hub.storePath`, its old place, is opened there with one `keys.old-place`
warning naming the new place; move it into `dataDir`. If a named variable is
unset or empty, the hub logs one `config.refused` line naming the variable and exits 1. Under `github`, a push or a pull naming a listed
project is checked against that project's `repository`. Every other request is
checked against the first listed project's.

### `hub.auth.login`

Under `api-key`, the hub keeps a login that guards its key routes: the key page
at `/login` and the routes under `/v1/keys`. `hub.auth.login.mode` picks it.
`basic`, the default, is one user name and one password, kept as a hash in
`rafa-hub.keys.sqlite` and set by `rafa-hub login` (see
[Keys under `api-key`](#keys-under-api-key)). `oauth` hands sign-in to a
provider instead. Under `oauth`, `hub.auth.login.oauth` is required and holds
`authorizeUrl`, `tokenUrl`, `userUrl`, `clientId`, `clientSecretVariable` and
`allowed`, all required, and `scope` and `callbackUrl`, optional. Under `basic`
it is refused. `clientSecretVariable` names the environment variable that holds
the client secret, never the secret itself.

When no login is set, the hub reads `RAFA_HUB_LOGIN_USER` and
`RAFA_HUB_LOGIN_PASSWORD` at start and sets the login from them, logging
`login.set` with the user name. A login already set is kept, so a restart with
the variables still exported changes nothing. A variable left empty logs
`login.incomplete` naming it.

The login grants the key routes alone. `/v1/status`, `/v1/effort/push`,
`/v1/effort/pull` and `/v1/settings/locked` never accept it, so a login
cannot sync. Under `github` a written `hub.auth.login` is refused, and the
login and key routes answer `404`.

The hub serves plain HTTP. Under `basic`, the password crosses the network in
clear unless TLS fronts the hub or the hub listens on a loopback address
(`127.x.x.x`, `localhost` or `::1`). The hub listens on every interface and no
config key narrows that, so under `basic` it logs one `login.insecure` warning
when it starts listening; `oauth` is not affected by this warning. Put a TLS
terminator in front of the hub for any use beyond one machine.

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

This key is read for this release only. The library is an install fact, so
`rafa-hub install --sqlite-library=<absolute path>` records it in the install
record, `rafa-hub.install.json`, and the hub loads the library the record names.
With the key set, the hub loads its library and logs one `config.deprecated`
warning naming `rafa-hub install`. A record and a key that name different
libraries stop the start with one `config.refused` line, and
`rafa-hub index rebuild` exits 1 on the same mismatch.

### `hub.index.rebuildAfterPush`

Whether the hub rebuilds the index of the pushed project after a push that added
rows. `true`, the default, rebuilds it after each such push; `false` leaves
rebuilds to `rafa-hub index rebuild`, run by the operator. Only the two booleans
are read: `'false'` and `0` are refused.

### `hub.store.engine`

The engine the hub keeps its rows and index in. `sqlite`, the default, keeps one
`bun:sqlite` file per project, as [The index](#the-index) describes. `postgres`
keeps them in a Postgres database, for an organisation's hub; see
[The Postgres engine](#the-postgres-engine). Any other value is refused. Every
device keeps `bun:sqlite` whatever the hub runs on: the hub promises the wire
contract, not an engine.

### `hub.store.postgres.urlVariable`

Under `engine: postgres`, the name of the environment variable holding the
Postgres connection URL. It defaults to `POSTGRES_URL`, the variable `Bun.sql`
reads first. The URL comes from that variable alone, never from the config file:
there is no `hub.store.postgres.url` key. The name matches
`^[A-Z_][A-Z0-9_]*$`, and a refusal never repeats what was written, in case a
URL with a password was pasted in place of the name. An unset or empty variable,
white space alone counting as empty, refuses the start. The message names the
variable, never its value:

```text
hub postgres: the environment variable POSTGRES_URL is unset; set it to the Postgres URL the hub stores in
```

`hub.store.postgres` written under `engine: sqlite`, the default included, is
refused, since nothing would read it.

### `hub.index.embedding.model` and `hub.index.embedding.precision`

`hub.index.embedding.model` names the model the hub embeds text with: non-empty
text with no white space at either end, such as `nomic-embed-text-v1.5`. Left
out, it is null. `hub.index.embedding.precision` is how a vector is stored:
`half`, the default, with 2-byte floats, or `full`. Any other value, such as
`16`, is refused, whether or not a model is named. There is no
`hub.index.embedding.dimension` key: the model's dimension is a fact of the
install, not a setting.

This release hands no embedder to either engine, so `vector` is `false` on every
hub whatever model is named. The two keys are read and checked now. What a
search falls back to is in [The index](#the-index).

### `dangerous.hub.maxPayloadRows`

This key sits in a `dangerous` section beside `hub`, not under it. It is the
most rows one push may carry and one pull page may answer. It defaults to
`50000`, and `unlimited` lifts it. A whole number from 1 up is read; `0` and
`-1` are refused. The hub answers the cap as `maxPayloadRows` in its contract
and on `/v1/status`. The device's contact splits every push under it by cursor,
so a big push goes through in payloads and no flag is needed. There is no
`--batch` option.

A client that ignores the field and sends a payload over the cap is refused,
with a message naming `dangerous.hub.maxPayloadRows` and nothing taken. A value
above the default, or `unlimited`, makes the hub log one `config.dangerous`
warning when it starts listening, naming the key and its value. The section is
named `dangerous` because one request can hold the hub's memory for as long as
it runs.

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
The hub listens on every interface, so under the default `basic` login it logs
`login.insecure` at start; see [`hub.auth.login`](#hubauthlogin).

## The index

This section describes the `sqlite` engine, the default. Under `postgres` the
index lives in the database; see [The Postgres engine](#the-postgres-engine).

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
`docker exec <container> rafa-hub index rebuild`.

Vector search needs an embedder, which this release does not ship, so `vector`
is `false` on every hub, macOS included. A `vector` or `hybrid` search falls back
to full text and prints this notice once per process: `hub index: vector
search is off on this hub (no embedder configured); answering with full text`.

The reason reads `no embedder configured` once the sqlite-vec extension loads.
When it does not, the loader's own reason is printed: on macOS with no SQLite
library in the install record or `hub.store.sqliteLibrary`, it reads `no SQLite
library is named, and macOS's own SQLite loads no extension`.

## The Postgres engine

Under `hub.store.engine: postgres`, the hub's rows and index live in Postgres,
through the `@open-tomato/rafa-hub-postgres` connector. The connector opens at
start, before the hub listens, and a connector that does not open stops the
start. The URL comes from the variable `hub.store.postgres.urlVariable` names;
see the key above.

The database must have two extensions loaded:

- `pg_search`, ParadeDB's BM25 index, which answers `fts`.
- `pgvector`, listed in `pg_extension` as `vector`, which answers `vector` once
  an embedder is given. This release gives none, so `vector` stays `false`.

The open reads `pg_extension` and refuses when either is missing, naming each
one it lacks. The message reads:

```text
hub postgres: the database lacks the extension pg_search; install pg_search on it (CREATE EXTENSION) before the hub starts on postgres
```

Install the extensions on the database; the hub does not create them.

`fts` and `graph` answer from the database when their parts are there: `graph`
is `true` once the store holds `ref_links`. Full text and the graph serve with
`vector` `false`, which is a working hub, not a degraded one.

**Licence review is open.** `pg_search` is licensed under AGPL-3.0. Anyone who
ships or hosts this connector for others should have that licence reviewed
before they do. That review has not been done.

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

## Keys under `api-key`

A key the hub's key list holds is made by the key routes, and the login signs
the caller into them. Set the login first, then mint keys:

```shell
rafa-hub login
rafa-hub keys create laptop
```

`rafa-hub login` asks for a user name and a password at a terminal, twice for
the password, and writes the login into `rafa-hub.keys.sqlite` in the install
record's `dataDir` (at the old place beside `hub.storePath` for one release,
with one warning line, when the file is found only there); a running hub reads
it on its next request. `rafa-hub keys`
reaches the hub at `--hub=<url>` or `RAFA_HUB_URL`, and signs in with
`RAFA_HUB_LOGIN_USER` and `RAFA_HUB_LOGIN_PASSWORD` when both are set, asking
for them otherwise. A hub whose login is `oauth` answers with a line pointing to
`<url>/login`, where a person signs in through the provider.

Each key's life runs through these states:

- **Created.** `rafa-hub keys create <name>` prints the plain key alone on
  standard output, the one time anyone sees it. The key is `rafa_` followed by
  32 random bytes in base64url. The hub keeps only its SHA-256 digest and never
  logs the key.
- **Active.** The key serves every hub action. Each request it serves stamps
  its last use, which `rafa-hub keys list` shows.
- **Paused.** `rafa-hub keys pause <name>` refuses the key as forbidden, with a
  message naming the key's name. This release has no command that unpauses it.
- **Deleted.** `rafa-hub keys delete <name>` marks the key deleted and keeps its
  name and last use. A deleted key is refused as unknown, with a message that
  names nothing it carried.

A name matches `^[a-z0-9][a-z0-9._-]{0,63}$`. It is unique over every key ever
created, deleted ones included, so a deleted name is never reused, and it never
equals a variable `hub.auth.apiKeys` names. `rafa-hub keys list` prints one line
per key, deleted ones included: its name, its state, who created it and when,
and its last use, `never` when it has served nothing.

The key routes are `GET` and `POST /v1/keys`, `POST /v1/keys/<name>/pause` and
`DELETE /v1/keys/<name>`. The mutating ones need a same-origin `Origin` or none,
which the CLI sends, and a JSON body, so a page on another site cannot drive
them with the browser's cached basic credentials. Under `github` they answer
`404`.

## The device's `hub.project`

A device names the project it syncs on the hub with `hub.project` in its
`.rafa/config.yaml`, sent as `project` on each push and pull. Left out, it is
the root commit sha of the repository holding the store, the `id` that
`hub.projects` lists for that project, so nobody is expected to set it.

## What the ad-hoc recipe lacks

The `docker build` and `docker run` lines above provide a running hub with no
orchestration, image publishing, or log shipping. For a production deployment,
see [#503](https://github.com/open-tomato/rafa/issues/503).
