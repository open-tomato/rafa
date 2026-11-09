# rafa release settle

`rafa release settle` folds the fragments waiting on the base branch into
one version and one changelog section per unit. It commits them at once as
`chore: release <version>` and delivers that commit by `release.settle`. It
is the only step that writes a version. `rafa release settle --dry-run`
folds and prints the result, and writes nothing.

## Where it runs

Settle works in a scratch worktree of the base, `origin/<pr.base>`. The
checkout it was run from, and its index, are never touched, whatever branch
that checkout is on.

## The refusals

A refusal writes nothing and exits 1. The dry run refuses the same way.

- A fragment that does not parse, or that names a package the workspace
  lacks or a private one, refuses the whole batch. Settle prints one
  sentence per refused fragment, naming its path.
- The release lock, when `release.moveLock` is on, refuses a base whose
  version file names another package, or whose `rafa.lock` does not read.
- A push that GitHub refuses as protected, or refuses under a repository
  rule, prints one line naming the rule. It also names the config key that
  moves the release to a pull request, `release.settle: pr`, in the
  project's own config file.

A refused push is fetched again. If another machine already settled the
folded fragments, settle stops with exit 0. If new fragments arrived, settle
folds again and retries the push once, and a refused retry stops it with
exit 1.

## The endings

A run that delivered ends with the step that comes next. A run that refused
ends on its refusal, with no ending. The endings are these.

- **Push delivery** (`settle-push`): `git merge --ff-only <remote>/<branch>`
  brings the release branch up to the release commit, then `rafa release tag
  --push` tags it and pushes the tag. Under `release.tag: settle` settle has
  tagged and pushed already, so only the merge is left.
- **Pull request delivery** (`settle-pr`): `rafa pr wait <n>` waits for the
  checks of the release pull request. Once it merges, the same merge and tag
  steps follow. Closing that pull request undoes the release before it
  lands.
- **Nothing to settle** (`settle-nothing`): no step. The output ends on the
  sentence `Nothing to tag either: every unit keeps its version.`
- **Dry run**: `rafa release settle`, without `--dry-run`. This step has no
  case file, since the outcome it would reach is not known yet, so it prints
  no skill line.

The merge and tag steps run in the checkout that holds the release branch.
When no checkout holds it, a `git switch <branch>` step comes first. See the
place rule in SKILL.md.
