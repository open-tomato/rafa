/**
 * The client's token reader: the GitHub token the `service` sync
 * strategy sends to `rafa-hub`, read from the system secret store
 * through `Bun.secrets` under service {@link SECRET_SERVICE}, with the
 * name `hub.tokenSecret` holds.
 *
 * Config holds the secret's NAME, never the token. A missing name
 * (`hub.tokenSecret` unset) and a missing or empty secret are each
 * refused with a {@link HubTokenError} whose message names how to fix
 * it, since syncing without a token would only be refused by the hub.
 *
 * The store is an injectable {@link SecretReader} seam so tests never
 * touch the real keychain; {@link defaultSecretReader} picks the reader
 * a command uses. It is {@link bunSecretReader} unless the process is a
 * test process (`RAFA_TEST=1`) naming a secrets file in
 * `RAFA_TEST_SECRETS_FILE`: then it is {@link fileSecretReader} over that
 * file, so a suite spawning the CLI hands its child a token without the
 * system secret store, which a scratch HOME cannot reach on macOS.
 */

import { readFileSync } from 'node:fs';

/** The secret store service every rafa secret lives under. */
export const SECRET_SERVICE = 'rafa';

/** Reads one secret by service and name; null when none is stored. */
export type SecretReader = (options: {
  readonly service: string;
  readonly name: string;
}) => Promise<string | null>;

/** The real reader: `Bun.secrets.get`. */
export const bunSecretReader: SecretReader = async (options) => Bun.secrets.get(options);

/** The variable that, beside `RAFA_TEST=1`, names a test process's secrets file. */
export const TEST_SECRETS_FILE_VARIABLE = 'RAFA_TEST_SECRETS_FILE';

/** The environment {@link defaultSecretReader} reads, `process.env`'s shape. */
export type SecretEnvironment = Readonly<Record<string, string | undefined>>;

/** True for a value shaped `{ "<name>": "<secret>" }`. */
function isNameTable(value: unknown): value is Readonly<Record<string, string>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((secret) => typeof secret === 'string');
}

/** A secrets file's whole shape: `{ "<service>": { "<name>": "<secret>" } }`. */
type SecretsFile = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** True for a value shaped {@link SecretsFile}. */
function isSecretsFile(value: unknown): value is SecretsFile {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every(isNameTable);
}

/** The secrets file at `path`, refused naming the file when it is unreadable or misshapen. */
function readSecretsFile(path: string): SecretsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`the test secrets file ${path} could not be read as JSON: ${String(error)}`);
  }
  if (!isSecretsFile(parsed)) {
    throw new Error(`the test secrets file ${path} is not shaped { "<service>": { "<name>": "<secret>" } }`);
  }
  return parsed;
}

/**
 * A reader over the JSON file at `path`, shaped
 * `{ "<service>": { "<name>": "<secret>" } }` and read on each lookup;
 * null for a secret the file does not hold.
 */
export function fileSecretReader(path: string): SecretReader {
  return async ({ service, name }) => readSecretsFile(path)[service]?.[name] ?? null;
}

/**
 * The reader a command uses: {@link fileSecretReader} over
 * `RAFA_TEST_SECRETS_FILE` when `RAFA_TEST` is exactly `1` and the file
 * is named, {@link bunSecretReader} otherwise; see the module note.
 */
export function defaultSecretReader(env: SecretEnvironment = process.env): SecretReader {
  const file = env[TEST_SECRETS_FILE_VARIABLE];
  return env.RAFA_TEST === '1' && file !== undefined && file !== ''
    ? fileSecretReader(file)
    : bunSecretReader;
}

/** A token that cannot be read, with a message naming the fix. */
export class HubTokenError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'HubTokenError';
  }
}

/**
 * Reads the hub token named by `tokenSecret` (the resolved
 * `hub.tokenSecret`), refusing a null name or a missing or empty secret.
 */
export async function readHubToken(
  tokenSecret: string | null,
  read: SecretReader = bunSecretReader,
): Promise<string> {
  if (tokenSecret === null) {
    throw new HubTokenError(
      'hub.tokenSecret is not set: name the secret holding the hub token in .rafa/config.yaml',
    );
  }
  const token = await read({ service: SECRET_SERVICE, name: tokenSecret });
  if (token === null || token === '') {
    throw new HubTokenError(
      `no hub token is stored under service "${SECRET_SERVICE}", name "${tokenSecret}": store one with `
      + `bun -e 'await Bun.secrets.set({ service: "${SECRET_SERVICE}", name: "${tokenSecret}", value: "<token>" })'`,
    );
  }
  return token;
}
