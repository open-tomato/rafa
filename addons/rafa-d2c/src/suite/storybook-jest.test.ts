import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { TempDirs } from '../testing.js';

import { comparedFiles, orphanFiles, readJestReport, readStoryIndex, runKindOf, runLine, storyIdOfFile } from './storybook-jest.js';

const REPORT = join(import.meta.dir, '..', 'testdata', 'jest-report.json');
const INDEX = join(import.meta.dir, '..', 'testdata', 'index.json');

const temp = new TempDirs();
afterEach(() => temp.clean());

const COUNTS = { matched: 0, added: 0, updated: 0, unmatched: 0, total: 0 };

describe('storyIdOfFile', () => {
  it('keeps a story id that holds --', () => {
    expect(storyIdOfFile('atoms-avatar--away--dark.png')).toBe('atoms-avatar--away');
  });

  it('answers null for a file that is no themed snapshot', () => {
    expect(storyIdOfFile('notes.txt')).toBeNull();
    expect(storyIdOfFile('atoms-avatar--away--sepia.png')).toBeNull();
  });
});

describe('the report and the index', () => {
  it('reads the snapshot counts and each story test', async () => {
    const reading = await readJestReport(REPORT);

    expect(reading.counts).toEqual({ matched: 2, added: 0, updated: 0, unmatched: 1, total: 3 });
    expect(reading.tests[1]).toEqual({ title: 'Atoms/Badge', name: 'Default', status: 'failed' });
  });

  it('refuses a report with no snapshot key, naming the key', async () => {
    const file = join(await temp.make(), 'report.json');
    await writeFile(file, JSON.stringify({ testResults: [] }));

    expect(readJestReport(file)).rejects.toThrow('snapshot');
  });

  it('refuses a missing report, naming its path', async () => {
    const file = join(await temp.make(), 'visual-report.json');

    expect(readJestReport(file)).rejects.toThrow(file);
  });

  it('keeps story entries only', async () => {
    const index = await readStoryIndex(INDEX);

    expect([...index.ids].sort()).toEqual(['atoms-avatar--away', 'atoms-badge--default', 'atoms-badge--draft', 'atoms-badge--small-size']);
    expect(index.idOf('Atoms/Badge', 'Default')).toBe('atoms-badge--default');
  });

  it('maps a test named by its export, as the test runner names it', async () => {
    const index = await readStoryIndex(INDEX);

    expect(index.idOf('Atoms/Badge', 'SmallSize')).toBe('atoms-badge--small-size');
    expect(index.idOf('Atoms/Badge', 'Small Size')).toBe('atoms-badge--small-size');
  });

  it('names the files a run compared: both themes for a pass, the first for a failure', async () => {
    const result = comparedFiles(await readJestReport(REPORT), await readStoryIndex(INDEX));

    expect(result.compared).toEqual(['atoms-avatar--away--light.png', 'atoms-avatar--away--dark.png', 'atoms-badge--default--light.png']);
    expect(result.unmapped).toEqual([{ title: 'Atoms/Gone', name: 'Default', status: 'passed' }]);
  });

  it('lists files whose story the index lacks', async () => {
    const files = ['atoms-gone--default--light.png', 'atoms-badge--default--dark.png', 'notes.txt'];

    expect(orphanFiles(files, await readStoryIndex(INDEX))).toEqual(['atoms-gone--default--light.png']);
  });
});

describe('the run kind', () => {
  it('a run with no seeded set is a seed run', () => {
    expect(runKindOf({ ...COUNTS, added: 4 }, 0)).toBe('seed');
  });

  it('a run that wrote shots against a set is an update', () => {
    expect(runKindOf({ ...COUNTS, updated: 1 }, 10)).toBe('update');
    expect(runKindOf({ ...COUNTS, added: 1 }, 10)).toBe('update');
  });

  it('a run that only compared is an assert', () => {
    expect(runKindOf({ ...COUNTS, matched: 8, unmatched: 2 }, 10)).toBe('assert');
  });

  it('says each kind in its line', () => {
    expect(runLine('seed', { ...COUNTS, added: 732 }, 732)).toBe('seed run: 732 written, 0 compared — not a pass');
    expect(runLine('assert', { ...COUNTS, matched: 660 }, 0)).toBe('assert: 660 compared, all match');
    expect(runLine('assert', { ...COUNTS, matched: 543, unmatched: 117 }, 0))
      .toBe('assert: 117 shots differ, nothing staged; rerun with the update args to accept them');
    expect(runLine('update', { ...COUNTS, added: 2, updated: 3 }, 5)).toBe('update: 2 added, 3 updated, 5 staged');
  });
});
