---
plan: rafa-1271-spec-monorepo-pass-1
title: Pass 1 of the monorepo migration, the cut
level: patch
---

- internal: the 36 root files that reach no feature package (the logger, the bug record and title, the module loader, the project readers, the plan-file readers, the git, progress and tracker utilities and four config sections) now live in core's package and are imported by their subpaths; the cut table names the 60 root files each feature package holds, and a coupling reading and a stale-path sweep join the gates
