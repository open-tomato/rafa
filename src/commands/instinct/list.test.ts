/**
 * Tests for `rafa instinct list` (`src/commands/instinct/list.ts`): the
 * rows the two scopes give, the adapter's NDJSON files passed over, the
 * exit code a half-written record does NOT change, and the refusal.
 *
 * Every dispatched case plants a project and a home of its own under a
 * temporary directory of this file's own, and dispatches the command
 * in-process with streams, an environment and a working directory of
 * its own (`src/tests/cli-capture.ts`), so nothing reads the real
 * `~/.rafa/instincts`.
 *
 * ## The controls
 *
 * That `instincts.ndjson` and `flags.ndjson` are passed over is held
 * BESIDE a record planted in the same directory, whose row is printed:
 * a listing that read nothing would leave the NDJSON files out as
 * well, and the count would be the same either way.
 *
 * That a half-written record leaves the exit code 0 is held BESIDE its
 * row, which says it broke a rule and how many: a command that parsed
 * nothing at all would exit 0 too, and would redden every row.
 *
 * `--blessed` and `--conflicts` are read over ONE tree holding a lesson
 * alone on its trigger at 0.8, a pair at 0.5 and 0.55 on another, and a
 * lesson below the bless floor, and the plain listing of that tree
 * prints every one of them: so a view that left a lesson out left it
 * out by its rule, not because nothing was read. The lesson a flag
 * names is held beside the same tree without the flag, where
 * `--blessed` lists it, so its absence is the flag's doing.
 */
import type { AnyAdapter } from '../../adapters/registry.js';
import type { BlessedBundle, InstinctRecord, Learning, MergeResult } from '../../ports/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CORE_ADAPTER_REGISTRY, PORT_VERSIONS } from '../../adapters/registry.js';
import { actionHash } from '../../learning/index.js';
import { projectConfigText } from '../../project/scaffold.js';
import { ACTION_HEADING, CAUSE_HEADING } from '../../schema/instinct.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';

import { readRecord } from './instinct-records.js';
import {
  conflictLines,
  createInstinctListCommand,
  instinctRowLine,
  readListView,
  renderBlessed,
  renderConflicts,
  renderInstinctList,
  scopeConflicts,
  scopeLines,
} from './list.js';

/** The subject the dispatched cases route through. */
const SUBJECTS = [{ name: 'instinct', summary: 'list the records the instinct scopes hold' }];

/** A temporary directory of this file's own, its path resolved through every link. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-instinct-list-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A record whose every field is one nothing refuses. */
function recordText(id: string, scope: string, trigger: string): string {
  return [
    '---',
    `id: ${id}`,
    `trigger: ${trigger}`,
    'kind: gotcha',
    'domain: workflow',
    'confidence: 0.6',
    'signal: loud',
    `scope: ${scope}`,
    'source: loop-observed',
    'created_at: 2026-09-11T10:00:00Z',
    'updated_at: 2026-09-11T10:00:00Z',
    '---',
    '',
    ACTION_HEADING,
    'Run `bun install` before the first test.',
    '',
    CAUSE_HEADING,
    'Worktree creation copies the tree and not its packages.',
    '',
  ].join('\n');
}

/** What one case plants: a project and a home, each with its own instincts. */
interface Planted {
  /** The project root, holding `.rafa/config.yaml`. */
  readonly root: string;
  /** The home the user scope resolves under. */
  readonly home: string;
}

/** Plants one case's tree, the project config written with `config`. A key ending in `/` is an empty directory. */
function plant(files: Readonly<Record<string, string>>, config: string = projectConfigText()): Planted {
  planted += 1;
  const scope = join(tempBase, `case-${String(planted)}`);
  const root = join(scope, 'project');
  const home = join(scope, 'home');
  plantProjectConfig(root, config);
  mkdirSync(home, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const path = join(scope, name);
    if (name.endsWith('/')) {
      mkdirSync(path, { recursive: true });
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return { root, home };
}

/** Dispatches `words` over the command made with `adapters` registered, with the planted tree's seams. */
async function run(words: readonly string[], tree: Planted, adapters: readonly AnyAdapter[] = []) {
  const registry = adapters.reduce((held, adapter) => held.register(adapter), CORE_ADAPTER_REGISTRY);
  const command = createInstinctListCommand({ registry });
  return dispatchInProject(words, SUBJECTS, [command], { root: tree.root, home: tree.home }, { PATH: '' });
}

/** The entry one planted file reads as, for a row rendered outside a dispatch. */
function entryOf(path: string, id: string) {
  return readRecord(path, 'user', id);
}

describe('what an instinct list line says', () => {
  it('writes a readable row, an unreadable one and an absent scope apart', () => {
    const tree = plant({ 'home/.rafa/instincts/bun-install.md': recordText('bun-install', 'user', 'when forking') });
    const path = join(tree.home, '.rafa', 'instincts', 'bun-install.md');

    expect(instinctRowLine(entryOf(path, 'bun-install')))
      .toBe('    ✅ bun-install  gotcha/workflow  loud  0.60  when forking');
    expect(instinctRowLine({ scope: 'user', path, id: 'half', instinct: null, issues: [
      { code: 'missing-field', field: 'kind', message: 'x' },
      { code: 'missing-field', field: 'domain', message: 'y' },
    ] })).toBe('    ❌ half  2 issue(s)');
    expect(scopeLines({ scope: 'user', dir: '/h/.rafa/instincts', exists: false, records: [] }))
      .toEqual(['  user  /h/.rafa/instincts  (no such directory)']);
    expect(scopeLines({ scope: 'project', dir: '/p/.rafa/instincts', exists: true, records: [] }))
      .toEqual(['  project  /p/.rafa/instincts  (no instincts)']);
  });

  it('opens with the project and closes with the two counts', () => {
    const lines = renderInstinctList({
      projectRoot: '/p',
      scopes: [{ scope: 'user', dir: '/h/.rafa/instincts', exists: true, records: [] }],
      total: 3,
      clean: 1,
    });

    expect(lines[0]).toBe('Instincts by scope (project: /p):');
    expect(lines.at(-1)).toBe('3 instinct(s): 1 read as records, 2 do not');
  });
});

describe('rafa instinct list over planted scopes', () => {
  it('lists both scopes in order, each record with what it is about', async () => {
    const tree = plant({
      'project/.rafa/instincts/gate-order.md': recordText('gate-order', 'project', 'when reading a gate'),
      'home/.rafa/instincts/bun-install.md': recordText('bun-install', 'user', 'when forking a worktree'),
    });

    const answered = await run(['instinct', 'list'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stderr).toBe('');
    expect(answered.stdout.split('\n').filter((line) => line !== '')).toEqual([
      `Instincts by scope (project: ${tree.root}):`,
      `  project  ${join(tree.root, '.rafa', 'instincts')}`,
      '    ✅ gate-order  gotcha/workflow  loud  0.60  when reading a gate',
      `  user  ${join(tree.home, '.rafa', 'instincts')}`,
      '    ✅ bun-install  gotcha/workflow  loud  0.60  when forking a worktree',
      '2 instinct(s): 2 read as records, 0 do not',
    ]);
  });

  it('passes over the Learning adapter NDJSON files beside a record it lists', async () => {
    const tree = plant({
      'project/.rafa/instincts/gate-order.md': recordText('gate-order', 'project', 'when reading a gate'),
      'project/.rafa/instincts/instincts.ndjson': '{"id":"pushed-by-the-adapter"}\n',
      'project/.rafa/instincts/flags.ndjson': '{"id":"flagged-by-the-adapter"}\n',
      'project/.rafa/instincts/.DS_Store': 'finder',
    });

    const answered = await run(['instinct', 'list'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toContain('    ✅ gate-order  gotcha/workflow  loud  0.60  when reading a gate');
    expect(answered.stdout).not.toContain('ndjson');
    expect(answered.stdout).not.toContain('DS_Store');
    expect(answered.stdout).toContain('1 instinct(s): 1 read as records, 0 do not');
  });

  it('lists a half-written record with its issue count and still exits 0', async () => {
    const tree = plant({
      'project/.rafa/instincts/gate-order.md': recordText('gate-order', 'project', 'when reading a gate'),
      'project/.rafa/instincts/half.md': '---\nid: half\nkind: gotcha\n---\n\n## Action\nDo it.\n',
    });

    const answered = await run(['instinct', 'list'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toContain('    ✅ gate-order');
    expect(answered.stdout).toMatch(/ {4}❌ half {2}\d+ issue\(s\)/);
    expect(answered.stdout).toContain('2 instinct(s): 1 read as records, 1 do not');
  });

  it('says so for a scope whose directory is not there, and lists the other', async () => {
    const tree = plant({ 'home/.rafa/instincts/bun-install.md': recordText('bun-install', 'user', 'when forking') });

    const answered = await run(['instinct', 'list'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toContain(`  project  ${join(tree.root, '.rafa', 'instincts')}  (no such directory)`);
    expect(answered.stdout).toContain('    ✅ bun-install');
  });

  it('gives the scopes and their records as the data of the terminal result event', async () => {
    const tree = plant({
      'project/.rafa/instincts/gate-order.md': recordText('gate-order', 'project', 'when reading a gate'),
    });

    const answered = await run(['instinct', 'list', '--output=json'], tree);
    const result = eventsOf(answered.stdout).find((event) => event.type === 'result');
    const data = result?.data as { total: number; clean: number; scopes: { scope: string; records: unknown[] }[] };

    expect(answered.exitCode).toBe(0);
    expect(data.total).toBe(1);
    expect(data.clean).toBe(1);
    expect(data.scopes.map((listing) => listing.scope)).toEqual(['project', 'user']);
  });

  it('refuses a positional word with exit code 1 and the usage line', async () => {
    const tree = plant({ 'project/.rafa/instincts/': '' });

    const answered = await run(['instinct', 'list', 'gate-order'], tree);

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain('Expected no argument');
    expect(answered.stderr).toContain('Usage: rafa instinct list');
  });
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
function lessonText(lesson: Lesson): string {
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

/** Alone on its trigger at 0.8: blessed, and no conflict. */
const WINNER: Lesson = { id: 'bun-install', trigger: 'when testing', action: 'Run `bun install` first.', confidence: 0.8, sources: ['s1', 's2'] };

/** One of a pair within the gap on one trigger: flagged. */
const LINT_FIRST: Lesson = { id: 'lint-first', trigger: 'when verifying', action: 'Run lint first.', confidence: 0.5, sources: ['s1'] };

/** The other of the pair, its trigger spelled another way that reads as the same. */
const LINT_LAST: Lesson = { id: 'lint-last', trigger: '  When   VERIFYING ', action: 'Run lint\nlast.', confidence: 0.55, sources: ['s2'] };

/** Alone on its trigger below the default bless floor of 0.5. */
const BELOW: Lesson = { id: 'help-snapshots', trigger: 'when adding a flag', action: 'Regenerate the help.', confidence: 0.4, sources: ['s1'] };

/** The project-scope files the lessons are planted at. */
function projectFiles(...lessons: readonly Lesson[]): Record<string, string> {
  return Object.fromEntries(lessons.map((lesson) => [`project/.rafa/instincts/${lesson.id}.md`, lessonText(lesson)]));
}

/** The four lessons every view case reads. */
const MIXED = projectFiles(WINNER, LINT_FIRST, LINT_LAST, BELOW);

/** A record as a learning adapter answers it. */
function record(id: string, confidence: number, usage: number, trigger = `when ${id}`): InstinctRecord {
  const action = `Do ${id}.`;
  return {
    id,
    trigger,
    action,
    action_hash: actionHash(action),
    confidence,
    usage_count: usage,
    signal: 'loud',
    status: 'flagged',
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

/** The non-empty lines of a capture. */
function linesOf(text: string): string[] {
  return text.split('\n').filter((line) => line !== '');
}

/** The data of the terminal result event. */
function resultData(stdout: string): unknown {
  return eventsOf(stdout).find((event) => event.type === 'result')?.data;
}

describe('which view the line asks for', () => {
  it('reads no flag as every record, and each flag bare or as true as its view', () => {
    expect(readListView({})).toBe('all');
    expect(readListView({ blessed: false, conflicts: 'false' })).toBe('all');
    expect(readListView({ blessed: true })).toBe('blessed');
    expect(readListView({ conflicts: 'true' })).toBe('conflicts');
  });

  it('refuses a value typed with a view flag, and both views at once', () => {
    expect(() => readListView({ blessed: 'gate-order' })).toThrow('--blessed takes no value, and read "gate-order" as one');
    expect(() => readListView({ blessed: true, conflicts: true })).toThrow('--blessed and --conflicts are two views; give one');
  });
});

describe('what the two views write', () => {
  it('groups a scope\'s records by trigger identity, keeping only triggers held with more than one action', () => {
    const tree = plant({ ...MIXED, 'project/.rafa/instincts/half.md': '---\nid: half\n---\n' });
    const dir = join(tree.root, '.rafa', 'instincts');
    const ids = ['bun-install', 'half', 'help-snapshots', 'lint-first', 'lint-last'];
    const records = ids.map((id) => readRecord(join(dir, `${id}.md`), 'project', id));

    const conflicts = scopeConflicts({ scope: 'project', dir, exists: true, records });

    expect(conflicts.map((each) => [each.scope, each.trigger, each.records.map((held) => held.id)])).toEqual([
      ['project', 'when verifying', ['lint-last', 'lint-first']],
    ]);
    expect(conflicts[0]!.records.every((held) => held.status === 'flagged')).toBe(true);
  });

  it('reads one action held under two ids on a trigger as no conflict', () => {
    const tree = plant(projectFiles(LINT_FIRST, { ...LINT_LAST, action: 'Run lint first.' }));
    const dir = join(tree.root, '.rafa', 'instincts');
    const records = ['lint-first', 'lint-last'].map((id) => readRecord(join(dir, `${id}.md`), 'project', id));

    expect(scopeConflicts({ scope: 'project', dir, exists: true, records })).toEqual([]);
  });

  it('writes a flagged trigger\'s actions side by side, ids padded to one column', () => {
    const lines = conflictLines({
      scope: 'user',
      trigger: 'when merging',
      records: [record('a-long-id', 0.6, 2, 'when merging'), record('short', 0.55, 1, 'when merging')],
    });

    expect(lines).toEqual([
      '  user  when merging',
      '    a-long-id  0.60  used 2  Do a-long-id.',
      '    short      0.55  used 1  Do short.',
    ]);
  });

  it('says so when no scope holds a trigger two ways, and when nothing is blessed', () => {
    expect(renderConflicts({ projectRoot: '/p', conflicts: [] }))
      .toEqual(['No trigger either instinct scope holds carries more than one action (project: /p).']);
    expect(renderBlessed({ adapter: 'local', minConfidence: 0.5, lessons: [] }))
      .toEqual(['No lesson the `local` learning adapter holds is blessed at learning.bless.minConfidence 0.50.']);
  });

  it('writes each blessed lesson as its line and its action beneath, in the order given', () => {
    expect(renderBlessed({ adapter: 'local', minConfidence: 0.5, lessons: [record('first', 0.9, 4), record('second', 0.75, 3)] }))
      .toEqual([
        '2 lesson(s) blessed by the `local` learning adapter, at learning.bless.minConfidence 0.50:',
        '  first  0.90  used 4  when first',
        '      Do first.',
        '  second  0.75  used 3  when second',
        '      Do second.',
      ]);
  });
});

describe('rafa instinct list --blessed and --conflicts over one planted tree', () => {
  it('lists all four lessons with neither flag: the control every view reads against', async () => {
    const answered = await run(['instinct', 'list'], plant(MIXED));

    expect(answered.exitCode).toBe(0);
    for (const id of ['bun-install', 'lint-first', 'lint-last', 'help-snapshots']) {
      expect(answered.stdout).toContain(`✅ ${id}  `);
    }
  });

  it('--blessed lists the 0.8 lesson alone: not the flagged pair, not the one below the floor', async () => {
    const answered = await run(['instinct', 'list', '--blessed'], plant(MIXED));

    expect(answered.exitCode).toBe(0);
    expect(answered.stderr).toBe('');
    expect(linesOf(answered.stdout)).toEqual([
      '1 lesson(s) blessed by the `local` learning adapter, at learning.bless.minConfidence 0.50:',
      '  bun-install  0.80  used 2  when testing',
      '      Run `bun install` first.',
    ]);
  });

  it('--blessed reads learning.bless.minConfidence: lowered to 0.4, the lesson below the default floor is listed', async () => {
    const config = `${projectConfigText()}\nlearning:\n  bless:\n    minConfidence: 0.4\n`;

    const answered = await run(['instinct', 'list', '--blessed', '--output=json'], plant(MIXED, config));
    const data = resultData(answered.stdout) as { minConfidence: number; lessons: InstinctRecord[] };

    expect(answered.exitCode).toBe(0);
    expect(data.minConfidence).toBe(0.4);
    expect(data.lessons.map((lesson) => lesson.id)).toEqual(['bun-install', 'help-snapshots']);
  });

  it('--blessed leaves out a lesson a flag names, which it lists without the flag', async () => {
    const flag = `${JSON.stringify({ id: 'bun-install', reason: 'wrong advice', flagged_at: '2026-09-12T10:00:00Z' })}\n`;

    const flagged = await run(['instinct', 'list', '--blessed'], plant({ ...MIXED, 'project/.rafa/instincts/flags.ndjson': flag }));
    const conflicts = await run(['instinct', 'list', '--conflicts'], plant({ ...MIXED, 'project/.rafa/instincts/flags.ndjson': flag }));

    expect(flagged.exitCode).toBe(0);
    expect(flagged.stdout).toContain('No lesson the `local` learning adapter holds is blessed');
    expect(conflicts.stdout).not.toContain('bun-install');
  });

  it('--conflicts prints the flagged pair side by side with confidence and usage, and nothing else', async () => {
    const tree = plant(MIXED);

    const answered = await run(['instinct', 'list', '--conflicts'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stderr).toBe('');
    expect(linesOf(answered.stdout)).toEqual([
      `Triggers held with more than one action (project: ${tree.root}):`,
      '  project  when verifying',
      '    lint-last   0.55  used 1  Run lint last.',
      '    lint-first  0.50  used 1  Run lint first.',
      '1 flagged trigger(s): no bundle blesses any of their actions',
    ]);
  });

  it('--conflicts reads the user scope too, grouped on its own', async () => {
    const user = { ...LINT_FIRST, id: 'user-lint', action: 'Skip lint.' };
    const tree = plant({
      ...projectFiles(WINNER, LINT_FIRST),
      'home/.rafa/instincts/user-lint.md': lessonText(user),
      'home/.rafa/instincts/user-lint-last.md': lessonText({ ...LINT_LAST, id: 'user-lint-last' }),
    });

    const answered = await run(['instinct', 'list', '--conflicts', '--output=json'], tree);
    const data = resultData(answered.stdout) as { conflicts: { scope: string; records: InstinctRecord[] }[] };

    expect(answered.exitCode).toBe(0);
    expect(data.conflicts.map((each) => [each.scope, each.records.map((held) => held.id)])).toEqual([
      ['user', ['user-lint-last', 'user-lint']],
    ]);
  });

  it('--conflicts says none is held when every trigger has one action', async () => {
    const tree = plant(projectFiles(WINNER, BELOW));

    const answered = await run(['instinct', 'list', '--conflicts'], tree);

    expect(answered.exitCode).toBe(0);
    expect(linesOf(answered.stdout))
      .toEqual([`No trigger either instinct scope holds carries more than one action (project: ${tree.root}).`]);
  });

  it('calls pullBlessed and nothing else on the adapter learning.adapter names, listing what it answers', async () => {
    const calls: string[] = [];
    const bundle = { version: 'v', instincts: [record('kept', 0.6, 1)] };
    const tree = plant({}, `${projectConfigText()}\nlearning:\n  adapter: pulling\n`);

    const answered = await run(['instinct', 'list', '--blessed', '--output=json'], tree, [pullingAdapter('pulling', () => Promise.resolve(bundle), calls)]);

    expect(answered.exitCode).toBe(0);
    expect(resultData(answered.stdout)).toEqual({ adapter: 'pulling', minConfidence: 0.5, lessons: bundle.instincts });
    expect(calls).toEqual(['pullBlessed']);
  });
});

describe('the view refusals', () => {
  it('refuses a kind no registry holds, in the list command\'s name', async () => {
    const tree = plant(MIXED, `${projectConfigText()}\nlearning:\n  adapter: remote\n`);

    const answered = await run(['instinct', 'list', '--blessed'], tree);

    expect(answered.exitCode).toBe(1);
    expect(answered.stdout).toBe('');
    expect(answered.stderr).toContain('❌ rafa instinct list: the `remote` learning adapter cannot be made');
  });

  it('refuses a pull the adapter rejects rather than listing nothing', async () => {
    const calls: string[] = [];
    const tree = plant({}, `${projectConfigText()}\nlearning:\n  adapter: pulling\n`);
    const failing = pullingAdapter('pulling', () => Promise.reject(new Error('store is gone')), calls);

    const answered = await run(['instinct', 'list', '--blessed'], tree, [failing]);

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain('❌ rafa instinct list: the `pulling` learning adapter answered no blessed set: store is gone');
    expect(answered.stdout).not.toContain('No lesson');
  });

  it('refuses both views at once, and a word typed after a view flag, with exit code 1 and the usage', async () => {
    const tree = plant(MIXED);

    const both = await run(['instinct', 'list', '--blessed', '--conflicts'], tree);
    const valued = await run(['instinct', 'list', '--conflicts', 'lint-first'], tree);

    expect(both.exitCode).toBe(1);
    expect(both.stderr).toContain('--blessed and --conflicts are two views; give one');
    expect(both.stderr).toContain('Usage: rafa instinct list [--blessed | --conflicts]');
    expect(valued.exitCode).toBe(1);
    expect(valued.stderr).toContain('--conflicts takes no value, and read "lint-first" as one');
  });
});
