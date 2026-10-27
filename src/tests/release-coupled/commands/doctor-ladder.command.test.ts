/**
 * Drives `rafa doctor` through its command over a temporary project at
 * each of the five release ladder levels and reads the ladder row
 * (`doctor-ladder.ts`) off its output: the row's level, the
 * preconditions it lists as missing and the exit code.
 *
 * Order: the negative cases come first (a workflow path that is a
 * directory, a private manifest, a `dependabot.yml` with no bot
 * workflow), then the five levels with everything in place. Controls:
 *
 *   - every negative case's project differs from the level's complete
 *     project by the one thing it names, and the complete project's row
 *     lists nothing missing, so the warning follows that thing;
 *   - the exit code of every run is compared with a run of the same
 *     project with the ladder keys at level 0, so "stays what the other
 *     rows gave" is measured and not assumed to be 0;
 *   - the json run carries the same row as a `log` event;
 *   - the publish switch reminder naming `RAFA_RELEASE_PUBLISH` is on the
 *     row at levels 2 to 4 only, as the last thing on it.
 */
import type { PlantedProject } from '../../cli-capture.js';
import type { RafaCommand } from '@open-tomato/rafa/core/command';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';
import { SERVE_CLI_VERSION } from '@open-tomato/rafa-inventory/tiers/delivery';
import { LADDER_WORKFLOWS, PUBLISH_SWITCH_VARIABLE } from '@open-tomato/rafa-release/release/ladder';

import { createDoctorCommand } from '../../../commands/doctor.js';
import { dispatchInProject, eventsOf } from '../../cli-capture.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-ladder-cmd-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let projectCount = 0;

const PUBLISH_TEXT = 'name: release-publish\njobs:\n  publish:\n    permissions:\n      id-token: write\n';
const MANIFEST = '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n';
const PRIVATE_MANIFEST = '{\n  "name": "demo",\n  "version": "1.0.0",\n  "private": true\n}\n';

/** The three ladder keys of one level. */
interface Keys {
  readonly settle: 'push' | 'pr';
  readonly tag: 'manual' | 'settle';
  readonly publish: 'manual' | 'ci';
}

const LEVEL_KEYS: readonly Keys[] = [
  { settle: 'push', tag: 'manual', publish: 'manual' },
  { settle: 'push', tag: 'settle', publish: 'manual' },
  { settle: 'push', tag: 'manual', publish: 'ci' },
  { settle: 'pr', tag: 'settle', publish: 'ci' },
  { settle: 'push', tag: 'settle', publish: 'ci' },
];

const LEVEL_NAMES = ['Manual', 'Settle tags', 'CI publishes', 'Release PR', 'Continuous'];

/** The workflow files each level needs, by file name. */
const LEVEL_FILES: readonly (readonly string[])[] = [
  [],
  [],
  ['release-publish.yml'],
  ['release-publish.yml', 'release-tag.yml'],
  ['release-publish.yml', 'release-settle.yml'],
];

interface Plant {
  readonly keys: Keys;
  readonly files?: readonly string[];
  readonly manifest?: string;
  readonly dependabot?: boolean;
  /** Workflow paths planted as directories. */
  readonly directories?: readonly string[];
}

function plant(spec: Plant): PlantedProject {
  projectCount += 1;
  const scope = join(tempBase, `p-${String(projectCount)}`);
  const root = join(scope, 'project');
  const home = join(scope, 'home');
  mkdirSync(join(root, '.rafa'), { recursive: true });
  mkdirSync(home, { recursive: true });
  const { settle, tag, publish } = spec.keys;
  writeFileSync(
    join(root, '.rafa', 'config.yaml'),
    `release:\n  enabled: true\n  settle: ${settle}\n  tag: ${tag}\n  publish: ${publish}\n`,
  );
  writeFileSync(join(root, 'package.json'), spec.manifest ?? MANIFEST);
  writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n');
  const workflows = join(root, '.github', 'workflows');
  mkdirSync(workflows, { recursive: true });
  for (const file of spec.files ?? []) {
    writeFileSync(join(workflows, file), file === 'release-publish.yml'
      ? PUBLISH_TEXT
      : `name: ${file}\n`);
  }
  for (const file of spec.directories ?? []) mkdirSync(join(workflows, file), { recursive: true });
  if (spec.dependabot === true) writeFileSync(join(root, '.github', 'dependabot.yml'), 'version: 2\n');
  execFileSync('git', ['init', '-q', '--initial-branch=main', root], {
    env: { ...gitIdentityEnv(), PATH: process.env['PATH'] ?? '' },
    stdio: 'ignore',
  });
  return { root, home };
}

function doctorCommand(home: string): RafaCommand {
  return createDoctorCommand({
    checks: { now: () => 0 },
    readClaudeVersion: () => Promise.resolve(SERVE_CLI_VERSION),
    inventory: { entry: () => join(home, 'runtime', 'cli.js') },
  });
}

interface Row {
  readonly line: string;
  readonly jsonLine: string | null;
  readonly exitCode: number | null;
}

async function doctorRow(project: PlantedProject): Promise<Row> {
  const env = { PATH: process.env['PATH'] ?? '' };
  const text = await dispatchInProject(['doctor'], [], [doctorCommand(project.home)], project, env);
  const json = await dispatchInProject(['doctor', '--output=json'], [], [doctorCommand(project.home)], project, env);
  const all = `${text.stdout}\n${text.stderr}`;
  const line = all.split('\n').find((each) => each.includes('Release ladder:')) ?? '';
  const logged = eventsOf(json.stdout)
    .map((event) => JSON.stringify(event))
    .find((each) => each.includes('Release ladder:'));
  expect(json.exitCode).toBe(text.exitCode);
  return { line, jsonLine: logged ?? null, exitCode: text.exitCode };
}

/** The exit code doctor gives the same project with the ladder at level 0. */
async function baselineExit(): Promise<number | null> {
  return (await doctorRow(plant({ keys: LEVEL_KEYS[0] as Keys }))).exitCode;
}

const complete = (level: number): Plant => ({
  keys: LEVEL_KEYS[level] as Keys,
  files: LEVEL_FILES[level] ?? [],
});

describe('rafa doctor, the ladder row: what is missing', () => {
  it('lists a workflow path that is a directory as not a file', async () => {
    const control = await doctorRow(plant({ ...complete(2) }));
    const row = await doctorRow(plant({ keys: LEVEL_KEYS[2] as Keys, directories: ['release-publish.yml'] }));

    expect(control.line).toContain('Release ladder: level 2, CI publishes.');
    expect(row.line).toContain('Release ladder: level 2, CI publishes, 1 missing:');
    expect(row.line).toContain('.github/workflows/release-publish.yml is not a file');
    expect(row.line).toContain('rafa release workflows --write');
    expect(row.jsonLine).toContain('is not a file');
    expect(row.exitCode).toBe(await baselineExit());
  });

  it('lists a private manifest at level 2', async () => {
    const row = await doctorRow(plant({ ...complete(2), manifest: PRIVATE_MANIFEST }));

    expect(row.line).toContain('Release ladder: level 2, CI publishes, 1 missing:');
    expect(row.line).toContain('package.json is private');
    expect(row.exitCode).toBe(await baselineExit());
  });

  it('lists a dependabot.yml with no bot workflow at level 3', async () => {
    const control = await doctorRow(plant({ ...complete(3), dependabot: true, files: [...LEVEL_FILES[3] as string[], 'release-bot-fragment.yml'] }));
    const row = await doctorRow(plant({ ...complete(3), dependabot: true }));

    expect(control.line).toContain('Release ladder: level 3, Release PR.');
    expect(row.line).toContain('Release ladder: level 3, Release PR, 1 missing:');
    expect(row.line).toContain('release-bot-fragment.yml is absent');
    expect(row.line).toContain('.github/dependabot.yml');
    expect(row.exitCode).toBe(await baselineExit());
  });

  it('lists every workflow a level needs when none is there', async () => {
    const row = await doctorRow(plant({ keys: LEVEL_KEYS[4] as Keys }));

    expect(row.line).toContain('level 4, Continuous, 2 missing:');
    expect(row.line).toContain('release-publish.yml is absent');
    expect(row.line).toContain('release-settle.yml is absent');
  });
});

describe('rafa doctor, the ladder row: each level', () => {
  for (const level of [0, 1, 2, 3, 4]) {
    it(`reads level ${String(level)} with nothing missing and keeps the exit code`, async () => {
      const row = await doctorRow(plant(complete(level)));

      expect(row.line).toContain(`Release ladder: level ${String(level)}, ${LEVEL_NAMES[level] as string}.`);
      expect(row.line).not.toContain('missing');
      expect(row.jsonLine).toContain(`level ${String(level)}`);
      expect(row.exitCode).toBe(await baselineExit());
    });
  }

  it('covers every workflow the roster names across the levels', () => {
    const planted = new Set(LEVEL_FILES.flat());
    const needed = LADDER_WORKFLOWS.map((entry) => entry.path.split('/').pop() as string);

    expect(needed.filter((file) => file !== 'release-bot-fragment.yml').every((file) => planted.has(file))).toBe(true);
  });
});

describe('rafa doctor, the ladder row: the publish switch reminder', () => {
  it('names the variable the constant holds', () => {
    expect(PUBLISH_SWITCH_VARIABLE).toBe('RAFA_RELEASE_PUBLISH');
  });

  for (const level of [0, 1, 2, 3, 4]) {
    const carries = level >= 2;
    it(`${carries
      ? 'carries'
      : 'omits'} the reminder at level ${String(level)}, text and json, keeping the exit code`, async () => {
      const row = await doctorRow(plant(complete(level)));

      expect(row.line).toContain(`Release ladder: level ${String(level)}, `);
      expect(row.jsonLine).not.toBeNull();
      expect(row.line.includes('RAFA_RELEASE_PUBLISH')).toBe(carries);
      expect((row.jsonLine as string).includes('RAFA_RELEASE_PUBLISH')).toBe(carries);
      if (carries) {
        expect(row.line.trimEnd().endsWith('which doctor cannot read.')).toBe(true);
        expect(row.line).toContain('set to ci');
        expect(row.line).not.toContain('missing');
        expect(row.jsonLine).toContain('"log"');
      }
      expect(row.exitCode).toBe(await baselineExit());
    });
  }

  it('ends a row with items missing on the reminder, after the list', async () => {
    const row = await doctorRow(plant({ ...complete(3), manifest: PRIVATE_MANIFEST }));

    expect(row.line.indexOf('package.json is private')).toBeLessThan(row.line.indexOf('RAFA_RELEASE_PUBLISH'));
    expect(row.line.trimEnd().endsWith('which doctor cannot read.')).toBe(true);
    expect(row.exitCode).toBe(await baselineExit());
  });
});
