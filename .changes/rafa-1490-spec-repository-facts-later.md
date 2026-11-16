---
plan: rafa-1490-spec-repository-facts-later
title: Repository facts: two readings of one CI fact count once
level: minor
---

- effort store: two readings of one CI fact now count once. Recording a CI reading, or `rafa effort merge` bringing one in, marks every later reading of the same fact superseded by the earliest in a new `reading_supersedes` table, and the store reads each fact once with its sightings, origins and last sighting.
- effort: `rafa effort report --skills` counts two readings of one CI result once, including readings joined by a merge, and shows a plan's CI by the fact sighted last, with red winning a tie, so a head that turns red again on a rerun shows red.
