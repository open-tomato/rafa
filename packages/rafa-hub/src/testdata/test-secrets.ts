/**
 * The hub token a spawned rafa CLI reads in a test, planted in a scratch
 * file rather than the system secret store: what
 * `two-devices.integration.test.ts` and
 * `hub-unreachable.integration.test.ts` both hand their devices.
 *
 * `rafa-sync-service`'s `defaultSecretReader` (`token.ts`) reads the
 * token from the JSON file `RAFA_TEST_SECRETS_FILE` names when the
 * process also has `RAFA_TEST=1`, and from `Bun.secrets` otherwise. So a
 * suite writes the token with {@link plantTestSecret} and spawns its CLI
 * under {@link testSecretsChildEnv}: no Keychain dialog on macOS, no
 * credential written to a Linux desktop's keyring, and the same run on
 * every machine and in CI. The package is never imported here, so the
 * service and the variable are spelled again below.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { scratchHomeEnv } from './scratch-home-env.js';

/** Where every rafa secret lives (`packages/rafa-sync-service/src/token.ts`'s `SECRET_SERVICE`). */
const SECRET_SERVICE = 'rafa';

/** The variable naming the secrets file (`token.ts`'s `TEST_SECRETS_FILE_VARIABLE`). */
const TEST_SECRETS_FILE_VARIABLE = 'RAFA_TEST_SECRETS_FILE';

/** The secrets file's name under the directory a suite plants it in. */
const TEST_SECRETS_FILE_NAME = 'test-secrets.json';

/** Where {@link plantTestSecret} writes the secrets file under `dir`. */
export function testSecretsFileIn(dir: string): string {
  return join(dir, TEST_SECRETS_FILE_NAME);
}

/**
 * Writes the secrets file under `dir`, holding `value` under service
 * `rafa` and `name`, and answers its path.
 */
export function plantTestSecret(dir: string, name: string, value: string): string {
  const path = testSecretsFileIn(dir);
  writeFileSync(path, JSON.stringify({ [SECRET_SERVICE]: { [name]: value } }), 'utf8');
  return path;
}

/**
 * The environment a spawned CLI reads its token under: the scratch HOME
 * variables, `RAFA_TEST=1` and the secrets file at `secretsFile`.
 */
export function testSecretsChildEnv(home: string, secretsFile: string): Readonly<Record<string, string>> {
  return { ...scratchHomeEnv(home), RAFA_TEST: '1', [TEST_SECRETS_FILE_VARIABLE]: secretsFile };
}
