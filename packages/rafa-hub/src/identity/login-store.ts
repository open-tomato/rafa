/**
 * The hub's login credential store: the one user name and password that
 * sign in to the key routes, kept as a `Bun.password` hash in the hub's
 * keys file. {@link HubLoginStore} is the port and
 * {@link openSqliteLoginStore} its `bun:sqlite` adapter.
 *
 * ## The file
 *
 * The keys file `keysFileName` names (`rafa-hub.keys.sqlite` beside
 * `hub.storePath`), in a table of its own, `hub_login`, beside the key
 * store's `hub_keys`. It is opened with `strict: true` and in WAL mode,
 * and its table is created on open when it is not there.
 *
 * ## One login
 *
 * The table holds one row at most: a user name, the hash of its
 * password and when it was set, an ISO-8601 string from the injected
 * `now()`. {@link HubLoginStore.setLogin} replaces the row, so a second
 * call changes the login rather than adding one. The password is never
 * stored, answered or logged; only its hash, which `Bun.password.hash`
 * salts (argon2id by default), is written.
 *
 * ## A check
 *
 * {@link HubLoginStore.verifyLogin} answers true only when the user name
 * is the login's and the password verifies against its hash. A wrong
 * name, or no login at all, still runs one verify against a hash of
 * nothing anyone knows, so the answer takes about as long whichever
 * half was wrong.
 *
 * ## The bootstrap
 *
 * {@link bootstrapLoginFromEnv} sets the login from
 * {@link LOGIN_USER_VARIABLE} and {@link LOGIN_PASSWORD_VARIABLE} when no
 * login is set, and leaves a set one as it is, so a restart with the
 * variables still exported never undoes a change made since.
 *
 * ## A user name the basic login can carry
 *
 * `Authorization: Basic` splits its pair at the first colon, so a user
 * name holding one could never be verified. {@link HubLoginStore.setLogin}
 * refuses it with a `RangeError`, whichever caller hands it in: the
 * `rafa-hub login` prompt and {@link LOGIN_USER_VARIABLE} alike.
 */
import { randomBytes } from 'node:crypto';

import { Database } from 'bun:sqlite';

/** The variable {@link bootstrapLoginFromEnv} reads the login's user name from. */
export const LOGIN_USER_VARIABLE = 'RAFA_HUB_LOGIN_USER';

/** The variable {@link bootstrapLoginFromEnv} reads the login's password from. */
export const LOGIN_PASSWORD_VARIABLE = 'RAFA_HUB_LOGIN_PASSWORD';

/** The login as the store answers it, never holding the password or its hash. */
export interface HubLogin {
  /** The user name the login signs in with. */
  readonly user: string;
  /** When it was set, ISO-8601. */
  readonly setAt: string;
}

/** The hub's login store port; every call answers a promise, so a server-backed adapter fits. */
export interface HubLoginStore {
  /**
   * Sets the login to `user` and the hash of `password`, replacing any
   * login set before, and answers it.
   *
   * @throws {RangeError} When `user` or `password` is empty, or `user`
   *   opens or ends with white space or holds a `:`, which
   *   `Authorization: Basic` splits the pair at, so no request could
   *   carry it.
   */
  readonly setLogin: (user: string, password: string) => Promise<HubLogin>;
  /** Whether a login is set. */
  readonly hasLogin: () => Promise<boolean>;
  /** Whether `user` is the login's user name and `password` verifies against its hash. */
  readonly verifyLogin: (user: string, password: string) => Promise<boolean>;
  /** Closes the store; no call is answered after. */
  readonly close: () => void;
}

/** What {@link openSqliteLoginStore} is opened with. */
export interface SqliteLoginStoreOptions {
  /** The keys file, `keysFileName` of the store path, or `:memory:`. */
  readonly path: string;
  /** The clock `setAt` is read from; the system clock when left out. */
  readonly now?: () => Date;
}

/** What {@link bootstrapLoginFromEnv} did. */
export type LoginBootstrap =
  /** The login was set from the two variables. */
  | { readonly outcome: 'set'; readonly login: HubLogin }
  /** A login was set already, and was left as it is. */
  | { readonly outcome: 'kept' }
  /** Neither variable holds a value, and no login is set. */
  | { readonly outcome: 'unset' }
  /** One variable holds a value and the other none, so nothing was set; `missing` names the empty one. */
  | { readonly outcome: 'incomplete'; readonly missing: string };

/** The row as the table holds it. */
interface LoginRow {
  readonly user: string;
  readonly hash: string;
  readonly setAt: string;
}

const LOGIN_SCHEMA = `CREATE TABLE IF NOT EXISTS hub_login (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  user TEXT NOT NULL,
  hash TEXT NOT NULL,
  set_at TEXT NOT NULL
) STRICT`;

const WRITE_LOGIN = `INSERT INTO hub_login (id, user, hash, set_at) VALUES (1, $user, $hash, $setAt)
  ON CONFLICT (id) DO UPDATE SET user = excluded.user, hash = excluded.hash, set_at = excluded.set_at`;

const READ_LOGIN = 'SELECT user, hash, set_at AS setAt FROM hub_login WHERE id = 1';

/** A hash of a password nobody knows, verified against when there is no login to check, made once. */
let decoyHash: Promise<string> | undefined;

/** The hash a check runs against when the name is wrong or no login is set. */
function decoy(): Promise<string> {
  decoyHash ??= Bun.password.hash(randomBytes(32).toString('base64url'));
  return decoyHash;
}

/** Refuses an empty `user` or `password`, or a `user` with white space at either end or holding a `:`. */
function refuseCredentials(user: string, password: string): void {
  if (user.length === 0) throw new RangeError('a login\'s user name is not empty');
  if (user.trim() !== user) throw new RangeError('a login\'s user name neither opens nor ends with white space');
  if (user.includes(':')) throw new RangeError('a login\'s user name holds no ":", which Authorization: Basic could not carry');
  if (password.length === 0) throw new RangeError('a login\'s password is not empty');
}

/**
 * Opens the login store at `options.path`, creating the file and its
 * table when they are not there.
 */
export function openSqliteLoginStore(options: SqliteLoginStoreOptions): HubLoginStore {
  const now = options.now ?? (() => new Date());
  const db = new Database(options.path, { create: true, readwrite: true, strict: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run(LOGIN_SCHEMA);

  const read = (): LoginRow | null => db.query<LoginRow, []>(READ_LOGIN).get();

  const setLogin = async (user: string, password: string): Promise<HubLogin> => {
    refuseCredentials(user, password);
    const hash = await Bun.password.hash(password);
    const setAt = now().toISOString();
    db.query(WRITE_LOGIN).run({ user, hash, setAt });
    return Object.freeze({ user, setAt });
  };

  const verifyLogin = async (user: string, password: string): Promise<boolean> => {
    const row = read();
    const known = row !== null && row.user === user;
    const hash = known
      ? row.hash
      : await decoy();
    const verified = await Bun.password.verify(password, hash);
    return known && verified;
  };

  return {
    setLogin,
    hasLogin: async () => read() !== null,
    verifyLogin,
    close: () => {
      db.close();
    },
  };
}

/**
 * Sets the login from `env`'s {@link LOGIN_USER_VARIABLE} and
 * {@link LOGIN_PASSWORD_VARIABLE} when `store` holds none, and answers
 * what it did. A set login is kept whatever the variables hold; an
 * empty variable counts as unset, and one set without the other sets
 * nothing.
 *
 * @throws {RangeError} When the user name opens or ends with white space
 *   or holds a `:`.
 */
export async function bootstrapLoginFromEnv(
  store: HubLoginStore,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<LoginBootstrap> {
  if (await store.hasLogin()) return { outcome: 'kept' };
  const user = env[LOGIN_USER_VARIABLE] ?? '';
  const password = env[LOGIN_PASSWORD_VARIABLE] ?? '';
  if (user === '' && password === '') return { outcome: 'unset' };
  if (user === '') return { outcome: 'incomplete', missing: LOGIN_USER_VARIABLE };
  if (password === '') return { outcome: 'incomplete', missing: LOGIN_PASSWORD_VARIABLE };
  return { outcome: 'set', login: await store.setLogin(user, password) };
}
