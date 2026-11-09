---
plan: rafa-1565-spec-release-steps-carry
title: Release steps carry their place
level: minor
---

- config: New `hints.skills` key (default `false`) lets a project opt in to a `skill: rafa-release › <case>` line under each release step that has a case file.
- release: Every `Next:` step of `rafa release tag`, `settle` and `publish` now runs where it is clicked, with `cd <checkout> &&` only when you stand in another checkout; `settle` ends with its next step (merge and `rafa release tag --push`, `rafa pr wait` first after a pull request, or a nothing-to-tag line), also as a `next` list in JSON, and `publish` with no release tag at HEAD names a `rafa release tag` step.
