import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { LOCK_FILE, LOCKFILE_VERSION, parseProjectLock, ProjectLockError, projectLockText, readProjectLock, writeProjectLock } from './lock.js';

let root = '';

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-lock-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('readProjectLock', () => {
  it('answers null for a project with no rafa.lock', () => {
    expect(readProjectLock(root)).toBeNull();
  });

  it('reads the version a lock it wrote records', () => {
    writeProjectLock(root, '0.34.0');

    expect(readProjectLock(root)).toEqual({ lockfileVersion: LOCKFILE_VERSION, rafa: '0.34.0' });
  });

  it('refuses a lock that is not JSON, naming the file', () => {
    writeFileSync(join(root, LOCK_FILE), 'rafa: 0.34.0\n', 'utf8');

    expect(() => readProjectLock(root)).toThrow(ProjectLockError);
    expect(() => readProjectLock(root)).toThrow(LOCK_FILE);
  });

  it('refuses a lock written in a format this rafa does not read', () => {
    writeFileSync(join(root, LOCK_FILE), JSON.stringify({ lockfileVersion: 2, rafa: '1.4.0' }), 'utf8');

    expect(() => readProjectLock(root)).toThrow('lockfileVersion 2');
  });

  it('refuses a lock that is a link to nothing, rather than adopting through it', () => {
    symlinkSync(join(root, 'gone.json'), join(root, LOCK_FILE));

    expect(() => readProjectLock(root)).toThrow('a link to nothing');
  });

  it('refuses a lock whose rafa is no version', () => {
    writeFileSync(join(root, LOCK_FILE), JSON.stringify({ lockfileVersion: 1, rafa: 'latest' }), 'utf8');

    expect(() => readProjectLock(root)).toThrow('"latest"');
  });
});

describe('parseProjectLock', () => {
  it('reads back the text a lock is written as', () => {
    expect(parseProjectLock(projectLockText('0.34.0'))).toEqual({ lockfileVersion: LOCKFILE_VERSION, rafa: '0.34.0' });
  });

  it('refuses text that is not JSON, naming the file', () => {
    expect(() => parseProjectLock('rafa: 0.34.0\n')).toThrow(ProjectLockError);
    expect(() => parseProjectLock('rafa: 0.34.0\n')).toThrow(`${LOCK_FILE} is not JSON`);
  });

  it('refuses a format this rafa does not read, naming the file', () => {
    const text = JSON.stringify({ lockfileVersion: 2, rafa: '1.4.0' });

    expect(() => parseProjectLock(text)).toThrow(ProjectLockError);
    expect(() => parseProjectLock(text)).toThrow(`${LOCK_FILE} is in lockfileVersion 2`);
  });

  it('refuses a lock whose rafa is no version, naming the file', () => {
    const text = JSON.stringify({ lockfileVersion: 1, rafa: 'latest' });

    expect(() => parseProjectLock(text)).toThrow(ProjectLockError);
    expect(() => parseProjectLock(text)).toThrow(`${LOCK_FILE} names rafa "latest"`);
  });
});

describe('writeProjectLock', () => {
  it('writes the two keys as JSON, ending in a newline', () => {
    writeProjectLock(root, '0.34.1');

    expect(readFileSync(join(root, LOCK_FILE), 'utf8')).toBe(projectLockText('0.34.1'));
    expect(projectLockText('0.34.1')).toBe('{\n  "lockfileVersion": 1,\n  "rafa": "0.34.1"\n}\n');
  });
});
