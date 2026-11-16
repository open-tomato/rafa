---
plan: rafa-1427-spec-contractversion-wire-status
title: A contract version both sides of the sync carry
level: minor
---

- effort store: The store entry now exports `WIRE_CONTRACT_VERSION`, the sync wire contract's version, and a lock freezes each shipped version's wire version, migration ids and row fields.
- rafa-hub: The hub's store port now reports the wire contract it speaks: its contract version, migration ids and capabilities. `GET /v1/status` answers all three, and push and pull refuse a contract version the hub doesn't speak with `409 contract-unsupported`.
- sync: The hub sync client reads the hub's status once per run, sends its contract version on push and pull, and still syncs with an older hub that names no version. A hub speaking another version is refused before anything is exported or sent, naming both versions and the next step.
- effort sync: A hub speaking another contract version now produces one warning line, the pull after it is skipped, and the command's exit code is unchanged.
