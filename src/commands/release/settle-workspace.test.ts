/**
 * Integration tests for `rafa release settle` over a workspace
 * (`settle.ts`, driven through the command's `runSettle`): a bare
 * origin whose `main` holds a root manifest naming `packages/*`, a
 * publishable `packages/plugin` and a private `packages/core`, a clone
 * that lands fragments on `main` as merges would, and the caller's
 * clone on a feature branch, which is the project the command runs in.
 *
 * Negative cases come first: a fragment naming a package the workspace
 * lacks and one naming the private core both exit 1 with origin's
 * `main` and the caller's worktree as they were. Then a three-field
 * fragment settles into the root alone, and one fragment each for the
 * root and the plugin land one commit moving both manifests and both
 * changelogs under a subject naming both moves, by `push`, by `pr`, and
 * with both tags under `release.tag: settle`.
 *
 * Everything measured is git's own state after the run, never the
 * command's word for it. Each "left alone" reading is paired with a case
 * where the same probe sees a write.
 */
import type { ReleaseSettleSeams } from './settle.js';
import type { PullRequestDraft, PullRequestSummary } from '../../pr/index.js';
import type { PlantedProject } from '../../tests/cli-capture.js';
import type { RafaCommand } from '@open-tomato/rafa/core/command';

import '../../adapter-registry.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import { projectConfigText } from '../../project/scaffold.js';
import { serializeFragment } from '../../release/fragment.js';
import { dispatchInProject, plantProjectConfig } from '../../tests/cli-capture.js';
import { gitIdentityEnv } from '../../tests/git-identity.js';

import { createReleaseSettleCommand } from './settle.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-settle-workspace-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The one subject the cases register. */
const SUBJECTS = [{ name: 'release', summary: 'releases' }];

/** The root manifest on `main`: a version and the workspace globs. */
const ROOT_MANIFEST = '{\n\t"name": "demo",\n\t"version": "0.4.0",\n\t"workspaces": ["packages/*"]\n}\n';

/** The publishable member's manifest on `main`. */
const PLUGIN_MANIFEST = '{\n  "name": "@scope/plugin",\n  "version": "0.1.0"\n}\n';

/** The private member's manifest on `main`. */
const CORE_MANIFEST = '{\n  "name": "@scope/core",\n  "version": "0.0.0",\n  "private": true\n}\n';

/** The root changelog on `main`. */
const ROOT_CHANGELOG = '# Changelog\n\n## 0.4.0 — 2026-08-01, older\n\n- Loop: old line\n';

/** The plugin's changelog on `main`. */
const PLUGIN_CHANGELOG = '# Changelog\n\n## 0.1.0 — 2026-08-01, first\n\n- Plugin: old line\n';

/** The committer date every setup commit gets. */
const SETUP_DATE = '2026-09-01T12:00:00Z';

/** A remote `resolvePrProvider` reads as GitHub. */
const GITHUB_REMOTE = 'https://github.com/open-tomato/demo.git';

/** The subject a release moving the root to 0.5.0 and the plugin to 0.2.0 carries. */
const BOTH_SUBJECT = 'chore: release 0.5.0, @scope/plugin@0.2.0';

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

/** A three-field fragment's text: it names no package, so it belongs to the root. */
function rootFragmentText(plan: string): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level: 'minor', package: null, notes: ['- Loop: a line'] });
}

/** A fragment's text naming `name` as its package. */
function packageFragmentText(plan: string, name: string): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level: 'minor', package: name, notes: ['- Plugin: a hook'] });
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

/** Builds a {@link World} whose base holds the workspace and whose caller holds `.rafa/config.yaml` with `extra` appended. */
function world(extra = ''): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const origin = join(dir, 'origin.git');
  const caller = join(dir, 'caller');
  const other = join(dir, 'other');
  const scratchRoot = join(dir, 'scratch');
  for (const path of [home, scratchRoot]) mkdirSync(path, { recursive: true });
  const git = (cwd: string, args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8', env: isolatedEnv(home), stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = (files: Readonly<Record<string, string>>, message: string): void => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(other, path)), { recursive: true });
      writeFileSync(join(other, path), text);
    }
    git(other, ['add', '-A']);
    git(other, ['commit', '-q', '-m', message]);
    git(other, ['push', '-q', 'origin', 'main']);
  };
  const land = (files: Readonly<Record<string, string>>, message: string): void => {
    git(other, ['pull', '-q', '--ff-only', 'origin', 'main']);
    commit(files, message);
  };

  git(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(dir, ['clone', '-q', origin, other]);
  commit({
    'package.json': ROOT_MANIFEST,
    'CHANGELOG.md': ROOT_CHANGELOG,
    'packages/plugin/package.json': PLUGIN_MANIFEST,
    'packages/plugin/CHANGELOG.md': PLUGIN_CHANGELOG,
    'packages/core/package.json': CORE_MANIFEST,
  }, 'first');

  git(dir, ['clone', '-q', origin, caller]);
  const settings: readonly (readonly [string, string])[] = [['user.name', 'rafa settle'], ['user.email', 'settle@example.invalid'], ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false'], ['core.hooksPath', join(dir, 'no-hooks')]];
  for (const [key, value] of settings) {
    git(caller, ['config', key, value]);
  }
  git(caller, ['switch', '-q', '-c', 'feat']);
  plantProjectConfig(caller, `${projectConfigText()}${extra}`);
  return { origin, project: { root: caller, home }, scratchRoot, git, land };
}

/** Dispatches `rafa release settle` in the world's caller. */
async function settle(
  w: World,
  seams: ReleaseSettleSeams = {},
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const command: RafaCommand = createReleaseSettleCommand({ scratchRoot: w.scratchRoot, ...seams });
  return dispatchInProject(['release', 'settle'], SUBJECTS, [command], w.project);
}

/** Origin's subject at `ref`. */
function originSubject(w: World, ref = 'main'): string {
  return w.git(w.origin, ['log', '-1', '--format=%s', ref]);
}

/** A file's text at origin's `ref`. */
function originFile(w: World, path: string, ref = 'main'): string {
  return w.git(w.origin, ['show', `${ref}:${path}`]);
}

/** The paths `ref`'s commit changed against its parent, sorted. */
function changedPaths(w: World, ref: string): string[] {
  return w.git(w.origin, ['diff', '--name-only', `${ref}~1`, ref]).split('\n')
    .sort();
}

/** The files origin's `main` holds under `.changes/`. */
function originFragments(w: World): string[] {
  const listed = w.git(w.origin, ['ls-tree', '--name-only', 'main', '.changes/']);
  return listed === ''
    ? []
    : listed.split('\n');
}

/** Lands one fragment for the root and one for the plugin, as two merges would. */
function landBoth(w: World): void {
  w.land({ '.changes/rafa-9.md': rootFragmentText('rafa-9') }, 'merge rafa-9');
  w.land({ '.changes/rafa-7.md': packageFragmentText('rafa-7', '@scope/plugin') }, 'merge rafa-7');
}

describe('rafa release settle over a workspace, fragments that cannot be folded', () => {
  it('exits 1 naming the package when a fragment names one the workspace lacks, leaving the base unchanged', async () => {
    const w = world();
    w.land({ '.changes/rafa-9.md': rootFragmentText('rafa-9') }, 'merge rafa-9');
    w.land({ '.changes/rafa-5.md': packageFragmentText('rafa-5', '@scope/missing') }, 'merge rafa-5');
    const before = w.git(w.origin, ['rev-parse', 'main']);
    const status = w.git(w.project.root, ['status', '--porcelain']);

    const run = await settle(w);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('.changes/rafa-5.md names package @scope/missing, which the workspace at');
    expect(run.stderr).toContain('does not hold');
    expect(w.git(w.origin, ['rev-parse', 'main'])).toBe(before);
    expect(originFragments(w)).toEqual(['.changes/rafa-5.md', '.changes/rafa-9.md']);
    expect(w.git(w.project.root, ['status', '--porcelain'])).toBe(status);
    // The control: the probe sees the planted config, so a stray write would show beside it.
    expect(status).toBe('?? .rafa/');
    expect(() => w.git(w.origin, ['rev-parse', '--verify', 'refs/heads/rafa/release'])).toThrow();
  });

  it('exits 1 naming the package when a fragment names the private core, leaving the base unchanged', async () => {
    const w = world();
    w.land({ '.changes/rafa-5.md': packageFragmentText('rafa-5', '@scope/core') }, 'merge rafa-5');
    const before = w.git(w.origin, ['rev-parse', 'main']);
    const status = w.git(w.project.root, ['status', '--porcelain']);

    const run = await settle(w);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('.changes/rafa-5.md names package @scope/core, which is private and never publishes');
    expect(w.git(w.origin, ['rev-parse', 'main'])).toBe(before);
    expect(originFragments(w)).toEqual(['.changes/rafa-5.md']);
    expect(w.git(w.project.root, ['status', '--porcelain'])).toBe(status);
    // The control: the probe sees the planted config, so a stray write would show beside it.
    expect(status).toBe('?? .rafa/');
    expect(originFile(w, 'packages/core/package.json')).toBe(CORE_MANIFEST.trim());
  });

  it('control: the same world settles once the offending fragment names the plugin', async () => {
    const w = world();
    w.land({ '.changes/rafa-5.md': packageFragmentText('rafa-5', '@scope/plugin') }, 'merge rafa-5');
    const before = w.git(w.origin, ['rev-parse', 'main']);

    const run = await settle(w);

    expect(run.exitCode).toBe(0);
    expect(w.git(w.origin, ['rev-parse', 'main'])).not.toBe(before);
  });
});

describe('rafa release settle over a workspace, the push delivery', () => {
  it('settles a three-field fragment into the root alone', async () => {
    const w = world();
    w.land({ '.changes/rafa-9.md': rootFragmentText('rafa-9') }, 'merge rafa-9');

    const run = await settle(w);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Version: 0.4.0 → 0.5.0');
    expect(run.stdout).not.toContain('Version: @scope/plugin');
    expect(originSubject(w)).toBe('chore: release 0.5.0');
    expect(changedPaths(w, 'main')).toEqual(['.changes/rafa-9.md', 'CHANGELOG.md', 'package.json']);
    expect(originFile(w, 'package.json')).toContain('"version": "0.5.0"');
    expect(originFile(w, 'packages/plugin/package.json')).toBe(PLUGIN_MANIFEST.trim());
    expect(originFile(w, 'packages/plugin/CHANGELOG.md')).toBe(PLUGIN_CHANGELOG.trim());
  });

  it('lands one commit moving both manifests and both changelogs, the subject naming both moves', async () => {
    const w = world();
    landBoth(w);
    const base = w.git(w.origin, ['rev-parse', 'main']);

    const run = await settle(w);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Version: 0.4.0 → 0.5.0');
    expect(run.stdout).toContain('Version: @scope/plugin 0.1.0 → 0.2.0');
    expect(run.stdout).toContain(`✅ Pushed "${BOTH_SUBJECT}"`);
    expect(originSubject(w)).toBe(BOTH_SUBJECT);
    expect(w.git(w.origin, ['rev-parse', 'main~1'])).toBe(base);
    expect(changedPaths(w, 'main')).toEqual([
      '.changes/rafa-7.md',
      '.changes/rafa-9.md',
      'CHANGELOG.md',
      'package.json',
      'packages/plugin/CHANGELOG.md',
      'packages/plugin/package.json',
    ]);
    expect(originFile(w, 'package.json')).toContain('"version": "0.5.0"');
    expect(originFile(w, 'packages/plugin/package.json')).toContain('"version": "0.2.0"');
    expect(originFile(w, 'CHANGELOG.md')).toContain('<!-- rafa:fragments rafa-9 -->');
    expect(originFile(w, 'CHANGELOG.md')).not.toContain('Plugin: a hook');
    expect(originFile(w, 'packages/plugin/CHANGELOG.md')).toContain('<!-- rafa:fragments rafa-7 -->');
    expect(originFile(w, 'packages/plugin/CHANGELOG.md')).toContain('- Plugin: a hook');
    expect(originFile(w, 'packages/plugin/CHANGELOG.md')).not.toContain('Loop: a line');
    expect(originFragments(w)).toEqual([]);
  });

  it('leaves no tag behind under the default release.tag: manual', async () => {
    const w = world();
    landBoth(w);

    const run = await settle(w);

    expect(run.exitCode).toBe(0);
    expect(w.git(w.origin, ['tag', '--list'])).toBe('');
  });

  it('leaves v<x> and @scope/plugin@<y> on the commit under release.tag: settle', async () => {
    const w = world('release:\n  tag: settle\n');
    landBoth(w);

    const run = await settle(w);

    expect(run.exitCode).toBe(0);
    const released = w.git(w.origin, ['rev-parse', 'main']);
    expect(w.git(w.origin, ['rev-parse', 'refs/tags/v0.5.0^{commit}'])).toBe(released);
    expect(w.git(w.origin, ['rev-parse', 'refs/tags/@scope/plugin@0.2.0^{commit}'])).toBe(released);
    expect(w.git(w.origin, ['tag', '--list']).split('\n')
      .sort()).toEqual(['@scope/plugin@0.2.0', 'v0.5.0']);
  });
});

describe('rafa release settle over a workspace, the pr delivery', () => {
  /** A double with no release pull request open, opening #12 and keeping the draft it was given. */
  function opening(drafts: PullRequestDraft[]): ReturnType<typeof createPullRequestsDouble> {
    return createPullRequestsDouble({
      findOpen: () => Promise.resolve(null),
      create: (draft: PullRequestDraft) => {
        drafts.push(draft);
        return Promise.resolve({
          number: 12,
          title: draft.title,
          url: 'https://github.com/open-tomato/demo/pull/12',
          state: 'open',
          headRefName: draft.head,
          baseRefName: draft.base,
          author: { login: 'rafa', isBot: false },
          isCrossRepository: false,
          updatedAt: SETUP_DATE,
        } satisfies PullRequestSummary);
      },
    });
  }

  it('puts the same commit on rafa/release under that title, leaving main alone', async () => {
    const w = world('release:\n  settle: pr\n');
    landBoth(w);
    const before = w.git(w.origin, ['rev-parse', 'main']);
    const drafts: PullRequestDraft[] = [];
    const double = opening(drafts);

    const run = await settle(w, { pullRequests: () => double.pulls, readRemote: () => GITHUB_REMOTE });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`✅ Release pull request #12 opened, "${BOTH_SUBJECT}" into main`);
    expect(drafts.map((draft) => draft.title)).toEqual([BOTH_SUBJECT]);
    expect(w.git(w.origin, ['rev-parse', 'main'])).toBe(before);
    expect(originSubject(w, 'rafa/release')).toBe(BOTH_SUBJECT);
    expect(w.git(w.origin, ['rev-parse', 'rafa/release~1'])).toBe(before);
    expect(changedPaths(w, 'rafa/release')).toEqual([
      '.changes/rafa-7.md',
      '.changes/rafa-9.md',
      'CHANGELOG.md',
      'package.json',
      'packages/plugin/CHANGELOG.md',
      'packages/plugin/package.json',
    ]);
    expect(originFile(w, 'package.json', 'rafa/release')).toContain('"version": "0.5.0"');
    expect(originFile(w, 'packages/plugin/package.json', 'rafa/release')).toContain('"version": "0.2.0"');
    expect(w.git(w.origin, ['tag', '--list'])).toBe('');
  });
});
