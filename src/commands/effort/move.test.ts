/**
 * `rafa effort move` dispatched in planted `store: ndjson` projects
 * under the temp directory. `moveToSqlite`'s own cases
 * (`src/effort/store/move.test.ts`) hold the append, the count check and
 * the config edit, so these hold what the command adds: the lines it
 * prints, the `--to` it takes and refuses, a repeated move, and json.
 *
 * A refused `--to` snapshots the store directory and the config before
 * and after and finds both byte-identical; the move case finds them
 * changed, so a snapshot that could not tell would fail there.
 */
import type { EffortRow } from '../../effort/store/types.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { openNdjsonStore } from '../../effort/store/ndjson.js';
import { openSqliteStore, sqliteStorePath } from '../../effort/store/sqlite.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createMoveCommand } from './move.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-effort-move-command-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** The subject the command sits under, declared for the registry the test dispatches over. */
const EFFORT_SUBJECT = { name: 'effort', summary: 'the effort store' };

const NDJSON_CONFIG = 'version: 1\nstore: ndjson\n';

/** A project reading `store: ndjson`, holding two sessions and one commit as NDJSON. */
function plantNdjsonProject(): PlantedProject {
  const project = plantProject(realpathSync(mkdtempSync(join(scope, 'case-'))), NDJSON_CONFIG);
  const ndjson = openNdjsonStore(project.root);
  ndjson.append('sessions', ['s-1', 's-2'].map((sessionId) => ({ sessionId, assistantRecordCount: 1 }) as unknown as EffortRow<'sessions'>));
  ndjson.append('commits', [{ sha: 'c-1', insertions: 1 } as unknown as EffortRow<'commits'>]);
  return project;
}

/** The store directory's files and the config, by name, with their bytes. */
function snapshot(project: PlantedProject): ReadonlyMap<string, string> {
  const dir = join(project.root, '.rafa', 'effort');
  const config = join(project.root, '.rafa', 'config.yaml');
  return new Map([
    ...readdirSync(dir).sort()
      .map((name): [string, string] => [name, readFileSync(join(dir, name), 'base64')]),
    ['config.yaml', readFileSync(config, 'base64')],
  ]);
}

/** Dispatches `effort move` with `words` in `project`. */
async function run(project: PlantedProject, words: readonly string[]): Promise<CapturedRun> {
  return dispatchInProject(['effort', 'move', ...words], [EFFORT_SUBJECT], [createMoveCommand()], project);
}

describe('rafa effort move', () => {
  it('moves the NDJSON rows, prints the counts and sets store: sqlite', async () => {
    const project = plantNdjsonProject();
    const before = snapshot(project);

    const outcome = await run(project, ['--to=sqlite']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`Moves the NDJSON sessions and commits into ${sqliteStorePath(project.root)}.`);
    expect(outcome.stdout).toContain('  sessions: 2 read, 2 added, 0 already held (from ');
    expect(outcome.stdout).toContain('  commits: 1 read, 1 added, 0 already held (from ');
    expect(outcome.stdout).toContain(`✅ Set store: sqlite in ${join(project.root, '.rafa', 'config.yaml')}.`);
    expect(readFileSync(join(project.root, '.rafa', 'config.yaml'), 'utf8')).toBe('version: 1\nstore: sqlite\n');
    expect([...openSqliteStore(project.root).keys('sessions')].sort()).toEqual(['s-1', 's-2']);
    // Control for the byte-identical readings below: a move changes the snapshot.
    expect(snapshot(project)).not.toEqual(before);
  });

  it('adds nothing and leaves the config as it was when run again', async () => {
    const project = plantNdjsonProject();
    await run(project, ['--to=sqlite']);
    const before = readFileSync(join(project.root, '.rafa', 'config.yaml'), 'utf8');

    const again = await run(project, ['--to=sqlite']);

    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain('  sessions: 2 read, 0 added, 2 already held (from ');
    expect(again.stdout).toContain('  commits: 1 read, 0 added, 1 already held (from ');
    expect(again.stdout).toContain('already reads store: sqlite; left as it was.');
    expect(readFileSync(join(project.root, '.rafa', 'config.yaml'), 'utf8')).toBe(before);
    expect(openSqliteStore(project.root).read('sessions')).toHaveLength(2);
  });

  it.each([
    [['--to=ndjson'], '--to=ndjson'],
    [['--to=postgres'], '--to=postgres'],
    [[], 'no --to'],
  ])('refuses %p with exit code 1, changing nothing', async (words, found) => {
    const project = plantNdjsonProject();
    const before = snapshot(project);

    const outcome = await run(project, words);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`❌ rafa effort move: ${found}; a move writes to sqlite and nothing else. Nothing was moved.`);
    expect(outcome.stderr).toContain('Usage: rafa effort move --to=sqlite');
    expect(snapshot(project)).toEqual(before);
  });

  it('answers the move result as the data of the terminal result in json mode', async () => {
    const project = plantNdjsonProject();

    const outcome = await run(project, ['--to=sqlite', '--output=json']);

    const last = eventsOf(outcome.stdout).at(-1) as unknown as { data: { configChanged: boolean; kinds: { added: number }[] } };
    expect(outcome.exitCode).toBe(0);
    expect(last.data.configChanged).toBe(true);
    expect(last.data.kinds.map((move) => move.added)).toEqual([2, 1]);
  });
});
