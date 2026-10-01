---
plan: rafa-579-loop-run-ends-delivered
title: A loop run ends delivered — eight loop bugs fixed
level: minor
---

- loop: a run's record now carries its phase (task, wrap-up, pull-request, ci or repair), and a record from an older rafa reads as task; a wrap-up that ends without a pull request runs `loop.wrapUp.retries` more wrap-up sessions, then has the loop open the pull request itself, and the run is recorded done only once it is open (or under `pr.provider: none`), otherwise it ends blocked with exit 1, naming the branch and the step; `loop start --as-worktree` run again reuses the plan's existing worktree and refuses a mismatched one, naming both; `loop start` on a detached HEAD refuses before writing any run record, naming `git switch <base>` and `--as-worktree`; Ctrl-C or `rafa loop stop` during the suite step stops the run, recording the step interrupted and marking no task blocked
- CLI: `rafa loop status` and `rafa loop list` show the phase each run is in beside its tasks done
- extras: the tomato prompt header shows a loop's phase once its tasks are done, and never a task count past the total
- Config: new `loop.wrapUp.retries` setting (default 1; a whole number from 1 to 3, or false for no retry), with its commented line in the config `rafa init` writes
- rafa next: reports a running loop instead of telling you to commit or set aside the loop's own edits, and the working-tree line names the checkout it read
- Effort store: merging a pulled store, including a loop run's end-of-task sync pull, no longer refuses the run that asked for it, while any other live run on the store, even one sharing its pid, is still refused
- Fixed: a linked worktree beside its main checkout now resolves to that checkout's rafa project even when a parent folder holds its own `.rafa/config.yaml`
