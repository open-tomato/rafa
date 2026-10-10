---
plan: rafa-824-bug-sweep-17
title: Bug sweep 17 — packages linted, every command finds its own project
level: patch
---

- Tooling: Workspace packages under packages/ are now held to the same ESLint gate as src/, by bun run lint and by the runner's lint step, with the @open-tomato/rafa subpaths resolving (#511, #690); new tests pin that a command run from a worktree or a nested directory finds its own project's .rafa/, never a parent folder's (#471)
- Plan: rafa plan create hands its planning session the plan and prerequisites files as absolute paths under the project root, and the refusal for a plan that was not written names that root and the path it looked for (#171)
- loop: A worktree removed while the suite steps run now blocks the task on checkout moved and halts with that reason, instead of reporting an unreadable findings store (#848); under pr.provider none the wrap-up looks up no pull request, and its closing line names the provider and promises no retry (#847)
- cleanup: rafa cleanup no longer asks the commit-count question about a Not-pushed branch held by a worktree that cannot be ticked, and reports it as not removed (#860); rafa cleanup --help now says a Merged, Stale or Not-pushed branch held that way starts unticked and is not deleted even when ticked (#859)
