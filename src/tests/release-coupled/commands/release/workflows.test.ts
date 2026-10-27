/**
 * Tests for `rafa release workflows [--write]` (`workflows.ts`), dispatched
 * in-process over a temporary project root.
 *
 * The templates are read from a planted module directory holding a
 * `templates/` folder with one short text per ladder workflow, so every
 * row has a template to compare against whatever the build ships today;
 * one case reads the module's own directory, to hold the shipped publish
 * template to the same comparison.
 *
 * Controls for readings that would pass while wrong:
 *
 *   - the level 0 case writes nothing with `--write`, so a write is known
 *     to follow `needed` rather than `missing` alone;
 *   - the differing file and the present file sit side by side in one
 *     run, so `differs` is known to come from the bytes and not the path;
 *   - the Dependabot cases run the same level with and without
 *     `.github/dependabot.yml`, so the bot row's `needed` is known to read
 *     the file.
 */
import type { PlantedProject } from '../../../cli-capture.js';
import type { CliEvent } from '@open-tomato/rafa/ports';
import type { ReleaseWorkflowsResult, WorkflowRow } from '@open-tomato/rafa-release/commands/release/workflows';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createReleaseWorkflowsCommand, RELEASE_WORKFLOWS_USAGE } from '@open-tomato/rafa-release/commands/release/workflows';
import { LADDER_WORKFLOWS } from '@open-tomato/rafa-release/release/ladder';
import { readReleaseTemplate } from '@open-tomato/rafa-release/release/templates';

import { dispatchInProject, eventsOf, plantProject } from '../../../cli-capture.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-workflows-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many scopes this file has made, so each gets its own directory. */
let scopeCount = 0;

/** The config of each level the cases run at. */
const LEVEL_0 = 'release:\n  versionFile: package.json\n';
const LEVEL_2 = 'release:\n  versionFile: package.json\n  publish: ci\n';
const LEVEL_3 = 'release:\n  versionFile: package.json\n  settle: pr\n  tag: settle\n  publish: ci\n';

const PUBLISH = '.github/workflows/release-publish.yml';
const TAG = '.github/workflows/release-tag.yml';
const SETTLE = '.github/workflows/release-settle.yml';
const BOT = '.github/workflows/release-bot-fragment.yml';

/** The planted template text of `file`. */
function fakeTemplate(file: string): string {
  return `name: planted ${file}\non: push\n`;
}

/** A module directory holding a planted template for each ladder workflow but those in `without`. */
function plantModuleDir(scope: string, without: readonly string[] = []): string {
  const dir = join(scope, 'module');
  mkdirSync(join(dir, 'templates'), { recursive: true });
  for (const entry of LADDER_WORKFLOWS) {
    if (!without.includes(entry.file)) writeFileSync(join(dir, 'templates', entry.file), fakeTemplate(entry.file));
  }
  return dir;
}

/** A project at `config` with the files of `files` written under its root. */
function plant(config: string, files: Readonly<Record<string, string>> = {}): { project: PlantedProject; scope: string } {
  scopeCount += 1;
  const scope = join(tempBase, `scope-${String(scopeCount)}`);
  mkdirSync(scope);
  const project = plantProject(scope, config);
  writeFileSync(join(project.root, 'package.json'), '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(project.root, path)), { recursive: true });
    writeFileSync(join(project.root, path), text);
  }
  return { project, scope };
}

/** Dispatches `rafa release workflows` with `words`, the templates read from `moduleDir`. */
function ran(
  project: PlantedProject,
  words: readonly string[],
  moduleDir: string | undefined,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const command = createReleaseWorkflowsCommand(moduleDir === undefined
    ? {}
    : { moduleDir });
  return dispatchInProject(['release', 'workflows', ...words], [{ name: 'release', summary: 'releases' }], [command], project);
}

/** The data of the terminal result event. */
function resultOf(stdout: string): ReleaseWorkflowsResult {
  const events: CliEvent[] = eventsOf(stdout);
  return (events.at(-1) as { data?: unknown }).data as ReleaseWorkflowsResult;
}

/** Each row as `[path, needed, state]`. */
function brief(rows: readonly WorkflowRow[]): [string, boolean, string][] {
  return rows.map((row) => [row.path, row.needed, row.state]);
}

/** The text at `path` under the project root. */
function textAt(project: PlantedProject, path: string): string {
  return readFileSync(join(project.root, path), 'utf8');
}

describe('rafa release workflows', () => {
  it('writes the level and one row per ladder workflow with its levels, need and state, and exits 0', async () => {
    const { project, scope } = plant(LEVEL_2);

    const run = await ran(project, [], plantModuleDir(scope));

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe([
      'Release ladder: level 2, CI publishes.',
      '.github/workflows/release-publish.yml       level 2, 3, 4  needed      missing',
      '.github/workflows/release-tag.yml           level 3        not needed  missing',
      '.github/workflows/release-settle.yml        level 4        not needed  missing',
      '.github/workflows/release-bot-fragment.yml  level 3, 4     not needed  missing',
      '',
    ].join('\n'));
    expect(existsSync(join(project.root, '.github'))).toBe(false);
  });

  it('reads present for the template\'s bytes and differs for others, side by side', async () => {
    const { project, scope } = plant(LEVEL_3, {
      [PUBLISH]: fakeTemplate('release-publish.yml'),
      [TAG]: `${fakeTemplate('release-tag.yml')}# edited\n`,
    });

    const run = await ran(project, ['--output=json'], plantModuleDir(scope));

    expect(run.exitCode).toBe(0);
    const result = resultOf(run.stdout);
    expect(result.level).toEqual({ level: 3, name: 'Release PR', misfit: null });
    expect(brief(result.rows)).toEqual([
      [PUBLISH, true, 'present'],
      [TAG, true, 'differs'],
      [SETTLE, false, 'missing'],
      [BOT, false, 'missing'],
    ]);
    expect(result.write).toBe(false);
    expect(result.writes).toEqual([]);
  });

  it('carries every field of a row in json, a missing path found absent', async () => {
    const { project, scope } = plant(LEVEL_2);

    const run = await ran(project, ['--output=json'], plantModuleDir(scope));

    expect(resultOf(run.stdout).rows[0]).toEqual({
      file: 'release-publish.yml',
      path: PUBLISH,
      levels: [2, 3, 4],
      needed: true,
      state: 'missing',
      found: 'absent',
      problem: null,
    });
  });

  it('needs the bot fragment workflow at level 3 only while .github/dependabot.yml exists', async () => {
    const without = plant(LEVEL_3);
    const withBot = plant(LEVEL_3, { '.github/dependabot.yml': 'version: 2\n' });

    const runWithout = await ran(without.project, ['--output=json'], plantModuleDir(without.scope));
    const runWith = await ran(withBot.project, ['--output=json'], plantModuleDir(withBot.scope));

    expect(resultOf(runWithout.stdout).rows.find((row) => row.path === BOT)?.needed).toBe(false);
    expect(resultOf(runWith.stdout).rows.find((row) => row.path === BOT)?.needed).toBe(true);
  });

  it('writes with --write each needed missing workflow from its template, and none the level does not need', async () => {
    const { project, scope } = plant(LEVEL_2);

    const run = await ran(project, ['--write'], plantModuleDir(scope));

    expect(run.exitCode).toBe(0);
    expect(textAt(project, PUBLISH)).toBe(fakeTemplate('release-publish.yml'));
    for (const path of [TAG, SETTLE, BOT]) expect(existsSync(join(project.root, path))).toBe(false);
    expect(run.stdout).toContain(`${PUBLISH}: created, written from `);
  });

  it('writes nothing with --write at level 0, where no workflow is needed', async () => {
    const { project, scope } = plant(LEVEL_0);

    const run = await ran(project, ['--write', '--output=json'], plantModuleDir(scope));

    expect(run.exitCode).toBe(0);
    const result = resultOf(run.stdout);
    expect(result.rows.every((row) => !row.needed && row.state === 'missing')).toBe(true);
    expect(result.writes).toEqual([]);
    expect(existsSync(join(project.root, '.github'))).toBe(false);
  });

  it('leaves a present and a differing file byte for byte under --write and names each', async () => {
    const edited = `${fakeTemplate('release-tag.yml')}# edited\n`;
    const { project, scope } = plant(LEVEL_3, {
      [PUBLISH]: fakeTemplate('release-publish.yml'),
      [TAG]: edited,
    });

    const run = await ran(project, ['--write', '--output=json'], plantModuleDir(scope));

    expect(run.exitCode).toBe(0);
    expect(resultOf(run.stdout).writes).toEqual([
      { path: PUBLISH, outcome: 'kept', detail: 'left as it is (present)' },
      { path: TAG, outcome: 'kept', detail: 'left as it is (differs)' },
    ]);
    expect(textAt(project, TAG)).toBe(edited);
  });

  it('reads a directory at a workflow path as missing, refuses to write over it and still exits 0', async () => {
    const { project, scope } = plant(LEVEL_2);
    mkdirSync(join(project.root, PUBLISH), { recursive: true });

    const run = await ran(project, ['--write'], plantModuleDir(scope));

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('.github/workflows/release-publish.yml       level 2, 3, 4  needed      missing (not a file)');
    expect(run.stdout).toContain(`${PUBLISH}: refused, `);
  });

  it('names a present file whose template is not shipped as uncompared, and a needed one it cannot write as refused, exiting 0', async () => {
    const { project, scope } = plant(LEVEL_3, { [PUBLISH]: 'name: mine\n' });
    const moduleDir = plantModuleDir(scope, ['release-publish.yml', 'release-tag.yml']);

    const run = await ran(project, ['--write', '--output=json'], moduleDir);

    expect(run.exitCode).toBe(0);
    const result = resultOf(run.stdout);
    const publish = result.rows.find((row) => row.path === PUBLISH);
    expect(publish?.state).toBe('present');
    expect(publish?.problem).toStartWith('its bytes were not compared: release templates: the workflow release-publish.yml is missing');
    expect(result.writes.find((each) => each.path === TAG)?.outcome).toBe('refused');
    expect(existsSync(join(project.root, TAG))).toBe(false);
  });

  it('compares against the shipped publish template when no module directory is handed', async () => {
    const { project } = plant(LEVEL_2, { [PUBLISH]: readReleaseTemplate('release-publish.yml') });

    const run = await ran(project, ['--output=json'], undefined);

    expect(run.exitCode).toBe(0);
    expect(resultOf(run.stdout).rows[0]?.state).toBe('present');
  });

  it('refuses a stray word with exit 1 and the usage line', async () => {
    const { project, scope } = plant(LEVEL_2);

    const run = await ran(project, ['extra'], plantModuleDir(scope));

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`Usage: ${RELEASE_WORKFLOWS_USAGE}`);
  });

  it('refuses a value on --write with exit 1 and writes nothing', async () => {
    const { project, scope } = plant(LEVEL_2);

    const run = await ran(project, ['--write=yes'], plantModuleDir(scope));

    expect(run.exitCode).toBe(1);
    expect(existsSync(join(project.root, '.github'))).toBe(false);
  });
});
