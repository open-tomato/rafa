/**
 * A scratch-repo integration suite for the release stage
 * (`src/start/release-stage.ts`), run end to end.
 *
 * `src/start/release-stage.test.ts` drives the stage through a full stub
 * of its seams — no git, no store, no clock is reached there, by design,
 * so a case pins the ORDER and the ARGV of every effect against a
 * scripted answer. This file is the complementary reading: a real
 * scratch git repository with a bare `origin` beside it, real change
 * notes written through `effort/store/changes.ts`'s `writeChanges` under
 * a plan stub, and every seam left at its default — `release/prepare.ts`
 * reads the real fragments waiting on `origin/main`, `release/verify.ts`
 * reads the real fragment and the real `git status` back, the commit and
 * the push run over the real git history, and the forecast folds over
 * the real base version. The branch this file checks out is handed to
 * the finish on its input, as `runWrapUp` hands it the run's branch. The
 * two body cases name two seams, the provider and the reading that says
 * there is one, for the reason their own note gives.
 *
 * One scenario: a plan that declares `release: minor` and whose sessions
 * stored two change notes under two different areas. It answers that the
 * fragment carries the DECLARED level (not the notes' own, higher claim)
 * and both planted notes' areas, that exactly one `chore: release
 * fragment <plan id>` commit lands over the fragment and nothing else,
 * that the version file and the changelog are untouched, that it reaches
 * the bare `origin`, and that the pull request body gets a forecast of
 * the base bumped by that level, with the level report beside it.
 */
import type { GitRunner, PrProviderReading } from '../pr/index.js';
import type { ReleasePreparation } from '../release/prepare.js';
import type { ReportChange } from '../report/parse.js';
import type { ReleaseFinish, ReleaseStageSettings } from '../start/release-stage.js';

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { RELEASE_AUTO } from '../config-sections.js';
import { writeChanges } from '../effort/store/changes.js';
import { createFakePrGh } from '../pr/gh-fake.js';
import { createGhPullRequests, createGitRunner } from '../pr/index.js';
import { finishRelease, prepareReleaseStage } from '../start/release-stage.js';

import { sinkOutput } from './output-sinks.js';
import { scratchHomeEnv } from './scratch-home-env.js';

/** The branch this suite checks out its release from. */
const BRANCH = 'feat/scratch-release-e2e';

/**
 * The provider reading the body cases run under.
 *
 * A scratch repository's `origin` is a filesystem path, which reads as
 * NOT GitHub (`src/pr/provider.ts`), so the default seam would resolve
 * `none` here and the stage would build no provider at all — which is a
 * reading about this planting, not about the write these cases measure.
 * `source: 'config'` is how a repository whose origin says nothing still
 * gets `gh`, and the remote and host go unread on this path. Whether the
 * reading itself is right is `src/start/release-stage.test.ts`'s
 * question.
 */
const GH_READING: PrProviderReading = { provider: 'gh', source: 'config', remote: null, host: null };

/** The plan stub the planted notes and the release are attributed to. */
const PLAN_STUB = 'rafa-99-scratch-release';

/** The version `origin/main`'s manifest carries before any release runs. */
const BASE_VERSION = '0.4.0';

/** `BASE_VERSION` bumped by the plan's declared `minor` level. */
const VERSION = '0.5.0';

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

/** The same settings with the release turned off: step 1 skips. */
const RELEASE_OFF: ReleaseStageSettings = { ...SETTINGS, releaseEnabled: false };

/** The fragment the plan's wrap-up writes, relative to the repository root. */
const FRAGMENT_PATH = `.changes/${PLAN_STUB}.md`;

/** The plan title the fragment's `title` is written from, `Plan:` label off. */
const TITLE = 'rafa-99 — a scratch release run end to end';

/** A plan the way the loop writes one, declaring the level outright. */
const PLAN = [
  `# Plan: ${TITLE}`,
  '',
  '```rafa:plan',
  `stub: ${PLAN_STUB}`,
  'issue: "99"',
  'release: minor',
  '```',
  '',
  '- [x] Ship a scratch release end to end',
].join('\n');

/**
 * Two change notes under two areas, at levels ABOVE the plan's own
 * `minor` declaration. The scenario ships `minor` regardless, which is
 * `release/level.ts`'s rule that a plan's own level wins outright.
 */
const NOTES: readonly ReportChange[] = [
  { level: 'patch', area: 'loop', summary: 'the wrap-up commits the scratch release end to end', extras: [] },
  { level: 'major', area: 'cli', summary: 'rafa release ships a real commit in a scratch repository', extras: [] },
];

/** The changelog on `BRANCH` before the release stage touches it. */
const CHANGELOG_BEFORE = [
  '# Changelog',
  '',
  'Every notable change to this project, newest first.',
  '',
  `## ${BASE_VERSION} — 2026-09-19, the one before`,
  '',
  '- loop: the loop learned to stop',
  '',
].join('\n');

/** The manifest on `BRANCH` before the release stage touches it. */
const PACKAGE_JSON_BEFORE = `{"name":"scratch-release-repo","version":"${BASE_VERSION}"}\n`;

/** A temporary directory this file's own scratch repositories sit under. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-stage-integration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

afterEach(() => {
  setActiveOutput(null);
});

/** A scratch repository this suite ran the release stage against. */
interface ScratchRelease {
  /** The working checkout `BRANCH` is made in, and the release runs over. */
  readonly repo: string;
  /** The bare repository standing in for `origin`. */
  readonly origin: string;
  /** A runner made for {@link ScratchRelease.repo}. */
  readonly git: GitRunner;
}

/**
 * Plants a repository with one commit on `main` carrying
 * {@link BASE_VERSION}, a bare `origin` it is pushed to, `BRANCH` checked
 * out from it, and `notes` stored under {@link PLAN_STUB} through the
 * real effort store — exactly as a plan's task sessions would leave them
 * for the wrap-up to read back. An empty `notes` never calls the store
 * at all, which is what a plan whose run stored no change note looks
 * like on disk.
 */
function plantScratchRelease(name: string, notes: readonly ReportChange[] = NOTES): ScratchRelease {
  const root = join(tempBase, name);
  const origin = join(root, 'origin.git');
  const repo = join(root, 'repo');
  mkdirSync(root, { recursive: true });

  const outside = createGitRunner(tempBase);
  outside(['init', '--quiet', '--bare', '--initial-branch=main', origin]);
  outside(['init', '--quiet', '--initial-branch=main', repo]);

  const git = createGitRunner(repo);
  git(['config', 'user.email', 'rafa@example.test']);
  git(['config', 'user.name', 'rafa test']);
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(repo, 'CHANGELOG.md'), CHANGELOG_BEFORE, 'utf8');
  writeFileSync(join(repo, 'package.json'), PACKAGE_JSON_BEFORE, 'utf8');
  git(['add', '--all']);
  git(['commit', '--quiet', '--message', 'first']);
  git(['remote', 'add', 'origin', origin]);
  git(['push', '--quiet', '-u', 'origin', 'main']);
  git(['checkout', '--quiet', '-b', BRANCH]);

  if (notes.length > 0) {
    writeChanges(repo, {
      dispatch: { sessionId: 'scratch-session-1', planStub: PLAN_STUB, taskLine: '- [x] Ship a scratch release end to end' },
      changes: notes,
    });
  }

  return { repo, origin, git };
}

/**
 * Plants a `gh` first on `PATH`: an executable that appends the
 * arguments of every invocation to a file, one line per call, and exits
 * nonzero regardless of what it was asked. Every real caller of `gh` in
 * this repository — `createGhRunner`, `./gh.ts`'s module note — spawns
 * the bare name and lets it resolve on `PATH`, so this is the one lever
 * that tells whether the release stage's `none` gate reached for `gh`
 * at all, rather than reaching for it and having it fail.
 */
function plantGhStub(name: string): { readonly binDir: string; readonly recordFile: string } {
  const binDir = join(tempBase, `${name}-bin`);
  const recordFile = join(tempBase, `${name}-gh-calls.log`);
  mkdirSync(binDir, { recursive: true });
  const script = join(binDir, 'gh');
  writeFileSync(script, ['#!/bin/sh', `echo "$@" >> '${recordFile}'`, 'exit 7', ''].join('\n'), 'utf8');
  chmodSync(script, 0o755);
  return { binDir, recordFile };
}

/** `path`'s non-blank lines, or none at all when nothing was ever written there. */
function linesAt(path: string): readonly string[] {
  try {
    return readFileSync(path, 'utf8').split('\n')
      .filter((line) => line !== '');
  } catch {
    return [];
  }
}

/** A plan declaring `release: none`, which writes a `none` fragment. */
const DECLARES_NONE_PLAN = [
  `# Plan: ${TITLE}`,
  '',
  '```rafa:plan',
  `stub: ${PLAN_STUB}`,
  'issue: "99"',
  'release: none',
  '```',
  '',
  '- [x] Ship a scratch release end to end',
].join('\n');

/** The two system directories `/usr/bin` and `/bin` sit under, joined for `PATH`. */
const SYSTEM_PATH = ['/usr/bin', '/bin'].join(delimiter);

/**
 * The real modules the subprocess script below imports into, computed
 * from this file's own URL rather than from `process.cwd()`, since the
 * script it writes sits outside this repository's own tree.
 */
const RELEASE_STAGE_MODULE = fileURLToPath(new URL('../start/release-stage.ts', import.meta.url));
const OUTPUT_ACTIVE_MODULE = fileURLToPath(new URL('../adapters/output/active.ts', import.meta.url));
const OUTPUT_SINKS_MODULE = fileURLToPath(new URL('./output-sinks.ts', import.meta.url));

/**
 * A standalone script that calls the real `finishRelease` and prints the
 * `ReleaseFinish` it answered as its only line of stdout, reading
 * `repoRoot`, the settings, the preparation, the branch and the provider
 * reading off its own argv. Written once under {@link tempBase}, since its content
 * never varies between the two cases that spawn it.
 */
const RUNNER_SCRIPT = join(tempBase, 'gh-stub-runner.ts');
writeFileSync(RUNNER_SCRIPT, [
  `import { finishRelease } from ${JSON.stringify(RELEASE_STAGE_MODULE)};`,
  `import { setActiveOutput } from ${JSON.stringify(OUTPUT_ACTIVE_MODULE)};`,
  `import { sinkOutput } from ${JSON.stringify(OUTPUT_SINKS_MODULE)};`,
  '',
  'const [repoRoot, settingsJson, preparationJson, branch, providerJson] = process.argv.slice(2);',
  'setActiveOutput(sinkOutput({}));',
  'const settings = JSON.parse(settingsJson);',
  'const preparation = JSON.parse(preparationJson);',
  'const provider = JSON.parse(providerJson);',
  '',
  'const finish = await finishRelease(',
  '  { repoRoot, branch, settings, preparation },',
  '  { readProvider: () => provider },',
  ');',
  '',
  'process.stdout.write(JSON.stringify(finish));',
  '',
].join('\n'), 'utf8');

/**
 * Runs {@link RUNNER_SCRIPT} in a FRESH process over `preparation`,
 * `branch` and `provider`, with `path` as its whole `PATH`.
 *
 * A fresh process, and not this file's own, because a spawned `gh`
 * resolves against the environment ITS OWN process started with:
 * mutating `process.env.PATH` after this process has already started
 * changes nothing about what a later `Bun.spawn(['gh', …])` resolves the
 * name to, measured on bun 1.3.14 — the child keeps the `PATH` this
 * process was born with, whatever `process.env.PATH` reads by the time
 * of the call. Handing `env` explicitly to the SPAWN of that child,
 * rather than to a mutation of this one, is what actually lands a `PATH`
 * a nested `gh` spawn honours.
 */
function runFinishInSubprocess(
  repoRoot: string,
  preparation: ReleasePreparation,
  branch: string,
  provider: PrProviderReading,
  path: string,
): ReleaseFinish {
  const run = Bun.spawnSync(
    [
      process.execPath,
      RUNNER_SCRIPT,
      repoRoot,
      JSON.stringify(RELEASE_OFF),
      JSON.stringify(preparation),
      branch,
      JSON.stringify(provider),
    ],
    { env: { TMPDIR: tmpdir(), PATH: path, ...scratchHomeEnv(tempBase) } },
  );
  if (!run.success) {
    throw new Error(`the subprocess exited ${String(run.exitCode)}: ${run.stderr.toString()}`);
  }
  return JSON.parse(run.stdout.toString()) as ReleaseFinish;
}

/** The planted pull request's body before the release stage writes to it. */
const BODY_BEFORE = 'What this pull request does.';

/** The pull request number the fake `gh` plants for {@link BRANCH}. */
const PR_NUMBER = 42;

describe('the release stage over a scratch repository', () => {
  it(
    'commits one fragment at the declared level with both planted areas, leaves the version file and changelog alone, and forecasts the bump in the body',
    async () => {
      const scratch = plantScratchRelease('happy-path');
      setActiveOutput(sinkOutput({}));
      const fakeGh = createFakePrGh();
      fakeGh.plant({ number: PR_NUMBER, headRefName: BRANCH, body: BODY_BEFORE });

      const preparation = prepareReleaseStage({
        repoRoot: scratch.repo,
        settings: SETTINGS,
        planStub: PLAN_STUB,
        planContent: PLAN,
      });

      if (preparation === null || preparation.kind !== 'prepared') {
        throw new Error(`expected a prepared release, got ${JSON.stringify(preparation)}`);
      }
      expect(preparation.levelSource).toBe('plan');
      expect(preparation.level).toBe('minor');
      expect(preparation.notesLevel).toBe('major');
      expect(preparation.file.path).toBe(FRAGMENT_PATH);

      const finish = await finishRelease(
        { repoRoot: scratch.repo, branch: BRANCH, settings: SETTINGS, preparation },
        {
          pulls: () => createGhPullRequests({ gh: fakeGh.run }),
          readProvider: () => GH_READING,
          now: () => new Date('2026-09-20T09:00:00Z'),
        },
      );

      expect(finish.outcome).toBe('released');
      expect(finish.fragment).toBe(FRAGMENT_PATH);
      expect(finish.subject).toBe(`chore: release fragment ${PLAN_STUB}`);
      expect(finish.sha).not.toBeNull();
      expect(finish.sentence).toBeNull();

      // Exactly one release commit landed, over the fragment alone.
      const subjects = scratch.git(['log', '--format=%s']).stdout.trim().split('\n');
      expect(subjects).toEqual([`chore: release fragment ${PLAN_STUB}`, 'first']);
      const changedFiles = scratch.git(['diff', '--name-only', 'HEAD~1', 'HEAD']).stdout.trim().split('\n');
      expect(changedFiles).toEqual([FRAGMENT_PATH]);

      // No branch owns a version: both release files are as they were.
      expect(readFileSync(join(scratch.repo, 'package.json'), 'utf8')).toBe(PACKAGE_JSON_BEFORE);
      expect(readFileSync(join(scratch.repo, 'CHANGELOG.md'), 'utf8')).toBe(CHANGELOG_BEFORE);

      // The fragment carries the declared level and both planted areas.
      const fragment = readFileSync(join(scratch.repo, FRAGMENT_PATH), 'utf8');
      expect(fragment).toContain(`plan: ${PLAN_STUB}`);
      expect(fragment).toContain('level: minor');
      expect(fragment).toContain('- loop: the wrap-up commits the scratch release end to end');
      expect(fragment).toContain('- cli: rafa release ships a real commit in a scratch repository');

      // Pushed to the bare origin, not merely committed locally.
      const remoteTip = createGitRunner(scratch.origin)(['rev-parse', BRANCH]).stdout.trim();
      expect(remoteTip).toBe(finish.sha);

      // The body gained the forecast, folded over the real base version,
      // and the level report, since the notes reach major.
      expect(finish.forecast?.ok && finish.forecast.baseVersion).toBe(BASE_VERSION);
      const body = fakeGh.pull(PR_NUMBER)?.body ?? '';
      expect(body.startsWith(`${BODY_BEFORE}\n\n<!-- rafa:release v1 base=${BASE_VERSION} waiting= -->`)).toBe(true);
      expect(body).toContain(`Release forecast: this branch ships as the next minor, ${VERSION} if merged now`);
      expect(body).toContain('Level report: the plan declares release: minor, below the major its change notes reach');
    },
  );

  /**
   * The two ways a level comes out `none`: `release/level.ts`'s "the
   * declaration wins outright, `none` included" and its "a plan with no
   * notes at all reads as `none` from `default`". Each now WRITES a
   * `none` fragment and commits it, so a missing fragment and "no
   * release" stay two readings, and neither touches either release
   * file. The body is written over a real `gh` fake rather than a
   * hand-stubbed provider, so this suite checks the same
   * read-modify-write the stage performs against a real one.
   */
  it.each([
    ['a plan declaring release: none', 'declares-none', DECLARES_NONE_PLAN, 'plan'],
    [
      'a plan whose run stored no change note',
      'no-change-note',
      [
        `# Plan: ${TITLE}`,
        '',
        '```rafa:plan',
        `stub: ${PLAN_STUB}`,
        'issue: "99"',
        '```',
        '',
        '- [x] Ship a scratch release end to end',
      ].join('\n'),
      'default',
    ],
  ])('commits a none fragment for %s, leaves both release files alone, and forecasts no release', async (
    _label,
    scratchName,
    plan,
    source,
  ) => {
    const scratch = plantScratchRelease(scratchName, []);
    setActiveOutput(sinkOutput({}));
    const fakeGh = createFakePrGh();
    fakeGh.plant({ number: PR_NUMBER, headRefName: BRANCH, body: BODY_BEFORE });

    const preparation = prepareReleaseStage({ repoRoot: scratch.repo, settings: SETTINGS, planStub: PLAN_STUB, planContent: plan });

    if (preparation === null || preparation.kind !== 'prepared') {
      throw new Error(`expected a prepared release, got ${JSON.stringify(preparation)}`);
    }
    expect(preparation.level).toBe('none');
    expect(preparation.levelSource).toBe(source);

    const finish = await finishRelease(
      { repoRoot: scratch.repo, branch: BRANCH, settings: SETTINGS, preparation },
      {
        pulls: () => createGhPullRequests({ gh: fakeGh.run }),
        readProvider: () => GH_READING,
      },
    );

    expect(finish.outcome).toBe('released');
    expect(readFileSync(join(scratch.repo, FRAGMENT_PATH), 'utf8')).toContain('level: none');
    expect(readFileSync(join(scratch.repo, 'CHANGELOG.md'), 'utf8')).toBe(CHANGELOG_BEFORE);
    expect(readFileSync(join(scratch.repo, 'package.json'), 'utf8')).toBe(PACKAGE_JSON_BEFORE);
    const subjects = scratch.git(['log', '--format=%s']).stdout.trim().split('\n');
    expect(subjects).toEqual([`chore: release fragment ${PLAN_STUB}`, 'first']);
    expect(fakeGh.pull(PR_NUMBER)?.body).toContain('Release forecast: this branch ships no release (level none)');
  });

  it('writes no fragment when the release is off, and carries the sentence into the pull request body', async () => {
    const scratch = plantScratchRelease('release-off');
    setActiveOutput(sinkOutput({}));
    const fakeGh = createFakePrGh();
    fakeGh.plant({ number: PR_NUMBER, headRefName: BRANCH, body: BODY_BEFORE });
    const sentence = 'no release fragment: release.enabled is false in this project';

    const preparation = prepareReleaseStage({ repoRoot: scratch.repo, settings: RELEASE_OFF, planStub: PLAN_STUB, planContent: PLAN });

    if (preparation === null || preparation.kind !== 'skipped') {
      throw new Error(`expected a skipped release, got ${JSON.stringify(preparation)}`);
    }
    expect(preparation.sentence).toBe(sentence);

    const finish = await finishRelease(
      { repoRoot: scratch.repo, branch: BRANCH, settings: RELEASE_OFF, preparation },
      {
        pulls: () => createGhPullRequests({ gh: fakeGh.run }),
        readProvider: () => GH_READING,
      },
    );

    expect(finish.outcome).toBe('skipped');
    const subjects = scratch.git(['log', '--format=%s']).stdout.trim().split('\n');
    expect(subjects).toEqual(['first']);
    // The level report rides along: the plan declares minor, its notes reach major.
    expect(fakeGh.pull(PR_NUMBER)?.body).toBe(
      `${BODY_BEFORE}\n\n${sentence}\n\n<!-- rafa:release v1 -->\n`
        + 'Level report: the plan declares release: minor, below the major its change notes reach;'
        + ' the declaration stands, so this pull request ships as minor\n<!-- /rafa:release -->',
    );
  });
});

/**
 * The provider gate (`src/start/release-stage.ts`'s module note, "Which
 * provider is asked") against a REAL `gh`, rather than the scripted or
 * faked one every other case in this file drives it through: a `gh`
 * stub first on the `PATH` a FRESH process is born with, over
 * {@link runFinishInSubprocess}. A `none` reading is read BEFORE the
 * provider is built, so a repository resolving to `none` must spawn no
 * `gh` at all — a claim a fully stubbed `pulls` cannot make, since it
 * never reaches for the real spawn in the first place. {@link plantGhStub}
 * is what lets this file measure that against the one thing `gh` could
 * actually do: get invoked.
 *
 * Both cases run the same skipped preparation — a release turned off
 * by `release.enabled: false`, prepared once here in this process, since
 * a `release: none` plan now writes a fragment rather than skipping —
 * through the subprocess script's `finishRelease`, over the real
 * `ghPullRequestsIn` default and the stub's bin directory first on that
 * child's `PATH`.
 */
describe('the release stage provider gate against a real gh stub first on PATH', () => {
  it('spawns no gh at all when the resolved provider is none', () => {
    const scratch = plantScratchRelease('gh-path-stub-none', []);
    setActiveOutput(sinkOutput({}));
    const stub = plantGhStub('none');
    const reading: PrProviderReading = { provider: 'none', source: 'config', remote: null, host: null };

    const preparation = prepareReleaseStage(
      { repoRoot: scratch.repo, settings: RELEASE_OFF, planStub: PLAN_STUB, planContent: DECLARES_NONE_PLAN },
    );
    if (preparation === null || preparation.kind !== 'skipped') {
      throw new Error(`expected a skipped release, got ${JSON.stringify(preparation)}`);
    }

    const path = [stub.binDir, SYSTEM_PATH].join(delimiter);
    const finish = runFinishInSubprocess(scratch.repo, preparation, BRANCH, reading, path);

    expect(finish.outcome).toBe('skipped');
    expect(finish.body?.carried).toBe(false);
    expect(finish.body?.problem).toContain('pr.provider: none');
    // The stub recorded no invocation at all: the gate never reached for it.
    expect(linesAt(stub.recordFile)).toEqual([]);
  });

  it('sends the stub exactly one invocation when the resolved provider is gh, which is the control', () => {
    const scratch = plantScratchRelease('gh-path-stub-gh', []);
    setActiveOutput(sinkOutput({}));
    const stub = plantGhStub('gh');
    const reading: PrProviderReading = { provider: 'gh', source: 'config', remote: null, host: null };

    const preparation = prepareReleaseStage(
      { repoRoot: scratch.repo, settings: RELEASE_OFF, planStub: PLAN_STUB, planContent: DECLARES_NONE_PLAN },
    );
    if (preparation === null || preparation.kind !== 'skipped') {
      throw new Error(`expected a skipped release, got ${JSON.stringify(preparation)}`);
    }

    const path = [stub.binDir, SYSTEM_PATH].join(delimiter);
    const finish = runFinishInSubprocess(scratch.repo, preparation, BRANCH, reading, path);

    expect(finish.outcome).toBe('skipped');
    // The real gh failed, so the sentence reached no body — but it was
    // asked, unlike the `none` case above.
    expect(finish.body?.carried).toBe(false);
    expect(finish.body?.problem).toContain('could not be written');
    expect(linesAt(stub.recordFile)).toHaveLength(1);
    expect(linesAt(stub.recordFile)[0]).toContain('list');
  });
});
