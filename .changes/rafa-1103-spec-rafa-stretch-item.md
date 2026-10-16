---
plan: rafa-1103-spec-rafa-stretch-item
title: `rafa stretch item` prints the bugs its loop filed
level: patch
---

- tracker: The tracker port gains an optional `filedIssues(type, since)` listing of every issue of a type filed since a time, open or closed since; the GitHub tracker answers it with one `gh issue list --state all --search created:>=<since>`, and the local tracker from its records by `capturedAt`.
- stretch: `rafa stretch item` lists every bug filed since the last item, including one closed before the readings ran, each on one line with its number, title and the first line of its body; the open-bug count still reads the board's open `type:bug` issues, and the pit-stop skill's Bugs check reads the filed bugs from those closing lines instead of a raw `gh` search.
