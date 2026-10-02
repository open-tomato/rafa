/**
 * The environment variables a spawned bun run gets beside a scratch
 * `HOME`, so that run leaves nothing of bun's own under that `HOME`.
 *
 * Without them bun writes its runtime transpiler cache to
 * `$HOME/.bun/install/cache/@t@`: measured on 2026-10-01 under Bun 1.4.2
 * on Linux, a spawned `bun src/rafa.ts --help` under an empty scratch
 * `HOME` left that directory behind. `BUN_INSTALL_CACHE_DIR` alone does
 * not move it — the same run with only that variable set still wrote
 * `$HOME/.bun/install/cache/@t@` and nothing at the named directory — so
 * {@link scratchHomeEnv} also sets `BUN_RUNTIME_TRANSPILER_CACHE_PATH` to
 * `0`, which turns that cache off. The same measurement found a spawned
 * run no slower without it, cold or warm (74 to 84 ms each way): a
 * scratch `HOME` starts every case with an empty cache anyway.
 *
 * `BUN_INSTALL_CACHE_DIR` names a sibling of the `HOME`, outside it, for
 * whatever a spawned run would install; nothing creates it unless that
 * happens, so it leaves no directory behind on an ordinary run.
 *
 * `packages/rafa-hub/src/testdata/scratch-home-env.ts` spells the same
 * variables for the hub's spawned suites, which may not import from
 * `src/` (`context/source.md`).
 */

/** The value of `BUN_RUNTIME_TRANSPILER_CACHE_PATH` that turns the cache off. */
const TRANSPILER_CACHE_OFF = '0';

/** The suffix naming the install cache beside a scratch `HOME`. */
const INSTALL_CACHE_SUFFIX = '-bun-install-cache';

/**
 * `HOME` set to `home`, beside the bun cache variables that keep a
 * spawned bun run from writing under it; see the module note. Spread
 * it where a spawned run's environment would set `HOME` alone.
 */
export function scratchHomeEnv(home: string): Readonly<Record<string, string>> {
  return {
    HOME: home,
    BUN_INSTALL_CACHE_DIR: `${home}${INSTALL_CACHE_SUFFIX}`,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: TRANSPILER_CACHE_OFF,
  };
}
