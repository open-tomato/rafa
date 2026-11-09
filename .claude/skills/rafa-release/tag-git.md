---
case: tag-git
---

# tag-git

Key: `git`, a `rafa release tag` refusal reason.

## What it means

A git read the decision needs did not run: the list of tags, or the look-up
of the commit that set the version. The refusal says what git answered.
Nothing was written.

## The check

`git status` in the checkout the step names shows whether git answers there
at all. A checkout that git cannot read is the usual cause.

## The step that clears it

`git status`, then `rafa release tag` again. If git answers now, the failure
was a passing one, and the second run decides the unit afresh.
