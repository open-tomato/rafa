---
plan: rafa-1428-spec-hub-index-port
title: The hub's index port, with FTS5 and sqlite-vec on the sqlite connector
level: minor
---

- rafa-hub: Read `hub.store.sqliteLibrary` (an absolute path to a vanilla libsqlite3) and `hub.index.rebuildAfterPush` (default `true`) from the config, rebuild the index in the background after a push that adds rows (one at a time, logging `index.rebuilt` or `index.rebuild-failed`), and add `rafa-hub index rebuild` to rebuild it once and print its counts.
- hub: The sqlite connector opens a search index beside its store, `<store>.index.sqlite`, with full-text, vector, hybrid and graph search whose capabilities are answered from what loaded at open.
- docs: The hub config docs name the two new keys, and the cut table's header and its rafa row match the package rows in its JSON.
