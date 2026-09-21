/**
 * Running git for the `pr` subject: one runner, made for a directory,
 * answering what git said instead of throwing.
 *
 * The pull request PORT touches no git at all (`./types.ts`): switching
 * branches, pulling and deleting branches after a merge are the merge
 * command's own steps, and `./merge.ts` holds them as data. This module
 * is the other half of that split — the one place those argv are
 * actually spawned — so a caller reaching git through the `pr` subject
 * has one seam to stub and one shape to read.
 *
 * ## Why it answers rather than throws
 *
 * Every git command the clean-up runs can fail for an ordinary reason:
 * a base checked out somewhere else, a pull that is not a fast-forward,
 * a remote branch GitHub already deleted. Each of those is a REPORTED
 * step, not an exception: the merge has already happened by then and
 * the operator is owed the list of what is left
 * (`.rafa/specs/rafa-20-pr-commands.md`). So the runner answers
 * {@link GitResult} for every outcome, including a git it could not
 * spawn, and the caller decides which of them is a refusal. This is the
 * shape `GhRunner` already has (`src/adapters/tracker/github.ts`).
 *
 * ## Why it is synchronous
 *
 * The clean-up is a list of steps run one after another, each one's
 * effect the next one's precondition, so nothing here would overlap if
 * it could. `./none.ts` spawns its push with `spawnSync` for the same
 * reason, and a synchronous runner is a synchronous stub in a test.
 *
 * ## What was measured
 *
 * On bun 1.3.14 under macOS, `spawnSync` answers a failure to START the
 * process through `error` and NOT through a status: the `status` field
 * is absent and `stdout` and `stderr` are both null. Two cases, both
 * measured (2026-09-18):
 *
 *   - An executable that is not on `PATH`:
 *     `Executable not found in $PATH: "git-not-here"`.
 *   - A `cwd` that does not exist:
 *     `ENOENT: no such file or directory, posix_spawn 'git'`, which
 *     names the EXECUTABLE and not the directory that is missing.
 *
 * So both are answered as `ok` false with the message widened to name
 * the directory, and the null streams are read as empty strings rather
 * than reaching a caller as null.
 *
 * `LC_ALL=C` is set for the same reason `./none.ts` sets it: what git
 * says is read by a person out of a report and matched by tests, and a
 * localised git would write both in another language.
 */
import { spawnSync } from 'node:child_process';

import { messageOf } from '../config-sections.js';

/** What one git command answered. Never a throw; see the module note. */
export interface GitResult {
  /** True when git exited 0. */
  readonly ok: boolean;
  /** Its standard output, empty when it wrote none. */
  readonly stdout: string;
  /** Its standard error, empty when it wrote none. */
  readonly stderr: string;
}

/** Runs git with the arguments after its name, in the directory it was made for. */
export type GitRunner = (args: readonly string[]) => GitResult;

/**
 * Makes the runner that spawns `git` in `cwd`, under `LC_ALL=C`, with
 * its output read as UTF-8. It never throws; see the module note.
 */
export function createGitRunner(cwd: string): GitRunner {
  return (args) => {
    const result = spawnSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
    });
    if (result.error !== undefined) {
      return { ok: false, stdout: '', stderr: `could not run git in ${cwd}: ${messageOf(result.error)}` };
    }
    return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
}

/**
 * What git said, its standard error first, since that is where it
 * writes its refusals and its progress. Empty when it said nothing at
 * all, which a successful `git switch` does.
 */
export function gitSaid(result: GitResult): string {
  return [result.stderr, result.stdout]
    .map((stream) => stream.trim())
    .filter((stream) => stream !== '')
    .join('\n');
}
