/**
 * Tests for the skill half of `rafa effort collect` (`collect-skills.ts`),
 * its `--skills` flag (`collect-args.ts`) and how `collectEffort` hands it
 * sessions.
 *
 * The session logs are copies of the recorded fixture under
 * `testdata/skill-use/`, a real session with two main-thread `Skill` calls
 * and one in a subagent, so a count here is the collector's reading of a
 * real log rather than of lines this file wrote. Each case that expects
 * nothing to be read sits beside a control over the same tree that reads
 * it, so a half that read nothing at all would redden the pair.
 *
 * Every run passes an NDJSON store: the session rows then land in
 * `sessions.ndjson`, and `effort.sqlite` holds only what the skill half
 * wrote, so the file's absence says the half wrote nothing.
 */
import type { CollectOptions } from './collect.js';
import type { EffortStore } from './store/types.js';

import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'bun:test';

import { parseCollectArgs } from './collect-args.js';
import { formatSkillSummary } from './collect-skills.js';
import { collectEffort, collectSessionRow, formatCollectSummary, listSessionLogs } from './collect.js';
import { openNdjsonStore } from './store/index.js';
import { readSkillInvocations } from './store/skill-invocations.js';

/** The recorded session's id. */
const FIXTURE_ID = 'ac7aeff1-84f2-46c9-bb9c-b9ceb994599f';

/** The recorded session's directory: its main log and its subagent logs. */
const FIXTURE_DIR = fileURLToPath(new URL('./testdata/skill-use/', import.meta.url));

/** What the recorded session invoked, as `readSkillInvocations` answers it. */
const FIXTURE_ROWS = [
  { sessionId: FIXTURE_ID, name: 'fixture-alpha', sidechain: false, count: 1 },
  { sessionId: FIXTURE_ID, name: 'fixture-alpha', sidechain: true, count: 1 },
  { sessionId: FIXTURE_ID, name: 'fixture-beta', sidechain: false, count: 1 },
];

/** A second session, with no versioned record, so its count is unknown. */
const PLAIN_ID = 'plain-session';

/** Running as root defeats a permission-denied plant. */
const isRoot = process.getuid?.() === 0;

const scratch: string[] = [];

afterEach(() => {
  while (scratch.length > 0) {
    const dir = scratch.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** A scratch repo root whose `logs/` holds the fixture session. */
function fixtureTree(): { root: string; logDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'rafa-collect-skills-'));
  scratch.push(root);
  const logDir = join(root, 'logs');
  cpSync(FIXTURE_DIR, logDir, { recursive: true });
  mkdirSync(join(root, 'plans'));
  return { root, logDir };
}

/** Plants a log with no versioned record beside the fixture. */
function plantPlainLog(logDir: string): void {
  writeFileSync(join(logDir, `${PLAIN_ID}.jsonl`), `${JSON.stringify({ type: 'assistant', message: { content: [] } })}\n`);
}

/** A quiet run over the tree with the store passed, reading no commit. */
function options(tree: { root: string; logDir: string }, store: EffortStore, extra: Partial<CollectOptions> = {}): CollectOptions {
  return {
    home: tree.root,
    repoRoot: tree.root,
    logDir: tree.logDir,
    plansDir: join(tree.root, 'plans'),
    store,
    collectCommits: false,
    log: () => undefined,
    ...extra,
  };
}

/** Stores the session row of each named log, as a collect from before the skill half would have. */
async function storeSessionRows(tree: { logDir: string }, store: EffortStore, ids: readonly string[]): Promise<void> {
  const candidates = listSessionLogs(tree.logDir).filter((candidate) => ids.includes(candidate.sessionId));
  const rows = await Promise.all(candidates.map((candidate) => collectSessionRow(candidate, [])));
  store.append('sessions', rows);
}

/** The SQLite store file under a root, spelled here. */
function sqlitePath(root: string): string {
  return join(root, '.rafa', 'effort', 'effort.sqlite');
}

describe('--skills', () => {
  it('asks for the stored sessions, and is off by default', () => {
    expect(parseCollectArgs(['--skills']).collectHeldSkills).toBe(true);
    expect(parseCollectArgs([]).collectHeldSkills).toBe(false);
  });

  it('lifts the refusal of --no-git beside --no-sessions, which stands without it', () => {
    expect(parseCollectArgs(['--no-git', '--no-sessions', '--skills']).errors).toEqual([]);
    expect(parseCollectArgs(['--no-git', '--no-sessions']).errors).toEqual([
      '--no-git with --no-sessions leaves nothing to collect, unless --skills counts the stored sessions',
    ]);
  });

  it('is refused with a value, as any unrecognised argument is', () => {
    expect(parseCollectArgs(['--skills=all']).errors).toEqual(['unrecognised argument: --skills=all']);
  });
});

describe('the skill half over the sessions a run appends', () => {
  it('counts the main-thread and sidechain calls of each session the session half read', async () => {
    const tree = fixtureTree();

    const result = await collectEffort(options(tree, openNdjsonStore(tree.root)));

    expect(result.sessions?.appended).toBe(1);
    expect(result.skills).toEqual({
      scope: 'appended',
      storePath: sqlitePath(tree.root),
      candidates: 1,
      alreadyCounted: 0,
      read: 1,
      unknown: 0,
      failed: 0,
      appended: 3,
      skippedOnAppend: 0,
    });
    expect(readSkillInvocations(tree.root)).toEqual(FIXTURE_ROWS);
  });

  it('reads nothing on a second run, whose session half appends nothing', async () => {
    const tree = fixtureTree();
    const store = openNdjsonStore(tree.root);
    await collectEffort(options(tree, store));

    const second = await collectEffort(options(tree, store));

    expect(second.sessions?.alreadyCollected).toBe(1);
    expect(second.skills?.candidates).toBe(0);
    expect(second.skills?.read).toBe(0);
    expect(readSkillInvocations(tree.root)).toEqual(FIXTURE_ROWS);
  });

  it('does not reach a session the store already held, which --skills then counts', async () => {
    const tree = fixtureTree();
    const store = openNdjsonStore(tree.root);
    await storeSessionRows(tree, store, [FIXTURE_ID]);

    const appended = await collectEffort(options(tree, store));
    const held = await collectEffort(options(tree, store, { skills: 'held' }));

    expect(appended.skills?.candidates).toBe(0);
    expect(held.skills?.candidates).toBe(1);
    expect(held.skills?.appended).toBe(3);
  });

  it('runs nothing and writes no store file when the session half is off', async () => {
    const tree = fixtureTree();

    const result = await collectEffort(options(tree, openNdjsonStore(tree.root), { collectSessions: false, collectCommits: true, readCommits: () => ({ rows: [], lineCount: 0, unparsedLineCount: 0 }) }));

    expect(result.skills).toBeNull();
    expect(existsSync(sqlitePath(tree.root))).toBe(false);
  });

  it('runs nothing and writes no store file when handed a null scope, for a root that is not its own', async () => {
    const tree = fixtureTree();

    const result = await collectEffort(options(tree, openNdjsonStore(tree.root), { skills: null }));

    expect(result.sessions?.appended).toBe(1);
    expect(result.skills).toBeNull();
    expect(existsSync(sqlitePath(tree.root))).toBe(false);
  });

  it('stores a session whose log it cannot vouch for as unknown, not as none', async () => {
    const tree = fixtureTree();
    plantPlainLog(tree.logDir);

    const result = await collectEffort(options(tree, openNdjsonStore(tree.root)));

    expect(result.skills?.read).toBe(2);
    expect(result.skills?.unknown).toBe(1);
    expect(readSkillInvocations(tree.root).filter((row) => row.sessionId === PLAIN_ID)).toEqual([
      { sessionId: PLAIN_ID, name: null, sidechain: null, count: 'unknown' },
    ]);
  });
});

describe('the skill half over the sessions the store holds', () => {
  it('reads every stored session with a log, and no log whose session is not stored', async () => {
    const tree = fixtureTree();
    plantPlainLog(tree.logDir);
    const store = openNdjsonStore(tree.root);
    await storeSessionRows(tree, store, [FIXTURE_ID]);

    const result = await collectEffort(options(tree, store, { collectSessions: false, skills: 'held' }));

    expect(result.sessions).toBeNull();
    expect(result.skills?.scope).toBe('held');
    expect(result.skills?.candidates).toBe(1);
    expect(readSkillInvocations(tree.root)).toEqual(FIXTURE_ROWS);
  });

  it('skips a session already counted, reading it again only when it holds no row', async () => {
    const tree = fixtureTree();
    const store = openNdjsonStore(tree.root);
    await storeSessionRows(tree, store, [FIXTURE_ID]);
    await collectEffort(options(tree, store, { collectSessions: false, skills: 'held' }));

    const second = await collectEffort(options(tree, store, { collectSessions: false, skills: 'held' }));

    expect(second.skills).toMatchObject({ candidates: 1, alreadyCounted: 1, read: 0, appended: 0 });
    expect(readSkillInvocations(tree.root)).toEqual(FIXTURE_ROWS);
  });

  it('leaves out a stored session whose log is older than --since, and reads it without', async () => {
    const tree = fixtureTree();
    const store = openNdjsonStore(tree.root);
    await storeSessionRows(tree, store, [FIXTURE_ID]);
    const old = new Date('2026-01-01T00:00:00Z');
    utimesSync(join(tree.logDir, `${FIXTURE_ID}.jsonl`), old, old);
    const held = { collectSessions: false, skills: 'held' } as const;

    const windowed = await collectEffort(options(tree, store, { ...held, sinceEpochMs: Date.parse('2026-06-01') }));
    const unbounded = await collectEffort(options(tree, store, held));

    expect(windowed.skills?.candidates).toBe(0);
    expect(unbounded.skills?.candidates).toBe(1);
  });

  it.skipIf(isRoot)('counts a log it cannot read as failed and writes nothing for it', async () => {
    const tree = fixtureTree();
    const store = openNdjsonStore(tree.root);
    await storeSessionRows(tree, store, [FIXTURE_ID]);
    const path = join(tree.logDir, `${FIXTURE_ID}.jsonl`);
    const lines: string[] = [];
    chmodSync(path, 0o000);

    try {
      const result = await collectEffort(options(tree, store, { collectSessions: false, skills: 'held', log: (line) => lines.push(line) }));

      expect(result.skills).toMatchObject({ candidates: 1, read: 0, failed: 1, appended: 0 });
      expect(lines.filter((line) => line.startsWith(`skills: FAILED ${path}`))).toHaveLength(1);
      expect(readSkillInvocations(tree.root)).toEqual([]);
    } finally {
      chmodSync(path, 0o644);
    }
  });
});

describe('the skill summary line', () => {
  it('names the scope and every count', () => {
    const summary = {
      scope: 'held' as const,
      storePath: '/s',
      candidates: 4,
      alreadyCounted: 1,
      read: 3,
      unknown: 1,
      failed: 0,
      appended: 5,
      skippedOnAppend: 0,
    };

    expect(formatSkillSummary(summary))
      .toBe('  skills    4 stored sessions, 1 already counted, 3 read, 1 unknown, 0 failed, +5 rows');
    expect(formatSkillSummary({ ...summary, scope: 'appended' })).toStartWith('  skills    4 appended sessions');
  });

  it('closes the collect summary', async () => {
    const tree = fixtureTree();
    const result = await collectEffort(options(tree, openNdjsonStore(tree.root)));

    expect(formatCollectSummary(result).at(-1))
      .toBe('  skills    1 appended sessions, 0 already counted, 1 read, 0 unknown, 0 failed, +3 rows');
  });
});
