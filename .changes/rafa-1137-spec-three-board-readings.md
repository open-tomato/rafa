---
plan: rafa-1137-spec-three-board-readings
title: Three board readings read right
level: patch
---

- issues: `rafa issue unblock` and the unblock step of `rafa pr merge` now read a blocker the board's state listing did not hold with one `gh issue view` of its own, so a closed blocker on a large board clears its `spec:blocked` label instead of showing as `(state not read)`; a view that failed still removes nothing.
- plan: `rafa plan create` now reads a spec review whose `heading`, `what` or `assumption` value holds an unquoted `: ` by quoting the three values and parsing again, instead of recording `review: missing`; it warns one line per part of the review it could not read as written, a review read only after quoting included, and the planner is asked to put each gap's three values in double quotes.
- docs: The merge-time unblock reading documents how each blocker's state is read, one listing then one view per id the listing did not hold.
