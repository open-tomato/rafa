---
plan: fix-mac-test-failures
title: The 12 macOS test failures of 0.36.0, each fixed
level: patch
---

- Effort store: on macOS the host id reads `/usr/sbin/ioreg` by its full path, so a run under a PATH without `/usr/sbin` no longer falls back to the hostname, reads its own store as a copy and mints it a new store id.
- Sync service: a test process (`RAFA_TEST=1`) naming `RAFA_TEST_SECRETS_FILE` reads its hub token from that JSON file rather than `Bun.secrets`; nothing changes outside a test process.
- Tests: a spawned case's scratch PATH holds `/usr/bin` and `/bin` after git's directory (`hostToolDirs()` in `src/tests/stand-in-gh.ts`), so stand-ins find `cat` on macOS; the hub's two device suites plant their token in a test secrets file, touch no system secret store and no longer skip, and the `Bun.secrets` probe they gated on is removed.
- Documentation: `context/verification.md` names the scratch PATH's system directories, and the sync service README the test secrets file.
