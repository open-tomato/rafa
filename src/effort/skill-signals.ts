/**
 * The skill and lesson signals `rafa effort report --skills` shows,
 * defined once.
 *
 * Both readers are pure. {@link skillSignals} takes the fact rows
 * `readSkillFacts` answers, the recurrence matcher (`findRecurrences`)
 * and each skill's failure strings by bare name; {@link lessonSignals}
 * takes the rows, the matcher and each lesson's `artifact` by id. Neither
 * reads a path or a config, and neither claims a cause: a signal says
 * what co-occurred, never why.
 *
 * ## Skills
 *
 * A skill is read when a row's `skillsOffered` or its known `invoked`
 * names it. A skill some row offered gets exactly one signal, the first
 * of {@link SKILL_SIGNALS} that holds:
 *
 * | Signal | Holds when |
 * | --- | --- |
 * | `recurring` | a row invoked it and one of its failure strings then recurred |
 * | `unmeasured` | a row invoked it and it declares no failure strings |
 * | `earning` | a row invoked it, with no recurrence after any invocation |
 * | `ignored` | no row invoked it |
 *
 * "Then recurred" is what the matcher answers for the invoking row: its
 * own and each later row's findings, blockers and out-of-scope bugs in
 * the same plan, and the plan's failing check names. So `earning` means
 * only that no recurrence was seen. A skill missing from the map, or
 * mapped to `[]`, declares none.
 *
 * A skill no row offered, and some row invoked, gets no signal: it is in
 * the `neverOffered` listing, with its recurrences still counted. A plan
 * run under resolver `none` offers nothing, so every skill it invoked is
 * listed there. A `skillsOffered` of null, not recorded, offers nothing
 * either.
 *
 * ## Invocations are read, the claim is only counted
 *
 * The signals read `invoked`, what the session log shows, and never
 * `skillsUsed`, what the report says was used: the two are shown as two
 * columns and never merged. A skill only a report names, offered and
 * invoked by none, is in neither list.
 *
 * A row whose `invoked` is `unknown` is never read as a row that invoked
 * nothing. It counts towards the `unknown` of each skill it offered, and
 * no skill counts as invoked there. `ignored` claims that no row invoked
 * the skill, so an offered skill that no known row invoked, and some
 * `unknown` row offered, has a null signal: whether it was ignored
 * cannot be told.
 *
 * ## Lessons
 *
 * A lesson is read when a row's `lessonsOffered` names it; no tool call
 * marks a lesson applied, so "ignored" is never claimed for one. It is
 * `injected-recurring` when its `artifact` recurred after a row injected
 * it, and `injected` otherwise. An id the map does not hold, a lesson no
 * longer held or one held without an artifact, has a null artifact and
 * is `injected`.
 *
 * ## Tallies and order
 *
 * Every count is of rows, one per task session: a skill invoked twice in
 * one session counts once. A row's recurrence search is the matcher over
 * every row given, so a caller that splits a plan by resolver hands the
 * whole plan and filters the answer, or later rows under the other
 * resolver go unsearched. `matches` keeps each recurrence once, in the
 * order first found, although rows searched from two invocations answer
 * it twice. Skills and lessons come in the order a row first names them,
 * row by row, offers before invocations.
 */
import type { Recurrence } from './recurrence.js';
import type { SkillFact } from './skill-facts.js';
import type { PlanCiRow } from './store/plan-ci.js';

import { UNKNOWN_SKILL_COUNT } from './store/skill-invocations.js';

/** The skill signals, in the order they are checked. */
export const SKILL_SIGNALS = ['recurring', 'unmeasured', 'earning', 'ignored'] as const;

/** What a skill that was offered is read as. See the module note. */
export type SkillSignal = typeof SKILL_SIGNALS[number];

/** The lesson signals, in the order they are checked. */
export const LESSON_SIGNALS = ['injected-recurring', 'injected'] as const;

/** What an injected lesson is read as. See the module note. */
export type LessonSignal = typeof LESSON_SIGNALS[number];

/** The recurrence matcher's shape: `findRecurrences` in `recurrence.ts`. */
export type RecurrenceMatcher = (
  strings: readonly string[],
  facts: readonly SkillFact[],
  fromIndex: number,
  planCi: readonly PlanCiRow[],
) => Recurrence[];

/** What the rows hold about one skill. Every count is of rows. */
export interface SkillTally {
  /** The skill's bare name. */
  readonly name: string;
  /** Rows whose prompt offered it. */
  readonly offered: number;
  /** Rows whose known invocations name it. */
  readonly invoked: number;
  /** Rows that both offered and invoked it: the N of `invoked N/M` over `offered`. */
  readonly uptake: number;
  /** Rows whose report says it was used; never read by a signal. */
  readonly reported: number;
  /** Rows that offered it and whose invocations are `unknown`. */
  readonly unknown: number;
  /** Invoking rows after which one of its failure strings recurred. */
  readonly recurred: number;
  /** Each recurrence found from an invoking row, once, in the order first found. */
  readonly matches: readonly Recurrence[];
}

/** An offered skill and its signal; null when `ignored` cannot be told. */
export interface SkillSignalRow extends SkillTally {
  readonly signal: SkillSignal | null;
}

/** What {@link skillSignals} answers. */
export interface SkillSignals {
  /** Every skill some row offered, with its signal. */
  readonly skills: readonly SkillSignalRow[];
  /** Every skill some row invoked and no row offered, with no signal. */
  readonly neverOffered: readonly SkillTally[];
}

/** One injected lesson and its signal. Every count is of rows. */
export interface LessonSignalRow {
  /** The lesson's id. */
  readonly id: string;
  /** The artifact it was searched for, or null when the map holds none. */
  readonly artifact: string | null;
  /** Rows whose prompt offered it. */
  readonly injected: number;
  /** Injecting rows after which its artifact recurred. */
  readonly recurred: number;
  /** Each recurrence found from an injecting row, once, in the order first found. */
  readonly matches: readonly Recurrence[];
  readonly signal: LessonSignal;
}

/** The skills a row's log shows it invoked; none when the log is `unknown`. */
function invokedNames(fact: SkillFact): readonly string[] {
  return fact.invoked === UNKNOWN_SKILL_COUNT
    ? []
    : fact.invoked.map(({ name }) => name);
}

/** Each of `names` once, in the order first given. */
function unique(names: readonly string[]): string[] {
  return [...new Set(names)];
}

/** The number of rows `holds` holds for. */
function rowsWhere(facts: readonly SkillFact[], holds: (fact: SkillFact) => boolean): number {
  return facts.filter(holds).length;
}

/** The index of each row `holds` holds for. */
function indicesWhere(facts: readonly SkillFact[], holds: (fact: SkillFact) => boolean): number[] {
  return facts.flatMap((fact, index) => (holds(fact)
    ? [index]
    : []));
}

/** Every match of `strings` searched from each of `from`, and how many of those rows found one. */
function recurrencesFrom(
  strings: readonly string[],
  facts: readonly SkillFact[],
  from: readonly number[],
  match: RecurrenceMatcher,
): Pick<SkillTally, 'recurred' | 'matches'> {
  if (strings.length === 0) return { recurred: 0, matches: [] };
  const found = from.map((index) => match(strings, facts, index, facts[index]?.planCi ?? []));
  const matches = new Map<string, Recurrence>();
  for (const recurrence of found.flat()) {
    const { string, source, sessionId, field, text } = recurrence;
    const key = JSON.stringify([string, source, sessionId, field, text]);
    if (!matches.has(key)) matches.set(key, recurrence);
  }
  return {
    recurred: found.filter((answer) => answer.length > 0).length,
    matches: [...matches.values()],
  };
}

/** What the rows hold about the skill `name`. */
function tallySkill(
  name: string,
  facts: readonly SkillFact[],
  strings: readonly string[],
  match: RecurrenceMatcher,
): SkillTally {
  const offers = (fact: SkillFact): boolean => fact.skillsOffered?.includes(name) ?? false;
  const invokes = (fact: SkillFact): boolean => invokedNames(fact).includes(name);
  return {
    name,
    offered: rowsWhere(facts, offers),
    invoked: rowsWhere(facts, invokes),
    uptake: rowsWhere(facts, (fact) => offers(fact) && invokes(fact)),
    reported: rowsWhere(facts, (fact) => fact.skillsUsed?.includes(name) ?? false),
    unknown: rowsWhere(facts, (fact) => offers(fact) && fact.invoked === UNKNOWN_SKILL_COUNT),
    ...recurrencesFrom(strings, facts, indicesWhere(facts, invokes), match),
  };
}

/** The first signal that holds for an offered skill, in {@link SKILL_SIGNALS} order. */
function skillSignalOf(tally: SkillTally, declared: boolean): SkillSignal | null {
  if (tally.recurred > 0) return 'recurring';
  if (tally.invoked > 0 && !declared) return 'unmeasured';
  if (tally.invoked > 0) return 'earning';
  if (tally.unknown > 0) return null;
  return 'ignored';
}

/**
 * The signal of every skill `facts` offered, and the listing of every
 * skill they invoked and never offered. `failureStrings` maps a bare name
 * to its `failure_strings:`; `match` is `findRecurrences`. See the module
 * note.
 */
export function skillSignals(
  facts: readonly SkillFact[],
  match: RecurrenceMatcher,
  failureStrings: ReadonlyMap<string, readonly string[]>,
): SkillSignals {
  const names = unique(facts.flatMap((fact) => [...fact.skillsOffered ?? [], ...invokedNames(fact)]));
  const tallies = names.map((name) => tallySkill(name, facts, failureStrings.get(name) ?? [], match));
  return {
    skills: tallies
      .filter(({ offered }) => offered > 0)
      .map((tally) => ({
        ...tally,
        signal: skillSignalOf(tally, (failureStrings.get(tally.name) ?? []).length > 0),
      })),
    neverOffered: tallies.filter(({ offered }) => offered === 0),
  };
}

/**
 * The signal of every lesson `facts` injected. `artifacts` maps a
 * lesson's id to its `artifact`; `match` is `findRecurrences`. See the
 * module note.
 */
export function lessonSignals(
  facts: readonly SkillFact[],
  match: RecurrenceMatcher,
  artifacts: ReadonlyMap<string, string>,
): LessonSignalRow[] {
  const ids = unique(facts.flatMap((fact) => fact.lessonsOffered ?? []));
  return ids.map((id) => {
    const artifact = artifacts.get(id) ?? null;
    const injects = (fact: SkillFact): boolean => fact.lessonsOffered?.includes(id) ?? false;
    const found = recurrencesFrom(artifact === null
      ? []
      : [artifact], facts, indicesWhere(facts, injects), match);
    return {
      id,
      artifact,
      injected: rowsWhere(facts, injects),
      ...found,
      signal: found.recurred > 0
        ? 'injected-recurring'
        : 'injected',
    };
  });
}
