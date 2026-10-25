/**
 * Tests for `rafa release settle [--dry-run]` (`settle.ts`): the lines a
 * reading and a delivery render, the exit code each outcome ends on,
 * and the command dispatched over real repositories — a bare origin, a
 * clone that lands commits on `main` as merges would, and the caller's
 * clone on a feature branch with work in flight, which is the project
 * the command runs in.
 *
 * The rendering cases drive `settledResult` from literals for the
 * outcomes a real repository cannot be made to answer on demand (a
 * protected base, a tag that failed after a push that landed); the
 * dispatch cases read git's own state after the run rather than the
 * command's word for it. Two controls keep a green reading honest: the
 * dry run's clean `git status` is paired with the same probe seeing the
 * caller's own edit, and the refused `pr` delivery is paired with the
 * same world reaching the double when the remote reads as GitHub.
 *
 * The project refresh (`./settle-project.ts`) is read here only as the
 * command's wiring: with `board.project.number` set, a push hands it the
 * commits that really added the fragments on origin, and its lines come
 * out as warnings with exit 0. Its controls are the same push with the
 * number unset and a dry run with it set, each opening no `gh` runner.
 */
import type { ReleaseSettleSeams } from './settle.js';
import type { PullRequestDraft, PullRequestSummary } from '../../pr/index.js';
import type { SettleDelivered, SettleTagOutcome } from '../../release/settle-tag.js';
import type { SettleBuilt, SettleFolded, SettleFragment, SettleUnitFold } from '../../release/settle.js';
import type { PlantedProject } from '../../tests/cli-capture.js';
import type { RafaCommand } from '@open-tomato/rafa/core/command';
import type { Fragment } from '@open-tomato/rafa/release/fragment';
import type { GhRunner } from '@open-tomato/rafa-board/adapters/tracker/github';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { serializeFragment } from '@open-tomato/rafa/release/fragment';

import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import { projectConfigText } from '../../project/scaffold.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';
import { gitIdentityEnv } from '../../tests/git-identity.js';

import { createReleaseSettleCommand, dryRunResult, settledResult } from './settle.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-settle-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The one subject the dispatch cases register. */
const SUBJECTS = [{ name: 'release', summary: 'releases' }];

/** The manifest on `main`. */
const MANIFEST = '{\n\t"name": "demo",\n\t"version": "0.4.0"\n}\n';

/** The changelog on `main`. */
const CHANGELOG = '# Changelog\n\n## 0.4.0 — 2026-08-01, older\n\n- Loop: old line\n';

/** The committer date every setup commit gets. */
const SETUP_DATE = '2026-09-01T12:00:00Z';

/** A remote `resolvePrProvider` reads as GitHub. */
const GITHUB_REMOTE = 'https://github.com/open-tomato/demo.git';

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
function fragmentText(plan: string, level: Fragment['level'], notes: readonly string[] = ['- Loop: a line']): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level, package: null, notes });
}

/** A bare origin, a clone that lands commits on `main`, and the caller's clone as a project. */
interface World {
  readonly origin: string;
  readonly project: PlantedProject;
  readonly scratchRoot: string;
  /** Runs git in `cwd` under the isolated environment, answering stdout trimmed. */
  readonly git: (cwd: string, args: readonly string[]) => string;
  /** Writes each path in the other clone, commits and pushes `main`. */
  readonly land: (files: Readonly<Record<string, string>>, message: string) => void;
}

/**
 * Builds a {@link World} whose caller holds `.rafa/config.yaml` with
 * `extra` appended; `main` holds no changelog when `changelog` is false.
 */
function world(extra = '', changelog = true): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const origin = join(dir, 'origin.git');
  const caller = join(dir, 'caller');
  const other = join(dir, 'other');
  const scratchRoot = join(dir, 'scratch');
  for (const path of [home, scratchRoot]) mkdirSync(path, { recursive: true });
  const git = (cwd: string, args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8', env: isolatedEnv(home), stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const land = (files: Readonly<Record<string, string>>, message: string): void => {
    git(other, ['pull', '-q', '--ff-only', 'origin', 'main']);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(other, path)), { recursive: true });
      writeFileSync(join(other, path), text);
    }
    git(other, ['add', '-A']);
    git(other, ['commit', '-q', '-m', message]);
    git(other, ['push', '-q', 'origin', 'main']);
  };

  git(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(dir, ['clone', '-q', origin, other]);
  writeFileSync(join(other, 'package.json'), MANIFEST);
  if (changelog) writeFileSync(join(other, 'CHANGELOG.md'), CHANGELOG);
  git(other, ['add', '-A']);
  git(other, ['commit', '-q', '-m', 'first']);
  git(other, ['push', '-q', 'origin', 'main']);

  git(dir, ['clone', '-q', origin, caller]);
  const settings: readonly (readonly [string, string])[] = [['user.name', 'rafa settle'], ['user.email', 'settle@example.invalid'], ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false'], ['core.hooksPath', join(dir, 'no-hooks')]];
  for (const [key, value] of settings) {
    git(caller, ['config', key, value]);
  }
  git(caller, ['switch', '-q', '-c', 'feat']);
  writeFileSync(join(caller, 'package.json'), `${MANIFEST}work in flight\n`);
  plantProjectConfig(caller, `${projectConfigText()}${extra}`);
  return { origin, project: { root: caller, home }, scratchRoot, git, land };
}

/** Lands `rafa-9` (minor) and then `rafa-1` (patch). */
function landTwo(w: World): void {
  w.land({ '.changes/rafa-9.md': fragmentText('rafa-9', 'minor') }, 'merge rafa-9');
  w.land({ '.changes/rafa-1.md': fragmentText('rafa-1', 'patch') }, 'merge rafa-1');
}

/** Dispatches `rafa release settle` with `words` in the world's caller. */
async function settle(
  w: World,
  words: readonly string[] = [],
  seams: ReleaseSettleSeams = {},
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const command: RafaCommand = createReleaseSettleCommand({ scratchRoot: w.scratchRoot, ...seams });
  return dispatchInProject(['release', 'settle', ...words], SUBJECTS, [command], w.project);
}

/** Origin's `main` subject. */
function originSubject(w: World, ref = 'main'): string {
  return w.git(w.origin, ['log', '-1', '--format=%s', ref]);
}

/** The files origin's `main` holds under `.changes/`. */
function originFragments(w: World): string[] {
  const listed = w.git(w.origin, ['ls-tree', '--name-only', 'main', '.changes/']);
  return listed === ''
    ? []
    : listed.split('\n');
}

/** The one fragment the literal settles fold. */
const FRAGMENT: SettleFragment = {
  id: 'rafa-9',
  path: '.changes/rafa-9.md',
  commit: 'b'.repeat(40),
  addedOn: '2026-09-01',
  fragment: { plan: 'rafa-9', title: 'title of rafa-9', level: 'minor', package: null, notes: ['- Loop: a line'] },
};

/** The root's unit the literal settles fold, with `changelogMissing` as given. */
function rootUnit(changelogMissing = false): SettleUnitFold {
  return {
    package: null,
    dir: '.',
    versionFile: 'package.json',
    changelog: 'CHANGELOG.md',
    baseVersion: '0.4.0',
    version: '0.5.0',
    section: '## 0.5.0',
    changelogMissing,
    fragments: [FRAGMENT],
  };
}

/** A built settle, as `settledResult` is handed one. */
function built(): SettleBuilt {
  return {
    outcome: 'built',
    strategy: 'semver-by-level',
    commit: 'a'.repeat(40),
    baseVersion: '0.4.0',
    fragments: [FRAGMENT],
    units: [rootUnit()],
    release: 'c'.repeat(40),
    deleted: [{ package: null, paths: ['.changes/rafa-9.md'] }],
    insertPoints: [{ package: null, changelog: 'CHANGELOG.md', point: 'before-next-heading' }],
    createdChangelog: [],
    lock: null,
  };
}

/** A folded reading, as `dryRunResult` is handed one, with `lock` as given. */
function folded(lock: SettleFolded['lock']): SettleFolded {
  const { strategy, commit, baseVersion, fragments, units } = built();
  return { outcome: 'folded', strategy, commit, baseVersion, fragments, units, lock };
}

/** The plugin's fragment the two-unit literal folds. */
const PLUGIN_FRAGMENT: SettleFragment = {
  id: 'rafa-7',
  path: '.changes/rafa-7.md',
  commit: 'e'.repeat(40),
  addedOn: '2026-09-02',
  fragment: { plan: 'rafa-7', title: 'title of rafa-7', level: 'minor', package: '@scope/plugin', notes: ['- Plugin: a hook'] },
};

/** The plugin's unit the two-unit literal folds, with `changelogMissing` as given. */
function pluginUnit(changelogMissing = false): SettleUnitFold {
  return {
    package: '@scope/plugin',
    dir: 'packages/plugin',
    versionFile: 'packages/plugin/package.json',
    changelog: 'packages/plugin/CHANGELOG.md',
    baseVersion: '0.1.0',
    version: '0.2.0',
    section: '## 0.2.0',
    changelogMissing,
    fragments: [PLUGIN_FRAGMENT],
  };
}

/** A built settle moving the root and `@scope/plugin` in one commit, the plugin's changelog created. */
function builtBoth(): SettleBuilt {
  return {
    ...built(),
    fragments: [FRAGMENT, PLUGIN_FRAGMENT],
    units: [rootUnit(), pluginUnit(true)],
    deleted: [{ package: null, paths: [FRAGMENT.path] }, { package: '@scope/plugin', paths: [PLUGIN_FRAGMENT.path] }],
    insertPoints: [
      { package: null, changelog: 'CHANGELOG.md', point: 'before-next-heading' },
      { package: '@scope/plugin', changelog: 'packages/plugin/CHANGELOG.md', point: 'file-end' },
    ],
    createdChangelog: ['packages/plugin/CHANGELOG.md'],
  };
}

/** A tag step that was not meant to write. */
const NO_TAG: SettleTagOutcome = { outcome: 'skipped', exitCode: 0, reason: 'manual', sentence: null };

describe('settledResult, the outcomes rendered from literals', () => {
  it('names the strategy, the base, each fragment with its level, title and add commit, and the version', () => {
    const delivered: SettleDelivered = { delivery: 'push', outcome: { outcome: 'pushed', exitCode: 0, attempts: 1, build: built() } };

    const result = settledResult(delivered, NO_TAG, 'origin/main', 'main');

    expect(result.exitCode).toBe(0);
    expect(result.problem).toBeNull();
    expect(result.lines).toEqual([
      'Strategy: semver-by-level',
      'Base: origin/main at aaaaaaaaaaaa, version 0.4.0',
      'Fragments, in the order the base received them:',
      '  1. .changes/rafa-9.md — minor, "title of rafa-9", added 2026-09-01 in bbbbbbbbbbbb',
      'Version: 0.4.0 → 0.5.0',
      '✅ Pushed "chore: release 0.5.0" (cccccccccccc) to main.',
    ]);
  });

  it('names a changelog the release commit created, above the push line', () => {
    const build: SettleBuilt = { ...built(), units: [rootUnit(true)], insertPoints: [{ package: null, changelog: 'CHANGELOG.md', point: 'file-end' }], createdChangelog: ['CHANGELOG.md'] };
    const delivered: SettleDelivered = { delivery: 'push', outcome: { outcome: 'pushed', exitCode: 0, attempts: 1, build } };

    const result = settledResult(delivered, NO_TAG, 'origin/main', 'main');

    expect(result.lines.slice(-2)).toEqual([
      'Changelog: CHANGELOG.md is missing, so the release commit creates it under "# Changelog".',
      '✅ Pushed "chore: release 0.5.0" (cccccccccccc) to main.',
    ]);
    // The control: the same rendering of a build that inserted names no changelog.
    const inserted = settledResult({ delivery: 'push', outcome: { outcome: 'pushed', exitCode: 0, attempts: 1, build: built() } }, NO_TAG, 'origin/main', 'main');
    expect(inserted.lines.some((line) => line.startsWith('Changelog:'))).toBe(false);
  });

  it('names no created changelog when the push was refused, since nothing landed', () => {
    const build: SettleBuilt = { ...built(), units: [rootUnit(true)], insertPoints: [{ package: null, changelog: 'CHANGELOG.md', point: 'file-end' }], createdChangelog: ['CHANGELOG.md'] };
    const delivered: SettleDelivered = { delivery: 'push', outcome: { outcome: 'protected', exitCode: 1, attempts: 1, build, sentence: 'main is protected' } };

    const result = settledResult(delivered, NO_TAG, 'origin/main', 'main');

    expect(result.exitCode).toBe(1);
    expect(result.lines.some((line) => line.startsWith('Changelog:'))).toBe(false);
  });

  it('says a push was retried once after a rebuild', () => {
    const delivered: SettleDelivered = { delivery: 'push', outcome: { outcome: 'pushed', exitCode: 0, attempts: 2, build: built() } };

    const result = settledResult(delivered, NO_TAG, 'origin/main', 'main');

    expect(result.lines.at(-1)).toContain('after one rebuild over a base that moved');
  });

  it('exits 1 on a protected base with the sentence naming release.settle: pr as the refusal, the reading still printed', () => {
    const sentence = 'main is a protected branch and refused the push; set release.settle: pr';
    const delivered: SettleDelivered = { delivery: 'push', outcome: { outcome: 'protected', exitCode: 1, attempts: 1, build: built(), sentence } };

    const result = settledResult(delivered, NO_TAG, 'origin/main', 'main');

    expect(result.exitCode).toBe(1);
    expect(result.problem).toBe(`❌ ${sentence}`);
    expect(result.lines.at(-1)).toBe('Version: 0.4.0 → 0.5.0');
  });

  it('exits 1 when the tag failed after a push that landed, keeping the push line', () => {
    const delivered: SettleDelivered = { delivery: 'push', outcome: { outcome: 'pushed', exitCode: 0, attempts: 1, build: built() } };
    const tag: SettleTagOutcome = { outcome: 'failed', exitCode: 1, tag: 'v0.5.0', commit: 'c'.repeat(40), written: true, tags: [], sentence: 'v0.5.0 could not be pushed' };

    const result = settledResult(delivered, tag, 'origin/main', 'main');

    expect(result.exitCode).toBe(1);
    expect(result.problem).toBe('❌ v0.5.0 could not be pushed');
    expect(result.lines.at(-1)).toContain('✅ Pushed');
  });

  it('exits 0 when another settle released the same fragments, naming it', () => {
    const delivered: SettleDelivered = {
      delivery: 'push',
      outcome: { outcome: 'superseded', exitCode: 0, attempts: 1, build: built(), base: 'd'.repeat(40), winner: null, sentence: 'another settle released them' },
    };

    const result = settledResult(delivered, NO_TAG, 'origin/main', 'main');

    expect(result.exitCode).toBe(0);
    expect(result.lines.at(-1)).toBe('✅ another settle released them');
  });

  it('exits 1 with the strategy\'s own line when the fold threw', () => {
    const { strategy, commit, baseVersion, fragments } = built();
    const delivered: SettleDelivered = {
      delivery: 'push',
      outcome: { outcome: 'unsettled', exitCode: 1, attempts: 1, build: { outcome: 'failed', strategy, commit, baseVersion, fragments, line: 'semver-by-level threw: boom' } },
    };

    const result = settledResult(delivered, NO_TAG, 'origin/main', 'main');

    expect(result.exitCode).toBe(1);
    expect(result.problem).toBe('❌ Nothing was written: semver-by-level threw: boom');
    expect(result.lines).not.toContain('Version: 0.4.0 → 0.5.0');
  });
});

describe('settledResult and dryRunResult, a release moving the root and a package', () => {
  it('prints one Version: line per unit, the root\'s first, and the fragment\'s package after its title', () => {
    const delivered: SettleDelivered = { delivery: 'push', outcome: { outcome: 'pushed', exitCode: 0, attempts: 1, build: builtBoth() } };

    const result = settledResult(delivered, NO_TAG, 'origin/main', 'main');

    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([
      'Strategy: semver-by-level',
      'Base: origin/main at aaaaaaaaaaaa, version 0.4.0',
      'Fragments, in the order the base received them:',
      '  1. .changes/rafa-9.md — minor, "title of rafa-9", added 2026-09-01 in bbbbbbbbbbbb',
      '  2. .changes/rafa-7.md — minor, "title of rafa-7" for @scope/plugin, added 2026-09-02 in eeeeeeeeeeee',
      'Version: 0.4.0 → 0.5.0',
      'Version: @scope/plugin 0.1.0 → 0.2.0',
      'Changelog: packages/plugin/CHANGELOG.md is missing, so the release commit creates it under "# Changelog".',
      '✅ Pushed "chore: release 0.5.0, @scope/plugin@0.2.0" (cccccccccccc) to main.',
    ]);
  });

  it('prints a package\'s Version: line alone when the root folded nothing', () => {
    const build: SettleBuilt = { ...builtBoth(), fragments: [PLUGIN_FRAGMENT], units: [pluginUnit()], createdChangelog: [] };
    const delivered: SettleDelivered = { delivery: 'push', outcome: { outcome: 'pushed', exitCode: 0, attempts: 1, build } };

    const result = settledResult(delivered, NO_TAG, 'origin/main', 'main');

    expect(result.lines.filter((line) => line.startsWith('Version:'))).toEqual(['Version: @scope/plugin 0.1.0 → 0.2.0']);
    expect(result.lines.at(-1)).toBe('✅ Pushed "chore: release @scope/plugin@0.2.0" (cccccccccccc) to main.');
  });

  it('names both moves in the dry run\'s commit line', () => {
    const { strategy, commit, baseVersion, fragments, units } = builtBoth();
    const reading: SettleFolded = { outcome: 'folded', strategy, commit, baseVersion, fragments, units, lock: null };

    const result = dryRunResult(reading, 'origin/main', 'main');

    expect(result.lines.slice(-4)).toEqual([
      'Version: 0.4.0 → 0.5.0',
      'Version: @scope/plugin 0.1.0 → 0.2.0',
      'Changelog: packages/plugin/CHANGELOG.md is missing, so the release commit creates it under "# Changelog".',
      'Dry run: settle would commit "chore: release 0.5.0, @scope/plugin@0.2.0" on main; nothing was written.',
    ]);
  });

  it('prints the tag step\'s sentence naming every tag after the push line', () => {
    const delivered: SettleDelivered = { delivery: 'push', outcome: { outcome: 'pushed', exitCode: 0, attempts: 1, build: builtBoth() } };
    const sentence = `v0.5.0, @scope/plugin@0.2.0 name ${'c'.repeat(12)} and are pushed to origin`;
    const tag: SettleTagOutcome = { outcome: 'tagged', exitCode: 0, tags: ['v0.5.0', '@scope/plugin@0.2.0'], commit: 'c'.repeat(40), sentence };

    const result = settledResult(delivered, tag, 'origin/main', 'main');

    expect(result.exitCode).toBe(0);
    expect(result.lines.slice(-2)).toEqual(['✅ Pushed "chore: release 0.5.0, @scope/plugin@0.2.0" (cccccccccccc) to main.', `✅ ${sentence}`]);
  });
});

describe('the Lock: lines under release.moveLock, rendered from literals', () => {
  it('names no lock in a dry run whose reading leaves it alone', () => {
    const result = dryRunResult(folded(null), 'origin/main', 'main');

    expect(result.exitCode).toBe(0);
    expect(result.lines.some((line) => line.startsWith('Lock:'))).toBe(false);
  });

  it('says in a dry run that rafa.lock would move from the base\'s version to the new one, above the dry run line', () => {
    const result = dryRunResult(folded({ path: 'rafa.lock', from: '0.4.0', to: '0.5.0' }), 'origin/main', 'main');

    expect(result.exitCode).toBe(0);
    expect(result.lines.slice(-2)).toEqual([
      'Lock: rafa.lock would move from 0.4.0 to 0.5.0.',
      'Dry run: settle would commit "chore: release 0.5.0" on main; nothing was written.',
    ]);
  });

  it('says in a dry run that the release commit creates a lock the base lacks', () => {
    const result = dryRunResult(folded({ path: 'rafa.lock', from: null, to: '0.5.0' }), 'origin/main', 'main');

    expect(result.lines).toContain('Lock: rafa.lock is missing, so the release commit creates it at 0.5.0.');
    expect(result.lines.some((line) => line.includes('would move'))).toBe(false);
  });

  it('puts the lock line after the changelog line when the base lacks both', () => {
    const reading: SettleFolded = { ...folded({ path: 'rafa.lock', from: null, to: '0.5.0' }), units: [rootUnit(true)] };

    const result = dryRunResult(reading, 'origin/main', 'main');

    expect(result.lines.slice(-3).map((line) => line.split(':')[0])).toEqual(['Changelog', 'Lock', 'Dry run']);
  });

  it('says rafa.lock moved after a push that landed, above the push line', () => {
    const build: SettleBuilt = { ...built(), lock: { path: 'rafa.lock', from: '0.4.0', to: '0.5.0' } };
    const delivered: SettleDelivered = { delivery: 'push', outcome: { outcome: 'pushed', exitCode: 0, attempts: 1, build } };

    const result = settledResult(delivered, NO_TAG, 'origin/main', 'main');

    expect(result.exitCode).toBe(0);
    expect(result.lines.slice(-2)).toEqual([
      'Lock: rafa.lock moved to 0.5.0.',
      '✅ Pushed "chore: release 0.5.0" (cccccccccccc) to main.',
    ]);
    // The control: the same push of a build that left the lock alone names no lock.
    const untouched = settledResult({ delivery: 'push', outcome: { outcome: 'pushed', exitCode: 0, attempts: 1, build: built() } }, NO_TAG, 'origin/main', 'main');
    expect(untouched.lines.some((line) => line.startsWith('Lock:'))).toBe(false);
  });

  it('says rafa.lock moved after a release pull request was opened', () => {
    const build: SettleBuilt = { ...built(), lock: { path: 'rafa.lock', from: null, to: '0.5.0' } };
    const pull: PullRequestSummary = {
      number: 7,
      title: 'chore: release 0.5.0',
      url: 'https://github.com/open-tomato/demo/pull/7',
      state: 'open',
      headRefName: 'rafa/release',
      baseRefName: 'main',
      author: { login: 'rafa', isBot: false },
      isCrossRepository: false,
      updatedAt: '2026-09-01T12:00:00Z',
    };
    const delivered: SettleDelivered = { delivery: 'pr', outcome: { outcome: 'delivered', exitCode: 0, build, head: build.release, pushed: true, pull, action: 'opened' } };

    const result = settledResult(delivered, NO_TAG, 'origin/main', 'main');

    expect(result.exitCode).toBe(0);
    expect(result.lines.at(-2)).toBe('Lock: rafa.lock moved to 0.5.0.');
    expect(result.lines.at(-1)).toContain('✅ Release pull request #7 opened');
  });

  it('names no moved lock when the push was refused, since nothing landed', () => {
    const build: SettleBuilt = { ...built(), lock: { path: 'rafa.lock', from: '0.4.0', to: '0.5.0' } };
    const delivered: SettleDelivered = { delivery: 'push', outcome: { outcome: 'protected', exitCode: 1, attempts: 1, build, sentence: 'main is protected' } };

    const result = settledResult(delivered, NO_TAG, 'origin/main', 'main');

    expect(result.exitCode).toBe(1);
    expect(result.lines.some((line) => line.startsWith('Lock:'))).toBe(false);
  });
});

describe('rafa release settle --dry-run', () => {
  it('prints the fragments in the order main received them, the strategy and the version, and writes nothing', async () => {
    const w = world();
    landTwo(w);
    const before = w.git(w.origin, ['rev-parse', 'main']);
    const status = w.git(w.project.root, ['status', '--porcelain']);

    const run = await settle(w, ['--dry-run']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Strategy: semver-by-level');
    expect(run.stdout).toContain('Version: 0.4.0 → 0.5.0');
    expect(run.stdout.indexOf('.changes/rafa-9.md')).toBeLessThan(run.stdout.indexOf('.changes/rafa-1.md'));
    expect(run.stdout.indexOf('.changes/rafa-1.md')).toBeGreaterThan(-1);
    expect(run.stdout).toContain('Dry run: settle would commit "chore: release 0.5.0" on main; nothing was written.');
    expect(w.git(w.origin, ['rev-parse', 'main'])).toBe(before);
    expect(w.git(w.project.root, ['status', '--porcelain'])).toBe(status);
    const worktrees = w.git(w.project.root, ['worktree', 'list', '--porcelain'])
      .split('\n')
      .filter((line) => line.startsWith('worktree '));
    expect(worktrees).toHaveLength(1);
    expect(readdirSync(w.scratchRoot)).toEqual([]);
    // The control: the same probe sees the caller's own work in flight.
    expect(status).toContain('package.json');
  });

  it('says it will create a changelog main lacks, and writes nothing', async () => {
    const w = world('', false);
    landTwo(w);
    const before = w.git(w.origin, ['rev-parse', 'main']);

    const run = await settle(w, ['--dry-run']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Changelog: CHANGELOG.md is missing, so the release commit creates it under "# Changelog".');
    expect(run.stdout).toContain('Dry run: settle would commit "chore: release 0.5.0" on main; nothing was written.');
    expect(w.git(w.origin, ['rev-parse', 'main'])).toBe(before);
    expect(() => w.git(w.origin, ['cat-file', '-e', 'main:CHANGELOG.md'])).toThrow();
  });

  it('names no changelog to create when main holds one', async () => {
    const w = world();
    landTwo(w);

    const run = await settle(w, ['--dry-run']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Dry run: settle would commit');
    expect(run.stdout).not.toContain('Changelog:');
  });

  it('exits 0 naming nothing to settle when no fragment waits', async () => {
    const w = world();

    const run = await settle(w, ['--dry-run']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Fragments: none waiting');
    expect(run.stdout).toContain('Nothing to settle');
  });

  it('exits 1 naming the fragment that does not parse, folding none', async () => {
    const w = world();
    landTwo(w);
    w.land({ '.changes/rafa-5.md': 'not a fragment\n' }, 'merge rafa-5');

    const run = await settle(w, ['--dry-run']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('.changes/rafa-5.md does not parse');
    expect(run.stdout).not.toContain('Version:');
  });

  it('gives the reading as the data of the result event in json mode', async () => {
    const w = world();
    landTwo(w);

    const run = await settle(w, ['--dry-run', '--output=json']);

    expect(run.exitCode).toBe(0);
    const data = (eventsOf(run.stdout).at(-1) as { data?: { dryRun: boolean; reading: { outcome: string; units: readonly { package: string | null; version: string }[] } } }).data;
    expect(data?.dryRun).toBe(true);
    expect(data?.reading.outcome).toBe('folded');
    expect(data?.reading.units.map((unit) => [unit.package, unit.version])).toEqual([[null, '0.5.0']]);
  });
});

describe('rafa release settle, the push delivery', () => {
  it('pushes one release commit to main, and a second settle exits 0 writing nothing', async () => {
    const w = world();
    landTwo(w);

    const first = await settle(w);
    const released = w.git(w.origin, ['rev-parse', 'main']);
    const second = await settle(w);

    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain('✅ Pushed "chore: release 0.5.0"');
    expect(originSubject(w)).toBe('chore: release 0.5.0');
    expect(originFragments(w)).toEqual([]);
    expect(w.git(w.origin, ['show', 'main:CHANGELOG.md'])).toContain('<!-- rafa:fragments rafa-9 rafa-1 -->');
    expect(w.git(w.project.root, ['branch', '--show-current'])).toBe('feat');
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain('Nothing to settle');
    expect(w.git(w.origin, ['rev-parse', 'main'])).toBe(released);
  });

  it('creates a changelog main lacks in the pushed release commit, under the heading', async () => {
    const w = world('', false);
    landTwo(w);

    const run = await settle(w);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Changelog: CHANGELOG.md is missing, so the release commit creates it under "# Changelog".');
    expect(run.stdout).toContain('✅ Pushed "chore: release 0.5.0"');
    const changelog = w.git(w.origin, ['show', 'main:CHANGELOG.md']);
    expect(changelog).toStartWith('# Changelog\n\n## 0.5.0 — ');
    expect(changelog).toContain('<!-- rafa:fragments rafa-9 rafa-1 -->');
  });

  it('tags the pushed release and pushes the tag under release.tag: settle', async () => {
    const w = world('release:\n  tag: settle\n');
    landTwo(w);

    const run = await settle(w);

    expect(run.exitCode).toBe(0);
    expect(w.git(w.origin, ['rev-parse', 'refs/tags/v0.5.0^{commit}'])).toBe(w.git(w.origin, ['rev-parse', 'main']));
    expect(run.stdout).toContain('✅ v0.5.0 names');
  });

  it('refuses an argument before reading anything', async () => {
    const w = world();

    const run = await settle(w, ['now']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('Usage: rafa release settle [--dry-run]');
  });

  it('exits 1 naming the fetch when the base cannot be fetched', async () => {
    const w = world();
    w.git(w.project.root, ['remote', 'remove', 'origin']);

    const run = await settle(w);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('main could not be fetched from origin');
  });
});

describe('rafa release settle, the pr delivery', () => {
  /** A double with no release pull request open, opening #12. */
  function opening(): ReturnType<typeof createPullRequestsDouble> {
    return createPullRequestsDouble({
      findOpen: () => Promise.resolve(null),
      create: (draft: PullRequestDraft) => Promise.resolve({
        number: 12,
        title: draft.title,
        url: 'https://github.com/open-tomato/demo/pull/12',
        state: 'open',
        headRefName: draft.head,
        baseRefName: draft.base,
        author: { login: 'rafa', isBot: false },
        isCrossRepository: false,
        updatedAt: SETUP_DATE,
      } satisfies PullRequestSummary),
    });
  }

  it('pushes rafa/release and opens the release pull request, leaving main alone', async () => {
    const w = world('release:\n  settle: pr\n');
    landTwo(w);
    const before = w.git(w.origin, ['rev-parse', 'main']);
    const double = opening();

    const run = await settle(w, [], { pullRequests: () => double.pulls, readRemote: () => GITHUB_REMOTE });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('✅ Release pull request #12 opened, "chore: release 0.5.0" into main');
    expect(originSubject(w, 'rafa/release')).toBe('chore: release 0.5.0');
    expect(w.git(w.origin, ['rev-parse', 'main'])).toBe(before);
    expect(double.sent()[0]).toBe('findOpen rafa/release');
  });

  it('refuses with exit code 2 and pushes nothing when the provider is not gh', async () => {
    const w = world('release:\n  settle: pr\n');
    landTwo(w);
    const double = opening();

    const run = await settle(w, [], { pullRequests: () => double.pulls, readRemote: () => null });

    expect(run.exitCode).toBe(2);
    expect(double.sent()).toEqual([]);
    expect(() => w.git(w.origin, ['rev-parse', '--verify', 'refs/heads/rafa/release'])).toThrow();
  });
});

describe('rafa release settle, the project refresh (./settle-project.ts)', () => {
  /** The config of a repository that opted in to the project. */
  const PROJECT = 'board:\n  project:\n    number: 6\n';

  /** The warning the stand-in refresh answers. */
  const WARNING = 'The project\'s field "Rank" was skipped.';

  /** A `gh` seam answering commit `brought` with pull request #30 closing #21, and the issues each refresh asked for. */
  function projectSeams(brought: () => string): { seams: ReleaseSettleSeams; opened: () => number; commits: () => readonly string[]; asked: () => readonly (readonly number[])[] } {
    let opened = 0;
    const commits: string[] = [];
    const asked: (readonly number[])[] = [];
    const gh: GhRunner = (args) => {
      const named = args.filter((arg) => /^c\d+=/u.test(arg)).map((arg) => arg.slice(arg.indexOf('=') + 1));
      commits.push(...named);
      const pull = { number: 30, state: 'MERGED', baseRefName: 'main', body: 'Closes #21', mergeCommit: { oid: brought() }, closingIssuesReferences: { pageInfo: { hasNextPage: false }, nodes: [] } };
      const objects = Object.fromEntries(named.map((commit, index) => [`c${String(index)}`, commit === brought()
        ? { associatedPullRequests: { pageInfo: { hasNextPage: false }, nodes: [pull] } }
        : null]));
      return Promise.resolve({ ok: true, stdout: JSON.stringify({ data: { repository: { nameWithOwner: 'open-tomato/demo', ...objects } } }), stderr: '' });
    };
    const seams: ReleaseSettleSeams = {
      gh: () => {
        opened += 1;
        return gh;
      },
      refresh: (_options, issues) => {
        asked.push(issues);
        return Promise.resolve({ kind: 'skipped', reason: 'no-issues', warnings: [WARNING] });
      },
    };
    return { seams, opened: () => opened, commits: () => [...commits], asked: () => [...asked] };
  }

  /** The commit that added `path` to origin's `main`. */
  function addedBy(w: World, path: string): string {
    return w.git(w.origin, ['log', '-1', '--format=%H', '--diff-filter=A', 'main', '--', path]);
  }

  it('after a push, reads the commits that added the folded fragments, refreshes the issues their pull requests close, and warns, exiting 0', async () => {
    const w = world(PROJECT);
    landTwo(w);
    const nine = addedBy(w, '.changes/rafa-9.md');
    const one = addedBy(w, '.changes/rafa-1.md');
    const fake = projectSeams(() => nine);

    const run = await settle(w, [], fake.seams);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('✅ Pushed "chore: release 0.5.0"');
    expect(fake.commits()).toEqual([nine, one]);
    expect(fake.asked()).toEqual([[21]]);
    expect(run.stdout.indexOf(`warn: ${WARNING}`)).toBeGreaterThan(run.stdout.indexOf('✅ Pushed'));
  });

  it('control: the same push with board.project.number unset opens no runner and asks no refresh', async () => {
    const w = world();
    landTwo(w);
    const fake = projectSeams(() => addedBy(w, '.changes/rafa-9.md'));

    const run = await settle(w, [], fake.seams);

    expect(run.exitCode).toBe(0);
    expect(originSubject(w)).toBe('chore: release 0.5.0');
    expect([fake.opened(), fake.asked()]).toEqual([0, []]);
    expect(run.stdout).not.toContain(WARNING);
  });

  it('a dry run with the number set opens no runner', async () => {
    const w = world(PROJECT);
    landTwo(w);
    const fake = projectSeams(() => addedBy(w, '.changes/rafa-9.md'));

    const run = await settle(w, ['--dry-run'], fake.seams);

    expect(run.exitCode).toBe(0);
    expect([fake.opened(), fake.asked()]).toEqual([0, []]);
  });

  it('carries what the refresh read as the project key of the json result', async () => {
    const w = world(PROJECT);
    landTwo(w);
    const nine = addedBy(w, '.changes/rafa-9.md');
    const fake = projectSeams(() => nine);

    const run = await settle(w, ['--output=json'], fake.seams);

    expect(run.exitCode).toBe(0);
    const data = (eventsOf(run.stdout).at(-1) as { data?: { project: { pullRequests: number[]; issues: number[]; warnings: string[] } | null } }).data;
    expect(data?.project).toEqual(expect.objectContaining({ pullRequests: [30], issues: [21], warnings: [WARNING] }));
  });
});
