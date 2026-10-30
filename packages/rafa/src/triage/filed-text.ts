/**
 * What every filed text shares: the module a draft is filed under when
 * nothing names one, and the secrets every filed text is redacted of.
 *
 * {@link TRIAGE_MODULE}, `unassigned`, is the module a draft is filed
 * under when its record names none or `unknown`: the module the GitHub
 * adapter's `get` answers for an issue with no module label. Triage
 * (`packages/rafa-pr/src/triage/triage.ts`), `rafa issue create`, the bug record's fill
 * and the release and follow-up issues all file under it.
 *
 * {@link namedSecrets} answers the value of every `env` item under
 * `prerequisites`, both tiers, and of each of {@link SECRET_ENV_NAMES}
 * that is set. {@link redactSecrets} replaces each value with
 * `[redacted: <NAME>]`. Every value a session or the plan supplied goes
 * through it before it reaches a title, a body, a comment or a `find`
 * query; the note of `packages/rafa-pr/src/triage/triage.ts` holds why the key is built
 * from the redacted artifact and the title cut after redaction.
 */
import type { RafaConfig } from '../core/config/index.js';

/** The variables named as secrets whatever the config says, each when set. */
export const SECRET_ENV_NAMES = ['GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'LINEAR_API_KEY'] as const;

/** The module every triage draft names; see the module note. */
export const TRIAGE_MODULE = 'unassigned';

/** One named secret: the variable's name and the value it held. */
export interface NamedSecret {
  readonly name: string;
  readonly value: string;
}

/** The environment a secret's value is read from. */
export type SecretEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * The named secrets, in order: each `env` item of `prerequisites.required`
 * then `prerequisites.optional`, then {@link SECRET_ENV_NAMES}, each name
 * once, at its first place. A variable that is unset, empty or blank names
 * nothing, since there is no value to take out.
 */
export function namedSecrets(
  config: Pick<RafaConfig, 'prerequisitesRequired' | 'prerequisitesOptional'>,
  env: SecretEnvironment,
): readonly NamedSecret[] {
  const configured = [...config.prerequisitesRequired, ...config.prerequisitesOptional]
    .filter((item) => item.kind === 'env')
    .map((item) => item.name);
  const names = [...new Set([...configured, ...SECRET_ENV_NAMES])];
  return names.flatMap((name) => {
    const value = env[name];
    return typeof value === 'string' && value.trim().length > 0
      ? [{ name, value }]
      : [];
  });
}

/** A text matched literally inside a regular expression. */
function literalPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `text` with every value of `secrets` replaced by `[redacted: <NAME>]`.
 *
 * A value is matched byte for byte, and also with its surrounding
 * whitespace trimmed when it has some, as a variable read from a file
 * often does. Two names holding one value are both redacted under the
 * first. The replacement is one pass that tries longer values first, so a
 * value holding another is replaced whole, and a marker already written is
 * never matched again.
 */
export function redactSecrets(text: string, secrets: readonly NamedSecret[]): string {
  const nameByValue = new Map<string, string>();
  for (const { name, value } of secrets) {
    for (const form of [value, value.trim()]) {
      if (form.trim().length > 0 && !nameByValue.has(form)) nameByValue.set(form, name);
    }
  }
  if (nameByValue.size === 0) return text;

  const values = [...nameByValue.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(values.map(literalPattern).join('|'), 'g');
  return text.replace(pattern, (value) => `[redacted: ${nameByValue.get(value)}]`);
}
