---
case: tag-receipt
---

# tag-receipt

Key: `receipt`, a `rafa release tag` refusal reason.

## What it means

The changelog section for the version carries no receipt. A receipt is the
`<!-- rafa:fragments … -->` comment that settle writes into the section,
naming the fragments it folded. Or the changelog has no section for the
version at all, so no receipt names it.

Tag refuses a version above the adoption boundary without one. The boundary
is the version of the newest section below the oldest receipted one. Every
version at or below it was released before settle existed, and may go
without a receipt. A version above it was not written by settle, so it has
to be released by settle.

## The check

Look for the receipt comment in the section the refusal names. Then run
`rafa release status`. Its audit names every heading with no root tag above
the adoption boundary.

## The step that clears it

`rafa release settle`, which writes the release, and its receipt, into the
changelog. The refusal names the same command.
