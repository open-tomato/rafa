/**
 * Tests for `tag-units.ts`: the version and changelog readers
 * `rafa release tag` decides every unit from, the publishable packages
 * it reads as units, a package's readings from its own folder, and the
 * skip a `tagged` refusal becomes.
 *
 * Controls carried by the cases:
 *
 *   - the changelog fixture opens with a FENCED `## 9.9.9` heading above
 *     its newest real section, so a fence skip that stopped working
 *     would name 9.9.9 and redden;
 *   - the package readings run over a real repository holding a ROOT tag
 *     and another package's tag of the same version beside the
 *     package's own, so a filter that let either through would show in
 *     `tags`, and a history where the root's manifest changed after the
 *     package's commit, so a walk over the wrong file names the wrong
 *     commit;
 *   - the private member sits beside a public one that IS read, so an
 *     empty list cannot pass for a filter that works.
 */
import type { TagDecision, TagRefused } from './tag.js';
import type { WorkspacePackage } from '../../release/workspace-packages.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '@open-tomato/rafa/core/git';

import { gitIdentityEnv } from '../../tests/git-identity.js';

import { readNewestRelease, readTagPackages, readUnitInputs, readVersion, unitDecisionOf } from './tag-units.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-tag-units-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many scratch directories this file has made, so each gets its own. */
let scratchCount = 0;

/** A directory of this case's own, under the temporary base. */
function scratch(): string {
  scratchCount += 1;
  const path = join(tempBase, `case-${scratchCount}`);
  mkdirSync(path, { recursive: true });
  return path;
}

/** The version the root's fixtures release. */
const VERSION = '0.5.0';

/** The version the package's fixtures release. */
const PLUGIN_VERSION = '0.2.0';

/** The package the workspace fixtures publish. */
const PLUGIN = '@scope/plugin';

/** The root manifest of a workspace whose members are `packages/*`. */
const ROOT_MANIFEST = JSON.stringify({ name: '@scope/root', version: VERSION, workspaces: ['packages/*'] });

/** A manifest declaring `version` under `name`, private when asked. */
function manifest(name: string, version: string, isPrivate = false): string {
  return JSON.stringify(isPrivate
    ? { name, version, private: true }
    : { name, version });
}

/** A changelog whose newest real section names `version`, opening with a fenced heading that is not a release. */
function changelog(version: string): string {
  return [
    '# Changelog',
    '',
    '```markdown',
    '## 9.9.9 — an example heading, which is not a release',
    '```',
    '',
    `## ${version} — 2026-10-01, rafa-1172: package publishes`,
    '',
    '<!-- rafa:fragments rafa-1172 -->',
    '',
    '- a change',
    '',
  ].join('\n');
}

/** Writes `text` at `path` under `root`, making its folder. */
function plant(root: string, path: string, text: string): void {
  const file = join(root, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

/** The member `readWorkspacePackages` would answer for `packages/plugin`. */
const MEMBER: WorkspacePackage = Object.freeze({
  name: PLUGIN,
  dir: 'packages/plugin',
  version: PLUGIN_VERSION,
  isPrivate: false,
  manifestPath: 'packages/plugin/package.json',
});

describe('the version file reading', () => {
  it('reads the version and keeps the text the publish line is read from', () => {
    const root = scratch();
    plant(root, 'package.json', ROOT_MANIFEST);

    const reading = readVersion(root, 'package.json');

    expect(reading.version).toBe(VERSION);
    expect(reading.text).toBe(ROOT_MANIFEST);
    expect(reading.problem).toBeNull();
  });

  it('reads a package\'s manifest by its path under the root', () => {
    const root = scratch();
    plant(root, 'packages/plugin/package.json', manifest(PLUGIN, PLUGIN_VERSION));

    expect(readVersion(root, 'packages/plugin/package.json'))
      .toMatchObject({ path: 'packages/plugin/package.json', version: PLUGIN_VERSION, problem: null });
  });

  it('says where it looked for a version file that is not there', () => {
    const root = scratch();

    const reading = readVersion(root, 'package.json');

    expect(reading.version).toBeNull();
    expect(reading.text).toBeNull();
    expect(reading.problem).toContain(join(root, 'package.json'));
  });

  it('says so for a manifest that declares no version', () => {
    const root = scratch();
    plant(root, 'package.json', '{"name": "a"}');

    expect(readVersion(root, 'package.json').problem).toContain('declares no version');
  });
});

describe('the changelog reading', () => {
  it('takes the version of the newest section, passing over a fenced heading above it', () => {
    const root = scratch();
    plant(root, 'CHANGELOG.md', changelog(VERSION));

    const reading = readNewestRelease(root, 'CHANGELOG.md');

    // The control: the fenced heading names a HIGHER version, so a skip that stopped working would show.
    expect(reading.version).toBe(VERSION);
    expect(reading.problem).toBeNull();
  });

  it('answers no version for a changelog naming no release at all', () => {
    const root = scratch();
    plant(root, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n');

    expect(readNewestRelease(root, 'CHANGELOG.md')).toMatchObject({ version: null, problem: null });
  });

  it('says where it looked for a changelog that is not there', () => {
    const root = scratch();

    const reading = readNewestRelease(root, 'CHANGELOG.md');

    expect(reading.version).toBeNull();
    expect(reading.problem).toContain(join(root, 'CHANGELOG.md'));
  });
});

describe('the packages a run tags', () => {
  it('reads the members that publish, passing over a private one', () => {
    const root = scratch();
    plant(root, 'package.json', ROOT_MANIFEST);
    plant(root, 'packages/plugin/package.json', manifest(PLUGIN, PLUGIN_VERSION));
    plant(root, 'packages/core/package.json', manifest('@scope/core', '1.0.0', true));

    const reading = readTagPackages(root);

    // The control: the public member IS read, so an empty list is not mistaken for the private one left out.
    expect(reading).toEqual({ ok: true, packages: [MEMBER] });
  });

  it('answers none for a root manifest naming no workspaces, a one-package project', () => {
    const root = scratch();
    plant(root, 'package.json', manifest('@scope/root', VERSION));

    expect(readTagPackages(root)).toEqual({ ok: true, packages: [] });
  });

  it('answers none for a project with no root manifest, which has no workspace', () => {
    expect(readTagPackages(scratch())).toEqual({ ok: true, packages: [] });
  });

  it('says why when a member manifest names no name', () => {
    const root = scratch();
    plant(root, 'package.json', ROOT_MANIFEST);
    plant(root, 'packages/plugin/package.json', '{"version": "0.2.0"}');

    const reading = readTagPackages(root);

    expect(reading.ok).toBe(false);
    expect(reading.ok
      ? ''
      : reading.problem).toBe('the workspace packages could not be read: packages/plugin/package.json names no name');
  });
});

describe('a package\'s readings', () => {
  /** Runs git in `repo`, with an identity and a config of this file's own. */
  function gitIn(repo: string, args: readonly string[]): string {
    return execFileSync('git', [...args], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: repo,
        GIT_CONFIG_GLOBAL: join(repo, '.gitconfig'),
        GIT_CONFIG_NOSYSTEM: '1',
        ...gitIdentityEnv(),
      },
    });
  }

  /** Commits everything in `repo` under `subject`, answering the new HEAD. */
  function commit(repo: string, subject: string): string {
    gitIn(repo, ['add', '-A']);
    gitIn(repo, ['commit', '-q', '-m', subject]);
    return gitIn(repo, ['rev-parse', 'HEAD']).trim();
  }

  /**
   * A repository whose package set 0.2.0 in one commit, after which the
   * root manifest moved; the root, and another package, hold tags of
   * the package's version.
   */
  function workspaceRepo(): { repo: string; set: string } {
    const repo = scratch();
    gitIn(repo, ['init', '-q', '-b', 'main']);
    plant(repo, 'package.json', ROOT_MANIFEST);
    plant(repo, 'packages/plugin/package.json', manifest(PLUGIN, '0.1.0'));
    commit(repo, 'chore: the workspace');
    plant(repo, 'packages/plugin/package.json', manifest(PLUGIN, PLUGIN_VERSION));
    plant(repo, 'packages/plugin/CHANGELOG.md', changelog(PLUGIN_VERSION));
    const set = commit(repo, 'chore: release @scope/plugin 0.2.0');
    plant(repo, 'package.json', ROOT_MANIFEST.replace(VERSION, '0.6.0'));
    commit(repo, 'chore: release 0.6.0');
    gitIn(repo, ['tag', `${PLUGIN}@0.1.0`, 'HEAD~2']);
    gitIn(repo, ['tag', `v${PLUGIN_VERSION}`]);
    gitIn(repo, ['tag', `@scope/other@${PLUGIN_VERSION}`]);
    return { repo, set };
  }

  it('reads the version, the changelog and the receipt from the package\'s folder', () => {
    const { repo } = workspaceRepo();

    const readings = readUnitInputs(repo, createGitRunner(repo), MEMBER);

    expect(readings.package).toBe(PLUGIN);
    expect(readings.version).toMatchObject({ path: 'packages/plugin/package.json', version: PLUGIN_VERSION });
    expect(readings.changelog).toEqual({ path: 'packages/plugin/CHANGELOG.md', version: PLUGIN_VERSION, problem: null });
    expect(readings.receipt).toEqual({ kind: 'receipted', ids: ['rafa-1172'] });
  });

  it('holds the package\'s own tags only, its latest among them', () => {
    const { repo } = workspaceRepo();

    const { tags } = readUnitInputs(repo, createGitRunner(repo), MEMBER);

    // The control: the repository holds a root tag and another package's tag of the same version.
    const listed = gitIn(repo, ['tag', '--list']).split('\n');
    expect(listed.filter((line) => line !== '')).toHaveLength(3);
    expect(tags.tags.map((each) => each.tag)).toEqual([`${PLUGIN}@0.1.0`]);
    expect(tags.latest?.tag).toBe(`${PLUGIN}@0.1.0`);
    expect(tags.problem).toBeNull();
  });

  it('names the commit that set the package\'s version, walking its manifest rather than the root\'s', () => {
    const { repo, set } = workspaceRepo();

    const { release } = readUnitInputs(repo, createGitRunner(repo), MEMBER);

    // The root manifest moved after the package's commit, so HEAD is one past it.
    expect(release).toEqual({ commit: set, ahead: 1, problem: null });
  });

  it('looks nothing up in the history for a package declaring no version', () => {
    const root = scratch();
    plant(root, 'packages/plugin/package.json', `{"name": "${PLUGIN}"}`);
    const calls: string[] = [];

    const readings = readUnitInputs(root, (args) => {
      calls.push(args.join(' '));
      return { ok: true, stdout: '', stderr: '' };
    }, MEMBER);

    expect(readings.release).toBeNull();
    expect(readings.receipt).toBeNull();
    expect(calls).toEqual(['tag --list']);
  });
});

describe('one unit\'s decision', () => {
  /** A refusal of `reason`, for a mapping case. */
  function refusal(reason: TagRefused['reason']): TagRefused {
    return { kind: 'refused', reason, message: `${reason} refused` };
  }

  it('skips a unit whose version a tag already names, keeping the sentence', () => {
    expect(unitDecisionOf(refusal('tagged'))).toEqual({ kind: 'skipped', message: 'tagged refused' });
  });

  it('keeps every other refusal a refusal, and a ready unit ready', () => {
    const ready: TagDecision = { kind: 'ready', version: VERSION, tag: `v${VERSION}`, commit: 'abc', ahead: 0 };

    expect(unitDecisionOf(ready)).toBe(ready);
    for (const reason of ['branch', 'version', 'changelog', 'git', 'receipt'] as const) {
      expect(unitDecisionOf(refusal(reason))).toEqual(refusal(reason));
    }
  });
});
