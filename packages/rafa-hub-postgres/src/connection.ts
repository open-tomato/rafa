/**
 * The connector's connection opener: it reads the Postgres URL from the
 * environment variable `hub.store.postgres.urlVariable` names, opens a
 * `Bun.sql` client on it, and reads `pg_extension` before anything else
 * runs, so a hub on a database without the extensions the connector
 * needs refuses at start rather than on its first search.
 *
 * ## The URL never leaves the variable
 *
 * The URL comes from the environment alone, never from a file, and the
 * opener takes the variable's name, never its value. An unset or empty
 * variable (white space alone counts as empty) refuses the open naming
 * the variable; no refusal here repeats the value, since a URL carries
 * the database's password.
 *
 * ## The extensions the connector needs
 *
 * Two, each named in a refusal as the operator installs it:
 *
 *   - `pg_search`, ParadeDB's BM25 index, the index half's `fts`;
 *   - `pgvector`, listed in `pg_extension` as `vector`, the index half's
 *     `vector`.
 *
 * A database missing either refuses the open with one message naming
 * each missing one, and the client is closed before the refusal leaves.
 *
 * Nothing here is exported from the package's entry: the `Bun.sql`
 * client it answers stays inside the connector under the leak rule.
 */
import { SQL } from 'bun';

/** An extension the connector needs: the name a refusal gives and the one `pg_extension` lists. */
export interface RequiredExtension {
  /** The name the operator installs it by, as a refusal names it. */
  readonly name: string;
  /** Its `extname` in `pg_extension`. */
  readonly extname: string;
}

/** The extensions the connector needs, in the order a refusal names them. */
export const REQUIRED_EXTENSIONS: readonly RequiredExtension[] = Object.freeze([
  { name: 'pg_search', extname: 'pg_search' },
  { name: 'pgvector', extname: 'vector' },
]);

/** Reads the `extname` of every extension the database has loaded. */
export type ExtensionReader = (client: SQL) => Promise<readonly string[]>;

/** The environment the opener reads the URL from. */
export type UrlEnvironment = Readonly<Record<string, string | undefined>>;

/** Options of {@link openPostgresConnection}. */
export interface OpenPostgresOptions {
  /** The name of the variable holding the URL: `hub.store.postgres.urlVariable`. */
  readonly urlVariable: string;
  /** The environment to read it from; `process.env` when left out. */
  readonly env?: UrlEnvironment;
  /** Reads the loaded extensions; {@link readLoadedExtensions} when left out. */
  readonly readExtensions?: ExtensionReader;
  /** Opens the client on the URL; `new SQL(url)` when left out. */
  readonly connect?: (url: string) => SQL;
}

/** An open connection whose database holds every extension the connector needs. */
export interface PostgresConnection {
  /** The `Bun.sql` client, the connector's own. */
  readonly client: SQL;
  /** The `extname` of every loaded extension, sorted, as `pg_extension` listed them. */
  readonly extensions: readonly string[];
}

/**
 * The URL the variable holds, refusing an unset or empty one by the
 * variable's name. The refusal never repeats the value.
 */
export function readPostgresUrl(urlVariable: string, env: UrlEnvironment): string {
  const value = env[urlVariable];
  if (value === undefined) {
    throw new Error(`hub postgres: the environment variable ${urlVariable} is unset; set it to the Postgres URL the hub stores in`);
  }
  if (value.trim() === '') {
    throw new Error(`hub postgres: the environment variable ${urlVariable} is empty; set it to the Postgres URL the hub stores in`);
  }
  return value;
}

/** The names of the required extensions a database's loaded `extname`s miss, in refusal order. */
export function missingExtensions(loaded: readonly string[]): string[] {
  return REQUIRED_EXTENSIONS.filter(({ extname }) => !loaded.includes(extname)).map(({ name }) => name);
}

/** The refusal for a database missing extensions, naming each missing one. */
export function missingExtensionsMessage(missing: readonly string[]): string {
  const noun = missing.length === 1
    ? 'extension'
    : 'extensions';
  return `hub postgres: the database lacks the ${noun} ${missing.join(' and ')}; install ${missing.join(' and ')} on it (CREATE EXTENSION) before the hub starts on postgres`;
}

/** Reads `pg_extension`: the `extname` of every extension the database has loaded. */
export async function readLoadedExtensions(client: SQL): Promise<readonly string[]> {
  const rows = await client.unsafe<{ extname: string }[]>('SELECT extname FROM pg_extension');
  return rows.map((row) => row.extname);
}

/**
 * Opens the connector's connection: reads the URL from the configured
 * variable, opens the client, reads `pg_extension` and refuses, with the
 * client closed, when the database misses `pg_search` or `pgvector`.
 */
export async function openPostgresConnection(options: OpenPostgresOptions): Promise<PostgresConnection> {
  const url = readPostgresUrl(options.urlVariable, options.env ?? process.env);
  const client = (options.connect ?? ((value: string) => new SQL(value)))(url);
  try {
    const loaded = [...await (options.readExtensions ?? readLoadedExtensions)(client)].sort();
    const missing = missingExtensions(loaded);
    if (missing.length > 0) throw new Error(missingExtensionsMessage(missing));
    return { client, extensions: loaded };
  } catch (error) {
    await client.close();
    throw error;
  }
}
