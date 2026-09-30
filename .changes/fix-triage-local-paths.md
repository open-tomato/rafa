---
plan: fix-triage-local-paths
title: Triage takes local paths out of filed bugs and their keys
level: patch
---

- Triage: a path under the repository root is filed relative to it, and a home directory as `[redacted: HOME]`, in every title, body, comment, query and recurrence key; a reference stored under the old absolute-path key is still found
