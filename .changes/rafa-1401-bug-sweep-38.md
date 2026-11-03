---
plan: rafa-1401-bug-sweep-38
title: Three causes of a stopped stretch item, and a way to finish one
level: minor
---

- pr: `rafa pr merge` fetches the base and pulls it once more when its clean-up pull fails with `Cannot fast-forward to multiple branches`, and each step of its json result now carries `retried`.
- stretch: `rafa stretch item --wait` waits for the pull request's mergeability and checks and merges with `rafa pr merge <pr> --yes` instead of `--skip-checks`, goes on to the CI wait, the ledger line and the pit-stop readings whenever the pull request reads merged even if the clean-up failed (warning to run `rafa cleanup`), and the new `rafa stretch item <issue> --resume` finishes an item whose loop has ended from the pull request its log names, skipping the merge of one already merged; `--resume` beside `--wait` is refused.
