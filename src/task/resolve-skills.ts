/**
 * The skills a task is handed at dispatch, chosen by one of three
 * resolvers: `planner`, `tag` and `none`.
 *
 * `.rafa/specs/rafa-23-right-skills-reach-right.md` ("Resolvers") sets
 * the contract. A {@link SkillResolver} takes one task and the run's
 * tier resolution (`resolveTiers` in `tiers/resolve.ts`) and answers the
 * skills to offer, in the order the section lists them. It takes no argv
 * and no config object, so #71's layer 2 can move it onto #119's step
 * contract as `task/resolve-skills` unchanged. Which resolver runs is
 * `task.skills` (`SKILL_RESOLVERS` in `config-sections.ts`), and the
 * name is recorded on the dispatch, never printed into the prompt.
 *
 * ## What a resolver may offer
 *
 * Only a skill a loop session will see: the `served` skills of the
 * resolution, minus a winner the inventory reads as `disabled:<how>`.
 * That is exactly the list the planner's index shows
 * (`indexedSkills` in `task/skill-index.ts`), so the planner can only
 * name what a resolver can hand out, and the control arm ranks over the
 * same set. A name that resolves `off`, `unloaded` or `collision` is
 * never offered. `plan validate` and `loop start`'s preflight already
 * refuse a `skills=` naming one; a resolver meeting it anyway drops it
 * rather than failing a task.
 *
 * ## The three resolvers
 *
 *   - {@link plannerResolver}: the task's `skills=` names, in the order
 *     the declaration carried them, each matched to a served skill by
 *     its bare name. A task declaring none gets none.
 *   - {@link tagResolver}: the control arm, run with no model. It ignores
 *     `skills=`, ranks every offerable skill against the task text and
 *     its stage context with `rankCandidates` (`inventory/search/rank.ts`)
 *     and keeps the top {@link TAG_LIMIT} scoring above
 *     {@link RANK_FLOOR}. A tie keeps the index order: tier, then name.
 *   - {@link noneResolver}: nothing, the "before" condition.
 *
 * ## The floor
 *
 * {@link RANK_FLOOR} is the score a ranked item has to beat. It is zero:
 * a score above it means at least one question word matched at least
 * one field, which is what `rankCandidates` itself keeps. It is a named
 * constant so this resolver and `selectLessons` read one number, and a
 * later measurement can raise it in one place.
 *
 * ## Reading the files
 *
 * The ranker scores a skill's whole `description` and its body, which a
 * resolution row does not carry, so {@link tagResolverWith} reads each
 * winner's file through `readRankCandidate` and its `read` seam. The
 * default {@link tagResolver} reads the disk; a file that does not read
 * still ranks on its row's own fields, as `rank.ts` says. The other two
 * resolvers read nothing.
 *
 * ## What is offered
 *
 * A {@link ResolvedSkill} carries the skill's bare name, its winner's
 * tier and path, and its winner's one-line `summary` (the description
 * cut by `summarize` in `inventory/record.ts`), so the section reads the
 * same line whichever resolver chose the skill. Turning the bare name
 * into the one the session invokes (`sessionSkillName`) is the section
 * renderer's job, not a resolver's.
 */
import type { SkillResolverName } from '../config-sections.js';
import type { InventoryRecord, InventorySource } from '../inventory/record.js';
import type { RankCandidate } from '../inventory/search/rank.js';
import type { Resolution, ServedItem, TierRow } from '../tiers/resolve.js';

import { rankCandidates, readRankCandidate } from '../inventory/search/rank.js';

import { indexedSkills } from './skill-index.js';

/**
 * The score a ranked skill or lesson trigger has to beat to be kept:
 * above zero, so at least one word matched. See "The floor".
 */
export const RANK_FLOOR = 0;

/** How many skills the `tag` resolver keeps at most. */
export const TAG_LIMIT = 3;

/** One task as a resolver reads it. */
export interface TaskInput {
  /** The task sentence, its declaration taken off (`PlanTask.text`). */
  readonly text: string;
  /** The names its `skills=` carried, in order, empty when it declared none. */
  readonly skills: readonly string[];
  /** The body of its stage's `rafa:stage-context` block, or null without one. */
  readonly stageContext: string | null;
}

/** One skill a resolver offers the task. */
export interface ResolvedSkill {
  /** The bare name, as plans and `skills=` write it. */
  readonly name: string;
  /** The tier its served winner comes from. */
  readonly source: InventorySource;
  /** Absolute path of the winner's definition file. */
  readonly path: string;
  /** The winner's one-line description, empty when it has none. See "What is offered". */
  readonly description: string;
}

/** Chooses the skills to offer `task` from `resolution`. Pure; see the module note. */
export type SkillResolver = (task: TaskInput, resolution: Resolution) => readonly ResolvedSkill[];

/** Reads a definition file as UTF-8 text, throwing when it cannot. */
export type ReadSkillFile = (path: string) => string;

/** The winner's own `summary`, when the row carries one. */
function summaryOf(row: TierRow): string {
  const { summary } = row as TierRow & { readonly summary?: unknown };
  return typeof summary === 'string'
    ? summary
    : '';
}

/** What a served skill is offered as. */
function offered(item: ServedItem): ResolvedSkill {
  return {
    name: item.name,
    source: item.winner.source,
    path: item.winner.path,
    description: summaryOf(item.winner),
  };
}

/**
 * The winner as an inventory record, the shape the ranker reads. A row
 * that carries the frontmatter fields keeps them; a bare `TierRow` ranks
 * as a name with nothing to match.
 */
function asRecord(row: TierRow): InventoryRecord {
  return {
    summary: '',
    whenToUse: null,
    prevents: null,
    stack: [],
    tags: [],
    check: null,
    state: 'enabled',
    visibleToLoop: true,
    ...row,
  };
}

/** The `planner` resolver: the task's `skills=`, by name. See "The three resolvers". */
export const plannerResolver: SkillResolver = (task, resolution) => {
  const byName = new Map(indexedSkills(resolution).map((item) => [item.name, item]));
  return [...new Set(task.skills)].flatMap((name) => {
    const item = byName.get(name);
    return item === undefined
      ? []
      : [offered(item)];
  });
};

/**
 * The `tag` resolver reading each winner's file through `read`. See
 * "The three resolvers" and "Reading the files".
 */
export function tagResolverWith(read?: ReadSkillFile): SkillResolver {
  return (task, resolution) => {
    const items = indexedSkills(resolution);
    const byPath = new Map(items.map((item) => [item.winner.path, item]));
    const candidates: readonly RankCandidate[] = items
      .map((item) => readRankCandidate(asRecord(item.winner), read));
    const question = [task.text, task.stageContext ?? ''].join('\n');

    return rankCandidates(question, candidates, candidates.length)
      .filter((ranked) => ranked.score > RANK_FLOOR)
      .slice(0, TAG_LIMIT)
      .flatMap((ranked) => {
        const item = byPath.get(ranked.record.path);
        return item === undefined
          ? []
          : [offered(item)];
      });
  };
}

/** The `tag` resolver, reading the disk. */
export const tagResolver: SkillResolver = tagResolverWith();

/** The `none` resolver: nothing. */
export const noneResolver: SkillResolver = () => [];

/** Each resolver `task.skills` may name. */
export const SKILL_RESOLVER_BY_NAME: Readonly<Record<SkillResolverName, SkillResolver>> = {
  planner: plannerResolver,
  tag: tagResolver,
  none: noneResolver,
};
