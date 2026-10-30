/**
 * `rafa release publish` driven through its command over a temporary git
 * repository holding a tagged release commit and a fake
 * {@link PublishRunner}: the tags are real `git tag` objects, read by the
 * system git runner, and only the registry and the publish command are
 * faked. The refusals come first, then the skip, then the publish.
 */
import type { PlantedProject } from '../../../cli-capture.js';
import type { ProcessResult, PublishRunner } from '@open-tomato/rafa-release/commands/release/publish';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createReleasePublishCommand } from '@open-tomato/rafa-release/commands/release/publish';

import { dispatchInProject, plantProject } from '../../../cli-capture.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-publish-repo-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const SUBJECTS = [{ name: 'release', summary: 'releases' }];
const ROOT_TAG = 'v0.5.0';
const PLUGIN = '@scope/plugin';
const PLUGIN_DIR = 'packages/plugin';
const PLUGIN_TAG = `${PLUGIN}@0.2.0`;

let caseCount = 0;

/** Runs git in `cwd`, failing the case loudly when it refuses. */
function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
}

/** Writes both manifests at the given versions and commits them. */
function commitManifests(root: string, rootVersion: string, pluginVersion: string): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: '@demo/root',
    version: rootVersion,
    workspaces: ['packages/*'],
  }));
  mkdirSync(join(root, PLUGIN_DIR), { recursive: true });
  writeFileSync(join(root, PLUGIN_DIR, 'package.json'), JSON.stringify({ name: PLUGIN, version: pluginVersion }));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'release']);
}

/** A repository whose HEAD is a release commit at the given versions, carrying `tags`. */
function releaseRepo(tags: readonly string[], rootVersion = '0.5.0', pluginVersion = '0.2.0'): PlantedProject {
  caseCount += 1;
  const scope = join(tempBase, `case-${String(caseCount)}`);
  mkdirSync(scope, { recursive: true });
  const project = plantProject(scope);
  git(project.root, ['init', '-q']);
  git(project.root, ['config', 'user.email', 'test@example.test']);
  git(project.root, ['config', 'user.name', 'Test']);
  git(project.root, ['config', 'commit.gpgsign', 'false']);
  git(project.root, ['config', 'tag.gpgsign', 'false']);
  commitManifests(project.root, rootVersion, pluginVersion);
  for (const tag of tags) git(project.root, ['tag', tag]);
  return project;
}

/** One call the fake runner recorded. */
interface Call {
  readonly kind: 'npm' | 'shell';
  readonly words: string;
  readonly cwd: string;
}

const NOT_FOUND: ProcessResult = { exitCode: 1, stdout: '', stderr: 'npm error code E404\n' };

/** A fake runner: `held` names the specs the registry holds, `codes` the exit of each publish in turn. */
function fakeRunner(held: readonly string[] = [], codes: readonly number[] = []): { runner: PublishRunner; calls: Call[] } {
  const calls: Call[] = [];
  let published = 0;
  const runner: PublishRunner = {
    npm: (args, cwd) => {
      calls.push({ kind: 'npm', words: args.join(' '), cwd });
      const spec = args[1] ?? '';
      return held.includes(spec)
        ? { exitCode: 0, stdout: `${spec.slice(spec.lastIndexOf('@') + 1)}\n`, stderr: '' }
        : NOT_FOUND;
    },
    shell: (command, cwd) => {
      calls.push({ kind: 'shell', words: command, cwd });
      const code = codes[published] ?? 0;
      published += 1;
      return code;
    },
  };
  return { runner, calls };
}

/** Dispatches `rafa release publish` with `words` over the real repository. */
async function publish(project: PlantedProject, runner: PublishRunner, words: readonly string[] = []) {
  const command = createReleasePublishCommand({ runner });
  return dispatchInProject(['release', 'publish', ...words], SUBJECTS, [command], project);
}

describe('rafa release publish over a tagged repository', () => {
  describe('refuses with exit 1 and runs nothing', () => {
    it('when no release tag points at HEAD', async () => {
      const fake = fakeRunner();

      const run = await publish(releaseRepo(['deploy-7']), fake.runner);

      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain('no release tag points at HEAD');
      expect(fake.calls).toEqual([]);
    });

    it('when --tag points elsewhere', async () => {
      const project = releaseRepo([ROOT_TAG]);
      git(project.root, ['commit', '-q', '--allow-empty', '-m', 'later']);
      const fake = fakeRunner();

      const run = await publish(project, fake.runner, [`--tag=${ROOT_TAG}`]);

      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain(`${ROOT_TAG} does not point at HEAD`);
      expect(fake.calls).toEqual([]);
    });

    it('when a manifest declares a version other than the tag\'s', async () => {
      const fake = fakeRunner();

      const run = await publish(releaseRepo([ROOT_TAG], '0.6.0'), fake.runner);

      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain('names 0.5.0');
      expect(run.stderr).toContain('declares 0.6.0');
      expect(fake.calls).toEqual([]);
    });
  });

  it('skips a version the registry holds with exit 0 and runs no publish', async () => {
    const fake = fakeRunner(['@demo/root@0.5.0']);

    const run = await publish(releaseRepo([ROOT_TAG]), fake.runner);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`Skipped ${ROOT_TAG}`);
    expect(fake.calls.map((call) => call.kind)).toEqual(['npm']);
  });

  it('runs the command in each unit\'s directory, the root first', async () => {
    const project = releaseRepo([PLUGIN_TAG, ROOT_TAG]);
    const fake = fakeRunner();

    const run = await publish(project, fake.runner);

    expect(run.exitCode).toBe(0);
    expect(fake.calls.filter((call) => call.kind === 'shell')).toEqual([
      { kind: 'shell', words: 'npm publish', cwd: project.root },
      { kind: 'shell', words: 'npm publish', cwd: join(project.root, PLUGIN_DIR) },
    ]);
  });

  it('carries a failed publish\'s exit code and names the units published before it', async () => {
    const fake = fakeRunner([], [0, 9]);
    const project = releaseRepo([ROOT_TAG, PLUGIN_TAG]);

    const run = await publish(project, fake.runner);

    expect(run.exitCode).toBe(9);
    expect(run.stderr).toContain(`${ROOT_TAG} was published before it`);
  });

  it('stops at the first failure and tries no later unit', async () => {
    const fake = fakeRunner([], [3]);

    const run = await publish(releaseRepo([ROOT_TAG, PLUGIN_TAG]), fake.runner);

    expect(run.exitCode).toBe(3);
    expect(fake.calls.filter((call) => call.kind === 'shell')).toHaveLength(1);
  });
});
