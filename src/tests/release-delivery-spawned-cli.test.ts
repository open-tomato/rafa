/**
 * Release delivery end to end (#765, #842, #843, #736): the real `rafa`
 * binary, spawned through `runRafa` (`src/tests/cli-capture.ts`), over a
 * scratch project with no `CHANGELOG.md` and a bare origin.
 *
 *   - `rafa release settle` creates the changelog and pushes the release commit;
 *   - the same settle against an origin whose `pre-receive` hook prints
 *     GitHub's GH013 text exits 1, names `release.settle: pr` and prints
 *     no success line;
 *   - `rafa release tag --push` on the settled commit puts `v<version>`
 *     on the origin;
 *   - the `rafa pr merge` guard over a `rafa/release` head prints the
 *     delivery line and no `fix:` (in-process, over a provider double,
 *     since `gh` needs a network).
 */
import type { ScratchRepo } from './cli-capture.js';
import type { GitResult, GitRunner } from '../pr/index.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createPrMergeCommand } from '../commands/pr/merge.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { serializeFragment } from '../release/fragment.js';
import { RELEASE_PR_BRANCH } from '../release/settle-pr.js';

import { dispatchInProject, eventsOf, expectExit, plantProjectConfig, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';
import { hostToolDirs } from './stand-in-gh.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-delivery-spawned-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made. */
let worldCount = 0;

/** The manifest on `main`; no changelog is committed beside it. */
const MANIFEST = '{\n\t"name": "demo",\n\t"version": "0.4.0"\n}\n';

/** The committer date every setup commit gets. */
const SETUP_DATE = '2026-09-01T12:00:00Z';

/** GitHub's GH013 refusal, one line per `echo`. */
const GH013 = [
  'error: GH013: Repository rule violations found for refs/heads/main.',
  '',
  '- Required status check \\"verify\\" is expected.',
  '',
];

/** The environment every setup git run uses. */
function isolatedEnv(home: string): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    ...gitIdentityEnv(),
    GIT_AUTHOR_DATE: SETUP_DATE,
    GIT_COMMITTER_DATE: SETUP_DATE,
    LC_ALL: 'C',
  };
}

/** A scratch project, its bare origin, and helpers. */
interface World {
  readonly origin: string;
  readonly scratch: ScratchRepo;
  readonly git: (cwd: string, args: readonly string[]) => string;
  readonly refuseWithGh013: () => void;
}

/** Builds a world whose `main` holds a manifest and no changelog, with one fragment waiting. */
function world(): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const bin = join(dir, 'bin');
  const origin = join(dir, 'origin.git');
  const caller = join(dir, 'caller');
  for (const path of [home, bin]) mkdirSync(path, { recursive: true });
  const git = (cwd: string, args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8', env: isolatedEnv(home), stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(origin, ['config', 'core.hooksPath', join(origin, 'hooks')]);
  git(dir, ['clone', '-q', origin, caller]);
  for (const [key, value] of [['user.name', 'rafa settle'], ['user.email', 'settle@example.invalid'], ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false'], ['core.hooksPath', join(dir, 'no-hooks')]]) {
    git(caller, ['config', key, value]);
  }
  git(caller, ['switch', '-q', '-c', 'main']);
  mkdirSync(join(caller, '.changes'), { recursive: true });
  writeFileSync(join(caller, '.gitignore'), '.rafa/\n');
  writeFileSync(join(caller, 'package.json'), MANIFEST);
  writeFileSync(
    join(caller, '.changes', 'rafa-9.md'),
    serializeFragment({ plan: 'rafa-9', title: 'title of rafa-9', level: 'minor', notes: ['- Walk: one hop'] }),
  );
  git(caller, ['add', '-A']);
  git(caller, ['commit', '-q', '-m', 'first']);
  git(caller, ['push', '-q', '-u', 'origin', 'main']);
  plantProjectConfig(caller);
  const refuseWithGh013 = (): void => {
    const hook = join(origin, 'hooks', 'pre-receive');
    mkdirSync(join(origin, 'hooks'), { recursive: true });
    writeFileSync(hook, `#!/bin/sh\n${GH013.map((line) => `echo "${line}" >&2`).join('\n')}\nexit 1\n`);
    chmodSync(hook, 0o755);
  };
  const scratch: ScratchRepo = { repo: caller, home, bin, callLog: join(dir, 'calls.log'), path: [bin, ...hostToolDirs()].join(delimiter) };
  return { origin, scratch, git, refuseWithGh013 };
}

describe('release delivery over a scratch project with no changelog and a bare origin', () => {
  it('creates the changelog and pushes the release commit', () => {
    const w = world();

    const settled = runRafa(w.scratch, w.scratch.repo, ['release', 'settle']);

    expectExit(settled, 0, w.scratch);
    expect(settled.stdout).toContain('✅ Pushed "chore: release 0.5.0"');
    expect(w.git(w.origin, ['log', '-1', '--format=%s', 'main'])).toBe('chore: release 0.5.0');
    expect(w.git(w.origin, ['show', 'main:CHANGELOG.md'])).toStartWith('# Changelog');
    expect(w.git(w.origin, ['show', 'main:CHANGELOG.md'])).toContain('## 0.5.0');
  });

  it('exits 1 naming release.settle: pr, with no success line, when the origin refuses on a repository rule', () => {
    const w = world();
    w.refuseWithGh013();
    const before = w.git(w.origin, ['rev-parse', 'main']);

    const settled = runRafa(w.scratch, w.scratch.repo, ['release', 'settle']);

    expectExit(settled, 1, w.scratch);
    const output = `${settled.stdout}\n${settled.stderr}`;
    expect(output).toContain('release.settle: pr');
    expect(output).not.toContain('✅');
    expect(output).not.toContain('Pushed "chore: release');
    expect(w.git(w.origin, ['rev-parse', 'main'])).toBe(before);
  });

  it('pushes v<version> to the origin with `release tag --push` on the settled commit', () => {
    const w = world();
    expectExit(runRafa(w.scratch, w.scratch.repo, ['release', 'settle']), 0, w.scratch);
    w.git(w.scratch.repo, ['pull', '-q', '--ff-only', 'origin', 'main']);

    const tagged = runRafa(w.scratch, w.scratch.repo, ['release', 'tag', '--push']);

    expectExit(tagged, 0, w.scratch);
    expect(tagged.stdout).toContain('✅ Pushed v0.5.0 to origin.');
    expect(w.git(w.origin, ['tag', '--list', 'v0.5.0'])).toBe('v0.5.0');
    expect(w.git(w.origin, ['rev-parse', 'v0.5.0^{commit}'])).toBe(w.git(w.origin, ['rev-parse', 'main']));
  });

  it('prints the delivery line and no fix: from the pr merge guard over a rafa/release head', async () => {
    const w = world();
    const baseCommit = w.git(w.scratch.repo, ['rev-parse', 'HEAD']);
    expectExit(runRafa(w.scratch, w.scratch.repo, ['release', 'settle']), 0, w.scratch);
    w.git(w.scratch.repo, ['pull', '-q', '--ff-only', 'origin', 'main']);
    // Settle's `pr` delivery leaves the commit on the release branch, the base behind it.
    w.git(w.scratch.repo, ['push', '-q', 'origin', `HEAD:refs/heads/${RELEASE_PR_BRANCH}`]);
    w.git(w.scratch.repo, ['push', '-q', '--force', 'origin', `${baseCommit}:refs/heads/main`]);
    w.git(w.scratch.repo, ['reset', '-q', '--hard', baseCommit]);
    w.git(w.scratch.repo, ['fetch', '-q', 'origin']);
    w.git(w.scratch.repo, ['branch', RELEASE_PR_BRANCH, `origin/${RELEASE_PR_BRANCH}`]);
    plantProjectConfig(w.scratch.repo, 'pr:\n  provider: gh\n  versionCollision: refuse\nrelease:\n  enabled: true\n');
    const sent: string[] = [];
    const pulls = createPullRequestsDouble({
      get: () => Promise.resolve({
        number: 7,
        title: 'release',
        url: 'https://github.com/open-tomato/rafa/pull/7',
        state: 'open',
        headRefName: RELEASE_PR_BRANCH,
        baseRefName: 'main',
        author: { login: 'octo', isBot: false },
        isCrossRepository: false,
        updatedAt: '2026-09-18T11:00:00Z',
        body: '',
        headRefOid: '1f0c2b7de6a94c1a0b5e3d2f4a6b8c0d1e2f3a4b',
        mergeable: 'mergeable',
        mergeStateStatus: 'CLEAN',
        labels: [],
        closes: [],
      }),
      checks: () => Promise.resolve({ rows: [], verdict: 'green' as const }),
      merge: () => {
        sent.push('merge');
        return Promise.resolve({ merged: true, detail: 'Squashed and merged pull request' });
      },
    }, { refusal: 'the stub provider models get, checks and merge alone' });
    const runner = (root: string): GitRunner => (args) => {
      try {
        const stdout = execFileSync('git', [...args], { cwd: root, encoding: 'utf8', env: isolatedEnv(w.scratch.home), stdio: ['ignore', 'pipe', 'pipe'] });
        return { ok: true, stdout: stdout.trim(), stderr: '' } satisfies GitResult;
      } catch (error) {
        return { ok: false, stdout: '', stderr: String(error) } satisfies GitResult;
      }
    };

    const run = await dispatchInProject(
      ['pr', 'merge', '7', '--yes', '--output=json', '--no-hint'],
      [{ name: 'pr', summary: 'pull requests' }],
      [createPrMergeCommand({
        pullRequests: () => pulls.pulls,
        git: runner,
        isTerminal: () => true,
        now: () => new Date('2026-09-29T12:00:00Z'),
        openPrompter: () => ({ say: () => undefined, ask: () => Promise.resolve('y'), close: () => undefined }),
      })],
      { root: w.scratch.repo, home: w.scratch.home },
    );

    const messages = (eventsOf(run.stdout) as unknown as readonly { type: string; message?: string }[])
      .filter((event) => event.type === 'log')
      .map((event) => event.message ?? '');
    expect([run.exitCode, run.stdout]).toEqual([0, run.stdout]);
    expect(messages).toContain('Release: #7 is settle\'s release pull request; merging it lands 0.5.0');
    expect(messages.some((line) => line.includes('fix:'))).toBe(false);
    expect(sent).toEqual(['merge']);
  });
});
