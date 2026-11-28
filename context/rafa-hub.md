# The hub

The hub is `packages/rafa-hub`, the server that syncs effort stores between a
team's devices, and the storage connectors it can run on. This page is the
authority for that subject. The operator's setup is in
`packages/rafa-hub/README.md`; the Postgres connector's setup is in
`packages/rafa-hub-postgres/README.md`. The wire contract the devices and the
hub share is in `context/effort-store.md`, under "Wire contract".

## Install record

`rafa-hub.install.json` is the install record: what `rafa-hub install` decided,
kept beside the file `RAFA_HUB_CONFIG` names (`/data/rafa-hub.install.json` in
the image). It is to the hub what a lockfile is to a project: written by the
install, read at start, never edited. Its format, reader and writer live in
`packages/rafa-hub/src/install-record.ts`.

Format `1` holds six keys:

- `installVersion`, the record's format, `1`.
- `hub`, the version of the hub that wrote it.
- `bun`, the Bun version the install ran on.
- `dataDir`, the absolute directory the hub keeps what it writes in: the config
  file's directory by default.
- `sqliteLibrary`, the absolute path of the SQLite library to load, or `null`
  for Bun's own.
- `models`, one `{ id, path, hash, dimension }` per installed embedding model,
  `hash` the SHA-256 of the model file; empty until one is installed.

There is one writer, `rafa-hub install`, in
`packages/rafa-hub/src/cli-install.ts`: it writes the whole record each time it
runs. A flag left out keeps the value the record already holds, so a start that
passes only `--data-dir` keeps a library or a model recorded earlier. Nothing
else writes the file.

The reader is `readInstallRecord`, called at start by `bin.ts` and by the key
commands in `cli-keys.ts`. It answers as follows:

- No file: the defaults (`dataDir` the config file's directory, no library, no
  models) and one warning line.
- A file that exists but cannot be read: refused.
- An `installVersion` other than `1`: refused.
- A `hub` naming another version than the running hub: refused.
- Not JSON, not an object, or a key missing, unknown or of the wrong shape:
  refused.

Every refusal names the record's path and ends with `run rafa-hub install`.

The keys file, `rafa-hub.keys.sqlite` under `api-key`, sits in the record's
`dataDir`, as `keysFileName` in `packages/rafa-hub/src/identity/key-store.ts`
gives it. For one release, a keys file found only beside `hub.storePath`, its
old place, is opened there with one `keys.old-place` warning; move it into
`dataDir`.

The config key `hub.store.sqliteLibrary` is an alias of the record's
`sqliteLibrary`, read for this release only. With the key set and no library in
the record, the hub loads the key's library and logs one `config.deprecated`
warning naming `rafa-hub install`. With both naming the same library, the
record's is loaded and the warning is given. Two different libraries stop the
start with a refusal, so remove the key once the record names the library.

## Running config

`RAFA_HUB_CONFIG` names the hub's config file. `readHubConfig` in
`packages/rafa-hub/src/config-file.ts` reads it and answers the config with the
form and the path it was read from. The serving start, `rafa-hub install` and
`rafa-hub health` all read through it, so the three refuse the same file in the
same sentences.

Two forms are read:

- `.ts`, the form the operator's guide writes: a module whose default export is
  the config. It loads through `createLoader` from `@open-tomato/define-config`
  with the section schemas `hubSectionSchemas` answers, `hub` and `dangerous`,
  and the merged value goes through `readHubDocument` in `config.ts`.
- `.yaml`, the legacy form, read by `parseHubConfig` in `config.ts`. A name
  ending in neither `.ts` nor `.yaml` is read as YAML too.

`locateHubConfig` decides which file is read:

- `rafa-hub.config.ts` and `rafa-hub.yaml` both in the named file's directory
  refuse the start, naming both paths, whichever of the two is named.
- A named `.ts` file that exists is read in the `.ts` form.
- A named `.ts` file that is missing, beside a `rafa-hub.yaml`, reads that YAML
  file as the fallback. This keeps a volume written before the `.ts` form
  starting.
- A named `.ts` file that is missing, with no `rafa-hub.yaml` beside it, is
  refused, naming the `.ts` path.
- A path holds a file only when it names a regular file, so a directory named
  like either file is no file. A named `hub.config.ts` beside a `rafa-hub.yaml`
  loads, since the both-files rule looks only at the two names.
- `RAFA_HUB_CONFIG` unset or empty is refused, naming the variable.

The top level holds only `hub` and `dangerous`, and `dangerous` holds only
`hub`. `config-top-level.ts` refuses every other key with its path and where it
belongs: a project key points to the project's `rafa.config.ts`, a
served-project key (`projects` and its four keys) to `hub.projects`, and any
other key names the two sections, and under `dangerous` the one it holds. An
`install` key is refused in both forms, naming `rafa-hub install`, since the
install's values live in the install record that command writes. A function
value is refused wherever it is written, naming its key path, because the hub's
config declares no extension point and runs no function.

A serve start that reads YAML, named or as the fallback, logs one `config.yaml`
warning once the hub listens (`yamlConfigWarning` in `config-file.ts`, logged by
`bin.ts`). The line names the YAML file, the `.ts` file to write beside it and
`rafa 1.0.0`, the release that stops reading YAML. For a named YAML file it also
names the `.ts` file `RAFA_HUB_CONFIG` has to name. No command writes the `.ts`
form: the warning is the move. From `rafa 1.0.0` a YAML config is refused.
`rafa-hub install` and `rafa-hub health` print no such warning, since health
runs every 30 seconds. A config the reader refuses is logged as one
`config.refused` line holding every problem, and the serve command exits 1
without listening.

`rafa-hub health` (`cli-health.ts`, `runHealth`) reads the config through the
same loader, then asks `http://127.0.0.1:<hub.port>/health` of the hub on this
machine, with a 5 s wait (`HEALTH_TIMEOUT_MS`). It exits 0 when the hub answers
`200`, and 1 otherwise: when the config is refused, when the hub answers another
status (a redirect is not followed), or when the hub is not reached. Its reason
goes to standard error, each line opening `rafa-hub health`. It takes no
arguments past `health`. The image's `HEALTHCHECK` runs `rafa-hub health`, and
its entry is the `rafa-hub` wrapper on the `PATH`.

## Connectors

A connector is one storage engine behind the hub. It opens a `HubStore`, which
keeps the rows (push, pull and status), and a `HubIndex`, which answers
full-text and vector search and the walks over `ref_links`. Both types live in
the leaf package `@open-tomato/rafa-hub-port`
(`packages/rafa-hub-port/src/port.ts`), so a connector in a package of its own
imports the port and never the hub. A `HubConnector` opens both over one
context.

The connectors the hub knows are listed by name in `HUB_CONNECTORS`, in
`packages/rafa-hub/src/store/connectors.ts`:

- `sqlite`, the default, `connectSqliteHub` in
  `packages/rafa-hub/src/store/sqlite.ts`.
- `postgres`, `connectPostgresHub` of `@open-tomato/rafa-hub-postgres`, which
  reads its URL from the variable `hub.store.postgres.urlVariable` names, by
  default `POSTGRES_URL`.

`hub.store.engine` picks one of them by name. A new connector goes into
`HUB_CONNECTORS`, and its name goes into the engine values that
`packages/rafa-hub/src/config-store.ts` accepts.

Both contract suites run over every connector in that registry, by name:
`contract.ts` for the rows and `index-contract.ts` for the index. The in-memory
stand-in in `contract.test.ts` is no connector: it has no index, and it runs the
row suite on its own.

Capabilities are measured when a connector opens, and they are never all `true`.
`fts` is `true`. `graph` is `true` once the store holds `ref_links`. `vector` is
`true` only when pgvector is loaded and an embedder was given. `projection` is
`false` on the Postgres connector, so the hub's route refuses a device that asks
for projected rows.

**The leak rule.** No Drizzle type, query builder, SQL fragment, transaction
handle or `Bun.sql` type crosses `HubStore` or `HubIndex`, and none appears in
an export of `@open-tomato/rafa-hub-postgres`. Only the port's types and plain
values cross. Drizzle owns the Postgres schema and its migrations, generated by
`drizzle-kit` into `packages/rafa-hub-postgres/drizzle/`, with the journal
checked in.

**Storage on Postgres.** Each project has one schema for its rows. The index
lives in copied tables, never on the row tables: each build is a schema named
`index_<project>_<build>`, and a pointer table in the project's schema names the
serving build. A rebuild fills a new build while the serving one answers, then
moves the pointer to it.

**Migrations.** The Postgres connector's migrations never enter
`SQLITE_MIGRATIONS`, the device store's own list. `status().migrations` and
`contract().migrations` answer the device's wire migration ids that the Postgres
schema mirrors. `packages/rafa-hub-postgres/src/wire-migrations.ts` maps each
Drizzle migration to the wire ids it covers. A migration that changes no wire
table covers none.

Every device keeps `bun:sqlite`. The hub promises the wire contract, not an
engine, so a device syncs with a hub on either connector the same way.
