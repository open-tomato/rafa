---
name: rafa-stretch-gap-log
description: "Use when a stretch step needs raw gh, git or shell because no rafa line does it: file a module:cli-gap bug or a debt report."
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

When none matches, ask the breaking question, worded the same in every
filing place: does the missing line make something break, beyond a step
done by hand? Breaking means a command prints or does something wrong,
two refusals leave no way through, or a hand-over names the wrong line.

On a yes, file a bug:

```bash
rafa issue create --type=bug --module=cli-gap --action="<the rafa action that came closest, or unknown>" --summary="<the step rafa cannot do yet>" --cause=cli:new-context --reproduce="<the raw line>" --body="<the rafa line that came closest, what it lacks>"
```

On a no, file a debt report, which is a bug record under another type with
the same fields and title:

```bash
rafa issue create --type=debt --module=cli-gap --action="<the rafa action that came closest, or unknown>" --summary="<the step rafa cannot do yet>" --cause=cli:new-context --reproduce="<the raw line>" --body="<the rafa line that came closest, what it lacks>"
```

A bug or a debt report is filed from its fields, and rafa renders its title
from them. A line that leaves one of the four out is refused, naming it.
The action is lower-case, without the word `rafa`: `pr open`, `loop start`.
A debt report that later breaks something moves to a bug with
`rafa issue edit <n> --type=bug`, which keeps its record.

When one matches, add the stretch's case to it:

```bash
rafa issue comment <n> --body="Seen again in stretch <n>: <the raw line>."
```

When the config sets `collaborate.rafa` (a project that reports to rafa's
own board), the gap is filed on that board, not this one. Search and file
with `--upstream=rafa`, and comment the same way:

```bash
rafa issue list --upstream=rafa --module=cli-gap --search="<the step in a few words>"
rafa issue create --upstream=rafa --type=bug --module=cli-gap --action="<the rafa action that came closest, or unknown>" --summary="<the step rafa cannot do yet>" --cause=cli:new-context --reproduce="<the raw line>" --body="<the rafa line that came closest, what it lacks>"
rafa issue create --upstream=rafa --type=debt --module=cli-gap --action="<the rafa action that came closest, or unknown>" --summary="<the step rafa cannot do yet>" --cause=cli:new-context --reproduce="<the raw line>" --body="<the rafa line that came closest, what it lacks>"
rafa issue comment <n> --upstream=rafa --body="Seen again in stretch <n>: <the raw line>."
```

Only a bug or a debt report is filed upstream: `--type=bug` and
`--type=debt` are the only types it takes, and the breaking question
above picks between them. The upstream check refuses a run when the
config does not set `collaborate.rafa`, or when this board's owner differs
from the upstream's, and a refused line files nothing. A private sibling is
named "a private sibling repository" in the title and the body, never by
its name.

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
