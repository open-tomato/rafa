---
plan: rafa-1089-spec-core-stops-importing
title: Core stops importing anything above it
level: patch
---

- Library: core's adapter registry is now filled by a composition root, `src/adapter-registry.ts`, instead of importing the adapters itself: the package entry exports `registerAdapters`, `restoreAdapters` and `activeAdapterRegistry`, `CORE_ADAPTER_REGISTRY` reads the registered set at call time and refuses, naming that root, while nothing is registered, so a consumer of the `./store` subpath alone finds no store adapter until it has imported the root entry
- Docs: `context/source.md` now describes the adapters as handed in by `src/adapter-registry.ts` and marks the adapters-barrel cycle note retired, and `context/cli.md`, `context/logging.md` and `context/effort-store.md` name that file as the place core's adapters are registered
