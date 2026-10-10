/**
 * Tests for the instinct scopes read as records
 * (`schema/scope-records.ts`): what a caller outside `src/commands/`
 * reads off {@link readScope} and {@link readScopes}.
 *
 * Every case plants a home and a project root under a temporary
 * directory of this file's own, so nothing reads the real
 * `~/.rafa/instincts`. The record rules one by one — which names are
 * records, what a half-written file reads as, the id lookup — are held
 * by the command half's tests
 * (`commands/instinct/instinct-records.test.ts`), which import this
 * module.
 *
 * Each reading sits beside its control: the adapter's store files are
 * skipped beside a record planted in the same directory (a reader that
 * found nothing would skip them too), a broken record is listed with
 * its issues beside a clean one listed with none, and an absent scope
 * answers empty beside a present one that does not.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { ACTION_HEADING, CAUSE_HEADING } from './instinct.js';
import { readScope, readScopes } from './scope-records.js';
import { RAFA_INSTINCTS_PATH } from './tiers.js';

/** A temporary directory of this file's own, its path resolved through every link. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-scope-records-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A record whose every field is one nothing refuses, with `id` given. */
function recordText(id: string, scope: string): string {
  return [
    '---',
    `id: ${id}`,
    'trigger: when running tests in a freshly forked worktree',
    'kind: gotcha',
    'domain: workflow',
    'confidence: 0.6',
    'usage_count: 3',
    'artifact: Cannot find package',
    'signal: loud',
    `scope: ${scope}`,
    'source: task-report',
    'evidence:',
    '  - plan: my-feature',
    '    outcome: blocked',
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

/** What one case planted: a home and a project root, each with its scope directory. */
interface Planted {
  readonly home: string;
  readonly root: string;
  readonly userDir: string;
  readonly projectDir: string;
}

/** Makes one case's two roots. Neither scope directory is there until a case plants in it. */
function plant(): Planted {
  planted += 1;
  const base = join(tempBase, `case-${String(planted)}`);
  const home = join(base, 'home');
  const root = join(base, 'project');
  mkdirSync(home, { recursive: true });
  mkdirSync(root, { recursive: true });
  return { home, root, userDir: join(home, RAFA_INSTINCTS_PATH), projectDir: join(root, RAFA_INSTINCTS_PATH) };
}

/** Writes `files` under `dir`, making it. */
function fill(dir: string, files: Readonly<Record<string, string>>): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text, 'utf8');
}

describe('readScope', () => {
  it('lists the records of a scope in id order and passes over the adapter store', () => {
    const tree = plant();
    fill(tree.userDir, {
      'second.md': recordText('second', 'user'),
      'first.md': recordText('first', 'user'),
      'instincts.ndjson': '{"id":"first"}\n',
      'flags.ndjson': '{"id":"first"}\n',
    });

    const listing = readScope('user', tree.userDir);

    expect(listing.exists).toBe(true);
    expect(listing.dir).toBe(tree.userDir);
    expect(listing.records.map((entry) => entry.id)).toEqual(['first', 'second']);
    expect(listing.records.map((entry) => entry.scope)).toEqual(['user', 'user']);
    expect(listing.records.map((entry) => entry.path)).toEqual([
      join(tree.userDir, 'first.md'),
      join(tree.userDir, 'second.md'),
    ]);
  });

  it('lists a record that broke a rule with its issues, beside a clean one with none', () => {
    const tree = plant();
    fill(tree.projectDir, {
      'clean.md': recordText('clean', 'project'),
      'half.md': recordText('half', 'project').replace('confidence: 0.6', 'confidence: 3'),
    });

    const [clean, half] = readScope('project', tree.projectDir).records;

    expect(clean?.instinct?.id).toBe('clean');
    expect(clean?.issues).toEqual([]);
    expect(half?.instinct).toBeNull();
    expect(half?.issues.map((issue) => issue.code)).toEqual(['confidence-out-of-range']);
  });

  it('answers an empty listing for a scope whose directory is not there', () => {
    const tree = plant();

    expect(readScope('user', tree.userDir)).toEqual({ scope: 'user', dir: tree.userDir, exists: false, records: [] });
  });
});

describe('readScopes', () => {
  it('reads both scopes, the project one first', () => {
    const tree = plant();
    fill(tree.projectDir, { 'project-one.md': recordText('project-one', 'project') });
    fill(tree.userDir, { 'user-one.md': recordText('user-one', 'user') });

    const listings = readScopes({ home: tree.home, projectRoot: tree.root });

    expect(listings.map((listing) => listing.scope)).toEqual(['project', 'user']);
    expect(listings.map((listing) => listing.dir)).toEqual([tree.projectDir, tree.userDir]);
    expect(listings.map((listing) => listing.records.map((entry) => entry.id))).toEqual([['project-one'], ['user-one']]);
  });

  it('answers the absent scope empty beside the one that is there', () => {
    const tree = plant();
    fill(tree.userDir, { 'user-one.md': recordText('user-one', 'user') });

    const listings = readScopes({ home: tree.home, projectRoot: tree.root });

    expect(listings.map((listing) => listing.exists)).toEqual([false, true]);
    expect(listings.map((listing) => listing.records.length)).toEqual([0, 1]);
  });
});
