/**
 * Unit tests for `selectLessons`: the artifact-path match in the task
 * text and the stage context, the trigger rank above the floor against
 * the task text, the cap of 5, and highest confidence first. Every
 * keeping case is paired with a lesson in the same bundle that must be
 * dropped, so a filter that kept everything would fail it.
 */
import type { TaskInput } from './resolve-skills.js';
import type { BlessedBundle, InstinctRecord } from '../learning/index.js';

import { describe, expect, it } from 'bun:test';

import { RANK_FLOOR } from './resolve-skills.js';
import { isArtifactPath, LESSON_LIMIT, namesPath, selectLessons } from './select-lessons.js';

const UNRELATED_TRIGGER = 'when rotating the kubernetes certificates';

function lesson(id: string, fields: Partial<InstinctRecord> = {}): InstinctRecord {
  return {
    id,
    trigger: UNRELATED_TRIGGER,
    action: `action of ${id}`,
    action_hash: `hash-${id}`,
    confidence: 0.5,
    usage_count: 1,
    signal: 'loud',
    status: 'active',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...fields,
  };
}

function bundle(...instincts: InstinctRecord[]): BlessedBundle {
  return { version: 'v1', instincts };
}

function task(text: string, stageContext: string | null = null): TaskInput {
  return { text, skills: [], stageContext };
}

function ids(lessons: readonly InstinctRecord[]): string[] {
  return lessons.map((kept) => kept.id);
}

describe('selectLessons: the artifact path', () => {
  it('keeps a lesson whose artifact path the task text names, and drops one it does not', () => {
    const named = lesson('named', { artifact: 'src/start/dispatch.ts' });
    const other = lesson('other', { artifact: 'src/effort/collect.ts' });

    const kept = selectLessons(task('Make `buildTaskPrompt` in src/start/dispatch.ts take the sections'), bundle(named, other));

    expect(ids(kept)).toEqual(['named']);
  });

  it('keeps a lesson whose artifact path only the stage context names', () => {
    const named = lesson('named', { artifact: 'src/tiers/resolve.ts' });
    const other = lesson('other', { artifact: 'src/plan.ts' });

    const kept = selectLessons(
      task('Add the section renderers', 'The seam is `resolveTiers` in src/tiers/resolve.ts.'),
      bundle(named, other),
    );

    expect(ids(kept)).toEqual(['named']);
  });

  it('never matches an artifact that is not path-shaped, even when the text quotes it', () => {
    const message = lesson('message', { artifact: 'Cannot find package' });

    const kept = selectLessons(task('Fix the Cannot find package error in the build'), bundle(message));

    expect(kept).toEqual([]);
  });

  it('keeps nothing for a lesson with no artifact and an unrelated trigger', () => {
    expect(selectLessons(task('Add src/task/sections.ts'), bundle(lesson('bare')))).toEqual([]);
  });

  it('escapes a path holding regular-expression characters', () => {
    const odd = lesson('odd', { artifact: 'src/(a)+.ts' });
    const near = lesson('near', { artifact: 'src/a.ts' });

    const kept = selectLessons(task('Edit src/(a)+.ts only'), bundle(odd, near));

    expect(ids(kept)).toEqual(['odd']);
  });
});

describe('namesPath: the name stands whole', () => {
  it.each([
    ['in src/a.ts today', true],
    ['see `src/a.ts`', true],
    ['see (src/a.ts)', true],
    ['it ends in src/a.ts.', true],
    ['src/a.ts', true],
    ['in src/a.tsx today', false],
    ['in lib/src/a.ts today', false],
    ['in src/a.ts/b today', false],
    ['in src/a.ts.bak today', false],
    ['in my-src/a.ts today', false],
  ])('%p names src/a.ts: %p', (text, expected) => {
    expect(namesPath(text, 'src/a.ts')).toBe(expected);
  });
});

describe('isArtifactPath', () => {
  it.each([
    ['src/a.ts', true],
    ['package.json', true],
    ['context/', true],
    ['Cannot find package', false],
    ['ENOENT', false],
    ['', false],
  ])('%p reads as a path: %p', (artifact, expected) => {
    expect(isArtifactPath(artifact)).toBe(expected);
  });
});

describe('selectLessons: the trigger', () => {
  it('keeps a lesson whose trigger the ranker scores above the floor against the task text', () => {
    const matching = lesson('matching', { trigger: 'when a migration adds a column to dispatches' });
    const other = lesson('other');

    const kept = selectLessons(task('Add the dispatches migration for the resolver column'), bundle(matching, other));

    expect(RANK_FLOOR).toBe(0);
    expect(ids(kept)).toEqual(['matching']);
  });

  it('matches by the ranker\'s prefix rule, not only by equal words', () => {
    const prefixed = lesson('prefixed', { trigger: 'when testing the collector' });

    expect(ids(selectLessons(task('Add the collector tests'), bundle(prefixed)))).toEqual(['prefixed']);
  });

  it('does not score the trigger against the stage context', () => {
    const staged = lesson('staged', { trigger: 'when the kubernetes certificates expire' });

    const kept = selectLessons(task('Add the section renderers', 'Rotate the kubernetes certificates first.'), bundle(staged));

    expect(kept).toEqual([]);
  });

  it('drops a trigger whose only shared words are stop words', () => {
    const stop = lesson('stop', { trigger: 'when you use the skill for this' });

    expect(selectLessons(task('Use the skill for this task'), bundle(stop))).toEqual([]);
  });
});

describe('selectLessons: the cap and the order', () => {
  it(`keeps at most ${LESSON_LIMIT}, highest confidence first`, () => {
    const confidences = [0.4, 0.9, 0.3, 0.7, 0.6, 0.8, 0.5];
    const atPath = (confidence: number, index: number): InstinctRecord => lesson(`l${index}`, { artifact: 'src/a.ts', confidence });
    const lessons = confidences.map(atPath);

    const kept = selectLessons(task('Edit src/a.ts'), bundle(...lessons));

    expect(LESSON_LIMIT).toBe(5);
    expect(kept.map((one) => one.confidence)).toEqual([0.9, 0.8, 0.7, 0.6, 0.5]);
  });

  it('keeps the bundle order on a confidence tie', () => {
    const lessons = ['b', 'a', 'c'].map((id) => lesson(id, { artifact: 'src/a.ts', confidence: 0.7 }));

    expect(ids(selectLessons(task('Edit src/a.ts'), bundle(...lessons)))).toEqual(['b', 'a', 'c']);
  });

  it('orders across both readings together', () => {
    const byPath = lesson('by-path', { artifact: 'src/a.ts', confidence: 0.4 });
    const byTrigger = lesson('by-trigger', { trigger: 'when editing the renderer', confidence: 0.8 });

    const kept = selectLessons(task('Edit the renderer in src/a.ts'), bundle(byPath, byTrigger));

    expect(ids(kept)).toEqual(['by-trigger', 'by-path']);
  });

  it('answers nothing for an empty bundle and leaves the bundle as it was', () => {
    const given = bundle(lesson('x', { artifact: 'src/a.ts', confidence: 0.3 }), lesson('y', { artifact: 'src/a.ts', confidence: 0.9 }));

    expect(selectLessons(task('Edit src/a.ts'), bundle())).toEqual([]);
    selectLessons(task('Edit src/a.ts'), given);
    expect(ids(given.instincts)).toEqual(['x', 'y']);
  });
});
