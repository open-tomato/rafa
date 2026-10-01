# The rafa hub as a container: `rafa-hub` (src/bin.ts) bundled into one
# file and run on the `oven/bun` image.
#
# Build from the repository root, since the hub imports core's
# `@open-tomato/rafa/store` subpath, which resolves through the root's
# `tsconfig.packages.json` to `src/` (context/source.md):
#
#   docker build -f packages/rafa-hub/Dockerfile -t rafa-hub .
#
# Run it with a volume on /data holding the config file:
#
#   docker run -d -p 7373:7373 -v rafa-hub-data:/data rafa-hub
#
# /data/rafa-hub.yaml is the hub's config (RAFA_HUB_CONFIG), which needs
# at least `hub.repository`. With `hub.storePath` left out, the SQLite
# store is opened beside the config, in /data, so the store outlives the
# container. The hub writes its logs as JSON lines on standard output
# and writes no log file; read them with `docker logs`.

ARG BUN_VERSION=1.3.14

FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /repo
COPY package.json tsconfig.base.json tsconfig.packages.json ./
COPY src ./src
COPY packages/rafa-hub ./packages/rafa-hub
RUN bun build packages/rafa-hub/src/bin.ts --target=bun --outfile=/out/rafa-hub.js

FROM oven/bun:${BUN_VERSION}-slim
WORKDIR /app
COPY --from=build /out/rafa-hub.js ./rafa-hub.js
RUN mkdir /data && chown bun:bun /data
USER bun
ENV RAFA_HUB_CONFIG=/data/rafa-hub.yaml
VOLUME /data
EXPOSE 7373
# Asks /health on the port the config names (7373 when hub.port is left
# out); the hub answers 503 until its store opens, which fails the check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const config = Bun.YAML.parse(await Bun.file(process.env.RAFA_HUB_CONFIG).text()); const port = config?.hub?.port ?? 7373; const response = await fetch(`http://127.0.0.1:${port}/health`); process.exit(response.ok ? 0 : 1);"]
CMD ["bun", "/app/rafa-hub.js"]
