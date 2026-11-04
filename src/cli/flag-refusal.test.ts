/**
 * Tests for the undeclared flag words of a line and their refusal
 * (`src/cli/flag-refusal.ts`).
 *
 * Each accepting case sits beside a refusing one that differs in the one
 * thing the rule reads, so a reading that accepted every word, or none,
 * fails here: an alias beside an undeclared word, a negated boolean
 * beside a negated string flag, each global name beside its negated form.
 */
import type { RafaCommand, RafaFlagSpec } from '@open-tomato/rafa/core/command';

import { describe, expect, it } from 'bun:test';

import { GLOBAL_FLAGS } from '@open-tomato/rafa/core/command';

import { GLOBAL_FLAG_NAMES, undeclaredFlags, unknownFlagHint, unknownFlagMessage } from './flag-refusal.js';

/** The flags of the stand-in command: a boolean with an alias, and a string. */
const FLAGS: RafaFlagSpec[] = [
  { name: 'push', description: 'Pushes the tag.', type: 'boolean', aliases: ['p'] },
  { name: 'plan', description: 'The plan file.', type: 'string' },
];

/** The stand-in command the lines are read against. */
const COMMAND: Pick<RafaCommand, 'subject' | 'action' | 'flags'> = { subject: 'release', action: 'tag', flags: FLAGS };

describe('undeclaredFlags', () => {
  it('refuses an undeclared flag, as typed', () => {
    expect(undeclaredFlags(['release', 'tag', '--dry-run'], COMMAND)).toEqual(['--dry-run']);
    expect(undeclaredFlags(['--dry-run=yes'], COMMAND)).toEqual(['--dry-run=yes']);
  });

  it('accepts a declared flag by its name, bare, with a value, or with a value word after it', () => {
    expect(undeclaredFlags(['--push', '--plan=PLAN.md', '--plan', 'PLAN.md'], COMMAND)).toEqual([]);
  });

  it('accepts an alias in either dash form, and refuses a short word naming no alias', () => {
    expect(undeclaredFlags(['-p', '--p'], COMMAND)).toEqual([]);
    expect(undeclaredFlags(['-x'], COMMAND)).toEqual(['-x']);
  });

  it('accepts the --no- form of a boolean flag and of its alias', () => {
    expect(undeclaredFlags(['--no-push', '--no-p'], COMMAND)).toEqual([]);
  });

  it('refuses the --no- form of a flag that is no boolean, and of an undeclared name', () => {
    expect(undeclaredFlags(['--no-plan'], COMMAND)).toEqual(['--no-plan']);
    expect(undeclaredFlags(['--no-bogus'], COMMAND)).toEqual(['--no-bogus']);
  });

  it('reads --no-<name>=value as the flag no-<name>, as parseArgs does', () => {
    expect(undeclaredFlags(['--no-push=1'], COMMAND)).toEqual(['--no-push=1']);
  });

  it('holds the global names to output, verbose, v and version, read off GLOBAL_FLAGS', () => {
    expect([...GLOBAL_FLAG_NAMES].sort()).toEqual(['output', 'v', 'verbose', 'version']);
    expect(GLOBAL_FLAGS.length).toBeGreaterThan(0);
  });

  it.each([
    ['--output=json'],
    ['--output=events'],
    ['-v'],
    ['--verbose'],
    ['--verbose=2'],
    ['--version'],
  ])('accepts the global flag %s under a command declaring none', (word) => {
    expect(undeclaredFlags([word], { flags: [] })).toEqual([]);
  });

  it('refuses a global name negated, --no-output among them', () => {
    expect(undeclaredFlags(['--no-output', '--no-verbose'], { flags: [] })).toEqual(['--no-output', '--no-verbose']);
  });

  it('ignores every word after the first --, and refuses one before it', () => {
    expect(undeclaredFlags(['--', '--dry-run', '-x'], COMMAND)).toEqual([]);
    expect(undeclaredFlags(['--dry-run', '--', '-x'], COMMAND)).toEqual(['--dry-run']);
  });

  it('reads a positional word and a lone - as no flag', () => {
    expect(undeclaredFlags(['release', 'tag', '-'], COMMAND)).toEqual([]);
  });

  it('names several undeclared flags in the order first typed, once each', () => {
    const line = ['--dry-run', '--push', '--bogus', '--dry-run', '-x'];

    expect(undeclaredFlags(line, COMMAND)).toEqual(['--dry-run', '--bogus', '-x']);
  });
});

describe('unknownFlagMessage', () => {
  it('names one undeclared flag, then the declared flags', () => {
    expect(unknownFlagMessage(COMMAND, ['--dry-run'])).toBe(
      'unknown flag "--dry-run" for "rafa release tag"; its flags are --push, --plan',
    );
  });

  it('names every undeclared flag of several', () => {
    expect(unknownFlagMessage(COMMAND, ['--dry-run', '--bogus'])).toBe(
      'unknown flags "--dry-run", "--bogus" for "rafa release tag"; its flags are --push, --plan',
    );
  });

  it('says so for a top-level command declaring no flags', () => {
    expect(unknownFlagMessage({ subject: 'status', action: 'status', flags: [] }, ['--bogus'])).toBe(
      'unknown flag "--bogus" for "rafa status"; it declares no flags',
    );
  });
});

describe('unknownFlagHint', () => {
  it('points at the command help', () => {
    expect(unknownFlagHint(COMMAND)).toBe('run rafa release tag --help for its flags');
    expect(unknownFlagHint({ subject: 'status', action: 'status' })).toBe('run rafa status --help for its flags');
  });
});
