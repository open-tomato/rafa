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
 * reads the real base version off `origin/main`, `release/verify.ts`
 * reads the real files back, and the commit and the push run over the
 * real git history. Only `currentBranch` is fixed to the branch this
 * file checks out, because the real `getCurrentBranch`
 * (`src/utils/git.ts`) reads `process.cwd()` rather than the scratch
 * repository this suite plants. The two body cases name two seams more,
 * the provider and the reading that says there is one, for the reason
 * their own note gives.
 *
 * One scenario: a plan that declares `release: minor` and whose sessions
 * stored two change notes under two different areas. It answers that the
 * version shipped is the base's bumped by the DECLARED level (not by the
 * notes' own, higher claim), that exactly one `chore: release <version>`
 * commit lands over the two release files and nothing else, that it
 * reaches the bare `origin`, and that the new changelog section carries
 * both planted notes' areas above the section that was already there.
 */
import type { GitRunner, PrProviderReading } from '../pr/index.js';
import type { ReleasePreparation, ReleaseSettings } from '../release/prepare.js';
import type { ReportChange } from '../report/parse.js';
import type { ReleaseFinish } from '../start/release-stage.js';

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
const SETTINGS: ReleaseSettings = {
  releaseEnabled: RELEASE_AUTO,
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseHeading: '## {version} — {date}, {title}',
};

/** The plan title the entry's heading is rendered from, `Plan:` label off. */
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

/** A plan declaring `release: none`, the simplest way to reach the provider gate. */
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
 * `repoRoot`, the preparation, the branch and the provider reading off
 * its own argv. Written once under {@link tempBase}, since its content
 * never varies between the two cases that spawn it.
 */
const RUNNER_SCRIPT = join(tempBase, 'gh-stub-runner.ts');
writeFileSync(RUNNER_SCRIPT, [
  `import { finishRelease } from ${JSON.stringify(RELEASE_STAGE_MODULE)};`,
  `import { setActiveOutput } from ${JSON.stringify(OUTPUT_ACTIVE_MODULE)};`,
  `import { sinkOutput } from ${JSON.stringify(OUTPUT_SINKS_MODULE)};`,
  '',
  'const [repoRoot, preparationJson, branch, providerJson] = process.argv.slice(2);',
  'setActiveOutput(sinkOutput({}));',
  'const preparation = JSON.parse(preparationJson);',
  'const provider = JSON.parse(providerJson);',
  '',
  'const finish = await finishRelease(',
  '  { repoRoot, preparation },',
  '  { currentBranch: () => branch, readProvider: () => provider },',
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
    [process.execPath, RUNNER_SCRIPT, repoRoot, JSON.stringify(preparation), branch, JSON.stringify(provider)],
    { env: { PATH: path, HOME: tempBase } },
  );
  if (!run.success) {
    throw new Error(`the subprocess exited ${String(run.exitCode)}: ${run.stderr.toString()}`);
  }
  return JSON.parse(run.stdout.toString()) as ReleaseFinish;
}

describe('the release stage over a scratch repository', () => {
  it(
    'ships the version the base plus the declared level, one release commit, and both planted areas in the new section',
    async () => {
      const scratch = plantScratchRelease('happy-path');
      setActiveOutput(sinkOutput({}));

      const preparation = prepareReleaseStage(
        {
          repoRoot: scratch.repo,
          settings: SETTINGS,
          planStub: PLAN_STUB,
          planContent: PLAN,
        },
        { now: () => new Date('2026-09-20T09:00:00Z') },
      );

      if (preparation === null || preparation.kind !== 'prepared') {
        throw new Error(`expected a prepared release, got ${JSON.stringify(preparation)}`);
      }
      expect(preparation.levelSource).toBe('plan');
      expect(preparation.level).toBe('minor');
      expect(preparation.notesLevel).toBe('major');
      expect(preparation.baseVersion).toBe(BASE_VERSION);
      expect(preparation.version).toBe(VERSION);

      const finish = await finishRelease(
        { repoRoot: scratch.repo, preparation },
        { currentBranch: () => BRANCH },
      );

      expect(finish.outcome).toBe('released');
      expect(finish.version).toBe(VERSION);
      expect(finish.subject).toBe(`chore: release ${VERSION}`);
      expect(finish.sha).not.toBeNull();
      expect(finish.sentence).toBeNull();
      expect(finish.body).toBeNull();

      // Exactly one release commit landed, over the two release files alone.
      const subjects = scratch.git(['log', '--format=%s']).stdout.trim().split('\n');
      expect(subjects).toEqual([`chore: release ${VERSION}`, 'first']);
      const changedFiles = scratch.git(['diff', '--name-only', 'HEAD~1', 'HEAD']).stdout.trim().split('\n')
        .sort();
      expect(changedFiles).toEqual(['CHANGELOG.md', 'package.json']);

      // The version bumped by exactly the declared level, on disk.
      const manifest = JSON.parse(readFileSync(join(scratch.repo, 'package.json'), 'utf8')) as { version: string };
      expect(manifest.version).toBe(VERSION);

      // The new section carries both planted notes' areas, above the
      // section that was already there, which is untouched.
      const changelog = readFileSync(join(scratch.repo, 'CHANGELOG.md'), 'utf8');
      const heading = `## ${VERSION} — 2026-09-20, ${TITLE}`;
      expect(changelog).toContain(heading);
      expect(changelog).toContain('- loop: the wrap-up commits the scratch release end to end');
      expect(changelog).toContain('- cli: rafa release ships a real commit in a scratch repository');
      expect(changelog).toContain(`## ${BASE_VERSION} — 2026-09-19, the one before`);
      expect(changelog.indexOf(heading)).toBeLessThan(changelog.indexOf(`## ${BASE_VERSION}`));

      // Pushed to the bare origin, not merely committed locally.
      const remoteTip = createGitRunner(scratch.origin)(['rev-parse', BRANCH]).stdout.trim();
      expect(remoteTip).toBe(finish.sha);
    },
  );

  /**
   * The two ways a level comes out `none`: `release/level.ts`'s "the
   * declaration wins outright, `none` included" and its "a plan with no
   * notes at all reads as `none` from `default`". Neither writes either
   * release file, and each carries its own sentence — the record's own,
   * per `release/prepare.ts` — into the pull request body, over a real
   * `gh` fake rather than a hand-stubbed provider, so this suite checks
   * the same read-modify-write `carryIntoBody` performs against a real
   * one. Two seams are named for these: the provider the write goes
   * through and the reading that says there is one ({@link GH_READING}).
   */
  it.each([
    [
      'a plan declaring release: none',
      'declares-none',
      [
        `# Plan: ${TITLE}`,
        '',
        '```rafa:plan',
        `stub: ${PLAN_STUB}`,
        'issue: "99"',
        'release: none',
        '```',
        '',
        '- [x] Ship a scratch release end to end',
      ].join('\n'),
      [] as readonly ReportChange[],
      'the plan declares release: none, so this pull request ships no version bump and no changelog entry',
    ],
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
      [] as readonly ReportChange[],
      'this plan stored no change note and declares no release level, so this pull request ships no version bump and no changelog entry',
    ],
  ])('writes neither release file for %s, and carries the sentence into the pull request body', async (
    _label,
    scratchName,
    plan,
    notes,
    sentence,
  ) => {
    const scratch = plantScratchRelease(scratchName, notes);
    setActiveOutput(sinkOutput({}));

    const fakeGh = createFakePrGh();
    fakeGh.plant({ number: 42, headRefName: BRANCH, body: 'What this pull request does.' });

    const preparation = prepareReleaseStage(
      { repoRoot: scratch.repo, settings: SETTINGS, planStub: PLAN_STUB, planContent: plan },
      { now: () => new Date('2026-09-20T09:00:00Z') },
    );

    if (preparation === null || preparation.kind !== 'skipped') {
      throw new Error(`expected a skipped release, got ${JSON.stringify(preparation)}`);
    }
    expect(preparation.sentence).toBe(sentence);

    const finish = await finishRelease(
      { repoRoot: scratch.repo, preparation },
      {
        currentBranch: () => BRANCH,
        pulls: () => createGhPullRequests({ gh: fakeGh.run }),
        readProvider: () => GH_READING,
      },
    );

    expect(finish.outcome).toBe('skipped');
    expect(finish.sentence).toBe(sentence);

    // Neither release file was touched.
    expect(readFileSync(join(scratch.repo, 'CHANGELOG.md'), 'utf8')).toBe(CHANGELOG_BEFORE);
    expect(readFileSync(join(scratch.repo, 'package.json'), 'utf8')).toBe(PACKAGE_JSON_BEFORE);

    // No commit landed beyond the one the scratch repository started with.
    const subjects = scratch.git(['log', '--format=%s']).stdout.trim().split('\n');
    expect(subjects).toEqual(['first']);

    // The sentence reached the real pull request body, under what was there.
    const pull = fakeGh.pull(42);
    expect(pull?.body).toBe(`What this pull request does.\n\n${sentence}`);
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
 * Both cases run the same skipped preparation — a plan declaring
 * `release: none`, prepared once here in this process — through the
 * subprocess script's `finishRelease`, over the real `ghPullRequestsIn`
 * default and the stub's bin directory first on that child's `PATH`.
 */
describe('the release stage provider gate against a real gh stub first on PATH', () => {
  it('spawns no gh at all when the resolved provider is none', () => {
    const scratch = plantScratchRelease('gh-path-stub-none', []);
    setActiveOutput(sinkOutput({}));
    const stub = plantGhStub('none');
    const reading: PrProviderReading = { provider: 'none', source: 'config', remote: null, host: null };

    const preparation = prepareReleaseStage(
      { repoRoot: scratch.repo, settings: SETTINGS, planStub: PLAN_STUB, planContent: DECLARES_NONE_PLAN },
      { now: () => new Date('2026-09-20T09:00:00Z') },
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
      { repoRoot: scratch.repo, settings: SETTINGS, planStub: PLAN_STUB, planContent: DECLARES_NONE_PLAN },
      { now: () => new Date('2026-09-20T09:00:00Z') },
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
