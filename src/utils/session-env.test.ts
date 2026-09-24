/**
 * Tests for {@link sessionSpawnEnv}, read on bases built for each case
 * so nothing of the running process reaches an assertion.
 *
 * That the two spawn doors hand `Bun.spawn` this function's answer is not
 * read here: `claude.test.ts` reads it back from a stand-in `claude` on
 * PATH, one case per door.
 */
import type { SpawnEnv } from './session-env.js';

import { describe, expect, it } from 'bun:test';

import { sessionSpawnEnv } from './session-env.js';

describe('sessionSpawnEnv', () => {
  it('answers the base with the entrypoint set to cli', () => {
    const base: SpawnEnv = { HOME: '/home/someone', PATH: '/usr/bin:/bin' };

    expect(sessionSpawnEnv(base)).toEqual({
      HOME: '/home/someone',
      PATH: '/usr/bin:/bin',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
    });
  });

  it('sets the entrypoint over one the base already carries', () => {
    expect(sessionSpawnEnv({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' })).toEqual({
      CLAUDE_CODE_ENTRYPOINT: 'cli',
    });
  });

  it('answers the entrypoint alone for an empty base, reading nothing of process.env', () => {
    expect(sessionSpawnEnv({})).toEqual({ CLAUDE_CODE_ENTRYPOINT: 'cli' });
  });

  it('hands on an entry holding undefined as it is', () => {
    const answer = sessionSpawnEnv({ UNSET: undefined });

    expect(Object.keys(answer)).toEqual(['UNSET', 'CLAUDE_CODE_ENTRYPOINT']);
    expect(answer['UNSET']).toBeUndefined();
  });

  it('leaves the base unchanged and answers a new object each call', () => {
    const base: SpawnEnv = { CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', TERM: 'xterm' };

    const first = sessionSpawnEnv(base);
    const second = sessionSpawnEnv(base);

    expect(base).toEqual({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', TERM: 'xterm' });
    expect(first).not.toBe(base);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
