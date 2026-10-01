# rafa-sync-service

The `service` sync strategy: a device's effort store synced through
`rafa-hub` (`packages/rafa-hub/`). This package provides the `service` adapter
under the `rafa` module manifest, which core's `loadModules` registers as
`sync/service` when enabled.

`rafa-sync-service` is one package of two under `packages/`; the other is
`@open-tomato/rafa-hub`, the server that the service adapter reaches.

## Enabling the service strategy

The `service` strategy is not loaded by default. To enable it, add the module
under `modules:` in `.rafa/config.yaml` and allow it under `allowList:`:

```yaml
modules:
  - name: "@open-tomato/rafa-sync-service"
    from: npm

allowList:
  - name: sync
    kind: service
```

Once enabled, the module is discovered on startup and registered by
`src/modules/load.ts`. Commands that touch the store will refuse to run
without both lines when the project is set to `service` sync but the module
is not enabled or not trusted.

## Configuration

The `service` strategy is selected in `.rafa/config.yaml` with progressively
more configuration, from lightest to heaviest:

### Lightest: sync enabled, no hub

```yaml
effort:
  sync: service
```

With only `service` named and no hub configured, every command prints exactly
one line saying the hub is unreachable, uses the local store, and exits as it
would have. Rows sync on the next contact. This configuration allows a
project to declare intent to sync through a hub without requiring one to be
running.

### With hub URL

```yaml
effort:
  sync: service
hub:
  url: https://hub.example.org
```

The hub's address. The hub is reached at this URL as written, so if it is
served under a path prefix (for example, `https://host/rafa`), the config
names it exactly. A network error, timeout, or `5xx` response is treated as
unreachable and handled as above. Other errors are reported as refusals.

### With token secret

```yaml
effort:
  sync: service
hub:
  url: https://hub.example.org
  tokenSecret: rafa-hub-token
```

The secret's name in the secret store, never the token itself. The client
reads the GitHub token from `Bun.secrets` using the service name `rafa` and
the secret name provided (for example, `hub.tokenSecret: rafa-hub-token` reads
`Bun.secrets.retrieve("rafa", "rafa-hub-token")`). The secret is read once
when the first contact is made, on demand when a command syncs. If the secret
is not found or cannot be read, the sync is refused.

## Offline behaviour

When the hub is unreachable:

1. A command prints exactly one line: `effort sync: the hub at <url> is
   unreachable (<first line of why>); this command used the local store, and
   its rows sync on the next contact`.
2. The command uses the local store as if `sync: local` were set.
3. The command exits with the status it would have if no sync were attempted.
4. Rows are queued for sync on the next successful contact.

An unreachable hub does not prevent `rafa effort collect`, `rafa loop start`,
`rafa status`, `rafa next`, or `rafa effort report` from running. A push that
cannot reach the hub skips its pull, so a command waits for one timeout; a
pull that fails still reads the local store.

## How sync works

The adapter exports rows past a per-device cursor to the hub, and imports rows
other devices created. Both directions act on the SQLite file in
`RAFA_EFFORT_DIR` or `<root>/.rafa/effort/effort.sqlite`, through the wire
format core's `src/effort/sync/wire.ts` defines.

- **Push**: Exports rows this store created (identified by its origin pair)
  and sends them to the hub. Once the hub has taken them, the push cursor
  advances and the hub records the device's last push time.
- **Pull**: Asks the hub for rows other origins created past the pull cursor,
  builds them into a scratch store, and merges them into the local store with
  core's `mergeStore` (the only route by which rows from other devices reach
  the store). The merge's rules are documented in `context/effort-merge.md`.

A command syncs through one contact, once per invocation, and makes it when:
- `rafa effort collect` pushes then pulls once its rows are stored.
- `rafa loop start` makes one contact for its run and pushes then pulls at the
  end of each task, whatever its outcome.
- `rafa status`, `rafa next` (`--dry-run` included), and `rafa effort report`
  pull alone before they read, whether or not they write.

The rows the merge added are still the hub's to answer again on the next pull,
so a device pulling on every contact sees the same rows until it pushes. This
is safe and idempotent: a repeat merge of the same rows adds nothing new.

## When the project cannot sync

A project is refused if:

- **Store is NDJSON**: `rafa effort move --to=sqlite` migrates sessions and
  commits from NDJSON to SQLite before syncing is possible; NDJSON carries no
  origin pair, so rows cannot be identified as this device's.
- **No origin in the store**: A store written only outside a git repository,
  or by a rafa older than origins, has no `origin_store` to identify it. A
  command run inside the project's git repository mints one.
- **Incoming rows name unknown migrations**: The hub holds migrations this
  rafa does not know. `rafa self-update` brings this rafa to a build that
  knows them, and sync can then proceed.

For the first two cases, every command that touches the store prints the
refusal; for the third, the pull action alone is refused, and the next push
will be queued.
