import type { StretchItem } from './items.js';

import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { appendItem, itemsPath, lastItemTime, malformedItemLines, parseItems, readItems } from './items.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rafa-stretch-items-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function item(overrides: Partial<StretchItem> = {}): StretchItem {
  return {
    issue: '604',
    plan: 'rafa-604-config-set',
    pullRequest: 901,
    mergeCommit: 'abc1234',
    closes: ['Closes #604'],
    at: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('appendItem', () => {
  test('writes one JSON line per item under the stretch folder', () => {
    appendItem(root, 5, item());
    appendItem(root, 5, item({ issue: '606', pullRequest: 902 }));

    const file = itemsPath(root, 5);
    expect(file).toBe(join(root, '.rafa', 'stretch', '5', 'items.ndjson'));
    const lines = readFileSync(file, 'utf8').split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('');
    expect(JSON.parse(lines[1] ?? '')).toEqual(item({ issue: '606', pullRequest: 902 }));
  });

  test('refuses an item that would read back as malformed', () => {
    expect(() => appendItem(root, 5, item({ pullRequest: 0 }))).toThrow('pullRequest');
    expect(readItems(root, 5).items).toEqual([]);
  });
});

describe('readItems', () => {
  test('a missing ledger reads as empty', () => {
    expect(readItems(root, 2)).toEqual({ items: [], malformed: [] });
  });

  test('reads back what was appended', () => {
    appendItem(root, 1, item());
    expect(readItems(root, 1)).toEqual({ items: [item()], malformed: [] });
  });

  test('skips and names each malformed line, keeping the rest', () => {
    appendItem(root, 3, item());
    const file = itemsPath(root, 3);
    appendFileSync(file, '{not json\n\n[1]\n');
    appendFileSync(file, `${JSON.stringify({ ...item(), closes: 'Closes #1' })}\n`);
    appendItem(root, 3, item({ issue: '608' }));

    const reading = readItems(root, 3);
    expect(reading.items.map((entry) => entry.issue)).toEqual(['604', '608']);
    expect(reading.malformed).toEqual([
      { line: 2, reason: 'not JSON' },
      { line: 4, reason: 'not a JSON object' },
      { line: 5, reason: 'closes is not a list of strings' },
    ]);
    expect(malformedItemLines(root, 3, reading.malformed)[0]).toBe(`skipped ${file}:2: not JSON`);
  });

  test('a well-formed control line passes the same parser', () => {
    expect(parseItems(`${JSON.stringify(item())}\n`).malformed).toEqual([]);
    expect(parseItems(JSON.stringify(item({ at: 'yesterday' }))).malformed).toEqual([{ line: 1, reason: 'at is not a timestamp' }]);
  });

  test('drops fields the ledger does not know', () => {
    const reading = parseItems(JSON.stringify({ ...item(), extra: true }));
    expect(reading.items).toEqual([item()]);
  });
});

describe('lastItemTime', () => {
  test('is null with no items', () => {
    mkdirSync(join(root, '.rafa', 'stretch', '4'), { recursive: true });
    expect(lastItemTime(root, 4)).toBeNull();
  });

  test('is the newest timestamp, not the last line', () => {
    appendItem(root, 4, item({ at: '2026-10-02T09:00:00.000Z' }));
    appendItem(root, 4, item({ at: '2026-10-01T09:00:00.000Z' }));
    expect(lastItemTime(root, 4)?.toISOString()).toBe('2026-10-02T09:00:00.000Z');
  });
});
