/**
 * The workspace world the release integration tests share: a bare origin
 * whose `main` holds a root manifest naming `packages/*`, a publishable
 * `packages/plugin` and a private `packages/core`, a second clone that
 * lands commits on `main` as merges would, and the caller's clone on a
 * feature branch holding `.rafa/config.yaml`, which is the project a
 * command runs in.
 *
 * `rafa release settle`'s and `rafa release tag`'s workspace tests both
 * build their repositories here, so the tag tests run over the very
 * commit the settle tests measure. Nothing here imports a command: the
 * tests dispatch their own.
 */
import type { PlantedProject } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { serializeFragment } from '@open-tomato/rafa/release/fragment';
import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';

import { projectConfigText } from '../project/scaffold.js';

import { plantProjectConfig } from './cli-capture.js';

/** The root manifest on `main`: a version and the workspace globs. */
export const ROOT_MANIFEST = '{\n\t"name": "demo",\n\t"version": "0.4.0",\n\t"workspaces": ["packages/*"]\n}\n';

/** The publishable member's manifest on `main`. */
export const PLUGIN_MANIFEST = '{\n  "name": "@scope/plugin",\n  "version": "0.1.0"\n}\n';

/** The private member's manifest on `main`. */
export const CORE_MANIFEST = '{\n  "name": "@scope/core",\n  "version": "0.0.0",\n  "private": true\n}\n';

/** The root changelog on `main`. */
export const ROOT_CHANGELOG = '# Changelog\n\n## 0.4.0 — 2026-08-01, older\n\n- Loop: old line\n';

/** The plugin's changelog on `main`. */
export const PLUGIN_CHANGELOG = '# Changelog\n\n## 0.1.0 — 2026-08-01, first\n\n- Plugin: old line\n';

/** The committer date every setup commit gets. */
export const SETUP_DATE = '2026-09-01T12:00:00Z';

/** The subject a release moving the root to 0.5.0 and the plugin to 0.2.0 carries. */
export const BOTH_SUBJECT = 'chore: release 0.5.0, @scope/plugin@0.2.0';

/** The environment every setup git runs under, isolated from the operator's config. */
export function isolatedEnv(home: string): Record<string, string> {
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
export function rootFragmentText(plan: string): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level: 'minor', package: null, notes: ['- Loop: a line'] });
}

/** A fragment's text naming `name` as its package. */
export function packageFragmentText(plan: string, name: string): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level: 'minor', package: name, notes: ['- Plugin: a hook'] });
}

/** A bare origin, a clone that lands commits on `main`, and the caller's clone as a project. */
export interface WorkspaceWorld {
  readonly origin: string;
  readonly project: PlantedProject;
  readonly scratchRoot: string;
  /** Runs git in `cwd` under the isolated environment, answering stdout trimmed. */
  readonly git: (cwd: string, args: readonly string[]) => string;
  /** Writes each path in the other clone, commits and pushes `main`. */
  readonly land: (files: Readonly<Record<string, string>>, message: string) => void;
}

/**
 * Builds a {@link WorkspaceWorld} under `dir`, a directory of this world's
 * own: its base holds the workspace and its caller holds
 * `.rafa/config.yaml` with `extra` appended, on a branch named `feat`.
 */
export function createWorkspaceWorld(dir: string, extra = ''): WorkspaceWorld {
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

/** Lands one fragment for the root and one for the plugin, as two merges would. */
export function landBoth(world: WorkspaceWorld): void {
  world.land({ '.changes/rafa-9.md': rootFragmentText('rafa-9') }, 'merge rafa-9');
  world.land({ '.changes/rafa-7.md': packageFragmentText('rafa-7', '@scope/plugin') }, 'merge rafa-7');
}
