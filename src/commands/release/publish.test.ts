/**
 * Unit tests for `rafa release publish` (`publish.ts`), driven through
 * the command's dispatcher over a fake git and a fake
 * {@link PublishRunner}: the git answers which tags point at HEAD, and
 * the runner records every `npm view` and every publish command with the
 * directory it ran in, answering what each case plants.
 *
 * Each "ran nothing" reading is the fake runner's call log, and the log
 * is shown to fill in the cases that publish, so an empty log is a
 * reading that could have failed.
 */
import type { ProcessResult, PublishRunner, PublishStdout, ReleasePublishResult } from './publish.js';
import type { GitResult, GitRunner } from '../../pr/index.js';
import type { PlantedProject } from '../../tests/cli-capture.js';
import type { CliEvent } from '@open-tomato/rafa/ports';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import {
  createReleasePublishCommand,
  readRegistry,
  RELEASE_PUBLISH_USAGE,
  selectReleases,
  viewArgs,
} from './publish.js';
import { DEFAULT_REGISTRY } from './tag-follow-ups.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-publish-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many scratch directories this file has made, so each gets its own. */
let scratchCount = 0;

/** A directory of this case's own, under the temporary base. */
function scratch(): string {
  scratchCount += 1;
  const path = join(tempBase, `case-${String(scratchCount)}`);
  mkdirSync(path, { recursive: true });
  return path;
}

/** The subject the command routes under in this file's registry. */
const SUBJECTS = [{ name: 'release', summary: 'releases' }];

/** The root's version and tag. */
const ROOT_VERSION = '0.5.0';
const ROOT_TAG = `v${ROOT_VERSION}`;

/** The plugin's name, folder, version and tag. */
const PLUGIN = '@scope/plugin';
const PLUGIN_DIR = 'packages/plugin';
const PLUGIN_VERSION = '0.2.0';
const PLUGIN_TAG = `${PLUGIN}@${PLUGIN_VERSION}`;

/** The registry the plugin's `publishConfig` names. */
const PLUGIN_REGISTRY = 'https://npm.example.test';

/** One call the fake runner recorded. */
interface RunnerCall {
  readonly kind: 'npm' | 'shell';
  readonly words: string;
  readonly cwd: string;
  readonly stdout?: PublishStdout;
}

/** A fake runner: what `npm view` answers per package spec, and each publish's exit code in turn. */
interface FakeRunner {
  readonly runner: PublishRunner;
  readonly calls: RunnerCall[];
}

/** npm's answer for a version the registry holds. */
function held(version: string): ProcessResult {
  return { exitCode: 0, stdout: `${version}\n`, stderr: '' };
}

/** npm's answer, as 11.16.0 writes it, for a version the registry lacks. */
const NOT_FOUND: ProcessResult = Object.freeze({
  exitCode: 1,
  stdout: '',
  stderr: 'npm error code E404\nnpm error 404 No match found for version 0.5.0\n',
});

/** Makes a fake runner; a spec `views` leaves out answers {@link NOT_FOUND}. */
function fakeRunner(views: Readonly<Record<string, ProcessResult>> = {}, codes: readonly number[] = []): FakeRunner {
  const calls: RunnerCall[] = [];
  let published = 0;
  const runner: PublishRunner = {
    npm: (args, cwd) => {
      calls.push({ kind: 'npm', words: args.join(' '), cwd });
      return views[args[1] ?? ''] ?? NOT_FOUND;
    },
    shell: (command, cwd, stdout) => {
      calls.push({ kind: 'shell', words: command, cwd, stdout });
      const code = codes[published] ?? 0;
      published += 1;
      return code;
    },
  };
  return { runner, calls };
}

/** A fake git that answers `tags` for `git tag --points-at HEAD`, or `listing` when given. */
function fakeGit(tags: readonly string[], listing?: GitResult): (root: string) => GitRunner {
  return () => (args) => {
    if (args.join(' ') === 'tag --points-at HEAD') return listing ?? { ok: true, stdout: `${tags.join('\n')}\n`, stderr: '' };
    return { ok: false, stdout: '', stderr: `fatal: the fake answers no ${args.join(' ')}` };
  };
}

/** A project whose root manifest is at `rootVersion` with the plugin member at `pluginVersion`. */
function workspaceProject(
  options: { rootVersion?: string; pluginVersion?: string; rootPrivate?: boolean; config?: string } = {},
): PlantedProject {
  const project = options.config === undefined
    ? plantProject(scratch())
    : plantProject(scratch(), options.config);
  const root = {
    name: '@demo/root',
    version: options.rootVersion ?? ROOT_VERSION,
    workspaces: ['packages/*'],
    ...(options.rootPrivate === true
      ? { private: true }
      : {}),
  };
  writeFileSync(join(project.root, 'package.json'), `${JSON.stringify(root, null, 2)}\n`);
  mkdirSync(join(project.root, PLUGIN_DIR), { recursive: true });
  const plugin = {
    name: PLUGIN,
    version: options.pluginVersion ?? PLUGIN_VERSION,
    publishConfig: { registry: PLUGIN_REGISTRY },
  };
  writeFileSync(join(project.root, PLUGIN_DIR, 'package.json'), `${JSON.stringify(plugin, null, 2)}\n`);
  return project;
}

/** What a run printed, how it ended and its events in json mode. */
interface Run {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly events: readonly CliEvent[];
}

/** Dispatches `rafa release publish` with `words`, over a git listing `tags` and `fake`, in `project`. */
async function publish(
  project: PlantedProject,
  tags: readonly string[],
  fake: FakeRunner,
  words: readonly string[] = [],
  listing?: GitResult,
): Promise<Run> {
  const command = createReleasePublishCommand({ git: fakeGit(tags, listing), runner: fake.runner });
  const run = await dispatchInProject(['release', 'publish', ...words], SUBJECTS, [command], project);
  return {
    ...run,
    events: words.includes('--output=json')
      ? eventsOf(run.stdout)
      : [],
  };
}

/** The result data of a json-mode run. */
function dataOf(run: Run): ReleasePublishResult {
  return (run.events.at(-1) as { data?: unknown }).data as ReleasePublishResult;
}

describe('the registry reading', () => {
  it('reads the version on stdout of an exit 0 as held', () => {
    expect(readRegistry(held('0.5.0'), '0.5.0')).toEqual({ kind: 'held' });
  });

  it('reads an E404 and an exit 0 that names no version as absent', () => {
    expect(readRegistry(NOT_FOUND, '0.5.0')).toEqual({ kind: 'absent' });
    expect(readRegistry({ exitCode: 0, stdout: '', stderr: '' }, '0.5.0')).toEqual({ kind: 'absent' });
    expect(readRegistry(held('0.4.0'), '0.5.0')).toEqual({ kind: 'absent' });
  });

  it('reads any other failure as unread, with what npm said', () => {
    const reading = readRegistry({ exitCode: 1, stdout: '', stderr: 'npm error code ENOTFOUND\n' }, '0.5.0');

    expect(reading).toEqual({ kind: 'unread', problem: 'npm error code ENOTFOUND' });
  });

  it('spells the npm view words with the name, the version and the registry', () => {
    const unit = {
      tag: PLUGIN_TAG,
      package: PLUGIN,
      name: PLUGIN,
      version: PLUGIN_VERSION,
      dir: PLUGIN_DIR,
      registry: PLUGIN_REGISTRY,
      unpublishable: false,
    };

    expect(viewArgs(unit)).toEqual(['view', PLUGIN_TAG, 'version', `--registry=${PLUGIN_REGISTRY}`]);
  });
});

describe('the units on HEAD', () => {
  it('keeps the release tags, the root first, and passes over a tag in no release spelling', () => {
    const releases = selectReleases([PLUGIN_TAG, 'deploy-7', ROOT_TAG], null);

    expect(releases.map((each) => each.tag)).toEqual([ROOT_TAG, PLUGIN_TAG]);
  });

  it('keeps only the tag --tag names', () => {
    expect(selectReleases([ROOT_TAG, PLUGIN_TAG], PLUGIN_TAG).map((each) => each.tag)).toEqual([PLUGIN_TAG]);
  });
});

describe('rafa release publish', () => {
  it('publishes every unit tagged at HEAD in its own directory, the root first, after asking each registry', async () => {
    const project = workspaceProject();
    const fake = fakeRunner();

    const run = await publish(project, [PLUGIN_TAG, ROOT_TAG], fake);

    expect(run.exitCode).toBe(0);
    expect(fake.calls).toEqual([
      { kind: 'npm', words: `view @demo/root@${ROOT_VERSION} version --registry=${DEFAULT_REGISTRY}`, cwd: project.root },
      { kind: 'shell', words: 'npm publish', cwd: project.root, stdout: 'inherit' },
      { kind: 'npm', words: `view ${PLUGIN_TAG} version --registry=${PLUGIN_REGISTRY}`, cwd: join(project.root, PLUGIN_DIR) },
      { kind: 'shell', words: 'npm publish', cwd: join(project.root, PLUGIN_DIR), stdout: 'inherit' },
    ]);
    expect(run.stdout).toContain(`✅ Published ${ROOT_TAG}.`);
    expect(run.stdout).toContain(`✅ Published ${PLUGIN_TAG}.`);
  });

  it('runs the command release.publishCommand names', async () => {
    const project = workspaceProject({ config: 'release:\n  publishCommand: pnpm publish --no-git-checks\n' });
    const fake = fakeRunner();

    const run = await publish(project, [ROOT_TAG], fake);

    expect(run.exitCode).toBe(0);
    expect(fake.calls.filter((call) => call.kind === 'shell').map((call) => call.words))
      .toEqual(['pnpm publish --no-git-checks']);
  });

  it('skips a version the registry holds with one Skipped line, runs no publish for it and exits 0', async () => {
    const project = workspaceProject();
    const fake = fakeRunner({ [`@demo/root@${ROOT_VERSION}`]: held(ROOT_VERSION) });

    const run = await publish(project, [ROOT_TAG, PLUGIN_TAG], fake);

    expect(run.exitCode).toBe(0);
    const skippedLines = run.stdout.split('\n').filter((line) => line.startsWith('Skipped'));
    expect(skippedLines).toEqual([`Skipped ${ROOT_TAG}: ${DEFAULT_REGISTRY} holds @demo/root@${ROOT_VERSION} already.`]);
    // The control: the plugin, which the registry lacks, still publishes.
    expect(fake.calls.filter((call) => call.kind === 'shell').map((call) => call.cwd))
      .toEqual([join(project.root, PLUGIN_DIR)]);
  });

  it('skips a private root without asking the registry, and publishes the package beside it', async () => {
    const project = workspaceProject({ rootPrivate: true });
    const fake = fakeRunner();

    const run = await publish(project, [ROOT_TAG, PLUGIN_TAG], fake);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`Skipped ${ROOT_TAG}: @demo/root is private, so there is nothing to publish.`);
    expect(fake.calls.map((call) => [call.kind, call.cwd])).toEqual([
      ['npm', join(project.root, PLUGIN_DIR)],
      ['shell', join(project.root, PLUGIN_DIR)],
    ]);
  });

  it('stops at the first publish that fails, with its exit code, and tries no unit after it', async () => {
    const project = workspaceProject();
    const fake = fakeRunner({}, [7]);

    const run = await publish(project, [ROOT_TAG, PLUGIN_TAG], fake);

    expect(run.exitCode).toBe(7);
    expect(run.stderr).toContain(`npm publish exited 7 publishing ${ROOT_TAG} from the root; nothing was published before it`);
    expect(fake.calls.filter((call) => call.kind === 'shell')).toHaveLength(1);
  });

  it('names the units published before the one that failed', async () => {
    const project = workspaceProject();
    const fake = fakeRunner({}, [0, 1]);

    const run = await publish(project, [ROOT_TAG, PLUGIN_TAG], fake);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`publishing ${PLUGIN_TAG} from ${PLUGIN_DIR}; ${ROOT_TAG} was published before it`);
  });

  it('stops with exit 1 when the registry could not be asked, publishing nothing', async () => {
    const project = workspaceProject();
    const fake = fakeRunner({ [`@demo/root@${ROOT_VERSION}`]: { exitCode: 1, stdout: '', stderr: 'npm error code ETIMEDOUT' } });

    const run = await publish(project, [ROOT_TAG], fake);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('npm error code ETIMEDOUT');
    expect(fake.calls.map((call) => call.kind)).toEqual(['npm']);
  });

  it('prints each unit\'s line under --dry-run and runs nothing, not even npm view', async () => {
    const project = workspaceProject();
    const fake = fakeRunner();

    const run = await publish(project, [ROOT_TAG, PLUGIN_TAG], fake, ['--dry-run']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`Would publish ${ROOT_TAG} from the root with npm publish, unless ${DEFAULT_REGISTRY}`
      + ` holds @demo/root@${ROOT_VERSION}.`);
    expect(run.stdout).toContain(`Would publish ${PLUGIN_TAG} from ${PLUGIN_DIR} with npm publish`);
    expect(fake.calls).toEqual([]);
  });

  it('gives the units, the skipped, the published and the exit as json, the publish\'s stdout sent to stderr', async () => {
    const project = workspaceProject();
    const fake = fakeRunner({ [PLUGIN_TAG]: held(PLUGIN_VERSION) });

    const run = await publish(project, [ROOT_TAG, PLUGIN_TAG], fake, ['--output=json']);
    const data = dataOf(run);

    expect(run.exitCode).toBe(0);
    expect(data.units.map((unit) => [unit.tag, unit.dir, unit.registry]))
      .toEqual([[ROOT_TAG, null, DEFAULT_REGISTRY], [PLUGIN_TAG, PLUGIN_DIR, PLUGIN_REGISTRY]]);
    expect(data.skipped).toEqual([
      { tag: PLUGIN_TAG, reason: 'held', message: `${PLUGIN_REGISTRY} holds ${PLUGIN_TAG} already` },
    ]);
    expect(data.published).toEqual([ROOT_TAG]);
    expect(data.exit).toBe(0);
    expect(data.dryRun).toBe(false);
    expect(fake.calls.find((call) => call.kind === 'shell')?.stdout).toBe('stderr');
  });

  describe('refuses with exit 1 before anything runs', () => {
    it('when no release tag points at HEAD', async () => {
      const fake = fakeRunner();

      const run = await publish(workspaceProject(), ['deploy-7'], fake);

      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain('no release tag points at HEAD');
      expect(run.stderr).toContain(`Usage: ${RELEASE_PUBLISH_USAGE}`);
      expect(fake.calls).toEqual([]);
    });

    it('when --tag points elsewhere', async () => {
      const fake = fakeRunner();

      const run = await publish(workspaceProject(), [ROOT_TAG], fake, [`--tag=${PLUGIN_TAG}`]);

      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain(`${PLUGIN_TAG} does not point at HEAD`);
      expect(fake.calls).toEqual([]);
    });

    it('when --tag parses as no release tag', async () => {
      const fake = fakeRunner();

      const run = await publish(workspaceProject(), ['0.5.0'], fake, ['--tag=0.5.0']);

      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain('0.5.0 is no release tag');
      expect(fake.calls).toEqual([]);
    });

    it('when a manifest declares a version other than its tag\'s, naming both', async () => {
      const fake = fakeRunner();

      const run = await publish(workspaceProject({ pluginVersion: '0.3.0' }), [ROOT_TAG, PLUGIN_TAG], fake);

      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain(`${PLUGIN_TAG} names ${PLUGIN_VERSION} and ${PLUGIN_DIR}/package.json declares 0.3.0 at HEAD`);
      // The root agreed with its tag, and is not published either: every unit is read first.
      expect(fake.calls).toEqual([]);
    });

    it('when a tag names a package the workspace does not publish', async () => {
      const fake = fakeRunner();

      const run = await publish(workspaceProject(), ['@scope/other@1.0.0'], fake);

      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain('@scope/other@1.0.0 names @scope/other, which is no publishable package');
      expect(fake.calls).toEqual([]);
    });

    it('when the tags on HEAD could not be read', async () => {
      const fake = fakeRunner();
      const listing: GitResult = { ok: false, stdout: '', stderr: 'fatal: not a git repository' };

      const run = await publish(workspaceProject(), [], fake, [], listing);

      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain('the tags on HEAD could not be read: fatal: not a git repository');
      expect(fake.calls).toEqual([]);
    });

    it('when --dry-run is handed a value', async () => {
      const run = await publish(workspaceProject(), [ROOT_TAG], fakeRunner(), ['--dry-run=soon']);

      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain('--dry-run takes no value');
    });
  });
});

describe('the command declaration', () => {
  it('routes under release, declares the two flags and no spends', () => {
    const command = createReleasePublishCommand();

    expect(command.name).toBe('release publish');
    expect(command.flags.map((flag) => flag.name)).toEqual(['tag', 'dry-run']);
    expect(command.spends).toBeUndefined();
    expect(command.examples.length).toBeGreaterThan(0);
  });
});
