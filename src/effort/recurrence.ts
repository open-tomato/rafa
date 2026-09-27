/**
 * The recurrence matcher behind `rafa effort report --skills`: where a
 * failure string turns up again in text rafa already stores.
 *
 * A skill's failure strings are its `failure_strings:`; a lesson's is its
 * `artifact`. {@link findRecurrences} is pure: it takes the strings, the
 * fact rows `readSkillFacts` answers and the plan's CI readings, never a
 * path or a config, and no session transcript is ever searched.
 *
 * ## What counts as a recurrence
 *
 * A failure string recurs when it appears, as a case-sensitive literal
 * (`String.prototype.includes`, no folding, no pattern), in any of:
 *
 * | Source | Searched in | Fields |
 * | --- | --- | --- |
 * | `finding` | the task's own and each later task's | `trigger`, `what`, `cause`, `artifact` |
 * | `blocker` | the task's own and each later task's | `what`, `artifact` |
 * | `out-of-scope-bug` | the task's own and each later task's | `what`, `artifact` |
 * | `plan-ci` | the plan's failing check names | `failing` |
 *
 * The task is the fact row at `fromIndex`. A later task is a row after it
 * in `facts` under the same plan stub: `facts` is in `task_reports.seq`
 * order within a plan, as `readSkillFacts` answers it, and a row of
 * another plan is skipped wherever it sits. A task under no plan has no
 * later task and no plan CI, so only its own rows are searched. An
 * earlier task is never searched.
 *
 * A finding's `resolution` and `signal` are not searched: the resolution
 * names the cure, which a skill's failure string may well quote, and the
 * signal is a closed word. A NULL field, as on a row a filed issue
 * inserted, matches nothing.
 *
 * The plan's failing check names are the union over every reading of the
 * plan in `planCi`, each name once. A reading of another plan is skipped,
 * so a caller may hand every reading the store holds.
 *
 * ## What a match answers
 *
 * Each match names the failure string, the source, the session and task
 * line it was found in (null for plan CI, which is never counted per
 * task), the field, and the matched text: the field's whole value, which
 * the report shows beside the string.
 *
 * Matches come in search order: task by task from `fromIndex`, within a
 * task its findings, then its blockers, then its out-of-scope bugs, each
 * in append order and field by field in the order the table above lists
 * them, then the plan's check names; and within one text, the strings in
 * the order given. A string given twice is searched once. An empty string
 * would be a literal found in every text, so it is never searched; the
 * skill checker refuses one before it gets here.
 *
 * ## Refusals
 *
 * `fromIndex` is handed over by code, so one that is not the index of a
 * row of `facts` throws a `RangeError`.
 */
import type { SkillFact, SkillFactEntry, SkillFactFinding } from './skill-facts.js';
import type { PlanCiRow } from './store/plan-ci.js';

/** Where a recurrence was found. */
export type RecurrenceSource = 'finding' | 'blocker' | 'out-of-scope-bug' | 'plan-ci';

/** The fields of a finding that are searched, in search order. */
export const FINDING_FIELDS = ['trigger', 'what', 'cause', 'artifact'] as const;

/** The fields of a blocker or an out-of-scope bug that are searched, in search order. */
export const ENTRY_FIELDS = ['what', 'artifact'] as const;

/** A field a recurrence can be found in; `failing` for a check name. */
export type RecurrenceField = typeof FINDING_FIELDS[number] | typeof ENTRY_FIELDS[number] | 'failing';

/** One failure string found again. See the module note. */
export interface Recurrence {
  /** The failure string that was found. */
  readonly string: string;
  /** Where it was found. */
  readonly source: RecurrenceSource;
  /** The session whose row held it; null for plan CI. */
  readonly sessionId: string | null;
  /** The task line whose row held it; null for plan CI. */
  readonly taskLine: string | null;
  /** The field it was found in. */
  readonly field: RecurrenceField;
  /** The field's whole value, which holds the string. */
  readonly text: string;
}

/** One text to search, and where it came from. */
interface Haystack {
  readonly source: RecurrenceSource;
  readonly sessionId: string | null;
  readonly taskLine: string | null;
  readonly field: RecurrenceField;
  readonly text: string | null;
}

/** The searched fields of one finding. */
function findingTexts(fact: SkillFact, finding: SkillFactFinding): Haystack[] {
  return FINDING_FIELDS.map((field) => ({
    source: 'finding',
    sessionId: fact.sessionId,
    taskLine: fact.taskLine,
    field,
    text: finding[field],
  }));
}

/** The searched fields of one blocker or out-of-scope bug. */
function entryTexts(fact: SkillFact, source: RecurrenceSource, entry: SkillFactEntry): Haystack[] {
  return ENTRY_FIELDS.map((field) => ({
    source,
    sessionId: fact.sessionId,
    taskLine: fact.taskLine,
    field,
    text: entry[field],
  }));
}

/** Every searched text of one task, in search order. */
function taskTexts(fact: SkillFact): Haystack[] {
  return [
    ...fact.findings.flatMap((finding) => findingTexts(fact, finding)),
    ...fact.blockers.flatMap((entry) => entryTexts(fact, 'blocker', entry)),
    ...fact.outOfScopeBugs.flatMap((entry) => entryTexts(fact, 'out-of-scope-bug', entry)),
  ];
}

/** The task at `fromIndex` and each later task of its plan. */
function tasksFrom(facts: readonly SkillFact[], fromIndex: number): SkillFact[] {
  const task = facts[fromIndex];
  if (!Number.isInteger(fromIndex) || task === undefined) {
    throw new RangeError(`recurrence: fromIndex ${fromIndex} is not a row of ${facts.length} fact rows`);
  }
  if (task.planStub === null) return [task];
  return facts.slice(fromIndex).filter(({ planStub }) => planStub === task.planStub);
}

/** The plan's failing check names, each once, in the order first read. */
function failingNames(planStub: string | null, planCi: readonly PlanCiRow[]): Haystack[] {
  if (planStub === null) return [];
  const names = new Set(planCi.filter((row) => row.planStub === planStub).flatMap(({ failing }) => failing));
  return [...names].map((text) => ({ source: 'plan-ci', sessionId: null, taskLine: null, field: 'failing', text }));
}

/**
 * Every place one of `strings` recurs for the task at `fromIndex` of
 * `facts`: in its own or a later task's findings, blockers and
 * out-of-scope bugs in the same plan, or in the plan's failing check
 * names read from `planCi`. Case-sensitive; in search order. Throws a
 * `RangeError` when `fromIndex` is not a row of `facts`. See the module
 * note.
 */
export function findRecurrences(
  strings: readonly string[],
  facts: readonly SkillFact[],
  fromIndex: number,
  planCi: readonly PlanCiRow[],
): Recurrence[] {
  const tasks = tasksFrom(facts, fromIndex);
  const searched = [...new Set(strings)].filter((string) => string !== '');
  const haystacks = [...tasks.flatMap(taskTexts), ...failingNames(tasks[0]?.planStub ?? null, planCi)];

  return haystacks.flatMap(({ text, ...where }) => {
    if (text === null) return [];
    return searched
      .filter((string) => text.includes(string))
      .map((string) => ({ string, ...where, text }));
  });
}
