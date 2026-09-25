/**
 * What one task is handed beside the plan: the skills the run's resolver
 * chose and the blessed lessons `selectLessons` kept, as `dispatchTask`
 * (`start/dispatch.ts`) renders them into the prompt and carries them on
 * its `TaskDispatch`.
 *
 * `.rafa/specs/rafa-23-right-skills-reach-right.md` ("Resolvers") sets
 * the contract; the choosing itself is the pure functions under `task/`.
 * This module is the wiring around them: it reads the run's two keys,
 * builds the task as a resolver reads it, pulls the blessed bundle and
 * says when that pull failed.
 *
 * ## The two keys
 *
 * A {@link TaskHandout} is the run's `task.skills`, naming the resolver
 * (`SKILL_RESOLVER_BY_NAME` in `task/resolve-skills.ts`), and its
 * `task.lessons`. The resolver runs under every value, `none` included,
 * and its name is answered on {@link HandedOut.resolver} for the dispatch
 * row. It is never rendered: the sections `task/sections.ts` writes carry
 * no field naming it. Lessons are selected whatever the resolver, and
 * only under `task.lessons: on`; under `off` the adapter is not made at
 * all.
 *
 * ## The task as a resolver reads it
 *
 * {@link taskInputFor} answers the sentence the prompt quotes, the names
 * its `skills=` carried, and the body of its stage's `rafa:stage-context`
 * block. The stage is found as `plan/inject.ts` finds the task: by its
 * line in the plan, holding the same `task` there. A task the plan does
 * not hold at its line, or one above every stage heading, has no stage
 * context, and is still resolved on its text and its `skills=`.
 *
 * ## The lessons pull
 *
 * The bundle comes from the adapter `learning.adapter` names, through
 * `pullBlessed`, once per call, so once per dispatch. A kind no registry
 * holds, an adapter that cannot be made and a refused pull are one
 * warning each and hand out no lesson: the task is dispatched as it would
 * have been with nothing to offer, and is never failed for it. A null
 * `learning` pulls nothing and warns nothing, which a test driving the
 * dispatch alone names.
 */
import type { LessonSwitch, SkillResolverName } from '../config-sections.js';
import type { TaskLearning } from './dispatch.js';
import type { BlessedBundle, InstinctRecord } from '../learning/index.js';
import type { Learning } from '../ports/index.js';
import type { ResolvedSkill, TaskInput } from '../task/resolve-skills.js';
import type { Resolution } from '../tiers/resolve.js';
import type { TaskDeclaration } from '../utils/declaration.js';
import type { TaskInfo } from '../utils/tracker.js';

import { activeOutput } from '../adapters/output/active.js';
import { CORE_ADAPTER_REGISTRY } from '../adapters/registry.js';
import { parsePlan } from '../plan/index.js';
import { SKILL_RESOLVER_BY_NAME } from '../task/resolve-skills.js';
import { selectLessons } from '../task/select-lessons.js';

/** The run's two `task.*` keys and where its lessons are pulled from. See "The two keys". */
export interface TaskHandout {
  /** The run's `task.skills`: the resolver that picks the task's skills. */
  readonly resolver: SkillResolverName;
  /** The run's `task.lessons`: whether blessed lessons are selected at all. */
  readonly lessons: LessonSwitch;
  /**
   * The adapter the blessed bundle is pulled from, the one the run's
   * reports are pushed to. Null pulls nothing; see "The lessons pull".
   */
  readonly learning: TaskLearning | null;
}

/** What one task was handed. */
export interface HandedOut {
  /** The resolver that chose {@link skills}, or null when nothing was chosen at all. */
  readonly resolver: SkillResolverName | null;
  /** The skills offered, in the order the section lists them. */
  readonly skills: readonly ResolvedSkill[];
  /** The lessons offered, in the order the section lists them. */
  readonly lessons: readonly InstinctRecord[];
}

/** Nothing handed out and no resolver run: a dispatch with a null {@link TaskHandout}. */
export const NOTHING_HANDED_OUT: HandedOut = { resolver: null, skills: [], lessons: [] };

/** A resolution holding no tier and no item: what a dispatch that read no tiers resolves against. */
export const EMPTY_RESOLUTION: Resolution = { loadedTiers: [], items: [], collisions: [] };

/**
 * The run's Learning adapter at `repoRoot`: the kind resolved in its
 * registry, made at the run's home and bless floor. Throws when no
 * adapter has the kind or it cannot be made.
 */
export function taskLearningAdapter(learning: TaskLearning, repoRoot: string): Learning {
  const registry = learning.registry ?? CORE_ADAPTER_REGISTRY;
  return registry.resolve('learning', learning.kind).create({
    repoRoot,
    home: learning.home,
    learningBlessMinConfidence: learning.blessMinConfidence,
  });
}

/** The body of the stage context over the task at `taskInfo`'s line in `planContent`, or null. */
function stageContextOf(taskInfo: Pick<TaskInfo, 'task' | 'lineNum'>, planContent: string): string | null {
  const model = parsePlan(planContent);
  const task = model.tasks.find((candidate) => candidate.lineNum === taskInfo.lineNum);
  if (task === undefined || task.task !== taskInfo.task || task.stage === null) return null;
  return model.stages[task.stage]?.context ?? null;
}

/**
 * The task as a resolver reads it: `text`, its declaration's `skills=`
 * and its stage context in `planContent`. See "The task as a resolver
 * reads it".
 */
export function taskInputFor(
  taskInfo: Pick<TaskInfo, 'task' | 'lineNum'>,
  text: string,
  declaration: TaskDeclaration | null,
  planContent: string,
): TaskInput {
  return {
    text,
    skills: declaration?.skills ?? [],
    stageContext: stageContextOf(taskInfo, planContent),
  };
}

/** An error's message, or the thrown value itself when it is no error. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** The blessed bundle `learning` answers, or null, warned about, when it answers none. */
async function pullBundle(learning: TaskLearning, repoRoot: string): Promise<BlessedBundle | null> {
  try {
    return await taskLearningAdapter(learning, repoRoot).pullBlessed();
  } catch (error) {
    activeOutput().warn(`   Lessons: none handed to this task: the \`${learning.kind}\` learning adapter answered no blessed set: ${messageOf(error)}`);
    activeOutput().warn('   The task is not failed for it: it is dispatched without a lessons section.');
    return null;
  }
}

/** The lessons `handout` hands `task`; see "The two keys" and "The lessons pull". */
async function lessonsFor(handout: TaskHandout, task: TaskInput, repoRoot: string): Promise<readonly InstinctRecord[]> {
  if (handout.lessons === 'off' || handout.learning === null) return [];
  const bundle = await pullBundle(handout.learning, repoRoot);
  return bundle === null
    ? []
    : selectLessons(task, bundle);
}

/**
 * What `handout` hands `task`: the skills its resolver chose from
 * `resolution` and the lessons `selectLessons` kept from the run's
 * blessed bundle. A null `handout` hands nothing and runs no resolver.
 * Never throws for the lessons pull; see the module note.
 */
export async function handOut(
  handout: TaskHandout | null,
  task: TaskInput,
  resolution: Resolution,
  repoRoot: string,
): Promise<HandedOut> {
  if (handout === null) return NOTHING_HANDED_OUT;
  const skills = SKILL_RESOLVER_BY_NAME[handout.resolver](task, resolution);
  const lessons = await lessonsFor(handout, task, repoRoot);
  return { resolver: handout.resolver, skills, lessons };
}
