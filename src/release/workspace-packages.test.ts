/**
 * Tests for `workspace-packages.ts`: the pure glob match, the disk
 * reader over planted directories, and the git reader over real
 * repositories built from the same plantings.
 *
 * The git reader is held to the disk reader's answer at `HEAD` over a
 * tree that holds every shape the match has to tell apart: a private
 * member, a member with no version, a member a `!` glob excludes, a
 * `package.json` nested below a member, and one outside every glob. The
 * comparison is paired with a control that changes the disk after the
 * commit, so an equality that could not fail would show there.
 */
import type { WorkspacePackage } from './workspace-packages.js';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '@open-tomato/rafa/core/git';
import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';

import {
  packageNamed,
  publishableOf,
  readWorkspacePackages,
  readWorkspacePackagesAt,
  workspaceManifestPaths,
} from './workspace-packages.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-workspace-packages-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many plantings this file has made, so each gets its own directory. */
let plantCount = 0;

/** A manifest's text from its fields. */
function manifest(fields: Readonly<Record<string, unknown>>): string {
  return `${JSON.stringify(fields, null, 2)}\n`;
}

/** The tree every comparison case plants: one of each shape the match tells apart. */
const MIXED_TREE: Readonly<Record<string, string>> = {
  'package.json': manifest({ name: 'root', version: '1.0.0', workspaces: ['packages/*', 'tools/*', '!tools/skipped'] }),
  'packages/core/package.json': manifest({ name: '@x/core', version: '0.1.0', private: true }),
  'packages/plugin/package.json': manifest({ name: '@x/plugin', version: '2.3.4' }),
  'packages/plugin/fixtures/nested/package.json': manifest({ name: 'nested-fixture' }),
  'packages/bare/package.json': manifest({ name: '@x/bare', private: false }),
  'packages/no-manifest/README.md': 'no manifest here\n',
  'tools/lint/package.json': manifest({ name: '@x/lint', version: '0.0.1', private: true }),
  'tools/skipped/package.json': manifest({ name: '@x/skipped', version: '9.9.9' }),
  'docs/package.json': manifest({ name: 'outside-every-glob' }),
};

/** What {@link MIXED_TREE} holds, sorted by manifest path. */
const MIXED_PACKAGES: readonly WorkspacePackage[] = [
  { name: '@x/bare', dir: 'packages/bare', version: null, isPrivate: false, manifestPath: 'packages/bare/package.json' },
  { name: '@x/core', dir: 'packages/core', version: '0.1.0', isPrivate: true, manifestPath: 'packages/core/package.json' },
  { name: '@x/plugin', dir: 'packages/plugin', version: '2.3.4', isPrivate: false, manifestPath: 'packages/plugin/package.json' },
  { name: '@x/lint', dir: 'tools/lint', version: '0.0.1', isPrivate: true, manifestPath: 'tools/lint/package.json' },
];

/** Writes `files` under a new directory of this file's own and answers it. */
function plant(files: Readonly<Record<string, string>>): string {
  plantCount += 1;
  const root = join(tempBase, `plant-${String(plantCount)}`);
  writeFiles(root, files);
  return root;
}

/** Writes each path's text under `root`. */
function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, 'utf8');
  }
}

/** Plants `files`, commits them on `main` in a repository of its own, and answers its root. */
function plantRepo(files: Readonly<Record<string, string>>): string {
  const root = plant(files);
  const home = `${root}-home`;
  mkdirSync(home, { recursive: true });
  const git = (args: readonly string[]): string => execFileSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      ...gitIdentityEnv(),
      LC_ALL: 'C',
    },
  });
  git(['init', '-q', '--initial-branch=main', '.']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'plant']);
  return root;
}

/** The members of a reading, failing the case on a problem. */
function packagesOf(reading: ReturnType<typeof readWorkspacePackages>): readonly WorkspacePackage[] {
  if (!reading.ok) throw new Error(reading.problem);
  return reading.packages;
}

describe('workspaceManifestPaths', () => {
  const candidates = [
    'packages/b/package.json',
    'packages/a/package.json',
    'packages/a/nested/package.json',
    'tools/x/package.json',
    'docs/package.json',
  ];

  it('matches the array form and sorts the answer', () => {
    expect(workspaceManifestPaths(['packages/*'], candidates)).toEqual([
      'packages/a/package.json',
      'packages/b/package.json',
    ]);
  });

  it('matches the { packages } form the same way', () => {
    expect(workspaceManifestPaths({ packages: ['packages/*', 'tools/*'] }, candidates)).toEqual([
      'packages/a/package.json',
      'packages/b/package.json',
      'tools/x/package.json',
    ]);
  });

  it('honours a ! exclusion, which the same globs without it do not', () => {
    expect(workspaceManifestPaths(['packages/*'], candidates)).toContain('packages/b/package.json');
    expect(workspaceManifestPaths(['packages/*', '!packages/b'], candidates)).toEqual(['packages/a/package.json']);
  });

  it('drops a trailing slash and a leading ./ and answers a path two globs name once', () => {
    expect(workspaceManifestPaths(['./packages/*/', 'packages/a'], candidates)).toEqual([
      'packages/a/package.json',
      'packages/b/package.json',
    ]);
  });

  it('answers nothing for a value naming no glob, and passes over entries that are no string', () => {
    expect(workspaceManifestPaths(undefined, candidates)).toEqual([]);
    expect(workspaceManifestPaths('packages/*', candidates)).toEqual([]);
    expect(workspaceManifestPaths({ nohoist: ['packages/*'] }, candidates)).toEqual([]);
    expect(workspaceManifestPaths([42, 'tools/*'], candidates)).toEqual(['tools/x/package.json']);
  });

  it('does not mutate the candidates it is given', () => {
    const given = [...candidates];
    workspaceManifestPaths(['packages/*'], given);
    expect(given).toEqual(candidates);
  });
});

describe('readWorkspacePackages', () => {
  it('reads every member of a planted tree and nothing the globs do not name', () => {
    expect(packagesOf(readWorkspacePackages(plant(MIXED_TREE)))).toEqual(MIXED_PACKAGES);
  });

  it('reads the { packages } form', () => {
    const root = plant({
      'package.json': manifest({ name: 'root', workspaces: { packages: ['libs/*'] } }),
      'libs/one/package.json': manifest({ name: 'one', version: '1.0.0' }),
    });
    expect(packagesOf(readWorkspacePackages(root)).map((member) => member.dir)).toEqual(['libs/one']);
  });

  it('answers an empty list for a root manifest with no workspaces, while one with them answers members', () => {
    const member = { 'packages/a/package.json': manifest({ name: 'a' }) };
    const without = plant({ 'package.json': manifest({ name: 'root' }), ...member });
    const withGlobs = plant({ 'package.json': manifest({ name: 'root', workspaces: ['packages/*'] }), ...member });
    expect(readWorkspacePackages(without)).toEqual({ ok: true, packages: [] });
    expect(packagesOf(readWorkspacePackages(withGlobs))).toHaveLength(1);
  });

  it('names a member manifest that is no JSON object or names no name, every one of them', () => {
    const root = plant({
      'package.json': manifest({ name: 'root', workspaces: ['packages/*'] }),
      'packages/array/package.json': '[1, 2]\n',
      'packages/broken/package.json': '{ "name": \n',
      'packages/fine/package.json': manifest({ name: 'fine' }),
      'packages/nameless/package.json': manifest({ version: '1.0.0' }),
      'packages/blank/package.json': manifest({ name: '  ' }),
    });
    const reading = readWorkspacePackages(root);
    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    expect(reading.problem).toContain('packages/array/package.json is no JSON object');
    expect(reading.problem).toContain('packages/broken/package.json is no JSON object');
    expect(reading.problem).toContain('packages/nameless/package.json names no name');
    expect(reading.problem).toContain('packages/blank/package.json names no name');
    expect(reading.problem).not.toContain('packages/fine');
  });

  it('refuses a root with no manifest, or one that is no JSON object', () => {
    const missing = readWorkspacePackages(plant({ 'README.md': 'nothing\n' }));
    const broken = readWorkspacePackages(plant({ 'package.json': 'not json\n' }));
    expect(missing).toMatchObject({ ok: false, problem: expect.stringContaining('does not exist') });
    expect(broken).toMatchObject({ ok: false, problem: expect.stringContaining('is no JSON object') });
  });
});

describe('readWorkspacePackagesAt', () => {
  it('answers what the disk reader answers over the same tree at HEAD', () => {
    const root = plantRepo(MIXED_TREE);
    const atHead = readWorkspacePackagesAt(createGitRunner(root), 'HEAD');
    expect(atHead).toEqual(readWorkspacePackages(root));
    expect(packagesOf(atHead)).toEqual(MIXED_PACKAGES);
  });

  it('reads the commit, not the checkout: an uncommitted member shows on disk only', () => {
    const root = plantRepo(MIXED_TREE);
    writeFiles(root, {
      'packages/late/package.json': manifest({ name: '@x/late', version: '0.0.1' }),
      'packages/plugin/package.json': manifest({ name: '@x/plugin', version: '3.0.0' }),
    });
    const onDisk = packagesOf(readWorkspacePackages(root));
    const atHead = packagesOf(readWorkspacePackagesAt(createGitRunner(root), 'HEAD'));
    expect(onDisk).not.toEqual(atHead);
    expect(packageNamed(onDisk, '@x/late')).not.toBeNull();
    expect(packageNamed(atHead, '@x/late')).toBeNull();
    expect(packageNamed(atHead, '@x/plugin')?.version).toBe('2.3.4');
  });

  it('answers an empty list for a root manifest with no workspaces', () => {
    const root = plantRepo({
      'package.json': manifest({ name: 'root' }),
      'packages/a/package.json': manifest({ name: 'a' }),
    });
    expect(readWorkspacePackagesAt(createGitRunner(root), 'HEAD')).toEqual({ ok: true, packages: [] });
  });

  it('names a member manifest that is no JSON object or names no name', () => {
    const root = plantRepo({
      'package.json': manifest({ name: 'root', workspaces: ['packages/*'] }),
      'packages/broken/package.json': 'nope\n',
      'packages/nameless/package.json': manifest({ version: '1.0.0' }),
    });
    const reading = readWorkspacePackagesAt(createGitRunner(root), 'HEAD');
    expect(reading).toEqual(readWorkspacePackages(root));
    expect(reading).toEqual({
      ok: false,
      problem: 'packages/broken/package.json is no JSON object; packages/nameless/package.json names no name',
    });
  });

  it('refuses a commit git cannot show, naming it', () => {
    const root = plantRepo(MIXED_TREE);
    const reading = readWorkspacePackagesAt(createGitRunner(root), 'no-such-ref');
    expect(reading).toMatchObject({ ok: false, problem: expect.stringContaining('no-such-ref:package.json could not be read') });
  });
});

describe('publishableOf and packageNamed', () => {
  it('keeps the members with no private: true, in order, and leaves the list alone', () => {
    const given = [...MIXED_PACKAGES];
    expect(publishableOf(given).map((member) => member.name)).toEqual(['@x/bare', '@x/plugin']);
    expect(given).toEqual([...MIXED_PACKAGES]);
  });

  it('finds a member by its exact name and answers null for one the workspace lacks', () => {
    expect(packageNamed(MIXED_PACKAGES, '@x/core')?.dir).toBe('packages/core');
    expect(packageNamed(MIXED_PACKAGES, 'core')).toBeNull();
    expect(packageNamed([], '@x/core')).toBeNull();
  });
});

describe('readWorkspacePackages over this repository', () => {
  it('reads exactly the folders under packages/ that hold a manifest, the members the workspace-graph sweep lists', () => {
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
    const packagesDir = join(repoRoot, 'packages');
    const folders = readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, 'package.json')))
      .map((entry) => `packages/${entry.name}`)
      .sort();

    const members = packagesOf(readWorkspacePackages(repoRoot));

    expect(folders.length).toBeGreaterThan(0);
    expect(members.map((member) => member.dir).sort()).toEqual(folders);
  });
});
