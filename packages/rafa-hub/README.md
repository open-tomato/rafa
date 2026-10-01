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

The GitHub repository whose read permission decides who may sync with the hub,
as `owner/name`. This key is required; there is no default. It is kept as
written; GitHub's characters are accepted.

### `hub.port`

The port the hub listens on. Must be a whole number from 1 to 65535. Defaults to
`7373`. The port `0`, which asks the system for a free one, is refused.

### `hub.storePath`

The absolute or relative path of the hub's SQLite store. Relative paths are
resolved against the config file's directory, so the hub opens the same store
however it is started. Defaults to `rafa-hub.sqlite` beside the config file.

### `hub.auth.cacheFor`

How long a served token's answer is kept in memory before asking GitHub again.
Accepts whole digits then `s`, `m` or `h` — for example, `10m` or `24h` — from
`1m` to `24h`. Defaults to `10m`. Set to `false` to ask GitHub on every request;
`true` and invalid durations are refused. The unit names `s` (seconds), `m`
(minutes) and `h` (hours), and fractional durations like `1.5h` are refused.

### Example configuration

```yaml
hub:
  repository: open-tomato/rafa
  port: 7373
  storePath: /data/rafa-hub.sqlite
  auth:
    cacheFor: 10m
```

With `port` and `auth.cacheFor` left out, they take their defaults.

## Who may sync

Anyone with read access to the repository the `hub.repository` key names may
sync with the hub. The hub asks GitHub's public API about their permission; no
deploy keys or personal access tokens are needed on the hub side. The client's
token (a GitHub token read with `Bun.secrets`) is sent by each device in the
`Authorization` header of each request.

## What the ad-hoc recipe lacks

The `docker build` and `docker run` lines above provide a running hub with no
orchestration, image publishing, or log shipping. For a production deployment,
see [#503](https://github.com/open-tomato/rafa/issues/503).
