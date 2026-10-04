---
plan: rafa-729-bug-sweep-4
title: Bug sweep 4 — store identity under inode reuse, and two macOS spawn causes
level: patch
---

- effort store: a copy or `.bak` restored over the store now gets its own origin even when the filesystem reuses the old inode number, because every write rotates a generation kept both in the store (a new nullable `store_meta.generation` column, added by an additive migration) and in an `effort.sqlite.generation` file beside it; existing stores keep their origin on upgrade
