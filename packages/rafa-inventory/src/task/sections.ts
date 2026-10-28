/**
 * The two prompt sections a task is handed at dispatch:
 * `## Skills for this task` and `## Lessons from earlier tasks`.
 *
 * `.rafa/specs/rafa-23-right-skills-reach-right.md` ("Prompt sections")
 * sets the format, which is the same whichever resolver chose the
 * skills:
 *
 *     ## Skills for this task
 *     Invoke each with the Skill tool before you change anything it covers.
 *     - `git-workflow`: Use when pushing a branch, opening or updating a PR, …
 *
 *     ## Lessons from earlier tasks
 *     - When <trigger>: <action> (confidence 0.70, from 3 tasks, lesson <id>)
 *
 * Both renderers are pure: they read the list they are given and nothing
 * else, take no argv and no config object, and never name the resolver
 * that made the list, so a session cannot tell which arm it is in.
 *
 * ## Nothing to hand out
 *
 * An empty list renders as the empty string, not as a heading with no
 * lines under it. The caller leaves an empty section out of the prompt,
 * so a task with nothing to hand out gets the prompt it got before.
 *
 * ## A skill line
 *
 * `` - `<name>`: <description> ``. The name is the one the session
 * invokes, `sessionSkillName` (`tiers/skill-names.ts`) over the bare
 * name a resolver answers, under the delivery given, which defaults to
 * `SKILL_DELIVERY`. The description is the winner's one-line summary a
 * {@link ResolvedSkill} carries; a skill with none reads `` - `<name>` ``,
 * with no colon.
 *
 * ## A lesson line
 *
 * `- When <trigger>: <action> (confidence <c>, from <n> tasks, lesson <id>)`.
 *
 *   - The trigger loses a leading `when` of its own, whatever its case,
 *     so a finding's `when running bun test` reads `When running bun
 *     test` and not `When when running bun test`.
 *   - The confidence is written with two decimals.
 *   - The task count is the record's distinct `sources` when it carries
 *     them, and its `usage_count` otherwise: `InstinctRecord` says the
 *     two are equal once `sources` exists, and a record written before
 *     sources were kept has only the count. One reads `from 1 task`.
 *
 * In both sections a field's whitespace runs are collapsed to one space,
 * so a multi-line description, trigger or action cannot break a line out
 * of its list.
 */
import type { ResolvedSkill } from './resolve-skills.js';
import type { InstinctRecord } from '../learning/index.js';
import type { SkillDelivery } from '../tiers/delivery.js';

import { SKILL_DELIVERY } from '../tiers/delivery.js';
import { sessionSkillName } from '../tiers/skill-names.js';

/** The heading of the skills section. */
export const SKILLS_HEADING = '## Skills for this task';

/** The line under {@link SKILLS_HEADING}, before the skills. */
export const SKILLS_INSTRUCTION = 'Invoke each with the Skill tool before you change anything it covers.';

/** The heading of the lessons section. */
export const LESSONS_HEADING = '## Lessons from earlier tasks';

/** `text` on one line: whitespace runs collapsed, trimmed. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The list line for one offered skill. See "A skill line". */
export function skillLine(skill: ResolvedSkill, delivery: SkillDelivery = SKILL_DELIVERY): string {
  const name = `\`${sessionSkillName(skill.name, delivery)}\``;
  const description = oneLine(skill.description);
  return description === ''
    ? `- ${name}`
    : `- ${name}: ${description}`;
}

/**
 * The `## Skills for this task` section over `skills`, in their order,
 * or the empty string when there are none. See the module note.
 */
export function renderSkillsSection(
  skills: readonly ResolvedSkill[],
  delivery: SkillDelivery = SKILL_DELIVERY,
): string {
  if (skills.length === 0) return '';
  return [SKILLS_HEADING, SKILLS_INSTRUCTION, ...skills.map((skill) => skillLine(skill, delivery))]
    .join('\n');
}

/** The trigger without a leading `when` of its own. See "A lesson line". */
function triggerClause(trigger: string): string {
  return oneLine(trigger).replace(/^when\b\s*/i, '');
}

/** How many tasks confirmed `lesson`. See "A lesson line". */
export function lessonTaskCount(lesson: InstinctRecord): number {
  return lesson.sources === undefined
    ? lesson.usage_count
    : lesson.sources.length;
}

/** The list line for one lesson. See "A lesson line". */
export function lessonLine(lesson: InstinctRecord): string {
  const count = lessonTaskCount(lesson);
  const tasks = count === 1
    ? '1 task'
    : `${count} tasks`;
  const evidence = `confidence ${lesson.confidence.toFixed(2)}, from ${tasks}, lesson ${lesson.id}`;
  return `- When ${triggerClause(lesson.trigger)}: ${oneLine(lesson.action)} (${evidence})`;
}

/**
 * The `## Lessons from earlier tasks` section over `lessons`, in their
 * order, or the empty string when there are none. See the module note.
 */
export function renderLessonsSection(lessons: readonly InstinctRecord[]): string {
  if (lessons.length === 0) return '';
  return [LESSONS_HEADING, ...lessons.map(lessonLine)].join('\n');
}
