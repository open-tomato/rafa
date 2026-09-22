# Specs, issues and the roadmap

How rafa uses a GitHub issue board: what a spec is, how to write one, how
the roadmap picks the next one, which labels mean what, and what stands
between a stranger's text and an agent's prompt.

None of this is required. `rafa plan create --spec=<file>` plans from a
local file and never touches a board. The board is for when you want the
work queue, the specs and their history in one shared place.

## Set the board up

```bash
rafa init --board
```

On a repository whose remote is GitHub, this creates what is missing and
leaves the rest alone: the labels below, the issue template
`.github/ISSUE_TEMPLATE/spec.md`, and a pinned issue titled "Roadmap",
whose number is written to `.rafa/config.yaml` as `roadmap.issue`.
`rafa doctor` reports any of them that is missing. It needs the GitHub
CLI, `gh`, installed and logged in.

## What a spec is

One issue, one plan, one pull request. A spec is an issue opened from the
"Spec" template, with six headings the planner reads:

| Heading | What goes there |
| --- | --- |
| What you get | The change from the outside, in one paragraph. |
| Starting position | What exists today that this builds on. Name the files and commands. |
| Design | The pieces, where each lives, and the alternative you rejected. |
| What can go wrong | The failure modes, and the check that would catch each. |
| Tasks the plan must carry | One list item per piece of work, each naming what it changes. |
| Definition of done | One list item per thing a command can show. "Works well" is not one. |

The template's first line reminds you that an issue on a public
repository is public: no local paths, no internal host names, no
credentials. Machine-specific notes go in a local file,
`.rafa/specs/rafa-<n>-notes.md`, which rafa appends to its own copy of
the spec and never sends anywhere.

### Blocking other specs

A spec may depend on work in another spec. Add a line to the issue body:

```text
Blocked by: #42, #57
```

The `rafa plan create --next` command reads this line and skips the spec,
offering instead the first unblocked spec under it. Once the blockers
close, `rafa issue unblock #<n>` removes the `spec:blocked` label and the
spec is ready for planning. `rafa pr merge` runs that same unblock logic
when a merged PR closes one or more blockers. The line names one or more
issue numbers separated by commas or spaces; missing, malformed or invalid
lines are reported by `rafa doctor`.

### A prompt for drafting one

Paste this into a Claude Code session opened in your repository, with
your idea in place of the last line. It produces a draft in the
template's shape; you still read it, correct it and open the issue
yourself.

```text
Draft a spec for this repository in the shape of
.github/ISSUE_TEMPLATE/spec.md, as markdown I can paste into a new issue.

Before writing, read the code the change touches and name real files,
commands and tests under "Starting position". Do not invent any.

Rules:
- "What you get" is one paragraph about what somebody can do afterwards
  that they cannot do now. No implementation words.
- "Design" names each piece, where it lives, and one alternative you
  rejected with the reason.
- "What can go wrong" lists failure modes, each with the check that
  would catch it.
- "Tasks the plan must carry" is a list. Each item names what it
  changes and how it is tested. No item is a paragraph.
- "Definition of done" is a list of things a command can show, each
  with the command or the observable result.
- Nothing may be left as TBD or TODO. If you cannot decide something
  from the code, stop and ask me instead of guessing.
- This will be public: no absolute paths from this machine, no internal
  host names, no tokens.

The change I want: <describe it in a few sentences>
```

## From an issue to a plan

```bash
rafa plan create --issue=42     # plan from issue #42
rafa plan create --next         # plan from the first undone line of the Roadmap issue
rafa plan create --next --dry-run
```

`--issue` copies the issue's body to `.rafa/specs/rafa-42-<slug>.md` and
plans from that copy, so the plan keeps the text it was made from even
if the issue is edited later. If the issue body has changed since the copy
was saved, `rafa` prints the difference lines and refuses to plan, naming
the reason and the `--refresh` flag that would overwrite the saved copy
without asking. If only the local notes file `rafa-42-notes.md` changed,
the copy is rebuilt and the old one moved to `.rafa/specs/previous/` first.
With a terminal, a changed body offers a question: update the saved copy
and plan from the new version? No terminal, no offer — the refusal stands.
The `--refresh` flag rebuilds the copy and plans without asking. When more
than fifty previous copies accumulate under `previous/`, `rafa doctor`
warns that they are safe to delete. The plan, its branch and its pull
request carry the same name: `rafa-42-<slug>`, `feat/rafa-42-<slug>`,
`rafa-42: <title>`, with `Closes #42` in the pull request.

## The roadmap

The pinned "Roadmap" issue is an ordered task list, one spec per line:

```markdown
- [ ] #42 Export reports as CSV — finance asked first
- [ ] #57 Bulk import — needs #42's column mapping
```

`rafa plan create --next` reads it in order and takes the first line
that is neither done nor taken. A line is **done** when it is ticked or
its issue is closed. A line is **taken** when a branch `feat/rafa-<n>-…`
exists or an open pull request closes that issue. It prints what it
skipped and why, and it **stops** at a next line that is not marked
ready rather than skipping ahead, because skipping would reorder your
roadmap without telling you. `rafa pr merge` ticks the line of the issue
its pull request closes.

To change the order, edit the issue. There is nothing else to keep in
sync.

## Labels

| Label | Meaning | Who sets it |
| --- | --- | --- |
| `type:spec` | This issue is a spec. | The template. |
| `spec:ready` | A person has read it and says a plan may be made from it. | A maintainer. |
| `spec:needs-work` | Agreed in outline, details pending; or the planner's review found gaps and listed them in a comment. | A maintainer, or rafa after a review. |
| `spec:blocked` | One or more issues named in the `Blocked by:` line must be closed first. Removed when all blockers close. | rafa or a person. |
| `type:bug` | A defect. rafa files these itself for out-of-scope bugs a run meets. | rafa or a person. |
| `needs-triage` | Filed by a run and not looked at yet. | rafa. |
| `module:unassigned` | No part of the project owns this yet. | rafa. |

## Safety: what stands between an issue and an agent

Text from an issue ends up in an agent's prompt, and that agent can
change your repository. So planning from the board is gated, cheapest
check first, and any failure writes no plan:

1. **Who wrote it.** The issue's author must have write access to the
   repository (`admin`, `maintain` or `write`), or be listed under
   `board.trustedAuthors` in your config. GitHub lets only the author and
   write-holders edit an issue body, so a trusted author means a trusted
   body. Comments are never read into a plan. A permission lookup that
   fails is a refusal, not a pass. This applies to public and private
   repositories alike, and to the Roadmap issue and to rafa's own marker
   comments too, so nobody can plant a "triage result" for an agent to
   follow.
2. **A person said so.** The issue carries `spec:ready`. Only people with
   triage rights can label, and rafa never adds this label by itself.
3. **It is complete.** Every heading is present and filled, the task list
   and the definition of done hold at least one item each, and no `TBD`
   or `TODO` survives.
4. **It does not leak.** A body holding a home-directory path or a
   token-shaped string is refused, naming the line.
5. **The planner's own review.** The planning session judges whether each
   definition-of-done item can be shown by a command and whether anything
   would have to be guessed, and says of each gap whether it blocks
   planning. "Not ready" over a blocking gap removes the plan, lists the
   gaps in one comment on the issue and swaps the label to
   `spec:needs-work`. "Not ready" over gaps it can all plan under keeps
   the plan, opens it with the assumptions it planned under, lists the
   same gaps in the comment and leaves the label alone.

Related, and worth knowing: bugs a run meets that are about one machine
(a broken toolchain, a failed package build) are kept local and not
filed on your public tracker. And the run itself is unsandboxed; see
"Before you run it" in the [README](../README.md).

## Other trackers

GitHub Issues is what works today, through `gh`. The tracker sits behind
a port with a `local` fallback (issues as files under `.rafa/`), so
other boards are adapters, not rewrites.

**Linear is coming.** The project rafa grew out of ran on Linear, and
that adapter is being ported as an optional add-on for a later version.

Want Jira, GitLab, Notion, Obsidian or something else? Look for an
existing request and add a 👍 to it, or open a new one, at
[github.com/open-tomato/rafa/issues](https://github.com/open-tomato/rafa/issues?q=is%3Aissue+tracker+support).
Votes decide the order. As requests appear, this page will link each
one directly.
