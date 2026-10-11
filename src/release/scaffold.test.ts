/**
 * Tests for the release lines of the scaffold (`release/scaffold.ts`):
 * what `src/project/scaffold.ts` reads off the three constants.
 *
 * No case reads the disk, the clock or the environment: each reads a
 * constant. Where the lines sit in the config `rafa init` writes, and
 * what they resolve to once uncommented, is covered beside the release
 * step that edits that file (`commands/init-release.test.ts`).
 *
 * Each reading sits beside its control: a line read as commented beside
 * the same line with its mark dropped, and each default found in its
 * line beside a value the line does not hold.
 */
import { describe, expect, it } from 'bun:test';

import { CONFIG_DEFAULTS } from '../config.js';

import {
  DANGEROUS_VERSION_COLLISION_LINE,
  PR_VERSION_COLLISION_LINE,
  RELEASE_FRAGMENT_LINES,
} from './scaffold.js';

/** A commented setting line one level under its section: the key, then what follows it. */
const COMMENTED_SETTING = /^# {3}([A-Za-z]+): (.*)$/;

/** The key of a commented setting line and the text after it, or null when the line is not one. */
function settingOf(line: string): readonly [string, string] | null {
  const match = COMMENTED_SETTING.exec(line);
  return match === null
    ? null
    : [match[1] ?? '', match[2] ?? ''];
}

/** The keys `lines` spell, in order; a line that is not a commented setting spells none. */
function keysOf(lines: readonly string[]): readonly string[] {
  return lines.map((line) => settingOf(line)?.[0] ?? '');
}

describe('RELEASE_FRAGMENT_LINES', () => {
  it('spells the four settings in the order the scaffold places them', () => {
    expect(keysOf(RELEASE_FRAGMENT_LINES)).toEqual(['fragments', 'strategy', 'settle', 'tag']);
  });

  it('is commented on every line, which a line with its mark dropped is not', () => {
    const uncommented = RELEASE_FRAGMENT_LINES.map((line) => line.replace(/^# /, ''));

    expect(RELEASE_FRAGMENT_LINES.every((line) => settingOf(line) !== null)).toBe(true);
    expect(uncommented.some((line) => settingOf(line) !== null)).toBe(false);
  });

  it('carries each setting at its schema default', () => {
    const values = RELEASE_FRAGMENT_LINES.map((line) => settingOf(line)?.[1].split(' ')[0]);

    expect(values).toEqual([
      CONFIG_DEFAULTS.releaseFragments,
      CONFIG_DEFAULTS.releaseStrategy,
      CONFIG_DEFAULTS.releaseSettle,
      CONFIG_DEFAULTS.releaseTag,
    ]);
    expect(values).not.toContain('pr');
  });

  it('is frozen, so a caller that spreads it cannot change it for the next', () => {
    expect(Object.isFrozen(RELEASE_FRAGMENT_LINES)).toBe(true);
    expect(Object.isFrozen([...RELEASE_FRAGMENT_LINES])).toBe(false);
  });
});

describe('the two version collision lines', () => {
  it('spell pr.versionCollision at its schema default, commented', () => {
    const setting = settingOf(PR_VERSION_COLLISION_LINE);

    expect(setting?.[0]).toBe('versionCollision');
    expect(setting?.[1].split(' ')[0]).toBe(CONFIG_DEFAULTS.prVersionCollision);
    expect(setting?.[1].split(' ')[0]).not.toBe('refuse');
  });

  it('spell dangerous.acceptVersionCollision at its schema default, commented', () => {
    const setting = settingOf(DANGEROUS_VERSION_COLLISION_LINE);

    expect(setting?.[0]).toBe('acceptVersionCollision');
    expect(setting?.[1].split(' ')[0]).toBe(String(CONFIG_DEFAULTS.dangerousAcceptVersionCollision));
    expect(setting?.[1].split(' ')[0]).not.toBe('true');
  });
});
