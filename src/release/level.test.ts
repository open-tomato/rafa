/**
 * Tests for the release level (`src/release/level.ts`): the plan's own
 * declaration, the highest among its stored change notes, and the
 * `none` a plan that said nothing falls back to.
 *
 * The module reads nothing, so every case is a literal declaration and
 * a literal note list. One case feeds a whole `PlanChange`-shaped row,
 * the shape `readPlanChanges` answers, to pin that the store's rows are
 * accepted as notes without being taken apart first.
 *
 * Two things here can pass while wrong. A module that always answered
 * the notes' highest satisfies every case where the plan declares the
 * same level, so each declaration case declares a level the notes
 * DISAGREE with, in both directions. And a rank read off either source
 * list's indices would make `none` the highest of the four, which only
 * a list mixing `none` with a real level can catch, so the note cases
 * carry `none` beside `patch` and beside `major`.
 *
 * Three mutations of `level.ts` were driven on 2026-09-20, one at a
 * time over `env -u CLAUDECODE bun test src/release/level.test.ts`, the
 * module restored from a scratch copy and verified with `shasum -c`
 * after each. 17 pass either side, and each count is that run's own:
 *
 *  - `none` ranked 4, above `major`, as an index into either source
 *    list would rank it: 5 fail.
 *  - the notes preferred over the declaration: 3 fail, every case whose
 *    plan declares a level AND stored a note; the declaration case with
 *    no note still passes, since the notes have nothing to answer.
 *  - the empty-list fallback answering `source: 'notes'`: 1 fail, the
 *    one case that declares nothing and stores nothing.
 *
 * A fourth was dropped rather than reported: loosening the fold's `>`
 * to `>=` fails nothing, and cannot, because the answer is the level
 * word and two notes at one level carry equal words. No case here
 * distinguishes which of two equals won.
 */
import type { ReleaseLevelNote } from './level.js';
import type { PlanChange } from '../effort/store/changes.js';

import { describe, expect, it } from 'bun:test';

import { PLAN_RELEASE_LEVELS } from '../plan/parse.js';

import { RELEASE_LEVEL_RANK, highestChangeLevel, resolveReleaseLevel } from './level.js';

/** A note list from bare levels, the only field the ranking reads. */
function notes(...levels: ReleaseLevelNote['level'][]): ReleaseLevelNote[] {
  return levels.map((level) => ({ level }));
}

describe('RELEASE_LEVEL_RANK', () => {
  it('ranks none below every real bump', () => {
    expect(RELEASE_LEVEL_RANK.none).toBeLessThan(RELEASE_LEVEL_RANK.patch);
    expect(RELEASE_LEVEL_RANK.none).toBeLessThan(RELEASE_LEVEL_RANK.minor);
    expect(RELEASE_LEVEL_RANK.none).toBeLessThan(RELEASE_LEVEL_RANK.major);
  });

  it('ranks the three bumps patch below minor below major', () => {
    expect(RELEASE_LEVEL_RANK.patch).toBeLessThan(RELEASE_LEVEL_RANK.minor);
    expect(RELEASE_LEVEL_RANK.minor).toBeLessThan(RELEASE_LEVEL_RANK.major);
  });

  it('ranks exactly the levels a plan can declare', () => {
    expect(Object.keys(RELEASE_LEVEL_RANK).toSorted()).toEqual(
      [...PLAN_RELEASE_LEVELS].toSorted(),
    );
  });
});

describe('highestChangeLevel', () => {
  it('answers null when there is no note at all', () => {
    expect(highestChangeLevel([])).toBeNull();
  });

  it('answers none when every note says none', () => {
    expect(highestChangeLevel(notes('none', 'none'))).toBe('none');
  });

  it('answers the one level of a single note', () => {
    expect(highestChangeLevel(notes('minor'))).toBe('minor');
  });

  it('answers major when a none note follows it', () => {
    expect(highestChangeLevel(notes('major', 'none'))).toBe('major');
  });

  it('answers patch when it follows a none note', () => {
    expect(highestChangeLevel(notes('none', 'patch'))).toBe('patch');
  });

  it('answers the highest wherever it sits in the list', () => {
    expect(highestChangeLevel(notes('patch', 'major', 'minor'))).toBe('major');
    expect(highestChangeLevel(notes('minor', 'patch', 'minor'))).toBe('minor');
  });

  it('reads a stored row from the changes table as a note', () => {
    const row: PlanChange = {
      sessionId: 'session-1',
      taskLine: 'Add the release level',
      level: 'minor',
      area: 'release',
      summary: 'plans can declare the bump their pull request is worth',
      collectedAt: '2026-09-20T10:00:00.000Z',
    };
    expect(highestChangeLevel([row])).toBe('minor');
  });
});

describe('resolveReleaseLevel', () => {
  it('takes the plan declaration over lower notes', () => {
    expect(resolveReleaseLevel('major', notes('patch', 'none'))).toEqual({
      level: 'major',
      source: 'plan',
      notesLevel: 'patch',
    });
  });

  it('takes the plan declaration over higher notes', () => {
    expect(resolveReleaseLevel('patch', notes('major'))).toEqual({
      level: 'patch',
      source: 'plan',
      notesLevel: 'major',
    });
  });

  it('takes a declared none over notes that ask for a bump', () => {
    expect(resolveReleaseLevel('none', notes('minor'))).toEqual({
      level: 'none',
      source: 'plan',
      notesLevel: 'minor',
    });
  });

  it('answers the declaration with no note stored', () => {
    expect(resolveReleaseLevel('minor', [])).toEqual({
      level: 'minor',
      source: 'plan',
      notesLevel: null,
    });
  });

  it('answers the highest note when the plan declares nothing', () => {
    expect(resolveReleaseLevel(null, notes('patch', 'minor', 'none'))).toEqual({
      level: 'minor',
      source: 'notes',
      notesLevel: 'minor',
    });
  });

  it('answers none from the notes when every note says none', () => {
    expect(resolveReleaseLevel(null, notes('none', 'none'))).toEqual({
      level: 'none',
      source: 'notes',
      notesLevel: 'none',
    });
  });

  it('answers none by default when the plan declared nothing and stored nothing', () => {
    expect(resolveReleaseLevel(null, [])).toEqual({
      level: 'none',
      source: 'default',
      notesLevel: null,
    });
  });
});
