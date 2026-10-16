/**
 * The tags that name a version in this repository: `v0.4.0` for the
 * root's `0.4.0`, and `@scope/plugin@0.2.0` for a workspace package's
 * `0.2.0` ({@link packageTag}); {@link moveTag} picks one for a
 * {@link ReleaseMove} by its `package`, null for the root.
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
 * from `src/commands/`; the one import is the type of a move, from
 * `./release-move.ts`.
 */
import type { ReleaseMove } from './release-move.js';

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
