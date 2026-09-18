/**
 * Tests for `src/commands/instinct/instinct-records.ts`: which files in
 * a scope are records, what a record reads as, how an absent scope
 * answers, and what an id lookup finds.
 *
 * Every case plants a home and a project root under a temporary
 * directory of this file's own, so nothing reads the real
 * `~/.rafa/instincts`.
 *
 * ## The controls
 *
 * That the Learning adapter's `instincts.ndjson` and `flags.ndjson` are
 * skipped is held BESIDE a `.md` record planted in the same directory:
 * a reader that found nothing at all would skip the NDJSON files too,
 * and would lose the record with them.
 *
 * That a half-written record is listed rather than thrown away is held
 * BESIDE its issues, which say what it broke: a reader that parsed
 * nothing would report a clean record as broken as well.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { ACTION_HEADING, CAUSE_HEADING } from '../../schema/instinct.js';

import {
  findRecords,
  isRecordFile,
  LEARNING_STORE_FILES,
  readRecord,
  readScope,
  readScopes,
  recordFiles,
  recordId,
} from './instinct-records.js';

/** A temporary directory of this file's own, its path resolved through every link. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-instinct-records-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The action every fixture carries. */
const ACTION = 'Run `bun install` before the first test.';

/** The cause every fixture carries. */
const CAUSE = 'Worktree creation copies the tree and not its packages.';

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
    ACTION,
    '',
    CAUSE_HEADING,
    CAUSE,
    '',
  ].join('\n');
}

/** What one case planted. */
interface Planted {
  /** The project root the project scope sits under. */
  readonly root: string;
  /** The home the user scope sits under. */
  readonly home: string;
  /** A path under the case's own directory. */
  readonly at: (name: string) => string;
}

/** Plants one case's tree. A key ending in `/` is an empty directory. */
function plant(files: Readonly<Record<string, string>>): Planted {
  planted += 1;
  const scope = join(tempBase, `case-${String(planted)}`);
  for (const [name, text] of Object.entries(files)) {
    const path = join(scope, name);
    if (name.endsWith('/')) {
      mkdirSync(path, { recursive: true });
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return { root: join(scope, 'project'), home: join(scope, 'home'), at: (name) => join(scope, name) };
}

describe('which files in a scope are records', () => {
  it('takes a markdown file and leaves the adapter store, a dotfile and everything else', () => {
    expect(isRecordFile('bun-install.md')).toBe(true);
    for (const name of LEARNING_STORE_FILES) expect(isRecordFile(name)).toBe(false);
    expect(isRecordFile('.DS_Store')).toBe(false);
    expect(isRecordFile('.hidden.md')).toBe(false);
    expect(isRecordFile('.md')).toBe(false);
    expect(isRecordFile('notes.txt')).toBe(false);
  });

  it('reads the id off the file name', () => {
    expect(recordId('bun-install.md')).toBe('bun-install');
  });

  it('lists the markdown files of a directory in name order, skipping the adapter store', () => {
    const tree = plant({
      'project/.rafa/instincts/second.md': recordText('second', 'project'),
      'project/.rafa/instincts/first.md': recordText('first', 'project'),
      'project/.rafa/instincts/instincts.ndjson': '{"id":"first"}\n',
      'project/.rafa/instincts/flags.ndjson': '{"id":"first"}\n',
      'project/.rafa/instincts/.DS_Store': 'finder',
      'project/.rafa/instincts/nested/deep.md': recordText('deep', 'project'),
    });

    expect(recordFiles(tree.at(join('project', '.rafa', 'instincts')))).toEqual(['first.md', 'second.md']);
  });
});

describe('what one file reads as', () => {
  it('reads a clean record whole, with the action hashed', () => {
    const tree = plant({ 'project/.rafa/instincts/bun-install.md': recordText('bun-install', 'project') });

    const entry = readRecord(
      tree.at(join('project', '.rafa', 'instincts', 'bun-install.md')),
      'project',
      'bun-install',
    );

    expect(entry.issues).toEqual([]);
    expect(entry.instinct?.trigger).toBe('when running tests in a freshly forked worktree');
    expect(entry.instinct?.action).toBe(ACTION);
    expect(entry.instinct?.cause).toBe(CAUSE);
    expect(entry.instinct?.actionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reads a record that broke a rule as its issues, with no record beside them', () => {
    const tree = plant({
      'project/.rafa/instincts/half.md': recordText('half', 'project').replace('confidence: 0.6', 'confidence: 3'),
    });

    const entry = readRecord(tree.at(join('project', '.rafa', 'instincts', 'half.md')), 'project', 'half');

    expect(entry.instinct).toBeNull();
    expect(entry.issues.map((issue) => `${issue.code} ${issue.field}`)).toEqual(['confidence-out-of-range confidence']);
  });

  it('reports a file nothing can open as one issue rather than throwing', () => {
    const tree = plant({ 'project/.rafa/instincts/': '' });

    const entry = readRecord(tree.at(join('project', '.rafa', 'instincts', 'gone.md')), 'user', 'gone');

    expect(entry.instinct).toBeNull();
    expect(entry.issues).toHaveLength(1);
    expect(entry.issues[0]?.message).toContain('the file could not be read');
  });
});

describe('what a scope reads as', () => {
  it('reads every record of a scope that is there, in id order', () => {
    const tree = plant({
      'home/.rafa/instincts/second.md': recordText('second', 'user'),
      'home/.rafa/instincts/first.md': recordText('first', 'user'),
      'home/.rafa/instincts/instincts.ndjson': '{"id":"first"}\n',
    });

    const listing = readScope('user', tree.at(join('home', '.rafa', 'instincts')));

    expect(listing.exists).toBe(true);
    expect(listing.records.map((entry) => entry.id)).toEqual(['first', 'second']);
    expect(listing.records.every((entry) => entry.scope === 'user')).toBe(true);
  });

  it('answers an empty listing for a scope whose directory is not there', () => {
    const tree = plant({ 'home/.rafa/': '' });

    const listing = readScope('user', tree.at(join('home', '.rafa', 'instincts')));

    expect(listing).toEqual({
      scope: 'user',
      dir: tree.at(join('home', '.rafa', 'instincts')),
      exists: false,
      records: [],
    });
  });

  it('reads both scopes nearest the work first', () => {
    const tree = plant({
      'project/.rafa/instincts/project-one.md': recordText('project-one', 'project'),
      'home/.rafa/instincts/user-one.md': recordText('user-one', 'user'),
    });

    const listings = readScopes({ home: tree.home, projectRoot: tree.root });

    expect(listings.map((listing) => listing.scope)).toEqual(['project', 'user']);
    expect(listings.flatMap((listing) => listing.records.map((entry) => entry.id)))
      .toEqual(['project-one', 'user-one']);
  });
});

describe('what an id lookup finds', () => {
  it('finds both files filed under one id, the project one first', () => {
    const tree = plant({
      'project/.rafa/instincts/shared.md': recordText('shared', 'project'),
      'home/.rafa/instincts/shared.md': recordText('shared', 'user'),
    });

    const found = findRecords(readScopes({ home: tree.home, projectRoot: tree.root }), 'shared');

    expect(found.map((entry) => entry.scope)).toEqual(['project', 'user']);
  });

  it('finds a record by its file name even when its frontmatter id disagrees', () => {
    const tree = plant({ 'home/.rafa/instincts/filed-as.md': recordText('declared-as', 'user') });

    const listings = readScopes({ home: tree.home, projectRoot: tree.root });

    expect(findRecords(listings, 'filed-as').map((entry) => entry.instinct?.id)).toEqual(['declared-as']);
    expect(findRecords(listings, 'declared-as')).toEqual([]);
  });
});
