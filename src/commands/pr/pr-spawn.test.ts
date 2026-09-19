/**
 * A spawned smoke test proving that the four `pr` reading actions —
 * `current`, `show`, `view` and `list` — resolve their provider to a
 * `gh` on the PATH, the one thing none of `current.test.ts`,
 * `show.test.ts`, `view.test.ts` and `list.test.ts` can prove: every
 * case there dispatches over a `PullRequests` built directly
 * (`gh-fake.ts` or a stub), never through `openPrContext`'s own
 * `ghPullRequestsIn`, which is the path `src/pr/gh.ts` spawns the real
 * CLI from. This file runs `bun src/rafa.ts pr <action>` over the
 * REGISTERED commands (`src/commands/index.ts`), in a scratch git
 * repository whose PATH holds a stand-in `gh` first, exactly as
 * `issue/create.test.ts`'s own spawned case does for `gh` on the
 * `issue` subject.
 *
 * ## Why the repository carries a commit and a named branch
 *
 * `pr current` names no `<n>` at all: it resolves the open pull request
 * of the branch checked out AT THE PROJECT ROOT (`pr-context.ts`), and
 * a repository with no commit refuses that read before any `gh` runs
 * (measured there, and in the module note of `pr-context.ts`). So
 * {@link plantBranch} commits once, empty, and checks out
 * {@link BRANCH} — the one git write this file makes, and the only
 * reason a commit is here at all. `pr show 7`, `pr view 7` and `pr
 * list` take an explicit number or none, so none of the three needs
 * the branch to resolve anything, and the commit is not spent on them.
 *
 * ## The stand-in, and what its log proves
 *
 * {@link plantStandInGh} logs the whole of `$*` to `ghLog`, one call
 * per line, and answers the six shapes the four actions send: `pr list
 * --head <branch>` (the branch lookup `current` makes), `pr checks
 * <n>`, `pr view <n> --json ...` (the detail `show` reads), `pr view
 * <n> --web` (the browser `view` opens), `gh api
 * repos/.../issues/<n>/comments` (the triage `show` reads) and `pr
 * list --state open --limit 30` (`list`, answered with no rows, so it
 * sends no per-row probe at all). Any other call exits 1 naming what it
 * was asked, so a shape this file did not plan for reddens loud rather
 * than quietly answering something that happens to parse — the same
 * rule `src/pr/gh.ts`'s own module note holds for the adapter's own
 * refusals.
 *
 * Each action's output is held in full and checked against what
 * `current.test.ts`, `show.test.ts`, `view.test.ts` and `list.test.ts`
 * already prove those renderers produce for an equivalent reading, so
 * this file is not a second copy of their rules — it is the proof that
 * the registered commands reach `gh.ts`'s reader over a REAL spawn
 * rather than over the in-process fakes those files use. The call log,
 * read back once every action has run, is what proves it was the
 * STAND-IN that answered: a real `gh` is never on this PATH at all
 * (`plantScratchRepo`'s own PATH holds only its `bin/` and git's own
 * directory), so the log filling in with exactly the lines this file
 * expects is the only way these four actions could have exited 0.
 */
import type { ScratchRepo } from '../../tests/cli-capture.js';

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { plantProjectConfig, plantScratchRepo, runRafa } from '../../tests/cli-capture.js';

import { SEPARATOR } from './current.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-spawn-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long the spawned case may run. */
const SPAWN_TIMEOUT = 30_000;

/** A config naming `gh` outright, so no origin remote needs to exist for the provider to resolve. */
const GH_CONFIG = 'pr:\n  provider: gh\n';

/** The branch `pr current` resolves its pull request from. */
const BRANCH = 'pr-smoke';

/** The fields `gh pr list` and `gh pr view` are asked for; copied from `src/pr/gh.ts`'s own. */
const SUMMARY_FIELDS = 'author,baseRefName,headRefName,isCrossRepository,number,state,title,updatedAt,url';
const DETAIL_FIELDS = `${SUMMARY_FIELDS},body,headRefOid,labels,mergeStateStatus,mergeable`;
const CHECK_FIELDS = 'name,state,link';

/** What the stand-in answers `gh pr list --head` and `gh pr view 7` with. */
const SUMMARY_JSON = JSON.stringify([{
  number: 1,
  title: 'Stand-in current',
  url: 'https://github.com/o/r/pull/1',
  state: 'OPEN',
  headRefName: BRANCH,
  baseRefName: 'main',
  author: { login: 'octocat', is_bot: false },
  isCrossRepository: false,
  updatedAt: '2026-09-18T00:00:00Z',
}]);
const DETAIL_JSON = JSON.stringify({
  number: 7,
  title: 'Stand-in show',
  url: 'https://github.com/o/r/pull/7',
  state: 'OPEN',
  headRefName: BRANCH,
  baseRefName: 'main',
  author: { login: 'octocat', is_bot: false },
  isCrossRepository: false,
  updatedAt: '2026-09-18T00:00:00Z',
  body: 'Stand-in body.',
  headRefOid: 'deadbeef',
  labels: [],
  mergeStateStatus: 'CLEAN',
  mergeable: 'MERGEABLE',
});
const CHECKS_JSON = JSON.stringify([{ name: 'build', state: 'SUCCESS', link: 'https://example.invalid/run/1' }]);

/** The environment every git run here uses: `scratch`'s own HOME, global and system config off. */
function gitEnv(scratch: ScratchRepo): Readonly<Record<string, string | undefined>> {
  return {
    ...process.env,
    HOME: scratch.home,
    GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
}

/** Commits once, empty, then checks out {@link BRANCH}; see the module note. */
function plantBranch(scratch: ScratchRepo): void {
  const env = gitEnv(scratch);
  const run = (args: readonly string[]): void => {
    const result = spawnSync('git', [...args], { cwd: scratch.repo, encoding: 'utf8', env });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  };
  run(['-c', 'user.name=rafa', '-c', 'user.email=rafa@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'seed']);
  run(['checkout', '-q', '-b', BRANCH]);
}

/** Writes the stand-in `gh` into `scratch.bin`, logging every call to `ghLog`; see the module note. */
function plantStandInGh(scratch: ScratchRepo, ghLog: string): void {
  const gh = join(scratch.bin, 'gh');
  const script = [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> '${ghLog}'`,
    'case "$1 $2" in',
    '  "pr list")',
    '    case "$*" in',
    `      *--head*) printf '%s' '${SUMMARY_JSON}' ;;`,
    '      *) printf \'[]\' ;;',
    '    esac',
    '    ;;',
    '  "pr checks")',
    `    printf '%s' '${CHECKS_JSON}'`,
    '    ;;',
    '  "pr view")',
    '    case "$*" in',
    '      *--web*) : ;;',
    `      *) printf '%s' '${DETAIL_JSON}' ;;`,
    '    esac',
    '    ;;',
    '  "api "*)',
    '    printf \'[]\'',
    '    ;;',
    '  *)',
    '    echo "rafa-pr-spawn-test: stand-in gh got an unplanned call: $*" >&2',
    '    exit 1',
    '    ;;',
    'esac',
    '',
  ].join('\n');
  writeFileSync(gh, script, 'utf8');
  chmodSync(gh, 0o755);
}

/** Every call the four actions send, in the order they run in, as the stand-in logs it. */
const EXPECTED_LOG = [
  `pr list --state open --head ${BRANCH} --limit 1 --json ${SUMMARY_FIELDS}`,
  `pr checks 1 --json ${CHECK_FIELDS}`,
  `pr view 7 --json ${DETAIL_FIELDS}`,
  `pr checks 7 --json ${CHECK_FIELDS}`,
  'api repos/{owner}/{repo}/issues/7/comments',
  'pr view 7 --web',
  `pr list --state open --limit 30 --json ${SUMMARY_FIELDS}`,
  '',
].join('\n');

describe('rafa pr current, show, view and list, spawned', () => {
  it('run through the chain of the registered commands, each reaching the stand-in gh and none other', () => {
    const scratch = plantScratchRepo(tempBase);
    plantProjectConfig(scratch.repo, GH_CONFIG);
    plantBranch(scratch);
    const ghLog = join(dirname(scratch.bin), 'gh.log');
    plantStandInGh(scratch, ghLog);

    const current = runRafa(scratch, scratch.repo, ['pr', 'current']);
    const show = runRafa(scratch, scratch.repo, ['pr', 'show', '7']);
    const view = runRafa(scratch, scratch.repo, ['pr', 'view', '7']);
    const list = runRafa(scratch, scratch.repo, ['pr', 'list']);

    expect([current.exitCode, current.stderr]).toEqual([0, '']);
    expect(current.stdout.trim()).toBe(
      `#1 Stand-in current${SEPARATOR}open${SEPARATOR}checks green${SEPARATOR}https://github.com/o/r/pull/1`,
    );

    expect([show.exitCode, show.stderr]).toEqual([0, '']);
    expect(show.stdout.split('\n')).toEqual([
      '#7 Stand-in show',
      `open${SEPARATOR}octocat${SEPARATOR}${BRANCH} → main${SEPARATOR}mergeable (CLEAN)`,
      'https://github.com/o/r/pull/7',
      '',
      'checks green',
      '   pass    build — SUCCESS (https://example.invalid/run/1)',
      '',
      'triage none — run rafa pr triage to assess this pull request',
      '',
    ]);

    expect([view.exitCode, view.stderr]).toEqual([0, '']);
    expect(view.stdout.trim()).toBe('Opened #7 in the browser');

    expect([list.exitCode, list.stderr]).toEqual([0, '']);
    expect(list.stdout.trim()).toBe('No open pull requests.');

    // The stand-in is the only `gh` this PATH resolves to (plantScratchRepo's
    // own PATH holds no other), so this is what proves it was hit, and hit
    // with exactly what the four actions were expected to send it.
    expect(readFileSync(ghLog, 'utf8')).toBe(EXPECTED_LOG);
  }, SPAWN_TIMEOUT);
});
