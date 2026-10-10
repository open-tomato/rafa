---
plan: rafa-904-spec-library-code-stops
title: Library code stops importing from `src/commands/`
level: patch
---

- tests: A new commands-direction sweep fails on any import into `src/commands/` from a non-test file outside it, and on a split command file that re-exports its library half with `export … from`.
- documentation: `context/source.md` states the direction rule, its sweep, the two exempt files and two edge-case examples.
