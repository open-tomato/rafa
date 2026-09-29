# Warp

What Warp does with a CLI it has no spec for, read from Warp's docs and
its public source (`warpdotdev/warp`) on 2026-09-29, and measured on
Warp stable 0.2026.09.16 with zsh 5.9 and oh-my-zsh.

## Settings that matter to rafa

| Setting | Where | Default | What it changes |
| --- | --- | --- | --- |
| Warp completions | Settings › Features › Terminal Input | on | Warp's built-in specs answer TAB first |
| Native shell completions | Settings › Features › Terminal Input | on | When Warp's specs answer nothing, TAB asks the shell. Never while typing, only on TAB. From stable 0.2026.09.09 |
| Shell Prompt (PS1) | Settings › Appearance › Input › Classic › Current prompt | off | Draws your own zsh prompt (a theme, Starship, powerlevel10k 1.19.0 or later) in place of Warp's chips |

## What is known

- **Completion specs are built into Warp.** A CLI cannot add its own;
  that is an open request (`warpdotdev/warp#6904`, custom completion
  specs). A Fig spec from rafa would do nothing in Warp.
- **Chips are built in too.** The row with the Node version, directory
  and git branch takes no custom chip: Warp's code has the kind, but
  using it logs a warning and draws nothing.
- **The grey text after the cursor** is Warp's autosuggestion from your
  history; → accepts it. It is not TAB completion.
- **zsh descriptions reach Warp.** Warp replaces zsh's `compadd` to
  capture each option with its description (its zsh bootstrap,
  `zsh_body.sh`).

## Open: does a zsh completion reach Warp?

Measured on 2026-09-29 with both completion settings on: TAB after
`rafaprobe` offered files, not the probe's options. Two mechanisms fit:

- Warp's own completer answers files for a command it does not know, so
  the shell is never asked (the pattern of `warpdotdev/warp#16019`,
  where `npx` never reached the shell).
- The shell is asked and answers nothing inside Warp's capture (the
  pattern of `warpdotdev/warp#8869`, `compdef` completions ignored).

The check that tells them apart:

1. In Terminal.app, `source completion-probe.zsh` from this directory
   and press TAB after `rafaprobe `, `rafaprobe loop --inject=` and
   `rafaprobe loop --plan=`. Expected: `loop`/`plan`/`pr` with
   descriptions, then `full`/`stage`/`task`, then `.md` files only.
2. In Warp, turn **off** Warp completions, keep Native shell completions
   on, open a new tab, and do the same. The probe's options showing up
   means the first mechanism; files again means the second.
