---
plan: rafa-1469-spec-same-action-groups
title: Same-action groups count a lesson's wordings once
level: minor
---

- learning: A lesson learned under several wordings now counts its sources once: the library and the Learning port gain same-action groups, `promotable` names one record per group by its pooled confidence, `learning.promote.minConfidence` defaults to 0.6, the wrap-up records `promoted_to` on every wording of a promoted lesson, and the local adapter's push log names a new wording of a held action `same-action-group`.
- instinct: New `rafa instinct groups` lists each lesson held under several wordings with its action hash, triggers, source count and pooled confidence (`--output=json` gives the gold set), and `rafa instinct promote` shows each lesson's pooled confidence and source count.
- docs: The learning page describes the same-action group as the first way across trigger wordings.
