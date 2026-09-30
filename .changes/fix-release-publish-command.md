---
plan: fix-release-publish-command
title: The publish line `rafa release tag` prints comes from config
level: patch
---

- Release: `rafa release tag` prints the publish follow-up from `release.publishCommand` instead of the manifest's `packageManager` field, so a `bun@…` manifest no longer gets `bun publish`; the line still publishes from the tag when HEAD is past it.
- Config: new `release.publishCommand` (free text, default `npm publish`), refusing an empty value; `rafa init` writes it commented out.
