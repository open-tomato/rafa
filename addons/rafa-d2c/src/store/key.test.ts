import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { TempDirs } from '../testing.js';

import { existingKeys, hostRunnerKey, newRunId, readPlaywrightVersion, setPaths, stagingDir } from './key.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

describe('the storage key', () => {
  it('lays a set out by playwright version and runner key', () => {
    expect(setPaths('/s', 'packages-ui', '1.61.1', 'host-darwin-arm64')).toEqual({
      keyDir: '/s/packages-ui/1.61.1/host-darwin-arm64',
      snapshotsDir: '/s/packages-ui/1.61.1/host-darwin-arm64/__image_snapshots__',
      recordFile: '/s/packages-ui/1.61.1/host-darwin-arm64/set.json',
    });
  });

  it('stages a run under .staging by set, key and run id', () => {
    expect(stagingDir('/s', 'packages-ui', 'host-darwin-arm64', '20261108T142500Z-a3f9'))
      .toBe('/s/.staging/packages-ui/host-darwin-arm64/20261108T142500Z-a3f9');
  });

  it('names the host runner by platform and arch', () => {
    expect(hostRunnerKey('darwin', 'arm64')).toBe('host-darwin-arm64');
    expect(hostRunnerKey('linux', 'x64')).toBe('host-linux-amd64');
  });

  it('refuses a platform or arch it has no key for, naming both', () => {
    expect(() => hostRunnerKey('win32', 'x64')).toThrow('win32');
    expect(() => hostRunnerKey('linux', 'ia32')).toThrow('ia32');
  });

  it('lists the keys a set holds', async () => {
    const dir = await temp.make();
    await mkdir(join(dir, 'packages-ui', '1.61.1', 'host-darwin-arm64'), { recursive: true });
    await mkdir(join(dir, 'packages-ui', '1.60.0', 'host-linux-amd64'), { recursive: true });

    expect(await existingKeys(dir, 'packages-ui')).toEqual([
      { playwrightVersion: '1.60.0', runnerKey: 'host-linux-amd64' },
      { playwrightVersion: '1.61.1', runnerKey: 'host-darwin-arm64' },
    ]);
    expect(await existingKeys(dir, 'no-such-set')).toEqual([]);
  });

  it('makes a run id from the time and four hex digits', () => {
    expect(newRunId(new Date('2026-11-08T14:25:00Z'), () => 0.64)).toMatch(/^20261108T142500Z-[0-9a-f]{4}$/);
  });
});

describe('readPlaywrightVersion', () => {
  it('finds a version hoisted to a parent node_modules', async () => {
    const root = await temp.make();
    const pkg = join(root, 'packages', 'ui');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), '{"name":"ui"}');
    await mkdir(join(root, 'node_modules', 'playwright-core'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'playwright-core', 'package.json'), '{"name":"playwright-core","version":"1.61.1"}');

    expect(readPlaywrightVersion(pkg)).toBe('1.61.1');
  });

  it('refuses when playwright-core is not installed, naming the package folder', async () => {
    const pkg = await temp.make();

    expect(() => readPlaywrightVersion(pkg)).toThrow(pkg);
  });
});
