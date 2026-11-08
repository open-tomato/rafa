import type { SetRecord } from './set-record.js';

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { TempDirs } from '../testing.js';

import { readSetRecord, writeSetRecord } from './set-record.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

/** The spec's `set.json` example. */
const EXAMPLE: SetRecord = {
  set: 'packages-ui',
  playwrightVersion: '1.61.1',
  runner: { kind: 'host', platform: 'darwin-arm64', os: 'macOS 26.6.2' },
  projectCommit: 'd77c39d',
  projectDirty: false,
  promotedAt: '2026-11-08T14:25:00Z',
  files: 768,
  lastRun: { kind: 'assert', compared: 660, added: 0, updated: 0, failed: 117 },
};

describe('the set record', () => {
  it('round-trips the spec example', async () => {
    const file = join(await temp.make(), 'set.json');
    await writeSetRecord(file, EXAMPLE);

    expect(await readSetRecord(file)).toEqual(EXAMPLE);
    expect(await Bun.file(file).text()).toEndWith('}\n');
  });

  it('keeps migratedFrom and a null lastRun', async () => {
    const file = join(await temp.make(), 'set.json');
    const migrated: SetRecord = { ...EXAMPLE, lastRun: null, promotedAt: null, migratedFrom: { state: 'NOT green.' } };
    await writeSetRecord(file, migrated);

    expect(await readSetRecord(file)).toEqual(migrated);
  });

  it('answers null when there is no record', async () => {
    expect(await readSetRecord(join(await temp.make(), 'set.json'))).toBeNull();
  });

  it('refuses an extra key, naming it and the file', async () => {
    const file = join(await temp.make(), 'set.json');
    await writeFile(file, JSON.stringify({ ...EXAMPLE, extra: 1 }));

    expect(readSetRecord(file)).rejects.toThrow(/extra.*set\.json|set\.json.*extra/);
  });

  it('refuses a count that is not a whole number', async () => {
    const file = join(await temp.make(), 'set.json');
    await writeFile(file, JSON.stringify({ ...EXAMPLE, files: -1 }));

    expect(readSetRecord(file)).rejects.toThrow('files');
  });
});
