---
case: tag-tagged
---

# tag-tagged

Key: `tagged`, a `rafa release tag` refusal reason.

## What it means

A tag of the unit already names the version, as in `v0.46.0 already names
0.46.0, so there is nothing to tag`. Only the unit's own tags count. A
package's `<name>@<version>` tag does not hold the root's version, and a
root tag does not hold a package's.

## The check

`git tag --list` shows the tags the repository holds. The one the refusal
names is the one that stops the unit.

## The step that clears it

`rafa release status` shows the fragments still waiting. Those fragments go
into the next version through `rafa release settle`, so there is nothing to
tag until then.

A run refuses with this reason only when every unit is skipped. A unit that
is tagged beside an untagged one is skipped, and the untagged one is tagged.
