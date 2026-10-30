import { describe, expect, test } from 'bun:test';

import { unresolvedTracker } from './unresolved-tracker.js';

const REASON = 'no tracker resolved';

describe('unresolvedTracker', () => {
  test('its preflight answers the reason', async () => {
    expect(await unresolvedTracker('github', REASON).preflight()).toEqual({ ok: false, reason: REASON });
  });

  test('every other method rejects with the reason', async () => {
    const tracker = unresolvedTracker('github', REASON);
    const calls: ReadonlyArray<() => Promise<unknown>> = [
      () => tracker.find({} as never),
      () => tracker.get({} as never),
      () => tracker.create({} as never),
      () => tracker.comment({} as never, ''),
      () => tracker.transition({} as never, {} as never),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toThrow(REASON);
    }
  });

  test('keeps the kind', () => {
    expect(unresolvedTracker('local', REASON).kind).toBe('local');
  });

  test('declares every capability false', () => {
    expect(unresolvedTracker('github', REASON).capabilities()).toEqual({
      projects: false,
      customFields: false,
      issueTypes: false,
    });
  });

  test('is frozen', () => {
    expect(Object.isFrozen(unresolvedTracker('github', REASON))).toBe(true);
  });
});
