/**
 * The stored session log path across modules, over fixture stores under
 * `tmpdir()`: `collectEffort` writes a row, the SQLite store answers it,
 * and `mergeStore` settles a pair of stores holding the one session in
 * the two forms of `filePath` (#1489).
 *
 * The negative case comes first: a `logDir` override outside
 * `.claude/projects/` keeps its absolute path through collect, read and
 * merge. The positive cases then hold a collect under a fixture HOME to
 * answer no `filePath` starting with `/`, and a merge of an absolute row
 * with its relative twin to record no conflict and answer the relative form.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';

import { sessionLogDir } from '@open-tomato/rafa/effort/session-log-dirs';
import { mergeStore } from '@open-tomato/rafa/store/merge-store';
import { openSqliteStore, sqliteStorePath } from '@open-tomato/rafa/store/sqlite';
import { collectEffort } from '@open-tomato/rafa-effort/effort/collect';

import { freshDevice } from '../../merged-stores.js';

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh real directory under `tmpdir()`. */
function makeScratch(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-session-path-merge-')));
  scratch.push(dir);
  return dir;
}

/** Plants one task session log named `<id>.jsonl` in `dir`; answers its path. */
function plantLog(dir: string, id: string): string {
  const path = join(dir, `${id}.jsonl`);
  const lines = [
    { type: 'queue-operation', operation: 'enqueue', content: 'Add the thing\nMore boilerplate here.' },
    {
      type: 'assistant', gitBranch: 'feat/x', timestamp: '2026-09-08T10:00:00.000Z', sessionId: id,
      message: { model: 'claude-opus', usage: { input_tokens: 10, output_tokens: 20 } },
    },
  ];
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return path;
}

/** A device's project root, with a plans directory, under `scope`. */
function device(scope: string, origin: string): { root: string; plansDir: string } {
  const { root } = freshDevice(scope, origin);
  const plansDir = join(root, 'plans');
  mkdirSync(plansDir);
  return { root, plansDir };
}

/** Collects the sessions of `home` (or of `logDir`) into the store of `root`. */
async function collectInto(
  target: { root: string; plansDir: string },
  home: string,
  logDir?: string,
): Promise<void> {
  await collectEffort({
    home,
    repoRoot: target.root,
    plansDir: target.plansDir,
    ...(logDir === undefined
      ? {}
      : { logDir }),
    store: openSqliteStore(target.root),
    collectCommits: false,
    skills: null,
    log: () => undefined,
  });
}

/** Merges the store of `other` into the store of `into`. */
function mergeInto(into: string, other: string): void {
  const result = mergeStore({
    path: sqliteStorePath(into),
    otherPath: sqliteStorePath(other),
    backend: 'sqlite',
    dryRun: false,
    stamp: '20260929T120000Z',
    now: () => new Date('2026-09-29T12:00:00.000Z'),
    readProject: () => ({ rootCommit: null, remote: null }),
    identity: { kind: 'installed', entry: '/home/u/.rafa/runtime/0.26.0/cli.js' },
    isAlive: () => false,
  });
  if (result.status !== 'merged') throw new Error(`merge answered ${result.status}`);
}

/** How many `merge_conflicts` rows the store of `root` holds. */
function conflictCount(root: string): number {
  const db = new Database(sqliteStorePath(root), { readonly: true });
  try {
    return db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM merge_conflicts').get()?.n ?? -1;
  } finally {
    db.close();
  }
}

/** The `filePath` inside the stored `row_json` of every session of `root`. */
function storedPaths(root: string): string[] {
  const db = new Database(sqliteStorePath(root), { readonly: true });
  try {
    return db.query<{ row_json: string }, []>('SELECT row_json FROM sessions ORDER BY seq').all()
      .map(({ row_json: json }) => (JSON.parse(json) as { filePath: string }).filePath);
  } finally {
    db.close();
  }
}

/** The `filePath` of every session `root`'s store answers. */
function readPaths(root: string): string[] {
  return openSqliteStore(root).read('sessions')
    .map((row) => row.filePath);
}

describe('a logDir override outside .claude/projects/ (control)', () => {
  it('keeps its absolute path through collect, read and merge', async () => {
    const scope = makeScratch();
    const outside = makeScratch();
    const path = plantLog(outside, 's-outside');
    const first = device(scope, 'store-a');
    const second = device(scope, 'store-b');
    await collectInto(first, makeScratch(), outside);
    await collectInto(second, makeScratch(), outside);

    expect(readPaths(first.root)).toEqual([path]);
    mergeInto(first.root, second.root);

    expect(conflictCount(first.root)).toBe(0);
    expect(storedPaths(first.root)).toEqual([path]);
    expect(readPaths(first.root)).toEqual([path]);
  });
});

describe('a collect under a fixture HOME', () => {
  it('answers no filePath starting with a slash from the port\'s read', async () => {
    const scope = makeScratch();
    const home = makeScratch();
    const target = device(scope, 'store-a');
    const dir = sessionLogDir(target.root, home);
    mkdirSync(dir, { recursive: true });
    plantLog(dir, 's-one');
    plantLog(dir, 's-two');

    await collectInto(target, home);

    const paths = readPaths(target.root);
    expect(paths).toHaveLength(2);
    expect(paths.filter((path) => path.startsWith('/'))).toEqual([]);
    expect(storedPaths(target.root).filter((path) => path.startsWith('/'))).toEqual([]);
  });
});

describe('mergeStore over one session held in the two forms of filePath', () => {
  /** A store holding `s-one` with its absolute path, and one holding it relative. */
  async function twoForms(): Promise<{ absolute: { root: string }; relative: { root: string }; stored: string }> {
    const scope = makeScratch();
    const home = makeScratch();
    const relative = device(scope, 'store-b');
    const dir = sessionLogDir(relative.root, home);
    mkdirSync(dir, { recursive: true });
    plantLog(dir, 's-one');
    await collectInto(relative, home);
    const [row] = openSqliteStore(relative.root).read('sessions');
    if (row === undefined) throw new Error('no collected row');
    const absolute = device(scope, 'store-a');
    openSqliteStore(absolute.root).append('sessions', [{ ...row, filePath: join(home, '.claude', 'projects', row.filePath) }]);
    return { absolute, relative, stored: row.filePath };
  }

  it('writes no merge_conflicts row and answers the relative form, merged from the absolute side', async () => {
    const { absolute, relative, stored } = await twoForms();

    mergeInto(absolute.root, relative.root);

    expect(conflictCount(absolute.root)).toBe(0);
    expect(readPaths(absolute.root)).toEqual([stored]);
    expect(stored.startsWith('/')).toBe(false);
  });

  it('writes no merge_conflicts row and answers the relative form, merged from the relative side', async () => {
    const { absolute, relative, stored } = await twoForms();

    mergeInto(relative.root, absolute.root);

    expect(conflictCount(relative.root)).toBe(0);
    expect(readPaths(relative.root)).toEqual([stored]);
  });
});
