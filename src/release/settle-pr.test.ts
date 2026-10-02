/**
 * Tests for `settleByPr` (`settle-pr.ts`): the `pr` delivery, over real
 * repositories — a bare origin, a clone that lands commits on `main` and
 * on `rafa/release` as merges and other settles would, and the caller's
 * clone on a feature branch, which settles in the scratch worktree
 * `withSettleWorktree` makes — and over a `PullRequests` double, since
 * the subject is what the delivery sends to the provider.
 *
 * A race for `rafa/release` is planted, not simulated: the worktree's
 * runner is wrapped so that just before the push the other clone pushes
 * to `rafa/release`, and the lease settle pushes under is then refused by
 * git itself.
 */
import type { Fragment } from './fragment.js';
import type { SettlePrOutcome } from './settle-pr.js';
import type { SettleWorktree } from './settle-worktree.js';
import type { SettleSettings } from './settle.js';
import type { GitRunner } from '../pr/git.js';
import type { PullRequestsAnswers, PullRequestsDouble } from '../pr/pull-requests-double.js';
import type { PullRequestDetail, PullRequestDraft, PullRequestSummary } from '../pr/types.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/git.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { gitIdentityEnv } from '../tests/git-identity.js';

import { serializeFragment } from './fragment.js';
import { RELEASE_PR_BRANCH, releasePullBody, settleByPr } from './settle-pr.js';
import { withSettleWorktree } from './settle-worktree.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-settle-pr-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The settings every case settles under. */
const SETTINGS: SettleSettings = {
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseFragments: '.changes',
  releaseStrategy: 'semver-by-level',
  releaseHeading: '## {version} — {date}, {title}',
};

/** The manifest on `main`. */
const MANIFEST = '{\n\t"name": "demo",\n\t"version": "0.4.0"\n}\n';

/** The changelog on `main`. */
const CHANGELOG = '# Changelog\n\n## 0.4.0 — 2026-08-01, older\n\n- Loop: old line\n';

/** The date every setup commit gets. */
const SETUP_DATE = '2026-09-01T12:00:00Z';

/** The number the pending release pull request has in every case that plants one. */
const PULL = 12;

/** The environment every setup git runs under, isolated from the operator's config. */
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

/** A fragment's text. */
function fragmentText(plan: string, level: Fragment['level'], notes: readonly string[]): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level, notes });
}

/** A bare origin, a clone that lands commits, and the caller's clone. */
interface World {
  readonly origin: string;
  readonly caller: string;
  readonly scratchRoot: string;
  /** Runs git in `cwd` under the isolated environment, answering stdout trimmed. */
  readonly git: (cwd: string, args: readonly string[]) => string;
  /** Writes (text) or deletes (null) each path in the other clone, commits and pushes `main`. */
  readonly land: (files: Readonly<Record<string, string | null>>, message: string) => string;
  /** Pushes a commit of its own to `rafa/release` from the other clone, answering its hash. */
  readonly squat: () => string;
}

/** Builds a {@link World}; the caller is on `feat` with an uncommitted edit. */
function world(): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const origin = join(dir, 'origin.git');
  const caller = join(dir, 'caller');
  const other = join(dir, 'other');
  const scratchRoot = join(dir, 'scratch');
  for (const path of [home, scratchRoot]) mkdirSync(path, { recursive: true });
  const git = (cwd: string, args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8', env: isolatedEnv(home), stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const land = (files: Readonly<Record<string, string | null>>, message: string): string => {
    git(other, ['pull', '-q', '--ff-only', 'origin', 'main']);
    for (const [path, text] of Object.entries(files)) {
      if (text === null) {
        git(other, ['rm', '-q', '--', path]);
        continue;
      }
      mkdirSync(dirname(join(other, path)), { recursive: true });
      writeFileSync(join(other, path), text);
    }
    git(other, ['add', '-A']);
    git(other, ['commit', '-q', '-m', message]);
    git(other, ['push', '-q', 'origin', 'main']);
    return git(other, ['rev-parse', 'HEAD']);
  };
  const squat = (): string => {
    git(other, ['commit', '-q', '--allow-empty', '-m', 'another settle']);
    git(other, ['push', '-q', '--force', 'origin', `HEAD:refs/heads/${RELEASE_PR_BRANCH}`]);
    const pushed = git(other, ['rev-parse', 'HEAD']);
    git(other, ['reset', '-q', '--hard', 'HEAD~1']);
    return pushed;
  };

  git(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(dir, ['clone', '-q', origin, other]);
  writeFileSync(join(other, 'package.json'), MANIFEST);
  writeFileSync(join(other, 'CHANGELOG.md'), CHANGELOG);
  git(other, ['add', '-A']);
  git(other, ['commit', '-q', '-m', 'first']);
  git(other, ['push', '-q', 'origin', 'main']);

  git(dir, ['clone', '-q', origin, caller]);
  for (const [key, value] of [['user.name', 'rafa settle'], ['user.email', 'settle@example.invalid'], ['commit.gpgsign', 'false'], ['core.hooksPath', join(dir, 'no-hooks')]]) {
    git(caller, ['config', key, value]);
  }
  git(caller, ['switch', '-q', '-c', 'feat']);
  writeFileSync(join(caller, 'package.json'), `${MANIFEST}work in flight\n`);
  return { origin, caller, scratchRoot, git, land, squat };
}

/** Lands `rafa-9` (minor) and then `rafa-1` (patch). */
function landTwo(w: World): void {
  w.land({ '.changes/rafa-9.md': fragmentText('rafa-9', 'minor', ['- Walk: one hop']) }, 'merge rafa-9');
  w.land({ '.changes/rafa-1.md': fragmentText('rafa-1', 'patch', ['- Loop: a fix']) }, 'merge rafa-1');
}

/** The pending release pull request as a list answers it. */
function summary(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: PULL,
    title: 'chore: release 0.5.0',
    url: `https://github.com/open-tomato/rafa/pull/${String(PULL)}`,
    state: 'open',
    headRefName: RELEASE_PR_BRANCH,
    baseRefName: 'main',
    author: { login: 'rafa', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-01T12:00:00Z',
    ...overrides,
  };
}

/** The same pull request in full. */
function detail(overrides: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    ...summary(),
    body: '',
    headRefOid: '0'.repeat(40),
    mergeable: 'mergeable',
    mergeStateStatus: 'CLEAN',
    labels: [],
    ...overrides,
  };
}

/** A double with no release pull request open, opening #12 on `create`. */
function noPull(): PullRequestsAnswers {
  return {
    findOpen: () => Promise.resolve(null),
    create: (draft: PullRequestDraft) => Promise.resolve(summary({ title: draft.title, baseRefName: draft.base })),
  };
}

/** A double with #12 open, reading `body` and `title` back, and taking both edits. */
function openPull(read: Partial<PullRequestDetail>): PullRequestsAnswers {
  return {
    findOpen: () => Promise.resolve(summary()),
    get: () => Promise.resolve(detail(read)),
    editTitle: () => Promise.resolve(),
    editBody: () => Promise.resolve(),
  };
}

/** What a settle answered, with every argv its worktree ran. */
interface Settled {
  readonly outcome: SettlePrOutcome;
  readonly argv: readonly (readonly string[])[];
}

/** Runs `settleByPr` in a settle worktree of the caller's `origin/main`; `beforePush` runs just before the push. */
async function settleIn(w: World, double: PullRequestsDouble, beforePush?: () => void): Promise<Settled> {
  const argv: string[][] = [];
  const outcome = await withSettleWorktree({ git: createGitRunner(w.caller), scratchRoot: w.scratchRoot }, (made: SettleWorktree) => {
    const git: GitRunner = (args) => {
      argv.push([...args]);
      if (args[0] === 'push') beforePush?.();
      return made.git(args);
    };
    return settleByPr({ ...made, git }, SETTINGS, double.pulls);
  });
  if (!outcome.ok) throw new Error(outcome.problem);
  return { outcome: outcome.value, argv };
}

/** A ref of the bare origin, or the empty string when it has none. */
function originRef(w: World, ref: string): string {
  try {
    return w.git(w.origin, ['rev-parse', '--verify', '--quiet', ref]);
  } catch {
    return '';
  }
}

/** The pushes a settle made. */
function pushesOf(settled: Settled): readonly (readonly string[])[] {
  return settled.argv.filter((args) => args[0] === 'push');
}

describe('settleByPr, the first delivery', () => {
  it('pushes the release commit to rafa/release, opens the pull request into main and leaves main and the caller alone', async () => {
    const w = world();
    landTwo(w);
    const main = originRef(w, 'refs/heads/main');
    const callerStatus = w.git(w.caller, ['status', '--porcelain']);
    const double = createPullRequestsDouble(noPull());

    const settled = await settleIn(w, double);

    expect(settled.outcome.outcome).toBe('delivered');
    if (settled.outcome.outcome !== 'delivered') return;
    const { build } = settled.outcome;
    expect(settled.outcome).toMatchObject({ exitCode: 0, action: 'opened', pushed: true, head: build.release });
    expect(settled.outcome.pull.number).toBe(PULL);
    expect(originRef(w, `refs/heads/${RELEASE_PR_BRANCH}`)).toBe(build.release);
    expect(w.git(w.origin, ['log', '-1', '--format=%s%n%P', RELEASE_PR_BRANCH])).toBe(`chore: release 0.5.0\n${main}`);
    expect(originRef(w, 'refs/heads/main')).toBe(main);
    expect(w.git(w.caller, ['branch', '--show-current'])).toBe('feat');
    expect(w.git(w.caller, ['status', '--porcelain'])).toBe(callerStatus);
    // The control: the same probe sees the caller's own work in flight.
    expect(callerStatus).toBe('M package.json');

    const create = double.calls().find((call) => call.member === 'create');
    expect(create?.args[0]).toEqual({
      head: RELEASE_PR_BRANCH,
      base: 'main',
      title: 'chore: release 0.5.0',
      body: releasePullBody(build, 'main'),
    });
    expect(double.sent()).toEqual(['findOpen rafa/release', 'create [object Object]']);
  });

  it('pushes under an empty lease on rafa/release alone, and never to main', async () => {
    const w = world();
    landTwo(w);

    const settled = await settleIn(w, createPullRequestsDouble(noPull()));

    const pushes = pushesOf(settled);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.slice(0, 4)).toEqual(['push', '--porcelain', '--force-with-lease=refs/heads/rafa/release:', 'origin']);
    expect(pushes[0]?.[4]).toMatch(/^[0-9a-f]{40}:refs\/heads\/rafa\/release$/);
    expect(pushes[0]).toHaveLength(5);
  });

  it('writes a body naming the strategy, the versions, every fragment in fold order and the section with its receipt', async () => {
    const w = world();
    landTwo(w);

    const settled = await settleIn(w, createPullRequestsDouble(noPull()));

    if (settled.outcome.outcome !== 'delivered') throw new Error(settled.outcome.outcome);
    const body = releasePullBody(settled.outcome.build, 'main');
    expect(body).toStartWith('Settles the change fragments waiting on `main` into 0.5.0: the `semver-by-level` strategy folded them from 0.4.0.\n');
    expect(body).toContain('- `.changes/rafa-9.md` (`rafa-9`, minor)\n- `.changes/rafa-1.md` (`rafa-1`, patch)\n');
    expect(body).toContain('tag it afterwards with `rafa release tag`');
    expect(body).toContain('<!-- rafa:fragments rafa-9 rafa-1 -->');
    expect(body).toContain('## 0.5.0 — ');
    expect(body).not.toContain(settled.outcome.build.release);
  });
});

describe('settleByPr, a settle run again', () => {
  it('pushes and edits nothing when rafa/release and the pull request already hold this release', async () => {
    const w = world();
    landTwo(w);
    const first = await settleIn(w, createPullRequestsDouble(noPull()));
    if (first.outcome.outcome !== 'delivered') throw new Error(first.outcome.outcome);
    const body = releasePullBody(first.outcome.build, 'main');
    const double = createPullRequestsDouble(openPull({ body }));

    const second = await settleIn(w, double);

    expect(second.outcome).toMatchObject({ outcome: 'delivered', exitCode: 0, action: 'unchanged', pushed: false, head: first.outcome.head });
    expect(pushesOf(second)).toEqual([]);
    expect(originRef(w, `refs/heads/${RELEASE_PR_BRANCH}`)).toBe(first.outcome.head);
    expect(double.sent()).toEqual(['findOpen rafa/release', `get ${String(PULL)}`]);
  });

  it('replaces rafa/release under the lease it read and edits title and body when a fragment arrived on main', async () => {
    const w = world();
    landTwo(w);
    const first = await settleIn(w, createPullRequestsDouble(noPull()));
    if (first.outcome.outcome !== 'delivered') throw new Error(first.outcome.outcome);
    const arrived = w.land({ '.changes/rafa-4.md': fragmentText('rafa-4', 'major', ['- Store: new shape']) }, 'merge rafa-4');
    const double = createPullRequestsDouble(openPull({ body: releasePullBody(first.outcome.build, 'main') }));

    const second = await settleIn(w, double);

    expect(second.outcome).toMatchObject({ outcome: 'delivered', action: 'updated', pushed: true });
    if (second.outcome.outcome !== 'delivered') return;
    expect(second.outcome.pull.title).toBe('chore: release 1.0.0');
    expect(pushesOf(second)[0]?.[2]).toBe(`--force-with-lease=refs/heads/rafa/release:${first.outcome.head}`);
    expect(originRef(w, `refs/heads/${RELEASE_PR_BRANCH}`)).toBe(second.outcome.build.release);
    expect(w.git(w.origin, ['log', '-1', '--format=%s%n%P', RELEASE_PR_BRANCH])).toBe(`chore: release 1.0.0\n${arrived}`);
    expect(double.sent()).toEqual([
      'findOpen rafa/release',
      `get ${String(PULL)}`,
      `editTitle ${String(PULL)} chore: release 1.0.0`,
      `editBody ${String(PULL)} ${releasePullBody(second.outcome.build, 'main')}`,
    ]);
  });

  it('opens a new pull request when the one found is no longer open by the time it is read', async () => {
    const w = world();
    landTwo(w);
    const double = createPullRequestsDouble({ ...noPull(), findOpen: () => Promise.resolve(summary()), get: () => Promise.resolve(detail({ state: 'closed' })) });

    const settled = await settleIn(w, double);

    expect(settled.outcome).toMatchObject({ outcome: 'delivered', action: 'opened' });
    expect(double.sent().map((line) => line.split(' ')[0])).toEqual(['findOpen', 'get', 'create']);
  });
});

describe('settleByPr, refusals', () => {
  it('exits 1 as refused when another settle moved rafa/release after it was read, opening nothing', async () => {
    const w = world();
    landTwo(w);
    let squatted = '';
    const double = createPullRequestsDouble(noPull());

    const settled = await settleIn(w, double, () => {
      squatted = w.squat();
    });

    expect(settled.outcome).toMatchObject({ outcome: 'refused', exitCode: 1, pushed: false });
    if (settled.outcome.outcome !== 'refused') return;
    expect(settled.outcome.sentence).toStartWith('rafa/release moved on origin after settle read it absent, so chore: release 0.5.0 was not pushed');
    expect(settled.outcome.sentence).toContain('[rejected] (stale info)');
    expect(originRef(w, `refs/heads/${RELEASE_PR_BRANCH}`)).toBe(squatted);
    expect(double.sent()).toEqual(['findOpen rafa/release']);
  });

  it.each([
    ['into another base', { baseRefName: 'develop' }, 'pull request #12 from rafa/release goes into develop, not main'],
    ['from a fork', { isCrossRepository: true }, 'pull request #12 from rafa/release comes from a fork'],
  ])('exits 1 as foreign, pushing nothing, when the open pull request goes %s', async (_label, overrides, sentence) => {
    const w = world();
    landTwo(w);
    const double = createPullRequestsDouble({ findOpen: () => Promise.resolve(summary(overrides)) });

    const settled = await settleIn(w, double);

    expect(settled.outcome).toMatchObject({ outcome: 'foreign', exitCode: 1, pushed: false });
    if (settled.outcome.outcome !== 'foreign') return;
    expect(settled.outcome.sentence).toStartWith(sentence);
    expect(pushesOf(settled)).toEqual([]);
    expect(originRef(w, `refs/heads/${RELEASE_PR_BRANCH}`)).toBe('');
  });

  it('exits 1 as unopened, pushing nothing, when the open pull request cannot be looked up', async () => {
    const w = world();
    landTwo(w);
    const double = createPullRequestsDouble({ findOpen: () => Promise.reject(new Error('gh is gone')) });

    const settled = await settleIn(w, double);

    expect(settled.outcome).toMatchObject({ outcome: 'unopened', exitCode: 1, pushed: false });
    if (settled.outcome.outcome !== 'unopened') return;
    expect(settled.outcome.sentence).toBe('the open pull request from rafa/release could not be looked up, so nothing was pushed: gh is gone');
    expect(pushesOf(settled)).toEqual([]);
  });

  it('exits 1 as unopened, with rafa/release pushed, when create fails and no pull request is open after all', async () => {
    const w = world();
    landTwo(w);
    const double = createPullRequestsDouble({ findOpen: () => Promise.resolve(null), create: () => Promise.reject(new Error('planted create failure')) });

    const settled = await settleIn(w, double);

    expect(settled.outcome).toMatchObject({ outcome: 'unopened', exitCode: 1, pushed: true });
    if (settled.outcome.outcome !== 'unopened') return;
    expect(settled.outcome.sentence).toBe('rafa/release holds chore: release 0.5.0, but the release pull request into main could not be opened or updated; settle again to finish it: planted create failure');
    expect(originRef(w, `refs/heads/${RELEASE_PR_BRANCH}`)).toBe(settled.outcome.build.release);
    expect(double.sent().map((line) => line.split(' ')[0])).toEqual(['findOpen', 'create', 'findOpen']);
  });

  it('updates the pull request another settle opened meanwhile when create fails, opening no second one', async () => {
    const w = world();
    landTwo(w);
    let looked = 0;
    const double = createPullRequestsDouble({
      findOpen: () => {
        looked += 1;
        return Promise.resolve(looked === 1
          ? null
          : summary());
      },
      create: () => Promise.reject(new Error('a pull request for branch rafa/release into branch main already exists')),
      get: () => Promise.resolve(detail({ title: 'chore: release 0.5.0', body: 'the other settle\'s body' })),
      editBody: () => Promise.resolve(),
    });

    const settled = await settleIn(w, double);

    expect(settled.outcome).toMatchObject({ outcome: 'delivered', exitCode: 0, action: 'updated' });
    expect(double.sent().map((line) => line.split(' ')[0])).toEqual(['findOpen', 'create', 'findOpen', 'get', 'editBody']);
  });
});

describe('settleByPr, a build with no commit', () => {
  it('reads and pushes nothing and exits 0 when only none fragments wait', async () => {
    const w = world();
    w.land({ '.changes/rafa-3.md': fragmentText('rafa-3', 'none', []) }, 'merge rafa-3');
    const double = createPullRequestsDouble();

    const settled = await settleIn(w, double);

    expect(settled.outcome).toMatchObject({ outcome: 'unsettled', exitCode: 0 });
    if (settled.outcome.outcome !== 'unsettled') return;
    expect(settled.outcome.build.outcome).toBe('nothing');
    expect(pushesOf(settled)).toEqual([]);
    expect(double.calls()).toEqual([]);
  });

  it('reads and pushes nothing and exits 1 when the strategy throws', async () => {
    const w = world();
    w.land({ 'package.json': '{ "version": "not-a-version" }\n' }, 'break the version');
    landTwo(w);
    const double = createPullRequestsDouble();

    const settled = await settleIn(w, double);

    expect(settled.outcome).toMatchObject({ outcome: 'unsettled', exitCode: 1 });
    if (settled.outcome.outcome !== 'unsettled') return;
    expect(settled.outcome.build.outcome).toBe('failed');
    expect(pushesOf(settled)).toEqual([]);
    expect(double.calls()).toEqual([]);
  });
});
