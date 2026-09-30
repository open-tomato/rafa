# extras

Tricks and settings for the environment rafa runs in: shells, prompt
themes, terminal apps and, later, IDEs. Nothing here is part of rafa.

- **Tracked, never published.** `package.json` publishes `dist/` and
  `NOTICE` only, so this directory stays in the repository and never
  reaches npm.
- **No CLI action.** rafa never installs, reads or runs anything from
  here. Each entry says how to add it to your own setup by hand.
- **Not planned work.** These are experiments to revisit per terminal,
  shell and IDE. An entry that proves itself can become a spec later.

## Where to keep it

Link or source these files from a checkout that stays on `main`, never
from the checkout you work in. A working checkout moves between
branches, and one branched before an entry existed has no such file, so
a link into it breaks and the shell falls back or errors at start.

A plain clone does it:

```bash
git clone https://github.com/open-tomato/rafa.git ~/rafa-extras
```

or, next to a clone you already have, a detached worktree that shares
its objects and never holds the `main` branch itself:

```bash
git -C <your-rafa-clone> fetch origin
git -C <your-rafa-clone> worktree add --detach ~/rafa-extras origin/main
```

Update it with `git -C ~/rafa-extras pull` for the clone, or
`git -C ~/rafa-extras fetch origin && git -C ~/rafa-extras checkout
--detach origin/main` for the worktree. The examples in each entry use
`~/rafa-extras`.

## Entries

| Entry | What it gives | Tested with |
| --- | --- | --- |
| [`zsh/tomato/`](zsh/tomato/) | A two-line oh-my-zsh theme: repository, branch and diff count, rafa version, spec or roadmap with epic progress on the left; a spacer for status messages; every live loop's task counter at the top right | zsh 5.9, oh-my-zsh |
| [`zsh/rafa-prompt/`](zsh/rafa-prompt/) | A prompt segment naming the plan of the current branch and how far its run is: ready, in progress, blocked, running, done | zsh 5.9, oh-my-zsh |
| [`claude-code/`](claude-code/) | A tooling pack for Claude Code agents: a skill with the `gh`-to-rafa mappings and who runs which command, a PreToolUse hook that enforces them, and `/rafa-hookify` to install both in a project | Claude Code 2.1.283, Haiku and Sonnet |
| [`warp/`](warp/) | Warp settings that matter to rafa, and a probe for Warp's use of zsh completions | Warp stable 0.2026.09.16 |
