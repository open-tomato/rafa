<!-- eslint-disable markdown/no-multiple-h1 -->
# Plan: Export the run summary as CSV

A committed plan in the loop's checklist format, read whole by the
real-plan cases of `src/plan/parse.test.ts`. Those cases pin its stage
names, per-stage task counts and declaration histogram as measured, so
an edit here that moves any of them moves the pins in the same commit.
It carries no `rafa:*` block on purpose: the cases exercise the
checklist grammar only.

The plan adds a `--csv` flag to the run summary, writes one row per
task, and documents the columns.

## Stages

1. Column model
2. Writer
3. Command surface
4. Documentation and close-out

# Stage: Column model

- [x] Add the column list and its header row to a new `src/summary/columns.ts`  {agent=loop-implementer effort=medium}
- [x] Quote a cell holding a comma, a quote or a line break as RFC 4180 asks  {agent=tdd-guide}
- [ ] Hold the column order against the summary's own field order  {model=haiku effort=low tools=Read,Edit,Bash,Grep,Glob}

# Stage: Writer

- [x] Write one row per task, in checklist order, through `Bun.write`  {agent=loop-implementer effort=medium tests=module}
- [ ] Write the header row alone for a run with no tasks  {agent=tdd-guide}
- [BLOCKED] Stream rows for a run longer than the in-memory cap  {agent=loop-implementer effort=high}
- [ ] Refuse a target path outside the project root with a named problem  {agent=loop-implementer effort=medium skills=zod-schemas}
- [ ] Review the writer for unescaped cells  {agent=code-reviewer}

# Stage: Command surface

- [ ] Add `--csv <path>` to the summary command's flags  {agent=loop-implementer effort=medium}
- [ ] Refresh the help snapshots the new flag changes  {model=sonnet effort=medium tools=Read,Write,Bash,Grep,Glob}
- [ ] Fix any type error the new flag surfaces in callers  {agent=build-error-resolver}

# Stage: Documentation and close-out

- [ ] Document the columns and the quoting rule in the summary page  {agent=doc-updater}
- [ ] Add the changelog fragment for the flag  {model=haiku effort=low tools=Read,Write,Bash,Grep,Glob}
- [ ] Sweep the plan's touched files for dead helpers  {agent=refactor-cleaner}
