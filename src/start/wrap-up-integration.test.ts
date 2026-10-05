/**
 * Integration test of the wrap-up's lesson list and answer check, and of
 * its release fragment stage, over scratch git repositories.
 *
 * The lesson case: a lesson held by three sources at 0.7 is listed in
 * the prompt; a stand-in session answers a `rafa:promoted` block that
 * omits it, and the check appends the unpromoted line to the pull
 * request body. Only gh is the recorded fake; git and the adapter are
 * real.
 *
 * The release fragment cases: `prepareReleaseStage` and `finishRelease`
 * (`./release-stage.js`) run over a real scratch repository with a bare
 * `origin`, exactly as `src/tests/release-stage-integration.test.ts`
 * drives them, but the pull request is a `PullRequests` double
 * (`../pr/pull-requests-double.js`) rather than the `gh` fake, since the
 * subject there is what the stage SENDS a provider — the forecast in
 * the body — and not a provider's own read-modify-write.
 *
 * The `pr.base` case (rafa-628, #627): under `pr.base: integration`, the
 * prompt names `--base integration`, a pull request the session left
 * against `main` is retargeted to `integration` with one line saying so,
 * and the release step's line is written into the pull request found by
 * the run's head branch. All three run over a real scratch repository
 * with a bare `origin`, with the recorded `gh` fake as the provider.
 */
import type { ReleaseStageSettings } from './release-stage.js';
import type { ReportChange } from '../report/parse.js';
import type { Instinct } from '../schema/instinct.js';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';

import { localInstinctsDir } from '../adapters/learning/local.js';
import { activeOutput, setActiveOutput } from '../adapters/output/active.js';
import { resolveBaseBranch } from '../cleanup/index.js';
import { RELEASE_AUTO } from '../config-sections.js';
import { writeChanges } from '../effort/store/changes.js';
import { actionHash } from '../learning/index.js';
import { createFakePrGh } from '../pr/gh-fake.js';
import { createGhPullRequests, createGitRunner } from '../pr/index.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { writeInstinct } from '../schema/instinct.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { retargetedLine, retargetPullRequest } from './pr-retarget.js';
import { checkWrapUpAnswer, readHead } from './promoted-check.js';
import { finishRelease, prepareReleaseStage } from './release-stage.js';
import { deliverPullRequest } from './wrap-up-run.js';
import { buildWrapUpPrompt, lessonsToPromote } from './wrap-up.js';

const BRANCH = 'feat/rafa-25-rafa-learns-own-runs';
const FENCE = '```';

/** A held lesson from three sources at the given confidence. */
function held(id: string, confidence: number): Instinct {
  const action = `the action of ${id}`;
  return {
    id,
    trigger: `the trigger of ${id}`,
    kind: 'gotcha',
    domain: 'workflow',
    confidence,
    usageCount: 3,
    sources: ['session-a', 'session-b', 'session-c'],
    artifact: null,
    signal: 'loud',
    scope: 'project',
    projectId: null,
    source: 'task-report',
    evidence: [{ plan: 'rafa-25', task: 'a task', session: 'session-a', outcome: 'done' }],
    promotedTo: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z',
    action,
    cause: 'it recurred',
    actionHash: actionHash(action),
  };
}

describe('wrap-up over a scratch repository', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'rafa-wrap-up-it-'));
  const root = join(scratch, 'repo');

  beforeAll(() => {
    mkdirSync(root, { recursive: true });
    const git = createGitRunner(root);
    for (const args of [
      ['init', '-q'],
      ['config', 'user.email', 'test@example.com'],
      ['config', 'user.name', 'Test'],
      ['config', 'commit.gpgsign', 'false'],
    ]) git(args);
    const dir = localInstinctsDir(root);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'held-three.md'), writeInstinct(held('held-three', 0.7)));
    writeFileSync(join(dir, 'too-weak.md'), writeInstinct(held('too-weak', 0.6)));
    writeFileSync(join(root, 'README.md'), 'start\n');
    git(['add', 'README.md']);
    git(['commit', '-q', '-m', 'start']);
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  test('lists the lesson, and an answer that omits it puts the line in the PR body', async () => {
    const warnings: string[] = [];
    setActiveOutput(sinkOutput({ warn: (message) => { warnings.push(message); } }));
    const git = createGitRunner(root);

    const lessons = await lessonsToPromote({
      kind: 'local',
      home: join(scratch, 'home'),
      blessMinConfidence: 0.5,
      repoRoot: root,
      promoteAfter: 3,
      promoteMinConfidence: 0.7,
    });
    const prompt = buildWrapUpPrompt(BRANCH, 'main', '# Plan\n', null, null, lessons);

    // Listed: the lesson at 0.7; the control, at 0.6, is not.
    expect(lessons.map((each) => each.id)).toEqual(['held-three']);
    expect(prompt).toContain('## Lessons to promote');
    expect(prompt).toContain('`held-three`');
    expect(prompt).not.toContain('too-weak');

    const head = readHead(git);
    const fakeGh = createFakePrGh();
    fakeGh.plant({ number: 7, headRefName: BRANCH, body: 'What this pull request does.' });
    const output = ['Done.', `${FENCE}rafa:promoted`, `${FENCE}`].join('\n');

    const check = await checkWrapUpAnswer({
      lessons,
      output,
      head,
      repoRoot: root,
      branch: BRANCH,
      git,
      pulls: createGhPullRequests({ gh: fakeGh.run }),
      learning: () => { throw new Error('nothing was promoted, so no adapter is needed'); },
    });

    expect(check.promoted).toEqual([]);
    expect(check.unpromoted).toEqual([{ kind: 'unanswered', id: 'held-three' }]);
    const body = fakeGh.pull(7)?.body ?? '';
    expect(body.split('\n').at(-1)).toBe(
      'Lessons listed for promotion that this pull request does not carry: `held-three` (no answer in the `rafa:promoted` block).',
    );
    expect(body.startsWith('What this pull request does.\n\n')).toBe(true);
  });
});

describe('wrap-up release fragment over a scratch repository', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'rafa-wrap-up-release-it-'));
  const origin = join(scratch, 'origin.git');
  const root = join(scratch, 'repo');
  const BODY_BEFORE = 'What this pull request does.';
  const PR_NUMBER = 42;

  /** The `release` settings this scenario runs under: this repository's own. */
  const SETTINGS: ReleaseStageSettings = {
    releaseEnabled: RELEASE_AUTO,
    releaseVersionFile: 'package.json',
    releaseChangelog: 'CHANGELOG.md',
    releaseFragments: '.changes',
    releaseHeading: '## {version} — {date}, {title}',
    releaseStrategy: 'semver-by-level',
    prBase: null,
  };

  const CHANGELOG_BEFORE = [
    '# Changelog',
    '',
    'Every notable change to this project, newest first.',
    '',
  ].join('\n');
  const PACKAGE_JSON_BEFORE = '{"name":"wrap-up-release-repo","version":"0.4.0"}\n';

  beforeAll(() => {
    mkdirSync(root, { recursive: true });
    const outside = createGitRunner(scratch);
    outside(['init', '--quiet', '--bare', '--initial-branch=main', origin]);
    outside(['init', '--quiet', '--initial-branch=main', root]);
    const git = createGitRunner(root);
    for (const args of [
      ['config', 'user.email', 'test@example.com'],
      ['config', 'user.name', 'Test'],
      ['config', 'commit.gpgsign', 'false'],
    ]) git(args);
    writeFileSync(join(root, 'CHANGELOG.md'), CHANGELOG_BEFORE);
    writeFileSync(join(root, 'package.json'), PACKAGE_JSON_BEFORE);
    git(['add', '--all']);
    git(['commit', '-q', '-m', 'first']);
    git(['remote', 'add', 'origin', origin]);
    git(['push', '-q', '-u', 'origin', 'main']);
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  /** A `PullRequests` double that answers one open PR and records the body it is given. */
  function bodyDouble(branch: string): { readonly pulls: ReturnType<typeof createPullRequestsDouble>; edited: () => string | null } {
    let body: string | null = null;
    const double = createPullRequestsDouble({
      findOpen: () => Promise.resolve({
        number: PR_NUMBER,
        title: 'a wrap-up release',
        url: `https://github.com/open-tomato/rafa/pull/${PR_NUMBER}`,
        state: 'open',
        headRefName: branch,
        baseRefName: 'main',
        author: { login: 'markosth', isBot: false },
        isCrossRepository: false,
        updatedAt: '2026-09-20T12:00:00Z',
      }),
      get: () => Promise.resolve({
        number: PR_NUMBER,
        title: 'a wrap-up release',
        url: `https://github.com/open-tomato/rafa/pull/${PR_NUMBER}`,
        state: 'open',
        headRefName: branch,
        baseRefName: 'main',
        author: { login: 'markosth', isBot: false },
        isCrossRepository: false,
        updatedAt: '2026-09-20T12:00:00Z',
        body: BODY_BEFORE,
        headRefOid: 'deadbeef',
        mergeable: 'mergeable',
        mergeStateStatus: 'CLEAN',
        labels: [],
        closes: [],
      }),
      editBody: (_number, next) => {
        body = next;
        return Promise.resolve();
      },
    });
    return { pulls: double, edited: () => body };
  }

  test('leaves one fragment commit, an untouched version file and changelog, and a forecast in the body a PullRequests double received', async () => {
    setActiveOutput(sinkOutput({}));
    const branch = 'feat/rafa-367-wrap-up-release';
    const planStub = 'rafa-367-wrap-up-release';
    const git = createGitRunner(root);
    git(['checkout', '-q', '-b', branch]);
    const changes: readonly ReportChange[] = [
      { level: 'patch', area: 'loop', summary: 'the wrap-up commits a fragment', extras: [] },
    ];
    writeChanges(root, {
      dispatch: { sessionId: 'wrap-up-release-session', planStub, taskLine: '- [x] Ship a wrap-up release' },
      changes,
    });
    const plan = [
      '# Plan: rafa-367 — wrap-up release',
      '',
      '```rafa:plan',
      `stub: ${planStub}`,
      'issue: "367"',
      'release: minor',
      '```',
      '',
      '- [x] Ship a wrap-up release',
    ].join('\n');

    const preparation = prepareReleaseStage({ repoRoot: root, settings: SETTINGS, planStub, planContent: plan });
    if (preparation === null || preparation.kind !== 'prepared') {
      throw new Error(`expected a prepared release, got ${JSON.stringify(preparation)}`);
    }

    const double = bodyDouble(branch);
    const finish = await finishRelease(
      { repoRoot: root, branch, settings: SETTINGS, preparation },
      {
        pulls: () => double.pulls.pulls,
        readProvider: () => ({ provider: 'gh', source: 'config', remote: null, host: null }),
        now: () => new Date('2026-09-20T09:00:00Z'),
      },
    );

    expect(finish.outcome).toBe('released');
    const fragmentPath = `.changes/${planStub}.md`;
    expect(finish.fragment).toBe(fragmentPath);
    expect(finish.subject).toBe(`chore: release fragment ${planStub}`);

    // Exactly one release commit landed, over the fragment alone.
    const subjects = git(['log', '--format=%s']).stdout.trim().split('\n');
    expect(subjects).toEqual([`chore: release fragment ${planStub}`, 'first']);
    const changedFiles = git(['diff', '--name-only', 'HEAD~1', 'HEAD']).stdout.trim().split('\n');
    expect(changedFiles).toEqual([fragmentPath]);

    // No branch owns a version: both release files are as they were.
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(PACKAGE_JSON_BEFORE);
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(CHANGELOG_BEFORE);

    // The forecast reached the PullRequests double's edited body.
    expect(double.pulls.calls().map((call) => call.member)).toEqual(['findOpen', 'get', 'editBody']);
    expect(double.edited()).toContain('Release forecast: this branch ships as the next minor, 0.5.0 if merged now');
  });

  test('a plan declaring release: none writes a none fragment, and forecasts no release', async () => {
    setActiveOutput(sinkOutput({}));
    const branch = 'feat/rafa-367-wrap-up-release-none';
    const planStub = 'rafa-367-wrap-up-release-none';
    const git = createGitRunner(root);
    git(['checkout', '-q', 'main']);
    git(['checkout', '-q', '-b', branch]);
    const plan = [
      '# Plan: rafa-367 — wrap-up release none',
      '',
      '```rafa:plan',
      `stub: ${planStub}`,
      'issue: "368"',
      'release: none',
      '```',
      '',
      '- [x] Ship nothing worth a release',
    ].join('\n');

    const preparation = prepareReleaseStage({ repoRoot: root, settings: SETTINGS, planStub, planContent: plan });
    if (preparation === null || preparation.kind !== 'prepared') {
      throw new Error(`expected a prepared release, got ${JSON.stringify(preparation)}`);
    }
    expect(preparation.level).toBe('none');
    expect(preparation.levelSource).toBe('plan');

    const double = bodyDouble(branch);
    const finish = await finishRelease(
      { repoRoot: root, branch, settings: SETTINGS, preparation },
      {
        pulls: () => double.pulls.pulls,
        readProvider: () => ({ provider: 'gh', source: 'config', remote: null, host: null }),
        now: () => new Date('2026-09-20T09:00:00Z'),
      },
    );

    expect(finish.outcome).toBe('released');
    const fragmentPath = `.changes/${planStub}.md`;
    expect(readFileSync(join(root, fragmentPath), 'utf8')).toContain('level: none');
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(PACKAGE_JSON_BEFORE);
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(CHANGELOG_BEFORE);
    const subjects = git(['log', '--format=%s']).stdout.trim().split('\n');
    expect(subjects[0]).toBe(`chore: release fragment ${planStub}`);
    expect(double.edited()).toContain('Release forecast: this branch ships no release (level none)');
  });
});

describe('wrap-up under pr.base over a scratch repository and the recorded gh fake', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'rafa-wrap-up-base-it-'));
  const origin = join(scratch, 'origin.git');
  const root = join(scratch, 'repo');
  const BASE = 'integration';
  const HEAD = 'feat/rafa-628-pr-base';
  const PLAN_STUB = 'rafa-628-pr-base';
  const RUN_PR = 628;
  /** The pull request headed by the base: the one a branch read off the main checkout would write to. */
  const BASE_PR = 627;
  const RUN_BODY = 'Closes #628';
  const BASE_BODY = 'Stretch work';

  const SETTINGS: ReleaseStageSettings = {
    releaseEnabled: RELEASE_AUTO,
    releaseVersionFile: 'package.json',
    releaseChangelog: 'CHANGELOG.md',
    releaseFragments: '.changes',
    releaseHeading: '## {version} — {date}, {title}',
    releaseStrategy: 'semver-by-level',
    prBase: BASE,
  };

  beforeAll(() => {
    mkdirSync(root, { recursive: true });
    const outside = createGitRunner(scratch);
    outside(['init', '--quiet', '--bare', '--initial-branch=main', origin]);
    outside(['init', '--quiet', '--initial-branch=main', root]);
    const git = createGitRunner(root);
    for (const args of [
      ['config', 'user.email', 'test@example.com'],
      ['config', 'user.name', 'Test'],
      ['config', 'commit.gpgsign', 'false'],
    ]) git(args);
    writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\nEvery notable change to this project, newest first.\n');
    writeFileSync(join(root, 'package.json'), '{"name":"wrap-up-base-repo","version":"0.4.0"}\n');
    git(['add', '--all']);
    git(['commit', '-q', '-m', 'first']);
    git(['remote', 'add', 'origin', origin]);
    git(['push', '-q', '-u', 'origin', 'main']);
    git(['branch', BASE]);
    git(['push', '-q', 'origin', BASE]);
    git(['checkout', '-q', '-b', HEAD]);
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  test('names the base in the prompt, writes the release line into the head\'s pull request, and retargets it with one line', async () => {
    const info: string[] = [];
    const warn: string[] = [];
    setActiveOutput(sinkOutput({ info: (line) => { info.push(line); }, warn: (line) => { warn.push(line); } }));
    const git = createGitRunner(root);
    const base = resolveBaseBranch(git, SETTINGS.prBase);
    const fake = createFakePrGh();
    fake.plant({ number: RUN_PR, headRefName: HEAD, baseRefName: 'main', body: RUN_BODY });
    fake.plant({ number: BASE_PR, headRefName: BASE, baseRefName: 'main', body: BASE_BODY });
    const pulls = createGhPullRequests({ gh: fake.run });

    // The prompt, built over the one base the run resolved.
    const prompt = buildWrapUpPrompt(HEAD, base, '# Plan\n');
    expect(base).toBe(BASE);
    expect(prompt).toContain(`gh pr create --base ${BASE}`);
    expect(prompt).not.toContain('--base main');

    // Step 1 and step 3 of the release, as `runWrapUp` runs them around the session.
    const changes: readonly ReportChange[] = [
      { level: 'patch', area: 'loop', summary: 'the wrap-up retargets a pull request', extras: [] },
    ];
    writeChanges(root, {
      dispatch: { sessionId: 'wrap-up-base-session', planStub: PLAN_STUB, taskLine: '- [x] Retarget a pull request' },
      changes,
    });
    const plan = [
      '# Plan: rafa-628 — pr base',
      '',
      '```rafa:plan',
      `stub: ${PLAN_STUB}`,
      'issue: "628"',
      'release: minor',
      '```',
      '',
      '- [x] Retarget a pull request',
    ].join('\n');
    const preparation = prepareReleaseStage({ repoRoot: root, settings: SETTINGS, planStub: PLAN_STUB, planContent: plan });
    if (preparation === null || preparation.kind !== 'prepared') {
      throw new Error(`expected a prepared release, got ${JSON.stringify(preparation)}`);
    }
    const finish = await finishRelease(
      { repoRoot: root, branch: HEAD, settings: SETTINGS, preparation },
      {
        pulls: () => pulls,
        readProvider: () => ({ provider: 'gh', source: 'config', remote: null, host: null }),
        now: () => new Date('2026-10-02T09:00:00Z'),
      },
    );

    expect(finish.outcome).toBe('released');
    expect(finish.body?.number).toBe(RUN_PR);
    expect(fake.pull(RUN_PR)?.body).toStartWith(RUN_BODY);
    expect(fake.pull(RUN_PR)?.body).toContain('Release forecast:');
    // The pull request headed by the base is not the one the line went to.
    expect(fake.pull(BASE_PR)?.body).toBe(BASE_BODY);

    // The delivery finds the session's pull request by the head, and it is retargeted.
    const delivery = await deliverPullRequest(
      { branch: HEAD, retries: 0, previousMessage: 'the session\'s final message' },
      {
        findOpen: (branch) => pulls.findOpen(branch),
        retry: () => Promise.reject(new Error('a delivered pull request spends no retry')),
        openRunnerPullRequest: () => Promise.reject(new Error('a delivered pull request needs no runner')),
        isInterrupted: () => false,
      },
    );
    if (delivery.kind !== 'delivered') throw new Error(`the delivery answered ${delivery.kind}`);
    expect(delivery.pull.number).toBe(RUN_PR);
    expect(delivery.pull.baseRefName).toBe('main');
    const outcome = await retargetPullRequest(delivery.pull, base, { pulls, output: activeOutput() });

    expect(outcome).toEqual({ kind: 'retargeted', from: 'main', to: BASE });
    expect(fake.pull(RUN_PR)?.baseRefName).toBe(BASE);
    expect(fake.pull(BASE_PR)?.baseRefName).toBe('main');
    const baseEdits = fake.calls().filter((call) => call[0] === 'pr' && call[1] === 'edit' && call.includes('--base'));
    expect(baseEdits).toEqual([['pr', 'edit', String(RUN_PR), '--base', BASE]]);
    expect(info.filter((line) => line.includes('Retargeted'))).toEqual([retargetedLine(RUN_PR, 'main', BASE)]);
    expect(warn.filter((line) => line.includes('retarget'))).toEqual([]);
    // Retargeting rewrote the base only: the body the release step wrote stays.
    expect(fake.pull(RUN_PR)?.body).toContain('Release forecast:');
  });
});
