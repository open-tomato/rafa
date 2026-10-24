/**
 * How a pull request is merged: the {@link MergeMethod} words, the
 * {@link MERGE_METHODS} list a reader validates against and the
 * {@link isMergeMethod} guard.
 *
 * They sat in `src/pr/types.ts`, the pull request port, until the
 * monorepo cut: the `pr.mergeMethod` setting in
 * `packages/rafa/src/config-schema-release.ts` read them there, which tied the
 * release section to `src/pr/`. Here they are a core leaf, importing
 * nothing, so the section and the port both read them from the sections
 * barrel `./sections.ts`, and `src/pr/types.ts` re-exports them under
 * the same names for the port's own importers.
 *
 * The setting's reader, `mergeMethod`, stays in
 * `packages/rafa/src/config-schema-release.ts` beside the one setting that reads it:
 * this file holds the words, not a reading of the config.
 */

/**
 * How a merge is made. GitHub's three, and no other: `gh pr merge`
 * takes exactly `--squash`, `--merge` and `--rebase`, and a provider
 * that cannot do one of them refuses the call rather than substituting
 * another, which would rewrite history the operator did not ask for.
 */
export type MergeMethod = 'squash' | 'merge' | 'rebase';

/**
 * The merge methods, in the order a refusal lists them.
 *
 * A runtime value beside the type so the config reader and the
 * `--method` flag validate against one list rather than each spelling
 * the three words again. Frozen: a caller that pushed onto it would
 * change what every later refusal says it accepts.
 */
export const MERGE_METHODS: readonly MergeMethod[] = Object.freeze([
  'squash',
  'merge',
  'rebase',
] as const);

/**
 * Whether a value is one of {@link MERGE_METHODS}.
 *
 * @param value - Anything, a flag's value or a config reading.
 * @returns True when the value is exactly one of the three words.
 */
export function isMergeMethod(value: unknown): value is MergeMethod {
  return typeof value === 'string'
    && (MERGE_METHODS as readonly string[]).includes(value);
}
