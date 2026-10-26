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
 * shape `GhRunner` already has (`packages/rafa-board/src/adapters/tracker/github.ts`).
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
 *
 * ## What the working tree reader keeps verbatim
 *
 * A {@link WorkingTreeStatus} entry, and a tracked one, is the porcelain
 * line as git wrote it, quoting included: `git status --porcelain`
 * answered `A  "src/a b.ts"` for a staged path with a space on git
 * 2.50.1 (Apple Git-155). A refusal that prints those lines prints what
 * `git status` would say. An untracked entry is also kept as a PATH with
 * git's quoting undone ({@link unquoteGitPath}), because it is compared
 * with the paths `git ls-tree` prints, which quotes differently. Both
 * readers moved here from `src/pr/merge.ts`, which still holds the merge
 * refusal that reads them.
 */
import { spawnSync } from 'node:child_process';

import { messageOf } from '../config/config-sections.js';

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

/** A checkout's working tree, as `git status --porcelain` reported it. */
export interface WorkingTreeStatus {
  /** True when git reported nothing at all. */
  readonly clean: boolean;
  /** Every porcelain line, as git wrote it; see the module note. */
  readonly entries: readonly string[];
  /** The porcelain lines naming a tracked path, as git wrote them. */
  readonly tracked: readonly string[];
  /**
   * The untracked paths, unquoted ({@link unquoteGitPath}). A directory
   * git folded into one line keeps its trailing `/`.
   */
  readonly untracked: readonly string[];
}

/** How `git status --porcelain` opens an untracked line. */
const UNTRACKED_PREFIX = '?? ';

/**
 * Parses `git status --porcelain` into a status.
 *
 * Every non-blank line lands in {@link WorkingTreeStatus.entries}, and
 * each one in exactly one of the two halves: a `?? ` line is untracked
 * and its path is unquoted, every other line is tracked and kept as git
 * wrote it; see the module note. Which half refuses a merge is
 * `readMergeRefusal`'s, in `src/pr/merge.ts`.
 */
export function parseWorkingTree(stdout: string): WorkingTreeStatus {
  const entries = stdout.split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() !== '');
  const tracked = entries.filter((line) => !line.startsWith(UNTRACKED_PREFIX));
  const untracked = entries.filter((line) => line.startsWith(UNTRACKED_PREFIX))
    .map((line) => unquoteGitPath(line.slice(UNTRACKED_PREFIX.length)));
  return {
    clean: entries.length === 0,
    entries: Object.freeze(entries),
    tracked: Object.freeze(tracked),
    untracked: Object.freeze(untracked),
  };
}

/** The one-letter escapes git's path quoting writes, and the byte each stands for. */
const C_ESCAPES: Readonly<Record<string, number>> = {
  'a': 0x07, 'b': 0x08, 'f': 0x0c, 'n': 0x0a, 'r': 0x0d, 't': 0x09, 'v': 0x0b,
  '\\': 0x5c, '"': 0x22,
};

/** An octal escape: three digits after the backslash, one byte. */
const OCTAL_ESCAPE = /^[0-7]{3}$/;

/**
 * A path as git printed it, with git's quoting undone. git wraps a path
 * in double quotes when it holds a character it will not print bare —
 * `git status --porcelain` for a space, `git ls-tree` for a non-ASCII
 * byte, which it writes as octal escapes under `core.quotePath` — and
 * leaves every other path as it is. Measured on git 2.53.0: an
 * untracked `a b.txt` read `?? "a b.txt"` in porcelain and `a b.txt` in
 * `ls-tree -r --name-only`, and `é.txt` read `"\303\251.txt"` in both.
 */
export function unquoteGitPath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let at = 0; at < body.length; at += 1) {
    const char = body.charAt(at);
    if (char !== '\\') {
      bytes.push(...encoder.encode(char));
      continue;
    }
    const octal = body.slice(at + 1, at + 4);
    if (OCTAL_ESCAPE.test(octal)) {
      bytes.push(Number.parseInt(octal, 8));
      at += 3;
      continue;
    }
    const escaped = C_ESCAPES[body.charAt(at + 1)];
    if (escaped === undefined) {
      bytes.push(...encoder.encode(char));
      continue;
    }
    bytes.push(escaped);
    at += 1;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
