---
plan: stretch-operator-copies
title: Run each stretch on its own operator copy, and lock the stretch 2 kickoff
level: patch
---

- Stretch: each stretch runs on its own copy of the operators, made once under `.rafa/stretch/<n>/operators/` and loaded with `claude --plugin-dir` as the `rafa-operators` plugin, so nothing is linked into `~/.claude` and a pull or self-update never changes a running stretch. The launcher's `link` command is gone.
- Stretch: the tmux session is `stretch-<project>-<n>`, reached by its exact name, and Claude sessions are named `<project> stretch <n> <role>`, so two projects' stretches on one machine never share one.
- Stretch: the engineer writes the next stretch's opening message to `.rafa/stretch/engineer-prompt.md` at the wrap-up, halts before a `rafa self-update` while another project's stretch runs, and no longer runs `rafa usage` or stops on usage.
