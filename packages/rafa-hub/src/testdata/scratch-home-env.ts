/**
 * The environment variables a spawned rafa CLI gets beside a device's
 * scratch `HOME`, so that run leaves nothing of bun's own under that
 * `HOME`: what `two-devices.integration.test.ts` and
 * `hub-unreachable.integration.test.ts` both spawn under.
 *
 * The same spelling as the root's `src/tests/scratch-home-env.ts`, whose
 * module note holds the measurement: bun writes its runtime transpiler
 * cache to `$HOME/.bun/install/cache/@t@` unless
 * `BUN_RUNTIME_TRANSPILER_CACHE_PATH` says otherwise, and
 * `BUN_INSTALL_CACHE_DIR` alone does not move it. A package may not
 * import from the root's `src/` (`context/source.md`), so this copy
 * stands beside it.
 *
 * It also spells the git identity of the root's `src/tests/git-identity.ts`
 * — the same name and address in the four `GIT_AUTHOR_*` and
 * `GIT_COMMITTER_*` variables — because a swapped `HOME` hides the
 * operator's `~/.gitconfig`, and a commit with no identity fails with
 * `Author identity unknown`.
 */

/** The value of `BUN_RUNTIME_TRANSPILER_CACHE_PATH` that turns the cache off. */
const TRANSPILER_CACHE_OFF = '0';

/** The suffix naming the install cache beside a scratch `HOME`. */
const INSTALL_CACHE_SUFFIX = '-bun-install-cache';

/** The name a spawned run commits under, as the root's `gitIdentityEnv` spells it. */
const TEST_NAME = 'rafa test';

/** The address a spawned run commits under, as the root's `gitIdentityEnv` spells it. */
const TEST_EMAIL = 'rafa@example.test';

/**
 * `HOME` set to `home`, beside the bun cache variables that keep a
 * spawned bun run from writing under it and the test git identity; see
 * the module note.
 */
export function scratchHomeEnv(home: string): Readonly<Record<string, string>> {
  return {
    GIT_AUTHOR_NAME: TEST_NAME,
    GIT_AUTHOR_EMAIL: TEST_EMAIL,
    GIT_COMMITTER_NAME: TEST_NAME,
    GIT_COMMITTER_EMAIL: TEST_EMAIL,
    HOME: home,
    BUN_INSTALL_CACHE_DIR: `${home}${INSTALL_CACHE_SUFFIX}`,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: TRANSPILER_CACHE_OFF,
  };
}
