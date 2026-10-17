/**
 * Tests for `rafa release list` (`list.ts`): the rows it writes, the
 * json result it gives, and what an unreadable base leaves.
 *
 * The dispatched cases drive a real scratch world, as
 * `status-fragments.test.ts` does: a bare origin, a clone that lands
 * commits on `main` and pushes them, and the caller's clone the command
 * runs in, its config planted beside the checkout. So the waiting
 * counts and the tags are git's own answers, not a table's. The
 * renderer is pure and is driven by calling it.
 *
 * Controls for readings that would pass while wrong:
 *
 *   - the workspace holds a private member, which no row may name, so
 *     the publishable filter is known to apply;
 *   - the root and the plugin have different waiting counts, so a count
 *     read off the whole batch rather than per unit would fail;
 *   - the plugin carries `0.9.0` and `0.10.0` tags, which git lists and
 *     a string sort orders the other way, so a tag not picked by semantic
 *     version would fail, and the root's tag column is known not to pick
 *     a plugin tag;
 *   - the unreadable base case deletes only `origin/main`, and the tag
 *     columns still read, so the `?` is known to come from the base.
 */
import type { ReleaseListReading, ReleaseListResult } from './list.js';
import type { Fragment } from '../../release/fragment.js';
import type { PlantedProject } from '../../tests/cli-capture.js';
import type { CliEvent } from '@open-tomato/rafa/ports';

import '../../adapter-registry.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { serializeFragment } from '../../release/fragment.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';
import { gitIdentityEnv } from '../../tests/git-identity.js';

import { createReleaseListCommand, RELEASE_LIST_USAGE, renderList } from './list.js';
import { UNTAGGED } from './status-packages.js';
import { UNREADABLE } from './status.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-list-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directory. */
let worldCount = 0;

/** The committer date every setup commit gets. */
const SETUP_DATE = '2026-09-01T12:00:00Z';

/** What `main` is seeded with: a root workspace, a publishable `packages/plugin` and a private `packages/core`. */
const SEED: Readonly<Record<string, string>> = {
  'package.json': '{\n  "name": "demo",\n  "version": "0.25.0",\n  "workspaces": ["packages/*"]\n}\n',
  'packages/plugin/package.json': '{\n  "name": "@scope/plugin",\n  "version": "0.10.0"\n}\n',
  'packages/core/package.json': '{\n  "name": "@scope/core",\n  "version": "0.0.0",\n  "private": true\n}\n',
};

/** The config every dispatched case runs under. */
const CONFIG = 'release:\n  versionFile: package.json\n';

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

/** A fragment's text, for the root unless `pkg` names a package. */
function fragmentText(plan: string, level: Fragment['level'], pkg: string | null = null): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level, package: pkg, notes: [`- Area: ${plan} change`] });
}

/** A bare origin, a clone that lands on `main`, and the caller's clone the command runs in. */
interface World {
  /** The project the command is dispatched in: the caller's clone, beside an empty home. */
  readonly project: PlantedProject;
  /** Runs git in the caller's clone under the isolated environment. */
  readonly inCaller: (args: readonly string[]) => void;
}

/**
 * A world whose `main` holds {@link SEED} and one root and two plugin
 * fragments, fetched by the caller, which holds `v0.25.0` and two plugin tags.
 */
function world(): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const origin = join(dir, 'origin.git');
  const other = join(dir, 'other');
  const caller = join(dir, 'caller');
  mkdirSync(home, { recursive: true });
  const git = (cwd: string, args: readonly string[]): void => {
    execFileSync('git', [...args], { cwd, env: isolatedEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
  };
  const files: Readonly<Record<string, string>> = {
    ...SEED,
    '.changes/rafa-9.md': fragmentText('rafa-9', 'minor'),
    '.changes/rafa-12.md': fragmentText('rafa-12', 'patch', '@scope/plugin'),
    '.changes/rafa-13.md': fragmentText('rafa-13', 'minor', '@scope/plugin'),
  };

  git(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(dir, ['clone', '-q', origin, other]);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(other, path)), { recursive: true });
    writeFileSync(join(other, path), text);
  }
  git(other, ['add', '-A']);
  git(other, ['commit', '-q', '-m', 'first']);
  git(other, ['push', '-q', 'origin', 'main']);
  git(dir, ['clone', '-q', origin, caller]);
  for (const tag of ['v0.25.0', '@scope/plugin@0.9.0', '@scope/plugin@0.10.0']) git(caller, ['tag', tag]);

  plantProjectConfig(caller, CONFIG);
  const projectHome = join(dir, 'project-home');
  mkdirSync(projectHome);
  return { project: { root: caller, home: projectHome }, inCaller: (args) => git(caller, args) };
}

/** Dispatches `rafa release list` with `words` after it in `project`, through the system's own git. */
async function ran(
  project: PlantedProject,
  words: readonly string[] = [],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return dispatchInProject(['release', 'list', ...words], [{ name: 'release', summary: 'releases' }], [createReleaseListCommand()], project);
}

/** The data of the terminal result event. */
function dataOf(events: readonly CliEvent[]): unknown {
  return (events.at(-1) as { data?: unknown }).data;
}

describe('rafa release list', () => {
  it('writes the root first, then each publishable package, with its version, waiting count and newest tag', async () => {
    const w = world();

    const run = await ran(w.project);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe([
      'demo           0.25.0  1 waiting  v0.25.0',
      '@scope/plugin  0.10.0  2 waiting  @scope/plugin@0.10.0',
      '',
    ].join('\n'));
  });

  it('gives the rows, the root with package null, and the rendered text as the json result', async () => {
    const w = world();

    const run = await ran(w.project, ['--output=json']);

    expect(run.exitCode).toBe(0);
    const data = dataOf(eventsOf(run.stdout)) as ReleaseListResult;
    expect(data.reading).toEqual({
      tagsRead: true,
      problems: [],
      rows: [
        { package: null, name: 'demo', dir: '.', version: '0.25.0', waiting: 1, tag: 'v0.25.0' },
        { package: '@scope/plugin', name: '@scope/plugin', dir: 'packages/plugin', version: '0.10.0', waiting: 2, tag: '@scope/plugin@0.10.0' },
      ],
    });
    expect(data.text).toBe(renderList(data.reading));
  });

  it('marks every waiting column unreadable and says why under the rows when the base cannot be read, and exits 0', async () => {
    const w = world();
    w.inCaller(['update-ref', '-d', 'refs/remotes/origin/main']);

    const run = await ran(w.project);

    expect(run.exitCode).toBe(0);
    const [rows, problems] = run.stdout.split('\n\n');
    expect(rows).toBe([
      `demo           0.25.0  ${UNREADABLE} waiting  v0.25.0`,
      `@scope/plugin  0.10.0  ${UNREADABLE} waiting  @scope/plugin@0.10.0`,
    ].join('\n'));
    expect(problems).toStartWith('the tree of origin/main could not be read: ');
  });

  it('refuses a stray word with exit 1 and the usage line', async () => {
    const w = world();

    const run = await ran(w.project, ['extra']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`Usage: ${RELEASE_LIST_USAGE}`);
  });
});

describe('renderList', () => {
  it('writes untagged for a unit with no tag and each failed reading after a blank line', () => {
    const reading: ReleaseListReading = {
      tagsRead: true,
      problems: ['the version file could not be read at /x/package.json'],
      rows: [
        { package: null, name: 'package.json', dir: '.', version: null, waiting: 0, tag: null },
        { package: 'tool', name: 'tool', dir: 'packages/tool', version: '12.0.0', waiting: 10, tag: null },
      ],
    };

    expect(renderList(reading)).toBe([
      `package.json  ${UNREADABLE}       0 waiting   ${UNTAGGED}`,
      `tool          12.0.0  10 waiting  ${UNTAGGED}`,
      '',
      'the version file could not be read at /x/package.json',
    ].join('\n'));
  });

  it('marks every tag column unreadable when the tags could not be read', () => {
    const reading: ReleaseListReading = {
      tagsRead: false,
      problems: [],
      rows: [{ package: null, name: 'demo', dir: '.', version: '1.0.0', waiting: 0, tag: null }],
    };

    expect(renderList(reading)).toBe(`demo  1.0.0  0 waiting  ${UNREADABLE}`);
  });
});
