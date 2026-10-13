<!-- eslint-disable markdown/no-multiple-h1 -->
# Plan: Add a summary flag

A committed plan read by the `long-run` case of
`src/commands/plan/risk.test.ts`. Its one open task tells its own session
to run the full suite; the case removes that sentence and reads the plan
again. The task line stays at column 0 on purpose: it is a plan a test
parses, and the sentence sits on the line the finding names.

# Stage: summary

- [ ] Add the `--summary` flag to the report command. Run the full suite when done.  {tools=Read}

## Stages

1. summary
