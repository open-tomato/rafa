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
 * repository this suite plants.
 *
 * One scenario: a plan that declares `release: minor` and whose sessions
 * stored two change notes under two different areas. It answers that the
 * version shipped is the base's bumped by the DECLARED level (not by the
 * notes' own, higher claim), that exactly one `chore: release <version>`
 * commit lands over the two release files and nothing else, that it
 * reaches the bare `origin`, and that the new changelog section carries
 * both planted notes' areas above the section that was already there.
 */
import type { GitRunner } from '../pr/index.js';
import type { ReleaseSettings } from '../release/prepare.js';
import type { ReportChange } from '../report/parse.js';

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { RELEASE_AUTO } from '../config-sections.js';
import { writeChanges } from '../effort/store/changes.js';
import { createGitRunner } from '../pr/index.js';
import { finishRelease, prepareReleaseStage } from '../start/release-stage.js';

import { sinkOutput } from './output-sinks.js';

/** The branch this suite checks out its release from. */
const BRANCH = 'feat/scratch-release-e2e';

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
 * out from it, and the two {@link NOTES} stored under {@link PLAN_STUB}
 * through the real effort store — exactly as a plan's task sessions
 * would leave them for the wrap-up to read back.
 */
function plantScratchRelease(name: string): ScratchRelease {
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

  writeChanges(repo, {
    dispatch: { sessionId: 'scratch-session-1', planStub: PLAN_STUB, taskLine: '- [x] Ship a scratch release end to end' },
    changes: NOTES,
  });

  return { repo, origin, git };
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
});
