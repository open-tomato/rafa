---
plan: rafa-1022-bug-sweep-25
title: Bug sweep 25 — three raw `gh` and `git` steps get a rafa line
level: minor
---

- issue: `rafa issue edit <n> --priority=<urgent|high|medium|low>` sets an issue's priority and takes it out of triage in one edit, alone or beside `--title`; `--dry-run` prints the swap and writes nothing.
- pr: `rafa pr close <n> --reason=<text>` closes an open pull request without merging it, posts the reason as the closing comment, and names the issues that stay open.
- cleanup: `rafa cleanup` gains a sixth group for unmerged branches that exist only on `origin`, each showing how many of its commits have no copy on the base; rows start unticked, and the closing question counts the `origin` deletes apart from the local ones.
