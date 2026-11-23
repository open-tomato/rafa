/**
 * Tests for the `serve` command over a fixture project in a tmpdir, each
 * on port 0: a start with no replica builds one and answers
 * `/api/atlas/sources`, the budget target of the project's config reaches
 * `pm.budget-burn` as its goal (and with no config it carries none), a
 * rebuild reads rows the store gained, the command runs until its signal
 * aborts, and a root with no store or a bad flag refuses with an error
 * line. Under `--github` the first build and each rebuild ask the stub
 * `gh` they are handed; without it neither does.
 */
import type { AtlasServer } from './serve.js';
import type { GhRunner } from '@open-tomato/rafa-board';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openSqliteStore } from '@open-tomato/rafa-core/store/sqlite';
import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { replicaPathOf } from '../build/index.js';
import { atlasConfigPathOf } from '../config.js';
import { PRS_SOURCE } from '../ingest/github.js';
import { sessionRow, writeFixtureStore } from '../ingest/testdata/effort-store.fixture.js';
import { fixtureGh, throwingGh } from '../ingest/testdata/github.fixture.js';

import { serveCommand, startAtlasServer } from './serve.js';
import { testContext } from './testdata/context.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-serve-command-')));
const started: AtlasServer[] = [];
afterEach(async () => {
  await Promise.all(started.splice(0).map((atlas) => atlas.stop()));
});
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** A fixture project under the scope, its store written. */
function fixtureProject(name: string): string {
  const root = join(scope, name);
  writeFixtureStore(root);
  return root;
}

/** Starts the API over `root` on a free port, stopped after the test; `flags` and `gh` reach every build. */
async function serveOver(
  root: string,
  flags: Readonly<Record<string, string | boolean>> = {},
  gh?: GhRunner,
): Promise<{ atlas: AtlasServer; printed: ReturnType<typeof testContext>['printed'] }> {
  const { context, printed } = testContext({ env: { ATLAS_PROJECT_ROOT: root }, flags });
  const atlas = await startAtlasServer({ context, port: 0, rebuildEveryMinutes: 0, ...(gh === undefined
    ? {}
    : { gh }) });
  started.push(atlas);
  return { atlas, printed };
}

/** The `data` of one envelope the API answers at `path`. */
async function dataAt(atlas: AtlasServer, path: string): Promise<unknown> {
  const response = await fetch(`${atlas.apiUrl}${path}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: unknown }).data;
}

/** The metric `id` the API lists. */
async function metricOf(atlas: AtlasServer, id: string): Promise<Record<string, unknown> | undefined> {
  const metrics = (await dataAt(atlas, '/metrics')) as readonly Record<string, unknown>[];
  return metrics.find((metric) => metric['id'] === id);
}

describe('startAtlasServer over a fixture project', () => {
  it('builds the missing replica, then answers /api/atlas/sources on loopback', async () => {
    const root = fixtureProject('fresh');
    expect(existsSync(replicaPathOf(root))).toBe(false);

    const { atlas, printed } = await serveOver(root);

    expect(atlas.built).toBe(true);
    expect(existsSync(replicaPathOf(root))).toBe(true);
    expect(printed.info[0]).toStartWith('atlas: built ');
    expect(new URL(atlas.apiUrl).hostname).toBe('127.0.0.1');
    const sources = (await dataAt(atlas, '/sources')) as readonly { id: string }[];
    expect(sources.map((source) => source.id)).toContain('local.tasks');
  });

  it('answers a path outside /api/atlas with a 404', async () => {
    const { atlas } = await serveOver(fixtureProject('outside'));

    const response = await fetch(new URL('/', atlas.server.url));

    expect(response.status).toBe(404);
  });

  it('serves the replica already there without building', async () => {
    const root = fixtureProject('kept');
    const first = await serveOver(root);
    await first.atlas.stop();
    started.splice(0);

    const { atlas, printed } = await serveOver(root);

    expect(atlas.built).toBe(false);
    expect(printed.info).toEqual([]);
  });

  it('lays budget.tokensPerWeek over pm.budget-burn as its goal', async () => {
    const root = fixtureProject('budget');
    mkdirSync(join(root, '.rafa', 'atlas'), { recursive: true });
    writeFileSync(atlasConfigPathOf(root), JSON.stringify({ budget: { tokensPerWeek: 18_000_000 }, wipLimit: 3 }));

    const { atlas } = await serveOver(root);

    expect(await metricOf(atlas, 'pm.budget-burn')).toHaveProperty('goal', 18_000_000);
  });

  it('control: with no config, pm.budget-burn carries no goal', async () => {
    const { atlas } = await serveOver(fixtureProject('no-budget'));

    const metric = await metricOf(atlas, 'pm.budget-burn');

    expect(metric).toBeDefined();
    expect(metric).not.toHaveProperty('goal');
  });

  it('reads the rows the store gained once it rebuilds', async () => {
    const root = fixtureProject('rebuild');
    const { atlas, printed } = await serveOver(root);
    const query = { measures: [{ field: 'session_id', agg: 'count', as: 'sessions' }] };
    const count = async (): Promise<unknown> => {
      const response = await fetch(`${atlas.apiUrl}/sources/local.tasks/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(query),
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { data: { rows: readonly unknown[][] } }).data.rows[0]?.[0];
    };
    const before = await count();
    openSqliteStore(root).append('sessions', [sessionRow({
      sessionId: 'session-late',
      kind: 'task',
      first: '2026-11-04T09:00:00.000Z',
      last: '2026-11-04T09:15:00.000Z',
    })]);

    await atlas.rebuild();

    expect(before).toBe(4);
    expect(await count()).toBe(5);
    expect(printed.info.at(-1)).toStartWith('atlas: rebuilt ');
  });
});

describe('startAtlasServer and --github', () => {
  it('asks gh on the first build and on each rebuild under --github, and serves local.prs', async () => {
    const gh = fixtureGh();
    const { atlas } = await serveOver(fixtureProject('github'), { github: true }, gh.runner);
    const prs = async (): Promise<unknown> => {
      const response = await fetch(`${atlas.apiUrl}/sources/${PRS_SOURCE}/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ measures: [{ field: 'number', agg: 'count', as: 'prs' }] }),
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { data: { rows: readonly unknown[][] } }).data.rows[0]?.[0];
    };

    expect(gh.calls.map((args) => args[0])).toEqual(['pr', 'issue']);
    expect(await prs()).toBe(5);
    await atlas.rebuild();
    expect(gh.calls.map((args) => args[0])).toEqual(['pr', 'issue', 'pr', 'issue']);
  });

  it('never asks gh without --github, on the first build or a rebuild', async () => {
    const gh = throwingGh();
    const { atlas, printed } = await serveOver(fixtureProject('no-github'), {}, gh.runner);

    await atlas.rebuild();

    expect(gh.calls).toEqual([]);
    expect(printed.error).toEqual([]);
    expect(printed.info.at(-1)).toStartWith('atlas: rebuilt ');
  });
});

describe('the serve command', () => {
  it('runs until its signal aborts, printing where the API listens', async () => {
    const root = fixtureProject('command');
    const { context, printed, abort } = testContext({ env: { ATLAS_PROJECT_ROOT: root }, flags: { port: '0' } });

    const running = serveCommand.run(context);
    const settled = await Promise.race([running.then(() => 'ended'), Bun.sleep(300).then(() => 'running')]);
    abort();
    await running;

    expect(settled).toBe('running');
    expect(printed.error).toEqual([]);
    expect(printed.info.at(-1)).toMatch(/^atlas: API at http:\/\/127\.0\.0\.1:\d+\/api\/atlas over .*atlas\.sqlite, built on this start$/);
  });

  it('refuses a root with no effort store with an error line', async () => {
    const root = join(scope, 'no-store');
    const { context, printed } = testContext({ env: { ATLAS_PROJECT_ROOT: root }, flags: { port: '0' } });

    await expect(serveCommand.run(context)).rejects.toThrow('no effort store');
    expect(printed.error).toHaveLength(1);
    expect(printed.error[0]).toContain('no effort store');
    expect(existsSync(replicaPathOf(root))).toBe(false);
  });

  it.each([
    [{ port: 'eighty' }, '--port is "eighty"'],
    [{ port: '70000' }, '--port is 70000'],
    [{ 'rebuild-every': '-5' }, '--rebuild-every is "-5"'],
    [{ github: 'maybe' }, '--github is "maybe"'],
  ])('refuses the flags %p with an error line before it builds', async (flags, message) => {
    const root = join(scope, 'flags');
    const { context, printed } = testContext({ env: { ATLAS_PROJECT_ROOT: root }, flags });

    await expect(serveCommand.run(context)).rejects.toThrow(message);
    expect(printed.error).toEqual([expect.stringContaining(message)]);
  });
});
