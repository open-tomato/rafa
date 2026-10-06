/**
 * `store-identity.ts`: the three facts a writing open compares (host id,
 * the store file's absolute path, its device and inode), the side
 * record's generation, the project identity, and the decision. Every
 * file is a real one under `tmpdir()`, so a copy, a restore and a
 * rename are the filesystem's own; every host id is injected, and no
 * case reads this machine's.
 *
 * Whether a freed inode number goes to the next file is the
 * filesystem's choice, so the inode-reuse case takes the answer of its
 * own `replaceWithCopy` to compute the `reasons` it expects, and asserts
 * the mint either way.
 */
import type { RecordedIdentity, StoreIdentityFacts } from './store-identity.js';
import type { StoreIdentitySeams } from './store-meta.js';
import type { GitResult, GitRunner } from '../../pr/git.js';

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { withSqliteStore } from './sqlite.js';
import { writeStoreGeneration } from './store-generation.js';
import {
  decideStoreIdentity,
  hostIdFrom,
  observeStore,
  parseIoregPlatformUuid,
  readHostId,
  readProjectIdentity,
  readStoreFileFacts,
} from './store-identity.js';
import { readStoreMeta } from './store-meta.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-store-identity-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** A fresh directory of its own under the suite's scope. */
function fresh(name: string): string {
  return realpathSync(mkdtempSync(join(scope, `${name}-`)));
}

/** The file at `path`'s inode number. */
function inodeOf(path: string): bigint {
  return statSync(path, { bigint: true }).ino;
}

/**
 * Deletes the file at `path` and copies `source` to it, as a store
 * deleted and replaced by a copy is, answering whether the new file got
 * the deleted one's inode number.
 */
function replaceWithCopy(path: string, source: string): boolean {
  const before = inodeOf(path);
  rmSync(path);
  copyFileSync(source, path);
  return inodeOf(path) === before;
}

/** The `store_meta` row of the store at `path`, read on a connection of its own. */
function recordedRowOf(path: string): RecordedIdentity | null {
  const db = new Database(path, { readonly: true });
  try {
    return readStoreMeta(db);
  } finally {
    db.close();
  }
}

/** A store file with some bytes in it, in a fresh directory. */
function plantStore(name: string): string {
  const path = join(fresh(name), 'effort.sqlite');
  writeFileSync(path, 'store bytes', 'utf8');
  return path;
}

/** What a mint of `facts` would have recorded, under `storeId`. */
function recorded(facts: StoreIdentityFacts, storeId = 'store-a'): RecordedIdentity {
  return { storeId, ...facts };
}

/** An observation of `path` that counts how often it was asked for. */
function counted(path: string, hostId: string): { observe: () => StoreIdentityFacts; calls: () => number } {
  let calls = 0;
  return {
    observe: () => {
      calls += 1;
      return observeStore(path, () => hostId);
    },
    calls: () => calls,
  };
}

describe('decideStoreIdentity', () => {
  it('mints on the first write to a store that holds no identity', () => {
    const path = plantStore('first-write');
    const facts = observeStore(path, () => 'host-a');

    const decision = decideStoreIdentity('write', null, () => facts);

    expect(decision).toEqual({ action: 'mint', reasons: ['unminted'], facts });
  });

  it('keeps the origin on a write that finds all three facts unchanged, the control for every mint below', () => {
    const path = plantStore('unchanged');
    const minted = recorded(observeStore(path, () => 'host-a'));

    const decision = decideStoreIdentity('write', minted, () => observeStore(path, () => 'host-a'));

    expect(decision).toEqual({ action: 'keep', storeId: 'store-a' });
  });

  it('mints on a write to a copy at another path, which is also another file', () => {
    const source = plantStore('copy-source');
    const minted = recorded(observeStore(source, () => 'host-a'));
    const target = join(fresh('copy-target'), 'effort.sqlite');
    copyFileSync(source, target);

    const facts = observeStore(target, () => 'host-a');
    const decision = decideStoreIdentity('write', minted, () => facts);

    expect(facts.storePath).not.toBe(minted.storePath);
    expect(decision).toEqual({ action: 'mint', reasons: ['path', 'file'], facts });
    expect(decideStoreIdentity('write', minted, () => observeStore(source, () => 'host-a')))
      .toEqual({ action: 'keep', storeId: 'store-a' });
  });

  it('mints on a write to a .bak restored in place, whose path is the same and whose inode is new', () => {
    const path = plantStore('bak-restore');
    const backup = `${path}.v15-20260929.bak`;
    copyFileSync(path, backup);
    const minted = recorded(observeStore(path, () => 'host-a'));
    writeFileSync(path, 'store bytes and a row written after the backup', 'utf8');
    renameSync(backup, path);

    const facts = observeStore(path, () => 'host-a');
    const decision = decideStoreIdentity('write', minted, () => facts);

    expect(facts.storePath).toBe(minted.storePath);
    expect(facts.fileDev).toBe(BigInt(minted.fileDev));
    expect(facts.fileIno).not.toBe(BigInt(minted.fileIno));
    expect(decision).toEqual({ action: 'mint', reasons: ['file'], facts });
  });

  it('mints on a write from another host, with the path and the file unchanged', () => {
    const path = plantStore('other-host');
    const minted = recorded(observeStore(path, () => 'host-a'));

    const facts = observeStore(path, () => 'host-b');
    const decision = decideStoreIdentity('write', minted, () => facts);

    expect(decision).toEqual({ action: 'mint', reasons: ['host'], facts });
  });

  it('names every fact that moved, in host, path, file order', () => {
    const source = plantStore('all-moved');
    const minted = recorded(observeStore(source, () => 'host-a'));
    const target = join(fresh('all-moved-target'), 'effort.sqlite');
    copyFileSync(source, target);

    const decision = decideStoreIdentity('write', minted, () => observeStore(target, () => 'host-b'));

    expect(decision.action === 'mint' && decision.reasons).toEqual(['host', 'path', 'file']);
  });

  it('keeps the origin of a store renamed away and back in place, which keeps its inode', () => {
    const path = plantStore('rename');
    const minted = recorded(observeStore(path, () => 'host-a'));
    const aside = `${path}.aside`;
    renameSync(path, aside);
    expect(existsSync(path)).toBe(false);
    renameSync(aside, path);

    const facts = observeStore(path, () => 'host-a');
    const decision = decideStoreIdentity('write', minted, () => facts);

    expect(facts.fileIno).toBe(BigInt(minted.fileIno));
    expect(decision).toEqual({ action: 'keep', storeId: 'store-a' });
  });

  it('compares a device and inode read back from SQLite as numbers with the bigints a stat reads', () => {
    const path = plantStore('numbers');
    const facts = observeStore(path, () => 'host-a');
    const minted: RecordedIdentity = {
      ...recorded(facts),
      fileDev: Number(facts.fileDev),
      fileIno: Number(facts.fileIno),
    };

    expect(decideStoreIdentity('write', minted, () => facts)).toEqual({ action: 'keep', storeId: 'store-a' });
  });

  it('keeps the origin on a write to the same file whose row and side record hold one generation', () => {
    const path = plantStore('generation-match');
    writeStoreGeneration(path, 'gen-1');
    const minted = recorded(observeStore(path, () => 'host-a'));

    const facts = observeStore(path, () => 'host-a');
    const decision = decideStoreIdentity('write', minted, () => facts);

    expect(minted.generation).toBe('gen-1');
    expect(decision).toEqual({ action: 'keep', storeId: 'store-a' });
  });

  it.each([
    ['the same inode', false, ['generation']],
    ['a new inode', true, ['file', 'generation']],
  ] as const)('mints on a write whose side record holds another generation than the row, with %s', (_title, restored, reasons) => {
    const path = plantStore('generation-stale');
    writeStoreGeneration(path, 'gen-1');
    const minted = recorded(observeStore(path, () => 'host-a'));
    if (restored) {
      const backup = `${path}.bak`;
      copyFileSync(path, backup);
      renameSync(backup, path);
    }
    writeStoreGeneration(path, 'gen-2');

    const facts = observeStore(path, () => 'host-a');
    const decision = decideStoreIdentity('write', minted, () => facts);

    expect(facts.fileIno === BigInt(minted.fileIno)).toBe(!restored);
    expect(decision).toEqual({ action: 'mint', reasons: [...reasons], facts });
  });

  it('mints on a write whose row holds a generation and whose side record is absent, as a copy carries the row alone', () => {
    const path = plantStore('generation-absent');
    const minted: RecordedIdentity = { ...recorded(observeStore(path, () => 'host-a')), generation: 'gen-1' };

    const facts = observeStore(path, () => 'host-a');
    const decision = decideStoreIdentity('write', minted, () => facts);

    expect(facts.generation).toBeNull();
    expect(decision).toEqual({ action: 'mint', reasons: ['generation'], facts });
  });

  it.each([
    ['a side record', 'gen-1'],
    ['no side record', null],
  ] as const)('keeps the origin of a row written before the generation column, its three facts matching, with %s', (_title, side) => {
    const path = plantStore('generation-null');
    if (side !== null) writeStoreGeneration(path, side);
    const minted: RecordedIdentity = { ...recorded(observeStore(path, () => 'host-a')), generation: null };

    const facts = observeStore(path, () => 'host-a');

    expect(facts.generation).toBe(side);
    expect(decideStoreIdentity('write', minted, () => facts)).toEqual({ action: 'keep', storeId: 'store-a' });
  });

  it('judges a row written before the generation column by the three facts alone, so a moved file still mints', () => {
    const path = plantStore('generation-null-moved');
    writeStoreGeneration(path, 'gen-1');
    const minted: RecordedIdentity = { ...recorded(observeStore(path, () => 'host-a')), generation: null };

    const facts = observeStore(path, () => 'host-b');

    expect(decideStoreIdentity('write', minted, () => facts)).toEqual({ action: 'mint', reasons: ['host'], facts });
  });

  it('mints on a write to a store deleted and replaced by a copy of its state before the last write, whether or not the inode number repeated', () => {
    const path = join(fresh('inode-reuse'), 'effort.sqlite');
    const seams: StoreIdentitySeams = {
      readHostId: () => 'host-a',
      readProject: () => ({ rootCommit: 'a1b2c3d4', remote: null }),
    };
    withSqliteStore(path, 'write', true, () => undefined, seams);
    const older = `${path}.copy`;
    copyFileSync(path, older);
    withSqliteStore(path, 'write', false, () => undefined, seams);

    const repeated = replaceWithCopy(path, older);
    const row = recordedRowOf(path);
    const facts = observeStore(path, () => 'host-a');

    expect(row?.generation).not.toBeNull();
    expect(facts.generation).not.toBe(row?.generation);
    expect(decideStoreIdentity('write', row, () => facts)).toEqual({
      action: 'mint',
      reasons: repeated
        ? ['generation']
        : ['file', 'generation'],
      facts,
    });
  });

  it('decides nothing on a read, unminted or copied, and never observes the store', () => {
    const source = plantStore('read-source');
    const minted = recorded(observeStore(source, () => 'host-a'));
    const target = join(fresh('read-target'), 'effort.sqlite');
    copyFileSync(source, target);
    const unminted = counted(source, 'host-a');
    const copied = counted(target, 'host-b');

    expect(decideStoreIdentity('read', null, unminted.observe)).toEqual({ action: 'none' });
    expect(decideStoreIdentity('read', minted, copied.observe)).toEqual({ action: 'none' });
    expect(unminted.calls()).toBe(0);
    expect(copied.calls()).toBe(0);

    expect(decideStoreIdentity('write', minted, copied.observe).action).toBe('mint');
    expect(copied.calls()).toBe(1);
  });
});

describe('observeStore', () => {
  it('reads the side record beside the real path, so a symlinked spelling reads the store\'s own generation', () => {
    const path = plantStore('observe-symlink');
    writeStoreGeneration(path, 'gen-1');
    const link = join(fresh('observe-symlink-dir'), 'linked.sqlite');
    symlinkSync(path, link);

    expect(observeStore(link, () => 'host-a')).toEqual(observeStore(path, () => 'host-a'));
    expect(observeStore(link, () => 'host-a').generation).toBe('gen-1');
  });

  it('answers a null generation for a store with no side record', () => {
    expect(observeStore(plantStore('observe-absent'), () => 'host-a').generation).toBeNull();
  });
});

describe('readStoreFileFacts', () => {
  it('reads the real path, so a symlinked spelling of one file is one path and does not mint', () => {
    const path = plantStore('symlink');
    const link = join(fresh('symlink-dir'), 'linked.sqlite');
    symlinkSync(path, link);

    expect(readStoreFileFacts(link)).toEqual(readStoreFileFacts(path));
    expect(readStoreFileFacts(path).storePath).toBe(path);
  });

  it('reads the device and inode as bigints, which no float rounds', () => {
    const facts = readStoreFileFacts(plantStore('bigint'));

    expect(typeof facts.fileDev).toBe('bigint');
    expect(typeof facts.fileIno).toBe('bigint');
  });

  it('throws on a store file that does not exist, naming the path', () => {
    const missing = join(fresh('missing'), 'effort.sqlite');

    expect(() => readStoreFileFacts(missing)).toThrow(missing);
  });
});

describe('readHostId', () => {
  const machineId = '0123456789abcdef0123456789abcdef';
  const platformUuid = 'A1B2C3D4-0000-1111-2222-333344445555';

  it('derives the Linux id from /etc/machine-id through the keyed hash, never the raw id', () => {
    const hostId = readHostId({ platform: 'linux', readMachineId: () => machineId, readHostname: () => 'box' });

    expect(hostId).toBe(hostIdFrom('machine-id', machineId));
    expect(hostId).toMatch(/^[0-9a-f]{64}$/);
    expect(hostId).not.toContain(machineId);
  });

  it('derives the macOS id from the platform UUID', () => {
    const hostId = readHostId({ platform: 'darwin', readPlatformUuid: () => platformUuid, readHostname: () => 'box' });

    expect(hostId).toBe(hostIdFrom('platform-uuid', platformUuid));
  });

  it('falls back to the hostname when the platform source answers nothing, and on any other platform', () => {
    const linux = readHostId({ platform: 'linux', readMachineId: () => null, readHostname: () => 'box' });
    const darwin = readHostId({ platform: 'darwin', readPlatformUuid: () => null, readHostname: () => 'box' });
    const windows = readHostId({ platform: 'win32', readHostname: () => 'box' });

    expect([linux, darwin, windows]).toEqual(Array(3).fill(hostIdFrom('hostname', 'box')));
  });

  it('never reads the Linux source on macOS or the macOS source on Linux', () => {
    const refuse = (): never => {
      throw new Error('read the other platform\'s source');
    };

    expect(readHostId({ platform: 'linux', readMachineId: () => machineId, readPlatformUuid: refuse, readHostname: refuse }))
      .toBe(hostIdFrom('machine-id', machineId));
    expect(readHostId({ platform: 'darwin', readMachineId: refuse, readPlatformUuid: () => platformUuid, readHostname: refuse }))
      .toBe(hostIdFrom('platform-uuid', platformUuid));
  });

  // A spawned run's PATH may lack /usr/sbin, where ioreg lives; a hostname
  // id there would read the store as a copy and mint it a new id.
  it.skipIf(process.platform !== 'darwin')('reads the macOS platform UUID in a child whose PATH holds no /usr/sbin', () => {
    const script = `import { readHostId } from '${join(import.meta.dir, 'store-identity.ts')}'; console.log(readHostId());`;
    const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });

    expect(child.stderr).toBe('');
    expect(child.stdout.trim()).toBe(readHostId());
    expect(child.stdout.trim()).not.toBe(hostIdFrom('hostname', hostname()));
  });

  it('keeps sources apart, so a hostname spelled like a machine id is another host', () => {
    expect(hostIdFrom('hostname', machineId)).not.toBe(hostIdFrom('machine-id', machineId));
    expect(hostIdFrom('machine-id', machineId)).toBe(hostIdFrom('machine-id', machineId));
  });
});

describe('parseIoregPlatformUuid', () => {
  it('reads the IOPlatformUUID line of ioreg -rd1 -c IOPlatformExpertDevice', () => {
    const output = [
      '+-o J316sAP  <class IOPlatformExpertDevice, id 0x100000217, registered, matched, active, busy 0 (1 ms), retain 39>',
      '  {',
      '    "IOPlatformSerialNumber" = "XYZ123"',
      '    "IOPlatformUUID" = "A1B2C3D4-0000-1111-2222-333344445555"',
      '  }',
    ].join('\n');

    expect(parseIoregPlatformUuid(output)).toBe('A1B2C3D4-0000-1111-2222-333344445555');
  });

  it('answers null for output without the line', () => {
    expect(parseIoregPlatformUuid('')).toBeNull();
    expect(parseIoregPlatformUuid('"IOPlatformSerialNumber" = "XYZ123"')).toBeNull();
  });
});

describe('readProjectIdentity', () => {
  /** A runner answering from a table keyed by the joined arguments. */
  function fakeGit(answers: Record<string, GitResult>): { git: GitRunner; asked: string[] } {
    const asked: string[] = [];
    const git: GitRunner = (args) => {
      const key = args.join(' ');
      asked.push(key);
      return answers[key] ?? { ok: false, stdout: '', stderr: `unexpected git ${key}` };
    };
    return { git, asked };
  }

  it('takes the smallest root commit, so every clone of a history with several roots names the same one', () => {
    const { git, asked } = fakeGit({
      'rev-list --max-parents=0 HEAD': { ok: true, stdout: 'ffff000\n1111aaa\n', stderr: '' },
      'remote get-url origin': { ok: true, stdout: 'git@github.com:Open-Tomato/Rafa.git\n', stderr: '' },
    });

    expect(readProjectIdentity(scope, git)).toEqual({ rootCommit: '1111aaa', remote: 'github.com/open-tomato/rafa' });
    expect(asked).toEqual(['rev-list --max-parents=0 HEAD', 'remote get-url origin']);
  });

  it('strips credentials from the remote, since the store travels to other devices', () => {
    const { git } = fakeGit({
      'rev-list --max-parents=0 HEAD': { ok: true, stdout: 'abc\n', stderr: '' },
      'remote get-url origin': { ok: true, stdout: 'https://token@github.com/o/r.git\n', stderr: '' },
    });

    expect(readProjectIdentity(scope, git).remote).toBe('github.com/o/r');
  });

  it('answers null for each part git cannot read', () => {
    const { git } = fakeGit({});

    expect(readProjectIdentity(scope, git)).toEqual({ rootCommit: null, remote: null });
  });

  it('reads a real repository through the default runner', () => {
    const repo = fresh('repo');
    const run = (args: string[]): void => {
      const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
        cwd: repo,
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
    };
    run(['init', '--quiet']);
    run(['commit', '--quiet', '--allow-empty', '-m', 'root']);
    run(['remote', 'add', 'origin', 'https://github.com/o/r.git']);
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();

    expect(readProjectIdentity(repo)).toEqual({ rootCommit: head, remote: 'github.com/o/r' });
  });

  it('answers null for both parts outside any repository', () => {
    const outside = fresh('no-repo');
    mkdirSync(join(outside, 'sub'));

    expect(readProjectIdentity(join(outside, 'sub'))).toEqual({ rootCommit: null, remote: null });
  });
});
