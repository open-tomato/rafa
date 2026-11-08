/**
 * How far the release branch `rafa release tag` stands on is behind the
 * ref it tracks: the reading behind the `behind` refusal (`./tag.ts`,
 * "A branch behind the release settle pushed"). It reads the
 * remote-tracking ref this clone already holds, which settle's push
 * updated, so no network is reached.
 */
import type { GitRunner } from '@open-tomato/rafa/core/git';

/** How far the checked-out branch is behind the ref it tracks, read with no network. */
export interface BehindReading {
  /** The ref the branch tracks, as git spells it, e.g. `origin/main`. */
  readonly upstream: string;
  /** The commits {@link upstream} holds that HEAD does not. */
  readonly commits: number;
}

/**
 * How far the checked-out branch is behind its upstream, read off the
 * remote-tracking ref this clone already holds, so no network is
 * reached; null when the branch tracks nothing or git did not answer.
 */
export function readBehind(git: GitRunner): BehindReading | null {
  const named = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  const upstream = named.stdout.trim();
  if (!named.ok || upstream === '') return null;
  const counted = git(['rev-list', '--count', 'HEAD..@{upstream}']);
  if (!counted.ok) return null;
  const commits = Number.parseInt(counted.stdout.trim(), 10);
  return Number.isNaN(commits)
    ? null
    : { upstream, commits };
}

/** `count` commits, singular or plural. */
export function commitsOf(count: number): string {
  return count === 1
    ? '1 commit'
    : `${String(count)} commits`;
}

