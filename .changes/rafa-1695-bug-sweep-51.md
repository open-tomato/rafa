---
plan: rafa-1695-bug-sweep-51
title: rafa-1695 — Bug sweep 51: nine bugs filed in stretch 117
level: patch
---

- rafa-hub-postgres: A hub Postgres migration that fails now rejects once, leaves no unhandled rejection behind, and returns its reserved connection to the pool.
- loop: Under `--continue`, a held stop that a stop decision ends, or one that needs a decision under `--output=json`, now ends on a `halt` naming the hold and the task, so `rafa loop wait` and `rafa stretch item` read its reason; `loop start` refuses a first run on a claim branch holding commits other than claims, naming the branch, the first such commit and a recut line that keeps every claim commit; and a plan saved with CRLF line endings gives its own title to the release and the pull request again.
- docs: The survey record now says a branch behind its base is refused on a first claimed dispatch.
