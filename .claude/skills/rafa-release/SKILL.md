---
name: rafa-release
description: "Use when a rafa release tag, settle or publish step is refused, ends on a Next line, or is handed over."
when_to_use: "A rafa release command printed a Next step or a skill: rafa-release line, or a release step is to be run or handed to someone. Read the case file the line names."
tags:
  - rafa
  - release
stack:
  - agnostic
---

# Release steps

This skill holds the case files for the steps `rafa release tag`, `rafa
release settle` and `rafa release publish` print. Each refusal and each
ending names the step that clears it. Read it when a line names a case file,
or when a release step is to be run or handed to someone else.

## The skill line

Under `hints.skills: true` in the project's config, a step that has a case
is followed by one indented line naming its file:

```text
Next:
  cd <checkout> && rafa release tag — integration is checked out there
    skill: rafa-release › tag-branch
```

`tag-branch` is the file `tag-branch.md` in this skill. With the switch off,
the step lines stand alone and no skill line prints. JSON mode gives each
step a `skill` field, which is null when the switch is off or the step has
no case.

## The flow

A release runs four steps in this order. Each one reads what the step before
left behind.

1. **settle** folds the fragments waiting on the base branch into one
   version and one changelog section per unit, and commits them as one
   `chore: release <version>` commit. It is the only step that writes a
   version.
2. **tag** puts a tag on that commit: `v<version>` for the root package,
   `<name>@<version>` for each publishable workspace package. It refuses a
   unit that is not ready, and says why.
3. **publish** runs `release.publishCommand`, `npm publish` by default, for
   each unit whose tag points at HEAD, in that unit's folder.
4. **self-update** replaces the global `rafa` install. It has no unit and no
   tag. It comes last, since a live loop runs the installed copy. From
   0.31.0 it refuses while a loop of the project is live.

The order is forced by what each step reads. Tag reads the version and the
changelog section settle wrote, and refuses without them. Publish reads the
tag on HEAD, and refuses when there is none.

Who runs each step:

- settle runs as a person's command, as a CI job after each merge, from a
  post-merge hook, or through `rafa next`, which settles after its merge
  step. The loop never writes a version: it writes one fragment per pull
  request.
- tag and publish are typed at the checkout. In this repository the user
  runs them, and an agent hands the line over.
- self-update is typed on the machine that holds the global install.

The keys `release.settle`, `release.tag` and `release.publish` set which of
these run without a person. At level 0 none of them does.

## Where a line runs

Each line is placed where it runs. The `cd <checkout> &&` prefix appears
only when the checkout that must run the command is not the top of the
directory the command ran in. A step that moves onto the release branch is a
`cd` into the checkout that holds the branch, read from `git worktree list`.
When no checkout holds it, the step is `git switch <branch>`, then the
command. A checkout whose path is gone falls back to the `git switch` line.
When git does not answer the top-level read, the prefix stays.

On 2026-11-08 a release that should have taken two steps took five or six.
Settle ended without a next step, a suggested line named no checkout, and
the know-how sat in one long skill. A tag run from a session worktree on a
detached HEAD was refused with `a release is tagged on main` and nothing
more, while the release branch was checked out in the main checkout, where
the fix was a `cd`. Each refusal and ending now names its step, placed where
it runs, and the case file says what the step clears.

A stretch on another device gets a line an agent hands over, with the `ssh
-t` segment in front. Without that segment the line runs on the machine the
reader types it on:

```text
ssh -t <host> "cd <checkout> && rafa release tag"
```

`<host>` is that device's ssh name and `<checkout>` is its checkout. The
remote shell has to find `rafa` on its PATH, and a bare non-login command
may not.

## Index of the case files

| File | Key | Printed by | Read it when |
|---|---|---|---|
| `tag-branch` | `branch` | `rafa release tag` | the release branch is not checked out here |
| `tag-behind` | `behind` | `rafa release tag` | the release branch is behind its upstream |
| `tag-version` | `version` | `rafa release tag` | the version file is unreadable or has no version |
| `tag-tagged` | `tagged` | `rafa release tag` | a tag already names the version |
| `tag-changelog` | `changelog` | `rafa release tag` | the newest changelog section names another version |
| `tag-git` | `git` | `rafa release tag` | a git read the decision needs did not run |
| `tag-receipt` | `receipt` | `rafa release tag` | the version's section has no receipt |
| `settle-push` | `push` | `rafa release settle` | the release commit reached the base |
| `settle-pr` | `pr` | `rafa release settle` | a release pull request was opened or updated |
| `settle-nothing` | `nothing` | `rafa release settle` | no fragment ships a release |

Some steps have no case file, so they print no skill line: the publish
refusal for no release tag, the publish line, the follow-ups of a run that
tagged, and the next step of a settle dry run. `publish.md` covers the
publish step, and `settle.md` covers the settle endings.

`tag.md`, `settle.md` and `publish.md` hold each command in full. A step's
text is `<command> — <why>`. A step that is an instruction, such as `set
pr.base in rafa.config.ts`, is printed as it is, with no `cd` in front of
prose.
