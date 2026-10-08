/**
 * The reading of a session record (`loop/sessions.ts`): the sets its
 * fields are checked against, the field readers that name each problem,
 * the frozen record built from fields already checked, and
 * {@link parseSessionRecord}. `sessions.ts` re-exports everything a
 * caller of the record reads from here, and uses the problem lists and
 * the freezing for its own writes, so nothing it writes is a record this
 * module refuses to read. The record's shape is described in the note
 * of `sessions.ts`, "The record" and "Steps".
 *
 * The two modules import each other's types alone: this one takes the
 * record's interfaces from `sessions.ts` with `import type`, which leaves
 * no import at run time, and `sessions.ts` takes its values from here.
 * The sets, the error and the id check live here so this module imports
 * no value from `sessions.ts` and the pair forms no cycle when loaded.
 *
 * ## What is refused on read
 *
 * {@link SessionRecordError}, naming the file: text that is no JSON
 * object, a field of the wrong type or outside its set, a `hop` key whose
 * value is not a hop record (null included), a `worktree` key whose value
 * is no absolute path (null included), a `steps` key whose value is no
 * list of steps (null included), a step outside the shape `sessions.ts` describes or whose
 * `newFailures` names a test its `failures` does not, a step whose
 * `interrupted` key holds anything but `true`, a `decisions` key whose
 * value is no list of decisions (null included), a decision outside the
 * shape `sessions.ts` describes, a pid that is no
 * positive whole number (signal 0 to pid 0 or below would reach a process
 * group), an unparsable `startedAt`, and a `sessionId` that is no plain
 * file name or differs from the file's name. `readSessions`
 * (`sessions.ts`) reads only names ending in `.json`, and answers no
 * record when the directory does not exist. `readSession` reads the one
 * record an id names, and refuses a file that is not there.
 *
 * ## What is never refused
 *
 * `phase`. A record written by a rafa from before the field carries no
 * `phase` key, and one written by a later rafa may carry a phase this one
 * does not know; neither is a problem. The frozen record keeps a phase of
 * {@link SESSION_PHASES} and leaves out any other, and
 * {@link sessionPhase} reads a record without one as `task`.
 *
 * A step's `reason`, for the same two causes: a step written by rafa
 * 0.35.0 or earlier carries no `reason` key, and a later rafa may name a
 * reason this one does not know. The frozen step keeps a reason of
 * {@link SESSION_STEP_REASONS}, right after its `scope`, and leaves out
 * any other value, null, a number or an unknown word alike, so the
 * record is read whole and its next write carries no `reason` key on
 * that step.
 */
import type {
  SessionDecision,
  SessionRecord,
  SessionStep,
  SessionTaskRef,
} from './sessions.js';
import type { HopRecord } from '../next/hop-record.js';
import type { SuiteFailure } from '../suite/run.js';

import { basename, isAbsolute } from 'node:path';

import { messageOf } from '../config-sections.js';
import { asHopRecord } from '../next/hop-record.js';
import { TEST_SCOPES } from '../utils/declaration.js';
import { isStampableStub } from '../utils/plan-stamp.js';

/** The states a session record holds, in the spec's order. */
export const SESSION_STATES = Object.freeze(['running', 'paused', 'stopped', 'done'] as const);

/** One of {@link SESSION_STATES}. */
export type SessionState = (typeof SESSION_STATES)[number];

/**
 * The phases of a run, in the order a run meets them: its tasks, the
 * wrap-up, the pull request, the CI wait, and a repair of what CI failed.
 */
export const SESSION_PHASES = Object.freeze(['task', 'wrap-up', 'pull-request', 'ci', 'repair'] as const);

/** One of {@link SESSION_PHASES}. */
export type SessionPhase = (typeof SESSION_PHASES)[number];

/** The phase a record without a phase of {@link SESSION_PHASES} reads as. */
const DEFAULT_PHASE: SessionPhase = 'task';

/** What a record's file name ends in. */
export const RECORD_EXTENSION = '.json';

/** A session id usable as a file name: no separator, no leading dot. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The kinds of suite step a run records, in the order a run meets them. */
export const SESSION_STEP_KINDS = Object.freeze(['baseline', 'task', 'stage', 'pre-wrap-up'] as const);

/** One of {@link SESSION_STEP_KINDS}. */
export type SessionStepKind = (typeof SESSION_STEP_KINDS)[number];

/**
 * Why a suite step ran at the scope it did: the task's own `tests=`
 * declaration, a full-suite trigger, the `--changed` fallback taken when
 * no `Owns:` folder narrows the run, a `tests=module` task whose module
 * holds no test file, and a stage step's own scope.
 */
export const SESSION_STEP_REASONS = Object.freeze(['declared', 'trigger', 'fallback', 'no-module-tests', 'stage'] as const);

/** One of {@link SESSION_STEP_REASONS}. */
export type SessionStepReason = (typeof SESSION_STEP_REASONS)[number];

/** The strategies a saved decision may name: the two that pass over a task. */
export const SESSION_DECISION_STRATEGIES = Object.freeze(['jump', 'defer'] as const);

/** A record file that cannot be read, or holds no record this module accepts. */
export class SessionRecordError extends Error {
  /** The record's path. */
  readonly file: string;

  constructor(file: string, problem: string) {
    super(`session record ${file}: ${problem}`);
    this.name = 'SessionRecordError';
    this.file = file;
  }
}

/** True when the text can name a record file. */
export function isSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value);
}

/** A value as a problem names it. */
function describeValue(value: unknown): string {
  return value === undefined
    ? 'missing'
    : JSON.stringify(value) ?? String(value);
}

/** An own field of a parsed object, never one its prototype answers. */
function field(fields: object, key: string): unknown {
  return Object.hasOwn(fields, key)
    ? (fields as Record<string, unknown>)[key]
    : undefined;
}

/** True for a plain object, as `JSON.parse` makes one. */
function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for a whole number from 1. */
export function isPositiveWhole(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** True for a string holding more than whitespace. */
function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** The problem with a record's `task`, or null. */
function taskProblem(task: unknown): string | null {
  if (task === null) return null;
  if (!isObject(task)) return `task is ${describeValue(task)}, expected null or an object`;
  if (!isPositiveWhole(field(task, 'line'))) {
    return `task.line is ${describeValue(field(task, 'line'))}, expected a whole number from 1`;
  }
  return isText(field(task, 'text'))
    ? null
    : `task.text is ${describeValue(field(task, 'text'))}, expected a non-empty string`;
}

/** The problem with a record's `hop`, or null, a record without the key included. */
function hopProblem(fields: object): string | null {
  if (!Object.hasOwn(fields, 'hop')) return null;
  const hop = field(fields, 'hop');
  return asHopRecord(hop) === null
    ? `hop is ${describeValue(hop)}, expected a hop record`
    : null;
}

/** The problem with a record's `worktree`, or null, a record without the key included. */
function worktreeProblem(fields: object): string | null {
  if (!Object.hasOwn(fields, 'worktree')) return null;
  const worktree = field(fields, 'worktree');
  return isText(worktree) && isAbsolute(worktree)
    ? null
    : `worktree is ${describeValue(worktree)}, expected an absolute path`;
}

/** True for a list of strings each holding more than whitespace. */
function isTextList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isText);
}

/** True for a failing test: a file and a name, both text. */
function isFailure(value: unknown): value is SuiteFailure {
  return isObject(value) && isText(field(value, 'file')) && isText(field(value, 'name'));
}

/** True for a list of failing tests. */
function isFailureList(value: unknown): value is readonly SuiteFailure[] {
  return Array.isArray(value) && value.every(isFailure);
}

/** The key a failing test is compared by: its file and its name. */
function failureKey(failure: SuiteFailure): string {
  return JSON.stringify([failure.file, failure.name]);
}

/** The problem with a step's `failures` and `newFailures`, or null. */
function stepFailuresProblem(step: object, at: string): string | null {
  const failures = field(step, 'failures');
  const newFailures = field(step, 'newFailures');
  if (!isFailureList(failures)) return `${at}.failures is ${describeValue(failures)}, expected a list of failing tests`;
  if (!isFailureList(newFailures)) {
    return `${at}.newFailures is ${describeValue(newFailures)}, expected a list of failing tests`;
  }
  const known = new Set(failures.map(failureKey));
  const stray = newFailures.find((failure) => !known.has(failureKey(failure)));
  return stray === undefined
    ? null
    : `${at}.newFailures names ${describeValue(stray)}, which ${at}.failures does not`;
}

/** The problem with a step's `interrupted`, or null: when there, it is `true`. */
function stepInterruptedProblem(step: object, at: string): string | null {
  if (!Object.hasOwn(step, 'interrupted')) return null;
  const interrupted = field(step, 'interrupted');
  return interrupted === true
    ? null
    : `${at}.interrupted is ${describeValue(interrupted)}, expected true or no key`;
}

/** Every problem with one step, the `at` naming its place in the record. */
export function stepProblems(step: unknown, at: string): string[] {
  if (!isObject(step)) return [`${at} is ${describeValue(step)}, expected a step`];
  const kind = field(step, 'kind');
  const scope = field(step, 'scope');
  const command = field(step, 'command');
  const exitCode = field(step, 'exitCode');
  const summary = field(step, 'summary');
  const problems = [
    (SESSION_STEP_KINDS as readonly unknown[]).includes(kind)
      ? null
      : `${at}.kind is ${describeValue(kind)}, expected one of ${SESSION_STEP_KINDS.join(', ')}`,
    (TEST_SCOPES as readonly unknown[]).includes(scope) || isTextList(scope)
      ? null
      : `${at}.scope is ${describeValue(scope)}, expected one of ${TEST_SCOPES.join(', ')} or a list of paths`,
    isTextList(command) && command.length > 0
      ? null
      : `${at}.command is ${describeValue(command)}, expected a non-empty list of arguments`,
    typeof exitCode === 'number' && Number.isSafeInteger(exitCode)
      ? null
      : `${at}.exitCode is ${describeValue(exitCode)}, expected a whole number`,
    summary === null || typeof summary === 'string'
      ? null
      : `${at}.summary is ${describeValue(summary)}, expected null or a string`,
    stepFailuresProblem(step, at),
    stepInterruptedProblem(step, at),
  ];
  return problems.filter((problem): problem is string => problem !== null);
}

/** True for a whole number from 0. */
function isLineIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Every problem with a decision's task reference at `at`. */
function taskRefProblems(ref: unknown, at: string): string[] {
  if (!isObject(ref)) return [`${at} is ${describeValue(ref)}, expected a task`];
  const lineNum = field(ref, 'lineNum');
  const task = field(ref, 'task');
  const ordinal = field(ref, 'ordinal');
  return [
    isLineIndex(lineNum)
      ? null
      : `${at}.lineNum is ${describeValue(lineNum)}, expected a whole number from 0`,
    isText(task)
      ? null
      : `${at}.task is ${describeValue(task)}, expected a non-empty string`,
    ordinal === undefined || isPositiveWhole(ordinal)
      ? null
      : `${at}.ordinal is ${describeValue(ordinal)}, expected a whole number from 1`,
  ].filter((problem): problem is string => problem !== null);
}

/** The problem with a decision's `after`: there on a defer alone. */
function afterProblems(decision: object, strategy: unknown, at: string): string[] {
  const after = field(decision, 'after');
  if (strategy === 'defer') {
    return after === undefined
      ? [`${at}.after is missing, expected the task a defer waits on`]
      : taskRefProblems(after, `${at}.after`);
  }
  return after === undefined
    ? []
    : [`${at}.after is ${describeValue(after)}, expected no key on a jump`];
}

/** Every problem with one saved decision, the `at` naming its place in the record. */
function decisionProblems(decision: unknown, at: string): string[] {
  if (!isObject(decision)) return [`${at} is ${describeValue(decision)}, expected a decision`];
  const strategy = field(decision, 'strategy');
  const reason = field(decision, 'reason');
  const problems = [
    ...taskRefProblems(field(decision, 'task'), `${at}.task`),
    (SESSION_DECISION_STRATEGIES as readonly unknown[]).includes(strategy)
      ? null
      : `${at}.strategy is ${describeValue(strategy)}, expected one of ${SESSION_DECISION_STRATEGIES.join(', ')}`,
    isText(reason)
      ? null
      : `${at}.reason is ${describeValue(reason)}, expected a non-empty string`,
    ...afterProblems(decision, strategy, at),
  ];
  return problems.filter((problem): problem is string => problem !== null);
}

/** Every problem with a record's `decisions`, none for a record without the key. */
function decisionsProblems(fields: object): string[] {
  if (!Object.hasOwn(fields, 'decisions')) return [];
  const decisions = field(fields, 'decisions');
  if (!Array.isArray(decisions)) return [`decisions is ${describeValue(decisions)}, expected a list of decisions`];
  return decisions.flatMap((decision: unknown, index) => decisionProblems(decision, `decisions[${index}]`));
}

/** Every problem with a record's `steps`, none for a record without the key. */
function stepsProblems(fields: object): string[] {
  if (!Object.hasOwn(fields, 'steps')) return [];
  const steps = field(fields, 'steps');
  if (!Array.isArray(steps)) return [`steps is ${describeValue(steps)}, expected a list of steps`];
  return steps.flatMap((step: unknown, index) => stepProblems(step, `steps[${index}]`));
}

/** The problem with a record's `sessionId`, read from `file`, or null. */
function sessionIdProblem(sessionId: unknown, file: string): string | null {
  if (typeof sessionId !== 'string' || !isSessionId(sessionId)) {
    return `sessionId is ${describeValue(sessionId)}, expected a plain file name`;
  }
  return basename(file) === `${sessionId}${RECORD_EXTENSION}`
    ? null
    : `sessionId ${JSON.stringify(sessionId)} is not the file's name`;
}

/** The problem with a record's `planStub`, or null. */
function planStubProblem(planStub: unknown): string | null {
  return planStub === null || (typeof planStub === 'string' && isStampableStub(planStub))
    ? null
    : `planStub is ${describeValue(planStub)}, expected null or a plan stub`;
}

/** The problem with each text field that holds no text. */
function textProblems(fields: object): string[] {
  return ['plan', 'branch']
    .filter((key) => !isText(field(fields, key)))
    .map((key) => `${key} is ${describeValue(field(fields, key))}, expected a non-empty string`);
}

/** Every problem with a parsed record read from `file`. */
export function recordProblems(fields: object, file: string): string[] {
  const pid = field(fields, 'pid');
  const startedAt = field(fields, 'startedAt');
  const state = field(fields, 'state');
  const problems = [
    sessionIdProblem(field(fields, 'sessionId'), file),
    planStubProblem(field(fields, 'planStub')),
    ...textProblems(fields),
    isPositiveWhole(pid)
      ? null
      : `pid is ${describeValue(pid)}, expected a whole number from 1`,
    typeof startedAt === 'string' && !Number.isNaN(Date.parse(startedAt))
      ? null
      : `startedAt is ${describeValue(startedAt)}, expected a timestamp`,
    (SESSION_STATES as readonly unknown[]).includes(state)
      ? null
      : `state is ${describeValue(state)}, expected one of ${SESSION_STATES.join(', ')}`,
    taskProblem(field(fields, 'task')),
    hopProblem(fields),
    worktreeProblem(fields),
    ...stepsProblems(fields),
    ...decisionsProblems(fields),
  ];
  return problems.filter((problem): problem is string => problem !== null);
}

/** True for one of {@link SESSION_PHASES}. */
function isSessionPhase(value: unknown): value is SessionPhase {
  return (SESSION_PHASES as readonly unknown[]).includes(value);
}

/** The `phase` entry of a frozen record: none for an absent phase or one outside {@link SESSION_PHASES}. */
function phaseEntry(phase: unknown): { readonly phase?: SessionPhase } {
  return isSessionPhase(phase)
    ? { phase }
    : {};
}

/** A checked `hop` value, frozen through to its places. */
function freezeHop(value: unknown): HopRecord {
  const hop = asHopRecord(value) as HopRecord;
  return Object.freeze({ ...hop, home: Object.freeze(hop.home), from: Object.freeze(hop.from) });
}

/** A frozen list of failing tests already checked, each copied to its two fields. */
function freezeFailures(failures: readonly SuiteFailure[]): readonly SuiteFailure[] {
  return Object.freeze(failures.map((failure) => Object.freeze({ file: failure.file, name: failure.name })));
}

/** True for one of {@link SESSION_STEP_REASONS}. */
function isSessionStepReason(value: unknown): value is SessionStepReason {
  return (SESSION_STEP_REASONS as readonly unknown[]).includes(value);
}

/** The `reason` entry of a frozen step: none for an absent reason or one outside {@link SESSION_STEP_REASONS}. */
function reasonEntry(reason: unknown): { readonly reason?: SessionStepReason } {
  return isSessionStepReason(reason)
    ? { reason }
    : {};
}

/**
 * A frozen step already checked, its fields in the order they are
 * written: `reason` right after `scope`, only when it is one of
 * {@link SESSION_STEP_REASONS}, and `interrupted` last, only when there.
 */
function freezeStep(step: SessionStep): SessionStep {
  return Object.freeze({
    kind: step.kind,
    scope: typeof step.scope === 'string'
      ? step.scope
      : Object.freeze([...step.scope]),
    ...reasonEntry(field(step, 'reason')),
    command: Object.freeze([...step.command]),
    exitCode: step.exitCode,
    summary: step.summary,
    failures: freezeFailures(step.failures),
    newFailures: freezeFailures(step.newFailures),
    ...(step.interrupted === true
      ? { interrupted: true as const }
      : {}),
  });
}

/** The `steps` entry of a frozen record: none while the list is missing or empty. */
function stepsEntry(steps: unknown): { readonly steps?: readonly SessionStep[] } {
  if (!Array.isArray(steps) || steps.length === 0) return {};
  return { steps: Object.freeze((steps as readonly SessionStep[]).map(freezeStep)) };
}

/** A frozen task reference already checked, copied to its fields, `ordinal` last and only when it is there. */
function freezeTaskRef(ref: SessionTaskRef): SessionTaskRef {
  return Object.freeze({
    lineNum: ref.lineNum,
    task: ref.task,
    ...(ref.ordinal === undefined
      ? {}
      : { ordinal: ref.ordinal }),
  });
}

/** A frozen decision already checked, its fields in the order they are written, `after` last and only on a defer. */
function freezeDecision(decision: SessionDecision): SessionDecision {
  return Object.freeze({
    task: freezeTaskRef(decision.task),
    strategy: decision.strategy,
    reason: decision.reason,
    ...(decision.after === undefined
      ? {}
      : { after: freezeTaskRef(decision.after) }),
  });
}

/** The `decisions` entry of a frozen record: none while the list is missing or empty. */
function decisionsEntry(decisions: unknown): { readonly decisions?: readonly SessionDecision[] } {
  if (!Array.isArray(decisions) || decisions.length === 0) return {};
  return { decisions: Object.freeze((decisions as readonly SessionDecision[]).map(freezeDecision)) };
}

/**
 * A frozen record of fields already checked, in the order it is written;
 * `phase`, `hop`, `worktree`, `steps` then `decisions` last, each only
 * when there, `phase` only when it is one of {@link SESSION_PHASES}.
 */
export function freezeRecord(fields: object): SessionRecord {
  const task = field(fields, 'task');
  const hop = field(fields, 'hop');
  const worktree = field(fields, 'worktree');
  return Object.freeze({
    sessionId: field(fields, 'sessionId') as string,
    planStub: field(fields, 'planStub') as string | null,
    plan: field(fields, 'plan') as string,
    branch: field(fields, 'branch') as string,
    pid: field(fields, 'pid') as number,
    startedAt: field(fields, 'startedAt') as string,
    state: field(fields, 'state') as SessionState,
    task: isObject(task)
      ? Object.freeze({ line: field(task, 'line') as number, text: field(task, 'text') as string })
      : null,
    ...phaseEntry(field(fields, 'phase')),
    ...hop === undefined
      ? {}
      : { hop: freezeHop(hop) },
    ...worktree === undefined
      ? {}
      : { worktree: worktree as string },
    ...stepsEntry(field(fields, 'steps')),
    ...decisionsEntry(field(fields, 'decisions')),
  });
}

/** The steps a record holds, oldest first; none for a record written before the field. */
export function sessionSteps(record: Pick<SessionRecord, 'steps'>): readonly SessionStep[] {
  return record.steps ?? [];
}

/** The pass-over list a record saved; none for a record without the key. */
export function sessionDecisions(record: Pick<SessionRecord, 'decisions'>): readonly SessionDecision[] {
  return record.decisions ?? [];
}

/**
 * The phase a record reads as: its own, or `task` for a record without
 * one, as a record from a rafa older than the field is.
 */
export function sessionPhase(record: Pick<SessionRecord, 'phase'>): SessionPhase {
  return record.phase ?? DEFAULT_PHASE;
}

/**
 * Reads a record out of the text of `file`, or throws
 * {@link SessionRecordError} naming every problem. See the module note.
 */
export function parseSessionRecord(text: string, file: string): SessionRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SessionRecordError(file, `holds no JSON: ${messageOf(error)}`);
  }
  if (!isObject(parsed)) throw new SessionRecordError(file, 'holds no JSON object');

  const problems = recordProblems(parsed, file);
  if (problems.length > 0) throw new SessionRecordError(file, problems.join('; '));
  return freezeRecord(parsed);
}
