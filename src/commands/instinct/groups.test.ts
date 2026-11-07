/**
 * Tests for `rafa instinct groups` (`src/commands/instinct/groups.ts`):
 * the groups of two or more members the project scope's held set
 * forms, their lines and json data, the scope it does not read, and the
 * refusal.
 *
 * Every dispatched case plants a project and a home of its own under a
 * temporary directory of this file's own, and dispatches the command
 * in-process with streams, an environment and a working directory of
 * its own (`src/tests/cli-capture.ts`), so nothing reads the real
 * `~/.rafa/instincts` or the repository's `.rafa/instincts`.
 *
 * ## The controls
 *
 * A pair whose second member is flagged lists no group. That absence
 * is held BESIDE the same pair planted without the record that flags
 * it, which does list a group: so the pair is left out by the flag,
 * not because nothing was read. The user scope's group is held beside
 * the same files planted in the project scope, which list it. That
 * nothing is written is read as the planted tree's every path and
 * content before and after, over a run that did list a group.
 */
import type { InstinctRecord } from '@open-tomato/rafa/ports';

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { actionHash } from '@open-tomato/rafa-inventory/learning/index';
import { ACTION_HEADING, CAUSE_HEADING } from '@open-tomato/rafa-inventory/schema/instinct';

import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';

import { createInstinctGroupsCommand, heldGroups, renderGroups } from './groups.js';

/** The subject the dispatched cases route through. */
const SUBJECTS = [{ name: 'instinct', summary: 'list the records the instinct scopes hold' }];

/** A temporary directory of this file's own, its path resolved through every link. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-instinct-groups-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** What one planted lesson says. */
interface Lesson {
  readonly id: string;
  readonly trigger: string;
  readonly action: string;
  readonly confidence: number;
  readonly sources: readonly string[];
}

/** A lesson the `local` adapter holds, `usage_count` the number of its sources. */
function lessonText(lesson: Lesson, scope = 'project'): string {
  return [
    '---',
    `id: ${lesson.id}`,
    `trigger: ${lesson.trigger}`,
    'kind: gotcha',
    'domain: workflow',
    `confidence: ${String(lesson.confidence)}`,
    `usage_count: ${String(lesson.sources.length)}`,
    'sources:',
    ...lesson.sources.map((source) => `  - ${source}`),
    'signal: loud',
    `scope: ${scope}`,
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

/** The action three wordings share. */
const FOREGROUND = 'Run each gate in its own foreground call.';

/** One lesson under three wordings from three sources. */
const THREE_WORDINGS: readonly Lesson[] = [
  { id: 'fg-a', trigger: 'when a gate runs long', action: FOREGROUND, confidence: 0.5, sources: ['plan-a'] },
  { id: 'fg-b', trigger: 'when the suite times out', action: FOREGROUND, confidence: 0.5, sources: ['plan-b'] },
  { id: 'fg-c', trigger: 'when a background run is lost', action: FOREGROUND, confidence: 0.5, sources: ['plan-c'] },
];

/** The action a pair shares, its second member's trigger held another way too. */
const XARGS = 'Pipe the list through xargs.';

/** A pair sharing one action on two triggers. */
const PAIR: readonly Lesson[] = [
  { id: 'xargs-a', trigger: 'when a list is long', action: XARGS, confidence: 0.5, sources: ['plan-a'] },
  { id: 'xargs-b', trigger: 'when an argument list overflows', action: XARGS, confidence: 0.5, sources: ['plan-b'] },
];

/** Another action on the pair's second trigger: it flags `xargs-b`. */
const RIVAL: Lesson = { id: 'rival', trigger: 'when an argument list overflows', action: 'Split the list.', confidence: 0.5, sources: ['plan-c'] };

/** Alone on its action: no group of two. */
const ALONE: Lesson = { id: 'alone', trigger: 'when testing', action: 'Run `bun install` first.', confidence: 0.8, sources: ['plan-a'] };

/** What one case plants: a project and a home. */
interface Planted {
  /** The project root, holding `.rafa/config.yaml`. */
  readonly root: string;
  /** The home the user scope resolves under. */
  readonly home: string;
  /** The directory both are planted under. */
  readonly scope: string;
}

/** Plants the lessons in the project scope, and `user` in the user scope. */
function plant(project: readonly Lesson[], user: readonly Lesson[] = []): Planted {
  planted += 1;
  const scope = join(tempBase, `case-${String(planted)}`);
  const root = join(scope, 'project');
  const home = join(scope, 'home');
  plantProjectConfig(root);
  mkdirSync(home, { recursive: true });
  const files: [string, string][] = [
    ...project.map((lesson): [string, string] => [join(root, '.rafa', 'instincts', `${lesson.id}.md`), lessonText(lesson)]),
    ...user.map((lesson): [string, string] => [join(home, '.rafa', 'instincts', `${lesson.id}.md`), lessonText(lesson, 'user')]),
  ];
  for (const [path, text] of files) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return { root, home, scope };
}

/** Dispatches `words` over the command with the planted tree's seams. */
async function run(words: readonly string[], tree: Planted) {
  return dispatchInProject(words, SUBJECTS, [createInstinctGroupsCommand()], { root: tree.root, home: tree.home }, { PATH: '' });
}

/** The data of the terminal result event. */
function resultData(stdout: string): unknown {
  return eventsOf(stdout).find((event) => event.type === 'result')?.data;
}

/** The non-empty lines of a capture. */
function linesOf(text: string): string[] {
  return text.split('\n').filter((line) => line !== '');
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

/** A held record taking `action` on `trigger`. */
function record(id: string, trigger: string, action: string, sources: readonly string[], status: InstinctRecord['status'] = 'active'): InstinctRecord {
  return {
    id,
    trigger,
    action,
    action_hash: actionHash(action),
    confidence: 0.5,
    usage_count: 1,
    sources: [...sources],
    signal: 'loud',
    status,
    created_at: '2026-09-11T10:00:00Z',
    updated_at: '2026-09-11T10:00:00Z',
  };
}

describe('the groups a held set forms', () => {
  it('lists one action under three triggers from three sources at 0.6, and no action held once', () => {
    const groups = heldGroups([
      record('fg-a', 'when a', FOREGROUND, ['s1']),
      record('fg-b', 'when b', FOREGROUND, ['s2']),
      record('fg-c', 'when c', FOREGROUND, ['s3']),
      record('alone', 'when alone', 'Do it alone.', ['s1']),
    ]);

    expect(groups).toEqual([
      { action_hash: actionHash(FOREGROUND), triggers: ['when a', 'when b', 'when c'], sources: 3, confidence: 0.6 },
    ]);
  });

  it('lists no group whose second member is flagged, which it lists with that member active', () => {
    const active = heldGroups([record('x-a', 'when a', XARGS, ['s1']), record('x-b', 'when b', XARGS, ['s2'])]);
    const flagged = heldGroups([record('x-a', 'when a', XARGS, ['s1']), record('x-b', 'when b', XARGS, ['s2'], 'flagged')]);

    expect(active.map((group) => group.triggers)).toEqual([['when a', 'when b']]);
    expect(flagged).toEqual([]);
  });

  it('names a trigger two members spell two ways once, the group still of two', () => {
    const groups = heldGroups([record('x-a', 'when a list', XARGS, ['s1']), record('x-b', '  When A   LIST ', XARGS, ['s2'])]);

    expect(groups).toEqual([{ action_hash: actionHash(XARGS), triggers: ['when a list'], sources: 2, confidence: 0.55 }]);
  });
});

describe('what text mode writes', () => {
  it('writes each group as its hash, confidence and source count, its triggers beneath', () => {
    expect(renderGroups({ groups: [{ action_hash: 'abc', triggers: ['when a', 'when b'], sources: 2, confidence: 0.55 }] }, '/p'))
      .toEqual([
        '1 same-action group(s) in the project scope (project: /p):',
        '  abc  0.55  from 2 source(s)',
        '      when a',
        '      when b',
      ]);
  });

  it('says so when the scope holds none', () => {
    expect(renderGroups({ groups: [] }, '/p'))
      .toEqual(['No action the project scope holds is held under two or more records (project: /p).']);
  });
});

describe('rafa instinct groups over a planted project', () => {
  it('lists the group of three wordings, leaving out the lone action and the pair a rival flags', async () => {
    const tree = plant([...THREE_WORDINGS, ...PAIR, RIVAL, ALONE]);

    const answered = await run(['instinct', 'groups'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stderr).toBe('');
    expect(linesOf(answered.stdout)).toEqual([
      `1 same-action group(s) in the project scope (project: ${tree.root}):`,
      `  ${actionHash(FOREGROUND)}  0.60  from 3 source(s)`,
      '      when a gate runs long',
      '      when the suite times out',
      '      when a background run is lost',
    ]);
  });

  it('gives the groups as the terminal result\'s data, the unflagged pair among them', async () => {
    const tree = plant([...THREE_WORDINGS, ...PAIR, ALONE]);

    const answered = await run(['instinct', 'groups', '--output=json'], tree);

    expect(answered.exitCode).toBe(0);
    expect(resultData(answered.stdout)).toEqual({
      groups: [
        {
          action_hash: actionHash(FOREGROUND),
          triggers: ['when a gate runs long', 'when the suite times out', 'when a background run is lost'],
          sources: 3,
          confidence: 0.6,
        },
        { action_hash: actionHash(XARGS), triggers: ['when a list is long', 'when an argument list overflows'], sources: 2, confidence: 0.55 },
      ],
    });
  });

  it('reads the project scope alone: a user-scope group is not listed, which the project scope lists', async () => {
    const inUser = await run(['instinct', 'groups', '--output=json'], plant([], PAIR));
    const inProject = await run(['instinct', 'groups', '--output=json'], plant(PAIR));

    expect(inUser.exitCode).toBe(0);
    expect(resultData(inUser.stdout)).toEqual({ groups: [] });
    expect((resultData(inProject.stdout) as { groups: unknown[] }).groups).toHaveLength(1);
  });

  it('writes no file under the planted tree over a run that lists a group', async () => {
    const tree = plant([...THREE_WORDINGS, ...PAIR, RIVAL]);
    const before = snapshot(tree.scope);

    const answered = await run(['instinct', 'groups'], tree);

    expect(answered.stdout).toContain('1 same-action group(s)');
    expect(snapshot(tree.scope)).toEqual(before);
  });

  it('says so, with exit code 0, when the project scope holds no group or no directory', async () => {
    const tree = plant([ALONE]);
    const empty = plant([]);

    const answered = await run(['instinct', 'groups'], tree);
    const absent = await run(['instinct', 'groups'], empty);

    expect(answered.exitCode).toBe(0);
    expect(linesOf(answered.stdout))
      .toEqual([`No action the project scope holds is held under two or more records (project: ${tree.root}).`]);
    expect(absent.exitCode).toBe(0);
    expect(absent.stdout).toContain('No action the project scope holds');
  });

  it('refuses a positional word with exit code 1 and the usage line', async () => {
    const answered = await run(['instinct', 'groups', 'fg-a'], plant(THREE_WORDINGS));

    expect(answered.exitCode).toBe(1);
    expect(answered.stdout).toBe('');
    expect(answered.stderr).toContain('Expected no argument');
    expect(answered.stderr).toContain('Usage: rafa instinct groups');
  });
});
