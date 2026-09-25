/**
 * Tests for {@link sessionSpawnEnv}, read on bases built for each case
 * so nothing of the running process reaches an assertion. Every case but
 * the default's hands a `bundled/bin` of its own, so none reads
 * `Bun.main` either.
 *
 * That the two spawn doors hand `Bun.spawn` this function's answer is not
 * read here: `claude.test.ts` reads it back from a stand-in `claude` on
 * PATH, one case per door.
 */
import type { SpawnEnv } from './session-env.js';

import { delimiter } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { bundledBinDirectory } from '../schema/tiers.js';

import { sessionPath, sessionSpawnEnv } from './session-env.js';

/** A `bundled/bin` no real entry resolves to. */
const BIN = '/opt/rafa-runtime/bundled/bin';

/** `dirs` joined as a `PATH`. */
function pathOf(...dirs: readonly string[]): string {
  return dirs.join(delimiter);
}

describe('sessionSpawnEnv', () => {
  it('answers the base with bundled/bin in front of PATH and the entrypoint set to cli', () => {
    const base: SpawnEnv = { HOME: '/home/someone', PATH: pathOf('/usr/bin', '/bin') };

    expect(sessionSpawnEnv(base, BIN)).toEqual({
      HOME: '/home/someone',
      PATH: pathOf(BIN, '/usr/bin', '/bin'),
      CLAUDE_CODE_ENTRYPOINT: 'cli',
    });
  });

  it('sets the entrypoint over one the base already carries', () => {
    expect(sessionSpawnEnv({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' }, BIN)).toEqual({
      PATH: BIN,
      CLAUDE_CODE_ENTRYPOINT: 'cli',
    });
  });

  it('answers bundled/bin and the entrypoint alone for an empty base, reading nothing of process.env', () => {
    expect(sessionSpawnEnv({}, BIN)).toEqual({ PATH: BIN, CLAUDE_CODE_ENTRYPOINT: 'cli' });
  });

  it('hands on an entry holding undefined as it is', () => {
    const answer = sessionSpawnEnv({ UNSET: undefined }, BIN);

    expect(Object.keys(answer)).toEqual(['UNSET', 'PATH', 'CLAUDE_CODE_ENTRYPOINT']);
    expect(answer['UNSET']).toBeUndefined();
  });

  it('defaults bundled/bin to the one beside the running entry', () => {
    const base: SpawnEnv = { PATH: '/usr/bin' };

    expect(sessionSpawnEnv(base)).toEqual(sessionSpawnEnv(base, bundledBinDirectory()));
    expect(sessionSpawnEnv(base)['PATH']).toBe(pathOf(bundledBinDirectory(), '/usr/bin'));
  });

  it('leaves the base unchanged and answers a new object each call', () => {
    const base: SpawnEnv = { CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', PATH: '/bin', TERM: 'xterm' };

    const first = sessionSpawnEnv(base, BIN);
    const second = sessionSpawnEnv(base, BIN);

    expect(base).toEqual({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', PATH: '/bin', TERM: 'xterm' });
    expect(first).not.toBe(base);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

describe('sessionPath', () => {
  it('puts the directory in front of every entry, in the order the base holds them', () => {
    expect(sessionPath(pathOf('/b', '/a', '/c'), BIN)).toBe(pathOf(BIN, '/b', '/a', '/c'));
  });

  it('answers the directory alone for an absent PATH', () => {
    expect(sessionPath(undefined, BIN)).toBe(BIN);
  });

  it('answers the directory alone for an empty PATH, adding no empty entry', () => {
    const answer = sessionPath('', BIN);

    expect(answer).toBe(BIN);
    expect(answer.split(delimiter)).not.toContain('');
  });

  it('puts the directory in front again when the base already names it further on', () => {
    expect(sessionPath(pathOf('/usr/bin', BIN), BIN)).toBe(pathOf(BIN, '/usr/bin', BIN));
  });
});
