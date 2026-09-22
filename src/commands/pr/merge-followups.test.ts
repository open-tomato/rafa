/**
 * Tests for the merge follow-ups (`merge-followups.ts`): which of the
 * two applies for each reading, and what a `package.json` text is read
 * as.
 *
 * Both functions are pure and total, so every case is a literal: no
 * repository is planted, no home is read, and nothing is spawned. The
 * command that gathers the four facts is `merge.ts`, and its own cases
 * measure the gathering.
 *
 * The rafa-checkout cases read the package name from
 * {@link RAFA_PACKAGE_NAME} rather than spelling `@open-tomato/rafa`
 * again, since that constant is what `self-update`'s own install
 * refuses over; the control beside them is a literal foreign name,
 * which holds the check to something it could fail.
 */
import type { FollowUpReading } from './merge-followups.js';

import { describe, expect, it } from 'bun:test';

import { RAFA_PACKAGE_NAME } from '../../runtime/install.js';

import { readFollowUps, readPackageFacts, versionTag } from './merge-followups.js';

/** A reading of a rafa checkout on a version nothing has tagged and nothing has installed, filled from `over`. */
function reading(over: Partial<FollowUpReading> = {}): FollowUpReading {
  return {
    version: '0.4.0',
    tagged: false,
    rafaCheckout: true,
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

    expect(followUps.map((followUp) => followUp.command)).toEqual(['rafa release tag', 'rafa self-update']);
    expect(followUps[0]?.why).toBe('0.4.0 is on the base branch and no v0.4.0 tag names it');
    expect(followUps[1]?.why).toContain('0.4.0 is not installed');
  });

  it('names neither when the version is tagged and installed, which is the merge that changed no version', () => {
    expect(idsOf(reading({ tagged: true, runtimeInstalled: true }))).toEqual([]);
  });

  it('names the tag alone in a project that is no rafa checkout, where self-update would refuse', () => {
    expect(idsOf(reading({ rafaCheckout: false }))).toEqual(['release-tag']);
  });

  it('names the update alone for a tagged version this machine has not installed', () => {
    expect(idsOf(reading({ tagged: true }))).toEqual(['self-update']);
  });

  it('leaves the update out for a version already installed, which rafa self-update would refuse', () => {
    expect(idsOf(reading({ runtimeInstalled: true }))).toEqual(['release-tag']);
  });

  it('names nothing at all for a project with no readable version, whatever else is true', () => {
    expect(idsOf(reading({ version: null }))).toEqual([]);
    expect(idsOf(reading({ version: null, tagged: false, rafaCheckout: true }))).toEqual([]);
  });

  it('answers a frozen list of frozen follow-ups, so a caller cannot change what a later one says', () => {
    const followUps = readFollowUps(reading());

    expect(Object.isFrozen(followUps)).toBe(true);
    expect(followUps.every((followUp) => Object.isFrozen(followUp))).toBe(true);
  });

  it('names no command an operator would have to reach past rafa for', () => {
    const commands = readFollowUps(reading()).map((followUp) => followUp.command);

    expect(commands.every((command) => command.startsWith('rafa '))).toBe(true);
  });
});

describe('what a package.json says', () => {
  it('reads the version and the checkout a package.json naming rafa itself carries', () => {
    const facts = readPackageFacts(`{"name": "${RAFA_PACKAGE_NAME}", "version": "0.3.0"}`);

    expect(facts).toEqual({ version: '0.3.0', rafaCheckout: true });
  });

  it('reads a project naming another package as no rafa checkout', () => {
    expect(readPackageFacts('{"name": "@someone/else", "version": "1.0.0"}'))
      .toEqual({ version: '1.0.0', rafaCheckout: false });
  });

  it('reads a package.json with no name at all as no rafa checkout', () => {
    expect(readPackageFacts('{"version": "1.0.0"}')).toEqual({ version: '1.0.0', rafaCheckout: false });
  });

  it('reads a blank version, a version that is no string, and a name that is no string as absent', () => {
    expect(readPackageFacts('{"version": "  "}').version).toBeNull();
    expect(readPackageFacts('{"version": 3}').version).toBeNull();
    expect(readPackageFacts('{"name": 3, "version": "1.0.0"}').rafaCheckout).toBe(false);
  });

  it('reads a text that is no JSON object as neither fact, rather than throwing', () => {
    expect(readPackageFacts('not json at all')).toEqual({ version: null, rafaCheckout: false });
    expect(readPackageFacts('[]')).toEqual({ version: null, rafaCheckout: false });
    expect(readPackageFacts('null')).toEqual({ version: null, rafaCheckout: false });
    expect(readPackageFacts('')).toEqual({ version: null, rafaCheckout: false });
  });

  it('trims the version, so a tag is spelled from the version and not from its blanks', () => {
    expect(readPackageFacts('{"version": " 0.4.0\\n"}').version).toBe('0.4.0');
  });

  it('trims the name, so a manifest written with blanks around it still reads as the checkout', () => {
    expect(readPackageFacts(`{"name": " ${RAFA_PACKAGE_NAME}\\n", "version": "1.0.0"}`).rafaCheckout).toBe(true);
  });
});
