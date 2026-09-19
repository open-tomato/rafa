## Pull requests

`rafa pr` commands read and manage pull requests on GitHub. The provider is
configured, preflight checks it, and `pr triage` assesses failing PRs into
a class with follow-up remediation.

### The `pr` subject

Six actions read and control pull requests:

- `pr current` — one line: `#n`, title, state, checks verdict, URL (URL
  alone when that is all `gh` answers)
- `pr show [<n>]` — details: title, author, branch → base, mergeable, each
  check with its state and link, last triage comment
- `pr view [<n>]` — open it in the browser
- `pr list` — open PRs: `#n`, title, branch, age, checks verdict, mergeable
- `pr merge [<n>] [--yes] [--method=squash|merge|rebase]` — merge the PR
- `pr triage [<n>] [--no-comment] [--resolve] [--max-attempts=2]` — assess
  it or resolve it when simple

`<n>` defaults to the open PR of the current branch. All actions carry
summary, examples, `outputs: [text, json]` and help snapshots.

### The provider and preflight

The provider is configured at `pr.provider` as `gh` or `none`. Default is
`gh` when `origin` is a GitHub remote, else `none`. With `provider: gh`,
two automatic preflight items run before any task is paid for:

1. `gh` on `PATH` — halt names the install line
2. `gh auth status` exit 0 for the remote's host — halt names `gh auth
   login`

`rafa doctor` prints both checks. With `provider: none` the loop pushes the
branch, prints the compare URL, skips the CI wait, and says so. No other
provider is built; the functions in `src/utils/pr.ts` move behind one
`PullRequests` interface in `src/pr/` so a second provider is an adapter
later.

Every `pr` action without a usable `gh` exits 2 with the same message.

### The merge flow

1. Refuse on a dirty working tree, on a PR that is not green or not
   mergeable (the refusal names which, and points at `pr triage`), and when
   the branch is checked out in another worktree (names it).
2. Show `#n title, branch → base, method` and ask `Merge? [y/N]`. `--yes`
   skips the question; without a TTY and without `--yes` it refuses.
3. `gh pr merge <n> --<method>`, then in code, each step reported: switch to
   the base branch, `git pull --ff-only`, delete the local branch (`-D`: a
   squash leaves it unmerged in git's eyes), delete the remote branch when
   it still exists, `git fetch --prune`.
4. Tick the roadmap, print what is ready and the two follow-ups when they
   apply: `rafa release tag` and `bun run snapshot`.

A failure after the merge never undoes it; it prints the remaining steps as
commands.

### Triage assessment

Assessment is CODE, not a session:

- Read `gh pr view --json number,title,author,headRefName,headRefOid,
  baseRefName,isCrossRepository,mergeable,mergeStateStatus,
  statusCheckRollup,updatedAt,labels`, the failing rows through
  `parseChecks`, the tail of `gh run view <id> --log-failed` for each
  failing job, and for a conflict the file list from `git merge-tree
  --write-tree` with a liveness control (the `merge-tree-mergeability-readings`
  skill's rule).
- Classify into one class: `green`, `pending`, `conflict-lockfile`,
  `conflict-manifest` (`package.json` where both sides added or bumped
  entries), `conflict-other`, `ci-install`, `ci-lint`, `ci-types`, `ci-test`,
  `ci-other`. The failing STEP name decides the `ci-*` class.
- SIMPLE, and so eligible for `--resolve`: `conflict-lockfile`,
  `conflict-manifest`, and `ci-install` or `ci-lint` on a dependency bump
  PR (author `dependabot[bot]` or title `chore(deps`). Everything else is
  assessed only.
- Output: the class, the evidence (files, step, log excerpt capped at 40
  lines), and a ready FOLLOW-UP PROMPT for another session that carries all
  of it, so that session does not assess again.

The triage comment:

```markdown
<!-- rafa:pr-triage v1 -->
**rafa triage**: `conflict-lockfile`, simple, not resolved
\`\`\`rafa:triage
head: <sha>
at: <iso>
class: conflict-lockfile
simple: true
attempts: 0
files: [bun.lock]
\`\`\`
<evidence> ... <follow-up prompt in a details block>
```

Run again:

- Latest marker comment whose `head` equals the PR's head: print "already
  assessed at <time>", show the comment, assess nothing.
- Head moved: when any check is pending, say so and show the old triage;
  when none is pending and the PR is still not green, assess again and EDIT
  the same comment (one triage comment per PR, history in its edits); when
  green, say green.
- `--no-comment` reads an existing comment and writes none.

Which PR, with no `<n>` and no PR on the current branch: list red PRs. One:
triage it. Two or three: triage each one updated within 72 hours, say which
were skipped as older ("3 red: assessing #21 and #24; #9 last moved 11 days
ago and is skipped, run `rafa pr triage 9`"). More than three: list them
with the command for each and exit 0. `--resolve` with more than one
candidate refuses, exit 2, listing the commands.

### Triage --resolve

A pinned plan per simple class ships in the package
(`src/pr/plans/resolve-<class>.md`), filled from the triage block and run by
the ordinary loop, so commits, reports and effort rows are the usual ones.

- Workspace: `git worktree add ~/.rafa/worktrees/pr-<n> <branch>`, so the
  operator's uncommitted work is never touched; removed on success. A
  cross-repository PR is refused. Never a force-push.
- `resolve-conflict-lockfile`: merge the base, take the base's lockfile,
  reinstall, run the gates, commit, push. `resolve-conflict-manifest`: keep
  both sides' entries, the higher version where both bumped one, then as
  above. `resolve-ci-install` and `resolve-ci-lint`: the `build-error-resolver`
  agent with the log excerpt in the task. The conflict sentence is the
  wrap-up prompt's own, from one source.
- Then the existing CI wait. Guard against an unfixable PR: `attempts` in
  the triage block, raised before each run; at `--max-attempts` (default 2),
  or when a run ends with the same class and the same failing step as before,
  stop, update the comment, remove the worktree, print the follow-up prompt,
  exit 3. Each run carries `--max-budget-usd` from `pr.resolveBudget`.
- Pushing to a dependabot branch stops dependabot rebasing it; the comment
  says so.

### Trust

Text from the board ends up in an agent's prompt, so its source must be
someone allowed to change the repo. Trust applies wherever board text enters
a prompt: the issue author for `plan create --issue`, the roadmap issue
author for `plan create --next`, the triage marker comment author for
`pr triage --resolve`, and the PR author for the same route.

The issue's AUTHOR must hold `admin`, `maintain` or `write` on the
repository (`gh api repos/{owner}/{repo}/collaborators/{login}/permission`),
or be listed in `board.trustedAuthors` in config. GitHub lets only the
author and write-holders edit an issue body, so a trusted author means a
trusted body; comments are never read into a plan. Refusal: "issue #<n> was
opened by <login>, who has no write access to <repo>; a member must open the
spec", exit 2, before the body is read any further or snapshotted. A failed
permission lookup is a refusal, never a pass. Applied on every repository,
public or not.

For `pr triage --resolve`, a PR whose author is untrusted is refused unless
it is `dependabot[bot]` or listed. For marker comments, one from an untrusted
author is ignored and reported, so a planted triage comment cannot supply the
follow-up prompt.

### The readiness gate

Four checks, cheapest first; any one failing writes no plan file:

0. Trust (section above): the issue's author must hold write access or be
   listed, checked before the body is snapshotted.
1. Label (a person's decision): the issue carries `spec:ready`. Without it:
   "issue #<n> is not marked spec:ready", exit 2. `plan create --next` STOPS
   at a next line that is not ready and says so; it never skips ahead.
2. Code: every template heading is present and non-empty, "Tasks the plan
   must carry" and "Definition of done" each hold at least one list item, no
   placeholder survives (`TBD`, `TODO`, `???`, an unfilled template comment),
   and the trust check passes. The refusal lists each gap with its heading.
3. The planner's first pass (same session, no second one paid for): the plan
   prompt gains bullets, below its first line so the classifier key stays,
   telling the session to judge the spec BEFORE planning: can each
   definition-of-done item be shown by a command, does each task name what it
   changes, is anything the plan would have to guess. It opens its answer with

   ```yaml
   rafa:spec-review
   verdict: ready | not-ready
   gaps:
     - heading: "Definition of done"
       what: "no item says how the merge clean-up is verified"
   ```

   On `not-ready` the session writes no plan and no prerequisites; the loop
   enforces that in code (a plan file that appears anyway is removed), posts
   the gaps as one comment on the issue (marker `<!-- rafa:spec-review v1 -->`
   , edited on a rerun; `--no-comment` prints only), swaps `spec:ready` for
   `spec:needs-work`, and exits 3. A missing or malformed block is treated as
   `not-ready` with the gap "the review block was not returned".

`--skip-review` bypasses check 3 only, and the plan's `rafa:plan` block
records `review: skipped`.

### The board and plan routes

`plan create` gains two board routes that complement `--spec=<file>`:

- `plan create --issue=<n>` — the spec is issue `<n>`'s body, snapshotted to
  `<specs.dir>/rafa-<n>-<slug>.md` (slug from the title). Fetch the issue
  (`gh issue view <n> --json number,title,body,state,labels`), refuse a
  closed issue or one without `type:spec`, and run the four readiness checks
  above. An existing snapshot that differs is refused without `--refresh`. A
  local file `<specs.dir>/rafa-<n>-notes.md`, when present, is appended
  under "Local notes": machine paths and private hosts live there and never
  on the board. The plan's `rafa:plan` block gets `issue: <n>`.
- `plan create --next[=<roadmap-issue>]` — the first undone line of the
  roadmap issue. The roadmap issue is `roadmap.issue` in config, else the
  pinned issue titled "Roadmap". Its body is parsed by code: task-list lines
  `- [ ] #<n>` in order. A line is DONE when it is ticked or its issue is
  closed. A line is TAKEN when a branch `feat/rafa-<n>-*` exists locally or
  on the remote, or an open PR closes it. The first line neither done nor
  taken is the answer; then as `--issue=<n>`. It prints what it skipped and
  why ("#20 taken: PR #33 open"), and exits 0 with a message when nothing is
  left. `--dry-run` prints the pick and stops.

Both routes are mutually exclusive with `--spec` and with each other.

Ticking: `pr merge` ticks the PR's `Closes #<n>` line in the roadmap issue
after the merge (GitHub closes the issue; it does not tick a task-list box).
An edit conflict re-reads and retries once.

The spec template: `.github/ISSUE_TEMPLATE/spec.md` with label `type:spec`
and the headings the planner expects: What you get, Starting position,
Design, What can go wrong, Tasks the plan must carry, Definition of done.
`plan create --issue` warns, naming them, when "Tasks the plan must carry"
or "Definition of done" is missing. Issues are public: the template's first
comment line says no local paths, hosts or credentials, and `--issue`
refuses a body matching a home path or a token shape, naming the line.

`rafa init --board` sets up the board: labels `type:spec`, `spec:ready`,
`spec:needs-work`, and the ones triage already files under (`type:bug`,
`needs-triage`, `module:unassigned`); `.github/ISSUE_TEMPLATE/spec.md` when
absent; and a pinned "Roadmap" issue from a template body when none exists.
Each part is written only when missing, so a rerun changes no byte. `rafa
doctor` reports each as present or missing, with `rafa init --board` as the
fix.
