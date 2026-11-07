/**
 * `rafa instinct groups --output=json`, spawned for real, over one project
 * holding a fixture library: one action under three triggers from three
 * sources, and a pair whose second member another action on its trigger
 * flags.
 *
 * `groups.test.ts` drives the command in-process; what is untested there is
 * that the REAL entry, `bun src/rafa.ts`, routes the words, reads the
 * project's `.rafa/instincts`, answers exit code 0 and writes nothing. The
 * group of three is listed at 0.6; the pair is absent, left out by the flag
 * and not by an empty read, which the group of three beside it shows.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { actionHash } from '@open-tomato/rafa-inventory/learning/index';
import { ACTION_HEADING, CAUSE_HEADING } from '@open-tomato/rafa-inventory/schema/instinct';

import { eventsOf, expectExit, plantScratchRepo, runRafa } from './cli-capture.js';

const scratchBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-instinct-groups-spawned-')));
afterAll(() => {
  rmSync(scratchBase, { recursive: true, force: true });
});

/** The action three wordings share. */
const FOREGROUND = 'Run each gate in its own foreground call.';

/** The action a pair shares; its second member's trigger holds another action too. */
const XARGS = 'Pipe the list through xargs.';

/** One planted lesson. */
interface Lesson {
  readonly id: string;
  readonly trigger: string;
  readonly action: string;
  readonly source: string;
}

const FIXTURE: readonly Lesson[] = [
  { id: 'fg-a', trigger: 'when a gate runs long', action: FOREGROUND, source: 'plan-a' },
  { id: 'fg-b', trigger: 'when the suite times out', action: FOREGROUND, source: 'plan-b' },
  { id: 'fg-c', trigger: 'when a background run is lost', action: FOREGROUND, source: 'plan-c' },
  { id: 'xargs-a', trigger: 'when a list is long', action: XARGS, source: 'plan-a' },
  { id: 'xargs-b', trigger: 'when an argument list overflows', action: XARGS, source: 'plan-b' },
  { id: 'rival', trigger: 'when an argument list overflows', action: 'Split the list.', source: 'plan-c' },
];

/** The file a lesson is held in. */
function lessonText(lesson: Lesson): string {
  return [
    '---',
    `id: ${lesson.id}`,
    `trigger: ${lesson.trigger}`,
    'kind: gotcha',
    'domain: workflow',
    'confidence: 0.5',
    'usage_count: 1',
    'sources:',
    `  - ${lesson.source}`,
    'signal: loud',
    'scope: project',
    'source: loop-observed',
    'created_at: 2026-09-11T10:00:00Z',
    'updated_at: 2026-09-11T10:00:00Z',
    '---',
    '',
    ACTION_HEADING,
    lesson.action,
    '',
    CAUSE_HEADING,
    'Two tasks read the gate differently.',
    '',
  ].join('\n');
}

/** Every file under `dir` with its content, by path. */
function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) Object.assign(files, snapshot(path));
    else files[path] = readFileSync(path, 'utf8');
  }
  return files;
}

describe('rafa instinct groups --output=json, spawned', () => {
  it('lists the group of three triggers, not the flagged pair, exit 0, and changes no file', () => {
    const scratch = plantScratchRepo(scratchBase);
    const library = join(scratch.repo, '.rafa', 'instincts');
    mkdirSync(library, { recursive: true });
    for (const lesson of FIXTURE) writeFileSync(join(library, `${lesson.id}.md`), lessonText(lesson), 'utf8');
    const before = snapshot(scratch.repo);

    const run = runRafa(scratch, scratch.repo, ['instinct', 'groups', '--output=json']);

    expectExit(run, 0, scratch);
    const data = eventsOf(run.stdout).find((event) => event.type === 'result')?.data as
      { groups: { action_hash: string; triggers: string[]; sources: number; confidence: number }[] };
    expect(data.groups).toEqual([
      {
        action_hash: actionHash(FOREGROUND),
        triggers: ['when a gate runs long', 'when the suite times out', 'when a background run is lost'],
        sources: 3,
        confidence: 0.6,
      },
    ]);
    expect(data.groups.some((group) => group.action_hash === actionHash(XARGS))).toBe(false);
    expect(snapshot(scratch.repo)).toEqual(before);
  }, 60_000);
});
