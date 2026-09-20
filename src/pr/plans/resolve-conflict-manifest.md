<!-- eslint-disable markdown/no-multiple-h1 -->
# Plan: Resolve manifest conflict

```rafa:plan
stub: resolve-conflict-manifest
issue: "20"
spec: .rafa/specs/rafa-20-pr-commands.md
```

```rafa:context
{CONFLICT_SENTENCE}

For manifest conflicts specifically: merge the base, keep both sides' entries and take the higher version where both bumped one, then reinstall to verify consistency and confirm all gates pass before pushing. This triage read the conflict from {CONFLICT_FILES}.
```

## Description

This plan resolves a pull request with a `package.json` conflict by merging the base branch, keeping both sides' entries and taking the higher version where both dependencies were bumped, reinstalling to verify consistency, and confirming all gates pass before pushing.

# Stage: Resolve

- [ ] Merge the base branch into the current branch using `git merge origin/main` {agent=loop-implementer}
- [ ] Resolve the `package.json` conflict by keeping both sides' entries and taking the higher version where both sides bumped a dependency {agent=loop-implementer}
- [ ] Run `bun install` (plain, not `--frozen-lockfile`) to ensure both sides' dependencies are installed and the lockfile is updated {agent=loop-implementer}
- [ ] Run `bun install --frozen-lockfile` to verify the lockfile is now consistent with the merged manifests {agent=loop-implementer}
- [ ] Run the gates (`env -u CLAUDECODE bun test`, `bunx tsc --noEmit`, `bunx eslint .`) to verify no other conflicts arose {agent=loop-implementer}
- [ ] Commit the merge and manifest changes to the branch {agent=loop-implementer}
- [ ] Push the resolved branch to the current branch on GitHub {agent=loop-implementer}
