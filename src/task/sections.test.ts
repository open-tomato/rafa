/**
 * Unit tests for the two prompt section renderers: the documented
 * format, the session name under each delivery, the lesson evidence,
 * whitespace collapsing, order kept, and the empty string for an empty
 * list, each empty case paired with a one-item list that renders.
 */
import type { ResolvedSkill } from './resolve-skills.js';
import type { InstinctRecord } from '../learning/index.js';

import { describe, expect, it } from 'bun:test';

import {
  LESSONS_HEADING,
  lessonLine,
  lessonTaskCount,
  renderLessonsSection,
  renderSkillsSection,
  skillLine,
  SKILLS_HEADING,
  SKILLS_INSTRUCTION,
} from './sections.js';

function skill(name: string, description = `Use when ${name}`): ResolvedSkill {
  return { name, source: 'project', path: `/project/skills/${name}/SKILL.md`, description };
}

function lesson(id: string, fields: Partial<InstinctRecord> = {}): InstinctRecord {
  return {
    id,
    trigger: 'when running bun test under a fresh worktree',
    action: 'run bun install before the first test',
    action_hash: `hash-${id}`,
    confidence: 0.7,
    usage_count: 3,
    signal: 'loud',
    status: 'active',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...fields,
  };
}

describe('renderSkillsSection', () => {
  it('writes the heading, the instruction and one line per skill, in order', () => {
    const section = renderSkillsSection([
      skill('git-workflow', 'Use when pushing a branch, opening or updating a PR'),
      skill('bun-test'),
    ], 'add-dir');

    expect(section).toBe([
      '## Skills for this task',
      'Invoke each with the Skill tool before you change anything it covers.',
      '- `git-workflow`: Use when pushing a branch, opening or updating a PR',
      '- `bun-test`: Use when bun-test',
    ].join('\n'));
  });

  it('answers the empty string for no skills', () => {
    expect(renderSkillsSection([])).toBe('');
    expect(renderSkillsSection([skill('one')])).not.toBe('');
  });

  it('names each skill as the session invokes it under the delivery', () => {
    expect(skillLine(skill('git-workflow', 'x'), 'add-dir')).toBe('- `git-workflow`: x');
    expect(skillLine(skill('git-workflow', 'x'), 'plugin-dir')).toBe('- `rafa:git-workflow`: x');
  });

  it('drops the colon for a skill with no description', () => {
    expect(skillLine(skill('bare', ''), 'add-dir')).toBe('- `bare`');
    expect(skillLine(skill('bare', '  \n '), 'add-dir')).toBe('- `bare`');
  });

  it('collapses a multi-line description onto its line', () => {
    expect(skillLine(skill('folded', 'Use when\n  folding\tlines '), 'add-dir'))
      .toBe('- `folded`: Use when folding lines');
  });

  it('exports the heading and instruction it writes', () => {
    const [heading, instruction] = renderSkillsSection([skill('a')]).split('\n');
    expect(heading).toBe(SKILLS_HEADING);
    expect(instruction).toBe(SKILLS_INSTRUCTION);
  });
});

describe('renderLessonsSection', () => {
  it('writes the heading and one line per lesson, in order', () => {
    const section = renderLessonsSection([
      lesson('L-1'),
      lesson('L-2', { trigger: 'editing src/a.ts', action: 'keep it pure', confidence: 0.5, usage_count: 2 }),
    ]);

    expect(section).toBe([
      '## Lessons from earlier tasks',
      '- When running bun test under a fresh worktree: run bun install before the first test'
        + ' (confidence 0.70, from 3 tasks, lesson L-1)',
      '- When editing src/a.ts: keep it pure (confidence 0.50, from 2 tasks, lesson L-2)',
    ].join('\n'));
    expect(section.split('\n')[0]).toBe(LESSONS_HEADING);
  });

  it('answers the empty string for no lessons', () => {
    expect(renderLessonsSection([])).toBe('');
    expect(renderLessonsSection([lesson('L-1')])).not.toBe('');
  });

  it('takes off a leading when of any case, and only a whole word', () => {
    expect(lessonLine(lesson('a', { trigger: 'When pushing' }))).toStartWith('- When pushing: ');
    expect(lessonLine(lesson('b', { trigger: 'WHEN pushing' }))).toStartWith('- When pushing: ');
    expect(lessonLine(lesson('c', { trigger: 'whenever pushing' }))).toStartWith('- When whenever pushing: ');
    expect(lessonLine(lesson('d', { trigger: 'pushing' }))).toStartWith('- When pushing: ');
  });

  it('collapses multi-line triggers and actions onto the line', () => {
    const line = lessonLine(lesson('m', { trigger: 'when\n  a\nb', action: 'do\tthis\n now' }));
    expect(line).toBe('- When a b: do this now (confidence 0.70, from 3 tasks, lesson m)');
  });

  it('writes the confidence with two decimals', () => {
    expect(lessonLine(lesson('c', { confidence: 0.9 }))).toContain('(confidence 0.90,');
    expect(lessonLine(lesson('c', { confidence: 0.333 }))).toContain('(confidence 0.33,');
  });

  it('counts tasks by distinct sources when carried, by usage_count otherwise', () => {
    expect(lessonTaskCount(lesson('s', { usage_count: 9, sources: ['a', 'b'] }))).toBe(2);
    expect(lessonTaskCount(lesson('u', { usage_count: 4 }))).toBe(4);
    expect(lessonLine(lesson('one', { usage_count: 1 }))).toContain('from 1 task, lesson one)');
    expect(lessonLine(lesson('two', { usage_count: 2 }))).toContain('from 2 tasks, lesson two)');
  });
});
