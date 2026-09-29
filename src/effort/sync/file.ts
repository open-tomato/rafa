/**
 * The `file` sync strategy: a device's effort store carried to another
 * device as a file, with no server between them.
 *
 * ## Push
 *
 * Push copies this project's store into the directory the request's `to`
 * names, through `copyEffortStore` (`src/effort/store/copy.ts`), the copy
 * `rafa effort copy` makes: `effort.sqlite` written by a read-only
 * `VACUUM INTO`, so the store is never written and a loop running beside
 * it is not disturbed. It answers `pushed` with the path of the copy's
 * `effort.sqlite`, the one file the person carries. The whole snapshot
 * goes every time and no watermark of an earlier push is kept, since
 * the merge on the other side skips every row it already holds.
 *
 * `to` is read against the repository root when it is relative, as
 * `rafa effort copy --to` reads it. A target that is a file or a
 * directory holding anything is refused by the copy with nothing made
 * (`EffortCopyRefusal`), and a read or write that failed is thrown as
 * `EffortCopyFailure` with what the copy made removed; both pass through
 * unchanged. Two refusals of this module's own come first, each making
 * nothing, as {@link FileSyncRefusal}:
 *
 *   - A project whose `store` is `ndjson`. Its sessions and commits are
 *     NDJSON files, so the `effort.sqlite` it carried would hold none of
 *     them, and the other device's merge would take it without a word.
 *     The text names `rafa effort move --to=sqlite`, as the merge's own
 *     refusal of such a project does.
 *   - A store directory holding no `effort.sqlite`: a copy of its NDJSON
 *     files alone carries nothing a merge reads.
 *
 * ## Pull
 *
 * Pull merges the `effort.sqlite` the request's `from` names into this
 * project's store through `mergeStore` (`src/effort/store/merge-store.ts`,
 * whose note is the long form), as `rafa effort merge` does, and answers
 * `pulled` with the merge's own `MergeResult`. `dryRun` is the merge's.
 * `from` is read against the repository root when it is relative; a
 * caller holding a path typed at a shell resolves it against its own
 * directory first, as `rafa effort merge` does. Every refusal is the
 * merge's own (`MergeRefusal`, `RebuildRefusal`,
 * `DevelopmentBuildRefusedError`, `UnionSchemaMismatch`), passed through
 * unchanged, so a caller maps them as `rafa effort merge` does; the NDJSON
 * refusal is among them. The parallel and backup files are stamped from
 * the clock as `fileStamp` (`src/commands/effort/fix-schema.ts`) spells
 * it, the spelling `rafa effort merge` uses.
 *
 * ## Which store
 *
 * Both directions act on the store every other command opens:
 * `RAFA_EFFORT_DIR` when it is set, `<root>/.rafa/effort/` otherwise
 * (`effortStoreDir`, `location.ts`), read from the environment the
 * {@link FileSyncOptions} name, `process.env` when they name none.
 *
 * ## The backend
 *
 * The project's resolved `store` is handed in, never read here, for the
 * reason `mergeStore` gives: resolution has one owner, the config. Core
 * registers the strategy as `sync/file` in `CORE_ADAPTER_REGISTRY`
 * (`src/adapters/registry.ts`), whose `create` reads it off the
 * context's `store` and refuses a context naming none: defaulting it to
 * `sqlite` would carry an NDJSON project's store without its sessions.
 *
 * Push and pull are async only to fill the port: each runs to its end
 * before it answers, and a throw is answered as a rejection.
 */
import type { StoreBackend } from '../../config.js';
import type { Sync, SyncPullRequest, SyncPullResult, SyncPushRequest, SyncPushResult } from '../../ports/index.js';
import type { DevelopmentProbe } from '../store/development-build.js';
import type { MergeOptions } from '../store/merge-store.js';

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { fileStamp } from '../../commands/effort/fix-schema.js';
import { describeValue } from '../../config-sections.js';
import { copyEffortStore } from '../store/copy.js';
import { effortStoreDir } from '../store/location.js';
import { MOVE_TO_SQLITE, mergeStore } from '../store/merge-store.js';
import { SQLITE_STORE_FILE_NAME } from '../store/sqlite.js';

/** What every refusal opens with. */
const REFUSAL = 'effort sync (file)';

/** The sentence every push refusal ends with. */
const NOTHING_COPIED = 'Nothing was copied.';

/** A push refused before anything was read or made. */
export class FileSyncRefusal extends Error {
  override readonly name = 'FileSyncRefusal';
}

/** What the `file` strategy is made with; the {@link DevelopmentProbe} fields reach the merge. */
export interface FileSyncOptions extends DevelopmentProbe {
  /** The repository whose store is pushed and pulled into. */
  readonly repoRoot: string;
  /** The project's resolved `store` backend. */
  readonly backend: StoreBackend;
  /** The clock the merge's files and `merged_at` are stamped from. */
  readonly now?: () => Date;
  /** The rest of what `mergeStore` reads, each defaulted there when left out. */
  readonly migrations?: MergeOptions['migrations'];
  readonly newMergeId?: MergeOptions['newMergeId'];
  readonly readProject?: MergeOptions['readProject'];
}

/** Rejects a path a request left null, naming the field. */
function requirePath(field: 'to' | 'from', value: unknown): string {
  if (typeof value === 'string' && value !== '') return value;
  throw new TypeError(`${REFUSAL}: ${field} is ${describeValue(value)}, expected a path`);
}

/** Refuses a push that would carry no sessions or commits; see the module note. */
function refuseUncarriable(backend: StoreBackend, source: string): void {
  if (backend === 'ndjson') {
    throw new FileSyncRefusal(
      `${REFUSAL}: this project keeps its sessions and commits as NDJSON (store: ndjson), and the file carried`
        + ` is effort.sqlite, which would hold none of them. ${NOTHING_COPIED} Next safe step: ${MOVE_TO_SQLITE}`,
    );
  }
  if (!existsSync(join(source, SQLITE_STORE_FILE_NAME))) {
    throw new FileSyncRefusal(`${REFUSAL}: no ${SQLITE_STORE_FILE_NAME} in ${source}. ${NOTHING_COPIED}`);
  }
}

/** The optional merge seams the options set, and only those. */
function mergeSeams(options: FileSyncOptions): Partial<MergeOptions> {
  const { identity, env, tempDir, isAlive, migrations, newMergeId, readProject } = options;
  const seams: Partial<MergeOptions> = { identity, env, tempDir, isAlive, migrations, newMergeId, readProject };
  return Object.fromEntries(Object.entries(seams).filter(([, value]) => value !== undefined));
}

/**
 * Makes the `file` strategy over `options.repoRoot`'s store. A new frozen
 * `Sync` on each call; see the module note for what push and pull do.
 */
export function createFileSync(options: FileSyncOptions): Sync {
  const { repoRoot, backend } = options;
  const now = options.now ?? ((): Date => new Date());
  const storeDir = (): string => effortStoreDir(repoRoot, options.env);

  const push = async ({ to }: SyncPushRequest): Promise<SyncPushResult> => {
    const target = resolve(repoRoot, requirePath('to', to));
    const source = storeDir();
    refuseUncarriable(backend, source);
    const copied = copyEffortStore({ source, target });
    return Object.freeze({ status: 'pushed', path: join(copied.directory, SQLITE_STORE_FILE_NAME) });
  };

  const pull = async ({ from, dryRun }: SyncPullRequest): Promise<SyncPullResult> => {
    const otherPath = resolve(repoRoot, requirePath('from', from));
    const path = join(storeDir(), SQLITE_STORE_FILE_NAME);
    const merge = mergeStore({ ...mergeSeams(options), path, otherPath, backend, dryRun, stamp: fileStamp(now()), now });
    return Object.freeze({ status: 'pulled', merge });
  };

  return Object.freeze({ kind: 'file', push, pull });
}
