/**
 * Tests for the release ladder row of `rafa doctor`
 * (`doctor-ladder.ts`): the readings it makes of a project's files for
 * `src/release/ladder.ts`, the row it words, and the level it writes
 * the row at.
 *
 * Each file reading is made over a scratch project of its own, built
 * from the case's files, so a stat or a parse is the filesystem's own
 * answer. Controls for readings that would pass while wrong:
 *
 *   - every "missing" case has a twin that differs only by the file the
 *     item names and reads nothing missing, so the item is known to
 *     follow that file and not the project;
 *   - the directory case sits beside the absent case, and the two read
 *     different kinds, so "not a file" is not "absent" by another name;
 *   - the row's level is checked for all five levels, so a row fixed at
 *     one level fails;
 *   - the publish switch reminder is checked present at levels 2 to 4
 *     and absent at levels 0 and 1, so a reminder on every row, or on
 *     none, fails.
 */
import type { DoctorLadderConfig } from './doctor-ladder.js';
import type { Output } from '@open-tomato/rafa/ports';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  BOT_FRAGMENT_WORKFLOW,
  PUBLISH_WORKFLOW,
  SETTLE_WORKFLOW,
  TAG_WORKFLOW,
} from '../release/ladder.js';

import {
  PUBLISH_SWITCH_REMINDER,
  WORKFLOWS_COMMAND,
  ladderRow,
  missingPhrase,
  readDoctorLadder,
  readLadderFiles,
  readLadderManifest,
  writeDoctorLadder,
} from './doctor-ladder.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-ladder-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many projects this file has made, so each gets its own directory. */
let projectCount = 0;

/** A publish workflow that grants the job its OIDC token. */
const PUBLISH_TEXT = 'name: release-publish\njobs:\n  publish:\n    permissions:\n      id-token: write\n';

/** A publishable manifest. */
const MANIFEST = '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n';

/** Every file a level 4 project with Dependabot needs, each well formed. */
const COMPLETE: Readonly<Record<string, string>> = {
  'package.json': MANIFEST,
  [PUBLISH_WORKFLOW.path]: PUBLISH_TEXT,
  [TAG_WORKFLOW.path]: 'name: release-tag\n',
  [SETTLE_WORKFLOW.path]: 'name: release-settle\n',
  [BOT_FRAGMENT_WORKFLOW.path]: 'name: release-bot-fragment\n',
  '.github/dependabot.yml': 'version: 2\n',
};

/** Writes `files` under a fresh project root, and makes each of `dirs` a directory. */
function project(files: Readonly<Record<string, string>>, dirs: readonly string[] = []): string {
  projectCount += 1;
  const root = join(tempBase, `project-${String(projectCount)}`);
  mkdirSync(root, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  for (const dir of dirs) mkdirSync(join(root, dir), { recursive: true });
  return root;
}

/** `files` without the paths named. */
function without(files: Readonly<Record<string, string>>, ...paths: readonly string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([path]) => !paths.includes(path)));
}

/** The config of each level's table row, the version file `package.json`. */
const LEVELS: ReadonlyArray<readonly [number, string, DoctorLadderConfig]> = [
  [0, 'Manual', { releaseSettle: 'push', releaseTag: 'manual', releasePublish: 'manual', releaseVersionFile: 'package.json' }],
  [1, 'Settle tags', { releaseSettle: 'push', releaseTag: 'settle', releasePublish: 'manual', releaseVersionFile: 'package.json' }],
  [2, 'CI publishes', { releaseSettle: 'push', releaseTag: 'manual', releasePublish: 'ci', releaseVersionFile: 'package.json' }],
  [3, 'Release PR', { releaseSettle: 'pr', releaseTag: 'settle', releasePublish: 'ci', releaseVersionFile: 'package.json' }],
  [4, 'Continuous', { releaseSettle: 'push', releaseTag: 'settle', releasePublish: 'ci', releaseVersionFile: 'package.json' }],
];

/** One level's config. */
function configAt(level: number): DoctorLadderConfig {
  const row = LEVELS.find(([each]) => each === level);
  if (row === undefined) throw new Error(`no level ${String(level)}`);
  return row[2];
}

/** The reminder as it ends a row of level 2 and up. */
const REMINDER_TAIL = ` ${PUBLISH_SWITCH_REMINDER}`;

/** What follows a row's full stop at `level`: the reminder from level 2 up, else nothing. */
function tailAt(level: number): string {
  return level >= 2
    ? REMINDER_TAIL
    : '';
}

/** An output recording each line at the level it was written. */
function recordingOutput(): { readonly output: Output; readonly seen: Array<readonly [string, string]> } {
  const seen: Array<readonly [string, string]> = [];
  const at = (level: string) => (message: string): void => {
    seen.push([level, message]);
  };
  const output: Output = {
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    debug: at('debug'),
    emit: () => undefined,
    result: () => undefined,
  };
  return { output, seen };
}

describe('readLadderFiles', () => {
  it('reads a directory at a workflow path as not a file, and an absent one as absent', () => {
    const root = project(without(COMPLETE, TAG_WORKFLOW.path, SETTLE_WORKFLOW.path), [TAG_WORKFLOW.path]);

    const readings = readLadderFiles(root, 'package.json');

    expect(readings.workflows.get(TAG_WORKFLOW.path)).toEqual({ kind: 'not-a-file' });
    expect(readings.workflows.get(SETTLE_WORKFLOW.path)).toEqual({ kind: 'absent' });
    expect(readings.workflows.get(BOT_FRAGMENT_WORKFLOW.path)).toEqual({ kind: 'file' });
  });

  it('reads the publish workflow\'s text and no other workflow\'s', () => {
    const readings = readLadderFiles(project(COMPLETE), 'package.json');

    expect(readings.workflows.get(PUBLISH_WORKFLOW.path)).toEqual({ kind: 'file', text: PUBLISH_TEXT });
    expect(readings.workflows.get(TAG_WORKFLOW.path)).toEqual({ kind: 'file' });
  });

  it('reads dependabot only when .github/dependabot.yml is a file', () => {
    expect(readLadderFiles(project(COMPLETE), 'package.json').dependabot).toBe(true);
    expect(readLadderFiles(project(without(COMPLETE, '.github/dependabot.yml')), 'package.json').dependabot).toBe(false);
    const dir = project(without(COMPLETE, '.github/dependabot.yml'), ['.github/dependabot.yml']);
    expect(readLadderFiles(dir, 'package.json').dependabot).toBe(false);
  });
});

describe('readLadderManifest', () => {
  it('reads the name and the private flag', () => {
    const root = project({ 'package.json': '{ "name": "demo", "private": true }' });

    expect(readLadderManifest(root, 'package.json')).toEqual({ path: 'package.json', private: true, name: 'demo' });
  });

  it('reads a manifest with no name, or a private flag that is not true, as such', () => {
    const root = project({ 'package.json': '{ "private": "yes" }' });

    expect(readLadderManifest(root, 'package.json')).toEqual({ path: 'package.json', private: false, name: null });
  });

  it('answers null for an absent version file, one that is not JSON, and a JSON array', () => {
    const root = project({ 'broken.json': '{ not json', 'list.json': '[]', 'ok.json': MANIFEST });

    expect(readLadderManifest(root, 'absent.json')).toBeNull();
    expect(readLadderManifest(root, 'broken.json')).toBeNull();
    expect(readLadderManifest(root, 'list.json')).toBeNull();
    expect(readLadderManifest(root, 'ok.json')).not.toBeNull();
  });
});

describe('readDoctorLadder', () => {
  for (const [level, name, config] of LEVELS) {
    it(`reads level ${String(level)}, ${name}, with nothing missing over a complete project`, () => {
      const reading = readDoctorLadder(project(COMPLETE), config);

      expect(reading.level).toEqual({ level: level as 0 | 1 | 2 | 3 | 4, name, misfit: null });
      expect(reading.missing).toEqual([]);
      expect(ladderRow(reading)).toBe(`Release ladder: level ${String(level)}, ${name}.${tailAt(level)}`);
    });
  }

  it('reads nothing missing at levels 0 and 1 over an empty project', () => {
    const root = project({});

    expect(readDoctorLadder(root, configAt(0)).missing).toEqual([]);
    expect(readDoctorLadder(root, configAt(1)).missing).toEqual([]);
  });

  it('names a needed workflow that is a directory, and reads its file twin as complete', () => {
    const root = project(without(COMPLETE, TAG_WORKFLOW.path), [TAG_WORKFLOW.path]);

    const reading = readDoctorLadder(root, configAt(3));

    expect(reading.missing).toEqual([{ kind: 'workflow', workflow: TAG_WORKFLOW, found: 'not-a-file' }]);
    expect(ladderRow(reading)).toContain(`${TAG_WORKFLOW.path} is not a file (move it aside, then run ${WORKFLOWS_COMMAND}).${REMINDER_TAIL}`);
  });

  it('names a private manifest, and reads the public twin as complete', () => {
    const root = project({ ...COMPLETE, 'package.json': '{ "name": "demo", "private": true }' });

    const reading = readDoctorLadder(root, configAt(2));

    expect(reading.missing).toEqual([{ kind: 'manifest-private', path: 'package.json' }]);
    expect(ladderRow(reading)).toContain(`package.json is private (remove "private": true to publish it).${REMINDER_TAIL}`);
  });

  it('names the bot workflow while dependabot.yml exists, and needs none without it', () => {
    const lacking = without(COMPLETE, BOT_FRAGMENT_WORKFLOW.path);

    const withBot = readDoctorLadder(project(lacking), configAt(4));
    const noBot = readDoctorLadder(project(without(lacking, '.github/dependabot.yml')), configAt(4));

    expect(withBot.missing).toEqual([{
      kind: 'bot-workflow',
      workflow: BOT_FRAGMENT_WORKFLOW,
      found: 'absent',
      dependabot: '.github/dependabot.yml',
    }]);
    expect(ladderRow(withBot)).toContain(`${BOT_FRAGMENT_WORKFLOW.path} is absent (run ${WORKFLOWS_COMMAND}), needed while .github/dependabot.yml exists.${REMINDER_TAIL}`);
    expect(noBot.missing).toEqual([]);
  });

  it('names a publish workflow without id-token: write', () => {
    const root = project({ ...COMPLETE, [PUBLISH_WORKFLOW.path]: 'name: release-publish\n# id-token: write\n' });

    const reading = readDoctorLadder(root, configAt(2));

    expect(reading.missing).toEqual([{ kind: 'id-token', workflow: PUBLISH_WORKFLOW }]);
  });

  it('counts and lists every missing item in order on one row', () => {
    const root = project({ 'package.json': '{ "private": true }' });

    const reading = readDoctorLadder(root, configAt(3));

    expect(ladderRow(reading)).toBe(
      'Release ladder: level 3, Release PR, 4 missing: '
      + `${PUBLISH_WORKFLOW.path} is absent (run ${WORKFLOWS_COMMAND}); `
      + `${TAG_WORKFLOW.path} is absent (run ${WORKFLOWS_COMMAND}); `
      + 'package.json is private (remove "private": true to publish it); '
      + 'package.json has no name (add a "name" to publish it).'
      + REMINDER_TAIL,
    );
  });

  it('names a key that does not fit the level on the row', () => {
    const config = { ...configAt(3), releaseTag: 'manual' } as const;

    const reading = readDoctorLadder(project(COMPLETE), config);

    expect(ladderRow(reading)).toBe(`Release ladder: level 2, CI publishes; release.settle is pr where the level reads push.${REMINDER_TAIL}`);
  });
});

describe('the publish switch reminder', () => {
  it('names RAFA_RELEASE_PUBLISH and never the word missing', () => {
    expect(PUBLISH_SWITCH_REMINDER).toBe('Publishing waits for the repository variable RAFA_RELEASE_PUBLISH set to ci, which doctor cannot read.');
    expect(PUBLISH_SWITCH_REMINDER).not.toContain('missing');
  });

  it('is absent at levels 0 and 1 and present at levels 2, 3 and 4', () => {
    const root = project(COMPLETE);

    const rows = LEVELS.map(([level, , config]) => [level, ladderRow(readDoctorLadder(root, config))] as const);

    expect(rows.filter(([, row]) => row.includes('RAFA_RELEASE_PUBLISH')).map(([level]) => level)).toEqual([2, 3, 4]);
  });

  it('ends a level 3 row with items missing, after its list', () => {
    const reading = readDoctorLadder(project({}), configAt(3));

    const row = ladderRow(reading);

    expect(reading.missing.length).toBeGreaterThan(0);
    expect(row).toEndWith(`(run ${WORKFLOWS_COMMAND}).${REMINDER_TAIL}`);
    expect(row.indexOf(' missing: ')).toBeLessThan(row.indexOf(PUBLISH_SWITCH_REMINDER));
  });
});

describe('missingPhrase', () => {
  it('names the publish job\'s permissions for a missing id-token: write', () => {
    expect(missingPhrase({ kind: 'id-token', workflow: PUBLISH_WORKFLOW }))
      .toBe(`${PUBLISH_WORKFLOW.path} grants no id-token: write (add it to the publish job's permissions)`);
  });
});

describe('writeDoctorLadder', () => {
  it('writes info when nothing is missing and warn when anything is', () => {
    const complete = readDoctorLadder(project(COMPLETE), configAt(4));
    const lacking = readDoctorLadder(project({}), configAt(4));
    const seen = recordingOutput();

    writeDoctorLadder({ output: seen.output }, complete);
    writeDoctorLadder({ output: seen.output }, lacking);

    expect(seen.seen.map(([level]) => level)).toEqual(['info', 'warn']);
    expect(seen.seen[1]?.[1]).toStartWith('Release ladder: level 4, Continuous, ');
  });
});
