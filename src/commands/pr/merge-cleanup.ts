/**
 * The half of `rafa pr merge` that runs after the provider merged: the
 * clean-up's two branch probes, its steps walked and reported, the line
 * saying what is ready, and the follow-ups read once the base is pulled.
 *
 * `./merge.ts` decides WHEN each of these runs and holds the rest of the
 * command; what the clean-up IS, as data, is `cleanUpSteps` in
 * `src/pr/merge.ts`, and which follow-ups apply is `./merge-followups.ts`'s
 * pure rule. Nothing here asks a question or reaches the provider: every
 * function reads git through the {@link GitRunner} it is handed and
 * reports through the `info` and `warn` it is handed, so each is
 * measurable with a fake runner and two arrays.
 *
 * ## After the merge, nothing is undone
 *
 * A step that fails ends the command with exit code 1 carrying that
 * step, what git said, and the whole remaining tail as commands to
 * paste (`remainingFrom`, `commandLine`). It never reverts, resets or
 * re-pushes: the pull request IS merged by then, and the clean-up is
 * housekeeping the operator can finish by hand.
 *
 * ## The remote branch, and which remote
 *
 * Whether the remote branch is still there is read AFTER the merge, by
 * `git ls-remote --heads`, because a repository with GitHub's
 * "automatically delete head branches" turned on has none left by then
 * and the delete step would fail on a merge that went perfectly.
 * Measured on git 2.50.1 (2026-09-18): `ls-remote` exits 0 and writes
 * nothing for a branch the remote does not have, so the probe is "exit
 * 0 with a line", not "exit 0". A probe that FAILED is warned about and
 * read as absent, which drops one step from a clean-up that is about to
 * fail at `git pull` anyway, since every reason the probe cannot reach
 * the remote stops the pull first.
 *
 * ## The local branch, and a checkout that never had it
 *
 * Whether this checkout holds the head branch is read the same way,
 * after the merge, by `git show-ref --verify --quiet refs/heads/<name>`.
 * A branch pushed from another clone, or from a worktree under a
 * different local name (`git push -u origin HEAD:<name>`), has none
 * here, and `git branch -D` would fail with `branch '<name>' not found`
 * and stop the remote delete and the prune behind it. So an absent
 * branch makes the local delete a SKIPPED step, reported in its place,
 * and the rest run. Measured on git 2.50.1 (2026-09-28): `show-ref
 * --quiet` exits 1 and writes nothing for a branch that is not there,
 * and exits 128 with `fatal: not a git repository` outside a
 * repository. So the probe reads "failed and said nothing" as absent,
 * and "failed and said something" as a probe that failed: that is
 * warned about and read as PRESENT, so the delete runs and reports its
 * own failure the way it did before the probe existed. The refusal for
 * a head branch checked out in another worktree is untouched: a branch
 * git holds elsewhere is present, and `readMergeRefusal` refuses it
 * before anything is merged.
 *
 * {@link REMOTE} is the one spelling of the remote here: the probe and
 * the delete step are handed the same word, where letting
 * `cleanUpSteps` fall back to its own default would leave the probe
 * naming a remote the delete might not.
 *
 * ## The follow-ups, and why they wait for the clean-up
 *
 * They are printed for a clean-up that finished, since what they turn
 * on — the version and the fragments now on the base — is only true
 * once the base has been pulled. {@link followUpsFor} gathers what
 * `readFollowUps` decides from: the version in the project's
 * `package.json`, whether that `package.json` names rafa, whether the
 * version is installed as a runtime under the home, and the settle dry
 * run (`readSettle`, `src/release/settle.ts`) over `origin/<base>`,
 * which the pull has just updated. The dry run reads git objects only
 * and runs where the release does (`release.enabled`, read as the
 * wrap-up and the guard read it); only its `folded` answer names
 * settle.
 */
import type { FollowUp, SettleWaiting } from './merge-followups.js';
import type { GitRunner, MergeStepId, PullRequestDetail } from '../../pr/index.js';
import type { MergeGuardSettings } from '../../release/guard-merge.js';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CommandExit } from '../../cli/command.js';
import { cleanUpSteps, commandLine, gitSaid, remainingFrom } from '../../pr/index.js';
import { resolveReleaseEnabled } from '../../release/enabled.js';
import { readSettle } from '../../release/settle.js';
import { RUNTIME_SUBDIR } from '../../start/runtime.js';

import { readFollowUps, readPackageFacts } from './merge-followups.js';

/** The remote the branch is probed on and deleted from; see the module note. */
export const REMOTE = 'origin';

/** The indent a listed command or a quoted git line carries. */
export const INDENT = '   ';

/** Where a line goes: the command's output, one message at a time. */
type Report = (message: string) => void;

/** One clean-up step that ran, as the result carries it. */
export interface MergeStepReport {
  readonly id: MergeStepId;
  /** What was reported as it ran. */
  readonly label: string;
  /** The whole command it ran, ready to paste. */
  readonly command: string;
  /** True when git exited 0, and for a skipped step, which spawned nothing. */
  readonly ok: boolean;
  /** True when the step was reported as skipped rather than run. */
  readonly skipped: boolean;
}

/** Which of the two branches the clean-up found to delete. */
export interface BranchesPresent {
  readonly local: boolean;
  readonly remote: boolean;
}

/** What the clean-up reads off the merged pull request. */
export type MergedPull = Pick<PullRequestDetail, 'number' | 'headRefName' | 'baseRefName'>;

/** Where the follow-ups are read: the project root, the home, and the base the fragments wait on. */
export interface FollowUpPlace {
  /** The project root, whose `package.json` names the version. */
  readonly root: string;
  /** The home, whose runtime directory says whether the version is installed. */
  readonly home: string;
  /** The merged pull request's base branch, read as `origin/<base>`. */
  readonly base: string;
  /** The release settings the settle dry run reads, `release.enabled` among them. */
  readonly release: MergeGuardSettings;
}

/** Whether the remote still holds the branch; a probe that failed is warned about. See the module note. */
export function remoteHoldsBranch(git: GitRunner, branch: string, warn: Report): boolean {
  const probe = git(['ls-remote', '--heads', REMOTE, branch]);
  if (probe.ok) return probe.stdout.trim() !== '';
  warn(`${REMOTE} could not be asked whether it still holds ${branch}, so it is left alone: ${gitSaid(probe)}`);
  return false;
}

/** Whether this checkout holds the branch; a probe that failed is warned about and read as present. See the module note. */
export function localHoldsBranch(git: GitRunner, branch: string, warn: Report): boolean {
  const probe = git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (probe.ok) return true;
  const said = gitSaid(probe);
  if (said === '') return false;
  warn(`could not read whether this checkout holds a local branch ${branch}, so its delete runs: ${said}`);
  return true;
}

/** The line saying what is ready, which each delete having run changes. */
export function readyLine(base: string, branch: string, present: BranchesPresent): string {
  const pulled = `${base} is checked out and pulled`;
  if (present.local) {
    return present.remote
      ? `${pulled}, and ${branch} is gone locally and on ${REMOTE}.`
      : `${pulled}, and ${branch} is gone locally; ${REMOTE} had already deleted it.`;
  }
  return present.remote
    ? `${pulled}, and ${branch} is gone on ${REMOTE}; there was no local branch to delete.`
    : `${pulled}; ${branch} had no local branch, and ${REMOTE} had already deleted it.`;
}

/** What git said, each line indented, and nothing at all when it said nothing. */
function quotedLines(said: string): readonly string[] {
  return said === ''
    ? []
    : said.split('\n').map((line) => `${INDENT}${line}`);
}

/** Runs the clean-up, reporting each step, and refuses at the first that failed; see the module note. */
export function runCleanUp(
  git: GitRunner,
  merged: MergedPull,
  present: BranchesPresent,
  info: Report,
): readonly MergeStepReport[] {
  const steps = cleanUpSteps({
    branch: merged.headRefName,
    base: merged.baseRefName,
    remote: REMOTE,
    localBranchPresent: present.local,
    remoteBranchPresent: present.remote,
  });
  const reports: MergeStepReport[] = [];
  for (const step of steps) {
    if (step.skip !== undefined) {
      reports.push({ id: step.id, label: step.label, command: commandLine(step), ok: true, skipped: true });
      info(`${step.label}: skipped — ${step.skip}`);
      continue;
    }
    const result = git(step.argv.slice(1));
    reports.push({ id: step.id, label: step.label, command: commandLine(step), ok: result.ok, skipped: false });
    if (result.ok) {
      info(`${step.label}: done`);
      continue;
    }
    throw new CommandExit(1, [
      `❌ ${step.label}: failed`,
      ...quotedLines(gitSaid(result)),
      `#${merged.number} is merged, and the merge is left alone. Run the rest yourself:`,
      ...remainingFrom(steps, step.id).map((left) => `${INDENT}${commandLine(left)}`),
    ].join('\n'));
  }
  return reports;
}

/**
 * Probes both branches, walks the clean-up, and reports what is ready:
 * the whole clean-up `rafa pr merge` runs after the provider merged.
 * The remote is probed before the local branch, so their warnings come
 * in that order.
 */
export function cleanUpAfterMerge(
  git: GitRunner,
  merged: MergedPull,
  report: { readonly info: Report; readonly warn: Report },
): readonly MergeStepReport[] {
  const present: BranchesPresent = {
    remote: remoteHoldsBranch(git, merged.headRefName, report.warn),
    local: localHoldsBranch(git, merged.headRefName, report.warn),
  };
  const steps = runCleanUp(git, merged, present, report.info);
  report.info(readyLine(merged.baseRefName, merged.headRefName, present));
  return steps;
}

/** The text of a file, or the empty string when it cannot be read. */
function textOf(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** What the settle dry run folded on `origin/<base>`, or null where the release is off or nothing folds. */
export function settleWaitingOn(place: FollowUpPlace, git: GitRunner): SettleWaiting | null {
  if (!resolveReleaseEnabled(place.release, place.root).enabled) return null;
  const reading = readSettle(git, `${REMOTE}/${place.base}`, place.release);
  if (reading.outcome !== 'folded') return null;
  return { base: place.base, fragments: reading.fragments.length, version: reading.version };
}

/** The follow-ups that apply once the base has been pulled; see the module note and `merge-followups.ts`. */
export function followUpsFor(place: FollowUpPlace, git: GitRunner): readonly FollowUp[] {
  const facts = readPackageFacts(textOf(join(place.root, 'package.json')));
  return readFollowUps({
    version: facts.version,
    rafaCheckout: facts.rafaCheckout,
    runtimeInstalled: facts.version !== null && existsSync(join(place.home, RUNTIME_SUBDIR, facts.version)),
    settle: settleWaitingOn(place, git),
  });
}

/** Reads the follow-ups and prints them under `Follow-ups:`, printing nothing when none applies. */
export function reportFollowUps(place: FollowUpPlace, git: GitRunner, info: Report): readonly FollowUp[] {
  const followUps = followUpsFor(place, git);
  if (followUps.length > 0) {
    info('Follow-ups:');
    for (const followUp of followUps) info(`${INDENT}${followUp.command} — ${followUp.why}`);
  }
  return followUps;
}
