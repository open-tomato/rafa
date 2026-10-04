---
plan: rafa-639-rafa-loop-wait
title: rafa loop wait — wait on a running loop for one event, on awake time
level: minor
---

- Loop: every loop run now writes its events to `.rafa/runs/<session-id>.events.ndjson`, one JSON line per event in every output mode, ending with an `error` line when the run throws.
- CLI: new `rafa loop wait` follows a running loop until it opens a PR, ends without one, halts, fails, blocks, goes quiet on awake time or exits, and answers with one `rafa·` line and an exit code per reason.
- Operators: the stretch engineer and watchtower now wait with `rafa loop wait` instead of hand-built log pollers.
