---
plan: rafa-950-logger-port
title: Logger port — leveled, themed diagnostics behind a replaceable contract
level: minor
---

- ports: a `Logger` port for diagnostics joins the six ports, with levels `error`, `warn` and `debug`, child loggers that bind a module and an action, a cause code and a hint on each entry, and an `api` type for the filtered metadata of one request to a service; core registers `logger/console`, and a module manifest can provide a logger adapter of another kind
- config: a `logger` section with `level`, `modules.<module>.level`, `api`, `theme`, `callSite` and `kind`; `logger.level: error` quiets every warning a command writes, a module's own level shows or hides that module's entries, and `logger.api: true` or verbosity 3 writes `api` entries
- cli: the level prefix of a logger's line is coloured on a terminal, following `FORCE_COLOR` and `NO_COLOR`; json mode's `log` events keep their shape and gain an optional `fields` member; a tracker the chain passes over is now reported with the cause code `tracker:unavailable`
