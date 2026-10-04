/**
 * The loop's events: a task's start, its end done or blocked, each phase
 * of the wrap-up, the pull request or its absence, a halt, and each
 * reported bug triage read as a red test the run started with
 * (`start/triage.ts`). Each is emitted as one named `event` through the
 * active output, which the events output prints as one `rafa· ` line,
 * json writes whole, and text drops, because the loop's own text lines
 * already say each of them.
 *
 * Every event is also appended to the run's events file,
 * `.rafa/runs/<session-id>.events.ndjson`, once {@link bindEventsFile}
 * names it: one JSON line `{ name, summary, data, ts }` per event, the
 * object the output's `emit` receives minus `type`, in every output mode,
 * text included. The append is best-effort: a failed write warns once on
 * stderr, naming the path and the error, and never throws into the loop.
 * {@link unbindEventsFile} ends it. The session's record, `<id>.json`
 * (`loop/sessions.ts`), stays the only `.json` file a run writes.
 *
 * An `error` event says the run ended on an uncaught error; its line is
 * the first non-blank line of the error's message.
 *
 * A task's tokens are read from its session log, the same reading
 * `rafa effort collect` makes, and never from the effort store: nothing
 * here opens the store, so nothing waits on its lock or migrates it.
 *
 * @module start/loop-events
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { activeOutput, activeOutputMode } from '../adapters/output/active.js';
import { oneLine, padKind } from '../adapters/output/events.js';
import { messageOf } from '../config-sections.js';
import { sessionLogDir } from '../effort/collect.js';
import { readSessionLog } from '../effort/session-log.js';
import { isSessionId, runsDir } from '../loop/sessions.js';
import { parsePlan } from '../plan/index.js';

/** Where a task sits among its tracker's tasks, counted from 1. */
export interface TaskPosition {
  readonly index: number;
  readonly total: number;
}

/** A phase of the wrap-up, in the order the loop runs them. */
export type WrapUpPhase = 'tests' | 'fragment' | 'session' | 'release' | 'ci';

/** One event of a loop run. */
export type LoopEvent =
  | { readonly kind: 'task-start'; readonly position: TaskPosition; readonly text: string }
  | { readonly kind: 'task-done'; readonly position: TaskPosition; readonly durationMs: number; readonly tokens: number | null }
  | { readonly kind: 'task-blocked'; readonly position: TaskPosition; readonly reason: string }
  | { readonly kind: 'wrap-up'; readonly phase: WrapUpPhase }
  | { readonly kind: 'pr'; readonly number: number }
  | { readonly kind: 'no-pr'; readonly reason: string }
  | { readonly kind: 'halt'; readonly reason: string }
  | { readonly kind: 'inherited'; readonly file: string; readonly name: string }
  | { readonly kind: 'error'; readonly message: string };

/** Milliseconds in a minute. */
const MINUTE_MS = 60_000;

/** Tokens in the `k` a token count is printed in. */
const TOKENS_PER_K = 1_000;

/** A text folded onto one line and quoted, its own double quotes escaped. */
function quoted(text: string): string {
  return `"${oneLine(text).replaceAll('"', '\\"')}"`;
}

/** A task's kind, `task <i>/<n> <verb>`, padded as every kind is. */
function taskKind(position: TaskPosition, verb: string): string {
  return padKind(`task ${position.index}/${position.total} ${verb}`);
}

/** A duration in whole minutes, one at least. */
function minutes(durationMs: number): string {
  return `${Math.max(1, Math.round(durationMs / MINUTE_MS))}m`;
}

/** The one line an event is printed as, without the `rafa· ` prefix. */
export function summaryOf(event: LoopEvent): string {
  switch (event.kind) {
    case 'task-start':
      return `${taskKind(event.position, 'start')}${quoted(event.text)}`;
    case 'task-done':
      return event.tokens === null
        ? `${taskKind(event.position, 'done')}${minutes(event.durationMs)}`
        : `${taskKind(event.position, 'done')}${minutes(event.durationMs)}  ${Math.round(event.tokens / TOKENS_PER_K)}k tokens`;
    case 'task-blocked':
      return `${taskKind(event.position, 'blocked')}${oneLine(event.reason)}`;
    case 'wrap-up':
      return `${padKind('wrap-up')}${event.phase}`;
    case 'pr':
      return `pr #${event.number} opened`;
    case 'no-pr':
      return `${padKind('no pr')}${oneLine(event.reason)}`;
    case 'halt':
      return `${padKind('halt')}${oneLine(event.reason)}`;
    case 'inherited':
      return `${padKind('inherited')}${oneLine(`${event.file} > ${event.name}`)}`;
    case 'error':
      return `${padKind('error')}${firstLine(event.message)}`;
  }
}

/** A message's first non-blank line, trimmed, or the empty string when it has none. */
function firstLine(message: string): string {
  return message
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? '';
}

/** The file extension of a run's events file, after its session id. */
export const EVENTS_EXTENSION = '.events.ndjson';

/** Writes one warning line; stderr unless a caller names another. */
export type Warn = (line: string) => void;

/** The events file bound, and whether its failed write has warned yet. */
interface BoundEventsFile {
  readonly file: string;
  readonly warn: Warn;
  readonly warned: boolean;
}

/** The events file every emitted event is appended to, or null when none is bound. */
let bound: BoundEventsFile | null = null;

/** `<root>/.rafa/runs/<sessionId>.events.ndjson`. Throws on an id {@link isSessionId} refuses. */
export function eventsFilePath(root: string, sessionId: string): string {
  if (!isSessionId(sessionId)) {
    throw new Error(`events file: unusable session id ${JSON.stringify(sessionId)}`);
  }
  return join(runsDir(root), `${sessionId}${EVENTS_EXTENSION}`);
}

/**
 * Binds the run's events file, so every later {@link emitLoopEvent}
 * appends a line to it until {@link unbindEventsFile}. Makes the runs
 * folder when it is missing, best-effort as the append is. Answers the
 * file's path.
 */
export function bindEventsFile(
  root: string,
  sessionId: string,
  warn: Warn = (line) => {
    process.stderr.write(line);
  },
): string {
  const file = eventsFilePath(root, sessionId);
  try {
    mkdirSync(runsDir(root), { recursive: true });
  } catch {
    // The first append fails too, and warns.
  }
  bound = { file, warn, warned: false };
  return file;
}

/** Ends the append {@link bindEventsFile} began; a no-op when none is bound. */
export function unbindEventsFile(): void {
  bound = null;
}

/** Appends one line to the bound events file, warning once per binding on a failed write. */
function appendEventLine(line: object): void {
  if (bound === null) return;
  try {
    appendFileSync(bound.file, `${JSON.stringify(line)}\n`);
  } catch (error) {
    if (bound.warned) return;
    bound = { ...bound, warned: true };
    bound.warn(`rafa: cannot write the events file ${bound.file}: ${messageOf(error)}\n`);
  }
}

/**
 * Emits one loop event through the active output, its kind as the name
 * and its other fields as data, and appends it to the bound events file.
 */
export function emitLoopEvent(event: LoopEvent, now: () => Date = () => new Date()): void {
  const { kind, ...data } = event;
  const line = { name: kind, summary: summaryOf(event), data, ts: now().toISOString() };
  appendEventLine(line);
  activeOutput().emit({ type: 'event', ...line });
}

/**
 * Makes `read` unless the active output is text, and answers null there.
 * Text prints no event, so a reading only an event carries, such as a
 * pull request lookup over `gh` or a session log's tokens, is skipped
 * rather than paid for on every run.
 */
export async function unlessText<T>(read: () => Promise<T>): Promise<T | null> {
  return activeOutputMode() === 'text'
    ? null
    : read();
}

/** Where the task on `lineNum`, counted from zero, sits among the tracker's tasks. */
export function taskPosition(trackerContent: string, lineNum: number): TaskPosition {
  const { tasks } = parsePlan(trackerContent);
  return { index: tasks.findIndex((task) => task.lineNum === lineNum) + 1, total: tasks.length };
}

/**
 * The tokens a task session spent: input, cache creation and output, from
 * its session log under `home`. Cache reads are left out, since every
 * turn reads the whole cache again and they would dwarf the rest. Null
 * when the log cannot be read.
 */
export async function taskTokens(checkout: string, sessionId: string, home?: string): Promise<number | null> {
  try {
    const { usage } = await readSessionLog(join(sessionLogDir(checkout, home), `${sessionId}.jsonl`));
    return usage.inputTokens + usage.cacheCreationInputTokens + usage.outputTokens;
  } catch {
    return null;
  }
}
