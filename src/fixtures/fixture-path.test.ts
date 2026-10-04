/**
 * Tests for the fixture path rule (`src/fixtures/fixture-path.ts`).
 *
 * Each fixture path the rule must accept is paired with a near miss it
 * must refuse, so a rule that always answered `true` or always answered
 * `false` reddens here.
 */
import { describe, expect, it } from 'bun:test';

import { isFixturePath } from './fixture-path.js';

describe('isFixturePath', () => {
  it('accepts a file directly under a testdata folder', () => {
    expect(isFixturePath('src/triage/testdata/scoring-causes.json')).toBe(true);
    expect(isFixturePath('testdata/top-level.json')).toBe(true);
  });

  it('accepts a file nested below a testdata folder', () => {
    expect(isFixturePath('src/effort/store/testdata/merge/scenario-4/a.json')).toBe(true);
    expect(isFixturePath('packages/rafa-hub/src/testdata/rows.json')).toBe(true);
  });

  it('accepts a file under src/tests/fixtures/ at any depth', () => {
    expect(isFixturePath('src/tests/fixtures/notes.md')).toBe(true);
    expect(isFixturePath('src/tests/fixtures/pr-triage/green/pr.json')).toBe(true);
  });

  it('refuses a folder whose name only contains testdata', () => {
    expect(isFixturePath('src/testdata-old/a.json')).toBe(false);
    expect(isFixturePath('src/my-testdata/a.json')).toBe(false);
  });

  it('refuses a file that is itself named testdata', () => {
    expect(isFixturePath('src/triage/testdata')).toBe(false);
  });

  it('refuses src/tests/ outside fixtures, and a fixtures folder elsewhere', () => {
    expect(isFixturePath('src/tests/loop-session-fixtures.ts')).toBe(false);
    expect(isFixturePath('src/tests/fixtures-index.ts')).toBe(false);
    expect(isFixturePath('src/other/fixtures/a.json')).toBe(false);
  });

  it('refuses an ordinary source or doc path', () => {
    expect(isFixturePath('src/triage/triage.ts')).toBe(false);
    expect(isFixturePath('AGENTS.md')).toBe(false);
  });
});
