# Versioning

How rafa's version numbers are bumped, which package publishes, and what
happens to a package too coupled to version on its own. The release
mechanics (fragments, the fold, settle and tag) are in
[context/release.md](../context/release.md); this page states the policy
they follow.

## One package publishes

Only the root publishes, as `@open-tomato/rafa`. Its `package.json` is
public and ships `dist` and `NOTICE`; the root bundles core and every
feature module it is built from.

Every workspace member under `packages/*` is `"private": true` and is
never published on its own:

- `packages/rafa`, `@open-tomato/rafa-core`
- `packages/rafa-hub`, `@open-tomato/rafa-hub`
- `packages/rafa-sync-service`, `@open-tomato/rafa-sync-service`
- `packages/typescript-config`, `@open-tomato/rafa-typescript-config`
- `packages/eslint-config`, `@open-tomato/rafa-eslint-config`

A member's `version` field carries no release meaning, so the members
need no lockstep with the root. The root's version is the release's
version, and a release is one root version however many members changed.

## Bump levels

A release fragment names one level: `patch`, `minor`, `major` or `none`.
`none` is written explicitly and ships nothing. When several fragments
wait for the same release, the highest level wins and the base moves
once: two `minor` fragments make one minor bump, not two. The strategy
is `semver-by-level`, the default of `release.strategy`
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
`title` and `level`, then one `- area: summary` line per change. The
wrap-up writes it. The session does not.

`rafa release settle` folds the fragments waiting on the base branch into
one version and one changelog section, deletes the fragments it folded,
and commits `chore: release <version>`. A branch never edits the version
file or the changelog by hand.

## Packages that cannot version cleanly

A package is sometimes too coupled to version on its own: a change to it
forces changes across packages that cannot be released alongside it. Such
a package drops a file named `REFACTOR_NEEDED.md` in its directory, which
says what couples it, and stays `"private": true` until that coupling is
refactored away.

The file is a marker for people. No check reads it yet, so the rule holds
only while the file is kept honest.
