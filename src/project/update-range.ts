/**
 * Whether `rafa update current` may bring a project from the version its
 * lock records to the installed rafa (#714).
 *
 * `current` keeps a project within `~` of its version: the same major
 * and minor, the same patch or a newer one. A project with no lock is
 * adopted at the installed version, since every project set up before
 * the lock existed has none. A newer minor or major is another action's
 * (`rafa update next`, `rafa update latest`, #716), and an installed
 * rafa older than the lock is a downgrade, which nothing allows before
 * 1.0.0 (#715, #718).
 */
import { parseSemanticVersion } from '../release/version.js';

/** Why a move was refused. */
export type RangeRefusal = 'newer-minor' | 'newer-major' | 'older' | 'unreadable';

/** What {@link readCurrentRange} answers. */
export type CurrentRange =
  | { readonly kind: 'adopt'; readonly to: string }
  | { readonly kind: 'same'; readonly to: string }
  | { readonly kind: 'patch'; readonly from: string; readonly to: string }
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

  if (to.major !== from.major) {
    return to.major > from.major
      ? refused('newer-major', `the installed rafa ${installed} is a newer major than the project's ${recorded}; that move is rafa update latest`)
      : refused('older', `the installed rafa ${installed} is older than the project's ${recorded}, and no downgrade runs before 1.0.0`);
  }
  if (to.minor !== from.minor) {
    return to.minor > from.minor
      ? refused('newer-minor', `the installed rafa ${installed} is a newer minor than the project's ${recorded}; that move is rafa update next`)
      : refused('older', `the installed rafa ${installed} is older than the project's ${recorded}, and no downgrade runs before 1.0.0`);
  }
  if (to.patch < from.patch) {
    return refused('older', `the installed rafa ${installed} is older than the project's ${recorded}, and no downgrade runs before 1.0.0`);
  }
  return to.patch === from.patch
    ? { kind: 'same', to: installed }
    : { kind: 'patch', from: recorded, to: installed };
}
