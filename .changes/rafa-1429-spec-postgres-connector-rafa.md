---
plan: rafa-1429-spec-postgres-connector-rafa
title: The hub's Postgres connector
level: minor
---

- rafa-hub: The hub can run on Postgres: `hub.store.engine` picks `sqlite` (the default) or `postgres`, whose URL comes from the variable `hub.store.postgres.urlVariable` names (default `POSTGRES_URL`), and a start under `postgres` exits 1 when that variable is unset or empty or the database lacks `pg_search` or `pgvector`; new keys `hub.index.embedding.model` and `hub.index.embedding.precision` (`half` or `full`) name the embedding, and `dangerous.hub.maxPayloadRows` (default 50000, `unlimited` for no cap) caps a payload, so a push over it is refused with 413, every pull answers pages of at most that many rows, and `/v1/status` answers `maxPayloadRows` with the embedding model, hash and dimension (null when vectors are off); the hub's container image builds again.
- hub: The new `postgres` connector keeps one schema per project, merges pushes by origin pair, rebuilds its search index into a fresh build schema and swaps to it in one transaction while searches keep answering, builds the first index at start, walks links over the build's `ref_links`, and measures full text, links and vectors at open.
- rafa-hub-postgres: The postgres hub records its embedding model, hash, dimension and precision, stores vectors as `halfvec` or `vector` by precision, refuses vectors made under another record, re-embeds from text while full-text search serves when the model or precision changes, and names the real reason when vector search is off.
- sync: The sync client reads the hub's `maxPayloadRows` from its status answer, and holds no SQL of its own: it reads a store's origin through core, and a test keeps it that way.
- effort sync: A hub sync splits a big push into payloads under the hub's `maxPayloadRows` and keeps pulling while a page comes back full.
