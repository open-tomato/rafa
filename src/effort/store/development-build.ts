/**
 * A development build never migrates the live store: the refusal
 * `bringForward` (`bring-forward.ts`) raises before it writes a store
 * this build does not own.
 *
 * ## When it refuses
 *
 * `bringForward` asks {@link refuseUnownedDevelopmentWrite} once its
 * first plan leaves something to write: a store to adopt, or a pending
 * migration. It refuses when both hold:
 *
 *   - the running rafa is a development build, as `readRuntimeIdentity`
 *     (`src/runtime/identity.ts`) reads it: `bun src/rafa.ts`, a
 *     checkout's `dist/cli.js` or a `bun test` process;
 *   - the store is not one it owns ({@link isOwnedStore}).
 *
 * A plan with nothing to write never gets here, so a development build
 * reads and writes the live store as it always did while the store is
 * current. An installed runtime is never refused here. Adoption counts
 * as a write, so a development build never adopts the live store
 * either, and the refusal names `schema_migrations` for it, ahead of
 * the pending ids.
 *
 * ## The stores a development build owns
 *
 * A store under the temporary directory (`tmpdir()`, read at each call,
 * or its real path), which is where every test's store is, and a store
 * under the directory `RAFA_EFFORT_DIR` names, which is where a copy
 * made by `rafa effort copy` is. A store that sits in a project's own
 * `<root>/.rafa/effort/` directory is owned under the temporary
 * directory only, never through the variable: a variable naming a
 * directory above a project would otherwise let branch code migrate
 * that project's live store. `location.ts` already refuses a variable
 * naming the project's own store where it resolves the directory, and
 * a relative value, which counts for nothing here.
 *
 * ## The text
 *
 * The spec's, verbatim, naming the ids and the checkout:
 *
 *     effort store: <path> needs migration <ids> and this rafa is a
 *     development build (<checkout>); a development build migrates only
 *     a store under the temp directory or RAFA_EFFORT_DIR. Copy it with
 *     'rafa effort copy' and run this command with
 *     RAFA_EFFORT_DIR=<the copy>.
 *
 * When the store is a project's own (`<root>/.rafa/effort/`), each loop
 * record under `<root>/.rafa/runs/` that reads `running` or `paused`
 * with its pid alive (`readSessions`, `src/loop/sessions.ts`) adds
 * ` Loop <sessionId> (pid <pid>, plan <stub>) is running on this
 * store.`, oldest first; a record with no stub names its plan's path.
 * When the records cannot be read, the text says so and names the
 * error, rather than dropping the sentence in silence. The refusal is
 * thrown before any write, so the store's bytes are left as they were.
 */
import type { StoreEnvironment } from './location.js';
import type { PidProbe, SessionRecord } from '../../loop/sessions.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';

import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute } from 'node:path';

import { RAFA_VERSION } from '../../cli/version.js';
import { messageOf } from '../../config-sections.js';
import { isPidAlive, readSessions, runsDir } from '../../loop/sessions.js';
import { SCOPE_DIR } from '../../project/scope.js';
import { readRuntimeIdentity } from '../../runtime/identity.js';

import { EFFORT_DIR_VARIABLE, isUnderTempDir } from './location.js';

/** The command a refused development build is sent to. */
export const DEVELOPMENT_NEXT_STEP = 'rafa effort copy';

/** What the refusal names in place of an id when the write would adopt the store. */
export const ADOPTION_NAME = 'schema_migrations';

/** The name of a project's store directory under its `.rafa/`. */
const EFFORT_DIR_NAME = 'effort';

/** What the refusal reads about the process it runs in; each field has a default. */
export interface DevelopmentProbe {
  /** Which build is running; `readRuntimeIdentity()` by default. */
  readonly identity?: RuntimeIdentity;
  /** The environment `RAFA_EFFORT_DIR` is read from; `process.env` by default. */
  readonly env?: StoreEnvironment;
  /** The temporary directory; `tmpdir()` by default. */
  readonly tempDir?: string;
  /** Whether a loop record's pid is alive; `isPidAlive` by default. */
  readonly isAlive?: PidProbe;
}

/**
 * The running rafa as a migration log's `applied_by` names it: its
 * version for an installed runtime, and `<version>+dev:<checkout>` for a
 * development build, so a row a checkout logged says which one.
 */
export function appliedByName(identity: RuntimeIdentity): string {
  return identity.kind === 'development'
    ? `${RAFA_VERSION}+dev:${identity.checkout}`
    : RAFA_VERSION;
}

/** A development build refused a write to a store it does not own. */
export class DevelopmentBuildRefusedError extends Error {
  /** The store refused. */
  readonly path: string;
  /** The one command to run next. */
  readonly nextStep: string;

  constructor(path: string, message: string) {
    super(message);
    this.name = 'DevelopmentBuildRefusedError';
    this.path = path;
    this.nextStep = DEVELOPMENT_NEXT_STEP;
  }
}

/**
 * The project root a store file sits in, when its directory is that
 * project's `<root>/.rafa/effort/`, and null for a store anywhere else.
 */
export function storeProjectRoot(path: string): string | null {
  const storeDir = dirname(path);
  const scopeDir = dirname(storeDir);
  if (basename(storeDir) !== EFFORT_DIR_NAME || basename(scopeDir) !== SCOPE_DIR) return null;
  return dirname(scopeDir);
}

/** True when the store at `path` is one a development build may write; see the module note. */
export function isOwnedStore(path: string, env: StoreEnvironment, tempDir: string): boolean {
  if (isUnderTempDir(path, tempDir)) return true;

  const override = env[EFFORT_DIR_VARIABLE];
  if (override === undefined || override === '' || !isAbsolute(override)) return false;
  // `isUnderTempDir` answers for any directory: `path` under `override`, as spelled or through its real path.
  return storeProjectRoot(path) === null && isUnderTempDir(path, override);
}

/** The sentence naming one live loop. */
function loopSentence(record: SessionRecord): string {
  return ` Loop ${record.sessionId} (pid ${String(record.pid)}, plan ${record.planStub ?? record.plan}) is running on this store.`;
}

/** The sentences naming the live loops recorded under the store's project root, if it has one. */
function liveLoopSentences(path: string, isAlive: PidProbe): string {
  const root = storeProjectRoot(path);
  if (root === null) return '';
  try {
    return readSessions(root, { isAlive })
      .filter((record) => record.state === 'running' || record.state === 'paused')
      .map(loopSentence)
      .join('');
  } catch (error) {
    return ` The loop records under ${runsDir(root)} could not be read (${messageOf(error)}).`;
  }
}

/** The refusal's text; see the module note. */
export function developmentRefusalText(path: string, needs: readonly string[], checkout: string, loops: string): string {
  return `effort store: ${path} needs migration ${needs.join(', ')} and this rafa is a development build (${checkout});`
    + ` a development build migrates only a store under the temp directory or ${EFFORT_DIR_VARIABLE}.`
    + ` Copy it with '${DEVELOPMENT_NEXT_STEP}' and run this command with ${EFFORT_DIR_VARIABLE}=<the copy>.`
    + loops;
}

/**
 * Throws {@link DevelopmentBuildRefusedError} when a development build
 * would write the store at `path`, which it does not own, and does
 * nothing otherwise. `needs` names what the write would record, in the
 * order it would record it. Reads, and writes nothing.
 */
export function refuseUnownedDevelopmentWrite(
  path: string,
  needs: readonly string[],
  probe: DevelopmentProbe = {},
): void {
  const identity = probe.identity ?? readRuntimeIdentity();
  if (identity.kind !== 'development') return;
  if (isOwnedStore(path, probe.env ?? process.env, probe.tempDir ?? tmpdir())) return;

  const loops = liveLoopSentences(path, probe.isAlive ?? isPidAlive);
  throw new DevelopmentBuildRefusedError(path, developmentRefusalText(path, needs, identity.checkout, loops));
}
