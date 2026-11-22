/**
 * Tests for the demo server: `Bun.serve` on port 0 over a fixture replica
 * in a tmpdir answers the three sources on `GET /api/atlas/sources`, lists
 * the metrics the live source runs, and feeds the live source end to end;
 * a root with no effort store mounts no API (D7), and `RAFA_EFFORT_DIR`
 * wins over the root.
 *
 * The replica is written with the replica writer, rows made up here and
 * dated yesterday and the day before, so the live source's `last` windows
 * reach them. Each root that mounts has a replica, so no build runs and
 * the store file is only looked for: an empty file stands in for it.
 *
 * The page's preload registers happy-dom, whose `fetch` and `Response`
 * replace Bun's and refuse a cross-origin read. This file puts Bun's back
 * for its run (`test/bun-network.ts`) and happy-dom's after. It leaves the
 * window registered: testing-library's `screen` is bound to the first
 * window's body, so a fresh window would leave a later file's `screen`
 * reading an empty one.
 */
import type { LensResult } from './data/source.js';
import type { DemoServer } from './server.js';
import type { DataSourceDescriptor, Envelope, MetricDefinition } from '@open-tomato/atlas-data/contract';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeReplica } from '@open-tomato/atlas-data/replica';
import { createAtlasClient } from '@open-tomato/atlas-transport/client';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { useBunNetwork } from '../test/bun-network.js';

import { createLiveLensSource, LIVE_API_BASE, LIVE_METRICS, LIVE_UNAVAILABLE } from './data/live.js';
import { resolveProjectRoot, startDemoServer } from './server.js';

const DAY_MS = 86_400_000;

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-demo-server-')));
/** A store and a replica: the API mounts. */
const project = join(scope, 'project');
/** Neither: the API does not mount. */
const bare = join(scope, 'bare');
/** A replica but no store of its own; a store elsewhere for `RAFA_EFFORT_DIR`. */
const copied = join(scope, 'copied');
const storeCopy = join(scope, 'store-copy');

/** A day `back` days before today (UTC), as `YYYY-MM-DD`. */
function daysAgo(back: number): string {
  return new Date(Date.now() - back * DAY_MS).toISOString()
    .slice(0, 10);
}

const DAYS = [daysAgo(2), daysAgo(1)] as const;

/** Two task sessions, one per day and model, and the two days they roll up to. */
async function writeFixtureReplica(root: string): Promise<void> {
  await writeReplica({ replicaPath: join(root, '.rafa', 'atlas', 'atlas.sqlite'), projectLabel: 'fixture' }, (build) => {
    const task = build.database.prepare(`INSERT INTO task_facts (session_id, kind, model, started_at, day, minutes, tokens)
      VALUES (?, 'task', ?, ?, ?, ?, ?)`);
    task.run('stub-session-1', 'stub-model-a', `${DAYS[0]}T09:00:00.000Z`, DAYS[0], 30, 1_000);
    task.run('stub-session-2', 'stub-model-b', `${DAYS[1]}T09:00:00.000Z`, DAYS[1], 50, 3_000);
    const day = build.database.prepare('INSERT INTO daily_rollup (day, sessions, task_sessions, minutes_task, tokens_task, tokens_total) VALUES (?, 1, 1, ?, ?, ?)');
    day.run(DAYS[0], 30, 1_000, 1_000);
    day.run(DAYS[1], 50, 3_000, 3_000);
    for (const [source, rows] of [['local.tasks', 2], ['local.daily', 2]] as const) {
      build.stampSource({ source, asOf: `${DAYS[1]}T09:00:00.000Z`, readAt: build.builtAt, rows, partial: false, reason: null });
    }
  });
}

/** An empty file where `dir` keeps its effort store: enough for the server to find one. */
function plantStore(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'effort.sqlite'), '');
}

let demo: DemoServer | null = null;
let restoreNetwork: (() => void) | null = null;

beforeAll(async () => {
  restoreNetwork = useBunNetwork();
  plantStore(join(project, '.rafa', 'effort'));
  await writeFixtureReplica(project);
  mkdirSync(bare, { recursive: true });
  await writeFixtureReplica(copied);
  plantStore(storeCopy);
  demo = await startDemoServer({ env: { ATLAS_PROJECT_ROOT: project }, port: 0 });
});

afterAll(async () => {
  await demo?.stop();
  rmSync(scope, { recursive: true, force: true });
  restoreNetwork?.();
});

function started(): DemoServer {
  if (demo === null) throw new Error('the demo server did not start');
  return demo;
}

function apiUrl(server: DemoServer, path: string): string {
  return new URL(`${LIVE_API_BASE}${path}`, server.server.url).href;
}

async function envelopeOf<T>(response: Response): Promise<Envelope<T>> {
  return await response.json() as Envelope<T>;
}

describe('resolveProjectRoot', () => {
  it('takes ATLAS_PROJECT_ROOT when set, resolved', () => {
    expect(resolveProjectRoot({ ATLAS_PROJECT_ROOT: project }, bare)).toBe(project);
  });

  it('control: falls back when it is unset or empty', () => {
    expect(resolveProjectRoot({}, bare)).toBe(bare);
    expect(resolveProjectRoot({ ATLAS_PROJECT_ROOT: '' }, bare)).toBe(bare);
  });
});

describe('the demo server over a fixture replica', () => {
  it('mounts the API over the root ATLAS_PROJECT_ROOT names, building nothing', () => {
    const { mount } = started();

    expect(mount?.projectRoot).toBe(project);
    expect(mount?.built).toBe(false);
    expect(started().server.port).toBeGreaterThan(0);
  });

  it('answers the three sources on GET /api/atlas/sources', async () => {
    const response = await fetch(apiUrl(started(), '/sources'));
    const body = await envelopeOf<DataSourceDescriptor[]>(response);

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.data?.map((source) => source.id)).toEqual(['local.tasks', 'local.daily', 'local.plans']);
  });

  it('lists every metric the live source runs', async () => {
    const body = await envelopeOf<MetricDefinition[]>(await fetch(apiUrl(started(), '/metrics')));

    expect(body.data?.map((metric) => metric.id)).toEqual(expect.arrayContaining(Object.values(LIVE_METRICS)));
  });

  it('feeds the live source end to end: the fixture\'s tokens per day and per model', async () => {
    const client = createAtlasClient({ baseUrl: apiUrl(started(), '') });

    const result: LensResult = await createLiveLensSource(client)('last-week');

    expect(result.mock.tokensPerDay.map((point) => point.y)).toEqual([1_000, 3_000]);
    expect(result.mock.tokensByModel.map((series) => series.id)).toEqual(['stub-model-b', 'stub-model-a']);
    expect(result.mock.taskMinutesQuantiles.length).toBeGreaterThan(0);
  });
});

describe('the demo server where no store resolves', () => {
  it('mounts no API: /api/atlas answers a plain 404, and the live source fails with the start line', async () => {
    const plain = await startDemoServer({ env: {}, port: 0, defaultRoot: bare });
    try {
      const response = await fetch(apiUrl(plain, '/sources'));

      expect(plain.mount).toBeNull();
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Not found');
      await expect(createLiveLensSource(createAtlasClient({ baseUrl: apiUrl(plain, '') }))('now')).rejects.toThrow(LIVE_UNAVAILABLE);
    } finally {
      await plain.stop();
    }
  });

  it('mounts over a root with no store of its own when RAFA_EFFORT_DIR names one', async () => {
    const withCopy = await startDemoServer({ env: { ATLAS_PROJECT_ROOT: copied, RAFA_EFFORT_DIR: storeCopy }, port: 0 });
    const without = await startDemoServer({ env: { ATLAS_PROJECT_ROOT: copied }, port: 0 });
    try {
      expect(withCopy.mount?.storePath).toBe(join(storeCopy, 'effort.sqlite'));
      expect((await fetch(apiUrl(withCopy, '/sources'))).status).toBe(200);
      expect(without.mount).toBeNull();
    } finally {
      await withCopy.stop();
      await without.stop();
    }
  });
});
