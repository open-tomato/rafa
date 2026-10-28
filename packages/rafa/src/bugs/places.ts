/**
 * The places a bug is seen in (#951): the ones every project has, and
 * the one rafa suggests.
 *
 * A place names WHERE a bug showed: `local`, `ci`, `prod`, or one a
 * project adds under `issues.environments`. What was running belongs to
 * the record's `action` and `reproduce`.
 *
 * rafa suggests `ci` when the `CI` variable is set to anything but
 * nothing, `0` or `false`, and `local` otherwise. A filer's `--env` wins
 * over the suggestion.
 *
 * This module imports nothing, so the config schema
 * (`packages/rafa/src/config-schema-issues.ts`) reads the built-in places without
 * reaching the modules that read the config.
 */

/** The places every project has, in the order a refusal lists them. */
export const BUILT_IN_ENVIRONMENTS = ['local', 'ci', 'prod'] as const;

/** The values of `CI` that say the run is not one. */
const CI_OFF: readonly string[] = ['', '0', 'false'];

/** The place rafa suggests for a run with the environment `env`; see the module note. */
export function suggestedEnvironment(env: Readonly<Record<string, string | undefined>>): 'ci' | 'local' {
  return CI_OFF.includes((env['CI'] ?? '').trim().toLowerCase())
    ? 'local'
    : 'ci';
}
