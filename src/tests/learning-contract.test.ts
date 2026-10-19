/**
 * The learning contract: core's declaration of the six records the
 * `Learning` port passes, and the two confidence bounds the `confidence`
 * reader reads, held to the learning library's own.
 *
 * Neither side may import the other. `src/learning/` imports nothing
 * from the rest of `src/` (`learning-boundary.test.ts`), and core
 * imports nothing above it, so core declares the six types in
 * `packages/rafa/src/ports/learning.ts` and the two bounds in
 * `packages/rafa/src/core/config/config-sections.ts`, and the library keeps its own in
 * `src/learning/types.ts` and `src/learning/identity.ts`. This file
 * imports both sides, which is why it sits outside core: core through
 * `packages/rafa/src/ports/index.ts` and the sections barrel, the library through
 * `src/learning/index.ts`.
 *
 * ## What holds the types
 *
 * Bun runs a test without checking a type, so the type cases are held
 * by the compiler when the runner's type step compiles this file. Each
 * pair is held two ways:
 *
 *   - Mutually assignable: a value typed as core's is assigned to the
 *     library's, and back, so a required field added, dropped or retyped
 *     on one side alone fails to compile.
 *   - The same keys: {@link SameKeys} compares the two `keyof` unions,
 *     since an OPTIONAL field on one side alone leaves both assignments
 *     compiling.
 *
 * At run time each case reads the values back, so the case also fails
 * if a fixture were dropped from it.
 */
import type {
  BlessedBundle as LibraryBlessedBundle,
  InstinctRecord as LibraryInstinctRecord,
  MergeDecision as LibraryMergeDecision,
  MergeResult as LibraryMergeResult,
  MergeRule as LibraryMergeRule,
  SyncPayload as LibrarySyncPayload,
} from '../learning/index.js';
import type {
  BlessedBundle as CoreBlessedBundle,
  InstinctRecord as CoreInstinctRecord,
  MergeDecision as CoreMergeDecision,
  MergeResult as CoreMergeResult,
  MergeRule as CoreMergeRule,
  SyncPayload as CoreSyncPayload,
} from '@open-tomato/rafa/ports';

import { describe, expect, test } from 'bun:test';

import {
  CONFIDENCE_MAX as CORE_CONFIDENCE_MAX,
  CONFIDENCE_MIN as CORE_CONFIDENCE_MIN,
} from '@open-tomato/rafa/core/config/sections';

import {
  CONFIDENCE_MAX as LIBRARY_CONFIDENCE_MAX,
  CONFIDENCE_MIN as LIBRARY_CONFIDENCE_MIN,
} from '../learning/index.js';

/**
 * `true` when `A` and `B` are the same union of keys, and `false`
 * otherwise; a case assigns it to `true`, so `false` fails to compile.
 */
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;

/** One record with every field set, optional ones included. */
const CORE_RECORD: CoreInstinctRecord = {
  id: 'when-a-test-runs-0001',
  trigger: 'when a test runs',
  action: 'read its exit code',
  action_hash: 'a'.repeat(64),
  confidence: 0.5,
  usage_count: 2,
  sources: ['session-a', 'session-b'],
  artifact: 'exit=1',
  signal: 'loud',
  status: 'active',
  promoted_to: 'context/verification.md',
  created_at: '2026-10-15T00:00:00.000Z',
  updated_at: '2026-10-15T00:00:00.000Z',
};

describe('the learning records core declares', () => {
  test('InstinctRecord is mutually assignable with the library\'s, key for key', () => {
    const library: LibraryInstinctRecord = CORE_RECORD;
    const core: CoreInstinctRecord = library;
    const sameKeys: SameKeys<CoreInstinctRecord, LibraryInstinctRecord> = true;

    expect(core).toBe(CORE_RECORD);
    expect(sameKeys).toBe(true);
  });

  test('SyncPayload is mutually assignable with the library\'s, key for key', () => {
    const fromCore: CoreSyncPayload = { source_id: 'session-a', instincts: [CORE_RECORD] };
    const library: LibrarySyncPayload = fromCore;
    const core: CoreSyncPayload = library;
    const sameKeys: SameKeys<CoreSyncPayload, LibrarySyncPayload> = true;

    expect(core).toBe(fromCore);
    expect(sameKeys).toBe(true);
  });

  test('BlessedBundle is mutually assignable with the library\'s, key for key', () => {
    const fromCore: CoreBlessedBundle = { version: '1', instincts: [CORE_RECORD] };
    const library: LibraryBlessedBundle = fromCore;
    const core: CoreBlessedBundle = library;
    const sameKeys: SameKeys<CoreBlessedBundle, LibraryBlessedBundle> = true;

    expect(core).toBe(fromCore);
    expect(sameKeys).toBe(true);
  });

  test('MergeRule is mutually assignable with the library\'s', () => {
    const rules: CoreMergeRule[] = ['new-trigger', 'same-action', 'higher-confidence', 'flagged'];
    const library: LibraryMergeRule[] = rules;
    const core: CoreMergeRule[] = library;

    expect(core).toBe(rules);
  });

  test('MergeDecision is mutually assignable with the library\'s, key for key', () => {
    const fromCore: CoreMergeDecision = {
      incoming: CORE_RECORD,
      rule: 'same-action',
      produced: [CORE_RECORD],
    };
    const library: LibraryMergeDecision = fromCore;
    const core: CoreMergeDecision = library;
    const sameKeys: SameKeys<CoreMergeDecision, LibraryMergeDecision> = true;

    expect(core).toBe(fromCore);
    expect(sameKeys).toBe(true);
  });

  test('MergeResult is mutually assignable with the library\'s, key for key', () => {
    const fromCore: CoreMergeResult = {
      decisions: [{ incoming: CORE_RECORD, rule: 'new-trigger', produced: [CORE_RECORD] }],
      discarded: [],
    };
    const library: LibraryMergeResult = fromCore;
    const core: CoreMergeResult = library;
    const sameKeys: SameKeys<CoreMergeResult, LibraryMergeResult> = true;

    expect(core).toBe(fromCore);
    expect(sameKeys).toBe(true);
  });
});

describe('the confidence bounds core declares', () => {
  test('CONFIDENCE_MIN equals the library\'s', () => {
    expect(CORE_CONFIDENCE_MIN).toBe(LIBRARY_CONFIDENCE_MIN);
  });

  test('CONFIDENCE_MAX equals the library\'s', () => {
    expect(CORE_CONFIDENCE_MAX).toBe(LIBRARY_CONFIDENCE_MAX);
  });
});
