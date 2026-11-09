# rafa release publish

`rafa release publish [--tag=<tag>] [--dry-run]` runs
`release.publishCommand` for each release unit whose tag points at HEAD, in
that unit's own folder. `npm publish` is the default command. Tag prints the
publish as a line and never runs it; this is the step that does.

## The units

A unit is a release tag on HEAD, in either spelling: `v<version>` for the
root, `<name>@<version>` for a workspace package. Other tags are not
releases and are passed over.

- `--tag=<tag>` names one unit. It is refused with exit 1 when the tag is
  not a release tag, or is not on HEAD.
- With no release tag on HEAD the run refuses with exit 1. Its `Next:` step
  is `rafa release tag`. That step has no case file, so no skill line
  follows it.
- Every unit is read before anything runs. A package tag naming a package
  the workspace does not publish, a version file that cannot be read, and a
  version that differs from the tag each refuse the run with exit 1, and
  nothing is published.

## The retry rule

Before a unit publishes, the run asks its registry whether the version is
already there, with `npm view <name>@<version> version`. The registry is the
manifest's `publishConfig.registry`, or the npm registry by default.

- The version comes back on stdout: the unit is skipped, as held.
- The package is unknown or the version is absent (`E404`, or no version on
  stdout): the unit publishes.
- Any other failure stops the run with exit 1. A publish on a guess could
  ship a version twice, or not at all.

A manifest that names no package, or is `"private": true`, has nothing to
publish. It is skipped, and no `npm view` runs for it.

## Running the units

Units run in the order git lists their tags, with the root's tag first. The
publish command runs through the shell in the unit's folder, with npm's
output going to the terminal. The first command that exits other than 0
stops the run. The run exits with that command's own code, or 1 when it gave
none. The message names the tags published before it. The units after it are
not tried.

## The dry run, and CI

`--dry-run` prints each unit's command, its folder and its registry. It runs
nothing, not even `npm view`.

Under `release.publish: ci`, pushing the tag starts the release publish
workflow, and that workflow publishes the unit. Running this command for the
same unit publishes the same version twice, so leave CI's units alone. The
workflow's publish job runs only while the repository variable
`RAFA_RELEASE_PUBLISH` is `ci`.
