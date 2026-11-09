# rafa release tag

`rafa release tag` puts one tag on the release commit of each unit, after
every unit has been decided. `rafa release tag --push` also pushes the tags
once they are written.

## What it writes

Each unit gets one tag: `v<version>` for the root package, and
`<name>@<version>` for each publishable workspace package. The tag goes on
the commit of the release branch that set the unit's version. That is HEAD
unless merges landed after it.

Every unit is decided before the first tag is written. A run that refuses
leaves the repository as it found it. The only write is the git tag itself,
and the pushes that `--push` asks for come after it.

## What it does not write

It does not write a version or a changelog section. Those are the commit
that `rafa release settle` makes. Tag puts a tag on a commit settle already
wrote, and it refuses when the version, the changelog or the receipt do not
agree.

## The refusals

A unit is refused for one of these reasons. Each has its own case file.

- `branch`: the release branch is not checked out here, or none is. See
  `tag-branch`.
- `behind`: the release branch is behind its upstream. See `tag-behind`.
- `version`: the version file is unreadable or declares no version. See
  `tag-version`.
- `git`: a git read the decision needs did not run. See `tag-git`.
- `tagged`: a tag of the unit already names the version. See `tag-tagged`.
- `changelog`: the newest changelog section names another version, or none.
  See `tag-changelog`.
- `receipt`: the version's section has no receipt. See `tag-receipt`.

Any refused unit stops the run with exit 1, before anything is written. A
unit whose version a tag already names is skipped, not refused, so a run
after a hand-tagged root still tags the package. A package never released,
at 0.0.0 with no changelog and no tag of its own, is skipped too. The run
refuses with `tagged` only when every unit is skipped.

## After the tags are written

The run prints the push line, `git push <remote> <tag>`, since the tag stays
local until the remote has it. It prints a publish line too, the
`release.publishCommand` a unit publishes with. A package's publish line
runs in its own folder, as `(cd <dir> && npm publish)`.

Under `release.publish: ci` the publish line is replaced by one sentence. A
pushed tag starts the release publish workflow, which publishes the unit
once the repository variable `RAFA_RELEASE_PUBLISH` is `ci`. A local publish
of that unit would publish the same version twice, so `publish.md` says when
to leave it alone.

## Across machines

A tag written on another device is handed over in the remote form, with that
device's ssh name in place of `<host>`. SKILL.md's "Where a line runs"
section gives the form.
