/**
 * Tests for the stored form of a session log's path and the way back.
 *
 * Every case is pure string work over a Linux home (`/home/u`) and a
 * macOS one (`/Users/u`); no case reads a file. Each refusal has its
 * control beside it, the same shape accepted, so a function that refused
 * everything could not pass: the `..` segment that climbs out sits beside
 * one that stays inside, the Windows separator beside the `/` form, and a
 * path outside the root beside one under it.
 */
import { describe, expect, it } from 'bun:test';

import {
  resolveSessionLogPath,
  storedLogPath,
  storedLogPathOf,
} from './session-log-path.js';

/** A Linux home and the projects root under it. */
const LINUX_HOME = '/home/u';
const LINUX_ROOT = '/home/u/.claude/projects';

/** A macOS home and the projects root under it. */
const MAC_HOME = '/Users/u';
const MAC_ROOT = '/Users/u/.claude/projects';

/** One log's stored form, the folder and the file. */
const STORED = '-home-u-repo/0a1b2c3d.jsonl';

describe('storedLogPath', () => {
  it('answers <folder>/<file> for a log under a Linux home', () => {
    expect(storedLogPath(`${LINUX_ROOT}/${STORED}`, LINUX_HOME)).toBe(STORED);
  });

  it('answers <folder>/<file> for a log under a macOS home', () => {
    expect(storedLogPath(`${MAC_ROOT}/${STORED}`, MAC_HOME)).toBe(STORED);
  });

  it('reads a home with a trailing slash as the same home', () => {
    expect(storedLogPath(`${LINUX_ROOT}/${STORED}`, `${LINUX_HOME}/`)).toBe(STORED);
  });

  it('keeps a path outside the projects root unchanged', () => {
    const override = '/srv/logs/0a1b2c3d.jsonl';
    expect(storedLogPath(override, LINUX_HOME)).toBe(override);
  });

  it('keeps a path under another home unchanged', () => {
    const other = `${MAC_ROOT}/${STORED}`;
    expect(storedLogPath(other, LINUX_HOME)).toBe(other);
  });

  it('keeps a sibling folder that merely extends the root name unchanged', () => {
    const sibling = `${LINUX_HOME}/.claude/projects-old/${STORED}`;
    expect(storedLogPath(sibling, LINUX_HOME)).toBe(sibling);
  });

  it('keeps the root itself, whose rest is empty, unchanged', () => {
    expect(storedLogPath(`${LINUX_ROOT}/`, LINUX_HOME)).toBe(`${LINUX_ROOT}/`);
  });

  it('keeps a path whose .. segment climbs out of the root unchanged', () => {
    const climbing = `${LINUX_ROOT}/../settings.json`;
    expect(storedLogPath(climbing, LINUX_HOME)).toBe(climbing);
  });

  it('keeps an empty string unchanged', () => {
    expect(storedLogPath('', LINUX_HOME)).toBe('');
  });

  it('keeps a relative path unchanged', () => {
    expect(storedLogPath(STORED, LINUX_HOME)).toBe(STORED);
  });
});

describe('storedLogPathOf', () => {
  it('cuts a Linux-home absolute value after the projects root', () => {
    expect(storedLogPathOf(`${LINUX_ROOT}/${STORED}`)).toBe(STORED);
  });

  it('cuts a macOS-home absolute value the same way', () => {
    expect(storedLogPathOf(`${MAC_ROOT}/${STORED}`)).toBe(STORED);
  });

  it('cuts after the last marker when the home itself holds one', () => {
    const nested = `/a/.claude/projects/b/.claude/projects/${STORED}`;
    expect(storedLogPathOf(nested)).toBe(STORED);
  });

  it('answers a relative value unchanged', () => {
    expect(storedLogPathOf(STORED)).toBe(STORED);
  });

  it('answers a value outside the root unchanged', () => {
    const override = '/srv/logs/0a1b2c3d.jsonl';
    expect(storedLogPathOf(override)).toBe(override);
  });

  it('answers a value whose rest climbs out of the root unchanged', () => {
    const climbing = `${LINUX_ROOT}/../../etc/passwd`;
    expect(storedLogPathOf(climbing)).toBe(climbing);
  });

  it('answers a Windows-written value unchanged', () => {
    const windows = 'C:\\Users\\u\\.claude\\projects\\-repo\\0a1b2c3d.jsonl';
    expect(storedLogPathOf(windows)).toBe(windows);
  });

  it('answers an empty string unchanged', () => {
    expect(storedLogPathOf('')).toBe('');
  });

  it('answers a value that is not a string unchanged', () => {
    expect(storedLogPathOf(undefined)).toBeUndefined();
    expect(storedLogPathOf(null)).toBeNull();
    expect(storedLogPathOf(42)).toBe(42);
    const object = { filePath: `${LINUX_ROOT}/${STORED}` };
    expect(storedLogPathOf(object)).toBe(object);
  });
});

describe('resolveSessionLogPath', () => {
  it('joins a relative value under a Linux home', () => {
    expect(resolveSessionLogPath(STORED, LINUX_HOME)).toBe(`${LINUX_ROOT}/${STORED}`);
  });

  it('joins a relative value under a macOS home', () => {
    expect(resolveSessionLogPath(STORED, MAC_HOME)).toBe(`${MAC_ROOT}/${STORED}`);
  });

  it('answers an absolute value itself, outside the root included', () => {
    const override = '/srv/logs/0a1b2c3d.jsonl';
    expect(resolveSessionLogPath(override, LINUX_HOME)).toBe(override);
    const other = `${MAC_ROOT}/${STORED}`;
    expect(resolveSessionLogPath(other, LINUX_HOME)).toBe(other);
  });

  it('refuses a Windows-style separator as a relative value', () => {
    expect(resolveSessionLogPath('-repo\\0a1b2c3d.jsonl', LINUX_HOME)).toBeNull();
    expect(resolveSessionLogPath('C:\\Users\\u\\0a1b2c3d.jsonl', LINUX_HOME)).toBeNull();
  });

  it('answers an empty string unresolved', () => {
    expect(resolveSessionLogPath('', LINUX_HOME)).toBeNull();
  });

  it('answers a .. segment that climbs out of the root unresolved', () => {
    expect(resolveSessionLogPath('../settings.json', LINUX_HOME)).toBeNull();
    expect(resolveSessionLogPath('-repo/../../settings.json', LINUX_HOME)).toBeNull();
    expect(resolveSessionLogPath('..', LINUX_HOME)).toBeNull();
  });

  it('answers the root itself unresolved', () => {
    expect(resolveSessionLogPath('.', LINUX_HOME)).toBeNull();
    expect(resolveSessionLogPath('-repo/..', LINUX_HOME)).toBeNull();
  });

  it('resolves a .. segment that stays inside the root', () => {
    expect(resolveSessionLogPath('-old/../-repo/0a1b2c3d.jsonl', LINUX_HOME))
      .toBe(`${LINUX_ROOT}/-repo/0a1b2c3d.jsonl`);
  });

  it('reads back what storedLogPath stored, on both homes', () => {
    for (const [home, root] of [[LINUX_HOME, LINUX_ROOT], [MAC_HOME, MAC_ROOT]] as const) {
      const absolute = `${root}/${STORED}`;
      expect(resolveSessionLogPath(storedLogPath(absolute, home), home)).toBe(absolute);
    }
  });
});
