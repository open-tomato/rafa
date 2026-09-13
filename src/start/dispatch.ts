/**
 * One task's session, from the prompt it is handed to the report it
 * leaves in the store.
 *
 * `start()` calls {@link renderProgressForDispatch} before every
 * session, the wrap-up's included, hands each task the tracker answers
 * to {@link dispatchTask}, and, once it knows what became of that task,
 * stores what the session reported through {@link storeTaskReport}. A
 * dispatch spawns its session through {@link runTaskSession} unless its
 * `run` seam names another runner.
 *
 * The task prompt's first line carries the `task` classifier key, and
 * `PROMPT_SHAPES` in `effort/classify.ts` names this file as the source
 * its drift guard reads that prefix from.
 */
import type { InjectMode } from '../config.js';
import type { FindingOutcome } from '../effort/store/findings.js';
import type { PlanInjection } from '../plan/index.js';
import type { CapturedSession, CapturingSpawner } from '../utils/claude.js';
import type { TaskDeclaration } from '../utils/declaration.js';
import type { TaskInfo } from '../utils/tracker.js';

import { randomUUID } from 'crypto';

import { renderInjection } from '../plan/index.js';
import { describeTaskReportRecord, recordTaskReport } from '../report/record.js';
import { runClaudeCaptured } from '../utils/claude.js';
import { parseTaskDeclaration, resolveDeclarationFlags } from '../utils/declaration.js';
import { PROGRESS_CAP_BYTES, writeProgress } from '../utils/progress.js';

import { withStamp } from './stamp.js';

/** The flag a task session is spawned with to run under the loop's id. */
export const SESSION_ID_FLAG = '--session-id';

/**
 * How one task's Claude session is spawned: `prompt` on stdin, the
 * `flags` its declaration resolved to, and `sessionId` as its id. It
 * answers the exit code together with everything the session wrote to
 * stdout.
 */
export type TaskSessionRunner = (
  prompt: string,
  flags: readonly string[],
  sessionId: string,
) => Promise<CapturedSession>;

/**
 * The loop's task session runner: the CLI through `runClaudeCaptured`,
 * run under the id the dispatch picked.
 *
 * The id goes AHEAD of the declaration's flags. `--tools` is variadic
 * and is the last flag a declaration resolves to (`utils/claude.ts`), so
 * a `--session-id` placed after it would be read as a tool name.
 *
 * The loop picks the id rather than reading it back, because nothing
 * would tell it: under `claude -p` stdout is the session's final message
 * and holds no id. Measured on Claude Code 2.1.268, `claude -p
 * --session-id <uuid>` exited 0, printed only its reply and wrote its
 * log as `<uuid>.jsonl`, the basename `effort collect` keys a session
 * row by (`effort/session-log.ts`). So each row a task's report is
 * stored as joins the session row of the session that wrote it.
 */
export function runTaskSession(
  prompt: string,
  flags: readonly string[],
  sessionId: string,
  spawn?: CapturingSpawner,
): Promise<CapturedSession> {
  return runClaudeCaptured(prompt, [SESSION_ID_FLAG, sessionId, ...flags], spawn);
}

/** What {@link dispatchTask} needs to run one task. */
export interface TaskDispatchOptions {
  /** The task the tracker just handed the loop, declaration and all. */
  taskInfo: TaskInfo;
  /** `PROMPT.md`, read once before the loop. */
  promptContent: string;
  /**
   * The plan file, read once before the loop. The session is handed the
   * share of it {@link TaskDispatchOptions.inject} names.
   */
  planContent: string;
  /**
   * How much of the plan the session is handed. Required rather than
   * defaulted: a default here would be a second one beside
   * `CONFIG_DEFAULTS`, free to disagree with it.
   */
  inject: InjectMode;
  /** Session seam. Defaults to {@link runTaskSession}, the real CLI. */
  run?: TaskSessionRunner;
  /** Where the session's id comes from. Defaults to `randomUUID`. */
  newSessionId?: () => string;
}

/** What one dispatched task actually ran as. */
export interface TaskDispatch {
  /** The task sentence, with any declaration block taken off. */
  taskText: string;
  /** The prompt the session was given, on stdin. */
  prompt: string;
  /** The share of the plan the prompt carries, and why when it fell back. */
  injection: PlanInjection;
  /** Flags the declaration resolved to. Empty without one. */
  flags: readonly string[];
  /** What the block declared, or null when there was none. */
  declaration: TaskDeclaration | null;
  /** The id the session ran under, which also names its log. */
  sessionId: string;
  /** The session's exit code. */
  exitCode: number;
  /** Everything the session wrote to stdout, its report included. */
  output: string;
}

/**
 * Assembles the prompt one task's session is given.
 *
 * `taskText` is the sentence a declaration has already been taken off,
 * and that stripping is the whole reason this is a function rather
 * than three lines inside the loop. The block is an instruction to the
 * LOOP about how to spawn, never to the session about what to build:
 * a session handed `{agent=doc-updater effort=low}` reads it as part
 * of the task, so the routing would be described to the agent instead
 * of applied to it — and the block would then travel on into every
 * artifact that quotes the task back, the plan's own close-out
 * included.
 *
 * `planText` is the share of the plan the run's injection mode rendered
 * (`plan/inject.ts`). Under `full` it is the plan file byte for byte,
 * which makes the prompt the one the loop built before modes existed.
 *
 * The `Your scoped task is: ` prefix is what `effort/classify.ts`
 * buckets a session log by. It is asserted against this file's source
 * by that module's own drift guard, so it must stay spelled here.
 */
export function buildTaskPrompt(
  taskText: string,
  promptContent: string,
  planText: string,
): string {
  return [
    `Your scoped task is: ${taskText}`,
    'Consider tasks listed above this one in the plan checklist as completed. Do not re-evaluate or re-do them. Focus only on the scoped task.',
    '',
    promptContent,
    planText,
  ].join('\n');
}

/**
 * Runs one task's session, routed by whatever its own line declared.
 *
 * Everything a declaration changes happens here: the block comes off
 * the text before the prompt is built, and the flags it resolved to go
 * to the spawn. A task carrying no block resolves to no flags at all,
 * so its session is spawned with the base arguments and its session id
 * and nothing else, the arguments every task session shares. That is
 * the compatibility promise, and it is kept by the resolver rather than
 * by a branch here. Both halves are driven through the real `claudeArgs`
 * in `tests/declaration-dispatch.test.ts`, which is the only place the
 * flags a block resolved to are read off an argument list rather
 * than off this function's own record.
 *
 * Each session runs under a fresh id, `randomUUID` unless
 * `newSessionId` replaces it, and the record carries that id beside
 * everything the session wrote to stdout. Nothing here reads the report
 * in that output: what became of the task is not known until its commit
 * has answered, and the loop stores the report under that outcome.
 *
 * The routing is announced because it is otherwise invisible. A
 * session dispatched under an agent looks exactly like one dispatched
 * at the loop's defaults in the operator's terminal, and a key whose
 * value did not parse deliberately falls back to those defaults rather
 * than stalling the plan on a CLI that refuses `--effort medum`. So
 * each dropped token is named as well: without that line a typo costs
 * a task its routing and nothing anywhere says so.
 *
 * A `rafa:*` block has no strip here, and needs none: `findNextTask`
 * never answers a task line inside a closed one, so the text this
 * announces and injects can carry no block's body.
 *
 * The plan the prompt carries is rendered here in the mode the caller
 * names. A `stage` or `task` rendering that cannot find the task at its
 * line hands the session the whole plan instead, and that is warned
 * about, because the prompt is then several times the size the run
 * asked for and nothing else would show it.
 */
export async function dispatchTask(
  options: TaskDispatchOptions,
): Promise<TaskDispatch> {
  const { taskInfo } = options;
  const run = options.run ?? runTaskSession;

  const { text: taskText, declaration } = parseTaskDeclaration(taskInfo.task);
  const { args: flags, suppressed } = resolveDeclarationFlags(declaration);

  if (taskInfo.status === 'blocked') {
    console.log(`\n⚠️  Resuming blocked task: ${taskText}`);
  } else {
    console.log(`\n🔄 Executing task: ${taskText}`);
  }

  if (flags.length > 0) {
    const note = suppressed.length === 0
      ? ''
      : ` (${suppressed.join(', ')} left to the agent)`;
    console.log(`   Routed as: ${flags.join(' ')}${note}`);
  }

  for (const issue of declaration?.issues ?? []) {
    console.warn(`   Declaration: ignoring ${issue.reason} \`${issue.text}\`.`);
  }

  const injection = renderInjection({
    mode: options.inject,
    plan: options.planContent,
    task: taskInfo,
  });
  if (injection.fallback !== null) {
    console.warn(`   Injection: \`${injection.requested}\` not rendered: ${injection.fallback.text}.`);
  }

  const prompt = withStamp(buildTaskPrompt(
    taskText,
    options.promptContent,
    injection.text,
  ));

  const sessionId = (options.newSessionId ?? randomUUID)();
  const session = await run(prompt, flags, sessionId);

  return {
    taskText,
    prompt,
    flags,
    declaration,
    injection,
    sessionId,
    exitCode: session.exitCode,
    output: session.stdout,
  };
}

/** An error's message, or the thrown value itself when it is no error. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/**
 * Renders `progress.txt` from the stored findings ahead of a dispatch,
 * and answers whether it could.
 *
 * Called before EVERY session that reads the file, the wrap-up's
 * included, so each is handed what the store held once the task before
 * it was recorded. The file is replaced whole, and a store holding no
 * finding for this plan renders it empty, which blanks a `progress.txt`
 * written by hand.
 *
 * A store that cannot be read answers false with the file left as it
 * was (`utils/progress.ts` reads before it writes), and the caller stops
 * the run before the dispatch: nothing has been spent yet, and every
 * later dispatch would meet the same store.
 */
export function renderProgressForDispatch(repoRoot: string, planStub: string | null): boolean {
  try {
    const render = writeProgress(repoRoot, planStub);
    const left = render.oversized + render.omitted;
    if (left > 0) {
      console.warn(`📝 progress.txt holds ${render.rendered} finding(s); ${left} more did not fit its ${PROGRESS_CAP_BYTES} bytes.`);
    }
    return true;
  } catch (error) {
    console.error(`\n❌ progress.txt could not be rendered from the findings store: ${messageOf(error)}`);
    console.error('   Nothing was dispatched. Make the store readable, then run again.');
    return false;
  }
}

/** What {@link storeTaskReport} needs to store one session's report. */
export interface TaskReportStoreOptions {
  /** The repo root the store lives under. */
  readonly repoRoot: string;
  /** The plan the run is executing, or null when its file name gives none. */
  readonly planStub: string | null;
  /** The dispatch whose session wrote the report. */
  readonly dispatch: Pick<TaskDispatch, 'sessionId' | 'taskText' | 'output'>;
  /** What the loop made of the task. */
  readonly outcome: FindingOutcome;
}

/**
 * Stores what one task session reported under the loop's outcome for its
 * task, tells the operator what was stored, and answers whether the store
 * took it.
 *
 * Every row carries the sentence the dispatch quoted, declaration off, and
 * the id the session ran under, so it joins that session's log. An output
 * with no report the loop can read is stored as one telemetry row, and a
 * warning says why (`report/record.ts`).
 *
 * A write the store refuses answers false, and the caller stops the run
 * rather than dispatching tasks whose reports would meet the same store.
 * The report is not gone with the row: the session wrote it to the
 * operator's terminal as it ran.
 */
export function storeTaskReport(options: TaskReportStoreOptions): boolean {
  const { dispatch } = options;
  try {
    const record = recordTaskReport(options.repoRoot, {
      dispatch: {
        sessionId: dispatch.sessionId,
        planStub: options.planStub,
        taskLine: dispatch.taskText,
      },
      outcome: options.outcome,
      output: dispatch.output,
    });
    const { notes, warnings } = describeTaskReportRecord(record);
    for (const note of notes) console.log(`   ${note}`);
    for (const warning of warnings) console.warn(`   ${warning}`);
    return true;
  } catch (error) {
    console.error(`\n❌ The report of session ${dispatch.sessionId} was not stored: ${messageOf(error)}`);
    console.error('   The session printed it above as it ran.');
    return false;
  }
}
