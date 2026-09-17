# rafa Cutover Runbook

This runbook documents the process for migrating the sibling
`agentic-research` repository from `tools/ralph` to `@open-tomato/rafa`.
The cutover is a multi-step operator process that occurs after the phase 0
plan is successfully merged.

## Prerequisites

Before beginning, ensure:

- This repository (`open-tomato/rafa`) is built and ready:
  `bun run build` succeeds
- The sibling repository (`agentic-research`) is on `main` or a clean
  feature branch
- All phase 0 plan tasks are complete and merged to `main` in this repo
- Current working directory is the sibling:
  `/Users/marcos/projects/agentic-research`

## Step 1: Install the Global rafa Snapshot

Ensure the built `@open-tomato/rafa` snapshot is installed globally:

```bash
cd /Users/marcos/projects/open-tomato/rafa
bun run snapshot
```

This copies the built runtime into `~/.rafa/runtime/<version>/` and links
`~/.rafa/bin/rafa`. A version is installed once: it refuses, before
building, while that directory is already there, since a loop may be
running from it. Add `--force` to build and replace that directory whole.
Verify that `~/.rafa/bin` is on your `PATH` ahead of
`~/.bun/bin`:

```bash
echo $PATH | tr ':' '\n' | grep -E 'rafa|bun'
```

Should show `~/.rafa/bin` listed before `~/.bun/bin`. If not, update your
shell profile to place `~/.rafa/bin` first.


## Step 2: Update the ralph Script

Repoint the `ralph` script in `package.json` to call the global `rafa`:

```json
{
  "scripts": {
    "ralph": "rafa"
  }
}
```

In the sibling repository:

```bash
cd /Users/marcos/projects/agentic-research
```

Test the new entry point:

```bash
bun run ralph usage
```

Should output the rafa usage help without error. If the command fails, verify
that `~/.rafa/bin` is on your `PATH` and that `rafa` resolves to the global
snapshot (not a local `node_modules` entry). Do not use `bun link` or
`bun pm ls` — the link carries no `bun` context.


## Step 3: Run Full Plan with `plan.inject=full`

This run is byte-identical to the sibling's previous behavior with the old
ralph loop. Create a new feature branch:

```bash
git checkout -b cutover/phase-0-inject-full
```

Prepare a test plan (or use an existing one). For this test, we'll verify
the loop works end-to-end:

```bash
bun run ralph start \
  --plan=.plans/PLAN-cutover-test.md \
  --inject=full
```

Monitor the run through completion:

- Verify per-task commits are created
- Verify the tracker ticks tasks from `[ ]` to `[x]`
- Verify the prompt includes the full plan
- Verify the PR is opened and merged (or manually merged if
  `--no-ci-wait` was used)

Capture the artifacts from this run:
- Note the final commit SHA
- Save the merge commit SHA
- Record the final task count and any blockers


## Step 4: Run Same Plan with `plan.inject=stage`

Create a fresh branch for the stage-injection test:

```bash
git checkout main
git checkout -b cutover/phase-0-inject-stage
```

Run the same plan with stage injection:

```bash
bun run ralph start \
  --plan=.plans/PLAN-cutover-test.md \
  --inject=stage
```

Monitor the run through completion. Key differences from the `full` run:

- Prompt includes only the current stage context, not the entire plan
- Task prompts should be more focused
- Wrap-up session still receives the full plan

Capture the same artifacts:
- Note the final commit SHA
- Save the merge commit SHA
- Record the final task count and any blockers


## Step 5: Compare Artifacts Between Runs

Compare the two runs to ensure functional equivalence:

```bash
# Compare task counts
git log --oneline origin/main..cutover/phase-0-inject-full \
  | wc -l
git log --oneline origin/main..cutover/phase-0-inject-stage \
  | wc -l

# Compare final state
git diff origin/main cutover/phase-0-inject-full -- src/
git diff origin/main cutover/phase-0-inject-stage -- src/
```

**Expected results:**

- Task commit counts should match (same plan, same task count)
- Final code state should be byte-identical (same implementation,
  different path to it)
- Any differences in prompts or outputs are expected and documented in
  progress.txt

If artifacts match, proceed. If they differ materially, investigate and
resolve before continuing.


## Step 6: Run Parity Test Against Live Directory

Verify that the store port is working correctly by running the parity
test:

```bash
bun test src/tests/parity-lineage.test.ts
```

The test collects the sibling's 1,052+ session logs into both NDJSON and
SQLite stores, then verifies:

- Every row in one store has a byte-identical counterpart in the other
- Row counts match per plan stub
- Lineage (the order of collection) is preserved
- The NDJSON output matches the sibling's original store

**Expected result:** All parity assertions pass with counts reported.

Record the parity results:

- Total session logs processed
- Total commits processed
- Per-plan-stub counts for major plans
- Any skipped suites with reasons


## Step 7: Delete tools/ralph in Cutover Commit

On the `main` branch, delete the old loop:

```bash
git checkout main
git rm -r tools/ralph
git commit -m "refactor: replace tools/ralph with @open-tomato/rafa v0.1.0

Retire the local ralph loop and adopt the published @open-tomato/rafa
package. The loop now runs from the linked npm package instead of the
source tree, enabling independent versioning and cleaner separation
between the loop implementation and projects that use it.

tools/ralph was 48 files, 18,776 lines; rafa is packaged as
@open-tomato/rafa v0.1.0 with bin entry 'rafa' and library exports.

Cutover verified:
- Full injection mode (byte-identical to previous ralph behavior)
- Stage injection mode (focused per-stage prompts)
- Parity test (store backends equivalent over 1,052 session logs)

Ralph script updated to \`bun rafa\` in package.json.

Rollback: git revert <SHA> && bun unlink @open-tomato/rafa"
```

Push to main:

```bash
git push origin main
```

Wait for CI to pass.


## Step 8: Document Rollback in Sibling README

Update the sibling's README with rollback instructions. Add a section:

````markdown
## Rolling Back the rafa Cutover

If issues arise with the rafa package after the cutover, the loop can be
restored:

```bash
# Restore the previous state
git revert <cutover-commit-SHA>

# Verify ralph is restored
bun run ralph usage
```

This rollback reverts the `tools/ralph` deletion and restores the
previous script in `package.json`. The global `rafa` binary remains
installed at `~/.rafa/bin/rafa` from the snapshot; it is unchanged by
the revert.

**Duration:** This rollback is documented for the length of one plan run.
After the next major phase completes, it can be removed.

**Keep this section updated** with the actual cutover commit SHA when
it is created.
````

Place this in the sibling's README prominently, near the "Quick
orientation" section or in a "Troubleshooting" area.



## Post-Cutover Verification

After the cutover commit is merged and the rollback is documented:

1. **Verify the sibling runs with rafa:**

   ```bash
   cd /Users/marcos/projects/agentic-research
   bun run ralph usage
   ```

2. **Run a simple plan to confirm end-to-end operation:**

   ```bash
   bun run ralph start \
     --plan=.plans/PLAN-post-cutover-smoke-test.md
   ```

3. **Check that the store is being populated:**

   ```bash
   sqlite3 .ralph/effort/effort.sqlite \
     "SELECT COUNT(*) FROM sessions;"
   ```

   (After phase 1 upgrades, this path will change to `.rafa/effort/effort.sqlite`.
   The migration is a one-time rename of the directory; see the notes above.)


## Success Criteria

Cutover is complete when:

- ✅ `bun run ralph` works in the sibling with rafa commands
- ✅ Full and stage injection modes both produce valid artifacts
- ✅ Parity test passes over the live store
- ✅ `tools/ralph` is deleted in one commit on main
- ✅ Rollback instructions are in the sibling's README
- ✅ CI passes on the cutover commit
- ✅ A post-cutover plan runs successfully


## Troubleshooting

### Command Not Found

If `bun run ralph` fails with "not found":

```bash
# Verify the ralph script exists in package.json
cat package.json | grep -A2 "scripts"

# Verify rafa is on PATH
which rafa

# Verify ~/.rafa/bin is ahead of ~/.bun/bin
echo $PATH | tr ':' '\n' | grep -E 'rafa|bun'
```

If `which rafa` returns nothing, reinstall the snapshot. A plain
`bun run snapshot` refuses while `~/.rafa/runtime/<version>/` is already
there, so force it over that directory:

```bash
cd /Users/marcos/projects/open-tomato/rafa
bun run snapshot --force
```

### Store Backend Mismatch

If the parity test fails:

1. Verify both backends are reading the same session logs
2. Check that migrations have been applied to both stores
3. Review `.plans/CLOSEOUT-phase-0-*.md` for known issues

### Rollback Needed

To restore the old loop:

```bash
git revert <cutover-commit-SHA>
```

The global snapshot at `~/.rafa/bin/rafa` is unchanged by the revert; only
the sibling's `package.json` is restored. To roll back the snapshot itself,
delete `~/.rafa/runtime/<version>/` and restore an earlier `rafa` if
you have one linked at `~/.rafa/bin/rafa`.


## Notes

- The sibling's `.ralph/` directory stores effort data under this cutover
  until phase 1 moves the store. When you upgrade to a phase 1 build,
  rename `.ralph/` to `.rafa/` and the loop will migrate seamlessly:
  a phase 1 rafa built from that move on writes and reads `.rafa/effort/`
  and reads nothing under `.ralph/effort/`. The migration is a one-time
  rename; no data is lost.
- This cutover does not link the package — the global `~/.rafa/bin/rafa`
  snapshot is already installed by `bun run snapshot`. Do not use
  `bun link` or `bun pm ls`. Phase 1 will replace the development
  snapshot with an npm registry version.
- Both `full` and `stage` injection modes should produce functionally
  equivalent results; the difference is in prompt detail and developer
  experience.


