/**
 * Tests for the one runtime value the store port holds: the key
 * projection record.
 *
 * Everything else in `types.ts` is a type, and a type-level claim here
 * would prove nothing: the root tsconfig excludes `*.test.ts`, so
 * `check-types` never reads this file. The compile-time guards the
 * module note claims are therefore held in the module itself, where
 * `check-types` does read them.
 *
 * Rows are planted by casting a partial object. A projection reads one
 * field, and a row read back from storage is only as typed as the file
 * it came from, so the malformed rows below are rows a hand-edited
 * store can actually hold.
 *
 * The expected binding is spelled HERE, in {@link KEY_FIELDS}, rather
 * than read off the module, so a module keyed by the wrong field fails
 * rather than agreeing with itself.
 *
 * The compile-time guards were each driven red once against
 * `check-types`, with a mutated copy of the module planted beside it
 * and moved out afterwards: a kind added to the row map with no key
 * (TS2741), the sessions projection reading `sha` (TS2339), and a third
 * kind in the record (TS2353). A backend whose `keys` takes one kind
 * only was refused against the port's property signatures (TS2322),
 * and the same port spelled with method signatures accepted it, which
 * is the control. The alias-over-interface claim was measured on a
 * stand-in type: re-declaring an alias through a module augmentation
 * failed with TS2300, while the same merge into an interface compiled.
 *
 * Eleven module mutations were driven against this file and every one
 * reddened at least one case, with the restored module byte-identical
 * and green either side: the two projections swapped, sessions falling
 * back to the sha, each kind keyed by another field of its own row, an
 * empty string accepted as a key, a non-string coerced into one, a key
 * trimmed, a whitespace-only key read as empty, a keyless row answering
 * an empty string or undefined instead of null, and a third kind added
 * to the record.
 */
import type {
  CommitEffortRow,
  EffortRowKind,
  SessionEffortRow,
} from './types.js';

import { describe, expect, it } from 'bun:test';

import { EFFORT_KEY_PROJECTIONS } from './types.js';

/** The field each kind is expected to be keyed by. */
const KEY_FIELDS: readonly (readonly [EffortRowKind, string])[] = [
  ['sessions', 'sessionId'],
  ['commits', 'sha'],
];

/** Values present in the key field that are still no key at all. */
const UNUSABLE_VALUES: readonly (readonly [string, unknown])[] = [
  ['an empty string', ''],
  ['null', null],
  ['a number', 42],
  ['a boolean', true],
  ['an array holding a key', ['deadbeef']],
];

/** Projects a planted row under one kind. The cast is the plant. */
function projectKey(
  kind: EffortRowKind,
  fields: Record<string, unknown>,
): string | null {
  return kind === 'sessions'
    ? EFFORT_KEY_PROJECTIONS.sessions(fields as unknown as SessionEffortRow)
    : EFFORT_KEY_PROJECTIONS.commits(fields as unknown as CommitEffortRow);
}

describe('EFFORT_KEY_PROJECTIONS', () => {
  it('binds sessions to the session id', () => {
    expect(projectKey('sessions', { sessionId: 'aaaa-1111' }))
      .toBe('aaaa-1111');
  });

  it('binds commits to the sha', () => {
    expect(projectKey('commits', { sha: 'deadbeef' })).toBe('deadbeef');
  });

  it('reads only its own kind of key from a row carrying both', () => {
    const both = { sessionId: 'aaaa-1111', sha: 'deadbeef' };

    expect(projectKey('sessions', both)).toBe('aaaa-1111');
    expect(projectKey('commits', both)).toBe('deadbeef');
  });

  it('never falls back to the other kind of key', () => {
    expect(projectKey('sessions', { sha: 'deadbeef' })).toBeNull();
    expect(projectKey('commits', { sessionId: 'aaaa-1111' })).toBeNull();
  });

  it('is closed over exactly the two kinds', () => {
    expect(Object.keys(EFFORT_KEY_PROJECTIONS).sort())
      .toEqual(['commits', 'sessions']);
  });
});

describe.each(KEY_FIELDS)(
  'the %s projection over a keyless row',
  (kind, field) => {
    it('answers null when the key field is absent', () => {
      expect(projectKey(kind, { other: 'aaaa-1111' })).toBeNull();
    });

    it.each(UNUSABLE_VALUES)(
      'answers null when the key is %s',
      (_label, value) => {
        expect(projectKey(kind, { [field]: value })).toBeNull();
      },
    );
  },
);

describe('the sibling store key rule', () => {
  it('keeps whitespace as a key rather than trimming it', () => {
    expect(projectKey('sessions', { sessionId: ' ' })).toBe(' ');
    expect(projectKey('commits', { sha: ' deadbeef ' })).toBe(' deadbeef ');
  });
});
