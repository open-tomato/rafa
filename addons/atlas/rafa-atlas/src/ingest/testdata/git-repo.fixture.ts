/**
 * A fixture git repository for the git ingest's tests, made in a tmpdir
 * with `git init` and fixed commit times, so no test reads the project's
 * own history. Named without `.test` so bun never runs it alone.
 *
 * The first-parent walk of `main`, oldest first:
 *
 * | Commit | Committed (UTC) | Subject |
 * |---|---|---|
 * | `feat` | 2026-11-01 10:00 | `feat(atlas): add the notes` (one file, three lines) |
 * | `fix` | 2026-11-01 15:00 | `fix!: mend the notes` (one line changed, a binary file added) |
 * | `squash` | 2026-11-02 09:00 | `chore: land the atlas fixture (#7)`, tagged `v0.1.0`, annotated |
 * | `stretchA` | 2026-11-02 12:00 | `Stretch 9 (#20)` |
 * | `merge1` | 2026-11-03 10:00 | `Merge pull request #30 from fixture-owner/stretch/110` |
 * | `merge2` | 2026-11-04 10:00 | `Merge pull request #31 from fixture-owner/stretch/110` |
 * | `stretchM` | 2026-11-05 09:00 | `Stretch 116 (#40)`, tagged `v0.2.0` (lightweight) and `nightly` |
 *
 * Each merge brings one commit of the `stretch/110` branch, made two
 * hours before it on the same day; the first, `branch1`, carries the
 * lightweight tag `v9.9.9`, a release tag off the walk. No remote is
 * set, so `origin/HEAD` names nothing. Commits are made under core's
 * `gitIdentityEnv`, the global and system git config ignored.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { gitIdentityEnv } from '@open-tomato/rafa-core/tests/git-identity';

/** The commits of the fixture by role, each its sha. */
export interface GitFixture {
  readonly feat: string;
  readonly fix: string;
  readonly squash: string;
  readonly stretchA: string;
  readonly branch1: string;
  readonly merge1: string;
  readonly branch2: string;
  readonly merge2: string;
  readonly stretchM: string;
}

/** The commits per UTC day on the first-parent walk of `main`. */
export const FIXTURE_COMMITS_PER_DAY: Readonly<Record<string, number>> = {
  '2026-11-01': 2,
  '2026-11-02': 2,
  '2026-11-03': 1,
  '2026-11-04': 1,
  '2026-11-05': 1,
};

/** The pull request the squash commit names, the one `ci_facts` gives the effort fixture's plan. */
export const FIXTURE_SQUASH_PR = 7;

/** The environment every fixture git call runs under: no config but this, core's test identity, `at` as both times. */
function gitEnv(at: string): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    ...gitIdentityEnv(),
    GIT_AUTHOR_DATE: at,
    GIT_COMMITTER_DATE: at,
  };
}

/** Run git in `root` at the time `at`; answers its stdout, trimmed. Throws with stderr when git fails. */
export function gitIn(root: string, args: readonly string[], at = '2026-11-01T00:00:00Z'): string {
  const spawned = Bun.spawnSync(['git', ...args], { cwd: root, env: gitEnv(at), stdout: 'pipe', stderr: 'pipe' });
  if (spawned.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${spawned.stderr.toString()}`);
  return spawned.stdout.toString().trim();
}

/**
 * Write `text` to `name` under `root`, stage it and the `also` files, and
 * commit `subject` at `at`; answers the sha. Only the named files are
 * staged, so a store written under the same root stays out of the history.
 */
function commit(root: string, name: string, text: string, subject: string, at: string, also: readonly string[] = []): string {
  writeFileSync(join(root, name), text);
  gitIn(root, ['add', '--', name, ...also], at);
  gitIn(root, ['commit', '--quiet', '-m', subject], at);
  return gitIn(root, ['rev-parse', 'HEAD']);
}

/** Commit one file on `stretch/110` at `branchAt`, then merge it into `main` with `--no-ff` as `subject` at `mergeAt`. */
function mergeStretch(root: string, file: string, subject: string, branchAt: string, mergeAt: string): readonly [string, string] {
  gitIn(root, ['checkout', '--quiet', 'stretch/110']);
  gitIn(root, ['merge', '--quiet', '--ff-only', 'main']);
  const branch = commit(root, file, 'one item\n', `item ${file} on the branch`, branchAt);
  gitIn(root, ['checkout', '--quiet', 'main']);
  gitIn(root, ['merge', '--quiet', '--no-ff', '-m', subject, 'stretch/110'], mergeAt);
  return [branch, gitIn(root, ['rev-parse', 'HEAD'])];
}

/** Make the fixture repository in `root` (created when absent); see the module note. */
export function writeGitFixture(root: string): GitFixture {
  mkdirSync(root, { recursive: true });
  gitIn(root, ['init', '--quiet', '-b', 'main']);
  const feat = commit(root, 'notes.txt', 'one\ntwo\nthree\n', 'feat(atlas): add the notes', '2026-11-01T10:00:00Z');
  writeFileSync(join(root, 'logo.bin'), new Uint8Array([0, 1, 2, 0, 255]));
  const fix = commit(root, 'notes.txt', 'one\nTWO\nthree\n', 'fix!: mend the notes', '2026-11-01T15:00:00Z', ['logo.bin']);
  const squash = commit(root, 'tidy.txt', 'tidy\n', `chore: land the atlas fixture (#${String(FIXTURE_SQUASH_PR)})`, '2026-11-02T09:00:00Z');
  gitIn(root, ['tag', '-a', 'v0.1.0', '-m', 'the first release', squash], '2026-11-02T09:30:00Z');
  const stretchA = commit(root, 'lane-a.txt', 'a\n', 'Stretch 9 (#20)', '2026-11-02T12:00:00Z');
  gitIn(root, ['branch', 'stretch/110']);
  const first = 'Merge pull request #30 from fixture-owner/stretch/110';
  const [branch1, merge1] = mergeStretch(root, 'first.txt', first, '2026-11-03T08:00:00Z', '2026-11-03T10:00:00Z');
  gitIn(root, ['tag', 'v9.9.9', branch1]);
  const second = 'Merge pull request #31 from fixture-owner/stretch/110';
  const [branch2, merge2] = mergeStretch(root, 'second.txt', second, '2026-11-04T08:00:00Z', '2026-11-04T10:00:00Z');
  const stretchM = commit(root, 'lane-m.txt', 'm\n', 'Stretch 116 (#40)', '2026-11-05T09:00:00Z');
  gitIn(root, ['tag', 'v0.2.0', stretchM]);
  gitIn(root, ['tag', 'nightly', stretchM]);
  return { feat, fix, squash, stretchA, branch1, merge1, branch2, merge2, stretchM };
}
