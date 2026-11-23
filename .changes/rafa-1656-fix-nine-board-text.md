---
plan: rafa-1656-fix-nine-board-text
title: rafa-1656 — nine board-text regexes that cannot be held up by an issue body
level: patch
---

- board: nine patterns that read issue, epic, roadmap and pull request bodies now run in linear time, so a crafted body (a long run of spaces in a heading, task line, closing keyword or trailing text, or a long run of letters and digits on a Blocked by line) no longer stalls the epic, blocked-by, readiness, issue-edit and roadmap readers for seconds or minutes
