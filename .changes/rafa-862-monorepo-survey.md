---
plan: rafa-862-monorepo-survey
title: Monorepo survey, the unattended part
level: patch
---

- survey: Added the monorepo survey scripts under `scripts/survey/`: an import graph with deterministic Louvain clusters and betweenness, concept, provenance and test-index maps, a doc inventory, a decision-source collector and a junit test-timing reader, each opening its summary with a coverage line that names any tracked file it did not read.
- docs: Added the survey's outputs under `docs/survey/`: the four maps with a Known suspects section, a contract trace for each of the 32 clusters, the doc inventory, the test-timing baseline, a guideline sheet marking each rule stated, inferred or conflicting, and a README indexing them all.
