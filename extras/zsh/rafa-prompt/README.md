# rafa-prompt

A zsh prompt segment for the rafa plan of the current branch. rafa names
a plan's branch `feat/<stub>` and the plan `PLAN-<stub>.md`, so the
branch alone says which plan to read.

The [tomato theme](../tomato/) draws this same segment at the right
edge of its first line; with that theme, this plugin needs no setup of
its own.

## What it shows

| Segment | When |
| --- | --- |
| `▶ #367 ready 0/47` | The plan exists and no task is done: good to go |
| `⏳ #367 5/47` | Some tasks are done, and no loop is running |
| `🍅 #367 task 6/47` | A loop is running on this branch |
| `⏸ #367 paused 5/47` | A loop on this branch is paused |
| `⚠ #370 2 blocked, check plan` | The tracker holds `[BLOCKED]` tasks: read the plan before looping again |
| `✅ #367 done` | Every task is done |
| `📝 #367 no plan` | A `feat/` branch with no plan in the plan directory |
| nothing | Outside a rafa project, on `main` or `master`, or on a branch that is not `feat/` and has no plan |

The number is the issue in a `rafa-<n>-…` stub; any other stub is shown
as it is.

## What it reads

Local files only, because a prompt redraws on every Enter:

- one `git rev-parse` for the checkout, the main checkout and the branch;
- `plan.dir` from `.rafa/config.yaml`, else `.rafa/plans`, first in the
  checkout and then in the main checkout, since plans are gitignored and
  a worktree has none of its own;
- `PLAN_TRACKER-<stub>.md` when it exists, else `PLAN-<stub>.md`,
  counting `- [x]`, `- [ ]` and `- [BLOCKED]` lines;
- the run records in `.rafa/runs/*.json`: one naming this branch, in
  state `running` or `paused`, whose process is still alive.

It never starts rafa and never reaches the network. One call took about
25 ms on a fixture repository (macOS, zsh 5.9).

## Adding it

Keep the files in a checkout that stays on `main` (see
[Where to keep it](../../README.md#where-to-keep-it)); the examples use
`~/rafa-extras`.

### oh-my-zsh

1. Link the plugin into your custom plugins:
   ```bash
   ln -sfn ~/rafa-extras/extras/zsh/rafa-prompt ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/rafa-prompt
   ```
2. Add `rafa-prompt` to `plugins=(…)` in `~/.zshrc`.
3. Below `source $ZSH/oh-my-zsh.sh`, put the segment on the right side:
   ```zsh
   RPROMPT='$(rafa_prompt_info)'
   ```
4. Open a new terminal.

A theme that already sets `RPROMPT` needs the call added to its own line
instead, for example `RPROMPT='$(rafa_prompt_info) '"$RPROMPT"`.

### zsh without oh-my-zsh

```zsh
source ~/rafa-extras/extras/zsh/rafa-prompt/rafa-prompt.plugin.zsh
setopt prompt_subst
RPROMPT='$(rafa_prompt_info)'
```

### Styling

`RAFA_PROMPT_PREFIX` and `RAFA_PROMPT_SUFFIX` wrap the segment, the way
`ZSH_THEME_GIT_PROMPT_PREFIX` wraps git's. Set them before the prompt is
drawn:

```zsh
RAFA_PROMPT_PREFIX='%F{242}[%f'
RAFA_PROMPT_SUFFIX='%F{242}]%f'
```

## In Warp

Warp draws your own prompt only with Settings › Appearance › Input ›
Classic › Current prompt › Shell Prompt (PS1). With Warp's own prompt,
the chips row cannot hold this segment: Warp's code has a custom chip
kind, but it is not built yet and draws nothing. Whether Warp shows
`RPROMPT` has not been checked; if it does not, add the call to
`PROMPT` instead.
