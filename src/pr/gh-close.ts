/**
 * Closes a pull request without merging it: the one `gh pr close` the
 * `gh` provider sends for {@link PullRequests.close}.
 *
 * Split out of `./gh.ts`, which holds every other member, so that
 * adapter does not grow past the size it already is, as
 * `./gh-closing-issues.ts` was split out for its read; `./gh.ts` hands
 * its runner here. Nothing here imports `./gh.ts`, which imports this
 * module, so the two argument checks below are this module's own.
 *
 * ## The command
 *
 * `gh pr close <n> --comment=<comment>`, with `--delete-branch` after it
 * when the caller asked for the branch to go. Read off
 * `gh pr close --help` on 2.102.0, 2026-10-13:
 *
 *   - `-c, --comment string`: "Leave a closing comment".
 *   - `-d, --delete-branch`: "Delete the local and remote branch after
 *     close". LOCAL too, by those words: `gh` runs in the directory its
 *     runner was made for, so a checkout holding the head branch may
 *     lose it there as well. What `gh` does when that branch is the one
 *     checked out was not measured.
 *
 * The comment travels in the `--flag=value` form, the spelling
 * `closePullRequest` of `src/board/issue-board.ts` already sends, so a
 * comment opening with `-` is the flag's value and never read as a flag
 * of its own. No `--repo` is sent, for the reason `./gh.ts` gives.
 *
 * ## What is read
 *
 * The exit code alone. What a successful close writes was not recorded,
 * a write being the one thing `./gh-fake-shapes.ts` could not read off a
 * repository, and neither was what `gh` answers for a pull request that
 * is already closed or already merged: a caller reads the state through
 * `get` first and never sends a close for one that is not open.
 *
 * ## What is refused
 *
 * A number that is not a positive whole number, before any argument is
 * built from it, as `./gh.ts` refuses one. A comment that is not a
 * string or is blank: a pull request closed unmerged says why, and
 * `gh pr close` without a comment would close it silently. A
 * `deleteBranch` that is not a boolean, since a truthy string read as
 * "delete" would remove a branch nobody asked to lose. Each is a
 * `TypeError` raised before `gh` is run. A failed command rejects naming
 * the command and what it wrote, the comment left out of the name.
 */
import type { ClosePullRequestOptions } from './types.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describeValue } from '@open-tomato/rafa/core/config/sections';

/** What every refusal opens with: the prefix `./gh.ts` refuses with. */
const PREFIX = 'gh pull requests';

/** The switch that deletes the head branch with the close. */
export const DELETE_BRANCH_FLAG = '--delete-branch';

/** What a failed command wrote, for a rejection. Never empty. */
function detailOf(result: GhResult, command: string): string {
  const written = result.stderr.trim() || result.stdout.trim();
  return written === ''
    ? `${command} exited non-zero and wrote nothing`
    : written;
}

/** The pull request number `close` was handed, as an argument. Throws when it is not one. */
function pullNumber(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(
      `${PREFIX}: close refused pull request number ${describeValue(value)},`
        + ' expected a positive whole number',
    );
  }
  return String(value);
}

/** The closing comment `close` was handed. Throws when it is not a string, or is blank. */
function closingComment(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${PREFIX}: close refused a comment ${describeValue(value)}, expected a string that is not blank`);
  }
  return value;
}

/** Whether `close` was asked to delete the head branch. Throws when it was not told either way. */
function deleteBranchOf(options: ClosePullRequestOptions): boolean {
  const value: unknown = (options as Partial<ClosePullRequestOptions> | null | undefined)?.deleteBranch;
  if (typeof value !== 'boolean') {
    throw new TypeError(`${PREFIX}: close refused deleteBranch ${describeValue(value)}, expected true or false`);
  }
  return value;
}

/**
 * The arguments `gh` is run with to close pull request `target` with
 * `comment`: `--delete-branch` last, and only when asked for.
 */
export function closeArgs(target: string, comment: string, deleteBranch: boolean): readonly string[] {
  const args = ['pr', 'close', target, `--comment=${comment}`];
  return deleteBranch
    ? [...args, DELETE_BRANCH_FLAG]
    : args;
}

/**
 * Closes pull request `number` through `gh` without merging it, leaving
 * `comment` as its closing comment; see the module note.
 *
 * @param gh The runner the provider sends every command through.
 * @param number The pull request to close.
 * @param comment The closing comment. Never blank.
 * @param options Whether the head branch is deleted with the close.
 * @throws TypeError for an argument refused before `gh` is run.
 * @throws Error naming `gh pr close <n>` and what it wrote, when it failed.
 */
export async function closePullRequest(
  gh: GhRunner,
  number: number,
  comment: string,
  options: ClosePullRequestOptions,
): Promise<void> {
  const target = pullNumber(number);
  const text = closingComment(comment);
  const deleteBranch = deleteBranchOf(options);
  const command = deleteBranch
    ? `gh pr close ${target} ${DELETE_BRANCH_FLAG}`
    : `gh pr close ${target}`;
  const result = await gh(closeArgs(target, text, deleteBranch));
  if (!result.ok) throw new Error(`${PREFIX}: ${command} failed: ${detailOf(result, command)}`);
}
