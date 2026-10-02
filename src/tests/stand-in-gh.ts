/**
 * The PATH and `gh` a spawned case builds for itself, shared beside
 * `cli-capture.ts`: a directory holding only a link to `git`, so a PATH
 * never needs the directory git lives in (where a real `gh` may live
 * too), and a stand-in `gh` that answers `auth status` alone.
 */
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

/** What the stand-in `gh` answers to `gh auth status`. */
export type GhSession = 'signed-in' | 'signed-out';

/** Answers the git binary this suite runs, or throws when none is on the PATH. */
function gitBinary(): string {
  const found = Bun.which('git');
  if (found === null) throw new Error('git is not on the PATH this suite runs under');
  return found;
}

/** The directory the host's `git` lives in, which may hold a real `gh` too. */
export function hostGitDir(): string {
  return dirname(gitBinary());
}

/**
 * Makes `<root>/git-only/` holding a link to `git` and nothing else, and
 * answers its path: the one directory a scratch PATH takes for git.
 */
export function plantGitOnlyDir(root: string): string {
  const dir = join(root, 'git-only');
  mkdirSync(dir, { recursive: true });
  symlinkSync(gitBinary(), join(dir, 'git'));
  return dir;
}

/** The PATH of `dirs` alone, in order. */
export function builtPath(...dirs: readonly string[]): string {
  return dirs.join(delimiter);
}

/**
 * Writes a stand-in `gh` into `bin` that answers `auth status` as
 * `session` says, and exits 1 on any other word. Answers its path.
 */
export function plantStandInGh(bin: string, session: GhSession): string {
  const gh = join(bin, 'gh');
  const authenticated = session === 'signed-in';
  writeFileSync(gh, [
    '#!/bin/sh',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then',
    authenticated
      ? '  echo "Logged in"; exit 0'
      : '  echo "You are not logged into any accounts" >&2; exit 1',
    'fi',
    'echo "stand-in gh: unsupported: $*" >&2',
    'exit 1',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
  return gh;
}
