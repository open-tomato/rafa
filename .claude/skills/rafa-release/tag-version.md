---
case: tag-version
---

# tag-version

Key: `version`, a `rafa release tag` refusal reason.

## What it means

The version file of the unit could not be read, declares no version, or was
not found in the history. Without a version the tag has no name.

## The check

Open the version file the refusal names. Its `version` field has to be a
string. `rafa release status` shows the version files side by side with the
changelog and the tags.

## The step that clears it

`check <path>`: the file has to declare the version under `"version"`.
Settle writes that field into the commit it makes, so a file without it was
not left by settle. Check the file's history to see what wrote it.
