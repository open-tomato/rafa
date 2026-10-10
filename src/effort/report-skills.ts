/**
 * The data of `rafa effort report --skills`: per plan, and per resolver
 * within a plan, which skills and lessons co-occurred with a recurrence of
 * the failure they should prevent. The text tables are
 * `report-skills-format.ts`'s; this module answers {@link SkillsReport},
 * which is also the command's JSON data.
 *
 * {@link buildSkillsReport} reads three things and nothing else:
 *
 *   - the fact rows `readSkillFacts` answers for the store under the repo
 *     root, one per task session, narrowed to `plans` when named;
 *   - each skill's `failure_strings:`, read from the `SKILL.md` of every
 *     skill the resolved tiers serve ({@link failureStringsOf});
 *   - each held lesson's `artifact`, by id ({@link lessonArtifactsOf}),
 *     from both instinct scopes ({@link readHeldLessons}).
 *
 * No session transcript is opened, which keeps the stance of
 * `session-log.ts`. Everything past the reading is
 * {@link skillsReportOf}, which is pure. The report shows co-occurrence
 * and never claims a cause: a signal is `skill-signals.ts`'s, defined
 * there once, and this module only groups the rows it is handed.
 *
 * ## Failure strings are read at report time
 *
 * A skill's strings come from the tiers as they resolve when the report
 * runs, not from when the plan ran: a skill no tier serves now (switched
 * off, unloaded, or a collision nobody serves) declares none, and so does
 * a plugin's `plugin:name`, which `resolveTiers` leaves out. A served
 * skill's `failure_strings` is read straight from its frontmatter
 * mapping, each entry that is a non-empty string kept, so a skill whose
 * other fields the v2 checker refuses still declares its strings; a file
 * that cannot be read, or holds no frontmatter, declares none. Names are
 * the tiers' bare names, which is how `readSkillFacts` reads a served
 * rafa skill under `bareSkillName`.
 *
 * ## Lessons are resolved through the held set
 *
 * A lesson id in `lessons_offered` is the id of a record in the blessed
 * bundle the run pulled, which the local adapter takes from the project's
 * `.rafa/instincts/` and the user's `~/.rafa/instincts/`. Both scopes are
 * read, nearest first, and an id both hold takes the project's record,
 * as a bundle does. A record that does not parse is skipped, and an id no
 * scope holds any longer reads a null artifact and the signal `injected`,
 * as `lessonSignals` answers it.
 *
 * ## Plans and resolvers
 *
 * One {@link SkillsReportPlan} per plan the rows hold, in the order
 * `readSkillFacts` answers them; a report under no plan is its own entry
 * with a null `planStub`. Within a plan, one {@link SkillsReportArm} per
 * resolver the rows ran under, in the order first seen; a null resolver,
 * not recorded or no resolver run, is an arm of its own. A plan run
 * under one resolver has one arm, which is the whole plan.
 *
 * Each arm's signals are `skillSignals` and `lessonSignals` over the
 * arm's rows, so every tally is the arm's. The recurrence search is not:
 * "then recurred" means the task's own or any later task of the PLAN,
 * whatever resolver ran it, so the arm's matcher maps each row back to
 * its index in the whole plan and searches there. A plan split half
 * `planner`, half `tag` would otherwise leave a `planner` task's
 * recurrence in a later `tag` task unsearched.
 *
 * `planCi` is the plan's latest CI reading by `readAt`, labelled plan CI
 * by the formatter and never counted per task or per arm; the last
 * written wins a tie. Recurrences search the failing names of every
 * reading, as `findRecurrences` does.
 *
 * ## M1 and M2
 *
 * Per arm, as `docs/skills-measurement.md` defines them:
 *
 * | Metric | Numerator | Denominator |
 * | --- | --- | --- |
 * | `m1` | distinct (task line, skill) pairs where the skill was invoked | distinct task lines |
 * | `m2` | (session, skill) pairs the session was offered and invoked | (session, skill) pairs offered |
 *
 * A row whose invocations are `unknown` is left out of both sides of
 * both, and counted in the arm's `unknownSessions`: it is never read as
 * a session that invoked nothing, as `readSkillFacts` insists. That
 * departs from the protocol's SQL, whose M1 denominator counts every
 * dispatched task line. A row whose invocations read `[]` is counted as
 * a session that invoked nothing, which is also how a session
 * `effort collect` has not yet read looks. M1 counts any invoked skill,
 * offered or not; M2 only an offered one. `percent` is the unrounded
 * ratio times 100, or null when the denominator is 0.
 */
import type { SkillResolverName } from '../config-sections.js';
import type { SkillFact } from './skill-facts.js';
import type { LessonSignalRow, RecurrenceMatcher, SkillSignalRow, SkillTally } from './skill-signals.js';
import type { TierSeams } from '../schema/tiers.js';
import type { Resolution } from '../tiers/resolve.js';
import type { PlanCiRow } from './store/plan-ci.js';

import { readFileSync } from 'node:fs';

import { readFrontmatter } from '../schema/frontmatter.js';
import { readScopes } from '../schema/scope-records.js';

import { findRecurrences } from './recurrence.js';
import { readSkillFacts } from './skill-facts.js';
import { lessonSignals, skillSignals } from './skill-signals.js';
import { UNKNOWN_SKILL_COUNT } from './store/skill-invocations.js';

/** The frontmatter key a skill declares its failure strings under. */
export const FAILURE_STRINGS_KEY = 'failure_strings';

/** One ratio of the measurement protocol. See the module note. */
export interface SkillsMetric {
  readonly numerator: number;
  readonly denominator: number;
  /** `numerator / denominator * 100`, unrounded; null when `denominator` is 0. */
  readonly percent: number | null;
}

/** One resolver's rows of one plan, and what they hold. */
export interface SkillsReportArm {
  /** The resolver the rows ran under; null when not recorded or none ran. */
  readonly resolver: SkillResolverName | null;
  /** Its task sessions: fact rows. */
  readonly sessions: number;
  /** Its sessions whose invocations are `unknown`, left out of M1 and M2. */
  readonly unknownSessions: number;
  /** Every skill its rows offered, with its signal. */
  readonly skills: readonly SkillSignalRow[];
  /** Every skill its rows invoked and never offered, with no signal. */
  readonly neverOffered: readonly SkillTally[];
  /** Every lesson its rows injected, with its signal. */
  readonly lessons: readonly LessonSignalRow[];
  /** Skill references per task. */
  readonly m1: SkillsMetric;
  /** Uptake of offered skills. */
  readonly m2: SkillsMetric;
}

/** One plan of the report. */
export interface SkillsReportPlan {
  /** The plan's stub; null for the reports dispatched under no plan. */
  readonly planStub: string | null;
  /** Its task sessions: fact rows. */
  readonly sessions: number;
  /** Its latest CI reading, plan CI, never a task's; null when none was read. */
  readonly planCi: PlanCiRow | null;
  /** One arm per resolver, in the order first seen; one for a plan run under one. */
  readonly resolvers: readonly SkillsReportArm[];
}

/** The data of `rafa effort report --skills`, and its JSON. See the module note. */
export interface SkillsReport {
  /** One entry per plan the store's rows hold, narrowed to the plans named. */
  readonly plans: readonly SkillsReportPlan[];
}

/** A held lesson, as the report resolves an offered id. */
export interface HeldLesson {
  readonly id: string;
  /** The byte string a recurrence matches on, or null when it holds none. */
  readonly artifact: string | null;
}

/** Reads a file's text, or null when it cannot be read. */
export type ReadSkillText = (path: string) => string | null;

/** What {@link buildSkillsReport} reads. */
export interface SkillsReportInput {
  /** The repo root the effort store sits under. */
  readonly repoRoot: string;
  /** The plan stubs to read; every plan when left out. */
  readonly plans?: readonly string[];
  /** The tiers as they resolve now; `resolveSessionTiers` answers one. */
  readonly resolution: Resolution;
  /** The held lessons, nearest scope first; {@link readHeldLessons} answers them. */
  readonly lessons: readonly HeldLesson[];
  /** Reads a skill file. Defaults to the disk. */
  readonly readText?: ReadSkillText;
}

/** A file's text, or null when it cannot be read. */
function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** The non-empty strings a frontmatter's `failure_strings` lists; none for anything else. */
function declaredStrings(text: string | null): readonly string[] {
  const data = text === null
    ? null
    : readFrontmatter(text);
  const value = data?.[FAILURE_STRINGS_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry !== '');
}

/**
 * Each skill the resolution serves, by bare name, mapped to the failure
 * strings its file declares. A skill that declares none is left out.
 * See the module note.
 */
export function failureStringsOf(
  resolution: Resolution,
  readText: ReadSkillText = readTextFile,
): ReadonlyMap<string, readonly string[]> {
  const declared = new Map<string, readonly string[]>();
  for (const item of resolution.items) {
    if (item.kind !== 'skill' || item.state !== 'served') continue;
    const strings = declaredStrings(readText(item.winner.path));
    if (strings.length > 0) declared.set(item.name, strings);
  }
  return declared;
}

/**
 * Each held lesson's artifact by id, the first holder of an id winning.
 * A lesson with no artifact is left out.
 */
export function lessonArtifactsOf(lessons: readonly HeldLesson[]): ReadonlyMap<string, string> {
  const artifacts = new Map<string, string>();
  const seen = new Set<string>();
  for (const { id, artifact } of lessons) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (artifact !== null) artifacts.set(id, artifact);
  }
  return artifacts;
}

/**
 * Every record held in the project and user instinct scopes that parses,
 * nearest scope first, by its frontmatter id. See the module note.
 */
export function readHeldLessons(seams: TierSeams): HeldLesson[] {
  return readScopes(seams).flatMap((listing) => listing.records.flatMap(({ instinct }) => (instinct === null
    ? []
    : [{ id: instinct.id, artifact: instinct.artifact }])));
}

/** `values` grouped by `key`, each group in the order given, the groups in the order first seen. */
function groupBy<T, K>(values: readonly T[], key: (value: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const value of values) {
    const group = groups.get(key(value)) ?? [];
    groups.set(key(value), [...group, value]);
  }
  return groups;
}

/** A ratio of `numerator` over `denominator`. */
function metric(numerator: number, denominator: number): SkillsMetric {
  return {
    numerator,
    denominator,
    percent: denominator === 0
      ? null
      : (numerator / denominator) * 100,
  };
}

/** The skills a row with known invocations invoked, each once. */
function invokedNames(fact: SkillFact): readonly string[] {
  return fact.invoked === UNKNOWN_SKILL_COUNT
    ? []
    : [...new Set(fact.invoked.map(({ name }) => name))];
}

/** M1 over the rows whose invocations are known. */
function m1Of(known: readonly SkillFact[]): SkillsMetric {
  const pairs = new Set(known.flatMap((fact) => invokedNames(fact).map((name) => JSON.stringify([fact.taskLine, name]))));
  return metric(pairs.size, new Set(known.map(({ taskLine }) => taskLine)).size);
}

/** M2 over the rows whose invocations are known. */
function m2Of(known: readonly SkillFact[]): SkillsMetric {
  const offered = known.flatMap((fact) => [...new Set(fact.skillsOffered ?? [])].map((name) => ({ fact, name })));
  const taken = offered.filter(({ fact, name }) => invokedNames(fact).includes(name));
  return metric(taken.length, offered.length);
}

/**
 * The matcher an arm's signals run with: each row of the arm searched
 * from its index in the whole plan. See the module note.
 */
function planMatcher(planFacts: readonly SkillFact[]): RecurrenceMatcher {
  const indices = new Map(planFacts.map((fact, index) => [fact, index]));
  return (strings, facts, fromIndex, planCi) => {
    const row = facts[fromIndex];
    const index = row === undefined
      ? undefined
      : indices.get(row);
    if (index === undefined) {
      throw new RangeError(`skills report: fromIndex ${fromIndex} is not a row of the plan's ${planFacts.length}`);
    }
    return findRecurrences(strings, planFacts, index, planCi);
  };
}

/** One resolver's arm of a plan. */
function armOf(
  resolver: SkillResolverName | null,
  facts: readonly SkillFact[],
  match: RecurrenceMatcher,
  failureStrings: ReadonlyMap<string, readonly string[]>,
  artifacts: ReadonlyMap<string, string>,
): SkillsReportArm {
  const known = facts.filter((fact) => fact.invoked !== UNKNOWN_SKILL_COUNT);
  const { skills, neverOffered } = skillSignals(facts, match, failureStrings);
  return {
    resolver,
    sessions: facts.length,
    unknownSessions: facts.length - known.length,
    skills,
    neverOffered,
    lessons: lessonSignals(facts, match, artifacts),
    m1: m1Of(known),
    m2: m2Of(known),
  };
}

/** The latest of `readings` by `readAt`, the last written winning a tie; null for none. */
function latestReading(readings: readonly PlanCiRow[]): PlanCiRow | null {
  return readings.reduce<PlanCiRow | null>((latest, reading) => (latest === null || reading.readAt >= latest.readAt
    ? reading
    : latest), null);
}

/**
 * The report over `facts`, as `readSkillFacts` answers them: grouped by
 * plan, then by resolver. `failureStrings` maps a skill's bare name to
 * its strings, `artifacts` a lesson's id to its artifact. Pure; see the
 * module note.
 */
export function skillsReportOf(
  facts: readonly SkillFact[],
  failureStrings: ReadonlyMap<string, readonly string[]>,
  artifacts: ReadonlyMap<string, string>,
): SkillsReport {
  const plans = [...groupBy(facts, ({ planStub }) => planStub)].map(([planStub, planFacts]) => {
    const match = planMatcher(planFacts);
    const arms = [...groupBy(planFacts, ({ resolver }) => resolver)];
    return {
      planStub,
      sessions: planFacts.length,
      planCi: latestReading(planFacts[0]?.planCi ?? []),
      resolvers: arms.map(([resolver, armFacts]) => armOf(resolver, armFacts, match, failureStrings, artifacts)),
    };
  });
  return { plans };
}

/**
 * The `--skills` report over the store under `input.repoRoot`, read
 * through `readSkillFacts`, with each skill's failure strings from the
 * resolved tiers and each lesson's artifact from the held set. Throws
 * when the store exists and cannot be read. See the module note.
 */
export function buildSkillsReport(input: SkillsReportInput): SkillsReport {
  const facts = readSkillFacts(input.repoRoot, input.plans);
  return skillsReportOf(
    facts,
    failureStringsOf(input.resolution, input.readText ?? readTextFile),
    lessonArtifactsOf(input.lessons),
  );
}
