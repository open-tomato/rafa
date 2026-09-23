/**
 * The secret-name scan `rafa plan risk` reports: which environment
 * variables a run would inherit whose NAME says they hold a credential.
 *
 * A name is reported when it matches one of {@link SECRET_NAME_SHAPES}:
 * `*_TOKEN`, `*_KEY`, `*_SECRET`, `*PASSWORD*` or `AWS_*`. Names are
 * matched as written, case-sensitively, the way the shell spells them;
 * `github_token` is not reported.
 *
 * Secret VALUES are never read. The scan takes `Object.keys` of the
 * environment it is handed and nothing else, so no value can reach a
 * finding, its text or a report built from it. The environment arrives
 * as an argument: this module never reaches `process.env` itself.
 */

import type { RiskLevel } from './commands.js';

/** One shape a credential-bearing variable name takes. */
export interface SecretNameShape {
  /** The shape as the report prints it, e.g. `*_TOKEN`. */
  readonly name: string;
  /** The expression a variable name is tested against; never global. */
  readonly expression: RegExp;
}

/** The fixed list of secret-name shapes, in the spec's order. */
export const SECRET_NAME_SHAPES: readonly SecretNameShape[] = [
  { name: '*_TOKEN', expression: /_TOKEN$/ },
  { name: '*_KEY', expression: /_KEY$/ },
  { name: '*_SECRET', expression: /_SECRET$/ },
  { name: '*PASSWORD*', expression: /PASSWORD/ },
  { name: 'AWS_*', expression: /^AWS_/ },
];

/** One variable name the scan reports. */
export interface SecretFinding {
  /** Always `note`: a name in the environment is a thing to know, not a refusal. */
  readonly level: RiskLevel;
  /** Always `secret`. */
  readonly kind: 'secret';
  /** The line a report prints, e.g. `GITHUB_TOKEN — matches *_TOKEN`. */
  readonly text: string;
  /** The variable's name. */
  readonly subject: string;
}

/**
 * The shapes one variable name matches, in list order.
 *
 * @param name - A variable name.
 * @returns Every shape it matches; empty when it names no secret.
 */
export function secretShapesOf(name: string): readonly SecretNameShape[] {
  return SECRET_NAME_SHAPES.filter((shape) => shape.expression.test(name));
}

/**
 * Scans the NAMES of an environment for credential-bearing variables.
 *
 * @param environment - The environment a run would inherit; only its
 *   keys are read.
 * @returns One `note` finding per matching name, sorted by name.
 */
export function scanSecretNames(
  environment: Readonly<Record<string, string | undefined>>,
): readonly SecretFinding[] {
  return [...Object.keys(environment)]
    .sort()
    .flatMap((name) => {
      const shapes = secretShapesOf(name);
      if (shapes.length === 0) {
        return [];
      }
      const matched = shapes.map((shape) => shape.name).join(', ');
      return [{ level: 'note', kind: 'secret', text: `${name} — matches ${matched}`, subject: name }];
    });
}
