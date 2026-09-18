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
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { ACTION_HEADING, CAUSE_HEADING } from '../../schema/instinct.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';

import { readRecord } from './instinct-records.js';
import { createInstinctListCommand, instinctRowLine, renderInstinctList, scopeLines } from './list.js';

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

/** Plants one case's tree. A key ending in `/` is an empty directory. */
function plant(files: Readonly<Record<string, string>>): Planted {
  planted += 1;
  const scope = join(tempBase, `case-${String(planted)}`);
  const root = join(scope, 'project');
  const home = join(scope, 'home');
  plantProjectConfig(root);
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

/** Dispatches `words` over the command, with the planted tree's seams. */
async function run(words: readonly string[], tree: Planted) {
  const command = createInstinctListCommand();
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
