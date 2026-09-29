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

## Entries

| Entry | What it gives | Tested with |
| --- | --- | --- |
| [`zsh/tomato/`](zsh/tomato/) | A two-line oh-my-zsh theme: repository, branch and diff count, rafa version, spec or roadmap with epic progress on the left; a spacer for status messages; the task counter at the top right | zsh 5.9, oh-my-zsh |
| [`zsh/rafa-prompt/`](zsh/rafa-prompt/) | A prompt segment naming the plan of the current branch and how far its run is: ready, in progress, blocked, running, done | zsh 5.9, oh-my-zsh |
| [`warp/`](warp/) | Warp settings that matter to rafa, and a probe for Warp's use of zsh completions | Warp stable 0.2026.09.16 |
