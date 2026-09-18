<!-- eslint-disable markdown/no-multiple-h1 -->
# Plan: Resolve lockfile conflict

```rafa:plan
stub: resolve-conflict-lockfile
issue: "20"
spec: .specs/rafa-20-pr-commands.md
```

```rafa:context
Mechanical conflicts are resolved without stopping — dependency version bumps take the base's version unless the branch deliberately pinned it, lockfiles and generated artifacts likewise, and complementary additions keep BOTH. Stop only for a genuine semantic conflict — two sides changing the same behaviour incompatibly. For lockfile conflicts specifically: merge the base, take the base's lockfile, then reinstall to re-anchor the branch's dependencies to the base's versions.
```

## Description

This plan resolves a pull request with a `bun.lock` conflict by taking the base's lockfile version, reinstalling to verify the merged manifests are consistent, and confirming all gates pass before pushing.

# Stage: Resolve

- [ ] Merge the base branch into the current branch using `git merge origin/main` {agent=loop-implementer}
- [ ] Take the base's `bun.lock` with `git checkout origin/main -- bun.lock` {agent=loop-implementer}
- [ ] Run `bun install` (plain, not `--frozen-lockfile`) to re-anchor dependencies to the merged state {agent=loop-implementer}
- [ ] Run `bun install --frozen-lockfile` to verify the lockfile is now consistent with the merged manifests {agent=loop-implementer}
- [ ] Run the gates (`env -u CLAUDECODE bun test`, `bunx tsc --noEmit`, `bunx eslint .`) to verify no other conflicts arose {agent=loop-implementer}
- [ ] Commit the merge and lockfile changes to the branch {agent=loop-implementer}
- [ ] Push the resolved branch to the current branch on GitHub {agent=loop-implementer}
