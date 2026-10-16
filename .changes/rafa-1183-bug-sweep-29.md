---
plan: rafa-1183-bug-sweep-29
title: Copy core into the hub image and lint `*.mts` and `*.cts`
level: patch
---

- hub: The `rafa-hub` container image builds again. Its build stage now copies `packages/rafa`, where core lives since #1090, so the `@open-tomato/rafa/store` subpath resolves inside the image.
- docs: The monorepo survey trace now says the hub image copies `packages/rafa` beside `src`, matching the repaired Dockerfile.
