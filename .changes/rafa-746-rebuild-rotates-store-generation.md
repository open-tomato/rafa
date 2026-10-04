---
plan: rafa-746-rebuild-rotates-store-generation
title: A rebuild rotates the store's generation
level: patch
---

- store: Every store rebuild (merge, migrate, fix-schema) now rotates the store's generation, so a backup or replaced file renamed back over the store takes a new store id on its first write, even on a filesystem that reuses inode numbers.
