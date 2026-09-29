# CI workflow: settling releases after merge

Automate release versioning by running `rafa release settle` in CI after each
merge to the base branch. This approach is ideal for teams where CI owns the
release process and merges always come through one gateway.

## What this workflow does

Each time a pull request merges, a CI job:

1. Checks out the base branch at the merge commit
2. Installs rafa and its dependencies
3. Runs `rafa release settle` to fold waiting fragments into a version
4. Optionally tags the released commit (if configured)

Because `settle` is a pure function of committed data (the base branch's
current version and the ordered fragments), every machine runs it the same way
and produces the same version, in the same order, every time. No locks, no
coordination, no conflict with parallel PRs.

## When to use this workflow

**Choose this pattern when:**

- Merges always go through one gateway (usually `main` or your default branch)
- CI is trusted to own the release process
- You want a separate commit for versioning (not squashed into the PR)
- Your team prefers automated releases

**Choose a different pattern when:**

- Your base branch is protected and requires human review before release (use
  `release.settle: pr` instead)
- Merges come from multiple places (use a post-merge hook or manual settle)
- Each PR owns its own version (this workflow removes that; use fragments for
  release intent instead)

## GitHub Actions workflow example

Create `.github/workflows/release-settle.yml`:

```yaml
name: Settle release after merge

on:
  push:
    branches:
      - main

jobs:
  settle:
    name: Settle fragments to version
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # full history for fragment ordering

      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Install rafa
        run: bun install -g @open-tomato/rafa

      - name: Settle release fragments
        run: rafa release settle

      - name: Configure git user
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"

      - name: Push release commit
        run: git push origin main
        if: success()

      - name: Tag release (optional)
        run: rafa release tag --from-settle
        if: success()
```

The workflow:

- Runs only on pushes to `main` (customize for your base branch name)
- Checks out full history so fragment ordering by first-parent commit works
- Installs rafa from npm
- Runs settle (which is idempotent: if fragments already settled, it finds
  nothing to do)
- Configures git credentials so the settle commit can push
- Tags the version if `release.tag: settle` is set in `.rafa/config.yaml`

## Configuration for CI settle

In `.rafa/config.yaml`, choose how settle should behave:

### Minimal setup (push to base branch, manual tag)

```yaml
# (nothing; defaults apply)
```

Settle pushes the release commit to the base branch. You tag releases by hand
with `rafa release tag`.

### Automated tagging

```yaml
release:
  tag: settle
```

Settle tags the commit it pushed with `v<version>`. Useful when releases are
fully automated and you want a Git tag for each one.

### Protected base branch with review

```yaml
release:
  settle: pr
  tag: settle
pr:
  versionCollision: refuse
```

Settle opens or updates one pending release pull request on `rafa/release`
instead of pushing directly. The team reviews and merges it. Tags are applied
when that PR merges (if CI runs settle again) or by hand afterward.

Note: this workflow is better paired with a post-merge-to-main hook than a
GitHub Actions push event, since the release PR itself pushes to `rafa/release`
not `main`.

## What success looks like

After the first merge with fragments, your CI job shows:

```text
Settle release fragments
$ rafa release settle
Settling rafa-367-releases-settle-base-branch
Strategy: semver-by-level
Computed version: 0.8.0

Deleting fragment: .changes/rafa-367.md

✓ Release commit: 0.8.0 <commit hash>
✓ Pushed to origin/main
✓ Tagged v0.8.0
```

On subsequent merges before new fragments arrive, settle reports:

```text
$ rafa release settle
Settling
No fragments to settle.
```

This is not an error. Settle exits 0 when there is nothing to do, and idempotent
runs are safe to retry.

## Handling failed settles

A settle can fail and push nothing when:

1. **Network failure** — the push is refused. Settle retries once; if it fails
   again, it exits 1. The next merge will try again, reading the same fragments.
2. **Fragments were settled on another machine** — settle fetches again and sees
   they are gone. It exits 0; nothing was pushed, and nothing was lost.
3. **New fragments arrived during settle** — settle recomputes and retries. If
   the retry is refused, it exits 1, leaving the fragments for the next attempt.

On exit 1, the job fails and the CI dashboard shows red. No action is usually
needed: rerunning the workflow or waiting for the next merge picks up where it
left off. If fragments and version are misaligned (the version file changed
outside the settle commit), your next `rafa release status` run names the problem.

## Scope: not a locked step

Settle is NOT called by `rafa pr merge`, so merging locally does not trigger
it. A human who merges the PR by hand (against best practices) has to run settle
by hand or wait for CI to run it on push. This is intentional: settle reads the
committed version and fragments, so it cannot run until the merge is in git.

To merge and settle in one workflow, your script should:

1. Merge the pull request (with `gh pr merge`)
2. Pull the base branch (`git pull`)
3. Run `rafa release settle`

This is what `rafa next` does when it owns the merge step.

## Multiple releases per day

When your team merges several PRs per day, each with fragments, settle runs
once per push and folds all waiting fragments into one version. The frequency
is set by your team's merge rate, not by settle. If you need finer-grained
control (for example, one release per PR), fragments are not the right tool;
that belongs to a future strategy shape, `custom:<path>`, that lets you plug in
your own version function.

## Cost and permissions

- `rafa release settle` spends no Claude usage. It is a pure function over git
  data.
- The job needs `contents: write` permissions to push the release commit and
  tag.
- No GitHub API calls are made. Settle reads only git.

## Dry runs in CI

To see what would settle without pushing, use `--dry-run`:

```yaml
- name: Preview release (dry-run)
  run: rafa release settle --dry-run
```

This prints the fragments, their order, the strategy, and the computed version,
and writes nothing to git or the remote.

## Reverting a release

If a released commit is bad and you revert it, the fragments it folded come
back into the tree (git treats them as new commits on the base branch). The
next settle sees them again and releases them under a new version, starting
from the previous base version. The old release's tag stays; the new one gets a
new tag.

## Variants: other CI systems

The pattern works in any CI system that can run shell commands and push to git:

- **GitLab CI**: similar job under `.gitlab-ci.yml`, using `after_script` or a
  separate job triggered on push to the default branch
- **Travis CI**, **CircleCI**, etc.: add a step after tests pass to run settle
- **Jenkins**: add a post-build step that runs settle on the base branch
- **Bitbucket Pipelines**: add a step to `bitbucket-pipelines.yml`

The core steps are always the same: install bun, install rafa, run settle, push.

## Stopping the job from pushing

To prevent a settle job from pushing (for example, when testing), either:

- Set `release.settle: pr` to open pull requests instead
- Use a pre-commit hook or local config to prevent pushes
- Pass `--dry-run` to the settle command
- Comment out or skip the git push step

There is no `--no-push` flag; settle always attempts to push when run without
`--dry-run`.

## Troubleshooting

**Q: Settle runs but pushes nothing and exits 0**

A: Another machine settled the same fragments first. This is not a problem; the
fragments are released. Check the base branch's version and tags.

**Q: Settle exits 1 (red in CI)**

A: Something went wrong. Check the job log for:

- Network errors during push (retry)
- Missing `.rafa/config.yaml` (run `rafa init`)
- Bad fragment format (fix the fragment, commit, push, settle again)
- Version collision (run `rafa release status` to see what collided)

**Q: Can I run settle manually after CI runs?**

A: Yes. Settle is idempotent: if fragments are gone, it does nothing. If they
are still there, it settles them again, producing the same version (so it just
pushes the same commit twice, which git sees as a no-op).

**Q: Do I need to tag releases by hand?**

A: Only if you set `release.tag: manual` (the default). With `release.tag:
settle`, the job tags every release it pushes.

**Q: Multiple base branches?**

A: One workflow per branch, each with its own base branch name in the trigger.
Each branch settles its own fragments independently. Fragments pushed to `main`
do not settle on `develop`.

## See also

- `rafa release settle --help` — command reference
- `context/release.md` — design, guards, readers, and all config keys
- `docs/specs-and-roadmap.md` — how specs become plans and fragments
