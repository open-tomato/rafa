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
 * touch the real keychain; {@link bunSecretReader} is the default.
 */

/** The secret store service every rafa secret lives under. */
export const SECRET_SERVICE = 'rafa';

/** Reads one secret by service and name; null when none is stored. */
export type SecretReader = (options: {
  readonly service: string;
  readonly name: string;
}) => Promise<string | null>;

/** The real reader: `Bun.secrets.get`. */
export const bunSecretReader: SecretReader = async (options) => Bun.secrets.get(options);

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
