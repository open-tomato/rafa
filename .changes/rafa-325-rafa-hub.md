---
plan: rafa-325-rafa-hub
title: rafa-hub, the service a team's devices sync the effort store through
level: minor
---

- rafa-hub: New `@open-tomato/rafa-hub` server that a team's devices sync their effort stores through, with health, status, push and pull routes, a SQLite store, access for anyone with write permission on the configured GitHub repository, YAML config from `RAFA_HUB_CONFIG`, and a Docker recipe.
- Sync: New `@open-tomato/rafa-sync-service` module that provides the `service` sync strategy. It pushes new effort rows to the hub, merges the rows other devices pushed, and asks for `rafa self-update` when the hub's store is newer than your rafa.
- Configuration: New `hub.url`, `hub.tokenSecret` and `hub.timeout` settings. `effort.sync: service` is refused without `hub.url`, and the token is read from the system secret store, never from config.
- Effort store: `rafa effort collect` and each loop task now push and then pull through the project's sync strategy. `rafa status`, `rafa next` and `rafa effort report` pull before they read. With the hub unreachable, a command prints one line and carries on with the local store. The `./store` entry now exports the JSON sync wire codec, `mergeStore` and `TRUSTED_PERMISSIONS`.
- Documentation: READMEs for both packages, and the Sync section of `context/effort-store.md` rewritten for the `service` strategy and the `hub.*` keys.
