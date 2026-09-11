/**
 * Spawning a Claude session, and reading how much of the plan's budget
 * has gone.
 *
 * {@link runClaude} is the loop's one door onto the CLI, and it has
 * four call sites in three shapes: plan generation in `plan.ts`, and
 * the wrap-up and CI-repair sessions in `start.ts`, all of which want
 * today's behaviour exactly — one model, one effort, every tool —
 * plus the per-task dispatch, where a task may carry a routing
 * declaration naming what it should run under. So the flags are a
 * parameter with an EMPTY default: `runClaude(prompt)` spawns exactly
 * the process the loop spawned before declarations existed, and
 * nothing but a declaration-bearing task can change that.
 *
 * The flags land AFTER {@link CLAUDE_BASE_ARGS} rather than before,
 * and the ordering is load-bearing rather than cosmetic. `--tools` is
 * VARIADIC in the CLI's own help (`--tools <tools...>`), so it keeps
 * consuming tokens until one that starts with a dash. `--tools` is the
 * LAST flag `resolveDeclarationFlags` emits, and the resolved flags are
 * the last thing appended here, so its value is the final element of
 * the argument list with nothing after it to be swallowed. Putting the
 * resolved flags FIRST would put `-p` behind that variadic, which is
 * the one arrangement that breaks. `-p` itself takes no value
 * (`-p, --print` is a boolean in the same help text), so nothing after
 * it is at risk either.
 *
 * The prompt goes on STDIN and never into the argument list. That is
 * not a style choice: a plan's task prompt here is the injected
 * instructions plus `PROMPT.md` plus the whole plan file, which is far
 * past what an argument list can carry, and an argument list is also
 * visible to every `ps` on the machine.
 *
 * {@link ClaudeSpawner} exists because the real spawn is
 * `Bun.spawn` and the root suite runs vitest under NODE — measured,
 * `globalThis.Bun` is `undefined` and `process.versions.bun` is null
 * in that runtime. So the default spawner cannot be driven from a test
 * at all, and the seam is what makes the argument list an assertion
 * rather than something inferred from a session that appeared to work.
 *
 * getClaudeUsagePercent returns current API consumption as 0–100, or null if
 * unavailable. Override via CLAUDE_USAGE_PERCENT env var for testing or manual
 * control. A real data source (Anthropic billing API, CLI flag, or injected
 * env var) should be wired in once reliably identified.
 */

export async function getClaudeUsagePercent(): Promise<number | null> {
  const envPct = process.env['CLAUDE_USAGE_PERCENT'];
  if (envPct !== undefined) {
    const pct = Number(envPct);
    return Number.isFinite(pct)
      ? Math.max(0, Math.min(100, pct))
      : null;
  }
  return null;
}

/**
 * Checks current Claude usage and warns / signals a pause.
 *
 * context 'issue' — called before starting a new issue. Warns at ≥70%.
 * context 'task'  — called between ralph tasks. Warns at ≥80%, returns true
 *                   (pause signal) at ≥90%.
 *
 * Returns true if the caller should stop its current loop iteration.
 */
export async function checkUsage(context: 'issue' | 'task'): Promise<boolean> {
  const pct = await getClaudeUsagePercent();
  if (pct === null) return false;

  if (context === 'task' && pct >= 90) {
    console.warn(
      `\nClaude usage at ${pct.toFixed(0)}% (>=90%). Pausing after current task to avoid hitting the limit.`,
    );
    return true;
  }
  if (pct >= 80) {
    console.warn(
      `\nClaude usage at ${pct.toFixed(0)}% (>=80%). Monitor closely — tasks may be interrupted.`,
    );
  } else if (context === 'issue' && pct >= 70) {
    console.warn(
      `\nClaude usage at ${pct.toFixed(0)}% (>=70%). Consider whether to start the next issue.`,
    );
  } else {
    console.info(`\nClaude usage: ${pct.toFixed(0)}%`);
  }
  return false;
}

/**
 * The executable every session is spawned as.
 *
 * Resolved on PATH rather than by absolute path, which is what lets a
 * version manager or a shim answer for it.
 */
export const CLAUDE_BIN = 'claude';

/**
 * Arguments every session gets, before any resolved flag.
 *
 * `-p` prints and exits, which is what makes the session
 * non-interactive; `--dangerously-skip-permissions` is what lets it
 * run unattended. Neither is a task's to choose, so neither is
 * reachable from a declaration.
 */
export const CLAUDE_BASE_ARGS: readonly string[] = [
  '-p',
  '--dangerously-skip-permissions',
];

/**
 * Builds the argument list for one session.
 *
 * `flags` is whatever a task's declaration resolved to, already
 * validated and already ordered by its own resolver. Nothing is
 * reordered, deduped or filtered here: this module has no opinion on
 * which flags are legal, and one that did would be a second authority
 * for a decision `utils/declaration.ts` already makes.
 */
export function claudeArgs(flags: readonly string[] = []): string[] {
  return [...CLAUDE_BASE_ARGS, ...flags];
}

/**
 * Runs `claude` with an argument list and a prompt on stdin, and
 * answers the exit code.
 *
 * The seam every test drives, since the default {@link spawnClaude}
 * cannot run under the root suite's runtime.
 */
export type ClaudeSpawner = (
  args: readonly string[],
  prompt: string,
) => Promise<number>;

/**
 * The real spawner: `Bun.spawn`, streams inherited so the session's
 * output reaches the operator as it happens.
 *
 * An exit code of `undefined` — which is what a signalled process
 * answers — is reported as 1, because every caller here treats a
 * non-zero as a failed session and a killed one is not a success.
 */
export async function spawnClaude(
  args: readonly string[],
  prompt: string,
): Promise<number> {
  const proc = Bun.spawn([CLAUDE_BIN, ...args], {
    stdin: new TextEncoder().encode(prompt),
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      // Allow ECC continuous-learning hooks to observe ralph sessions.
      // observe.sh Layer 1 filters on CLAUDE_CODE_ENTRYPOINT — 'cli' is
      // in the allow-list; the default for -p mode is not.
      CLAUDE_CODE_ENTRYPOINT: 'cli',
    },
  });
  return (await proc.exited) ?? 1;
}

/**
 * Spawns one Claude session with `prompt` on stdin.
 *
 * `flags` defaults to empty, which is the whole of the compatibility
 * promise: `runClaude(prompt)` builds the identical argument list the
 * loop always spawned, so `plan.ts`, the wrap-up and the CI-repair
 * session need no change and cannot be routed by accident.
 */
export function runClaude(
  prompt: string,
  flags: readonly string[] = [],
  spawn: ClaudeSpawner = spawnClaude,
): Promise<number> {
  return spawn(claudeArgs(flags), prompt);
}
