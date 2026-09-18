/**
 * `project_id`: the twelve hex characters an instinct record carries to
 * say which repository it was learned in, derived from that
 * repository's `origin` remote.
 *
 * This is somebody else's algorithm, reproduced on purpose.
 * `~/.claude/skills/continuous-learning-v2/scripts/detect-project.sh`
 * files its own instincts under exactly this hash, so a record rafa
 * writes and a record that skill writes for the same repository have
 * to carry the SAME id or the two stores cannot be read together. That
 * makes the NORMALISATION matter as much as the hash: the same
 * repository is spelled `git@github.com:o/r.git`,
 * `https://github.com/O/R.git` and `https://token@github.com/o/r`
 * by three different checkouts, and all three have to land on one id.
 *
 * {@link normalizeRemote} is that script's four `sed -E` lines in
 * order — strip embedded credentials, strip the scheme, rewrite
 * `git@host:path` as `host/path`, drop a trailing `.git` and slashes —
 * followed by its lowercasing of a network URL only. A local path
 * keeps its case because a case-sensitive filesystem makes
 * `/Users/Marcos` and `/users/marcos` different directories.
 *
 * Six remotes were run through the shell function's own text and
 * `shasum -a 256` on 2026-09-18, and their normalised forms and
 * digests are pinned as literals in `project-id.test.ts`. That pinning
 * is the ONLY thing that can catch this implementation drifting from
 * the shell one: nothing else in the repository compares them, and a
 * drift produces two stores that quietly disagree rather than an
 * error.
 *
 * ## What is deliberately not reproduced
 *
 * That script has a fallback chain past the remote: it hashes the main
 * worktree root when a repository has no `origin`, and answers the
 * literal `global` outside a repository. {@link projectId} answers null
 * for both, because a path-derived id is machine-specific and a record
 * carrying one would claim a cross-machine identity it does not have.
 * `project_id` on a record is optional for exactly this reason.
 *
 * Nothing here throws. {@link gitRemoteUrl} answers null for a missing
 * remote, a directory in no repository and a machine with no git
 * alike, because the caller's next move is the same in all three: omit
 * the field.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

/** Characters of the remote's SHA-256 a `project_id` keeps. */
export const PROJECT_ID_LENGTH = 12;

/** The shape {@link projectIdFromRemote} produces: lowercase hex. */
export const PROJECT_ID_PATTERN = new RegExp(`^[0-9a-f]{${PROJECT_ID_LENGTH}}$`);

/**
 * The shell's `*@*:*` pattern: an `@` with a `:` somewhere after it,
 * which is how `detect-project.sh` recognises an `scp`-style remote.
 * A bash glob splits anywhere, so the `*` between them may itself hold
 * `@` and `:`; the test is therefore about the FIRST `@` and the LAST
 * `:` and nothing between.
 *
 * Measured, because a regex is the obvious alternative and it looks
 * different than it is: `/^[^@]*@[^:]*:/` is EQUIVALENT to this — its
 * `[^:]*:` only means "the next colon", and it constrains nothing —
 * and a mutation swapping one for the other leaves every case green.
 * The distinction this function does draw is the one the table
 * measures: `Git@GitHub.com:O/R.git` is a network remote and is
 * lowercased, while `/Users/Marcos/repos/My@Repo.git`, which has the
 * `@` and no `:` after it, is a path and keeps its case.
 */
function hasColonAfterAt(url: string): boolean {
  const at = url.indexOf('@');
  return at !== -1 && url.lastIndexOf(':') > at;
}

/**
 * `url` as continuous-learning-v2 hashes it: credentials stripped, the
 * scheme dropped, `git@host:path` rewritten `host/path`, a trailing
 * `.git` and slashes removed, and a network URL lowercased while a
 * local path keeps its case. Like `sed` without `g`, each step
 * replaces only the first match.
 */
export function normalizeRemote(url: string): string {
  const stripped = url.replace(/:\/\/[^@]+@/, '://');
  const network = !stripped.startsWith('file://')
    && (stripped.includes('://') || hasColonAfterAt(stripped));
  const trimmed = stripped.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, '')
    .replace(/^[^@/:]+@([^:/]+):/, '$1/')
    .replace(/\.git\/?$/, '')
    .replace(/\/+$/, '');

  return network
    ? trimmed.toLowerCase()
    : trimmed;
}

/**
 * The first {@link PROJECT_ID_LENGTH} hex characters of the SHA-256 of
 * {@link normalizeRemote}'s answer, or null when `url` says nothing.
 * The same id `detect-project.sh` derives for the same repository.
 */
export function projectIdFromRemote(url: string): string | null {
  const normalized = normalizeRemote(url.trim());
  if (normalized === '') return null;

  return createHash('sha256').update(normalized)
    .digest('hex')
    .slice(0, PROJECT_ID_LENGTH);
}

/**
 * `origin`'s URL for the repository holding `dir`, or null when there
 * is no origin, no repository or no git. Never throws: see the module
 * note on why all three are one answer.
 */
export function gitRemoteUrl(dir: string): string | null {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
  });
  if (result.error !== undefined || result.status !== 0) return null;

  const url = result.stdout.trim();
  return url === ''
    ? null
    : url;
}

/** What {@link projectId} reads the world through. */
export interface ProjectIdSeams {
  /** The remote probe. {@link gitRemoteUrl} when absent. */
  readonly readRemote?: (dir: string) => string | null;
}

/**
 * The `project_id` a record written for the repository holding `dir`
 * carries, or null when that repository has no `origin` — which is the
 * whole reason the field is optional.
 */
export function projectId(dir: string, seams: ProjectIdSeams = {}): string | null {
  const read = seams.readRemote ?? gitRemoteUrl;
  const url = read(dir);

  return url === null
    ? null
    : projectIdFromRemote(url);
}
