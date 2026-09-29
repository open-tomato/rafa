/**
 * The fact rows `rafa effort report --skills` reads: one row per task
 * session, joining what the store's SQLite-only tables hold about it.
 *
 * {@link readSkillFacts} is the one reader of disk behind the report. The
 * recurrence matcher and the skill and lesson signals are pure and take
 * these rows, never a path or a config. It reads rows rafa already stores
 * and nothing else: no session transcript is opened, which keeps the
 * stance of `session-log.ts`. It is a TypeScript reader rather than a
 * SQL `CREATE VIEW`, so the store's schema, and every table-list
 * expectation over it, is left as it was.
 *
 * ## One row per task report
 *
 * A fact row is a `task_reports` row: a task session whose output carried
 * a report. A session whose output held none is a `report_absences` row
 * and has no fact row, since it holds no outcome, no `skills_used` and no
 * findings to read. Onto each report the reader joins, by session id:
 *
 * | Field | From |
 * | --- | --- |
 * | `planStub`, `taskLine`, `outcome` | `task_reports` |
 * | `skillsUsed` | `task_reports.skills_used`, the session's claim |
 * | `resolver`, `skillsOffered`, `lessonsOffered` | `dispatches` |
 * | `invoked` | `skill_invocations`, main thread and sidechains summed |
 * | `findings`, `blockers`, `outOfScopeBugs` | the tables of the same names |
 * | `planCi` | `plan_ci`, every reading of the row's plan |
 *
 * ## Names
 *
 * Every skill name is read as `bareSkillName` compares it. `skills_used`
 * is stored as the report wrote it, so the reader maps each entry through
 * `bareSkillName` and keeps each name once, in the order first written: a
 * served rafa skill reads as its bare name, and another plugin's
 * `plugin:name` is kept. `skills_offered` and `skill_invocations` are
 * stored bare by their writers and are read as they are.
 *
 * ## Not recorded, unknown, and none
 *
 * Three readings stay apart, and none of them is read as another:
 *
 *   - `skillsUsed`, `resolver`, `skillsOffered` and `lessonsOffered` are
 *     null when the store holds none recorded: a column a store read
 *     NULL, from before the migration that added it, or a report whose
 *     session has no `dispatches` row. `[]` is a list recorded empty.
 *   - `invoked` is `'unknown'` when the session's `skill_invocations`
 *     row is the `unknown` one, a log the collector could not vouch for.
 *     It is never read as a session that invoked nothing.
 *   - `invoked` is `[]` when the session holds no `skill_invocations`
 *     row. That is how the table stores a session read and found to
 *     invoke no skill, and it is also how a session `effort collect` has
 *     not yet read looks: no SQLite-only table says which sessions the
 *     skill half of the collector has read, so this reader cannot tell
 *     the two apart.
 *
 * ## Findings, blockers and out-of-scope bugs
 *
 * Every row the session holds is kept, in the order below, whatever its
 * `kind`: a row `store/tracker-refs.ts` inserted for a filed issue holds
 * only the key it was filed under, in `artifact`, with `kind`, `what` and
 * `signal` NULL, and filtering on `kind` would drop exactly the findings
 * that were escalated.
 *
 * ## Order and plans
 *
 * Rows are grouped by plan, and ordered within one by
 * `ACROSS_STORES_ORDER` (`store/origins.ts`) over `task_reports`:
 * `collected_at`, then the origin pair, then `seq`. The findings,
 * blockers, bugs and dispatches of a session are read in that order too.
 * `seq` alone would not do, since a merge gives the other store's rows
 * new local `seq` values after its own, and a merged store has to read
 * one order whichever side ran the merge; one device's rows of one
 * report still keep their append order, which `origin_seq` carries.
 * `skill_invocations` and `plan_ci` hold no `collected_at` and are read
 * in their store's own `seq` order. With no `plans` named, every row is read, the plans in the order of
 * their first report, and a report dispatched under no plan reads a null
 * `planStub` in a group of its own, placed the same way. With `plans`
 * named, only reports under those stubs are read, in the order the stubs
 * are named, a stub named twice read once; a report under no plan is then
 * never read. Every row of one plan shares one `planCi` list, the plan's
 * readings in append order, `[]` for a plan with none and for no plan.
 *
 * ## The store
 *
 * The reader answers none, opening and creating nothing, when the store
 * file does not exist. A store that exists is opened through the store's
 * own readers and `withSqliteStore`, each for a read, so its schema is
 * brought forward, or refused, as `sqlite.ts` says a read's is. It
 * throws when the store cannot be read, and when a list column holds
 * anything but a list of strings, which no writer stores.
 */
import type { SkillResolverName } from '../config-sections.js';
import type { PlanCiRow } from './store/plan-ci.js';
import type { ReportedSkills } from './store/reports.js';
import type { SkillInvocation } from './store/skill-invocations.js';

import { existsSync } from 'node:fs';

import { bareSkillName } from '../tiers/skill-names.js';

import { ACROSS_STORES_ORDER } from './store/origins.js';
import { readPlanCi } from './store/plan-ci.js';
import { readReportedSkills } from './store/reports.js';
import { readSkillInvocations, UNKNOWN_SKILL_COUNT } from './store/skill-invocations.js';
import { sqliteStorePath, withSqliteStore } from './store/sqlite.js';

/** One skill a session invoked, and how often, both sides summed. */
export interface SkillCount {
  /** The skill's bare name. */
  readonly name: string;
  /** The main thread's calls and the sidechains' together, above zero. */
  readonly count: number;
}

/** What a session invoked: each skill counted, or `unknown` when its log could not be read. */
export type SkillFactInvocations = readonly SkillCount[] | typeof UNKNOWN_SKILL_COUNT;

/** One `findings` row, as a fact carries it. */
export interface SkillFactFinding {
  /** The finding's kind, or null on a row a filed issue inserted. */
  readonly kind: string | null;
  readonly trigger: string | null;
  readonly what: string | null;
  readonly cause: string | null;
  readonly resolution: string | null;
  /** The byte string a recurrence would match on, or the key a filed issue was stored under. */
  readonly artifact: string | null;
  readonly signal: string | null;
}

/** One `blockers` or `out_of_scope_bugs` row, as a fact carries it. */
export interface SkillFactEntry {
  readonly what: string;
  readonly artifact: string | null;
}

/** One task session, as the `--skills` report reads it. See the module note. */
export interface SkillFact {
  /** The session's id. */
  readonly sessionId: string;
  /** The plan it was dispatched under, or null for none. */
  readonly planStub: string | null;
  /** The task line it was dispatched for. */
  readonly taskLine: string;
  /** What the loop made of its task. Open, as the column is. */
  readonly outcome: string;
  /** The bare names its report said it used, each once; null when not recorded. */
  readonly skillsUsed: readonly string[] | null;
  /** The skill resolver it ran under, null when not recorded or when it ran none. */
  readonly resolver: SkillResolverName | null;
  /** The bare names its prompt offered, `[]` for none; null when not recorded. */
  readonly skillsOffered: readonly string[] | null;
  /** The lesson ids its prompt offered, `[]` for none; null when not recorded. */
  readonly lessonsOffered: readonly string[] | null;
  /** The skills it invoked, in the order first stored, or `unknown`. */
  readonly invoked: SkillFactInvocations;
  /** Its findings, in append order. */
  readonly findings: readonly SkillFactFinding[];
  /** Its blockers, in append order. */
  readonly blockers: readonly SkillFactEntry[];
  /** Its out-of-scope bugs, in append order. */
  readonly outOfScopeBugs: readonly SkillFactEntry[];
  /** Every CI reading of its plan, in append order; `[]` for none and for no plan. */
  readonly planCi: readonly PlanCiRow[];
}

/** A `dispatches` row's offer columns, as the query answers them. */
interface StoredOffer {
  readonly session_id: string;
  readonly resolver: SkillResolverName | null;
  readonly skills_offered: string | null;
  readonly lessons_offered: string | null;
}

/** A `findings` row, as the query answers it. */
interface StoredFinding extends SkillFactFinding {
  readonly session_id: string;
}

/** A `blockers` or `out_of_scope_bugs` row, as the query answers it. */
interface StoredEntry extends SkillFactEntry {
  readonly session_id: string;
}

/** A dispatch's offers, read. */
interface Offer {
  readonly resolver: SkillResolverName | null;
  readonly skillsOffered: readonly string[] | null;
  readonly lessonsOffered: readonly string[] | null;
}

/** What one open of the store reads besides the store's own readers. */
interface SessionRows {
  readonly offers: ReadonlyMap<string, Offer>;
  readonly findings: ReadonlyMap<string, readonly SkillFactFinding[]>;
  readonly blockers: ReadonlyMap<string, readonly SkillFactEntry[]>;
  readonly outOfScopeBugs: ReadonlyMap<string, readonly SkillFactEntry[]>;
}

/** Every dispatch's offers. */
const SELECT_OFFERS = `SELECT session_id, resolver, skills_offered, lessons_offered FROM dispatches ORDER BY ${ACROSS_STORES_ORDER}`;

/** Every finding, every column a recurrence can match, in the order every store holding them reads. */
const SELECT_FINDINGS = `
  SELECT session_id, kind, trigger, what, cause, resolution, artifact, signal
  FROM findings
  ORDER BY ${ACROSS_STORES_ORDER}
`;

/** Every row of `table`, a blocker or a bug, in the order every store holding them reads. */
function selectEntries(table: 'blockers' | 'out_of_scope_bugs'): string {
  return `SELECT session_id, what, artifact FROM ${table} ORDER BY ${ACROSS_STORES_ORDER}`;
}

/** The list a stored JSON column holds. Throws for one no writer stores. */
function parseNames(column: string, sessionId: string, json: string | null): readonly string[] | null {
  if (json === null) return null;
  const list: unknown = JSON.parse(json);
  if (Array.isArray(list) && list.every((name) => typeof name === 'string')) return list;
  throw new Error(`effort store: ${column} of session ${sessionId} holds ${json}, not a list of names`);
}

/** Groups `rows` by session, each group in the order the rows came. */
function bySession<R extends { readonly session_id: string }, T>(
  rows: readonly R[],
  toEntry: (row: R) => T,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.session_id) ?? [];
    groups.set(row.session_id, [...group, toEntry(row)]);
  }
  return groups;
}

/** A blocker or bug row without its session id. */
function entryOf({ what, artifact }: StoredEntry): SkillFactEntry {
  return { what, artifact };
}

/** A finding row without its session id. */
function findingOf(row: StoredFinding): SkillFactFinding {
  return {
    kind: row.kind,
    trigger: row.trigger,
    what: row.what,
    cause: row.cause,
    resolution: row.resolution,
    artifact: row.artifact,
    signal: row.signal,
  };
}

/** The dispatches, findings, blockers and bugs of every session, in one open. */
function readSessionRows(path: string): SessionRows {
  return withSqliteStore(path, 'read', false, (db) => {
    const offers = db.query<StoredOffer, []>(SELECT_OFFERS).all();
    return {
      offers: new Map(offers.map((row) => [row.session_id, {
        resolver: row.resolver,
        skillsOffered: parseNames('skills_offered', row.session_id, row.skills_offered),
        lessonsOffered: parseNames('lessons_offered', row.session_id, row.lessons_offered),
      }])),
      findings: bySession(db.query<StoredFinding, []>(SELECT_FINDINGS).all(), findingOf),
      blockers: bySession(db.query<StoredEntry, []>(selectEntries('blockers')).all(), entryOf),
      outOfScopeBugs: bySession(db.query<StoredEntry, []>(selectEntries('out_of_scope_bugs')).all(), entryOf),
    };
  });
}

/** Each session's invocations, both sides summed per name, an `unknown` row kept as unknown. */
function invocationsBySession(invocations: readonly SkillInvocation[]): Map<string, SkillFactInvocations> {
  const sessions = new Map<string, SkillFactInvocations>();
  for (const invocation of invocations) {
    const held = sessions.get(invocation.sessionId) ?? [];
    if (held === UNKNOWN_SKILL_COUNT || invocation.count === UNKNOWN_SKILL_COUNT) {
      sessions.set(invocation.sessionId, UNKNOWN_SKILL_COUNT);
      continue;
    }
    const { name, count } = invocation;
    const counted = held.some((use) => use.name === name)
      ? held.map((use) => (use.name === name
        ? { name, count: use.count + count }
        : use))
      : [...held, { name, count }];
    sessions.set(invocation.sessionId, counted);
  }
  return sessions;
}

/** The report's claim under `bareSkillName`, each name once, or null when not recorded. */
function bareNames(names: readonly string[] | null): readonly string[] | null {
  return names === null
    ? null
    : [...new Set(names.map((name) => bareSkillName(name)))];
}

/**
 * The reports to read, grouped by plan in the order the module note
 * gives, each group in append order.
 */
function orderedReports(
  reports: readonly ReportedSkills[],
  plans: readonly string[] | undefined,
): ReportedSkills[] {
  const order: (string | null)[] = plans === undefined
    ? [...new Set(reports.map(({ planStub }) => planStub))]
    : [...new Set(plans)];
  return order.flatMap((plan) => reports.filter(({ planStub }) => planStub === plan));
}

/**
 * One fact row per task session the store holds a report for, grouped
 * by plan and ordered within one as the module note says; only `plans`'
 * reports when it is named.
 *
 * Answers none, opening and creating nothing, when the store file does
 * not exist. Throws when it exists and cannot be read. See the module
 * note.
 */
export function readSkillFacts(repoRoot: string, plans?: readonly string[]): SkillFact[] {
  if (!existsSync(sqliteStorePath(repoRoot))) return [];

  const reports = orderedReports(readReportedSkills(repoRoot), plans);
  if (reports.length === 0) return [];

  const rows = readSessionRows(sqliteStorePath(repoRoot));
  const invoked = invocationsBySession(readSkillInvocations(repoRoot));
  const planCi = new Map<string, readonly PlanCiRow[]>();
  for (const row of readPlanCi(repoRoot)) planCi.set(row.planStub, [...planCi.get(row.planStub) ?? [], row]);

  return reports.map((report) => {
    const offer = rows.offers.get(report.sessionId);
    return {
      sessionId: report.sessionId,
      planStub: report.planStub,
      taskLine: report.taskLine,
      outcome: report.outcome,
      skillsUsed: bareNames(report.skillsUsed),
      resolver: offer?.resolver ?? null,
      skillsOffered: offer?.skillsOffered ?? null,
      lessonsOffered: offer?.lessonsOffered ?? null,
      invoked: invoked.get(report.sessionId) ?? [],
      findings: rows.findings.get(report.sessionId) ?? [],
      blockers: rows.blockers.get(report.sessionId) ?? [],
      outOfScopeBugs: rows.outOfScopeBugs.get(report.sessionId) ?? [],
      planCi: report.planStub === null
        ? []
        : planCi.get(report.planStub) ?? [],
    };
  });
}
