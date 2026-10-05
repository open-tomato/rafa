# Claude Code

A tooling pack that makes Claude Code agents in a rafa project use rafa
lines in place of `gh` chains, and hand the user the commands that are
the user's to run. Measured on 2026-09-30 with rafa 0.31.0 and Claude
Code 2.1.283.

## What it puts in a project

`rafa-hookify/install.ts` copies three files and adds two entries. Each
row is one of them.

| Installed at | From | What it does |
| --- | --- | --- |
| `.claude/skills/rafa-tooling/SKILL.md` | `files/rafa-tooling-skill.md` | The rules: the `gh`-to-rafa mappings, who runs which command, flag syntax, 🪙 commands, logins, checkouts, `pr merge` checks, the tomato header |
| `.claude/skills/rafa-tooling/help-tree.ts` | `files/help-tree.ts` | The whole command tree in one page: `rafa describe \| bun .claude/skills/rafa-tooling/help-tree.ts` |
| `.claude/hooks/rafa-tooling-hook.ts` | `files/rafa-tooling-hook.ts` | The PreToolUse hook below |
| `.claude/settings.json` | | A `PreToolUse` entry with matcher `Bash` that runs the hook; the rest of the file is kept |
| `AGENTS.md`, else `CLAUDE.md` | | One line pointing at the skill, appended at the end |

## Install

`/rafa-hookify` is a skill you install once for your user, and then run
in each project. Copy its folder from a checkout that stays on `main`
(see [Where to keep it](../README.md#where-to-keep-it)):

```bash
cp -R ~/rafa-extras/extras/claude-code/rafa-hookify ~/.claude/skills/
```

Then, in a Claude Code session in the project's main checkout, the one
that holds `.rafa/`, type `/rafa-hookify`. It shows what it would change,
installs, checks the hook answers, and leaves the changes uncommitted. It
never runs on its own: its frontmatter sets `disable-model-invocation`.

Without Claude, run the installer directly:

```bash
bun ~/.claude/skills/rafa-hookify/install.ts --dry-run
```

Every step checks first, so a second run reports `unchanged` for every
row. To update a project after pulling a newer pack, copy the folder
again and rerun `/rafa-hookify`: it replaces only the files that differ.
Skills and hooks load when a session starts, so the pack takes effect in
the next session.

## What the hook decides

The hook reads each command in a Bash line, with quoted text blanked so
a comment body cannot trigger it, and answers one of four ways.

| Answer | Commands | The agent is told |
| --- | --- | --- |
| deny, hand it over | `rafa pr merge`, `release tag`, `self-update`, `loop start`, `issue ready`; `cleanup` without `--dry-run`; `next` without `--dry-run` or a `--yes` list of only `sync`, `wait`, `unblock`, `home`, `resume`; `gh pr merge` | Hand the line to the user in a `bash` block, and do not retry |
| deny, use rafa | `gh pr view`, `checks`, and `list` with no filter; `gh pr view --json` when `rafa pr show` answers every field asked; `gh issue create` when every flag and label maps onto `rafa issue create`; `gh issue view`, `list`, `comment`, `close` | The rafa line that replaces it, a `gh issue create` translated flag by flag |
| let through, with a reason | `gh pr view --json` asking for a field `rafa pr show` does not answer, or a field list the hook cannot read; `gh issue create` carrying a flag or label `rafa issue create` has no flag for, such as `--assignee` or an `epic:` label | What rafa lacks, ending with an offer to report the gap: search `rafa issue list --module=cli-gap` first, ask the person once, then file it with `rafa issue create --type=bug --module=cli-gap` |
| ask | `plan create` without `--dry-run`, `pr triage`, `epic close`, `skill backfill` | That it starts a Claude session (🪙) |

A `gh issue create` maps flag by flag. `--title`/`-t`, `--body`/`-b`
and `--body-file`/`-F` keep their names; a `type:<t>`, `module:<m>` or
`priority:<p>` label, given once per `--label`/`-l` or comma-joined,
becomes `--type`, `--module` or `--priority` for a value rafa takes; and
`spec:blocked` on a `type:spec` with a body file is left off, since rafa
adds it from the body's `Blocked by:` line. So `gh issue create --label
type:spec --body-file spec.md` is denied naming `rafa issue create
--type=spec --body-file=spec.md`.

A let-through writes no permission decision, so the normal permission
flow applies, and its reason reaches the session as `additionalContext`.
Everything else passes with no output: `gh pr list` with a filter or a
closed state, since `rafa pr list` shows open pull requests only, and
`gh pr create`, `gh pr checkout`, `gh run view` and `gh api`. A `gh pr` or `gh issue`
naming another repository with `-R`/`--repo` passes too, since rafa reads
only the project's own: the hook reads that from `git remote get-url
origin`, and when it cannot, any named repository counts as another one.
To turn the hook off in a project, remove its entry from
`.claude/settings.json`.

## What the pack cannot reach

The app's prompt suggestions, the next prompt it offers in the message
box after each reply, come from a request of their own, outside the
session's turn. The skill never loads into that request, and the hook
sees tool calls only, so a suggestion can still offer a rafa line as a
prompt. Measured on 2026-09-30: after a reply that named no such line,
the box offered `rafa issue ready 457`, a spec command, for a bug.

The skill's rule for a message that is only a rafa line is the fallback.
Accepting such a suggestion makes the session run the line, or hand it
back as a `bash` block when it needs a terminal, at the cost of one
round trip. To stop the suggestions themselves, turn off Prompt
suggestions in the Code tab's settings.

## Measured

Each run was a fresh `claude -p` session in this repository, allowed
only rafa reads, so no write could land.

| Setup | Prompt | Result |
| --- | --- | --- |
| skill only, Haiku | "Did CI pass on PR 442?", "Close issue 374…" | `gh` in 3 of 3; the skill never loaded |
| skill and pointer line, Haiku | same | `gh` in 3 of 3 |
| skill, pointer and hook, Haiku | same, "List the open bugs." and "PR 442 is green, merge it." | `gh` denied, then the rafa line or a hand-over, in 7 of 7 |
| skill only, Sonnet | "PR 442 is green, merge it." | skill loaded, but tried `rafa pr merge` itself in 2 of 3 |
| skill, pointer and hook, Sonnet | a bare `rafa pr merge 442 --skip-checks`, `rafa self-update`, "Tag the release and update rafa." | handed over as a `bash` block in 3 of 3 |

One Haiku run reported "Done" for an issue move that the permission
prompt had stopped. The skill now says a stopped command is reported as
not run, and no hook can check that wording.

## The help tree's cost

The pack's tree page is the compact form of `rafa describe`. Sizes for
rafa 0.31.0, with tokens estimated as bytes ÷ 4:

| Form | Bytes | About |
| --- | --- | --- |
| `rafa describe`, JSON | 214,296 | 54,000 tokens |
| every `--help` page, walked | 173,307 | 43,000 tokens |
| `help-tree.ts --flag-notes` | 29,186 | 7,400 tokens |
| `help-tree.ts` | 10,332 | 2,600 tokens |
