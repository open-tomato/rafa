/**
 * What waits to be settled on a base branch: the reading the settle dry
 * run answers with when it folds the fragments there into a version.
 *
 * {@link SettleWaiting} is the shape two readers of that dry run share:
 * `rafa pr merge`'s settle follow-up, which turns it into the line
 * `<n> fragments wait on <base> and fold into <version>`, and `rafa
 * next`'s settle step (`src/next/settle-step.ts`), which turns it into
 * a state of its chain.
 *
 * This is a library half of `src/commands/pr/merge-followups.ts`, which
 * keeps the follow-ups rule, imports this type and holds no re-export
 * of it; the other symbol that left that file is `versionTag`, in
 * `src/release/version-tag.ts`. Nothing here imports from
 * `src/commands/`, or from anywhere else.
 */

/**
 * What the settle dry run folded on the base branch: the fragments
 * waiting there and the version they fold into.
 */
export interface SettleWaiting {
  /** The base branch the fragments wait on, e.g. `main`. */
  readonly base: string;
  /** How many fragments the fold took, `level: none` ones included. */
  readonly fragments: number;
  /** The version settle would write. */
  readonly version: string;
}
