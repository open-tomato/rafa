/**
 * The stage test for "The mode and the listing": a full native read, a
 * native incremental read, and a mode switch between them, all driven
 * over a real, spawned stand-in `gh` (`createGhRunner`,
 * `src/adapters/tracker/github.ts`) rather than an in-process fake.
 *
 * `board-cache.test.ts` and `board-cache-native.test.ts` drive every
 * argv and every fallback over a planted `GhRunner` function, which
 * proves the module's OWN logic; neither spawns a process, so neither
 * proves that a real `gh` on the `PATH`, given the exact argv this stage
 * built, is read back into the exact shape the rest of the stage
 * expects. This file is that seam, once, for the stage's own claims: one
 * `gh` call answers the native incremental read (the point of the
 * `native` mode's own query over the REST read's per-issue cost), and a
 * row read in the `labels` mode carries none of the five relationship
 * keys — checked with `Object.keys`, since `toEqual` would pass a row
 * that carried them as `undefined`.
 *
 * The stand-in `gh` tells the four calls the stage sends apart by their
 * own shape rather than a full-string match: `issue list` is the full
 * read, `api --paginate` with `graphql` next is the native incremental,
 * `api --paginate` without it is the labels incremental, and `api`
 * followed by `--jq` as its third word is the watermark. Anything else
 * fails loudly, so a call this file did not plant for fails the run
 * rather than passing quietly.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createGhRunner } from '../adapters/tracker/github.js';

import { BOARD_CACHE_FILE, createCachedBoardListing } from './board-cache.js';

/** The keys a labels-mode row and issue carry. */
const LABELS_ROW_KEYS = ['number', 'title', 'body', 'state', 'stateReason', 'labels'];

/** The five relationship keys a native-mode row and issue carry. */
const NATIVE_KEYS = ['parent', 'blockedBy', 'blocking', 'subIssuesSummary', 'subIssues'];

/** One issue with no links, as the full native read answers it. */
const NATIVE_ISSUE = {
  number: 1,
  title: 'Issue 1',
  body: 'body',
  state: 'OPEN',
  stateReason: null,
  labels: [{ name: 'type:spec' }],
  parent: null,
  blockedBy: { nodes: [], totalCount: 0 },
  blocking: { nodes: [], totalCount: 0 },
  subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
  subIssues: { nodes: [], totalCount: 0 },
};

/** {@link NATIVE_ISSUE} with the five relationship keys left off, the labels-mode row. */
const LABELS_ISSUE = {
  number: NATIVE_ISSUE.number,
  title: NATIVE_ISSUE.title,
  body: NATIVE_ISSUE.body,
  state: NATIVE_ISSUE.state,
  stateReason: NATIVE_ISSUE.stateReason,
  labels: NATIVE_ISSUE.labels,
};

/**
 * Writes a stand-in `gh` at `bin/gh` that logs every call it is asked,
 * one line per call, to `log`, and answers the full and incremental
 * reads of both modes; see the module note for how it tells them apart.
 */
function writeGhStub(bin: string, log: string): void {
  const lines = [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
    'if [ "$1" = "api" ] && [ "$2" = "graphql" ] && [ "$3" = "--paginate" ]; then',
    '  printf \'\'',
    '  exit 0',
    'fi',
    'if [ "$1" = "api" ] && [ "$2" = "--paginate" ]; then',
    '  printf \'\'',
    '  exit 0',
    'fi',
    'if [ "$1" = "api" ] && [ "$3" = "--jq" ]; then',
    '  printf \'%s\' \'2026-09-30T10:00:00Z\'',
    '  exit 0',
    'fi',
    'if [ "$1" = "issue" ] && [ "$2" = "list" ]; then',
    '  case "$8" in',
    '    *parent*)',
    `      printf '%s' ${shellSingleQuoted(JSON.stringify([NATIVE_ISSUE]))}`,
    '      ;;',
    '    *)',
    `      printf '%s' ${shellSingleQuoted(JSON.stringify([LABELS_ISSUE]))}`,
    '      ;;',
    '  esac',
    '  exit 0',
    'fi',
    'echo "the stand-in gh was asked $*" >&2',
    'exit 1',
    '',
  ];
  mkdirSync(bin, { recursive: true });
  const gh = join(bin, 'gh');
  writeFileSync(gh, lines.join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

/** `text` wrapped for a single-quoted shell literal; none of the JSON here carries a single quote. */
function shellSingleQuoted(text: string): string {
  if (text.includes('\'')) throw new Error('shellSingleQuoted: text carries a single quote');
  return `'${text}'`;
}

/** The lines `log` holds, none of them empty. */
function callsOf(log: string): readonly string[] {
  return readFileSync(log, 'utf8').split('\n')
    .filter((line) => line !== '');
}

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rafa-relations-mode-stage-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the mode and the listing, over a spawned stand-in gh', () => {
  it('reads a full native listing, then one gh call for the native incremental read, then a mode switch with no native keys', async () => {
    const bin = join(root, 'bin');
    const log = join(root, 'gh-calls.log');
    writeGhStub(bin, log);
    const gh = createGhRunner({ cwd: root, env: { PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}` } });

    // A full native read: no cache yet, so the watermark and the native
    // listing are both sent.
    const first = await createCachedBoardListing({ gh, root, mode: 'native' })();

    expect(callsOf(log)).toHaveLength(2);
    expect(Object.keys(first[0] ?? {})).toEqual(expect.arrayContaining([...LABELS_ROW_KEYS, ...NATIVE_KEYS]));
    expect(Object.keys(JSON.parse(readFileSync(join(root, BOARD_CACHE_FILE), 'utf8')).rows[0])).toEqual([
      ...LABELS_ROW_KEYS,
      ...NATIVE_KEYS,
    ]);

    // A native incremental read: the file is now kept in the native
    // mode, so bringing it up to date is ONE gh call, the paginated
    // graphql query, and nothing changed.
    writeFileSync(log, '');
    const second = await createCachedBoardListing({ gh, root, mode: 'native' })();

    expect(callsOf(log)).toHaveLength(1);
    expect(callsOf(log)[0]).toContain('graphql');
    expect(second).toEqual(first);

    // A mode switch: asking for the labels mode over a file kept in the
    // native mode is read as no cache, so it is a full read again, and
    // the row it reads back carries none of the five native keys.
    writeFileSync(log, '');
    const third = await createCachedBoardListing({ gh, root })();

    expect(callsOf(log)).toHaveLength(2);
    expect(Object.keys(third[0] ?? {})).toEqual(expect.arrayContaining(LABELS_ROW_KEYS));
    for (const key of NATIVE_KEYS) expect(Object.keys(third[0] ?? {})).not.toContain(key);
    const kept = JSON.parse(readFileSync(join(root, BOARD_CACHE_FILE), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(kept)).toEqual(['version', 'watermark', 'rows']);
    expect(Object.keys((kept['rows'] as readonly Record<string, unknown>[])[0] ?? {})).toEqual(LABELS_ROW_KEYS);
  });
});
