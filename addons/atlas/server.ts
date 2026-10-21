/**
 * The PoC server: the page, the graph snapshot, and two small readers the
 * unfolded faces call (a context page, a plan's task reports). Local only.
 */
import { Database } from 'bun:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { buildSnapshot } from './scripts/snapshot.ts';
import { buildServicesDemo } from './src/configs/services-demo.ts';
import index from './src/index.html';
import type { Snapshot } from './src/types.ts';

const REPO_ROOT = resolve(import.meta.dir, '../..');
const SNAPSHOT_PATH = resolve(import.meta.dir, 'data/snapshot.json');
const DOC_PATH = /^context\/[\w-]+\.md$/;
const PLAN_STUB = /^[\w.-]{1,120}$/;
const PORT = Number(process.env.PORT ?? 4317);

let cached: Snapshot | null = existsSync(SNAPSHOT_PATH) ? (JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot) : null;
let storePath: string | null = null;

function snapshot(refresh: boolean): Snapshot {
  if (!cached || refresh) {
    cached = buildSnapshot();
    void Bun.write(SNAPSHOT_PATH, JSON.stringify(cached, null, 2));
  }
  return cached;
}

function planReports(stub: string): unknown[] {
  if (!storePath) {
    const listing = Bun.spawnSync(['git', '-C', REPO_ROOT, 'worktree', 'list', '--porcelain']).stdout.toString();
    const main = /^worktree (.+)$/m.exec(listing)?.[1] ?? REPO_ROOT;
    storePath = join(process.env.RAFA_EFFORT_DIR ?? join(main, '.rafa/effort'), 'effort.sqlite');
  }
  const db = new Database(storePath, { readonly: true });
  try {
    return db.query('select task_line as task, status, outcome, collected_at as at from task_reports where plan_stub = ? order by seq').all(stub);
  } finally {
    db.close();
  }
}

const server = Bun.serve({
  port: PORT,
  routes: {
    '/': index,
    '/api/snapshot': (req) => {
      const params = new URL(req.url).searchParams;
      // The services demo is made up on each request, so its relative dates stay true.
      if (params.get('dataset') === 'services') return Response.json(buildServicesDemo());
      return Response.json(snapshot(params.has('refresh')));
    },
    '/api/doc': (req) => {
      const path = new URL(req.url).searchParams.get('path') ?? '';
      if (!DOC_PATH.test(path)) return new Response('not a context page', { status: 400 });
      const file = join(REPO_ROOT, path);
      return existsSync(file) ? new Response(readFileSync(file, 'utf8')) : new Response('no such page', { status: 404 });
    },
    '/api/plan': (req) => {
      const stub = new URL(req.url).searchParams.get('stub') ?? '';
      if (!PLAN_STUB.test(stub)) return new Response('not a plan stub', { status: 400 });
      try {
        return Response.json(planReports(stub));
      } catch (error) {
        return new Response(error instanceof Error ? error.message : 'store read failed', { status: 500 });
      }
    },
  },
  development: { hmr: true, console: true },
});

process.stdout.write(`Atlas PoC on ${server.url}\n`);
