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
- `pr list` — open PRs: `#n`, title, branch, age, checks verdict, mergeable,
  and where the release is on the forecast its body carries, marked
  `(base moved)` when `origin/<base>` as last fetched holds another version
  or other waiting fragments than the body's `rafa:release` marker names
  (`src/commands/pr/list-forecast.ts`, over `src/release/body-forecast.ts`;
  no fetch, no fold, no extra `gh` command)
- `pr merge [<n>] [--yes] [--skip-checks] [--method=squash|merge|rebase]` —
  merge the PR; `--skip-checks` is for a PR that reports no checks at all
- `pr triage [<n>] [--no-comment] [--resolve] [--max-attempts=2]` — assess
  it or resolve it when simple
- `pr wait [<n>] [--timeout=<minutes>]` — poll its checks until they settle

`<n>` defaults to the open PR of the current branch. Every action carries a
summary, examples and `outputs: [text, json]`; each one in the core roster
carries help snapshots too.

`pr wait` composes `waitForChecks` (`src/pr/checks.ts`) over the provider's
`checks` and is READ-ONLY: no repair session, no comment, no label, no
merge — `verifyPullRequest` (`src/start/pr-lifecycle.ts`) keeps those, and
the deadline and the poll interval are that gate's own constants. The same
`waitForChecks` the loop's own CI gate uses, so one `pr wait` and the loop
agree about what green means and how often a pull request is asked. Green
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
stage's body write — there being no body — and says so each time. A push
of a claim branch the remote refuses because another store now owns the
claim halts the run instead, exit 1 with the "claim lost" report, its
commits kept on `lost/<stub>` and no compare URL printed
(`src/start/pr-lifecycle.ts` over `src/claims/lost.ts`). No other
provider is built; the functions in `src/utils/pr.ts` move behind one
`PullRequests` interface in `src/pr/` so a second provider is an adapter
later.

Every `pr` action without a usable `gh` exits 2 with the same message.

The port carries `comment`, `editComment` and `editBody`. `editBody` is
rafa-21's: the release stage writes its failure sentence into a pull
request body the wrap-up session already wrote, when the provider that
stage resolves is `gh`. The port is NOT in
`PORT_VERSIONS` (`src/adapters/registry.ts` versions tracker, store,
learning, output, planner and sync only), so adding a method to it bumps
no version.

`create` and `editTitle` are rafa-367's, for settle's `pr` delivery
(`src/release/settle-pr.ts`), which opens or updates the one pending
release pull request from `rafa/release`. `create` takes a
`PullRequestDraft` — `head`, `base`, `title`, `body`, the head already
pushed — and answers the pull request as `gh pr view` reads it back; it
throws on every failure, a pull request already open from that head into
that base included. On `gh` it sends `gh pr create` with all four flags,
so nothing prompts, pushes or forks, and reads the number off the last
stdout line that is a `/pull/<n>` URL. That output is from
`gh pr create --help` on 2.100.0, not from a recorded create. `editTitle`
is `gh pr edit <n> --title`, read by its exit code, as `editBody` is.
The fake models both, and the unmodelled-flag case on `pr edit` now
sends `--add-label`.

`editBase(number, base)` is rafa-628's, for the wrap-up's retarget of a
pull request opened against another base than the run's. It is
`gh pr edit <n> --base <base>` (`-B, --base branch` in `gh pr edit
--help` on 2.101.0), a WRITE shaped like `editTitle`: a bad number or an
empty base is refused before `gh` is sent anything, every failure throws,
an absent pull request included, and nothing reads back what the edit
wrote — a caller wanting the new `baseRefName` calls `get`. The fake
stores the new base, so every later read of that pull request answers
it as `baseRefName`.

`listMerged` is rafa-94's, for `rafa cleanup`: it answers the recent
merged pull requests as `MergedPullRequest` rows — `number`,
`headRefName`, `headRefOid`, `mergedAt` — through `gh pr list --state
merged --limit 100`. The port touches no git: whether a local branch's
tip is that `headRefOid` is the caller's own reading. The rows come in
`gh`'s order, newest CREATED first and not newest merged. 100 is the
most one GraphQL request answers (`GH_DEBUG=api` showed one request at
100, two at 101), so a merge older than the newest hundred is not
answered, and a head missing from the list is "not among the recent
merges", never "never merged". `gh` still answers the `headRefName` after
the remote branch is deleted. An outage throws, as the other reads do,
and a row with a null `mergedAt` is refused. The fake stamps
`mergedAt` on `pr merge` from its clock. A `MERGED` seed with no
`mergedAt` is merged at its `updatedAt`.

**For a test whose subject is the CALLER, build the provider with
`createPullRequestsDouble()`** — imported from
`../pr/pull-requests-double.js`, never from the barrel, which keeps a
test helper out of the loop's import graph as `./gh-fake.js` is kept out.
It answers the members the case names, refuses every other one, and
records each call either way, refusals included, so "it refused and
merged nothing" is read off `calls()` rather than inferred from a
message. It answers a `PullRequestsDouble`, not the port: hand the seam
its `.pulls` (only a scratch type-check of the test file notices the
difference, since `bun test` checks no types); `sent()` spells one line per call, a squash merge of #41 as
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
unmocked. Register the route row the call needs on the fake. The fake
models `pr`, `run` and `api` only and refuses `gh auth status` as an
unhandled command, so a case that also probes the login (as the
Providers reading of `rafa doctor --deep` does) wraps `fake.run` in a
runner that answers the `auth` forms itself and hands the rest on. This
sentence replaces nothing.

### The merge flow

1. Refuse on a dirty working tree, on a PR that is not green or not
   mergeable (the refusal names which; `pending` and `red` point at
   `pr triage`, and verdict `none` — no checks at all — points at
   `--skip-checks` instead, since triage has nothing to fix there), and
   when the branch is checked out in another worktree (names it).
2. Where the release runs (`release.enabled`), read the release guard
   (`src/commands/pr/merge-guard.ts`) over `origin/<head>` against
   `origin/<base>`, both fetched first: `clean` prints its lines and the
   forecast; `missing` and `stale` follow `pr.versionCollision` (`allow`,
   `report`, `ask`, `refuse`); `collision` refuses unless
   `dangerous.acceptVersionCollision` is true. Its question comes before the
   merge question, `--yes` does not answer it, and without a TTY `ask`
   refuses.
3. Show `#n title, branch → base, method` and ask `Merge? [y/N]`. `--yes`
   skips the question; without a TTY and without `--yes` it refuses.
4. `gh pr merge <n> --<method>`, then in code, each step reported: switch to
   the base branch, `git pull --ff-only`, delete the local branch (`-D`: a
   squash leaves it unmerged in git's eyes), delete the remote branch when
   it still exists, `git fetch --prune`. A head branch this checkout has no
   local branch for — pushed from another clone, or from a worktree under
   another local name — is read by `git show-ref --verify --quiet` and
   reported as `delete the local branch <name>: skipped — no local branch
   <name>; nothing to delete`; the remote delete and the prune still run,
   and the exit code stays 0. A branch checked out in another worktree is
   present, so step 1 still refuses it.
5. Tick the roadmap and print what is ready.
6. Run the unblock reading over every open issue labelled
   `spec:blocked` whose `Blocked by:` line names an issue this PR closes,
   asking `#<n> was blocked by #24, all closed. Remove spec:blocked? [y/N]`
   about each one whose blockers have all closed and removing the label on a
   yes (`src/commands/pr/merge-unblock.ts`, over `rafa issue unblock`'s own
   `runUnblock`). `--yes` does not answer that question, and every failure of
   it is a warning rather than an exit code. Under
   `board.relationships: native` step 5 ticks no epic checklist and this
   step prints the open issues the merge freed instead, read through the
   relationships port's `freedBy` over one native board listing, asking
   nothing and writing nothing (`src/commands/pr/merge-freed.ts`).
7. Print the two follow-ups when they apply, under `Follow-ups:`:
   `rafa self-update`, then `rafa release settle` while the fragments
   waiting on `origin/<base>` fold into a version, so settle is the
   merge's last line (`src/commands/pr/merge-followups.ts`). While a loop
   of the project is live, the update's line ends `run it after the loop
   on <branch> finishes`, since `rafa self-update` refuses until then.
   Both are only printed: `pr merge` never runs settle, and `rafa release
   tag` is no longer named here, since settle tags or names the tag itself.
8. Last, name the one step that follows — with the base pulled and both
   branches gone, the next plan or the loop on a plan already there
   (`src/next/ending.ts`, `--no-hint` to turn it off). A merge that was
   DECLINED ends without it: nothing moved, so the hint would put the
   question that was just answered no.

A failure after the merge never undoes it; it prints the remaining steps as
commands.

### The --skip-checks flow

`--skip-checks` is accepted on verdict `none` ONLY — a PR that reports no
checks at all. On `pending`, `red` or `green`, the flag is refused, and the
refusal names each check row and its state. Without the flag, `none` is
refused as today, naming `--skip-checks` and what it means.

Before asking to merge, the command reads the repository's workflow count
(`gh api repos/<repo>/actions/workflows`, `total_count`). Zero is the
"no workflow" case; one or more, OR a count that could not be read, is the
"workflows exist" case, which is the riskier one. Two warnings:

- no workflow: "nothing on GitHub has tested this branch; you are relying on
  the checks run locally"
- workflows exist: "CI may not have started (a path filter, a draft, Actions
  disabled, or it has not registered yet); this is probably not what you want"

Then it shows `#n title, branch → base, method` and asks `Merge #<n> with no
checks? [y/N]`. `--yes` answers the question in the no-workflow case only and
is REFUSED in the workflows-exist case. Without a TTY and without `--yes` it
refuses.

After the merge, the usual clean-up runs (switch to the base branch, `git pull
--ff-only`, delete local and remote branches, `git fetch --prune`), then ONE
comment is posted on the PR: `Merged with no checks reported, by rafa pr merge
--skip-checks.` followed by the workflow count that was read (or that it could
not be read).

`rafa next` sends a PR with verdict `none` to `pr triage` through
`redClause` only when it conflicts; a mergeable PR with verdict `none`
goes to row 7 (`merge-unchecked`) instead, which hands the merge question
to `pr merge <n> --skip-checks`. A `rafa next --yes=<ids>` list that
names `merge-unchecked` is refused with exit 2, like `ready`.

### Triage assessment

Assessment is CODE, not a session:

- Read `gh pr view --json number,title,author,headRefName,headRefOid,
  baseRefName,isCrossRepository,mergeable,mergeStateStatus,
  statusCheckRollup,updatedAt,labels`, the failing rows through
  `parseChecks`, the tail of `gh run view <id> --log-failed` for each
  failing job, the repository's workflow count (`gh api
  repos/<repo>/actions/workflows`) when no check reported at all, and for a
  conflict the file list from `git merge-tree --write-tree` with a liveness
  control (the `merge-tree-mergeability-readings` skill's rule), and, where
  the release runs, the release guard over the head against the base with
  no fetch (`src/commands/pr/triage-guard.ts`).
- Classify into one class: `green`, `pending`, `no-checks`,
  `conflict-lockfile`, `conflict-manifest` (`package.json` where both sides
  added or bumped entries), `conflict-other`, `conflict-version`,
  `ci-install`, `ci-lint`, `ci-types`, `ci-test`, `ci-other`. The failing STEP
  name decides the `ci-*` class; `conflict-version` is the guard's `stale` or
  `collision` answer (the branch stamped a version) and outranks every other
  class, a git conflict included; `no-checks` means the PR reports no checks at all (verdict `none`),
  whatever the workflow count; the count, or that it could not be read,
  goes into the reason beside the `--skip-checks` line.
- SIMPLE, and so eligible for `--resolve`: `conflict-lockfile`,
  `conflict-manifest`, `conflict-version` (`CONVERSION_TRIAGE_CLASSES`: a
  conversion in code with no pinned plan and no session), and `ci-install`
  or `ci-lint` on a dependency bump PR (author `dependabot[bot]` or title
  `chore(deps`). Everything else is assessed only.
- Output: the class, the evidence (files, step, log excerpt capped at 40
  lines), and a ready FOLLOW-UP PROMPT for another session that carries all
  of it, so that session does not assess again.
- A class added to `TRIAGE_CLASSES` (`src/pr/triage/classes.ts`) needs, in
  the same change, its line in `FOLLOW_UP_TASKS` (`src/pr/triage/follow-up.ts`,
  a `Record` over the class, so `check-types` fails without it), a case in
  `classify.test.ts` that produces it, and a fixture folder
  `src/tests/fixtures/pr-triage/<class>/` (`pr.json`, checks, log). Both
  tests check the closed set from each end, and the pre-commit hook runs no
  tests, so a missing fixture only shows up in `bun run test`. This bullet
  is new and replaces no earlier text.

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

`conflict-version` has no pinned plan and is not run through the loop:
`resolvePullRequest` dispatches it to `src/commands/pr/triage-convert.ts`
ahead of the pinned-plan check, after the trust check and the
cross-repository refusal. In the same worktree it runs
`convertStampedVersion` (`src/pr/triage/version-convert.ts`), which makes
ONE commit touching three paths. It writes a fragment of the stamped
section's lines, named after the branch's last segment (a rafa branch gives
its plan stub). The fragment's level is how far the stamp moved from the
merge base's version. The commit also sets the version file's version back
to the merge base's, keeping the branch's other bytes in it, and restores the
changelog to the merge base's text. Then it pushes without force and removes
the worktree. No session, no CI wait, no attempt raised, no comment written:
the next `rafa pr triage` assesses the moved head. The MERGE base's values
and not the base tip's, because the guard measures a stamp against the
merge base: a branch holding the tip's version and sections still reads
`stale`/`released` and would be classed `conflict-version` again. The merge
then takes the base's side of both files. Exit 0 when converted and pushed
or when the guard no longer reads a stamp; exit 3 when the conversion is
refused (the worktree is not at the pull request's head, no level reads off
the stamp, the merge base holds no version or changelog) or the push is
rejected.

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
- Then the existing CI wait. A fresh assessment of class `green` OR
  `no-checks` counts as resolved (`endOfAttempt`,
  `src/commands/pr/triage-resolve.ts`), because a resolved conflict in a
  repository that schedules no checks reads `no-checks`. Guard against an unfixable PR: `attempts` in
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

One more reader calls `readAuthorTrust` and is no route, since it reads
no board text: the Providers reading of `rafa doctor --deep`
(`src/commands/doctor-deep-providers.ts`) asks it, with an empty
allow-list, about the login `gh` is authenticated as, to report whether a
loop session could push and merge. It gates nothing, and goes through the
rule so write access is spelled once.

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

Five checks, cheapest first; any one failing writes no plan file. They
are numbered in the order the spec lists them, and check 4 runs BEFORE
the session check 3 is part of, so a refusal from it spends no session:

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
   comment), no effort-store change pinned by number (`migration 12`,
   `schema version 9`) outside a fence or code span, each gap listed
   with its heading, exit 2 before the
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
       blocking: true
     - heading: "Design"
       what: "the store backend is not named"
       blocking: false
       assumption: "the SQLite backend, as every other command reads"
   ```

   On a `verdict: not-ready` naming a gap that BLOCKS planning — one where
   guessing wrong changes what ships or what is safe — the session writes
   no plan and no prerequisites; the loop enforces that in code (a plan
   file that appears anyway is removed), posts the gaps as one comment on
   the issue (marker `<!-- rafa:spec-review v1 -->`, edited on a rerun;
   `--no-comment` prints only), swaps `spec:ready` for `spec:needs-work`,
   and exits 3.

   The same verdict with NO blocking gap keeps its plan: nothing is moved,
   the plan is opened with an assumptions section listing each gap and the
   assumption it was planned under, its `rafa:plan` block records
   `review: assumed`, the gaps go up as the same marker comment in a body
   that says a plan was written, and no label moves. The gate does both
   writes itself (`src/board/gate.ts`, `src/board/review-stamp.ts`), so
   the standing it answers is `assumed` and the command does not refuse.

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

4. References (`src/board/refs-gate.ts`, placed on the command by
   `src/commands/plan/refs-check.ts`): every reference the saved copy's
   body names — an issue `#<n>`, `rafa-<n>` or `owner/repo#<n>`, and in
   backticks a path, a code-shaped symbol, a `rafa <subject> <action>`
   command and a config key, and a flag either way (the seven kinds of
   `src/refs/extract.ts`) — read against the stamp the copy keeps for it in its
   `<!-- rafa:refs` block. It runs on `--issue` and `--next` only, once
   checks 0–2 have passed and the snapshot has settled and once the
   plan-already-there refusal has passed, and before `checkUsage`, the
   notices and the session. `--spec` has no saved copy, `--dry-run` stops
   before any snapshot is written and so before it, and neither
   `plan needs --issue` nor `issue ready` runs it.

   A reference the copy keeps no stamp for is stamped on that reading
   and reads `ok`, except a target that does not exist, which is
   `dangling` on its first read. What each state does:

   | State | What check 4 does |
   |---|---|
   | `ok` | nothing |
   | `dangling`, `suspect` | refuses, exit 2, every such row on its own line |
   | `resolved` | prints `resolved #<n> — rafa issue unblock <spec>` and goes on |
   | `unknown` | lists the row (a repository `gh` could not read) and goes on |

   The refusal opens `❌ issue #<n> names references that are missing
   or changed since the spec was read:`, lists each row as
   `• dangling src/a.ts (line 12)` or `• suspect #7: heading "Design"
   changed (line 3)` — the line is the body's, as the issue was
   written — and ends naming the two ways past it: pass `--accept-refs`
   on this run, or edit the issue. A board issue `gh` could not read and
   a refs block the codec will not read refuse with the same exit code
   and the error's own words.

   `--accept-refs` re-stamps every reference of the spec as reviewed,
   a missing target as `absent`, which then reads `ok` until the target
   appears, prints `🔖 --accept-refs: re-stamped <count> references of
   issue #<n> as reviewed.` with each row it let through, and plans.
   `dangerous.acceptStaleRefs: true` in the config does the same on
   every run and names itself in that line; it also prints one warn
   line at the very start of a board-route run that is not `--dry-run`,
   before any board read, so a forgotten setting is seen before
   anything is spent. When both are on, the flag is the one named.

`--skip-review` bypasses check 3 only, and the plan's `rafa:plan` block
records `review: skipped`. No flag but `--accept-refs`, and no setting
but `dangerous.acceptStaleRefs`, passes check 4.

### The board and plan routes

`plan create` gains two board routes that complement `--spec=<file>`:

- `plan create --issue=<n>` — the spec is issue `<n>`'s body, snapshotted to
  `<specs.dir>/rafa-<n>-<slug>.md` (slug from the title). Fetch the issue
  (`gh issue view <n> --json number,title,body,state,labels,author`), refuse
  a closed issue or one without `type:spec`, and run the readiness checks —
  the author's trust, the `spec:ready` label, the leak refusal, the
  completeness refusal and the planner's own review — all against the issue
  as it reads NOW before any saved copy is compared or any question asked, so
  an untrusted or incomplete edited body is refused exactly as on a first read
  and saying yes skips nothing. An existing snapshot prints its difference
  lines when the issue body has changed. A notes-only change rebuilds without
  asking, the old copy moved to `<specs.dir>/previous/` first. If the body has
  changed and a terminal is present, the run offers a question: update the
  saved copy and plan from the new version? The `--refresh` flag (`REFRESH_FLAG`,
  `src/board/flags.ts`) keeps working and never asks. Without a terminal and
  without `--refresh`, the changed-body refusal stands. A local file
  `<specs.dir>/rafa-<n>-notes.md`, when present, is appended under "Local notes":
  machine paths and private hosts live there and never on the board. The plan's
  `rafa:plan` block gets `issue: <n>`.
- `plan create --next[=<roadmap-issue>]` — the first undone line of the
  roadmap issue. The roadmap issue is the one `--next=<n>` names; else,
  after `rafa switch`, the current place's board, or its epic, whose
  lines alone are walked; else the default board: `roadmap.issue` in
  config, the lowest-numbered open `type:roadmap` board, or the pinned
  issue titled "Roadmap". Its body is parsed by code: task-list lines
  `- [ ] #<n>` in order. A line is DONE when it is ticked or its issue is
  closed. A line is TAKEN when a branch `feat/rafa-<n>-*` exists locally or
  on the remote, or an open PR closes it. A branch the remote holds is read
  for its claim (`src/board/roadmap-claims.ts`): a released claim does not
  take the line, a stale `rafa:claimed` claim passes it as a takeover
  candidate ("#20 takeover candidate: branch <b>, claimed by <store>, has
  stood idle 4d"), and a stale `rafa:in-development` claim keeps it taken
  with a stale note. The first line neither done nor taken is the answer;
  then as `--issue=<n>`. It prints what it skipped and why ("#20 taken: PR
  #33 open"), and exits 0 with a message when nothing is left. `--dry-run`
  prints the pick and stops. The pick is claimed before the session
  (`src/commands/plan/claim-route.ts`); a claim another store holds passes
  the pick over, naming the owner, and the walk goes on, reading it as
  taken by the branch that refused it, where `--issue=<n>` exits 1.

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

Ticking: `pr merge` ticks the PR's `Closes #<n>` line on every open
`type:roadmap` board whose checklist lists it, or in the roadmap issue while
no issue carries the label, after the merge (GitHub closes the issue; it does
not tick a task-list box). Before the boards it ticks the same line on the
checklist of the open epic the issue's `epic:<slug>` label names, printing one
sentence per epic (`src/commands/pr/merge-tick.ts`).
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
The Roadmap issue is opened with `--label type:roadmap`, and an open issue
titled "Roadmap" that it adopts instead gets that label added when it
lacks it (`gh issue edit <n> --add-label type:roadmap`, `src/board/setup.ts`).
Each part is written only when missing, so a rerun changes no byte. `rafa
doctor` reports each as present or missing, with `rafa init --board` as the
fix.

### Native relationships

Measured answers for the `board.relationships: native` mode (#340). Each
answer names the command that produced it, the `gh` it ran under and the
date; a later task that depends on one follows it here and does not guess.
The measurements write only to the operator's scratch repositories
(`RAFA_340_SCRATCH_A`, `RAFA_340_SCRATCH_B`), never to `open-tomato/rafa`.

#### A relationship write does not move `updated_at`

Measured 2026-09-30 with `gh version 2.100.0 (2026-09-03)` on
`RAFA_340_SCRATCH_A`, on five issues: parent P #1, child C #2,
blocked X #3, blocking Y #4 and control Z #5, which was never linked.
Before each write the run waited 4 s, and after it 6 s, then read every
issue's `updatedAt` twice: from GraphQL (`repository.issue(number:)`) and
from REST (`gh api repos/<A>/issues/<n> --jq .updated_at`). The same
GraphQL read also took `parent`, `subIssues`, `blockedBy` and `blocking`, so each row
below shows that the write happened as well as what the timestamps did.

| Write | Link read after it | `updated_at` moved on |
|---|---|---|
| `addSubIssue(issueId: P, subIssueId: C)` | C `parent` #1, P `subIssues` [#2] | neither P nor C |
| `removeSubIssue(issueId: P, subIssueId: C)` | both empty again | neither P nor C |
| `addBlockedBy(issueId: X, blockingIssueId: Y)` | X `blockedBy` [#4], Y `blocking` [#3] | neither X nor Y |
| `removeBlockedBy(issueId: X, blockingIssueId: Y)` | both empty again | neither X nor Y |
| control: `gh api -X PATCH repos/<A>/issues/5 -f title=…` | — | Z, 11:05:30Z → 11:06:40Z |

Each write was sent as
`gh api graphql -f query='mutation{addSubIssue(input:{issueId:"<P node id>",subIssueId:"<C node id>"}){clientMutationId}}'`
(and likewise for the other three). GraphQL and REST agreed on every
reading, and P, C, X and Y kept their creation timestamps throughout. The
control shows that the same reads see a real edit. Two more reads, taken
at 11:06:57Z after the control step, agreed as well:
`issues(orderBy: {field: UPDATED_AT, direction: DESC})` listed #1–#4 at
their creation times, and
`gh api 'repos/<A>/issues?state=all&since=2026-09-30T11:05:31Z'`, one
second after the last issue was created, returned #5 alone.

What follows for the native mode: a sub-issue or blocked-by change is
invisible to anything keyed on `updated_at`. That covers a cache row's
freshness check, a `since=` poll and a sort by recently updated, and it
holds on both ends of the link. A reader that must see relationship changes
reads the relationship fields themselves.

Not measured here: the writes went through the GraphQL mutations by
`gh api`, not through `gh issue edit --add-sub-issue`, `--parent`,
`--remove-parent`, `--add-blocked-by` or `--remove-blocked-by`. The
session's rafa-tooling hook denies `gh issue` commands, so those flags were
not run. The `v2.100.0` source shows they send these same mutations
(`api/queries_issue.go`, see the `--parent` answer below), with
`replaceParent: true` added on `addSubIssue`. So they should leave
`updated_at` alone as well. That is a reading of the source, not a run.

#### `gh issue list --json subIssues` answers the order GitHub holds

Measured 2026-09-30 with `gh version 2.100.0 (2026-09-03)` on
`RAFA_340_SCRATCH_A`. The session's rafa-tooling hook denies `gh issue`, so
`gh issue list` itself was not run. The run sent the query `gh issue list`
builds instead, through `gh api graphql`: the `IssueList` query of
`pkg/cmd/issue/list/http.go` at `v2.100.0`, with the relationship fields
exactly as `api/query_builder.go` spells them:

```text
parent{id,number,title,url,state,repository{nameWithOwner}}
subIssues(first:100){nodes{id,number,title,url,state,repository{nameWithOwner}},totalCount}
subIssuesSummary{total,completed,percentCompleted}
blockedBy(first:50){nodes{id,number,title,url,state,repository{nameWithOwner}},totalCount}
blocking(first:50){nodes{id,number,title,url,state,repository{nameWithOwner}},totalCount}
```

Parent #6 got children #7, #8, #9 and #10, added in that order by
`addSubIssue`. Each reading below comes from that listing, and the same
order came back from `repository.issue(number: 6){subIssues}` and from
`gh api repos/<A>/issues/6/sub_issues --jq '[.[].number]'`:

| Step | `subIssues.nodes` |
|---|---|
| after the four adds | [#7, #8, #9, #10] |
| `reprioritizeSubIssue` moving #10 `beforeId` #7, then #8 `afterId` #9 | [#10, #7, #9, #8] |
| `gh api -X PATCH repos/<A>/issues/6/sub_issues/priority -F sub_issue_id=<#9 id> -F after_id=<#8 id>` | [#10, #7, #8, #9] |

The first reading is the control: it matches creation order, and the
reprioritised readings differ from it. So the listing carries the order.
`subIssues` therefore belongs in the native mode's listing fields, and
`membersOf(epic)` reads its order from `subIssues.nodes`. It must never
sort by number. The field stops at 100 nodes, so `totalCount` above the
node count is the truncation reading.

Not measured: a drag in GitHub's web UI. The run reprioritised through the
GraphQL mutation and the REST priority endpoint, and both moved the
listing the same way.

#### `gh issue edit --parent` on an issue that has a parent moves it

Read from source, then measured 2026-09-30 with `gh version 2.100.0
(2026-09-03)` on `RAFA_340_SCRATCH_A`. At `v2.100.0`, `--parent` builds
`DeferredUpdateIssueOptions` with `ReplaceExistingParent: true`
(`pkg/cmd/issue/edit/edit.go`). It sends
`addSubIssue(input: {issueId: <new parent>, subIssueId: <issue>, replaceParent: true})`
(`api/queries_issue.go`). `--add-sub-issue` sends the same mutation with
`replaceParent: true`, and `--remove-parent` sends `removeSubIssue` against
the parent it has just read. The hook denies `gh issue`, so the run sent
those mutations through `gh api graphql`. It used child #13 under old
parent #11, with new parent #12:

| `addSubIssue(issueId: #12, subIssueId: #13, …)` | Answer | #13 `parent` | #11 `subIssues` | #12 `subIssues` |
|---|---|---|---|---|
| `replaceParent` left out | error, exit 1 | #11 | [#13] | [] |
| `replaceParent: false` | error, exit 1 | #11 | [#13] | [] |
| `replaceParent: true` (what `--parent` sends) | ok | #12 | [] | [#13] |

Both refusals print
`Failed to add sub-issue #13 to parent #12. Sub issue may only have one parent`
(GraphQL `type: VALIDATION`). A second move with `replaceParent: true`
took issue #10 out of the first position under #6, into #12, which
already held #13. Then #12 read [#13, #10], and #6 read [#7, #8, #9]. A
moved issue goes to the end of its new parent, and the old parent closes
the gap.

What follows for the native mode: a parent write is a move in one call,
with no remove first. It needs `replaceParent: true`: `gh issue edit
--parent`, or the mutation with that input. The old parent loses the
issue in the same call, so an epic move is one write, and the new epic's
order puts the issue last.

#### GitHub's cap on sub-issues per parent

Measured 2026-10-01 with `gh version 2.100.0 (2026-09-03)` on
`RAFA_340_SCRATCH_A`. The run created parent #31 and children #32 to #132
through `gh api repos/<A>/issues`, then added the children one at a time
with `gh issue edit 31 -R <A> --add-sub-issue <n>` until GitHub refused:

| Step | Answer | #31 `subIssues.totalCount` |
|---|---|---|
| add #32 to #131 | ok, 100 times | 100 |
| add #132 | error, exit 1 | 100 |
| control: remove #131, add #132 | ok | 100 |
| control: add #131 back | error, exit 1 | 100 |

Both refusals print
`GraphQL: Failed to add sub-issue #132 to parent #31. Parent cannot have more than 100 sub-issues (addSubIssue)`
(the control names #131). The control shows the refusal comes from the
count, not from the child: #132 went in once a place was free.

So the cap is 100 sub-issues per parent. At the cap, the
`gh issue list` query above answered 100 `subIssues.nodes` with
`totalCount: 100` and `subIssuesSummary.total: 100`, and a direct
`subIssues(first:100)` read answered `pageInfo.hasNextPage: false`. A
parent cannot hold a 101st member, so `subIssues(first:100)` never
misses one. The reader's `truncated` reading stays as a guard in case
GitHub raises the cap.

#### A blocker in another repository adds and reads with its own state

Measured 2026-09-30 with `gh version 2.100.0 (2026-09-03)`. The run used
blocked issue #14 on `RAFA_340_SCRATCH_A` and blocker #1 on
`RAFA_340_SCRATCH_B`. It sent
`addBlockedBy(input: {issueId: <A#14>, blockingIssueId: <B#1>})` through
`gh api graphql`, and the call succeeded. It then read both repositories
with the `gh issue list` query above:

| Step | A#14 `blockedBy.nodes` | B#1 `blocking.nodes` |
|---|---|---|
| after the add | B#1, `state: OPEN`, `repository.nameWithOwner: <B>`, `totalCount: 1` | A#14, `state: OPEN`, repository `<A>` |
| after `gh api -X PATCH repos/<B>/issues/1 -f state=closed -f state_reason=completed` | B#1, `state: CLOSED`, repository `<B>` | A#14, `state: OPEN` |

So a foreign blocker arrives in the blocked repository's one board read,
with its number, state and repository. The native reader gets it from the
`blockedBy` node and needs no per-blocker `gh issue view`. A blocker's
`number` alone is ambiguous across repositories. The reader keys a blocker
by its repository (`owner/name`) and `number` together; see the next
answer for where the listing's repository comes from.
`gh issue edit --add-blocked-by` takes a number or a URL.
`ResolveIssueRef` (`pkg/cmd/issue/shared/lookup.go`) resolves a URL to its
own repository. It refuses only a URL on another host, so a foreign blocker
is written by URL. `blockedBy` stops at 50 nodes, and `totalCount` above
the node count is its truncation reading.

Not measured: a blocker in a repository the reading account cannot see.
Both scratch repositories belong to the same account.

#### `gh issue list --json` answers a linked issue without its repository

Measured 2026-09-30 with `gh version 2.100.0 (2026-09-03)`, running
`gh issue list -R <A> --state all --limit 50 --json number,parent,blockedBy,blocking,subIssues,subIssuesSummary`
itself, and the same fields on `open-tomato/rafa` with `--limit 2`. Every
linked issue — `parent`, and each node of `blockedBy`, `blocking` and
`subIssues` — came back with the keys `id`, `number`, `state`, `title`
and `url`, and no `repository`, although the query `gh` sends asks for
`repository{nameWithOwner}` (see the `subIssues` answer above). The
foreign blocker of A#14 read as
`{"number":1,"state":"CLOSED","url":"https://github.com/<B>/issues/1",…}`.
`parent` is null or one such node. The three lists are
`{"nodes":[…],"totalCount":n}`, and `subIssuesSummary` is
`{"completed","percentCompleted","total"}`.

What follows for the native mode: the listing reads a linked issue's
repository off its `url` (`https://<host>/<owner>/<name>/issues/<n>`),
and `parseBoardListing` (`src/board/roadmap-board.ts`) refuses a node
whose `url` is not issue `number`'s. A read that asks GraphQL directly
may take `repository.nameWithOwner`, but it must answer the same row
shape as the listing.

#### The incremental read in the native mode

Measured 2026-09-30 with `gh version 2.100.0 (2026-09-03)`, read-only,
with the argv `nativeChangedArgs` (`src/board/board-cache-native.ts`)
builds: `gh api graphql --paginate` over
`repository.issues(first: 100, filterBy: {since})`, asking for the
listing's six fields, `updatedAt` and the five relationship fields, with
`{owner}` and `{repo}` filled by `gh` (`-F`).

| Reading | Answer |
|---|---|
| `open-tomato/rafa`, `since` 2026-09-29T00:00:00Z | 224 issues over three pages, in the one `gh` command; every row read by `parseBoardListing` in the native mode |
| each page, read from `rateLimit{cost}` | 4 points, the same for a page of 100 issues, of 2 and of none |
| `since` equal to #278's `updatedAt` | #278 answered: `since` keeps an issue updated AT the time given |
| control: `since` 2099-01-01T00:00:00Z | no issue, at 4 points |
| `RAFA_340_SCRATCH_A` from 2020 | 30 issues; children of #6 and #12 read their parent, A#14 reads the foreign blocker B#1 `CLOSED` in `<B>` |
| `createCachedBoardListing` over the real runner, `native` then `native` | a full read of 422 issues (watermark and listing, 5.7 s), then ONE `gh api graphql` call, 0.65 s |

`gh --jq` writes an object's keys in name order, as it does for the REST
read of the labels mode, so a changed row's key order is `gh`'s and the
same on every read.

A blocker closing does not move the blocked issue's `updated_at`: B#1
closed at 11:30:16Z, and A#14's `updated_at` read 11:30:07Z, its
creation time, afterwards. So the incremental read answers the closed
blocker's own row but not the blocked row that holds it as a node; a
kept native row's linked issue holds the state it had when that row was
last read.

Not measured: a board large enough that a page of the incremental read
times out, and a page cost on a board whose issues hold many links.

#### The read by number after a relationship write

A relationship write moves no `updated_at` (above), so the kept listing
drops the rows `invalidateRows` (`src/board/board-cache.ts`) is given and
reads them again by number on the next read. Measured 2026-09-30 with
`gh version 2.100.0 (2026-09-03)`, read-only, on `RAFA_340_SCRATCH_A`,
with the argv `nativeIssuesArgs` (`src/board/board-cache-native.ts`)
builds: one `gh api graphql` query aliasing each number as
`i<n>: issue(number: n) { ...row }`, the fragment asking what the `since`
read asks.

| Numbers | Answer |
|---|---|
| #1, #2 | two rows in the `since` read's shape, exit 0 |
| #1, #99999 (not in the repository) | #1's node, `i99999: null` and a `NOT_FOUND` error; `gh` printed the error and exited 1 |

What follows: a touched issue that is gone fails the read, and the kept
listing falls back to a full one.

#### `pr merge` freed-issues per mode

The sixth step of `pr merge` (lines 163–181) differs between modes:

In **`labels` mode** (the default), the unblock reading (`src/commands/pr/merge-unblock.ts`)
runs after the cleanup: it reads every open issue labelled `spec:blocked` whose
`Blocked by:` line names an issue this PR closes. For each such issue whose
blockers have all closed, it asks `#<n> was blocked by #24, all closed. Remove
spec:blocked? [y/N]` and removes the label on a yes (`src/board/relations/labels.ts`'s
`afterMerge`). `--yes` does not answer that question; every failure is a warning.

In **`native` mode**, the freed reading (`src/commands/pr/merge-freed.ts`) prints
the open issues the merge freed, read through the port's `freedBy`, and sends no
write (`src/board/relations/native.ts`'s `afterMerge`). An issue is freed when it
is open, waits on blockers, and has at least one blocker among the closed issues
and would not wait on anything once those count as closed. The output is silence
when the merge freed nothing; otherwise a header line naming the mode, the count,
the closed issues and that nothing was written, followed by one indented line per
freed issue — lowest number first — naming its number and title, or number alone
if the title is empty. `--yes` does not answer anything, since there is no
question. A read that cannot get the board's repository or the native listing
sends one warning and prints nothing, as the merge has already happened.

#### Cache and truncation for freed-issues in native mode

The freed reading in native mode sends two `gh` calls from the one board listing
the command already holds: the board's repository (one `gh repo view --json
nameWithOwner`, `readBoardRepository`, `src/commands/epic/move-native.ts`) to
tell the board's issues from foreign blockers; and one native board listing (`gh
api graphql` with `filterBy: {since}` on an incremental read, or a full listing
on the first read). No per-blocker `gh issue view` is sent; a blocker's state
comes from its `blockedBy` node (`src/board/relations/native.ts`, the port
definition).

An issue stays waiting when it has a blocker in the closed issues BUT its
`blockedBy` list is truncated at 50 nodes: an unread blocker might still be open,
so the issue is not reported as freed. The truncation key is left out (never set
to undefined) when `gh`'s `totalCount` equals the node count. A blocker on
another repository reads its state from the node; a blocker on this board whose
row the listing does not hold (missing, outside any `since` window, or past a
truncation limit) counts as unread and keeps the issue waiting, the safe
direction the port defines. A foreign blocker is keyed by repository (`owner/name`)
and number together; the repository comes from its `url`.

### Claims

A claim reserves an issue for one device to work alone. The claim lives in
git as the ownership record on the branch `feat/<stub>` (formatted
`feat/rafa-<n>-<slug>` where the branch already runs). Its first commit is
an empty CLAIM commit naming the claiming store's id (`store_meta.store_id`
from the effort store) in the trailer `Rafa-Claim-Store:`. Every later
ownership change (release, handover, acceptance, takeover) is one empty
commit pushed with `git push --force-with-lease=refs/heads/<branch>:<sha>`,
reading the sha last seen. The owner is the store named by the latest
ownership commit on the branch. Work commits are never rewritten and never
leave the branch.

**Labels show the stage, never the owner:** `rafa:claimed` at `plan create`,
swapped for `rafa:in-development` when `loop start` begins the session, and
removed when the pull request merges through `rafa pr merge` or the claim is
released. `rafa status` shows who holds each claim. Ownership commits name
the actor in a trailer: `claim` for the initial claim, `hand` and `accept`
for handovers, `release` for release, `withdraw` to cancel a hand that was
not yet accepted, `take` for takeover.

**Release:** `rafa claim release <n>` ends ownership and leaves the issue
claimable. The push, the label removal and any force-push refusal are the
command's only steps. A released claim has a release commit on the branch
and does NOT take the line in a roadmap walk — the next claimant pushes a
take commit on it.

**Handover:** Ownership change is two-sided. The owner runs `rafa claim hand
<n> --to=<store id>`, pushing a hand commit naming the receiver; the
receiver runs `rafa claim accept <n>`, pushing an accept commit naming the
giver. Until acceptance the owner stays the owner and may run `rafa claim
withdraw <n>` to cancel the handover, pushing a withdraw commit.

**Takeover:** `rafa claim take <n> [--stale]` takes a claim held too long.
Without `--stale` it refuses unless the claim reads stale by `claims.staleAfter`
(a duration such as `3d` or `disabled`, default `3d`; zero or negative is
refused). Staleness reads from the committer date of the branch tip on the
remote. The command fails if the claimed issue was written in this run or if
the ownership push is refused. `claims.staleAfter` applies only to
`rafa:claimed` claims; `rafa:in-development` is never taken over automatically,
only by an explicit `rafa claim take <n> --stale`.

**Claim lost:** When a push of the claim branch is refused and another device
now owns the claim, the run halts with a "claim lost" report and keeps its
commits on the local branch `lost/<stub>`, named after the original branch
stub. Nothing force-pushes over the new owner. The refusal happens only on
`loop start`'s preflight, not at plan time — `plan create` warns "unclaimed"
when the claim push fails but goes on to write the plan and start the session.

**Claim ahead:** Opt-in look-ahead lock to claim one issue ahead on the
roadmap. Both the home issue and one ahead are claimed through an atomic push
(`git push --atomic`), so either both succeed or both fail. `claims.ahead`
is `off` (no look-ahead) or `allow` (look-ahead enabled, default `off`), and
`--claim-ahead` on `rafa next --roadmap` and `plan create --next` opts into
it for one run. Until #248 lands, claim ahead reaches only issues on the
same board as the home issue; one on another board is not claimed and is
reported.

**Drift check:** Every second `loop start` and on each `rafa switch` without
cache invalidation, a report-only drift check reads the board through
`src/board/board-cache.ts` and verifies that the stage label on each open
claim's issue matches its claim state. A mismatched label (a label in the
wrong stage or both stage labels present) is reported, and the check never
edits a label or a body. A board that is not `gh` or a label write that
fails warns and does not undo the claim, since the claim lives in git.

`claims.staleAfter` and `claims.ahead` join `LOCKED_SETTINGS` in
`src/config-locked.ts` as settings no device can override alone.
