## Pull requests

`rafa pr` commands read and manage pull requests on GitHub. The provider is
configured, preflight checks it, and `pr triage` assesses failing PRs into
a class with follow-up remediation.

### The `pr` subject

Seven actions read and control pull requests:

- `pr current` — one line: `#n`, title, state, checks verdict, URL (URL
  alone when that is all `gh` answers)
- `pr show [<n>]` — details: title, author, branch → base, mergeable, each
  check with its state and link, last triage comment
- `pr view [<n>]` — open it in the browser
- `pr list` — open PRs: `#n`, title, branch, age, checks verdict, mergeable
- `pr merge [<n>] [--yes] [--method=squash|merge|rebase]` — merge the PR
- `pr triage [<n>] [--no-comment] [--resolve] [--max-attempts=2]` — assess
  it or resolve it when simple
- `pr wait [<n>] [--timeout=<minutes>]` — poll its checks until they settle

`<n>` defaults to the open PR of the current branch. Every action carries a
summary, examples and `outputs: [text, json]`; each one in the core roster
carries help snapshots too.

`pr wait` composes `waitForChecks` (`src/pr/checks.ts`) over the provider's
`checks` and is READ-ONLY: no repair session, no comment, no label, no
merge — `verifyPullRequest` (`src/start/pr-lifecycle.ts`) keeps those, and
the deadline and the poll interval are that gate's own constants. Green
exits 0; red exits 1; a pull request with NO checks at all exits 1 too, and
is answered at once rather than waited out, since a PR that does not merge
cleanly schedules no run and no amount of waiting makes one; the deadline
passing with checks still running exits 3. A green wait writes its report
through the output and then names the one step that follows, which for
checks that have just passed is the merge (`src/next/ending.ts`,
`--no-hint` to turn it off); every other ending carries the report as the
message of its exit, because the dispatcher drops a command's payload when
it ends non-zero, and gets no hint, since that report already names the
rafa command for what it found. The clock and the wait between polls are
seams, so its tests spend no real second.

### The provider and preflight

The provider is configured at `pr.provider` as `gh` or `none`. Default is
`gh` when `origin` is a GitHub remote, else `none`. With `provider: gh`,
two automatic preflight items run before any task is paid for:

1. `gh` on `PATH` — halt names the install line
2. `gh auth status` exit 0 for the remote's host — halt names `gh auth
   login`

`rafa doctor` prints both checks. With `provider: none` the loop pushes the
branch, prints the compare URL, skips the CI wait, skips the release
stage's body write — there being no body — and says so each time. No other
provider is built; the functions in `src/utils/pr.ts` move behind one
`PullRequests` interface in `src/pr/` so a second provider is an adapter
later.

Every `pr` action without a usable `gh` exits 2 with the same message.

The port carries `comment`, `editComment` and `editBody`. `editBody` is
rafa-21's: the release stage writes its failure sentence into a pull
request body the wrap-up session already wrote, when the provider that
stage resolves is `gh`. The port is NOT in
`PORT_VERSIONS` (`src/adapters/registry.ts` versions tracker, store,
learning, output and planner only), so adding a method to it bumps no
version.

**For a test whose subject is the CALLER, build the provider with
`createPullRequestsDouble()`** — imported from
`../pr/pull-requests-double.js`, never from the barrel, which keeps a
test helper out of the loop's import graph as `./gh-fake.js` is kept out.
It answers the members the case names, refuses every other one, and
records each call either way, refusals included, so "it refused and
merged nothing" is read off `calls()` rather than inferred from a
message; `sent()` spells one line per call, a squash merge of #41 as
`merge 41 squash`, and `{ refusal }` gives a case its own refusal
wording. Reach for it rather than writing a `PullRequests` literal in
the test file: `check-types` opens no `*.test.ts`, so a hand-built
literal goes stale in silence when the port grows a member — which is
how `editBody` came to be missing from eight of them — while the
builder is a module the types gate does read.

**For a test that needs a real provider and no network, build one over
the fake `gh`.** `createFakePrGh()` — imported from `../pr/gh-fake.js`,
never from the barrel — plus `createGhPullRequests({ gh: fake.run })`
gives a genuine `PullRequests` implementation backed by an in-memory `gh`,
so a read-modify-write such as the release stage's body edit runs
unmocked. Register the route row the call needs on the fake.

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
5. Run the unblock reading over every open issue labelled
   `spec:blocked` whose `Blocked by:` line names an issue this PR closes,
   asking `#<n> was blocked by #24, all closed. Remove spec:blocked? [y/N]`
   about each one whose blockers have all closed and removing the label on a
   yes (`src/commands/pr/merge-unblock.ts`, over `rafa issue unblock`'s own
   `runUnblock`). `--yes` does not answer that question, and every failure of
   it is a warning rather than an exit code.
6. Last, name the one step that follows — with the base pulled and both
   branches gone, the next plan or the loop on a plan already there
   (`src/next/ending.ts`, `--no-hint` to turn it off). A merge that was
   DECLINED ends without it: nothing moved, so the hint would put the
   question that was just answered no.

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
  operator's uncommitted work is never touched; removed on success, on the
  guard's stop and on an unresolvable class. It is NOT removed when an
  attempt THROWS between those points: a `CommandExit` out of a
  re-assessment `gh` read, out of `waitForChecks` or out of
  `writeResolvePlan` leaves `~/.rafa/worktrees/pr-<n>` on disk with no line
  saying it is there. Nothing is lost — the worktree holds only pushed or
  ignored content — and the next `--resolve` for the same pull request
  reuses what it finds at that path, by PATH alone and without checking the
  branch against the pull request's head. A cross-repository PR is refused.
  Never a force-push.
- `resolve-conflict-lockfile`: merge the base, take the base's lockfile,
  reinstall, run the gates, commit, push. `resolve-conflict-manifest`: keep
  both sides' entries, the higher version where both bumped one, then as
  above. `resolve-ci-install` and `resolve-ci-lint`: the `build-error-resolver`
  agent with the log excerpt in the task. The conflict sentence is the
  wrap-up prompt's own, from one source (`src/pr/conflict-sentence.ts`),
  which is why THREE suites read `buildWrapUpPrompt` and a bullet moved in
  it can redden any of them: `src/start/wrap-up.test.ts`,
  `src/pr/conflict-sentence.test.ts` and `src/tests/plan-injection.test.ts`,
  the last because the prompt's FIRST line is the `wrap-up` classifier key
  `PROMPT_SHAPES` reads. Run the three together before the full suite.
- Then the existing CI wait. Guard against an unfixable PR: `attempts` in
  the triage block, raised before each run; at `--max-attempts` (default 2),
  or when a run ends with the same class and the same failing step as before,
  stop, update the comment, remove the worktree, print the follow-up prompt,
  exit 3. Each run carries `--max-budget-usd` from `pr.resolveBudget`.
- Pushing to a dependabot branch stops dependabot rebasing it; the comment
  says so.

### Trust

Text from the board ends up in an agent's prompt, so its source must be
someone allowed to change the repo. SIX routes ask the question. Two are
`src/commands/pr/triage-trust.ts`'s: the triage marker comment's author, and
the pull request's author for `pr triage --resolve`. Three are
`requireTrustedBoardAuthor`'s — the board entry point in
`src/board/trust.ts`, over a `BoardTrust` of the lookup, the allow-list and
the repo label. Two of those are `plan create`'s: `src/board/plan-spec.ts`'s
`inspectSpecIssue` calls it ahead of the label check, the leak refusal and
the completeness refusal, and its `inspectRoadmapIssue` calls it on the
ROADMAP issue a `--next` walk reads its order off, before a line is parsed
out of that body and before either taken reading is spent. The third is
`rafa issue ready <n>` (`src/commands/issue/ready.ts`), which calls it
before the completeness check and before its own question, so an outsider's
issue is refused with exit 2 and nobody is asked anything. The login all
three ask about is `SpecIssue.author`, which `src/board/issue.ts`'s
`ISSUE_VIEW_FIELDS` fetches.

**Every body a `plan create` run reads is checked**: the issue `--issue=<n>`
names, the roadmap a `--next` walk reads, and the line that walk picks. The
roadmap runs check 0 alone — it carries no `spec:ready` label and fills no
template, and what a planted line in it takes is the ORDER, not a prompt.
Its refusal is the shared sentence, so it names the roadmap as `issue #<n>`
and closes with the issue remedy, "a member must open the spec"; a remedy of
its own would mean a third `BoardItemKind` in `src/board/trust.ts`.

The SIXTH is the `rafa:spec-review` comment
(`src/board/review-comment.ts`), and it IGNORES rather than refuses.
Nothing in that comment is ever read back into a prompt, so what a planted
one would take is the EDIT: the gate keeps one comment per issue, GitHub
refuses an edit of another account's comment, and the gap list would be lost
run after run. So `readTrustedSpecReviewComment` walks the issue's marker
comments newest first over `readBoardTrust` and edits the first one a
trusted account wrote; the refused ones are reported by id and author
through the gate's warnings and left alone, and the gaps go in a comment
posted beside them. The trust is the one check 0 already built, carried on
`GateIssue` beside the number and the board.

The repository a plan refusal names is a LABEL read from `origin` through
the `git` seam (`boardRepoLabel`), never an input to the lookup: `gh`
resolves the repository from the directory it runs in. It is read on the
first issue a run reads, so `--spec=<file>` spends no `git` for it.

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
   listed, checked before the body is read any further or snapshotted. It
   costs one `gh api` per LOGIN a run checks, spent ahead of the free
   checks, and none at all for a login in `board.trustedAuthors`. A
   `--next` run checks two authors, the roadmap's and the picked line's,
   and the lookup is memoised for the length of one resolution, so one
   person who opened both costs one call.
1. Label (a person's decision): the issue carries `spec:ready`. Without it:
   "issue #<n> is not marked spec:ready", exit 2. `plan create --next` STOPS
   at a next line that is not ready and says so; it never skips ahead.
   Where there is a TERMINAL, both board routes OFFER the label instead of
   stopping there: `src/commands/plan/ready-offer.ts` puts
   `rafa issue ready`'s own run — its two readings, its
   `Mark #<n> spec:ready? [y/N]` question and its one label swap — inside
   check 1, over the issue the route has already read, so no second
   `gh issue view` is spent. A yes labels the issue and the run goes on to
   the leak and completeness checks and the snapshot; a no throws the
   refusal above. Two runs are offered nothing and keep that refusal
   exactly: one with no terminal to ask on, read once when the command
   starts, and one under `--dry-run`, which writes nothing and the swap is
   a write. The leak refusal runs before the offer, since the offer quotes
   headings off the body.
2. Code: BOTH halves are wired and both refuse, the leak first. The leak
   refusal is `src/board/leak.ts`. The heading-completeness half is
   `requireCompleteSpec` (`src/board/readiness.ts`) — every template
   heading present and non-empty, "Tasks the plan must carry" and
   "Definition of done" each holding at least one list item, no
   placeholder surviving (`TBD`, `TODO`, `???`, an unfilled template
   comment), each gap listed with its heading, exit 2 before the
   snapshot. It refuses every spec opened before
   `src/board/templates/spec.md` existed, which is the cost the spec
   chose to pay: such a body carries none of the six headings, so the
   refusal names all six and the issue needs one hand edit before it can
   be planned from. The warning that used to run in its place,
   `warnOnThinListSections`, is gone with it — every gap it named is one
   this refusal throws on — and `findListSectionGaps` and
   `listSectionWarning` are left with no caller outside their own
   tests.
3. The planner's first pass (same session, no second one paid for): the plan
   prompt gains bullets, below its first line so the classifier key stays,
   telling the session to judge the spec BEFORE planning: can each
   definition-of-done item be shown by a command, does each task name what it
   changes, is anything the plan would have to guess. It ends its final
   message with

   ```yaml
   rafa:spec-review
   verdict: ready | not-ready
   gaps:
     - heading: "Definition of done"
       what: "no item says how the merge clean-up is verified"
   ```

   On an explicit `verdict: not-ready` the session writes no plan and no
   prerequisites; the loop enforces that in code (a plan file that appears
   anyway is removed), posts the gaps as one comment on the issue (marker
   `<!-- rafa:spec-review v1 -->`, edited on a rerun; `--no-comment` prints
   only), swaps `spec:ready` for `spec:needs-work`, and exits 3.

   A MISSING or malformed block is not that verdict and is not treated as
   one. It is weighed against the plan the session wrote: one that
   `plan validate` reads without an issue STANDS, with one warning, no
   comment, no label change and nothing removed, and its `rafa:plan` block
   records `review: missing`. Only a plan that does not read as written is
   removed for it, and even then nothing is posted and no label moves,
   since no session judged the spec; that refusal names every parser issue
   and exits 3. The rule until 2026-09-20 was the opposite — an unread
   block was a `not-ready` verdict — and it deleted a valid 22-task plan
   of this repository's own over a prompt the session had no place to
   answer (`src/board/gate.ts` holds the reading).

`--skip-review` bypasses check 3 only, and the plan's `rafa:plan` block
records `review: skipped`.

### The board and plan routes

`plan create` gains two board routes that complement `--spec=<file>`:

- `plan create --issue=<n>` — the spec is issue `<n>`'s body, snapshotted to
  `<specs.dir>/rafa-<n>-<slug>.md` (slug from the title). Fetch the issue
  (`gh issue view <n> --json number,title,body,state,labels,author`), refuse
  a closed issue or one without `type:spec`, and run the readiness checks —
  the author's trust, the `spec:ready` label, the leak refusal, the
  completeness refusal and the planner's own review. An
  existing snapshot that differs is refused without `--refresh`. A local
  file `<specs.dir>/rafa-<n>-notes.md`, when present, is appended
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

  A pick that is BLOCKED is the one line the walk offers its way past.
  Its issue carries `spec:blocked` and its `Blocked by:` line names a
  blocker the board still holds open, or one whose state this run could
  not read (`src/board/blocked-line.ts`). Such a line is neither planned
  nor stepped over silently: the run says `#57 is blocked by #24 (open)`,
  walks on for the first line under it that is ready, not blocked and not
  taken, names that one and asks `Plan #58 instead? [y/N]` through
  `src/commands/plan/blocked-offer.ts`. Only a yes plans it. A no, a run
  with no terminal to ask on, a `--dry-run` run and a roadmap with no such
  line under the blocked one each plan nothing and say which, all four
  exiting 0. READY there is the `spec:ready` label, which the ordinary
  walk does not ask for: the pick is offered the label where it is
  missing, while this one is named for a single yes and must need no
  second question. An issue labelled `spec:blocked` whose line is missing
  or unreadable counts as blocked and is REPORTED with the fault sentence
  `rafa doctor` and `issue unblock` print, never guessed at.

Both routes are mutually exclusive with `--spec` and with each other.

Ticking: `pr merge` ticks the PR's `Closes #<n>` line in the roadmap issue
after the merge (GitHub closes the issue; it does not tick a task-list box).
An edit conflict re-reads and retries once — and the only conflict signal
there is, is the body the PATCH answers with. The issues REST API takes no
`If-Match` and `gh` sends no conditional request, so a lost update comes
back as a success; comparing what the PATCH echoed against what was sent is
what catches one.

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
