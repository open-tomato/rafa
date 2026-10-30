/**
 * The blessed lessons a task is handed at dispatch.
 *
 * `.rafa/specs/rafa-23-right-skills-reach-right.md` ("Resolvers") sets
 * the contract. {@link selectLessons} takes one task, as the skill
 * resolvers read it ({@link TaskInput} in `task/resolve-skills.ts`), and
 * the blessed bundle the learning adapter's `pullBlessed` answers, and
 * returns the lessons to offer, in the order the section lists them. It
 * runs the same under every resolver, so the arms differ only in skills,
 * and it takes no argv and no config object, so #71's layer 2 can move
 * it onto #119's step contract as `task/select-lessons` unchanged.
 * Whether it runs at all is `task.lessons`, read by its caller.
 *
 * ## What is kept
 *
 * A lesson is kept when either reading matches:
 *
 *   - **Its artifact path.** The record's `artifact`, when it reads as a
 *     path (no whitespace, and a `/` or a `.` in it), is named in the task
 *     text or in its stage context. The name has to stand whole: no path
 *     character (a letter, digit, `_`, `-`, `/` or `.`) may touch it on
 *     either side, so `src/a.ts` is not named by `src/a.tsx` or
 *     `lib/src/a.ts`, while a sentence's closing period, a backtick or a
 *     bracket around it still names it. An artifact that is not
 *     path-shaped, such as an error message, never matches this way; it
 *     can only be kept by its trigger.
 *   - **Its trigger.** `scoreCandidate` (`inventory/search/rank.ts`)
 *     scores the trigger against the task text's `questionWords`, and at
 *     least {@link TRIGGER_WORD_FLOOR} distinct question words match it.
 *     The trigger is scored against the task text only, never the
 *     stage context: a stage context is shared by every task of its
 *     stage, and a trigger matching it would hand the same lesson to all
 *     of them.
 *
 * ## The trigger floor
 *
 * One shared word is not enough. Task texts are full of ordinary words
 * (`add`, `tests`, `refresh`) that triggers carry too, so a floor of one
 * matched word handed lessons to tasks naming nothing a lesson knows:
 * the lesson-door golden set (`addons/dyno`) measured
 * four lessons on its two abstention tasks, and ten extra lessons on
 * its eight answerable tasks. Every expected lesson there matches two
 * words or more, so a floor of two keeps all eight and hands the
 * abstention tasks nothing.
 *
 * The floor counts words, not score. A lesson's trigger is scored as one
 * field, `when_to_use`, so the score is the word count times that
 * field's weight; counting the words keeps the floor apart from
 * `FIELD_WEIGHTS`. It is not `RANK_FLOOR`, which the `tag` resolver reads
 * over five fields, where one score means something else.
 *
 * The bundle is taken as blessed: this module does not filter it again
 * by status, confidence or promotion. `bless` (`learning/bless.ts`) has
 * already done that, and a second filter here would be a second
 * spelling of the rule.
 *
 * ## The order and the cap
 *
 * The kept lessons are ordered by `confidence`, highest first; a tie
 * keeps the bundle's order. The first {@link LESSON_LIMIT} are
 * returned, so a bundle of many matching lessons cannot flood the
 * prompt.
 */
import type { TaskInput } from './resolve-skills.js';
import type { InventoryRecord } from '../inventory/record.js';
import type { RankCandidate } from '../inventory/search/rank.js';
import type { BlessedBundle, InstinctRecord } from '../learning/index.js';

import { questionWords, scoreCandidate } from '../inventory/search/rank.js';

/** How many lessons a task is handed at most. */
export const LESSON_LIMIT = 5;

/** How many distinct question words a trigger has to match; see "The trigger floor". */
export const TRIGGER_WORD_FLOOR = 2;

/** Whether `artifact` reads as a path; see "What is kept". */
export function isArtifactPath(artifact: string): boolean {
  return artifact !== '' && !/\s/.test(artifact) && /[/.]/.test(artifact);
}

/** `text` with every regular-expression metacharacter escaped. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether `text` names `path` whole: no path character touches it on
 * either side, a trailing `.` counting only when a path character
 * follows it. See "What is kept".
 */
export function namesPath(text: string, path: string): boolean {
  const pattern = new RegExp(
    `(?<![\\w./-])${escapeRegExp(path)}(?![\\w/-]|\\.[\\w/-])`,
    'u',
  );
  return pattern.test(text);
}

/** Whether `lesson`'s artifact path is named in the task or its stage context. */
function artifactMatches(lesson: InstinctRecord, task: TaskInput): boolean {
  const { artifact } = lesson;
  if (artifact === undefined || !isArtifactPath(artifact)) return false;

  return namesPath(task.text, artifact)
    || (task.stageContext !== null && namesPath(task.stageContext, artifact));
}

/**
 * The trigger as a candidate the ranker reads: the trigger is its
 * `when_to_use`, the field written to say when an item applies.
 */
function triggerCandidate(lesson: InstinctRecord): RankCandidate {
  const record: InventoryRecord = {
    kind: 'skill',
    name: lesson.id,
    source: 'rafa',
    path: '',
    summary: '',
    whenToUse: lesson.trigger,
    prevents: null,
    stack: [],
    tags: [],
    check: null,
    state: 'enabled',
    visibleToLoop: true,
  };
  return { record, description: null, body: '' };
}

/** Whether `lesson`'s trigger matches at least {@link TRIGGER_WORD_FLOOR} of `words`. */
function triggerMatches(lesson: InstinctRecord, words: readonly string[]): boolean {
  return scoreCandidate(triggerCandidate(lesson), words).words.length >= TRIGGER_WORD_FLOOR;
}

/**
 * The lessons of `bundle` to offer `task`: kept by artifact path or by
 * trigger, highest confidence first, at most {@link LESSON_LIMIT}.
 * Pure; see the module note.
 */
export function selectLessons(task: TaskInput, bundle: BlessedBundle): readonly InstinctRecord[] {
  const words = questionWords(task.text);
  const kept = bundle.instincts
    .filter((lesson) => artifactMatches(lesson, task) || triggerMatches(lesson, words));

  return [...kept]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, LESSON_LIMIT);
}
