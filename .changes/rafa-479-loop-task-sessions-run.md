---
plan: rafa-479-loop-task-sessions-run
title: Loop task sessions run only the tests their change reaches
level: minor
---

- Loop: task sessions run only `bun test --changed=<base>` against the base commit they are handed, plus `bunx tsc --noEmit` and `bunx eslint` on their changed files, and `rafa loop start` runs the rest itself: a full-suite baseline at the plan's first dispatch, a scoped step after each task and each finished stage, and the full suite before the wrap-up; a step with failures new against the baseline blocks the next task with the failing files named, while failures the baseline already held block nothing.
- Declarations: a new `tests=affected|module|full` task key sets how widely the runner tests after a task; `affected` is the default.
- Configuration: new `tests.fullSuiteTriggers` and `tests.integration` glob lists name the files whose change widens a task step to the full suite and the integration tests every stage step runs.
- Agents: the gate sections of `loop-implementer`, `build-error-resolver`, `code-reviewer` and `tdd-guide` now give the scoped gates, read each tool's own exit code and never poll a running suite.
- Documentation: `context/verification.md` and `context/workflow.md` describe the test tiers, the runner's recorded steps, the baseline and known failures, and the `tests=` key.
