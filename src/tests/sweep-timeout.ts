/**
 * The one time limit of every `*.sweep.test.ts` file, in milliseconds.
 *
 * A sweep reads the tree it guards: it lists the tracked files, reads
 * them, and in several files parses each one with the TypeScript
 * compiler or spawns a process over them. Its time therefore grows with
 * the number and size of the files in the repository, where a unit
 * test's time stays with the module it covers. The test runner's default
 * limit of 5 seconds is sized for the second kind, so a sweep case left
 * at that default starts to fail once the tree is large enough, with no
 * change to the case or to the rule it checks.
 *
 * Each sweep file calls `setDefaultTimeout(SWEEP_TIMEOUT)` at module
 * level, before its first `describe`, so that every case in the file
 * runs under this limit and not under the runner's default.
 */
export const SWEEP_TIMEOUT = 150_000;
