/**
 * The tags that name a version in this repository: `v0.4.0` for the
 * root's `0.4.0`, and `@scope/plugin@0.2.0` for a workspace package's
 * `0.2.0` ({@link packageTag}); {@link moveTag} picks one for a
 * {@link ReleaseMove} by its `package`, null for the root.
 * {@link parseReleaseTag} reads a tag back: the inverse of the two
 * spellings, so a tag `rafa release tag` wrote answers the unit and the
 * version it was written for, and any other tag answers null.
 *
 * One function per spelling, so that every place that writes or predicts
 * a version tag spells it the same way: `rafa release tag`
 * (`src/commands/release/tag.ts`) and settle's own tag step
 * (`./settle-tag.ts`) both build the tag they write from it. Two copies
 * of the template would drift with nothing to notice.
 *
 * This is a library half of `src/commands/pr/merge-followups.ts`, where
 * {@link versionTag} was first spelled while `rafa pr merge` still named
 * `rafa release tag` as a follow-up. That file keeps the follow-ups rule
 * and holds no re-export of this one; the other symbol that left it is
 * `SettleWaiting`, in `src/pr/settle-waiting.ts`. Nothing here imports
 * from `src/commands/`; the imports are the type of a move, from
 * `./release-move.ts`, and the version shape {@link parseReleaseTag}
 * holds a tag's version to, `parseSemanticVersion` from `./version.ts`.
 *
 * The reading is strict where `releaseTagsOf` (`./status-readings.ts`)
 * is lenient: that one also counts a bare `0.4.0` as a root tag, since
 * it reads a history other tools tagged, while this one answers only
 * what {@link versionTag} and {@link packageTag} write. A root tag
 * needs its `v`, a package tag splits at its LAST `@` (a scoped name
 * opens with one), and the name before it is a bare name with no slash
 * or a scoped `@scope/name` with exactly one; the version after it is a
 * semantic version with no `v`. Nothing is trimmed.
 */
import type { ReleaseMove } from './release-move.js';

import { parseSemanticVersion } from './version.js';

/** What a release tag names: the package by its manifest name, null for the root, and the version. */
export interface TaggedRelease {
  /** The workspace package's manifest name, or null for the root. */
  readonly package: string | null;
  /** The version the tag names, without a `v`. */
  readonly version: string;
}

/** True when `name` is a bare name with no slash or a scoped `@scope/name` with one slash and both halves filled. */
function isTagPackageName(name: string): boolean {
  if (name === '' || name.includes('@', 1)) return false;
  if (!name.startsWith('@')) return !name.includes('/');
  const parts = name.slice(1).split('/');
  return parts.length === 2 && parts.every((part) => part !== '');
}

/** The tag naming `version`, in this repository's spelling: `v0.4.0`. */
export function versionTag(version: string): string {
  return `v${version}`;
}

/** The tag naming a workspace package's `version`: `<name>@<version>`, e.g. `@scope/plugin@0.2.0`. */
export function packageTag(name: string, version: string): string {
  return `${name}@${version}`;
}

/** The tag naming the version `move` moves to: {@link versionTag} for the root, {@link packageTag} for a package. */
export function moveTag(move: ReleaseMove): string {
  return move.package === null
    ? versionTag(move.to)
    : packageTag(move.package, move.to);
}

/**
 * The release `tag` names, the inverse of {@link versionTag} and
 * {@link packageTag}: `v0.4.0` answers the root's `0.4.0`,
 * `@scope/plugin@0.2.0` the package `@scope/plugin` at `0.2.0`, and a
 * tag in neither shape (no version, a bare `0.4.0`, a `v` before a
 * package's version, a name with two slashes) answers null.
 */
export function parseReleaseTag(tag: string): TaggedRelease | null {
  const at = tag.lastIndexOf('@');
  if (at === -1) {
    const version = tag.slice(1);
    return tag.startsWith('v') && parseSemanticVersion(version) !== null
      ? { package: null, version }
      : null;
  }
  const name = tag.slice(0, at);
  const version = tag.slice(at + 1);
  return isTagPackageName(name) && parseSemanticVersion(version) !== null
    ? { package: name, version }
    : null;
}
