---
plan: rafa-926-red-only-in-step
title: A red step keeps each failed case's error, and a file red only in the step gets no repair task
level: minor
---

- loop: a task, stage or pre-wrap-up step that reads new failures now runs each newly red test file alone once, as `bun test ./<file>`; a file green alone, with no test file the step's own change touches run before it, is reported as `Red only in the step: <file> ...` with its place in the step's file order and the files run just before it, listed under `stepOnly` on the recorded step, and blocks nothing, so a step whose every new failure is such reads green and inserts no repair task
- loop: a file green alone that ran after a test file the step's own diff names (the task's, the stage's, or the plan's for the pre-wrap-up step and a repair task's step) stays a new failure: its blocker says `green when run alone`, then `Green when run alone, red after files this change touches: <file> after <changed files>` and the `bun test` command that runs them in the step's order
- loop: the test files a run read red only in a step are listed in the wrap-up prompt, which asks for them in the pull request body under `### Test files red only in a suite step`, and printed once more as the run's last lines
- loop: a newly red file past the first 20 is not run alone, and its blocker now says so, as `<file> (N tests, not run alone)` and `N files were not run alone ... and may be order-dependent too`, naming the first file to go red when every file run alone was green alone
- loop: a step red on a file green alone and on an error outside any test is taken once more after the file is run alone, as a step red on such errors alone already was
- loop: a red step's blocker now says `red again when run alone` after the count of a file that failed on its own too, and lists the others under `Red only in the step, green alone: not yours to fix`
- loop: a step now keeps the first lines of the error Bun printed for each failed case, which Bun 1.3.14's JUnit report does not hold: as `errorLines` on each new failure of the run record, in `.rafa/runs/<session>/suite/<kind>.output.txt` under the failed case, and quoted in the blocker as `What Bun printed for them: <file> "<line>" (N tests)`, one line per file cut at 100 characters, for the first three files, with a count of what was left out
- loop: a step's `bun test` no longer inherits `FORCE_COLOR`, under which Bun coloured its piped output and the step read no error line and no error outside any test
- config: new key `tests.retakeRedAlone` (boolean, default `true`); `false` turns the retake off and nothing else: a step then blocks on every new failure, and the error lines are kept either way
- docs: `context/verification.md` and `context/workflow.md` describe the kept error lines, the retake and its five readings, the `stepOnly` record, the list in the pull request body and the key
