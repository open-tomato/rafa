---
case: settle-nothing
---

# settle-nothing

Key: outcome `nothing`, a `rafa release settle` ending.

## What it means

No fragment waiting on the base ships a release, so settle folded nothing.
The output carries a line that begins `Nothing to settle:`, and it ends on
the sentence `Nothing to tag either: every unit keeps its version.` A dry
run that finds the same ends the same way.

## The check

`rafa release status` shows the fragments waiting on the base and what
version they would give.

## The step that clears it

None. Nothing is to be tagged, and the sentence carries no step. If a change
should have shipped, its fragment is not on the base yet. `rafa release
status` shows what is waiting, and a fragment that is missing from that list
is the thing to look for.
