/**
 * Tests for the merge follow-ups (`merge-followups.ts`): which of the
 * two applies for each reading, in which order, and what a
 * `package.json` text is read as.
 *
 * Both functions are pure and total, so every case is a literal: no
 * repository is planted, no home is read, and nothing is spawned. The
 * gathering is `merge-cleanup.ts`'s, and `merge-cleanup.test.ts`
 * measures it over a scratch repository.
 *
 * The rafa-checkout cases read the package name from
 * {@link RAFA_PACKAGE_NAME} rather than spelling `@open-tomato/rafa`
 * again, since that constant is what `self-update`'s own install
 * refuses over; the control beside them is a literal foreign name,
 * which holds the check to something it could fail. The settle command
 * is checked against the name `rafa release settle` registers under,
 * so the line cannot name a command `rafa` would not route.
 */
import type { FollowUpReading, SettleWaiting } from './merge-followups.js';

import { describe, expect, it } from 'bun:test';

import { RAFA_PACKAGE_NAME } from '../../runtime/install.js';
import { createReleaseSettleCommand } from '../release/settle.js';

import { readFollowUps, readPackageFacts, RELEASE_SETTLE_COMMAND, versionTag } from './merge-followups.js';

/** Two fragments waiting on main that fold into 0.5.0. */
const WAITING: SettleWaiting = { base: 'main', fragments: 2, version: '0.5.0' };

/** A reading of a rafa checkout on a version nothing has installed, with fragments waiting, filled from `over`. */
function reading(over: Partial<FollowUpReading> = {}): FollowUpReading {
  return {
    version: '0.4.0',
    rafaCheckout: true,
    runtimeInstalled: false,
    settle: WAITING,
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
  it('names both for an uninstalled version with fragments waiting, settle last', () => {
    const followUps = readFollowUps(reading());

    expect(followUps.map((followUp) => followUp.command)).toEqual(['rafa self-update', 'rafa release settle']);
    expect(followUps[0]?.why).toBe('0.4.0 is not installed as this machine\'s rafa runtime');
    expect(followUps[1]?.why).toBe('2 fragments wait on main and fold into 0.5.0');
  });

  it('keeps settle last in every combination that names it', () => {
    for (const rafaCheckout of [true, false]) {
      for (const runtimeInstalled of [true, false]) {
        const ids = idsOf(reading({ rafaCheckout, runtimeInstalled }));
        expect(ids.at(-1)).toBe('release-settle');
      }
    }
  });

  it('counts one fragment in the singular', () => {
    const followUps = readFollowUps(reading({ settle: { base: 'trunk', fragments: 1, version: '1.0.1' } }));

    expect(followUps.at(-1)?.why).toBe('1 fragment waits on trunk and folds into 1.0.1');
  });

  it('names neither when nothing waits and the version is installed, which is the ordinary merge', () => {
    expect(idsOf(reading({ settle: null, runtimeInstalled: true }))).toEqual([]);
  });

  it('names settle alone in a project that is no rafa checkout, where self-update would refuse', () => {
    expect(idsOf(reading({ rafaCheckout: false }))).toEqual(['release-settle']);
  });

  it('names the update alone where no fragment waits', () => {
    expect(idsOf(reading({ settle: null }))).toEqual(['self-update']);
  });

  it('leaves the update out for a version already installed, which rafa self-update would refuse', () => {
    expect(idsOf(reading({ runtimeInstalled: true }))).toEqual(['release-settle']);
  });

  it('names settle for a project with no readable package.json version, since the fold reads the version file', () => {
    expect(idsOf(reading({ version: null }))).toEqual(['release-settle']);
    expect(idsOf(reading({ version: null, settle: null }))).toEqual([]);
  });

  it('never names the tag, which settle now owns', () => {
    const commands = readFollowUps(reading()).map((followUp) => followUp.command);

    expect(commands).not.toContain('rafa release tag');
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

describe('the settle command', () => {
  it('is the name the settle command registers under', () => {
    expect(RELEASE_SETTLE_COMMAND).toBe(`rafa ${createReleaseSettleCommand().name}`);
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
