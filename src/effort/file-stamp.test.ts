/**
 * Tests for the file-name stamp (`effort/file-stamp.ts`): what a caller
 * outside `src/commands/` reads off {@link fileStamp}.
 *
 * No case reads the system clock, the disk or the environment: each
 * hands the function an instant and reads the string it answers. The
 * commands that stamp a file with it are covered by their own tests
 * (`commands/effort/fix-schema.test.ts` among them).
 *
 * Each reading sits beside its control: an instant with milliseconds
 * beside the same second without them (one stamp), an instant written
 * with an offset beside the same instant in UTC (one stamp), and two
 * instants a second apart (two stamps, in order).
 */
import { describe, expect, it } from 'bun:test';

import { fileStamp } from './file-stamp.js';

const NOW = new Date('2026-09-26T10:15:00.000Z');

/** Every character a stamp may hold: digits, the `T` and the closing `Z`. */
const STAMP_SHAPE = /^\d{8}T\d{6}Z$/;

describe('fileStamp', () => {
  it('reads a clock as a stamp a file name can carry', () => {
    expect(fileStamp(NOW)).toBe('20260926T101500Z');
  });

  it('holds only digits, the T and the closing Z', () => {
    expect(fileStamp(NOW)).toMatch(STAMP_SHAPE);
    expect(NOW.toISOString()).not.toMatch(STAMP_SHAPE);
  });

  it('drops the milliseconds, so two readings within a second spell one stamp', () => {
    const later = new Date('2026-09-26T10:15:00.987Z');

    expect(later.getTime()).not.toBe(NOW.getTime());
    expect(fileStamp(later)).toBe(fileStamp(NOW));
  });

  it('spells the instant in UTC, whatever offset it was written with', () => {
    const offset = new Date('2026-09-26T12:15:00+02:00');

    expect(offset.getTime()).toBe(NOW.getTime());
    expect(fileStamp(offset)).toBe('20260926T101500Z');
  });

  it('sorts as the instants do', () => {
    const next = new Date('2026-09-26T10:15:01.000Z');
    const earlier = new Date('2025-12-31T23:59:59.000Z');

    expect(fileStamp(next)).toBe('20260926T101501Z');
    expect(fileStamp(NOW) < fileStamp(next)).toBe(true);
    expect(fileStamp(earlier) < fileStamp(NOW)).toBe(true);
  });

  it('throws on an invalid date rather than answering a stamp', () => {
    expect(() => fileStamp(new Date('not a date'))).toThrow(RangeError);
  });
});
