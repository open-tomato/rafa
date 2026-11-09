---
case: tag-changelog
---

# tag-changelog

Key: `changelog`, a `rafa release tag` refusal reason.

## What it means

The newest section of the changelog names another version than the version
file, or names no release at all, or the changelog cannot be read. A tag
names a version that a changelog section has to hold. Settle writes the
version and its section in one commit, so the two disagreeing means they
came apart by hand, or no settle has run for this version.

A workspace package whose changelog is absent gets the step below, whose why
says the package is passed over until it is released.

## The check

The refusal names the version file, the changelog path, and the version each
one says. Read the newest heading of that changelog.

## The step that clears it

- A changelog that cannot be read: `check that <path> is readable`.
- A changelog that is absent, for a package: `rafa release settle`. Its why
  says the package is passed over until it is released.
- Otherwise: `rafa release settle`, which writes the version and its
  changelog section in one commit. Tag does not write either.
