/**
 * Tests for `rafa instinct promote` (`src/commands/instinct/promote.ts`):
 * the lessons listed under the `learning.promote.*` keys, that nothing
 * is written, and every refusal.
 *
 * Every dispatched case plants a project and a home of its own under a
 * temporary directory of this file's own, and dispatches the command
 * in-process with streams, an environment and a working directory of
 * its own (`src/tests/cli-capture.ts`), so nothing reads the real
 * `~/.rafa/instincts`.
 *
 * ## The controls
 *
 * Each record the default keys leave out sits beside one they list in
 * the same tree, so a command that listed nothing could not pass; and
 * the same tree is listed again with the keys lowered, where the left-out
 * records appear, so a command that ignored the keys could not pass
 * either. That nothing is written is read off every file under the
 * project and the home, path and bytes, before and after a run that
 * listed a lesson.
 */
import type { AnyAdapter } from '../../adapters/registry.js';
import type { BlessedBundle, InstinctRecord, Learning, MergeResult } from '../../ports/index.js';

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CORE_ADAPTER_REGISTRY, PORT_VERSIONS } from '../../adapters/registry.js';
import { actionHash } from '../../learning/index.js';
import { projectConfigText } from '../../project/scaffold.js';
import { ACTION_HEADING, CAUSE_HEADING } from '../../schema/instinct.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';

import { createInstinctPromoteCommand, refusedPullMessage, renderPromotable } from './promote.js';

/** The subject the dispatched cases route through. */
const SUBJECTS = [{ name: 'instinct', summary: 'print the lessons to promote' }];

/** A temporary directory of this file's own, its path resolved through every link. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-instinct-promote-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** What one planted record says. */
interface Lesson {
  readonly id: string;
  readonly trigger: string;
  readonly action: string;
  readonly confidence: number;
  readonly sources: readonly string[];
  readonly scope?: string;
  readonly promotedTo?: string;
}

/** A record the `local` adapter holds, `usage_count` the number of its sources. */
function recordText(lesson: Lesson): string {
  return [
    '---',
    `id: ${lesson.id}`,
    `trigger: ${lesson.trigger}`,
    'kind: gotcha',
    'domain: workflow',
    `confidence: ${String(lesson.confidence)}`,
    `usage_count: ${String(lesson.sources.length)}`,
    ...lesson.sources.length > 0
      ? ['sources:', ...lesson.sources.map((source) => `  - ${source}`)]
      : [],
    'signal: loud',
    `scope: ${lesson.scope ?? 'project'}`,
    'source: loop-observed',
    ...lesson.promotedTo === undefined
      ? []
      : [`promoted_to: ${lesson.promotedTo}`],
    'created_at: 2026-09-11T10:00:00Z',
    'updated_at: 2026-09-11T10:00:00Z',
    '---',
    '',
    ACTION_HEADING,
    lesson.action,
    '',
    CAUSE_HEADING,
    'Worktree creation copies the tree and not its packages.',
    '',
  ].join('\n');
}

/** Three distinct sources, the default `learning.promote.after`. */
const THREE = ['s1', 's2', 's3'];

/** A lesson the default keys list: three sources at 0.8. */
const RECURRED: Lesson = { id: 'bun-install', trigger: 'when testing', action: 'Run `bun install` first.', confidence: 0.8, sources: THREE };

/** Left out at the default keys: two sources, one short of `after`. */
const TWO_SOURCES: Lesson = { id: 'gate-order', trigger: 'when verifying', action: 'Run lint last.', confidence: 0.8, sources: ['s1', 's2'] };

/** Left out at the default keys: blessed at 0.6, below the promote floor of 0.7. */
const BELOW_FLOOR: Lesson = { id: 'help-snapshots', trigger: 'when adding a flag', action: 'Regenerate the help.', confidence: 0.6, sources: THREE };

/** Left out at every key: already promoted. */
const PROMOTED: Lesson = {
  id: 'scratch-tsconfig',
  trigger: 'when type-checking tests',
  action: 'Use a scratch tsconfig.',
  confidence: 0.9,
  sources: THREE,
  promotedTo: 'context/verification.md',
};

/** What one case plants: a project and a home. */
interface Planted {
  /** The project root, holding `.rafa/config.yaml`. */
  readonly root: string;
  /** The home the user scope resolves under. */
  readonly home: string;
  /** The directory holding both. */
  readonly scope: string;
}

/** The project-scope file a lesson is planted at. */
function projectFile(lesson: Lesson): Record<string, string> {
  return { [`project/.rafa/instincts/${lesson.id}.md`]: recordText(lesson) };
}

/** Plants one case's tree, the project config written with `config`. */
function plant(files: Readonly<Record<string, string>>, config: string = projectConfigText()): Planted {
  planted += 1;
  const scope = join(tempBase, `case-${String(planted)}`);
  const root = join(scope, 'project');
  const home = join(scope, 'home');
  plantProjectConfig(root, config);
  mkdirSync(home, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const path = join(scope, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return { root, home, scope };
}

/** Dispatches `words` over the command made with `adapters` registered, with the planted tree's seams. */
async function run(words: readonly string[], tree: Planted, adapters: readonly AnyAdapter[] = []) {
  const registry = adapters.reduce((held, adapter) => held.register(adapter), CORE_ADAPTER_REGISTRY);
  const command = createInstinctPromoteCommand({ registry });
  return dispatchInProject(words, SUBJECTS, [command], { root: tree.root, home: tree.home }, { PATH: '' });
}

/** Every entry under `dir`, each directory as its path and each file as its path and bytes. */
function treeOf(dir: string): string[] {
  return readdirSync(dir).sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory()
        ? [`${path}/`, ...treeOf(path)]
        : [`${path}\n${readFileSync(path, 'utf8')}`];
    });
}

/** The ids of the lessons the json result carries. */
function resultIds(stdout: string): unknown {
  const result = eventsOf(stdout).find((event) => event.type === 'result');
  return (result?.data as { lessons: InstinctRecord[] } | undefined)?.lessons.map((lesson) => lesson.id);
}

/** A record as a learning adapter answers it. */
function record(id: string, confidence: number, usage: number): InstinctRecord {
  const action = `Do ${id}.`;
  return {
    id,
    trigger: `when ${id}`,
    action,
    action_hash: actionHash(action),
    confidence,
    usage_count: usage,
    signal: 'loud',
    status: 'active',
    created_at: '2026-09-11T10:00:00Z',
    updated_at: '2026-09-11T10:00:00Z',
  };
}

/** A learning adapter under `kind` whose pull answers `pull`, counting each call. */
function pullingAdapter(kind: string, pull: () => Promise<BlessedBundle>, calls: string[]): AnyAdapter {
  const learning: Learning = {
    push: (): Promise<MergeResult> => {
      calls.push('push');
      return Promise.reject(new Error('push is not called'));
    },
    pullBlessed: () => {
      calls.push('pullBlessed');
      return pull();
    },
    flag: () => {
      calls.push('flag');
      return Promise.reject(new Error('flag is not called'));
    },
  };
  return { port: 'learning', kind, portVersion: PORT_VERSIONS.learning, create: () => learning };
}

describe('the lessons the local adapter lists', () => {
  it('lists the lesson three sources confirmed at 0.8, beside the ones the default keys leave out', async () => {
    const tree = plant({ ...projectFile(RECURRED), ...projectFile(TWO_SOURCES), ...projectFile(BELOW_FLOOR), ...projectFile(PROMOTED) });

    const answered = await run(['instinct', 'promote'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stderr).toBe('');
    expect(answered.stdout).toContain('1 lesson(s) to promote from the `local` learning adapter,'
      + ' at learning.promote.after 3, learning.promote.minConfidence 0.70:');
    expect(answered.stdout).toContain('  bun-install  0.80  used 3  when testing');
    expect(answered.stdout).toContain('      Run `bun install` first.');
    expect(answered.stdout).not.toContain('gate-order');
    expect(answered.stdout).not.toContain('help-snapshots');
    expect(answered.stdout).not.toContain('scratch-tsconfig');
  });

  it('lists the left-out lessons once the project lowers learning.promote.after and minConfidence', async () => {
    const lowered = `${projectConfigText()}\nlearning:\n  promote:\n    after: 2\n    minConfidence: 0.6\n`;
    const tree = plant({ ...projectFile(RECURRED), ...projectFile(TWO_SOURCES), ...projectFile(BELOW_FLOOR), ...projectFile(PROMOTED) }, lowered);

    const answered = await run(['instinct', 'promote', '--output=json'], tree);

    expect(answered.exitCode).toBe(0);
    expect(resultIds(answered.stdout)).toEqual(['bun-install', 'gate-order', 'help-snapshots']);
  });

  it('never lists a lesson below learning.bless.minConfidence, whatever the promote floor says', async () => {
    const config = `${projectConfigText()}\nlearning:\n  bless:\n    minConfidence: 0.7\n  promote:\n    minConfidence: 0.5\n`;
    const tree = plant({ ...projectFile(RECURRED), ...projectFile(BELOW_FLOOR) }, config);

    const answered = await run(['instinct', 'promote', '--output=json'], tree);

    expect(answered.exitCode).toBe(0);
    expect(resultIds(answered.stdout)).toEqual(['bun-install']);
  });

  it('lists a user-scope lesson on a trigger the project holds nothing on', async () => {
    const user: Lesson = { ...TWO_SOURCES, id: 'user-lesson', sources: THREE, scope: 'user' };
    const tree = plant({ ...projectFile(RECURRED), 'home/.rafa/instincts/user-lesson.md': recordText(user) });

    const answered = await run(['instinct', 'promote', '--output=json'], tree);

    expect(resultIds(answered.stdout)).toEqual(['bun-install', 'user-lesson']);
  });

  it('says none is promotable when nothing recurred, and exits 0', async () => {
    const tree = plant(projectFile(TWO_SOURCES));

    const answered = await run(['instinct', 'promote'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toContain('No lesson the `local` learning adapter holds is promotable at'
      + ' learning.promote.after 3, learning.promote.minConfidence 0.70.');
  });

  it('gives the adapter kind, both keys and the lessons as the data of the terminal result event', async () => {
    const tree = plant(projectFile(RECURRED));

    const answered = await run(['instinct', 'promote', '--output=json'], tree);
    const result = eventsOf(answered.stdout).find((event) => event.type === 'result');

    expect(answered.exitCode).toBe(0);
    expect(result?.data).toEqual({
      adapter: 'local',
      after: 3,
      minConfidence: 0.7,
      lessons: [expect.objectContaining({ id: 'bun-install', confidence: 0.8, usage_count: 3, sources: THREE }) as unknown],
    });
  });
});

describe('nothing is written', () => {
  it('leaves every file under the project and the home as it was, after listing a lesson', async () => {
    const user: Lesson = { ...TWO_SOURCES, id: 'user-lesson', sources: THREE, scope: 'user' };
    const tree = plant({
      ...projectFile(RECURRED),
      ...projectFile(PROMOTED),
      'home/.rafa/instincts/user-lesson.md': recordText(user),
    });
    const before = treeOf(tree.scope);

    const answered = await run(['instinct', 'promote'], tree);

    expect(answered.stdout).toContain('2 lesson(s) to promote');
    expect(treeOf(tree.scope)).toEqual(before);
  });

  it('makes no instincts directory in a project that has learned nothing', async () => {
    const tree = plant({});
    const before = treeOf(tree.scope);

    const answered = await run(['instinct', 'promote'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toContain('No lesson the `local` learning adapter holds is promotable');
    expect(treeOf(tree.scope)).toEqual(before);
  });

  it('calls pullBlessed and nothing else on the adapter learning.adapter names', async () => {
    const calls: string[] = [];
    const bundle = { version: 'v', instincts: [record('kept', 0.8, 3), record('short', 0.8, 2)] };
    const tree = plant({}, `${projectConfigText()}\nlearning:\n  adapter: pulling\n`);

    const answered = await run(['instinct', 'promote', '--output=json'], tree, [pullingAdapter('pulling', () => Promise.resolve(bundle), calls)]);

    expect(answered.exitCode).toBe(0);
    expect(resultIds(answered.stdout)).toEqual(['kept']);
    expect(calls).toEqual(['pullBlessed']);
  });
});

describe('the refusals', () => {
  it('refuses a kind no registry holds, naming it', async () => {
    const tree = plant(projectFile(RECURRED), `${projectConfigText()}\nlearning:\n  adapter: remote\n`);

    const answered = await run(['instinct', 'promote'], tree);

    expect(answered.exitCode).toBe(1);
    expect(answered.stdout).toBe('');
    expect(answered.stderr).toContain('❌ rafa instinct promote: the `remote` learning adapter cannot be made');
  });

  it('refuses a pull the adapter rejects rather than listing nothing', async () => {
    const calls: string[] = [];
    const tree = plant({}, `${projectConfigText()}\nlearning:\n  adapter: pulling\n`);
    const failing = pullingAdapter('pulling', () => Promise.reject(new Error('store is gone')), calls);

    const answered = await run(['instinct', 'promote'], tree, [failing]);

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain(refusedPullMessage('pulling', 'store is gone'));
    expect(answered.stdout).not.toContain('No lesson');
  });

  it('refuses a positional word, with the usage', async () => {
    const tree = plant(projectFile(RECURRED));

    const answered = await run(['instinct', 'promote', 'bun-install'], tree);

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain('rafa instinct promote');
    expect(answered.stdout).toBe('');
  });
});

describe('renderPromotable', () => {
  it('writes each lesson as its line and its action beneath, in the order given', () => {
    const lines = renderPromotable({
      adapter: 'local',
      after: 3,
      minConfidence: 0.7,
      lessons: [record('first', 0.9, 4), record('second', 0.75, 3)],
    });

    expect(lines).toEqual([
      '2 lesson(s) to promote from the `local` learning adapter, at learning.promote.after 3, learning.promote.minConfidence 0.70:',
      '  first  0.90  used 4  when first',
      '      Do first.',
      '  second  0.75  used 3  when second',
      '      Do second.',
    ]);
  });
});
