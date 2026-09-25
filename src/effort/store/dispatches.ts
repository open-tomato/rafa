/**
 * The dispatch writer: one row in the store's `dispatches` table for each
 * task session the loop dispatched, holding what the task's declaration
 * asked for and the flags the session was spawned with.
 *
 * A declaration is the planner's half of a routing decision
 * (`utils/declaration.ts`). The session row `effort collect` reads from a
 * session's log carries token counts and no declaration, so nothing else
 * the store holds says what a session was asked to run under, and a
 * declared budget in particular. {@link writeDispatch} keeps it, one row
 * per session, where `rafa effort report` sets the budget beside the
 * usage that session's row measured ({@link readSessionBudgets}).
 *
 * ## The row
 *
 * | Column | From |
 * | --- | --- |
 * | `session_id`, `plan_stub`, `task_line` | the dispatch |
 * | `declaration` | the block as the task line wrote it, braces included, or NULL for a task with none |
 * | `agent`, `model`, `effort` | the declared value, or NULL |
 * | `budget_usd` | the declared budget in US dollars, or NULL |
 * | `tools` | the declared tool names joined with commas, or NULL |
 * | `flags` | the flags the declaration resolved to, a JSON array of strings, `[]` for none |
 * | `resolver` | the skill resolver the session ran under, `planner`, `tag` or `none`, or NULL when not recorded |
 * | `skills_offered` | the bare names of the skills its prompt offered, a JSON array, or NULL when not recorded |
 * | `lessons_offered` | the ids of the lessons its prompt offered, a JSON array, or NULL when not recorded |
 * | `collected_at` | the write's time, ISO 8601 |
 *
 * `seq` comes first, the append order, as in every table of the store. The
 * five value columns follow `DECLARATION_KEYS`, whose sixth key, `skills`,
 * has none: it maps to no flag and nothing here reads it back by itself. A
 * value is stored only when the parser could use it: one it dropped as
 * unusable is NULL here, and still reads in `declaration`, as it does on
 * the parser's record. So does a declared `skills=`, and so does every key
 * the grammar does not recognise.
 *
 * `flags` is what reached the CLI, and it can differ from the values: an
 * `agent` outranks a declared `model` and `tools`, and `effort` too when
 * its definition declares one, so those values are stored with no flag
 * beside them. The declaration says what was asked for; `flags` says what
 * the session was spawned with.
 *
 * The table sits in the SQLite store's file, created by the seventh entry
 * of `SQLITE_MIGRATIONS`, whichever backend the `store` setting selects;
 * the tenth added the last three columns. A write always has its one row,
 * and passes `writeSqliteStore` a count of one, as `reports.ts` does.
 *
 * ## What was offered
 *
 * `resolver`, `skills_offered` and `lessons_offered` say which arm chose
 * the task's skills and what reached its prompt, so a session's use of a
 * skill can be read against what it was handed. The resolver's name is
 * recorded here and never printed into the prompt. `storeTaskReport`
 * (`start/dispatch.ts`) writes all three off the dispatch, the offered
 * skills by bare name and the lessons by id; a dispatch that ran no
 * resolver, handed no handout, writes a NULL resolver beside two `[]`.
 * Each is optional on a write, and a write that leaves one out, or passes
 * null, stores NULL: not recorded, which is what every row a version-9
 * store held reads. An
 * offered list stores `[]` when the prompt offered nothing, so an empty
 * offer and an unrecorded one stay apart. Each list is stored in the
 * order it was handed, as the prompt's section listed it.
 *
 * ## One row per session, and no outcome
 *
 * The session id is the key. It is UNIQUE, and a second write for a
 * session already recorded adds nothing and answers `skipped: 1`: a
 * session is dispatched once. There is no generated `id`, since nothing
 * else keys a row. No column holds what became of the task: the loop
 * writes this row in `storeTaskReport` (`start/dispatch.ts`), once it
 * knows, ahead of the report's own rows, and those hold the outcome under
 * the same session id.
 *
 * ## Reading it back
 *
 * {@link readSessionBudgets} answers each row carrying a budget, in append
 * order, for `rafa effort report`. It opens and creates nothing when the
 * store file does not exist, and answers none. A store that exists is
 * opened through `withSqliteStore`, so its schema is brought forward, or
 * refused, as it is for a write.
 *
 * ## What is refused
 *
 * Everything this writer is handed comes from code, the dispatch and the
 * parser's record, so every refusal refuses the WHOLE write, thrown before
 * the store is opened, leaving no file behind:
 *
 *   - A session id that is not a non-empty string, a plan stub that is not
 *     a non-blank string or null, and a task line that is not a string.
 *   - A declaration that is neither null nor an object, whose block is
 *     blank, whose agent, model or effort is not a non-blank string or
 *     null, whose budget is not null or a finite number above zero, or
 *     whose tools are not null or a list of names holding no comma.
 *   - Flags that are not a list of strings.
 *   - A resolver that is not null or one of `SKILL_RESOLVERS`.
 *   - Offered skills or lessons that are not null or a list of non-blank
 *     strings, or that name one entry twice.
 *   - Any text holding a lone UTF-16 surrogate, which SQLite text cannot
 *     hold.
 */
import type { SkillResolverName } from '../../config-sections.js';
import type { TaskDeclaration } from '../../utils/declaration.js';

import { existsSync } from 'node:fs';

import { SKILL_RESOLVERS } from '../../config-sections.js';

import { describeValue, textProblem } from './findings.js';
import { LONE_SURROGATE, sqliteStorePath, withSqliteStore, writeSqliteStore } from './sqlite.js';

/** The part of the parser's record a row stores. */
export type DispatchDeclaration = Pick<TaskDeclaration, 'raw' | 'agent' | 'model' | 'effort' | 'budget' | 'tools'>;

/** One write: a dispatched task session, what it declared and what it was spawned with. */
export interface DispatchWrite {
  /** The task session's id, the row's key. */
  readonly sessionId: string;
  /** The plan's stub, or null when the dispatch resolved none. */
  readonly planStub: string | null;
  /** The task line, as the dispatch quoted it, its declaration off. */
  readonly taskLine: string;
  /** What the task line's block declared, or null for a task with none. */
  readonly declaration: DispatchDeclaration | null;
  /** The flags the declaration resolved to, as the session was spawned with them. */
  readonly flags: readonly string[];
  /** The skill resolver the session ran under; left out or null when not recorded. */
  readonly resolver?: SkillResolverName | null;
  /** The bare names of the skills the prompt offered, `[]` for none; left out or null when not recorded. */
  readonly skillsOffered?: readonly string[] | null;
  /** The ids of the lessons the prompt offered, `[]` for none; left out or null when not recorded. */
  readonly lessonsOffered?: readonly string[] | null;
}

/** The one value a write generates. */
export interface DispatchWriterSeams {
  /** The write's time. Defaults to the clock. */
  readonly now?: () => Date;
}

/** What one write did. */
export interface DispatchWriteResult {
  /** The store's file, whether or not anything was written to it. */
  readonly path: string;
  /** 1 when the row was written, else 0. */
  readonly appended: number;
  /** 1 when the session already had a row, else 0. */
  readonly skipped: number;
}

/** A column value, as it is bound. */
type Bound = string | number | null;

/** Every write has exactly one row to insert. */
const ROWS_PER_WRITE = 1;

/** The declared values held as text, each NULL or a non-blank string. */
const TEXT_KEYS = ['agent', 'model', 'effort'] as const;

/**
 * The insert. Its one conflict target is the session, so no other
 * constraint is absorbed.
 */
const INSERT_DISPATCH = `
  INSERT INTO dispatches (
    session_id, plan_stub, task_line,
    declaration, agent, model, effort, budget_usd, tools,
    flags, resolver, skills_offered, lessons_offered, collected_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (session_id) DO NOTHING
`;

/** A whole-write refusal, thrown before the store is opened. */
function refusedWrite(reason: string): Error {
  return new Error(`effort store: dispatch write ${reason}; nothing written`);
}

/** Throws unless `value` is a non-blank string SQLite can hold, or null where `nullable`. */
function checkText(name: string, value: unknown, nullable: boolean): void {
  if (value === null && nullable) return;
  const problem = value === null
    ? 'is null'
    : textProblem(value);
  if (problem !== null) throw refusedWrite(`has a ${name} that ${problem}`);
}

/** Throws unless `budget` is null or a finite number of dollars above zero. */
function checkBudget(budget: unknown): void {
  if (budget === null) return;
  if (typeof budget === 'number' && Number.isFinite(budget) && budget > 0) return;
  throw refusedWrite(`has budget ${describeValue(budget)}, not null or a finite number above zero`);
}

/** True for a tool name a comma-joined column reads back as itself. */
function isToolName(tool: unknown): boolean {
  return typeof tool === 'string' && textProblem(tool) === null && !tool.includes(',');
}

/** Throws unless `tools` is null or a non-empty list of tool names. */
function checkTools(tools: unknown): void {
  if (tools === null) return;
  if (Array.isArray(tools) && tools.length > 0 && tools.every(isToolName)) return;
  throw refusedWrite(`has tools ${describeValue(tools)}, not null or a list of names holding no comma`);
}

/** Throws unless `flags` is a list of strings SQLite can hold. */
function checkFlags(flags: unknown): void {
  const holdable = (flag: unknown): boolean => typeof flag === 'string' && !LONE_SURROGATE.test(flag);
  if (Array.isArray(flags) && flags.every(holdable)) return;
  throw refusedWrite(`has flags ${describeValue(flags)}, not a list of strings SQLite text can hold`);
}

/** Throws unless `resolver` is left out, null or one of {@link SKILL_RESOLVERS}. */
function checkResolver(resolver: unknown): void {
  if (resolver === undefined || resolver === null) return;
  if ((SKILL_RESOLVERS as readonly unknown[]).includes(resolver)) return;
  throw refusedWrite(`has resolver ${describeValue(resolver)}, not null or one of ${SKILL_RESOLVERS.join(', ')}`);
}

/** Throws unless the offered list `name` is left out, null or a list of distinct non-blank strings. */
function checkOffered(name: string, offered: unknown): void {
  if (offered === undefined || offered === null) return;
  const isEntry = (entry: unknown): boolean => textProblem(entry) === null && entry !== null;
  if (Array.isArray(offered) && offered.every(isEntry) && new Set(offered).size === offered.length) return;
  throw refusedWrite(`has ${name} ${describeValue(offered)}, not null or a list of distinct non-blank strings`);
}

/** The JSON a list column holds, or null when the list was not recorded. */
function offeredJson(offered: readonly string[] | null | undefined): string | null {
  return offered === undefined || offered === null
    ? null
    : JSON.stringify(offered);
}

/** Throws unless `declaration` is null or a record whose values can be stored. */
function checkDeclaration(declaration: unknown): void {
  if (declaration === null) return;
  if (typeof declaration !== 'object') {
    throw refusedWrite(`has declaration ${describeValue(declaration)}, not an object or null`);
  }
  const record = declaration as DispatchDeclaration;
  checkText('declaration block', record.raw, false);
  for (const key of TEXT_KEYS) checkText(key, record[key], true);
  checkBudget(record.budget);
  checkTools(record.tools);
}

/** Throws, having opened nothing, unless every value of `write` can be stored. */
function checkWrite(write: DispatchWrite): void {
  checkText('session id', write.sessionId, false);
  checkText('plan stub', write.planStub, true);
  const taskLine: unknown = write.taskLine;
  if (typeof taskLine !== 'string' || LONE_SURROGATE.test(taskLine)) {
    throw refusedWrite(`has task line ${describeValue(taskLine)}, not a string SQLite text can hold`);
  }
  checkDeclaration(write.declaration);
  checkFlags(write.flags);
  checkResolver(write.resolver);
  checkOffered('offered skills', write.skillsOffered);
  checkOffered('offered lessons', write.lessonsOffered);
}

/**
 * Records what one dispatched session declared and was spawned with,
 * unless that session already has a row.
 *
 * Throws, having opened nothing, when a value cannot be stored. See the
 * module note for each refusal.
 */
export function writeDispatch(
  repoRoot: string,
  write: DispatchWrite,
  seams: DispatchWriterSeams = {},
): DispatchWriteResult {
  checkWrite(write);
  const path = sqliteStorePath(repoRoot);

  const { declaration } = write;
  const collectedAt = (seams.now ?? (() => new Date()))().toISOString();
  const values: Bound[] = [
    write.sessionId, write.planStub, write.taskLine,
    declaration?.raw ?? null,
    declaration?.agent ?? null,
    declaration?.model ?? null,
    declaration?.effort ?? null,
    declaration?.budget ?? null,
    declaration?.tools?.join(',') ?? null,
    JSON.stringify(write.flags),
    write.resolver ?? null,
    offeredJson(write.skillsOffered),
    offeredJson(write.lessonsOffered),
    collectedAt,
  ];

  const appended = writeSqliteStore(
    path,
    ROWS_PER_WRITE,
    0,
    (db) => db.query<unknown, Bound[]>(INSERT_DISPATCH).run(...values).changes,
  );
  return { path, appended, skipped: ROWS_PER_WRITE - appended };
}

/** One session dispatched with a budget. */
export interface SessionBudget {
  /** The session's id, which its session row is keyed by. */
  readonly sessionId: string;
  /** The plan it was dispatched under, or null for none. */
  readonly planStub: string | null;
  /** The task line it was dispatched for. */
  readonly taskLine: string;
  /** The budget it declared, in US dollars. */
  readonly budgetUsd: number;
}

/** A budgeted row, as the query answers it. */
interface BudgetRow {
  readonly session_id: string;
  readonly plan_stub: string | null;
  readonly task_line: string;
  readonly budget_usd: number;
}

/** Every row carrying a budget, in append order. */
const SELECT_BUDGETS = `
  SELECT session_id, plan_stub, task_line, budget_usd
  FROM dispatches
  WHERE budget_usd IS NOT NULL
  ORDER BY seq
`;

/**
 * The sessions dispatched with a budget, in the order they were stored.
 *
 * Answers none, opening and creating nothing, when the store file does
 * not exist. Throws when it exists and cannot be read. See the module
 * note.
 */
export function readSessionBudgets(repoRoot: string): SessionBudget[] {
  const path = sqliteStorePath(repoRoot);
  if (!existsSync(path)) return [];

  const rows = withSqliteStore(path, false, (db) => db.query<BudgetRow, []>(SELECT_BUDGETS).all());
  return rows.map((row) => ({
    sessionId: row.session_id,
    planStub: row.plan_stub,
    taskLine: row.task_line,
    budgetUsd: row.budget_usd,
  }));
}
