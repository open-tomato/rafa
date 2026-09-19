/**
 * The two follow-ups `rafa pr merge` names once the merge and the
 * clean-up are done, and the reading that decides whether either
 * applies.
 *
 * The spec asks the command to "print what is ready, and the two
 * follow-ups when they apply: `rafa release tag` and `bun run
 * snapshot`" (`.specs/rafa-20-pr-commands.md`). "When they apply" is
 * the whole of this module, and both follow-ups turn on the same fact:
 * the VERSION that is now on the base branch.
 *
 *   - `rafa release tag` applies while that version carries no tag. The
 *     tag spelling is {@link versionTag}, `v<version>`, which is the
 *     spelling this repository's own tags use. A merge that changed no
 *     version lands on a version that was tagged when it was released,
 *     so nothing is named; a merge that carried a version bump lands on
 *     one nothing has tagged yet, and the line is the reminder.
 *   - `bun run snapshot` applies while the project declares that script
 *     AND the version is not installed as a runtime under the home. The
 *     script check keeps the line out of every repository that has no
 *     such script, and the installed check keeps it from naming a
 *     command that would refuse: `bun run snapshot` exits 1 before
 *     building anything while `~/.rafa/runtime/<version>/` is already
 *     there (`README.md`), so naming it for an installed version would
 *     send the operator at a guaranteed refusal.
 *
 * Both are therefore silent on the ordinary merge of a change that
 * touched no version, which is what makes them worth printing at all.
 *
 * ## `rafa release tag` is not a command yet
 *
 * It is rafa-21's, and the plan records that as debt this stage does
 * not own. The line is printed because the spec asks for it, and it
 * names what the operator does by hand until then. Nothing here runs
 * it: the follow-ups are text.
 *
 * ## Why the reading is separate from what reads it
 *
 * The four facts — the version, whether it is tagged, whether the
 * project declares the script, whether the runtime is installed — come
 * from three different places: a `package.json` under the project root,
 * `git tag --list`, and a directory under the home. Keeping the RULE
 * pure and total means every combination of them is measurable from a
 * literal, where planting a repository for each would measure the
 * planting. `merge-followups.test.ts` drives all of them.
 */

/** Which follow-up a line names. */
export type FollowUpId = 'release-tag' | 'snapshot';

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
  /** True when the project's `package.json` declares a `snapshot` script. */
  readonly snapshotScript: boolean;
  /** True when that version is already installed as a runtime under the home. */
  readonly runtimeInstalled: boolean;
}

/** What a project's `package.json` says that the follow-ups turn on. */
export interface PackageFacts {
  /** The `version`, trimmed, or null when it is absent, blank or not a string. */
  readonly version: string | null;
  /** True when `scripts.snapshot` is a non-blank string. */
  readonly snapshotScript: boolean;
}

/** What a project holding no readable `package.json` reads as. */
const NO_PACKAGE: PackageFacts = Object.freeze({ version: null, snapshotScript: false });

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
  const scripts = fields['scripts'];
  const snapshot = typeof scripts === 'object' && scripts !== null && !Array.isArray(scripts)
    ? (scripts as Record<string, unknown>)['snapshot']
    : undefined;
  return {
    version: trimmedOrNull(fields['version']),
    snapshotScript: trimmedOrNull(snapshot) !== null,
  };
}

/**
 * The follow-ups that apply, in the order they are printed: the tag
 * first, since it names the release, then the snapshot that installs
 * it. Empty when the merge changed nothing either one turns on; see the
 * module note.
 */
export function readFollowUps(reading: FollowUpReading): readonly FollowUp[] {
  const { runtimeInstalled, snapshotScript, tagged, version } = reading;
  if (version === null) return Object.freeze([]);

  const followUps: FollowUp[] = [];
  if (!tagged) {
    followUps.push({
      id: 'release-tag',
      command: 'rafa release tag',
      why: `${version} is on the base branch and no ${versionTag(version)} tag names it`,
    });
  }
  if (snapshotScript && !runtimeInstalled) {
    followUps.push({
      id: 'snapshot',
      command: 'bun run snapshot',
      why: `${version} is not installed as this machine's rafa runtime`,
    });
  }
  return Object.freeze(followUps.map((followUp) => Object.freeze(followUp)));
}
