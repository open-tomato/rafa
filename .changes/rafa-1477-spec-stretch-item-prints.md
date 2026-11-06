---
plan: rafa-1477-spec-stretch-item-prints
title: `rafa stretch item` prints all five pit-stop readings
level: minor
---

- stretch: `rafa stretch item` now runs `rafa effort collect` once an item merges and closes with all five pit-stop readings: CI, open bugs, bugs filed since, an `Effort:` line for the item's plan, and a `Recheck #<n>:` verdict for each bug filed since the last item.
