/**
 * The environment a Claude session is spawned with, as one function of
 * the environment it starts from.
 *
 * Both spawn doors in `claude.ts`, `spawnClaude` and the captured
 * spawner under `spawnClaudeCaptured`, hand `Bun.spawn` what
 * {@link sessionSpawnEnv} answers for `process.env`, so the two cannot
 * drift apart: a hook that observed uncaptured sessions and missed
 * captured ones would miss exactly the task sessions. A reading of the
 * session's environment that does not spawn one calls this same
 * function rather than spelling its entries again, so what it reports is
 * what a session would have been handed.
 *
 * The base is a parameter rather than `process.env` read here, so a
 * caller holding another environment, a command's context or a test's
 * fixture, reads the session environment for THAT environment and
 * nothing of the process leaks in. The function never writes to the
 * base: it answers a new object each call.
 */

/** An environment as `process.env` and `Bun.spawn` spell it. */
export type SpawnEnv = Record<string, string | undefined>;

/**
 * The environment every session is spawned with: `base`, plus the one
 * entry a session must see whichever spawner started it.
 *
 * `CLAUDE_CODE_ENTRYPOINT` is set to `cli` over whatever `base` holds
 * for it, so a shell that already carries another value still spawns
 * `cli`. Every other entry of `base` is handed on as it is, an entry
 * holding `undefined` included.
 */
export function sessionSpawnEnv(base: Readonly<SpawnEnv>): SpawnEnv {
  return {
    ...base,
    // Allow ECC continuous-learning hooks to observe ralph sessions.
    // observe.sh Layer 1 filters on CLAUDE_CODE_ENTRYPOINT — 'cli' is
    // in the allow-list; the default for -p mode is not.
    CLAUDE_CODE_ENTRYPOINT: 'cli',
  };
}
