/**
 * Setting a branch's upstream as a step of its own: `git branch
 * --set-upstream-to=origin/<branch> <branch>`, tried again only while
 * git says its config file is locked.
 *
 * A branch's upstream is two keys, `branch.<name>.remote` and
 * `branch.<name>.merge`, in the ONE `.git/config` the main checkout and
 * every linked worktree share. Git writes that file under
 * `.git/config.lock`. On git 2.55 and earlier a second writer that finds
 * the lock held does not wait: it is refused at once. From git 2.56 git
 * retries the lock for about a second before refusing (see the reading
 * below). Two loops that each start in a worktree of their own on an
 * existing branch write it within the same instant, so one of the two
 * can lose (issue #960). The write is therefore its own step here, apart
 * from the `git worktree add` that would otherwise carry it, and the step
 * is the one thing tried again.
 *
 * ## What is tried again, and what is not
 *
 * {@link setUpstream} runs the line up to {@link UPSTREAM_TRIES} times,
 * pausing {@link UPSTREAM_PAUSE_MS} between two tries, and only after an
 * answer {@link isConfigLockRefusal} reads as the lock being held. Any
 * other failure is answered at once: a branch the remote has not got and
 * a git directory that may not be written fail the same way however long
 * the step waits. It answers the last try's result and decides nothing
 * else: the same predicate over that result tells a step that gave up
 * from one that failed outright, and {@link upstreamRefusal} words the
 * refusal for either.
 *
 * No lock file of rafa's own stands in front of the step. Git already
 * locks the file, and a second lock would need cleaning up after a run
 * that was killed while holding it.
 *
 * The pause is a parameter and never a timer of this module's own, so a
 * test waits for nothing, and a test that holds `.git/config.lock`
 * releases it from the pause it hands in.
 *
 * ## What git said, as measured
 *
 * Measured on git 2.53.0 under Linux with `LC_ALL=C` (2026-10-12), in a
 * clone of a bare remote, on a local `feat/x` made with `--no-track`:
 *
 *  - With `.git/config.lock` created by hand and the line run in the
 *    main checkout, git exited 1 having written to its standard error
 *    `error: could not lock config file .git/config: File exists`, then
 *    `error: unable to write upstream branch configuration`, then four
 *    `hint:` lines. `git config branch.feat/x.merge` exited 1 afterwards:
 *    the refused step leaves no upstream behind.
 *  - Run in a LINKED worktree of that clone, the first line named the
 *    config file in full, `error: could not lock config file
 *    <clone>/.git/config: File exists`. So the path is not matched, only
 *    the words on either side of it.
 *  - The last `hint:` line was `git branch
 *    --set-upstream-to=origin/refs/heads/feat/x`, and that command, run
 *    with the lock gone, exited 128 with `fatal: the requested upstream
 *    branch 'origin/refs/heads/feat/x' does not exist`. So a lock
 *    refusal here leaves git's hint out and names the line that works.
 *  - With the lock deleted the line exited 0 and wrote `branch 'feat/x'
 *    set up to track 'origin/feat/x'.` to its standard output, and the
 *    two keys then read `refs/heads/feat/x` and `origin`.
 *  - With no lock file at all and two of the line started at once on two
 *    branches, 4 rounds of 40 had a loser, which wrote the same first two
 *    lines as the lock created by hand. That is the collision itself.
 *  - With the git directory made read-only, git exited 1 with `error:
 *    could not lock config file .git/config: Permission denied` and the
 *    same lines after it. No pause clears that, so the predicate reads
 *    the reason at the line's end as well as the words at its start.
 *  - A branch the remote has not got exited 128 with `fatal: the
 *    requested upstream branch 'origin/nope' does not exist`, and a local
 *    branch that does not exist with `fatal: branch 'nope' does not
 *    exist`.
 *
 * Issue #960 quotes git 2.50.1 writing the same first line from `git
 * worktree add --track`, its second line without the `error:` prefix.
 * That version was not run here. Only the first line is matched.
 *
 * Read from git 2.56.0's documentation and release notes, not run here,
 * since this machine runs git 2.53.0: 2.56.0 added the key
 * `core.configLockTimeout`, documented as "The length of time, in
 * milliseconds, to retry when trying to lock a configuration file for
 * writing. Value 0 means not to retry at all; -1 means to try
 * indefinitely. Default is 1000 (i.e., retry for 1 second). This is read
 * from the configuration that is already on disk before the lock is
 * taken." Its release notes say: "Configuration file locking has been
 * updated to retry for a short period, avoiding failures when multiple
 * processes attempt to update the configuration simultaneously."
 *
 * For this step, on git 2.56 each try that finds the lock held waits
 * about 1 s inside git before the refusal above. A lock held for good
 * therefore costs about 5 s inside git over {@link UPSTREAM_TRIES} tries,
 * plus {@link UPSTREAM_PAUSE_MS} times `UPSTREAM_TRIES - 1` (0.8 s) of
 * rafa's own pauses, before the same refusal; on git 2.55 and earlier it
 * cost the 0.8 s alone. On git 2.56 git's own retry clears the collision
 * of issue #960 in most cases, and on 2.55 and earlier rafa's retry is
 * the only one.
 *
 * The step keeps its retry unchanged, since rafa's retry is still the one
 * that covers git 2.55 and earlier, and a lock held for good is rare and
 * ends in the same refusal. Nor does it hand git a
 * `-c core.configLockTimeout=0` of its own: that would undo the retry
 * git added for the very collision this step exists for.
 *
 * The two test files of this step, `./worktree-upstream.test.ts` and
 * `./worktree-upstream-integration.test.ts`, set the key to `0` in the
 * project they plant, so their cases that hold the lock measure rafa's
 * pauses alone on every version. Without it (issue #1371), verify run
 * 40505518174 on runner image ubuntu24 20261025.353, git 2.56.0, timed
 * the two cases that hold the lock for every try out at about 5541 ms,
 * against bun's 5 s test timeout.
 */
import type { GitResult, GitRunner } from '@open-tomato/rafa-pr';

import { gitSaid } from '@open-tomato/rafa-pr';

import { REMOTE } from '@open-tomato/rafa/start/branch-decision';

/** How many times the upstream line is run before the step gives up. */
export const UPSTREAM_TRIES = 5;

/** How long the step pauses between two tries, in milliseconds. */
export const UPSTREAM_PAUSE_MS = 200;

/** A pause of `ms` milliseconds that returns once it is over, handed in by the caller. */
export type Sleep = (ms: number) => void;

/** The indent a quoted git line carries, as `./worktree.ts` indents its own. */
const INDENT = '   ';

/**
 * git's line for a config file whose lock another writer holds, whatever
 * path it names the file by; see the module note.
 */
const CONFIG_LOCK_HELD = /could not lock config file .+: File exists$/m;

/**
 * The upstream line for `branch`, `git` included and frozen: `git branch
 * --set-upstream-to=origin/<branch> <branch>`, ready to spawn or to print.
 */
export function upstreamArgv(branch: string): readonly string[] {
  return Object.freeze(['git', 'branch', `--set-upstream-to=${REMOTE}/${branch}`, branch]);
}

/**
 * Whether `result` is git refusing to write its config file because
 * another writer holds the lock: a failed command whose standard error
 * carries git's lock line ending in `File exists`. A config file that
 * could not be locked for another reason is not one, and neither is any
 * command that succeeded; see the module note.
 */
export function isConfigLockRefusal(result: GitResult): boolean {
  return !result.ok && CONFIG_LOCK_HELD.test(result.stderr);
}

/**
 * Sets the upstream of the local `branch` to `origin/<branch>` through
 * `git`, a runner made for any checkout of the repository. A try that
 * {@link isConfigLockRefusal} reads as the lock being held is followed
 * by `sleep(UPSTREAM_PAUSE_MS)` and another try, up to
 * {@link UPSTREAM_TRIES} tries in all; any other answer ends the step.
 *
 * Answers the last try's result and never throws of its own: `ok` when
 * the upstream is set, a lock refusal when every try found the lock
 * held, and otherwise the failure that ended it.
 */
export function setUpstream(git: GitRunner, branch: string, sleep: Sleep): GitResult {
  const args = upstreamArgv(branch).slice(1);
  let result = git(args);
  for (let tries = 1; tries < UPSTREAM_TRIES && isConfigLockRefusal(result); tries += 1) {
    sleep(UPSTREAM_PAUSE_MS);
    result = git(args);
  }
  return result;
}

/**
 * The refusal a failed upstream step answers, naming `branch` and ending
 * with the upstream line on a line of its own. After a lock refusal it
 * counts the tries and quotes git without its `hint:` lines, which name
 * a line that does not work (see the module note); after any other
 * failure it quotes git whole. It does not start with a blank line and
 * says nothing of a worktree: both are the caller's.
 */
export function upstreamRefusal(branch: string, result: GitResult): string {
  const locked = isConfigLockRefusal(result);
  const said = gitSaid(result)
    .split('\n')
    .filter((line) => line !== '' && !(locked && line.startsWith('hint:')));
  const first = locked
    ? `❌ Could not set the upstream of ${branch}: git's config file was still locked after ${UPSTREAM_TRIES} tries.`
    : `❌ Could not set the upstream of ${branch}.`;
  const before = locked
    ? 'Once that lock is gone, set the upstream with:'
    : 'The command that failed:';
  return [
    first,
    ...said.map((line) => `${INDENT}${line}`),
    `${INDENT}${before}`,
    `${INDENT}  ${upstreamArgv(branch).join(' ')}`,
  ].join('\n');
}
