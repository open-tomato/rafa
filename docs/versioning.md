# Versioning

How rafa's version numbers are bumped, which packages publish, and what
happens to a package too coupled to version on its own. The release
mechanics (fragments, the fold, settle and tag) are in
[context/release.md](../context/release.md); this page states the policy
they follow.

## What publishes

A workspace member publishes when its `package.json` holds no
`"private": true`. That is the whole rule: no config key names the
packages that publish, so the manifest decides. The root publishes
`@open-tomato/rafa` as it always has: its `package.json` is public and
ships `dist` and `NOTICE`, and the root bundles core and every feature
module it is built from. The build passes each publishable member to
`bun build` as an external, so the CLI never carries its code;
`context/source.md`'s "Packages under `packages/`" section names the
externals and the guard that holds them.

Every workspace member under `packages/*` is `"private": true` today, so
none publishes yet:

- `packages/rafa`, `@open-tomato/rafa-core`
- `packages/rafa-hub`, `@open-tomato/rafa-hub`
- `packages/rafa-sync-service`, `@open-tomato/rafa-sync-service`
- `packages/typescript-config`, `@open-tomato/rafa-typescript-config`
- `packages/eslint-config`, `@open-tomato/rafa-eslint-config`

A member that publishes has its own changelog, tag and publish line,
settled by `rafa release settle` beside the root's. Its `version` then
carries release meaning: a fragment that names the member moves that
member's version alone, and a package with no fragment keeps its version
through a release. A plan that changes the CLI and a plugin writes two
fragments. Until a member publishes, its `version` carries no release
meaning, and no member needs lockstep with the root.

A release is one version per unit that moved: the root's `v<version>`
and each publishable package's `<name>@<version>`. A team with several
publishable packages gets one settle and one commit, with a tag and a
publish line for each package that moved.

One version for every publishable package, the CLI's, was rejected: every
plugin fix would release the CLI, and every CLI fix would release the
plugins. Releasing a plugin by hand, outside rafa's tooling, was rejected
too: it would carry no changelog, tags or guards.

## Bump levels

A release fragment names one level: `patch`, `minor`, `major` or `none`.
`none` is written explicitly and ships nothing. When several fragments
wait for the same unit's release, the highest level wins and that unit's
version moves once: two `minor` fragments make one minor bump, not two.
The strategy is `semver-by-level`, the default of `release.strategy`
(`src/release/strategies/semver-by-level.ts`).

Below 1.0.0 the same levels follow npm's rules, as `nextVersion` applies
them:

| base    | level | next    |
| ------- | ----- | ------- |
| `0.4.0` | patch | `0.4.1` |
| `0.4.0` | minor | `0.5.0` |
| `0.4.0` | major | `1.0.0` |

So a `minor` below 1.0.0 is the step that may break, and the first
`major` is what makes 1.0.0. A `rafa update current` in a project below
1.0.0 crosses newer minors, as the README's "Bringing a project up to the
installed rafa" section describes.

## Release fragments

A branch carries its intent as a fragment, not as a version number. The
fragment is `.changes/<plan id>.md`: a front matter block with `plan`,
`title` and `level`, a `package` line naming the workspace package the
change releases (the root's fragment has none), then one `- area: summary`
line per change. The wrap-up writes it. The session does not.

`rafa release settle` folds the fragments waiting on the base branch unit
by unit: each unit with a waiting fragment gets one version and one
changelog section, and the fragments it folded are deleted. One commit
names every unit it moved, the root first. A branch never edits the
version file or the changelog by hand.

## Packages that cannot version cleanly

A package is sometimes too coupled to version on its own: a change to it
forces changes across packages that cannot be released alongside it. Such
a package drops a file named `REFACTOR_NEEDED.md` in its directory, which
says what couples it, and stays `"private": true` until that coupling is
refactored away.

The file is a marker for people. No check reads it yet, so the rule holds
only while the file is kept honest.
