/**
 * The tag that names a version in this repository: `v0.4.0` for `0.4.0`.
 *
 * One function, so that every place that writes or predicts a version
 * tag spells it the same way: `rafa release tag`
 * (`src/commands/release/tag.ts`) and settle's own tag step
 * (`./settle-tag.ts`) both build the tag they write from it. Two copies
 * of the template would drift with nothing to notice.
 *
 * This is a library half of `src/commands/pr/merge-followups.ts`, where
 * {@link versionTag} was first spelled while `rafa pr merge` still named
 * `rafa release tag` as a follow-up. That file keeps the follow-ups rule
 * and holds no re-export of this one; the other symbol that left it is
 * `SettleWaiting`, in `src/pr/settle-waiting.ts`. Nothing here imports
 * from `src/commands/`, or from anywhere else.
 */

/** The tag naming `version`, in this repository's spelling: `v0.4.0`. */
export function versionTag(version: string): string {
  return `v${version}`;
}
