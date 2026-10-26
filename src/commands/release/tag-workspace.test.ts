/**
 * Integration tests for `rafa release tag` over a settled workspace
 * (`tag.ts`, driven through the command's dispatcher): the repository
 * is the settle tests' own world, `tests/workspace-world.ts`, after
 * `rafa release settle` pushed the one commit that moved the root to
 * 0.5.0 and `@scope/plugin` to 0.2.0, with the caller's clone brought
 * onto `main`, where the tag command runs.
 *
 * A run writes `v0.5.0` and `@scope/plugin@0.2.0` on the release commit
 * and prints two publish lines, the package's in its folder. A second
 * run refuses `tagged`. With the root tagged by hand and the plugin
 * not, a run tags the plugin alone and exits 0. `--push` puts both tags
 * on the bare origin. `rafa release list` and `rafa release status`
 * then read both units with their tags.
 *
 * Everything measured is git's own state after the run, never the
 * command's word for it. Each "left alone" reading is paired with a case
 * where the same probe sees a write:
 *
 *   - a run without `--push` leaves origin with no tag, and the same
 *     world with `--push` leaves it with both;
 *   - the by-hand case checks the root tag's commit before and after,
 *     and the plain case sees the same probe move for the root's tag
 *     when it is the run that writes it;
 *   - the second run's refusal is read off the tag list the first run
 *     left, which the first run's own case shows holding both tags.
 */
import type { PlantedProject } from '../../tests/cli-capture.js';
import type { WorkspaceWorld } from '../../tests/workspace-world.js';
import type { RafaCommand } from '@open-tomato/rafa/core/command';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { dispatchInProject } from '../../tests/cli-capture.js';
import { createWorkspaceWorld, landBoth } from '../../tests/workspace-world.js';

import { createReleaseListCommand } from './list.js';
import { createReleaseSettleCommand } from './settle.js';
import { createReleaseStatusCommand } from './status.js';
import { createReleaseTagCommand } from './tag.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-tag-workspace-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The one subject the cases register. */
const SUBJECTS = [{ name: 'release', summary: 'releases' }];

/** The root's tag after the settle. */
const ROOT_TAG = 'v0.5.0';

/** The plugin's tag after the settle. */
const PLUGIN_TAG = '@scope/plugin@0.2.0';

/** The plugin's folder under the root. */
const PLUGIN_DIR = 'packages/plugin';

/** What a run prints and how it ended. */
interface Run {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Dispatches `words` after `release` with `command` in `project`. */
function dispatch(command: RafaCommand, words: readonly string[], project: PlantedProject): Promise<Run> {
  return dispatchInProject(['release', ...words], SUBJECTS, [command], project);
}

/**
 * A settled world: both fragments landed, `rafa release settle` pushed
 * the release commit to origin's `main`, and the caller's clone is on
 * `main` at that commit, ready for `rafa release tag`.
 */
async function settledWorld(): Promise<WorkspaceWorld> {
  worldCount += 1;
  const w = createWorkspaceWorld(join(tempBase, `world-${String(worldCount)}`));
  landBoth(w);
  const settle = createReleaseSettleCommand({ scratchRoot: w.scratchRoot });
  const settled = await dispatch(settle, ['settle'], w.project);
  expect(settled.exitCode).toBe(0);
  w.git(w.project.root, ['switch', '-q', 'main']);
  w.git(w.project.root, ['pull', '-q', '--ff-only', 'origin', 'main']);
  return w;
}

/** Dispatches `rafa release tag` with `flags` after it in the world's caller, through the system's own git. */
function tag(w: WorkspaceWorld, flags: readonly string[] = []): Promise<Run> {
  return dispatch(createReleaseTagCommand(), ['tag', ...flags], w.project);
}

/** The tags `repo` holds, sorted. */
function tagsIn(w: WorkspaceWorld, repo: string): string[] {
  const listed = w.git(repo, ['tag', '--list']);
  return listed === ''
    ? []
    : listed.split('\n').sort();
}

/** The commit a tag names in the caller's clone. */
function commitOf(w: WorkspaceWorld, name: string): string {
  return w.git(w.project.root, ['rev-parse', `refs/tags/${name}^{commit}`]);
}

/** The caller's HEAD, the release commit. */
function headOf(w: WorkspaceWorld): string {
  return w.git(w.project.root, ['rev-parse', 'HEAD']);
}

describe('rafa release tag over a settled workspace, the run on main', () => {
  it('writes v<x> and @scope/plugin@<y> on the release commit and leaves origin without them', async () => {
    const w = await settledWorld();
    const release = headOf(w);
    // The control: the world starts with no tag at all, so both below are the run's.
    expect(tagsIn(w, w.project.root)).toEqual([]);

    const run = await tag(w);

    expect(run.exitCode).toBe(0);
    expect(tagsIn(w, w.project.root)).toEqual([PLUGIN_TAG, ROOT_TAG]);
    expect(commitOf(w, ROOT_TAG)).toBe(release);
    expect(commitOf(w, PLUGIN_TAG)).toBe(release);
    expect(run.stdout).toContain(`✅ Tagged ${ROOT_TAG} at the HEAD of main.`);
    expect(run.stdout).toContain(`✅ Tagged ${PLUGIN_TAG} at the HEAD of main.`);
    expect(tagsIn(w, w.origin)).toEqual([]);
  });

  it('prints one publish line per unit, the package\'s in its folder', async () => {
    const w = await settledWorld();

    const run = await tag(w);

    const lines = run.stdout.split('\n').filter((line) => line.includes('npm publish'));
    expect(lines).toHaveLength(2);
    expect(lines.filter((line) => line.includes('(cd '))).toHaveLength(1);
    const plain = lines.find((line) => !line.includes('(cd '));
    const inFolder = lines.find((line) => line.includes('(cd '));
    expect(plain?.trim().startsWith('npm publish')).toBe(true);
    expect(inFolder?.trim().startsWith(`(cd ${PLUGIN_DIR} && npm publish)`)).toBe(true);
    expect(run.stdout).toContain(`git push origin ${ROOT_TAG}`);
    expect(run.stdout).toContain(`git push origin ${PLUGIN_TAG}`);
  });

  it('refuses tagged on a second run, writing nothing more', async () => {
    const w = await settledWorld();
    const first = await tag(w);
    expect(first.exitCode).toBe(0);
    const tags = tagsIn(w, w.project.root);
    expect(tags).toEqual([PLUGIN_TAG, ROOT_TAG]);

    const second = await tag(w);

    expect(second.exitCode).toBe(1);
    expect(second.stderr).toContain(`${ROOT_TAG} already names 0.5.0, so there is nothing to tag`);
    expect(second.stderr).toContain(`${PLUGIN_TAG} already names 0.2.0, so there is nothing to tag`);
    expect(second.stdout).not.toContain('✅');
    expect(tagsIn(w, w.project.root)).toEqual(tags);
  });
});

describe('rafa release tag over a settled workspace, the root tagged by hand', () => {
  it('tags the plugin alone and exits 0', async () => {
    const w = await settledWorld();
    w.git(w.project.root, ['tag', ROOT_TAG]);
    const before = commitOf(w, ROOT_TAG);

    const run = await tag(w);

    expect(run.exitCode).toBe(0);
    expect(tagsIn(w, w.project.root)).toEqual([PLUGIN_TAG, ROOT_TAG]);
    expect(commitOf(w, PLUGIN_TAG)).toBe(headOf(w));
    expect(commitOf(w, ROOT_TAG)).toBe(before);
    expect(run.stdout).toContain(`✅ Tagged ${PLUGIN_TAG}`);
    expect(run.stdout).not.toContain(`✅ Tagged ${ROOT_TAG}`);
    expect(run.stdout).toContain(`(cd ${PLUGIN_DIR} && npm publish)`);
    expect(run.stdout).not.toContain(`git push origin ${ROOT_TAG}`);
  });

  it('control: the same tag, written by the run, is the one the probe sees when the root is not tagged', async () => {
    const w = await settledWorld();

    const run = await tag(w);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`✅ Tagged ${ROOT_TAG}`);
    expect(tagsIn(w, w.project.root)).toContain(ROOT_TAG);
  });
});

describe('rafa release tag over a settled workspace, --push', () => {
  it('puts both tags on the bare origin, on the release commit, and drops the push lines', async () => {
    const w = await settledWorld();
    const release = headOf(w);

    const run = await tag(w, ['--push']);

    expect(run.exitCode).toBe(0);
    expect(tagsIn(w, w.origin)).toEqual([PLUGIN_TAG, ROOT_TAG]);
    expect(w.git(w.origin, ['rev-parse', `refs/tags/${ROOT_TAG}^{commit}`])).toBe(release);
    expect(w.git(w.origin, ['rev-parse', `refs/tags/${PLUGIN_TAG}^{commit}`])).toBe(release);
    expect(run.stdout).toContain(`✅ Pushed ${ROOT_TAG} to origin.`);
    expect(run.stdout).toContain(`✅ Pushed ${PLUGIN_TAG} to origin.`);
    expect(run.stdout).not.toContain(`git push origin ${ROOT_TAG}`);
    expect(run.stdout).not.toContain(`git push origin ${PLUGIN_TAG}`);
  });
});

describe('rafa release list and status over a tagged workspace', () => {
  it('lists both units with their tags and none waiting', async () => {
    const w = await settledWorld();
    await tag(w, ['--push']);

    const run = await dispatch(createReleaseListCommand(), ['list'], w.project);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toMatch(new RegExp(`demo\\s+0\\.5\\.0\\s+0 waiting\\s+${ROOT_TAG}\\b`));
    expect(run.stdout).toMatch(new RegExp(`@scope/plugin\\s+0\\.2\\.0\\s+0 waiting\\s+${PLUGIN_TAG}\\b`));
    expect(run.stdout).not.toContain('@scope/core');
  });

  it('lists both units untagged before the run, so the tags above are the run\'s', async () => {
    const w = await settledWorld();

    const run = await dispatch(createReleaseListCommand(), ['list'], w.project);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toMatch(/demo\s+0\.5\.0\s+0 waiting\s+untagged/);
    expect(run.stdout).toMatch(/@scope\/plugin\s+0\.2\.0\s+0 waiting\s+untagged/);
    expect(run.stdout).not.toContain(ROOT_TAG);
    expect(run.stdout).not.toContain(PLUGIN_TAG);
  });

  it('status reads the root\'s tag and the plugin\'s version and tag under packages', async () => {
    const w = await settledWorld();
    await tag(w, ['--push']);

    const run = await dispatch(createReleaseStatusCommand(), ['status'], w.project);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toMatch(new RegExp(`tag\\s+${ROOT_TAG}\\b`));
    expect(run.stdout).toMatch(/packages\s+1 publishable/);
    expect(run.stdout).toMatch(new RegExp(`@scope/plugin\\s+0\\.2\\.0\\s+0 waiting\\s+${PLUGIN_TAG}\\b`));
  });
});
