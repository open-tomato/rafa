/**
 * Tests for the merge follow-ups (`merge-followups.ts`): which of the
 * two applies for each reading, and what a `package.json` text is read
 * as.
 *
 * Both functions are pure and total, so every case is a literal: no
 * repository is planted, no home is read, and nothing is spawned. The
 * command that gathers the four facts is `merge.ts`, and its own cases
 * measure the gathering.
 */
import type { FollowUpReading } from './merge-followups.js';

import { describe, expect, it } from 'bun:test';

import { readFollowUps, readPackageFacts, versionTag } from './merge-followups.js';

/** A reading of a version nothing has tagged and nothing has installed, filled from `over`. */
function reading(over: Partial<FollowUpReading> = {}): FollowUpReading {
  return {
    version: '0.4.0',
    tagged: false,
    snapshotScript: true,
    runtimeInstalled: false,
    ...over,
  };
}

/** The ids the follow-ups of `given` carry, in order. */
function idsOf(given: FollowUpReading): readonly string[] {
  return readFollowUps(given).map((followUp) => followUp.id);
}

describe('the tag spelling', () => {
  it('is the version with a v in front, which is what this repository tags', () => {
    expect(versionTag('0.4.0')).toBe('v0.4.0');
  });
});

describe('which follow-ups apply', () => {
  it('names both for a version that is neither tagged nor installed, the tag first', () => {
    const followUps = readFollowUps(reading());

    expect(followUps.map((followUp) => followUp.command)).toEqual(['rafa release tag', 'bun run snapshot']);
    expect(followUps[0]?.why).toBe('0.4.0 is on the base branch and no v0.4.0 tag names it');
    expect(followUps[1]?.why).toContain('0.4.0 is not installed');
  });

  it('names neither when the version is tagged and installed, which is the merge that changed no version', () => {
    expect(idsOf(reading({ tagged: true, runtimeInstalled: true }))).toEqual([]);
  });

  it('names the tag alone for a project declaring no snapshot script', () => {
    expect(idsOf(reading({ snapshotScript: false }))).toEqual(['release-tag']);
  });

  it('names the snapshot alone for a tagged version this machine has not installed', () => {
    expect(idsOf(reading({ tagged: true }))).toEqual(['snapshot']);
  });

  it('leaves the snapshot out for a version already installed, which bun run snapshot would refuse', () => {
    expect(idsOf(reading({ runtimeInstalled: true }))).toEqual(['release-tag']);
  });

  it('names nothing at all for a project with no readable version, whatever else is true', () => {
    expect(idsOf(reading({ version: null }))).toEqual([]);
    expect(idsOf(reading({ version: null, tagged: false, snapshotScript: true }))).toEqual([]);
  });

  it('answers a frozen list of frozen follow-ups, so a caller cannot change what a later one says', () => {
    const followUps = readFollowUps(reading());

    expect(Object.isFrozen(followUps)).toBe(true);
    expect(followUps.every((followUp) => Object.isFrozen(followUp))).toBe(true);
  });
});

describe('what a package.json says', () => {
  it('reads the version and the snapshot script a project declaring both carries', () => {
    const facts = readPackageFacts('{"version": "0.3.0", "scripts": {"snapshot": "bun scripts/snapshot-runtime.ts"}}');

    expect(facts).toEqual({ version: '0.3.0', snapshotScript: true });
  });

  it('reads a project with scripts but no snapshot one as declaring none', () => {
    expect(readPackageFacts('{"version": "1.0.0", "scripts": {"build": "tsc"}}'))
      .toEqual({ version: '1.0.0', snapshotScript: false });
  });

  it('reads a blank version, a version that is no string, and a blank script as absent', () => {
    expect(readPackageFacts('{"version": "  "}').version).toBeNull();
    expect(readPackageFacts('{"version": 3}').version).toBeNull();
    expect(readPackageFacts('{"version": "1.0.0", "scripts": {"snapshot": "  "}}').snapshotScript).toBe(false);
  });

  it('reads a text that is no JSON object as neither fact, rather than throwing', () => {
    expect(readPackageFacts('not json at all')).toEqual({ version: null, snapshotScript: false });
    expect(readPackageFacts('[]')).toEqual({ version: null, snapshotScript: false });
    expect(readPackageFacts('null')).toEqual({ version: null, snapshotScript: false });
    expect(readPackageFacts('')).toEqual({ version: null, snapshotScript: false });
  });

  it('trims the version, so a tag is spelled from the version and not from its blanks', () => {
    expect(readPackageFacts('{"version": " 0.4.0\\n"}').version).toBe('0.4.0');
  });
});
