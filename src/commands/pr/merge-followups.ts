/**
 * The two follow-ups `rafa pr merge` names once the merge and the
 * clean-up are done, and the reading that decides whether either
 * applies.
 *
 *   - `rafa self-update` applies while the project's `package.json`
 *     names rafa's own package AND its version is not installed as a
 *     runtime under the home. Both halves keep the line out of a place
 *     where the command it names would refuse: `self-update` installs
 *     the checkout it runs in, and `installRuntime` refuses a
 *     `package.json` naming anything but {@link RAFA_PACKAGE_NAME}
 *     (`this is no rafa checkout`) and refuses again, at the
 *     `runtime-exists` reason, while `~/.rafa/runtime/<version>/` is
 *     already there (`src/runtime/install.ts`). Naming it in another
 *     project, or for an installed version, would send the operator at
 *     a guaranteed refusal.
 *   - `rafa release settle` applies while fragments wait on the base
 *     branch AND folding them ships a version: the settle dry run over
 *     `origin/<base>` answered `folded`. It is always printed LAST, so
 *     it is `pr merge`'s last line: no branch owns a version number, and
 *     settling what the merges left on the base is the step that comes
 *     after them. A base holding only `level: none` fragments, none at
 *     all, or one the dry run could not fold names nothing, since
 *     settle would commit nothing there or refuse; `rafa release settle
 *     --dry-run` is the command that says why.
 *
 * Both are therefore silent on the ordinary merge that left nothing to
 * install or settle, which is what makes them worth printing at all.
 *
 * ## Settle replaces the tag line
 *
 * `pr merge` used to name `rafa release tag` for a version on the base
 * no `v<version>` tag named: the branch that stamped the version was the
 * release. No branch stamps a version any more; settle writes it on the
 * base and tags it as `release.tag` says (`src/release/settle-tag.ts`),
 * naming `rafa release tag` itself where it leaves the tag to the
 * operator. So the tag line is settle's to print, not the merge's.
 *
 * {@link versionTag} stays spelled here: `src/commands/release/tag.ts`
 * and `src/release/settle-tag.ts` both build the tag they write from it.
 *
 * ## The update waits for a live loop
 *
 * `rafa self-update` also refuses while a loop of the project is live,
 * since each loop runs from the runtime it would replace
 * (`src/commands/self-update.ts`). The update still applies then — the
 * version is still not installed — so the line is kept and its reason
 * says when: {@link FollowUpReading.liveLoopBranches} names the branch of
 * each live loop, and a non-empty list ends the reason with
 * `run it after the loop on <branch> finishes` ({@link afterLoopsPhrase}),
 * several branches joined into one `after the loops on … finish`. The
 * line reads so whatever `dangerous.selfUpdateDuringLoop` says: that key
 * lets the command through, and waiting is still what a loop needs. A
 * list that could not be read, because a record under `.rafa/runs/`
 * cannot be, is null, and the reason says so instead, since
 * `self-update` exits 2 over that same record: the line never names the
 * command bare while it cannot rule a loop out.
 *
 * ## Both name a rafa command, and this still only prints them
 *
 * A command never runs another command's step. Nothing here runs
 * either command: the follow-ups are text an operator reads, and both
 * settling and updating are the operator's call — or, for settle,
 * `rafa next`'s workflow action. {@link RAFA_PACKAGE_NAME} is imported
 * from `src/runtime/install.ts`, the module `self-update` installs
 * through, so the name this reading tests and the name that install
 * refuses over are one string.
 *
 * ## Why the reading is separate from what reads it
 *
 * The facts — the version, whether the project is a rafa checkout,
 * whether the runtime is installed, what the settle dry run folded —
 * come from a `package.json` under the project root, a directory under
 * the home, and the base branch's git tree. Keeping the RULE pure and
 * total means every combination of them is measurable from a literal,
 * where planting a repository for each would measure the planting.
 * `merge-followups.test.ts` drives all of them; `merge-cleanup.ts`
 * gathers them.
 */
import { RAFA_PACKAGE_NAME } from '../../runtime/install.js';

/** Which follow-up a line names. */
export type FollowUpId = 'self-update' | 'release-settle';

/** The command the settle follow-up names, as the operator types it. */
export const RELEASE_SETTLE_COMMAND = 'rafa release settle';

/** One follow-up: the command to run, and why it applies. */
export interface FollowUp {
  readonly id: FollowUpId;
  /** The whole command, as the operator types it. */
  readonly command: string;
  /** Why it applies, in a phrase, lower case and with no full stop. */
  readonly why: string;
}

/**
 * What the settle dry run folded on the base branch: the fragments
 * waiting there and the version they fold into.
 */
export interface SettleWaiting {
  /** The base branch the fragments wait on, e.g. `main`. */
  readonly base: string;
  /** How many fragments the fold took, `level: none` ones included. */
  readonly fragments: number;
  /** The version settle would write. */
  readonly version: string;
}

/** What {@link readFollowUps} decides from; see the module note. */
export interface FollowUpReading {
  /**
   * The version in the project's `package.json` after the pull, or null
   * when it holds no readable one.
   */
  readonly version: string | null;
  /** True when the project's `package.json` names rafa's own package. */
  readonly rafaCheckout: boolean;
  /** True when that version is already installed as a runtime under the home. */
  readonly runtimeInstalled: boolean;
  /** What the settle dry run folded on the base, or null where it folded nothing. */
  readonly settle: SettleWaiting | null;
  /**
   * The branch of each live loop of the project, oldest first, empty
   * while none runs, or null when a loop record could not be read.
   */
  readonly liveLoopBranches: readonly string[] | null;
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
 * When the update can run beside `branches`, the live loops' branches:
 * `after the loop on <branch> finishes`, or for several, each named once,
 * `after the loops on <a>, <b> and <c> finish`.
 */
export function afterLoopsPhrase(branches: readonly string[]): string {
  const named = [...new Set(branches)];
  if (named.length === 1) return `after the loop on ${named[0] ?? ''} finishes`;
  const last = named.at(-1) ?? '';
  return `after the loops on ${named.slice(0, -1).join(', ')} and ${last} finish`;
}

/** Why the update applies, and when a live loop lets it run; see the module note. */
function selfUpdateWhy(version: string, liveLoopBranches: readonly string[] | null): string {
  const why = `${version} is not installed as this machine's rafa runtime`;
  if (liveLoopBranches === null) {
    return `${why}; a loop record under .rafa/runs cannot be read, and rafa self-update refuses until it can`;
  }
  return liveLoopBranches.length === 0
    ? why
    : `${why}; run it ${afterLoopsPhrase(liveLoopBranches)}`;
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

/** Why settle applies: how many fragments wait on which base, and what they fold into. */
function settleWhy(waiting: SettleWaiting): string {
  const [count, wait, fold] = waiting.fragments === 1
    ? ['1 fragment', 'waits', 'folds']
    : [`${String(waiting.fragments)} fragments`, 'wait', 'fold'];
  return `${count} ${wait} on ${waiting.base} and ${fold} into ${waiting.version}`;
}

/**
 * The follow-ups that apply, in the order they are printed: the update
 * first, then settle, which is always last; see the module note. Empty
 * when the merge left nothing either one turns on.
 */
export function readFollowUps(reading: FollowUpReading): readonly FollowUp[] {
  const { liveLoopBranches, rafaCheckout, runtimeInstalled, settle, version } = reading;
  const followUps: FollowUp[] = [];
  if (version !== null && rafaCheckout && !runtimeInstalled) {
    followUps.push({
      id: 'self-update',
      command: 'rafa self-update',
      why: selfUpdateWhy(version, liveLoopBranches),
    });
  }
  if (settle !== null) {
    followUps.push({ id: 'release-settle', command: RELEASE_SETTLE_COMMAND, why: settleWhy(settle) });
  }
  return Object.freeze(followUps.map((followUp) => Object.freeze(followUp)));
}
