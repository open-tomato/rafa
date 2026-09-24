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
 *
 * ## `bundled/bin` goes first on `PATH`
 *
 * The rafa tier's programs (`ts-symbols` in a build) sit in
 * `bundled/bin` beside the running entry (`bundledBinDirectory`,
 * `src/schema/tiers.ts`), and a session runs one by name. So the
 * session's `PATH` is that directory, then the base's `PATH` as it was:
 * a program rafa ships wins over one of the same name elsewhere on the
 * machine, the same order `src/plan/needs.ts` reads a program rafa ships
 * in. The directory is a parameter defaulting to the running entry's, so
 * a test hands one of its own and reads no `Bun.main`.
 *
 * It goes on whether or not the directory is there. A checkout run
 * (`bun src/rafa.ts`) has no `src/bundled/bin`, and a directory on
 * `PATH` that does not exist is passed over by every lookup, so leaving
 * it out would only make the checkout spawn differently from a build.
 *
 * A base with no `PATH`, or an empty one, gets the directory alone. An
 * empty `PATH` joined on as `<bin>:` would end in an empty entry, which
 * POSIX reads as the current directory: a lookup the base never asked
 * for. A base whose `PATH` already names the directory elsewhere keeps
 * that entry; the one in front is where a lookup finds it.
 */
import { delimiter } from 'node:path';

import { bundledBinDirectory } from '../schema/tiers.js';

/** An environment as `process.env` and `Bun.spawn` spell it. */
export type SpawnEnv = Record<string, string | undefined>;

/**
 * `base`'s `PATH` with `binDir` in front, or `binDir` alone for a base
 * with no `PATH` or an empty one. See "`bundled/bin` goes first on
 * `PATH`".
 */
export function sessionPath(base: string | undefined, binDir: string): string {
  return base === undefined || base === ''
    ? binDir
    : `${binDir}${delimiter}${base}`;
}

/**
 * The environment every session is spawned with: `base`, plus the two
 * entries a session must see whichever spawner started it.
 *
 * `PATH` is `binDir`, the running entry's `bundled/bin` unless another
 * is handed, in front of `base`'s own ({@link sessionPath}).
 * `CLAUDE_CODE_ENTRYPOINT` is set to `cli` over whatever `base` holds
 * for it, so a shell that already carries another value still spawns
 * `cli`. Every other entry of `base` is handed on as it is, an entry
 * holding `undefined` included.
 */
export function sessionSpawnEnv(
  base: Readonly<SpawnEnv>,
  binDir: string = bundledBinDirectory(),
): SpawnEnv {
  return {
    ...base,
    PATH: sessionPath(base['PATH'], binDir),
    // Allow ECC continuous-learning hooks to observe ralph sessions.
    // observe.sh Layer 1 filters on CLAUDE_CODE_ENTRYPOINT — 'cli' is
    // in the allow-list; the default for -p mode is not.
    CLAUDE_CODE_ENTRYPOINT: 'cli',
  };
}
