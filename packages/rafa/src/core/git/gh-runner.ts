/**
 * The seam every `gh` command goes through: the runner's type and what
 * one command answers.
 *
 * Declared here, below the `github` tracker that spawns `gh`, so the
 * adapter registry types its `gh` option without importing the tracker.
 * `packages/rafa-board/src/adapters/tracker/github.ts` imports both names from this file
 * and re-exports them under the same names, so none of its importers
 * changes.
 */

/** What one `gh` command answered. */
export interface GhResult {
  /** True when `gh` exited 0. */
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs `gh` with the arguments after its name. A command that fails,
 * or could not be run, answers `ok` false rather than rejecting.
 * `stdin`, when given, is the whole of what `gh` reads on its standard
 * input; left out, `gh` reads a closed one.
 */
export type GhRunner = (args: readonly string[], stdin?: string) => Promise<GhResult>;
