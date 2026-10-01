/**
 * The loop's events: a task's start, its end done or blocked, each phase
 * of the wrap-up, the pull request or its absence, and a halt. Each is
 * emitted as one named `event` through the active output, which the
 * events output prints as one `rafa· ` line, json writes whole, and text
 * drops, because the loop's own text lines already say each of them.
 *
 * A task's tokens are read from its session log, the same reading
 * `rafa effort collect` makes, and never from the effort store: nothing
 * here opens the store, so nothing waits on its lock or migrates it.
 *
 * @module start/loop-events
 */
import { join } from 'node:path';

import { activeOutput } from '../adapters/output/active.js';
import { padKind } from '../adapters/output/events.js';
import { sessionLogDir } from '../effort/collect.js';
import { readSessionLog } from '../effort/session-log.js';
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
  | { readonly kind: 'halt'; readonly reason: string };

/** Milliseconds in a minute. */
const MINUTE_MS = 60_000;

/** Tokens in the `k` a token count is printed in. */
const TOKENS_PER_K = 1_000;

/** A text folded onto one line and quoted, its own double quotes escaped. */
function quoted(text: string): string {
  const folded = text
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' ');
  return `"${folded.replaceAll('"', '\\"')}"`;
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
      return `${taskKind(event.position, 'blocked')}${event.reason}`;
    case 'wrap-up':
      return `${padKind('wrap-up')}${event.phase}`;
    case 'pr':
      return `pr #${event.number} opened`;
    case 'no-pr':
      return `${padKind('no pr')}${event.reason}`;
    case 'halt':
      return `${padKind('halt')}${event.reason}`;
  }
}

/** Emits one loop event through the active output, its kind as the name and its other fields as data. */
export function emitLoopEvent(event: LoopEvent, now: () => Date = () => new Date()): void {
  const { kind, ...data } = event;
  activeOutput().emit({ type: 'event', name: kind, summary: summaryOf(event), data, ts: now().toISOString() });
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
