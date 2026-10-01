# tomato

A two-line zsh prompt for rafa projects. The first line holds git and
rafa on the left, a spacer for short status messages, and the task
counter alone at the top right. The second line is where you type.

```
rafa feat/rafa-367-releases-settle-base-branch +3130 -160 │ rafa:0.24.1 │ spec: #367 - Releases settle on the base bra…      │ 🍅 #367 13/47 · #370 8/33
host >
```

## The left side

Three groups, divided by a dim `│` (`TOMATO_DIVIDER` changes it).

| Part | Shows | Read from |
| --- | --- | --- |
| `rafa` | the repository's name, dimmed, and the path below its root when you are in a subfolder (`rafa/extras/zsh`); a worktree shows the repository's name, not its own folder | `git rev-parse` |
| `feat/rafa-367-…` | the branch, in bold | `git rev-parse` |
| `+3130 -160` | lines added (green) and removed (red) by the branch against its base, counted the way the Claude app counts them: commits, staged and unstaged changes against the merge base with `origin/HEAD`, plus every line of untracked files; left out when both are 0 | `git diff --merge-base`, `git ls-files --others` |
| `rafa:0.24.1` | the installed rafa, in a rafa project or when `~/.rafa` exists | the target of the `rafa` on `PATH`, else `~/.rafa/bin/rafa` |
| `spec: #367 - title` | on a spec branch: the issue and its title | the board cache, else the plan's `# Plan:` line |
| `roadmap: #252` | off a spec branch: the epic `rafa next` walks, the first open `horizon:now` epic in the Roadmap issue's order | the board cache |
| `[4/10]` | closed and total issues of that epic, bugs included, the epic itself left out | the board cache |

Outside git, the left side is the working directory, its last three
parts. An untracked file over `TOMATO_UNTRACKED_MAX_BYTES` (1 MiB) is
not counted, so a stray dump does not slow the prompt.

**No pull request indicator.** Whether a branch has a PR is known only
to GitHub, and asking takes around a second, far too long for a prompt.
It needs a background refresh writing a local cache first; that is not
built.

**The board cache is only as fresh as the last rafa command that read
the board** (`rafa roadmap`, `rafa next`, `rafa status`). An issue filed
since then has no title or count in the cache, so a new spec shows its
plan's title and no count until the next board read.

## The top right

After a dim divider, one 🍅 and every live loop of the project as
`#<issue> <task>/<total>`, the current branch's first and the others by
issue number, divided by `·`: `│ 🍅 #367 13/47 · #370 8/33`. A running
loop is red and shows the task in progress; a paused one is yellow and
shows the tasks done; neither count goes past the total. Once its tasks
are done, a loop shows the phase its record names instead of a count:
`wrap-up`, `pull-request`, `ci` or `repair`, as in `│ 🍅 #367 wrap-up`.
A record with no phase, from an older rafa, shows the count.

A loop is live while its record under `.rafa/runs/` says `running` or
`paused` and its process is still alive, so a record left behind by a
loop that died is not counted. The records and the trackers are read
from the main checkout, which every worktree of the project shares.

When no loop runs on the current branch, its own state from the
rafa-prompt plugin ([`../rafa-prompt/`](../rafa-prompt/)) comes first:
`│ ⏳ #387 1/3 │ 🍅 #367 13/47`.

## The second line

The host on macOS and `user@host` elsewhere, then `>`, green after a
command that succeeded and red after one that failed.

## The spacer and the title

The spacer keeps `TOMATO_SPACER_MIN` columns (40, room for a short
sentence) between the left side and the top right. A spec title
longer than `TOMATO_TITLE_MAX` (32) takes every free column beyond
those 40, so on a wide terminal it shows whole and the spacer still has
its room. With less than 40 columns free the spacer is off, and the
title takes the free columns, as many as it needs.

When even that does not fit, these give way in order: the title down to
12 characters, the middle of the branch name down to 16, the loops of
other branches, the rafa version, and then the title, which gets back
any spare columns once a readable part fits. The current branch's part
of the top right goes last. One column is kept spare, because some
terminals draw an emoji a cell narrower or wider than zsh counts it.

| Width | What happens |
| --- | --- |
| 220 | spacer on with its 40 columns, the title grown into the rest |
| 190 | spacer on, the title grown to what is left past the spacer |
| 150 | spacer off, the title shown whole or nearly |
| 100 | spacer off, branch and title cut in their middle and end |
| 80 | the version gives way too |

## Adding it

Keep the files in a checkout that stays on `main` (see
[Where to keep it](../../README.md#where-to-keep-it)); the examples use
`~/rafa-extras`. The theme sources the rafa-prompt plugin from beside
it, so link the theme file itself and leave the directories where they
are.

### oh-my-zsh

1. Link the theme into your custom themes:
   ```bash
   ln -sfn ~/rafa-extras/extras/zsh/tomato/tomato.zsh-theme ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/themes/tomato.zsh-theme
   ```
2. In `~/.zshrc`, in place of your `ZSH_THEME=` line, pick tomato only
   while its file is there, so a missing checkout falls back instead of
   failing:
   ```zsh
   if [[ -r ${ZSH_CUSTOM:-$ZSH/custom}/themes/tomato.zsh-theme ]]; then
     ZSH_THEME="tomato"
   else
     ZSH_THEME="robbyrussell"
   fi
   ```
3. Open a new terminal.

You don't need the rafa-prompt plugin in `plugins=(…)`, and no
`RPROMPT` line either: the theme draws the task segment itself.

### zsh without oh-my-zsh

```zsh
[[ -r ~/rafa-extras/extras/zsh/tomato/tomato.zsh-theme ]] &&
  source ~/rafa-extras/extras/zsh/tomato/tomato.zsh-theme
```

`jq` is needed for the board parts; without it they are left out and
the rest still shows.

## Spacer messages

Each function named in `tomato_spacer_functions` prints one message or
nothing; the messages are joined by two spaces and shown only while the
spacer is on and they fit. For example:

```zsh
tomato_spacer_retro() {
  [[ -n $(print -r -- .rafa/retro-*.md(N)) ]] && print -r -- 'retro pending'
}
tomato_spacer_functions+=(tomato_spacer_retro)
```

Each function runs on every prompt, so keep it to local files. Test
runs, retrospectives and rotating status messages are the ideas for
this slot; none is built yet.

## Cost

About 80 to 100 ms per prompt on a MacBook in the rafa checkout (zsh
5.9, 2026-09-29), and it grows with the branch's diff. Nearly all of it
is three `git` calls: one for the checkout and branch, one for the diff
against the base, and one for the untracked files. The diff call is the
one that grows, about 70 ms on a branch of +6322 -2452. Reading every
live loop costs about 7 ms. The board query runs again only when the
board cache or the spec changes. Moving the git counts off the prompt's
critical path, as oh-my-zsh does for its git segment, is the next step
if it feels slow.

## Safety

Branch names, titles and messages come from git, GitHub and files, so
each `%` in them is escaped. The lines are built in `precmd` and only
referenced from `PROMPT`, so a `$(…)` in a title prints as text and
never runs. A fixture with such a branch name, plan title and board
title checked this.
