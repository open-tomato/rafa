/**
 * `rafa release workflows` dispatched over temporary projects at levels
 * 2, 3 and 4, reading the templates this build ships (no planted module
 * directory), and the guards of the two stage templates read through
 * `Bun.YAML.parse`.
 *
 * Controls: each level's run is paired with the needed set of the other
 * levels, so a set that follows the level is told from one that is
 * always the same; `--write` is checked against the bytes of a present
 * and an edited copy kept side by side with the files it creates.
 */
import type { ReleaseWorkflowsResult } from './workflows.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import '../../adapter-registry.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { isMapping } from '@open-tomato/rafa/core/config/sections';

import { RELEASE_PUBLISH_FILE, RELEASE_SETTLE_FILE, RELEASE_TAG_FILE, readReleaseTemplate } from '../../release/templates.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createReleaseWorkflowsCommand } from './workflows.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-workflows-levels-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let scopeCount = 0;

const HEAD = 'release:\n  versionFile: package.json\n';
const CONFIGS: Readonly<Record<2 | 3 | 4, string>> = {
  2: `${HEAD}  publish: ci\n`,
  3: `${HEAD}  settle: pr\n  tag: settle\n  publish: ci\n`,
  4: `${HEAD}  settle: push\n  tag: settle\n  publish: ci\n`,
};
const NEEDED: Readonly<Record<2 | 3 | 4, readonly string[]>> = {
  2: [RELEASE_PUBLISH_FILE],
  3: [RELEASE_PUBLISH_FILE, RELEASE_TAG_FILE],
  4: [RELEASE_PUBLISH_FILE, RELEASE_SETTLE_FILE],
};
const LEVELS = [2, 3, 4] as const;

function wfPath(file: string): string {
  return `.github/workflows/${file}`;
}

function plant(level: 2 | 3 | 4, files: Readonly<Record<string, string>> = {}): PlantedProject {
  scopeCount += 1;
  const scope = join(tempBase, `scope-${String(scopeCount)}`);
  mkdirSync(scope);
  const project = plantProject(scope, CONFIGS[level]);
  writeFileSync(join(project.root, 'package.json'), '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n');
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(project.root, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(project.root, wfPath(file)), text);
  }
  return project;
}

async function run(project: PlantedProject, words: readonly string[]): Promise<{ exitCode: number | null; result: ReleaseWorkflowsResult }> {
  const captured = await dispatchInProject(
    ['release', 'workflows', '--output=json', ...words],
    [{ name: 'release', summary: 'releases' }],
    [createReleaseWorkflowsCommand()],
    project,
  );
  const last = eventsOf(captured.stdout).at(-1) as { data?: unknown };
  return { exitCode: captured.exitCode, result: last.data as ReleaseWorkflowsResult };
}

function neededFiles(result: ReleaseWorkflowsResult): string[] {
  return result.rows.filter((row) => row.needed).map((row) => row.file);
}

function written(project: PlantedProject): string[] {
  const dir = join(project.root, '.github', 'workflows');
  return existsSync(dir)
    ? readdirSync(dir).sort()
    : [];
}

describe('rafa release workflows over the shipped templates', () => {
  for (const level of LEVELS) {
    it(`reads level ${String(level)} and the set of workflows it needs`, async () => {
      const { exitCode, result } = await run(plant(level), []);

      expect(exitCode).toBe(0);
      expect(result.level.level).toBe(level);
      expect(neededFiles(result)).toEqual([...NEEDED[level]]);
      expect(result.rows.every((row) => row.state === 'missing')).toBe(true);
    });
  }

  it('reads present for each shipped template written as is, and differs for an edited copy', async () => {
    const project = plant(3, {
      [RELEASE_PUBLISH_FILE]: readReleaseTemplate(RELEASE_PUBLISH_FILE),
      [RELEASE_TAG_FILE]: `${readReleaseTemplate(RELEASE_TAG_FILE)}# edited\n`,
    });

    const { result } = await run(project, []);
    const states = Object.fromEntries(result.rows.map((row) => [row.file, row.state]));

    expect(states[RELEASE_PUBLISH_FILE]).toBe('present');
    expect(states[RELEASE_TAG_FILE]).toBe('differs');
    expect(states[RELEASE_SETTLE_FILE]).toBe('missing');
  });

  for (const level of LEVELS) {
    it(`writes at level ${String(level)} only the needed missing files, from the shipped templates`, async () => {
      const project = plant(level);

      const { exitCode } = await run(project, ['--write']);

      expect(exitCode).toBe(0);
      expect(written(project)).toEqual([...NEEDED[level]].sort());
      for (const file of NEEDED[level]) {
        expect(readFileSync(join(project.root, wfPath(file)), 'utf8')).toBe(readReleaseTemplate(file));
      }
    });
  }

  it('leaves an edited and a present copy byte for byte under --write and writes the one missing', async () => {
    const edited = `${readReleaseTemplate(RELEASE_PUBLISH_FILE)}# my edit\n`;
    const project = plant(4, { [RELEASE_PUBLISH_FILE]: edited });

    const { exitCode, result } = await run(project, ['--write']);

    expect(exitCode).toBe(0);
    expect(readFileSync(join(project.root, wfPath(RELEASE_PUBLISH_FILE)), 'utf8')).toBe(edited);
    expect(readFileSync(join(project.root, wfPath(RELEASE_SETTLE_FILE)), 'utf8')).toBe(readReleaseTemplate(RELEASE_SETTLE_FILE));
    expect(written(project)).toEqual([RELEASE_PUBLISH_FILE, RELEASE_SETTLE_FILE].sort());
    expect(result.writes.map((each) => each.outcome).sort()).toEqual(['created', 'kept']);

    const again = await run(project, ['--write']);
    expect(again.result.writes.map((each) => each.outcome)).toEqual(['kept', 'kept']);
    expect(readFileSync(join(project.root, wfPath(RELEASE_PUBLISH_FILE)), 'utf8')).toBe(edited);
  });
});

/** The value at `path` in a parsed document. */
function at(document: unknown, path: readonly string[]): unknown {
  let value: unknown = document;
  for (const key of path) {
    if (!isMapping(value)) return undefined;
    value = value[key];
  }
  return value;
}

function parsed(file: string): unknown {
  return Bun.YAML.parse(readReleaseTemplate(file));
}

describe('the guards of the stage templates', () => {
  it('release-tag.yml tags only a merged pull request from rafa/release', () => {
    const guard = String(at(parsed(RELEASE_TAG_FILE), ['jobs', 'tag', 'if']));

    expect(guard).toContain('github.event.pull_request.merged == true');
    expect(guard).toContain('rafa/release');
  });

  for (const file of [RELEASE_TAG_FILE, RELEASE_SETTLE_FILE]) {
    it(`${file} calls the publish workflow passing a ref`, () => {
      const publish = at(parsed(file), ['jobs', 'publish']);

      expect(at(publish, ['uses'])).toBe(`./.github/workflows/${RELEASE_PUBLISH_FILE}`);
      const ref = at(publish, ['with', 'ref']);
      expect(typeof ref === 'string' && ref.length > 0).toBe(true);
      expect(at(parsed(RELEASE_PUBLISH_FILE), ['on', 'workflow_call', 'inputs', 'ref'])).toBeDefined();
    });
  }
});
