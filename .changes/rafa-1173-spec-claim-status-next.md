---
plan: rafa-1173-spec-claim-status-next
title: Claims, status, next and the roadmap read the branch template
level: patch
---

- claims: Every reader of a claim branch now matches the `naming.branch` template (`feat/{stub}` by default) instead of a fixed `feat/` prefix, so a project on `work/{stub}` sees its claims. The claim git operations list, fetch, read and push under the template; `rafa plan create` names, reads and pushes its claim, and the claim ahead, on the branch the template names; `rafa claim release` finds the issue's branch under it; a refused push on a template-named branch is read as a lost claim with its commits kept on `lost/<stub>`, which stays fixed whatever the template; and the drift warnings and the wrap-up prompt no longer assume a claim branch starts with `feat/`. Only the configured template is read: a branch under another template is no claim.
- loop: `loop start` reads and pushes a run's claim on the branch `naming.branch` names rather than always on `feat/<stub>`, and its drift check finds claim branches under the same template.
- status: `rafa status` lists the claim branches and finds a plan's branch under the configured `naming.branch` template, and its claims help line names the template rather than `feat/rafa-<n>`.
- next: `rafa next` and the `rafa switch` drift report find a plan's branch and the claim branches under the configured `naming.branch` template.
- board: `rafa issue edit` names the loop's branch under the configured `naming.branch` template when it refuses an edit to an issue in development, and the roadmap's claim reading matches the template its branch scan was made under.
- docs: `context/workflow.md` gains a subsection on reading the `naming.branch` template, with the rules the readers follow and why reading both the default and the configured template was rejected, and the `--create-branch` sentence in `context/cli.md` says the claim and status readers match the same template.
