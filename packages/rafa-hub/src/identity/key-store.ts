/**
 * The hub's key store: the API keys a login creates, kept hashed in a
 * hub-wide SQLite file of the hub's own, which the `api-key` adapter
 * reads on every request. {@link HubKeyStore} is the port and
 * {@link openSqliteKeyStore} its `bun:sqlite` adapter.
 *
 * ## The file
 *
 * {@link keysFileName} names it: `rafa-hub.keys.sqlite` in the directory
 * of `hub.storePath` (the first project's store when `hub.projects` is
 * set). It is none of a project's files, neither its store, its devices
 * file (`devicesFileName`) nor its index file, so no project's merge swap
 * or listing touches it. The login credentials live in the same file,
 * in a table of their own. It is opened with `strict: true` and in WAL
 * mode, and its table is created on open when it is not there.
 *
 * ## A key
 *
 * {@link mintKey} answers `rafa_` and 32 random bytes in base64url. The
 * store keeps only its SHA-256 digest, as {@link keyDigest} spells it,
 * and answers the plain key once, from {@link HubKeyStore.create}; no
 * other call returns it, no column holds it and this module logs
 * nothing. A lookup by digest leaks nothing of the key, since the
 * digest of a random key tells nothing about the key.
 *
 * ## A row
 *
 * One row per key: its name, digest, who created it and when, its last
 * use, and whether it is paused or deleted. A name matches
 * {@link KEY_NAME} and is unique over every row, deleted ones included,
 * and never equals a name the store was opened with as reserved (the
 * variables `hub.auth.apiKeys` names), since both name a served caller.
 * A delete marks the row and keeps its name and last use, so the list
 * still shows who used the key; a deleted key is never paused, stamped
 * or created again. Timestamps are ISO-8601 strings from the injected
 * `now()`.
 *
 * ## What a refusal says
 *
 * A call the store refuses rejects with {@link HubKeyRefused}, whose
 * reason a route maps to its status and whose message names the key's
 * name, never a key or a digest.
 */
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';

/** The keys file's name, in the directory of `hub.storePath`. */
export const KEYS_FILE = 'rafa-hub.keys.sqlite';

/** What every minted key opens with. */
export const KEY_PREFIX = 'rafa_';

/** How many random bytes a minted key carries after {@link KEY_PREFIX}. */
export const KEY_BYTES = 32;

/** A key's name: a lower-case letter or digit, then up to 63 of those, `.`, `_` or `-`. */
export const KEY_NAME: RegExp = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** One key as the store lists it, never holding the key or its digest. */
export interface HubKey {
  /** The key's name, the `id` of the caller it serves. */
  readonly name: string;
  /** Who created it, as the login named them. */
  readonly createdBy: string;
  /** When it was created, ISO-8601. */
  readonly createdAt: string;
  /** When it last served a request, ISO-8601, or null when it never has. */
  readonly lastUsedAt: string | null;
  /** Whether it is paused, refused `forbidden` until it is no longer. */
  readonly paused: boolean;
  /** Whether it is deleted, refused `unauthenticated` from then on. */
  readonly deleted: boolean;
}

/** What {@link HubKeyStore.create} answers: the row and, this once, the plain key. */
export interface CreatedHubKey {
  readonly key: HubKey;
  /** The plain key, answered here alone and kept nowhere. */
  readonly plain: string;
}

/** Why the store refused a call. */
export type HubKeyRefusalReason = 'invalid-name' | 'name-taken' | 'unknown' | 'deleted';

/** A call the store refused; its message names the key's name and nothing secret. */
export class HubKeyRefused extends Error {
  override readonly name = 'HubKeyRefused';
  readonly reason: HubKeyRefusalReason;
  /** The key name the call was given. */
  readonly keyName: string;

  constructor(reason: HubKeyRefusalReason, keyName: string, message: string) {
    super(message);
    this.reason = reason;
    this.keyName = keyName;
  }
}

/** The hub's key store port; every call answers a promise, so a server-backed adapter fits. */
export interface HubKeyStore {
  /**
   * Mints a key named `name`, created by `createdBy`, keeping its digest
   * alone, and answers the plain key this once.
   *
   * @throws {HubKeyRefused} `invalid-name` when `name` is off
   *   {@link KEY_NAME} or reserved, `name-taken` when a row, deleted
   *   or not, holds it.
   */
  readonly create: (name: string, createdBy: string) => Promise<CreatedHubKey>;
  /** The key whose digest is `digest`, paused or deleted as it is, or undefined. */
  readonly findByDigest: (digest: string) => Promise<HubKey | undefined>;
  /** Every key, deleted ones included, oldest first. */
  readonly list: () => Promise<readonly HubKey[]>;
  /**
   * Pauses the key named `name`, answering its row; pausing a paused key
   * changes nothing.
   *
   * @throws {HubKeyRefused} `unknown` when no row holds `name`, `deleted`
   *   when its key is deleted.
   */
  readonly pause: (name: string) => Promise<HubKey>;
  /**
   * Marks the key named `name` deleted, keeping its name and last use,
   * and answers its row; deleting a deleted key changes nothing.
   *
   * @throws {HubKeyRefused} `unknown` when no row holds `name`.
   */
  readonly delete: (name: string) => Promise<HubKey>;
  /** Stamps the key named `name` as used now; a deleted or unknown name changes nothing. */
  readonly stampUse: (name: string) => Promise<void>;
  /** Closes the store; no call is answered after. */
  readonly close: () => void;
}

/** What {@link openSqliteKeyStore} is opened with. */
export interface SqliteKeyStoreOptions {
  /** The keys file, {@link keysFileName} of the store path, or `:memory:`. */
  readonly path: string;
  /** The clock every timestamp is read from; the system clock when left out. */
  readonly now?: () => Date;
  /** Names no key may take: the variables `hub.auth.apiKeys` names. */
  readonly reservedNames?: readonly string[];
}

/** The row as the table holds it. */
interface KeyRow {
  readonly name: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly paused: number;
  readonly deleted: number;
}

const KEYS_SCHEMA = `CREATE TABLE IF NOT EXISTS hub_keys (
  name TEXT PRIMARY KEY NOT NULL,
  digest TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
) STRICT`;

const COLUMNS = 'name, created_by AS createdBy, created_at AS createdAt, last_used_at AS lastUsedAt, paused, deleted';

const INSERT_KEY = 'INSERT INTO hub_keys (name, digest, created_by, created_at) VALUES ($name, $digest, $createdBy, $createdAt)';

const READ_BY_NAME = `SELECT ${COLUMNS} FROM hub_keys WHERE name = $name`;

const READ_BY_DIGEST = `SELECT ${COLUMNS} FROM hub_keys WHERE digest = $digest`;

const READ_ALL = `SELECT ${COLUMNS} FROM hub_keys ORDER BY created_at, name`;

const PAUSE_KEY = 'UPDATE hub_keys SET paused = 1 WHERE name = $name AND deleted = 0';

const DELETE_KEY = 'UPDATE hub_keys SET deleted = 1 WHERE name = $name';

const STAMP_KEY = 'UPDATE hub_keys SET last_used_at = $at WHERE name = $name AND deleted = 0';

/** The keys file beside the store at `storePath` (a name or a path): {@link KEYS_FILE} in its directory. */
export function keysFileName(storePath: string): string {
  return join(dirname(storePath), KEYS_FILE);
}

/**
 * A new key: {@link KEY_PREFIX} and `bytes` in base64url, 32 random
 * bytes when left out.
 *
 * @throws {RangeError} When `bytes` holds other than {@link KEY_BYTES} bytes.
 */
export function mintKey(bytes: Uint8Array = randomBytes(KEY_BYTES)): string {
  if (bytes.length !== KEY_BYTES) throw new RangeError(`a key carries ${KEY_BYTES} random bytes, not ${bytes.length}`);
  return `${KEY_PREFIX}${Buffer.from(bytes).toString('base64url')}`;
}

/** The digest the store keeps of `plain`: its SHA-256 in lower-case hex. */
export function keyDigest(plain: string): string {
  return createHash('sha256')
    .update(plain)
    .digest('hex');
}

/** The row the port answers, frozen. */
function keyOf(row: KeyRow): HubKey {
  return Object.freeze({
    name: row.name,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    paused: row.paused === 1,
    deleted: row.deleted === 1,
  });
}

/** Runs `work` now, answering its value or its throw as a promise. */
function settle<T>(work: () => T): Promise<T> {
  return new Promise((resolve) => {
    resolve(work());
  });
}

/** Refuses `name` when it is off {@link KEY_NAME} or among `reserved`. */
function refuseName(name: string, reserved: ReadonlySet<string>): void {
  if (!KEY_NAME.test(name)) {
    throw new HubKeyRefused('invalid-name', name, `a key name is a lower-case letter or digit, then up to 63 of those, ".", "_" or "-"; "${name}" is not`);
  }
  if (reserved.has(name)) {
    throw new HubKeyRefused('invalid-name', name, `key name ${name} is a variable hub.auth.apiKeys names; pick another`);
  }
}

/**
 * Opens the key store at `options.path`, creating the file and its table
 * when they are not there.
 */
export function openSqliteKeyStore(options: SqliteKeyStoreOptions): HubKeyStore {
  const now = options.now ?? (() => new Date());
  const reserved: ReadonlySet<string> = new Set(options.reservedNames ?? []);
  const db = new Database(options.path, { create: true, readwrite: true, strict: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run(KEYS_SCHEMA);

  const byName = (name: string): KeyRow | null => db.query<KeyRow, { name: string }>(READ_BY_NAME).get({ name });

  /** The row named `name`, refusing a name no row holds. */
  const known = (name: string): KeyRow => {
    const row = byName(name);
    if (row === null) throw new HubKeyRefused('unknown', name, `no key is named ${name}`);
    return row;
  };

  const create = (name: string, createdBy: string): CreatedHubKey => {
    refuseName(name, reserved);
    if (byName(name) !== null) {
      throw new HubKeyRefused('name-taken', name, `a key named ${name} exists, or was deleted; names are never reused, so pick another`);
    }
    const plain = mintKey();
    db.query(INSERT_KEY).run({ name, digest: keyDigest(plain), createdBy, createdAt: now().toISOString() });
    return Object.freeze({ key: keyOf(known(name)), plain });
  };

  const pause = (name: string): HubKey => {
    if (known(name).deleted === 1) throw new HubKeyRefused('deleted', name, `key ${name} is deleted, so it cannot be paused`);
    db.query(PAUSE_KEY).run({ name });
    return keyOf(known(name));
  };

  const remove = (name: string): HubKey => {
    known(name);
    db.query(DELETE_KEY).run({ name });
    return keyOf(known(name));
  };

  return {
    create: (name, createdBy) => settle(() => create(name, createdBy)),
    findByDigest: (digest) => settle(() => {
      const row = db.query<KeyRow, { digest: string }>(READ_BY_DIGEST).get({ digest });
      return row === null
        ? undefined
        : keyOf(row);
    }),
    list: () => settle(() => Object.freeze(db
      .query<KeyRow, []>(READ_ALL)
      .all()
      .map(keyOf))),
    pause: (name) => settle(() => pause(name)),
    delete: (name) => settle(() => remove(name)),
    stampUse: (name) => settle(() => {
      db.query(STAMP_KEY).run({ name, at: now().toISOString() });
    }),
    close: () => {
      db.close();
    },
  };
}
