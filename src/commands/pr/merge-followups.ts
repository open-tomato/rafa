/**
 * The two follow-ups `rafa pr merge` names once the merge and the
 * clean-up are done, and the reading that decides whether either
 * applies.
 *
 * Both follow-ups turn on the same fact: the VERSION that is now on the
 * base branch.
 *
 *   - `rafa release tag` applies while that version carries no tag. The
 *     tag spelling is {@link versionTag}, `v<version>`, which is the
 *     spelling this repository's own tags use. A merge that changed no
 *     version lands on a version that was tagged when it was released,
 *     so nothing is named; a merge that carried a version bump lands on
 *     one nothing has tagged yet, and the line is the reminder.
 *   - `rafa self-update` applies while the project's `package.json`
 *     names rafa's own package AND the version is not installed as a
 *     runtime under the home. Both halves keep the line out of a place
 *     where the command it names would refuse: `self-update` installs
 *     the checkout it runs in, and `installRuntime` refuses a
 *     `package.json` naming anything but {@link RAFA_PACKAGE_NAME}
 *     (`this is no rafa checkout`) and refuses again, at the
 *     `runtime-exists` reason, while `~/.rafa/runtime/<version>/` is
 *     already there (`src/runtime/install.ts`). Naming it in another
 *     project, or for an installed version, would send the operator at
 *     a guaranteed refusal.
 *
 * Both are therefore silent on the ordinary merge of a change that
 * touched no version, which is what makes them worth printing at all.
 *
 * ## Both name a rafa command, and this still only prints them
 *
 * rafa-21 registered `release tag`, and {@link versionTag} is the one
 * string both this module's predicted tag and
 * `src/commands/release/tag.ts`'s written tag are built from, so the
 * printed line and the command that honours it cannot drift. The same
 * holds of the second line: {@link RAFA_PACKAGE_NAME} is imported from
 * `src/runtime/install.ts`, the module `self-update` installs through,
 * so the name this reading tests and the name that install refuses over
 * are one string. Nothing here runs either command even so: the
 * follow-ups are text an operator reads, and both tagging and updating
 * are the operator's call.
 *
 * ## Why the reading is separate from what reads it
 *
 * The four facts — the version, whether it is tagged, whether the
 * project is a rafa checkout, whether the runtime is installed — come
 * from three different places: a `package.json` under the project root,
 * `git tag --list`, and a directory under the home. Keeping the RULE
 * pure and total means every combination of them is measurable from a
 * literal, where planting a repository for each would measure the
 * planting. `merge-followups.test.ts` drives all of them.
 */
import { RAFA_PACKAGE_NAME } from '../../runtime/install.js';

/** Which follow-up a line names. */
export type FollowUpId = 'release-tag' | 'self-update';

/** One follow-up: the command to run, and why it applies. */
export interface FollowUp {
  readonly id: FollowUpId;
  /** The whole command, as the operator types it. */
  readonly command: string;
  /** Why it applies, in a phrase, lower case and with no full stop. */
  readonly why: string;
}

/** What {@link readFollowUps} decides from; see the module note. */
export interface FollowUpReading {
  /**
   * The version on the base branch after the pull, or null when the
   * project holds no readable `package.json` version.
   */
  readonly version: string | null;
  /** True when a tag already names that version. */
  readonly tagged: boolean;
  /** True when the project's `package.json` names rafa's own package. */
  readonly rafaCheckout: boolean;
  /** True when that version is already installed as a runtime under the home. */
  readonly runtimeInstalled: boolean;
}

/** What a project's `package.json` says that the follow-ups turn on. */
export interface PackageFacts {
  /** The `version`, trimmed, or null when it is absent, blank or not a string. */
  readonly version: string | null;
  /** True when `name` is rafa's own package name, trimmed. */
  readonly rafaCheckout: boolean;
}

/** What a project holding no readable `package.json` reads as. */
const NO_PACKAGE: PackageFacts = Object.freeze({ version: null, rafaCheckout: false });

/** A string with something in it, trimmed, or null. */
function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === ''
    ? null
    : trimmed;
}

/** The tag naming `version`, in this repository's spelling: `v0.4.0`. */
export function versionTag(version: string): string {
  return `v${version}`;
}

/**
 * The two facts a `package.json` carries, from its text. A text that is
 * no JSON object, and one missing either field, reads as neither fact
 * rather than throwing: a merge is already done by the time this is
 * read, and a project without a `package.json` is the ordinary case.
 */
export function readPackageFacts(text: string): PackageFacts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NO_PACKAGE;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return NO_PACKAGE;

  const fields = parsed as Record<string, unknown>;
  return {
    version: trimmedOrNull(fields['version']),
    rafaCheckout: trimmedOrNull(fields['name']) === RAFA_PACKAGE_NAME,
  };
}

/**
 * The follow-ups that apply, in the order they are printed: the tag
 * first, since it names the release, then the update that installs it.
 * Empty when the merge changed nothing either one turns on; see the
 * module note.
 */
export function readFollowUps(reading: FollowUpReading): readonly FollowUp[] {
  const { rafaCheckout, runtimeInstalled, tagged, version } = reading;
  if (version === null) return Object.freeze([]);

  const followUps: FollowUp[] = [];
  if (!tagged) {
    followUps.push({
      id: 'release-tag',
      command: 'rafa release tag',
      why: `${version} is on the base branch and no ${versionTag(version)} tag names it`,
    });
  }
  if (rafaCheckout && !runtimeInstalled) {
    followUps.push({
      id: 'self-update',
      command: 'rafa self-update',
      why: `${version} is not installed as this machine's rafa runtime`,
    });
  }
  return Object.freeze(followUps.map((followUp) => Object.freeze(followUp)));
}
