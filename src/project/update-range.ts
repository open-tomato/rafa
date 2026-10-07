/**
 * Whether `rafa update current` may bring a project from the version its
 * lock records to the installed rafa (#714).
 *
 * `current` keeps a project within `~` of its version: the same major
 * and minor, the same patch or a newer one. Below 1.0.0 it also crosses
 * newer minors, so `0.34.1` moves to `0.36.0`: rafa ships a minor per
 * stretch, and with `next` still a stub (#716) a lock would otherwise
 * fall behind on every one. A project with no lock is adopted at the
 * installed version, since every project set up before the lock existed
 * has none. From 1.0.0 on, a newer minor is `rafa update next`'s, and a
 * newer major, `0.x` to `1.0.0` included, is `rafa update latest`'s
 * (#716). An installed
 * rafa older than the lock is a downgrade, which nothing allows before
 * 1.0.0 (#715, #718). Versions order by semver precedence, so a release
 * moves a lock past its own release candidate, and a release candidate
 * installed over its release is a downgrade.
 */
import { compareVersions } from '../commands/release/status.js';
import { parseSemanticVersion } from '../release/version.js';

/** Why a move was refused. */
export type RangeRefusal = 'newer-minor' | 'newer-major' | 'older' | 'unreadable';

/** What {@link readCurrentRange} answers. */
export type CurrentRange =
  | { readonly kind: 'adopt'; readonly to: string }
  | { readonly kind: 'same'; readonly to: string }
  | { readonly kind: 'patch'; readonly from: string; readonly to: string }
  | { readonly kind: 'minor'; readonly from: string; readonly to: string }
  | { readonly kind: 'refused'; readonly reason: RangeRefusal; readonly message: string };

function refused(reason: RangeRefusal, message: string): CurrentRange {
  return { kind: 'refused', reason, message };
}

/** The move from `recorded` (null for no lock) to `installed`; see the module note. */
export function readCurrentRange(recorded: string | null, installed: string): CurrentRange {
  const to = parseSemanticVersion(installed);
  if (to === null) return refused('unreadable', `the installed rafa answers "${installed}", which is no version`);
  if (recorded === null) return { kind: 'adopt', to: installed };
  const from = parseSemanticVersion(recorded);
  if (from === null) return refused('unreadable', `the project records rafa "${recorded}", which is no version`);

  const order = compareVersions(to, from);
  if (order < 0) {
    return refused('older', `the installed rafa ${installed} is older than the project's ${recorded}, and no downgrade runs before 1.0.0`);
  }
  if (to.major !== from.major) {
    return refused('newer-major', `the installed rafa ${installed} is a newer major than the project's ${recorded}; that move is rafa update latest`);
  }
  if (to.minor !== from.minor && to.major === 0) return { kind: 'minor', from: recorded, to: installed };
  if (to.minor !== from.minor) {
    return refused('newer-minor', `the installed rafa ${installed} is a newer minor than the project's ${recorded}; that move is rafa update next`);
  }
  return order === 0
    ? { kind: 'same', to: installed }
    : { kind: 'patch', from: recorded, to: installed };
}
