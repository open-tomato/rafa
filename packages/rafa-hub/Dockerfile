# The rafa hub as a container: `rafa-hub` (src/bin.ts) run from its
# installed sources on the `oven/bun` image.
#
# Build from the repository root:
#
#   docker build -f packages/rafa-hub/Dockerfile -t rafa-hub .
#
# The build stage installs the hub's graph from `bun.lock` over the
# workspace manifests alone: the root `package.json`, `bun.lock` and every
# workspace's `package.json` (a frozen install refuses a lockfile whose
# workspaces are missing), then a frozen, production, script-free install
# filtered to `@open-tomato/rafa-hub`. Only then does it copy the sources,
# so a change to them leaves the install layer cached. The sources are the
# packages of the hub's workspace closure: the hub, core
# (`packages/rafa`), the store port, the postgres connector (with its
# `drizzle/` migrations beside its source) and the index, plus
# `tsconfig.packages.json`, whose `paths` map core's
# `@open-tomato/rafa/store` subpath to `packages/rafa/src`.
# `src/image.test.ts` holds both lists to the workspaces and that closure.
#
# The runtime stage runs those sources, not a bundle, so `sqlite-vec` and
# its platform package sit under `node_modules/.bun/` where
# `getLoadablePath()` finds them. `rafa-hub` on the PATH runs `bin.ts`, so
# `docker exec -it <container> rafa-hub login` works.
#
# Run it with a volume on /data holding the config file:
#
#   docker run -d -p 7373:7373 -v rafa-hub-data:/data rafa-hub
#
# RAFA_HUB_CONFIG names /data/rafa-hub.config.ts, the hub's config, which
# needs at least `hub.repository`; a volume holding /data/rafa-hub.yaml and no
# `.ts` file starts from that YAML, with one warning line. The start runs
# `rafa-hub install --data-dir=/data` first, which writes the install record
# /data/rafa-hub.install.json, then execs the server, so it gets the stop
# signals. With `hub.storePath` left out, the SQLite store is opened beside
# the config, in /data, so the store outlives the container. The install
# prints one plain-text line; then the hub writes its logs as JSON lines on
# standard output and no log file. Read them with `docker logs`.

ARG BUN_VERSION=1.3.14

FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY addons/atlas/data/package.json addons/atlas/data/
COPY addons/atlas/demo/package.json addons/atlas/demo/
COPY addons/atlas/rafa-atlas/package.json addons/atlas/rafa-atlas/
COPY addons/atlas/transport/package.json addons/atlas/transport/
COPY addons/atlas/ui/package.json addons/atlas/ui/
COPY addons/rafa-d2c/package.json addons/rafa-d2c/
COPY packages/rafa/package.json packages/rafa/
COPY packages/rafa-board/package.json packages/rafa-board/
COPY packages/rafa-effort/package.json packages/rafa-effort/
COPY packages/rafa-hub/package.json packages/rafa-hub/
COPY packages/rafa-hub-port/package.json packages/rafa-hub-port/
COPY packages/rafa-hub-postgres/package.json packages/rafa-hub-postgres/
COPY packages/rafa-index/package.json packages/rafa-index/
COPY packages/rafa-inventory/package.json packages/rafa-inventory/
COPY packages/rafa-pr/package.json packages/rafa-pr/
COPY packages/rafa-release/package.json packages/rafa-release/
COPY packages/rafa-run/package.json packages/rafa-run/
COPY packages/rafa-sync-service/package.json packages/rafa-sync-service/
RUN bun install --frozen-lockfile --production --ignore-scripts --filter=@open-tomato/rafa-hub
COPY tsconfig.packages.json ./
COPY packages/rafa packages/rafa
COPY packages/rafa-hub packages/rafa-hub
COPY packages/rafa-hub-port packages/rafa-hub-port
COPY packages/rafa-hub-postgres packages/rafa-hub-postgres
COPY packages/rafa-index packages/rafa-index

FROM oven/bun:${BUN_VERSION}-slim
COPY --from=build /app /app
RUN printf '#!/bin/sh\nexec bun /app/packages/rafa-hub/src/bin.ts "$@"\n' > /usr/local/bin/rafa-hub \
  && chmod 755 /usr/local/bin/rafa-hub \
  && mkdir /data && chown bun:bun /data
WORKDIR /app
USER bun
ENV RAFA_HUB_CONFIG=/data/rafa-hub.config.ts
VOLUME /data
EXPOSE 7373
# `rafa-hub health` reads the config as the start does and asks /health on
# the port it names (7373 when hub.port is left out); the hub answers 503
# until its store opens, which fails the check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["rafa-hub", "health"]
# Two steps: the install writes the record, then the server replaces the
# shell, so it is the process `docker stop` signals.
CMD ["sh", "-c", "rafa-hub install --data-dir=/data && exec rafa-hub"]
