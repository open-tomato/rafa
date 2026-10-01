---
name: rafa-stretch-gap-log
description: "Use when a stretch step needs raw gh, git or shell because no rafa line does it: file it as a module:cli-gap bug."
provenance: first-party
source: rafa
stage: alpha
prevents: "the same raw command typed every stretch with nobody noticing rafa could own it"
signal: silent
when_to_use: "You are rafa-stretch-engineer and a step you just took, or are about to take, has no rafa line: a raw gh, git or shell command, or a config edit by hand. Prevents: the same raw command typed every stretch with nobody noticing rafa could own it"
tags:
  - rafa
  - stretch
  - cli
stack:
  - shell
---

Alpha: tested on rafa's own development, may become a feature.

# Gap log

A *gap* is a step rafa could own and does not yet: you had to type a raw
`gh`, `git` or shell line, or edit a config by hand, because no rafa line
does it. Each one is filed once, so the next bug sweep can turn the ones
that repeat into commands.

## Is it a gap?

- **Yes:** a step every stretch takes the same way, such as creating the
  integration branch, or opening a pull request outside a loop.
- **Yes:** a flag you add every time, which rafa could read from the
  scenario instead.
- **No:** a one-off investigation, or a `git` commit, push or rebase,
  which stay `git`'s.

## Filing one

Search first, so a gap is filed once:

```bash
rafa issue list --module=cli-gap --search="<the step in a few words>"
```

When none matches, file it:

```bash
rafa issue create --type=bug --module=cli-gap --title="<the step rafa cannot do yet>" --body="<the raw line, the rafa line that came closest, what it lacks>"
```

When one matches, add the stretch's case to it:

```bash
rafa issue comment <n> --body="Seen again in stretch <n>: <the raw line>."
```

The board is public: no local path, host name, user name or secret in the
title or the body.

## Known at design time

These are filed or waiting to be, so search before filing them again:

- grouping duplicate bugs;
- opening a pull request outside a loop;
- creating the integration branch, and switching `pr.base` to it and back;
- installing the operators;
- a per-command log under `.rafa/logs/`, for reading a failure from
  another device;
- detached loops;
- `rafa loop list` across projects.

List every gap you filed or commented on in the stretch report.
