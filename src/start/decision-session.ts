/**
 * The one session a `rafa loop start --continue` decision spawns: the
 * prompt `./decision-prompt.ts` builds on stdin, read-only tools, and
 * its captured output handed back for `./decision-parse.ts` to read.
 *
 * It goes through the capturing door (`utils/claude.ts`), as the task
 * and wrap-up sessions do, under the run's `loop.settingSources`, in the
 * run's checkout, with the argument list {@link decisionFlags} builds:
 * `--session-id` with an id the loop picks, then `--tools` naming
 * {@link DECISION_TOOLS} and nothing else, last, since `--tools` is
 * variadic (as `inventory/search/index.ts` spawns its session). With
 * no tool that writes or runs a command, the session can read the plan,
 * the tracker and the code, and change none of them. Nothing is served
 * to it (`start/serving.ts`): it routes nothing and loads no agent.
 *
 * The prompt is stamped with the plan (`start/stamp.ts`), as every
 * session the loop spawns is, so `rafa effort collect` attributes its
 * log to the plan. The loop stores no row of its own for it:
 * `effort/classify.ts` has no kind for a decision session, which
 * `effort collect` therefore reads as `other`.
 *
 * Nothing is read here but the exit code and stdout, and nothing is
 * printed: the session's own stdout reaches the operator through the
 * door's tee, and the caller (`./continue-run.ts`) says what was decided.
 */
import type { ClaudeSettingSource } from '../config.js';
import type { CapturedSession, CapturingSpawner } from '../utils/claude.js';

import { randomUUID } from 'node:crypto';

import { runClaudeCaptured } from '../utils/claude.js';

import { SESSION_ID_FLAG } from './dispatch.js';
import { withStamp } from './stamp.js';

/** The tools a decision session may use: reading, never writing or running. */
export const DECISION_TOOLS: readonly string[] = Object.freeze(['Read', 'Grep', 'Glob']);

/** The flags a decision session is spawned with, `--tools` last. */
export function decisionFlags(sessionId: string): string[] {
  return [SESSION_ID_FLAG, sessionId, '--tools', DECISION_TOOLS.join(',')];
}

/** What one decision session is spawned with. */
export interface DecisionSessionInput {
  /** The prompt `buildDecisionPrompt` built, unstamped. */
  readonly prompt: string;
  /** The run's resolved `loop.settingSources`. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** The run's checkout, the session's working directory. */
  readonly checkout: string;
  /** The spawner; `spawnClaudeCaptured` when left out. */
  readonly spawn?: CapturingSpawner;
  /** Picks the session's id; `randomUUID` when left out. */
  readonly sessionId?: () => string;
}

/** Spawns the one decision session and answers its exit code and stdout. */
export function runDecisionSession(input: DecisionSessionInput): Promise<CapturedSession> {
  const id = (input.sessionId ?? randomUUID)();
  return runClaudeCaptured(
    withStamp(input.prompt),
    input.settingSources,
    decisionFlags(id),
    input.spawn,
    [],
    { cwd: input.checkout },
  );
}
