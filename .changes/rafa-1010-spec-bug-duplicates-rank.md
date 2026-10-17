---
plan: rafa-1010-spec-bug-duplicates-rank
title: Rank a bug's Possible duplicates by cause and boundary, and show proposed codes
level: minor
---

- config: New `triage.similarity.weights.causeLeaf`, `causeFamily` and `boundary` settings (defaults 0.15, 0.05 and 0.10, each 0 to 1, where 0 turns that signal off), written commented out by `rafa init`.
- triage: A new bug's Possible duplicates list is now ranked by the word score plus a bonus for an open bug sharing its cause leaf, its cause family, or its module and action, weighed by the three `triage.similarity.weights` settings; each line names the signals it matched, such as `same cause` or `same module and action`. The same-bug decision at the threshold is unchanged.
- bug codes: `rafa bug codes --suggest` also ranks the cause codes open bugs proposed beside the list's, naming the bug that proposed each one; `--no-proposals` skips the tracker read, and a tracker that cannot be reached warns once and prints the suggestions without proposals.
- docs: `context/triage.md` and `context/error-codes.md` describe the ranked list, the three weights and how `--suggest` ranks proposed codes.
