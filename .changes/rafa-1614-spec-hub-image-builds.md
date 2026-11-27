---
plan: rafa-1614-spec-hub-image-builds
title: The hub image builds, loads sqlite-vec and writes its install record
level: minor
---

- rafa-hub: The hub image now installs its packages from `bun.lock` and runs them from source, so `sqlite-vec` loads, and each start writes an install record (`rafa-hub.install.json`) through the new `rafa-hub install` command (`--data-dir`, `--sqlite-library`, `--model`; flags left out keep the existing values). The hub reads that record before its config, refuses a record from another hub version or an `install` key in its config file, keeps its keys file in the record's `dataDir`, and reports on its `store.opened` line whether `sqlite-vec` loaded; the old keys-file place and `hub.store.sqliteLibrary` are still read for one release, with a warning.
- docs: The hub README describes the new image (the lockfile install, the files in `/data`, the install record, the start line, login and keys in the container, `linux/arm64`) and sets the SQLite library with `rafa-hub install --sqlite-library`; `context/rafa-hub.md` gains an "Install record" section.
