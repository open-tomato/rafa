/**
 * The one call a command makes to sync its effort store with the other
 * devices of its project: {@link createHubContact}, which selects the
 * `Sync` the project's `effort.sync` names through the loaded module
 * registry, then runs a push and a pull in the order `effort.syncMerge`
 * names (`pushThenPull()`; see `The order`), or a pull alone, or a pull
 * answering the hub line's facts after it (`status()`), or the steps of
 * a whole sync, stopping where it is asked to (`sync()`).
 *
 * ## The order
 *
 * `pushThenPull()` runs the direction `pull-then-push` under
 * `effort.syncMerge: ff-only`, the default, and `push-then-pull` under
 * `merge`; the member keeps its name for its callers, `rafa effort
 * collect` and the loop's end of each task.
 *
 *   - **`pull-then-push`** pulls first, as `pull()` does, and pushes only
 *     after a pull whose outcome is `done`: a pull that found the hub
 *     unreachable, speaking another contract, refusing for skew or
 *     failing skips the push, which is `skipped` in the reading. Under
 *     `effort.syncSkew: pull-projected` the projected pull answers, so
 *     the push goes on. The push asks `leaveOutConflicted: true`, so the
 *     strategy sends no row `merge_conflicts` names, whichever merge
 *     recorded it, and moves its push cursor past each. The rows it
 *     left out are read by shape off the answer's `conflicted`
 *     ({@link conflictedOf}), summed over a push split under the cap,
 *     and when there are any one line is written through `warn`, once
 *     for the run: `effort sync: <n> rows held: they differ from the
 *     hub's copy (merge_conflicts); the rest was pushed`. These are no
 *     `held_rows`: those are the rows a projected pull held back.
 *   - **`push-then-pull`** pushes first, asking nothing more, then pulls;
 *     nothing is left out of its push.
 *
 * ## Which strategies are contacted
 *
 * Only a strategy that moves rows by itself is contacted: one a module
 * brings (`git`, `service`, `p2p`). The two core registers are skipped
 * without loading a module or selecting anything, and write nothing:
 * `local` moves no rows, and `file` moves them only when a person names
 * the directory and the file (`rafa effort copy` and `rafa effort
 * import`), which a command syncing on its own never has. Every other
 * kind is selected by `selectSync` (`select.ts`) through the registry
 * `loadModules` (`packages/rafa/src/modules/load.ts`) answers for the config's
 * `modules:` and `allowList:`, as `rafa doctor`'s `effort sync` row
 * selects it. The loader's own warnings are not written here: the
 * dispatcher writes them once for every command already.
 *
 * ## Unreachable
 *
 * A push or pull that rejects with an error named `HubUnreachable`
 * ({@link HUB_UNREACHABLE}) found the hub unreachable: a connect
 * failure, the `hub.timeout` abort or a 5xx, as the `service` client
 * tells them apart. The error is matched by its `name` rather than by
 * `instanceof`, so a module throws `Object.assign(new Error(reason),
 * { name: 'HubUnreachable' })` without importing a value from core,
 * whose `./ports` subpath carries types alone; {@link HubUnreachable}
 * is that error for core's own use. The first unreachable a contact
 * meets writes one line through the caller's `warn`
 * ({@link hubUnreachableLine}), and no later one in the same contact
 * writes another, so a command prints at most one such line however
 * many runs it makes: the loop makes one contact for its run and a run
 * at the end of each task. A push that found the hub unreachable skips
 * the pull after it, so a command waits out one timeout and not two, as
 * a pull first that found it so skips the push after it. Every later
 * run still pushes and pulls: rows sync on the next contact.
 *
 * ## Contract mismatch
 *
 * A push or pull that rejects with an error named `HubContractMismatch`
 * ({@link HUB_CONTRACT_MISMATCH}) met a hub speaking another wire
 * contract version than this rafa's, and the `service` strategy refused
 * it before anything was exported or sent. It is matched by its `name`
 * ({@link isHubContractMismatch}), as `HubUnreachable` is, since this
 * module never imports `packages/rafa-sync-service`. Its message is the
 * whole line, `effort sync: the hub speaks contract <v>, this rafa
 * contract <w>; nothing was sent. Next step: <step>`, and is written
 * through `warn` as it stands, its first line alone, once per contact
 * however many runs meet it. A mismatched push skips the pull after it,
 * since the same hub refuses the pull for the same reason, and a
 * mismatched pull first skips the push; a later run still tries, and
 * writes nothing more.
 *
 * ## Skew refusals
 *
 * A push or pull that rejects with an error named `HubUpgradeRequired`
 * or `RafaUpdateRequired` ({@link SKEW_REFUSALS}) met a hub whose store
 * is behind this rafa's, or one ahead of it: the `service` strategy's
 * refusal names the migration ids and the next step, `effort sync: the
 * hub is behind this rafa (migration <ids>); nothing was sent. Next
 * step: upgrade the hub, then rafa effort sync` and `effort sync: this rafa is
 * behind the hub (migration <ids>); nothing was merged. Next step: rafa
 * self-update, then rafa effort sync`. Each is matched by its `name`
 * ({@link isSkewRefusal}) and its message is the whole line, written
 * through `warn` as it stands, its first line alone, and never inside
 * the `<direction> over <kind> failed:` wrap below. Each line is written
 * once per contact however many runs meet it. A push the hub refused
 * this way still pulls, since the hub still answers the rows this rafa
 * can read, while a pull first refused this way skips the push (`The
 * order`); a later run still tries both.
 *
 * ## A pull's notice
 *
 * A pull that merged may answer a `notice` beside its `pulled` status,
 * the line the `service` strategy has for a projected pull, `effort
 * sync: pulled <n> rows projected to this rafa's schema; <m> columns
 * wait for rafa self-update`, or for a refill, `effort sync: refilled
 * <n> rows held back since <date>`. Core's `SyncPullResult` names no
 * such field, so it is read off the answer by shape ({@link noticeOf}):
 * a non-empty string `notice` on a `pulled` answer is written through
 * `warn` as it stands, once for each pull that answers one, and for
 * each page of a pull repeated under the cap (`The payload cap`), since
 * each reports rows that page merged.
 *
 * ## The payload cap
 *
 * A hub takes at most `maxPayloadRows` rows in one push payload and
 * answers at most as many in one pull page, its
 * `dangerous.hub.maxPayloadRows`. The contact reads the cap by shape
 * off the selected `Sync`'s `hubStatus()` answer ({@link capOf}): a
 * whole number above zero, and no cap for an answer naming none,
 * `null` or anything else. A run asks `hubStatus()` at most once
 * ({@link statusOnce}), and `status()`'s hub line reads the same
 * answer; a `sync()` run reads the cap off its first step's answer and
 * asks nothing more. The split and the paging live in
 * `contact-pages.ts` beside this file:
 *
 *   - **A push is split by cursor** (`splitPush`). A strategy carrying
 *     `pendingPush()` is asked how many rows wait first, with no
 *     contact; only when some do is the cap asked. Then each push is
 *     asked as `{ to: null, limit: <cap> }` ({@link BoundedPushRequest}),
 *     which a strategy honours by sending at most `limit` rows past its
 *     push cursor and moving the cursor past them, and is followed by a
 *     second count, until none wait: a push of exactly the cap lands in
 *     one payload, and the cap plus one in two. A strategy with no
 *     `pendingPush()`, nothing waiting, a hub naming no cap, and a
 *     `sync()` dry run, which counts and sends nothing, push once as
 *     `{ to: null }`. A bounded push that left as many rows waiting as
 *     before it is not asked again, and is written as the push's
 *     failure, the rest left for the next contact. A status read or
 *     count that rejects is the push's own rejection, written by the
 *     rules below under the direction `push`, so an unreachable hub is
 *     still one line and one timeout, and skips the pull.
 *   - **A pull is repeated while its page came back full**
 *     (`pagedPull`): a `pulled` answer saying, as `rows`, how many rows
 *     its page carried, as many as the cap or more. The strategy moves
 *     its pull cursor past each page, so the same request asks for the
 *     next. A page counting no rows, a hub naming no cap and a dry run,
 *     whose cursor does not move, are pulled once. The answer is the
 *     last page's, its merge counts (`rowsAdded`, `rowsSkipped`,
 *     `rowsInConflict`, `rowsHeld`, `rowsRefilled`, `gapsRewritten`)
 *     summed over the pages. A page that rejects is the pull's
 *     rejection, the pages before it staying merged, and
 *     {@link MAX_PULL_PAGES} full pages in one pull stop it as a
 *     failure, the rest left for the next contact.
 *
 * ## Never the exit code
 *
 * A contact never throws and never sets `process.exitCode`, so the
 * command calling it exits as it would have. Anything else going wrong
 * is written through `warn` and not hidden, since a sync that failed in
 * silence would leave two devices apart while reporting nothing:
 *
 *   - A kind no loaded module registers is `selectSync`'s
 *     `SyncModuleMissing`, written as its message stands, naming the
 *     `modules:` and `allowList:` lines that load the module. Any other
 *     selection or loading throw is written the same way. Selection
 *     runs once per contact, so it is written once.
 *   - A push or pull that rejects with anything but `HubUnreachable`,
 *     `HubContractMismatch` or a skew refusal —
 *     a refused token, a `409` from an older hub naming no migration,
 *     the merge's own refusal — is written as `effort sync: <direction> over
 *     <kind> failed: <message>`, and a refused push still pulls, while a
 *     failed pull first skips the push (`The order`). Under
 *     `sync()` a refused token and a project the hub does not serve are
 *     refusals with their own line instead; see `The sync`.
 *
 * Each run answers a {@link HubContactReading} saying what was done.
 *
 * ## The hub line
 *
 * A contact's `status()` kind pulls as `pull()` does, with the same
 * request and the same lines, then answers the facts of the hub line a
 * command prints after it ({@link HubStatusReading}'s `hub`), which
 * {@link hubLine} formats: `hub: reachable, contract <n>, project
 * <name>; pulled <n> rows`, ending `; <m> rows held back` when the pull
 * held rows back. The contract version and the project come from the
 * selected `Sync`'s `hubStatus()`, the `service` strategy's answer off
 * the status read its pull already made and kept, so the line costs no
 * second read; the counts come from the pull's own merge, `rowsAdded`
 * and `rowsHeld`, and are 0 for a pull with nothing to merge. Core's
 * `Sync` names no `hubStatus`, so it is read off the strategy by shape
 * ({@link hubFactsOf}), as a pull's notice is: a strategy without one,
 * or one answering a field of another type, answers that fact as
 * unknown (null) rather than throwing, and the line names it `unknown`.
 * A project the hub names no entry for is named by its id.
 *
 * `hubStatus()` is asked only after a pull that answered, once per run,
 * and the cap a full page asks for (`The payload cap`) is read off that
 * one answer.
 * A pull that found the hub unreachable, speaking another contract,
 * refusing for skew or failing is not followed by it: its own line is
 * the one that stands in the hub line's place, and the hub step is
 * `skipped`. A `hubStatus()` that rejects is written by the rules a
 * pull's rejection is, its direction named `hub status`, and that line
 * replaces the hub line too. The contact writes the pull's notice
 * through `warn` as `pull()` does and never writes the hub line: the
 * command prints it, so the notice comes first, then the hub line or
 * the line in its place, two lines at most.
 *
 * ## The sync
 *
 * A contact's `sync({ stop })` kind runs the steps `rafa effort sync`
 * names, in order, over the selected `Sync`, each step's outcome in its
 * {@link HubSyncReading}:
 *
 *   1. The hub status read: `hubStatus()`, read by shape as `status()`
 *      reads it, answering the hub line's facts and the migration ids
 *      the hub holds ({@link hubSyncStatusOf}). A strategy with no
 *      `hubStatus` answers every fact unknown and is still run.
 *   2. The skew check ({@link skewCheck}) over that answer: a hub
 *      speaking another contract than core's `WIRE_CONTRACT_VERSION`, a
 *      hub lacking a migration this rafa knows (core's catalogue, the
 *      ids a store this rafa builds logs), or a hub holding one this
 *      rafa lacks. The last is no refusal under `effort.syncSkew:
 *      pull-projected`, whose pull projects the rows instead, and a fact
 *      the status answered none of is not checked. Each line reads as
 *      the `service` strategy's refusal of that case does, since this
 *      module never imports it. `stop: 'status'` ends the run here,
 *      sending and merging nothing, and answers as `pending` the rows
 *      waiting to push from the strategy's `pendingPush()`, read by
 *      shape and counted with no contact.
 *   3. and 4. The push and the pull, in the order `effort.syncMerge`
 *      names, as `pushThenPull()` runs them (`The order`): the pull
 *      first under `ff-only`, and the push first under `merge`.
 *      - The push. Under `stop: 'dry-run'` it is asked with `dryRun:
 *        true` and answers the rows it would send as `pending`; it is
 *        asked so only of a strategy carrying `pendingPush`, the count
 *        the `service` strategy's dry run came with, and is `skipped`
 *        for any other, since a strategy ignoring the flag would send.
 *        Under `ff-only` it asks `leaveOutConflicted: true`, a dry run
 *        too, and the rows it left out, or a dry run would have, are the
 *        reading's `conflicted` ({@link conflictedOf}): the rows past
 *        the push cursor that `merge_conflicts` names before the run,
 *        since a dry pull records no conflict. Under `merge` the push
 *        asks nothing more and `conflicted` is 0; it is null when no
 *        push answered. `sync()` writes no held line: the count is on
 *        the reading for the command to print.
 *      - The pull and its merge, asked as `pull()` asks it, with
 *        `dryRun` true under `stop: 'dry-run'`, its notice written as
 *        `pull()` writes it.
 *   5. The hub line's facts, from step 1's answer and the pull's merge,
 *      with the conflicts the merge recorded or, under a dry run, would
 *      have: no second status read.
 *
 * A run is refused when a step meets one of four causes, and its
 * reading's `refusal` names the cause and the one line written for it,
 * once per contact, in the hub line's place: `skew` (step 2's check, or
 * a `HubUpgradeRequired` or `RafaUpdateRequired` rejection), `contract`
 * (step 2's check, or a `HubContractMismatch`), `token` (an error named
 * `HubTokenError`, the token reader's) and `project` (an error named
 * `HubProjectNotServed`, or one saying the hub's own `project <id> is
 * not served here`). A token or project refusal's line is its first
 * line, opening `effort sync: ` when it opens otherwise; the others are
 * written as their messages stand. Matching is by name and sentence
 * ({@link refusalCauseOf}), as for the errors above. Only `sync()`
 * reads a token or project error as a refusal: the other kinds write
 * it inside the `failed` wrap, as they always have.
 *
 * A run stops at its first refusal, and at an unreachable hub or any
 * failure of the status read, so a command waits out one timeout and
 * pushes nothing it could not check; a step it never reached is null in
 * the reading. Under `ff-only` a pull that did not answer, whatever the
 * reason, ends the run before the push, as `pull-then-push` skips it,
 * and a push after it that was refused or found the hub unreachable
 * answers no hub line's facts, since that push's line stands in the hub
 * line's place. Under `merge` a push that failed for another reason
 * still pulls, as `pushThenPull()`'s does. A refusal sets no exit code:
 * the reading says the run was refused, and the command exits on it.
 *
 * ## The run's own record
 *
 * A contact the loop makes names its run's session id
 * ({@link HubContactInput}'s `sessionId`), and every pull it runs carries
 * that id as `SyncPullRequest.sessionId`, which the strategy passes on
 * as `mergeStore`'s `sessionId`. The merge's live-loop guard then passes
 * that run's own record, since the loop pulls at the end of a task,
 * after the task session has exited, and refuses any other live record,
 * one sharing the run's pid included: the guard matches the session id,
 * never the pid. A contact naming no session id, as
 * {@link pullBeforeRead}'s does, puts no `sessionId` in its requests, so
 * every live record is refused.
 *
 * ## Before a read
 *
 * {@link pullBeforeRead} is the one call a command that reads the store
 * makes before it reads: `rafa status`, `rafa next` and `rafa effort
 * report`. It reads the config under the project root and the home
 * without writing its warnings, since the command reads it again and
 * writes them once, then makes one contact and pulls alone: a command
 * that only reads has no rows of its own to push. A config the loop
 * cannot run on is left for the command to refuse in its own words, so
 * the helper contacts nothing and answers null; any other throw from
 * reading it is a fault, and is rethrown as the command's own read
 * would throw it.
 */
import type { Attempted } from './contact-attempt.js';
import type { PayloadCap } from './contact-pages.js';
import type {
  HubContactDirection,
  HubContactReading,
  HubContactStep,
  HubLineFacts,
  HubStatusReading,
  HubSyncContacted,
  HubSyncLineFacts,
  HubSyncOptions,
  HubSyncReading,
  HubSyncStatus,
  HubSyncStop,
} from './contact-readings.js';
import type { AdapterRegistry } from '@open-tomato/rafa/core/adapters';
import type { ResolvedConfig } from '@open-tomato/rafa/core/config';
import type { ConfigRoots } from '@open-tomato/rafa/core/config/load';
import type { ModuleLoadSeams } from '@open-tomato/rafa/modules/load';
import type { Sync, SyncPullRequest, SyncPullResult, SyncPushRequest, SyncPushResult } from '@open-tomato/rafa/ports';

import { ConfigError } from '@open-tomato/rafa/core/config';
import { loadConfig } from '@open-tomato/rafa/core/config/load';
import { describeValue, messageOf } from '@open-tomato/rafa/core/config/sections';
import { baseAdapterRegistry } from '@open-tomato/rafa/modules/activate';
import { loadModules, moduleSettings } from '@open-tomato/rafa/modules/load';

import { createAttempts } from './contact-attempt.js';
import {
  capOf,
  conflictedLine,
  conflictedOf,
  conflictsOf,
  countOf,
  dryRunRowsOf,
  hubFactsOf,
  hubSyncStatusOf,
  KNOWN_MIGRATIONS,
  memberOf,
  pulledOf,
  skewCheck,
} from './contact-facts.js';
import { pagedPull, splitPush } from './contact-pages.js';
import { selectSync } from './select.js';

export {
  HUB_CONTRACT_MISMATCH,
  HUB_PROJECT_NOT_SERVED,
  HUB_TOKEN_ERROR,
  HUB_UNREACHABLE,
  HUB_UPGRADE_REQUIRED,
  hubUnreachableLine,
  HubUnreachable,
  isHubContractMismatch,
  isHubUnreachable,
  isSkewRefusal,
  RAFA_UPDATE_REQUIRED,
  refusalCauseOf,
  SKEW_REFUSALS,
} from './contact-attempt.js';
export type { SkewCheckInput } from './contact-facts.js';
export { capOf, conflictedLine, hubFactsOf, hubSyncStatusOf, skewCheck } from './contact-facts.js';
export type { BoundedPushRequest, PayloadCap } from './contact-pages.js';
export { MAX_PULL_PAGES } from './contact-pages.js';

export type {
  HubContactDirection,
  HubContactReading,
  HubContactStep,
  HubFacts,
  HubLineFacts,
  HubRefusal,
  HubRefusalCause,
  HubStatusReading,
  HubSyncContacted,
  HubSyncLineFacts,
  HubSyncOptions,
  HubSyncReading,
  HubSyncStatus,
  HubSyncStop,
} from './contact-readings.js';

/** The `notice` a `pulled` answer carries, or null when it carries none; see the module note's `A pull's notice`. */
export function noticeOf(result: SyncPullResult): string | null {
  if (result.status !== 'pulled' || !('notice' in result)) return null;
  const { notice } = result as { readonly notice: unknown };
  return typeof notice === 'string' && notice.trim() !== ''
    ? notice
    : null;
}

/** What a hub line names for a fact the strategy answered none of. */
const UNKNOWN = 'unknown';

/**
 * The hub line a command prints after a `status()` run: `hub:
 * reachable, contract <n>, project <name>; pulled <n> rows`, ending `;
 * <m> rows held back` when rows were. The project is its id when the
 * hub names it nothing, and a fact the strategy answered none of is
 * `unknown`.
 */
export function hubLine(facts: HubLineFacts): string {
  const contract = facts.contractVersion === null
    ? UNKNOWN
    : String(facts.contractVersion);
  const project = facts.projectName ?? facts.projectId ?? UNKNOWN;
  const held = facts.heldBack > 0
    ? `; ${String(facts.heldBack)} rows held back`
    : '';
  return `hub: reachable, contract ${contract}, project ${project}; pulled ${String(facts.pulled)} rows${held}`;
}

/** What a contact is made with. */
export interface HubContactInput {
  /** The project root, which modules and the adapter resolve against. */
  readonly root: string;
  /** The home, which a user-scope `modules:` source resolves against. */
  readonly home: string;
  /** The config as it resolves for the project. */
  readonly resolved: ResolvedConfig;
  /** Writes one warning, as a command's `output.warn` does. */
  readonly warn: (message: string) => void;
  /**
   * The session id of the loop run making the contact, carried on every
   * pull; absent or null for a command that is no run. See the module
   * note's `The run's own record`.
   */
  readonly sessionId?: string | null;
}

/** How a contact loads modules, and what it knows of this rafa. Each left out is the loader's or core's own. */
export interface HubContactSeams {
  readonly modules?: ModuleLoadSeams;
  /** The migration ids this rafa knows, which `sync()`'s skew check reads; core's catalogue when left out. */
  readonly migrations?: readonly string[];
}

/** One invocation's contact with the other devices; see the module note. */
export interface HubContact {
  /**
   * Pushes this store's rows and pulls the others', in the order
   * `effort.syncMerge` names: under `ff-only` (the default) it pulls
   * first and pushes only after a pull that answered, leaving out the
   * conflicted rows; under `merge` it pushes first, then pulls unless
   * the push found the hub unreachable or mismatched. The name is the
   * member's from before the order followed the setting, kept for its
   * callers. See the module note's `The order`.
   */
  readonly pushThenPull: () => Promise<HubContactReading>;
  /** Pulls the others' rows alone. */
  readonly pull: () => Promise<HubContactReading>;
  /** Pulls as {@link HubContact.pull} does, then answers the hub line's facts with no second status read; see the module note. */
  readonly status: () => Promise<HubStatusReading>;
  /**
   * Reads the hub's status and checks skew, then pulls and pushes in the
   * order `effort.syncMerge` names, as {@link HubContact.pushThenPull}
   * does, stopping where `stop` says; see the module note's `The sync`.
   */
  readonly sync: (options?: HubSyncOptions) => Promise<HubSyncReading>;
}

/** The selected `Sync`, or why there is none. */
type Selection =
  | { readonly sync: Sync }
  | { readonly problem: string };

/** A run's reading when it contacted nothing. */
type Uncontacted = Exclude<HubContactReading, { readonly state: 'contacted' }>;

/** A run's one read of the hub's status: asked the first time it is called, its answer kept for the run. */
type StatusRead = () => Promise<unknown>;

/** What one run came to, the `Sync` it ran over, null when it contacted none, and its status read, null when the `Sync` has none. */
type Ran =
  | { readonly reading: Uncontacted; readonly sync: null; readonly hub: null }
  | {
    readonly reading: Extract<HubContactReading, { readonly state: 'contacted' }>;
    readonly sync: Sync;
    readonly hub: StatusRead | null;
  };

/** A `sync()` run's status step, with the cap its answer names: null for none, or for a step that did not answer. */
interface StatusStep extends Attempted<HubSyncStatus> {
  readonly cap: number | null;
}

/** What a `sync()` run's push puts on its reading. */
type PushFields = Pick<HubSyncContacted, 'pending' | 'conflicted' | 'refusal'> & { readonly push: HubContactStep<SyncPushResult> };

/** `sync`'s `hubStatus()` as a run's {@link StatusRead}, or null when it has none: asked once, its answer or rejection kept, and asked again only after one that threw before answering. */
function statusOnce(sync: Sync): StatusRead | null {
  const ask = memberOf(sync, 'hubStatus');
  if (ask === null) return null;
  let asked: Promise<unknown> | undefined;
  return () => {
    asked ??= ask();
    return asked;
  };
}

/** A step that was not run. */
const SKIPPED = Object.freeze({ outcome: 'skipped' } as const);

/** The strategy as a reading names it:the string itself, or a description of a value that is none. */
function strategyOf(kind: unknown): string {
  return typeof kind === 'string'
    ? kind
    : describeValue(kind);
}

/**
 * Whether core registers `kind`, so a contact leaves it alone. Read off
 * `baseAdapterRegistry()`, which holds no module's kind once
 * `src/rafa.ts` has made the modules' adapters active.
 */
function isCoreStrategy(kind: unknown): boolean {
  return typeof kind === 'string' && baseAdapterRegistry().find('sync', kind) !== undefined;
}

/** Loads the modules and selects the `Sync`, answering the problem instead of throwing. */
async function select(input: HubContactInput, seams: HubContactSeams): Promise<Selection> {
  try {
    const settings = moduleSettings(input.resolved, { root: input.root, home: input.home });
    const registry: AdapterRegistry = (await loadModules(settings, seams.modules)).adapters;
    return { sync: selectSync(input.root, input.resolved.config, registry) };
  } catch (error) {
    return { problem: messageOf(error) };
  }
}

/**
 * Makes the contact one invocation runs through. Nothing is loaded or
 * selected until the first run, and a contact never throws; see the
 * module note.
 */
export function createHubContact(input: HubContactInput, seams: HubContactSeams = {}): HubContact {
  const { config } = input.resolved;
  const strategy = strategyOf(config.effortSync);
  const known = seams.migrations ?? KNOWN_MIGRATIONS;
  let selection: Promise<Selection> | null = null;
  const { tell, attempted, attempt } = createAttempts({ warn: input.warn, strategy, hubUrl: config.hubUrl });
  const pullRequest: SyncPullRequest = Object.freeze({
    from: null,
    dryRun: false,
    ...input.sessionId == null
      ? {}
      : { sessionId: input.sessionId },
  });

  /** Selects once per contact, writing a problem the one time it is found. */
  const selected = (): Promise<Selection> => {
    selection ??= select(input, seams).then((answer) => {
      if ('problem' in answer) input.warn(answer.problem);
      return answer;
    });
    return selection;
  };

  /** The selected `Sync`, or the reading of a run that contacts none. */
  const reach = async (): Promise<{ readonly sync: Sync } | { readonly reading: Uncontacted }> => {
    if (isCoreStrategy(config.effortSync)) return { reading: { state: 'not-contacted', strategy } };
    const answer = await selected();
    return 'problem' in answer
      ? { reading: { state: 'unselected', strategy, problem: answer.problem } }
      : answer;
  };

  /** Writes a `pulled` answer's notice, once for each pull, and each page of one, that answers one. */
  const noticed = (result: SyncPullResult): void => {
    const notice = noticeOf(result);
    if (notice !== null) input.warn(notice);
  };

  /** Writes the held line once for a push that left out conflicted rows; see the module note's `The order`. */
  const held = (push: HubContactStep<SyncPushResult>): void => {
    const count = push.outcome === 'done'
      ? conflictedOf(push.result)
      : 0;
    if (count > 0) input.warn(conflictedLine(count));
  };

  /** Runs `direction`, answering its reading, the `Sync` it ran over, null when none was, and the run's one status read. */
  const run = async (direction: HubContactDirection): Promise<Ran> => {
    const reached = await reach();
    if ('reading' in reached) return { reading: reached.reading, sync: null, hub: null };
    const { sync } = reached;
    const hub = statusOnce(sync);
    const cap: PayloadCap = hub === null
      ? null
      : async () => capOf(await hub());
    const pullNow = (): Promise<HubContactStep<SyncPullResult>> => attempt('pull', () => pagedPull(sync, pullRequest, cap, noticed));

    if (direction === 'pull-then-push') {
      const pull = await pullNow();
      const push: HubContactStep<SyncPushResult> = pull.outcome === 'done'
        ? await attempt('push', () => splitPush(sync, cap, true))
        : SKIPPED;
      held(push);
      return { reading: { state: 'contacted', strategy, push, pull }, sync, hub };
    }
    const push = direction === 'push-then-pull'
      ? await attempt('push', () => splitPush(sync, cap))
      : null;
    const pull: HubContactStep<SyncPullResult> = push?.outcome === 'unreachable' || push?.outcome === 'mismatch'
      ? SKIPPED
      : await pullNow();
    return { reading: { state: 'contacted', strategy, push, pull }, sync, hub };
  };

  /** The hub line's facts after `pull`: skipped unless it answered, and asked of `sync` once; see the module note. */
  const hubStep = async (ask: StatusRead | null, pull: HubContactStep<SyncPullResult>): Promise<HubContactStep<HubLineFacts>> => {
    if (pull.outcome !== 'done') return SKIPPED;
    const asked: HubContactStep<unknown> = ask === null
      ? { outcome: 'done', result: null }
      : await attempt('hub status', ask);
    if (asked.outcome !== 'done') return asked;
    return { outcome: 'done', result: Object.freeze({ ...hubFactsOf(asked.result), ...pulledOf(pull.result) }) };
  };

  const status = async (): Promise<HubStatusReading> => {
    const ran = await run('pull');
    if (ran.sync === null) return ran.reading;
    return { ...ran.reading, hub: await hubStep(ran.hub, ran.reading.pull) };
  };

  /**
   * A `sync()` run's first step: the hub's status, asked once, every
   * fact unknown and no cap for a strategy with no `hubStatus`, and the
   * cap it answered beside it.
   */
  const readStatus = async (sync: Sync): Promise<StatusStep> => {
    const ask = memberOf(sync, 'hubStatus');
    if (ask === null) return { step: { outcome: 'done', result: hubSyncStatusOf(null) }, refusal: null, cap: null };
    const { step, refusal } = await attempted('hub status', ask, true);
    return step.outcome === 'done'
      ? { step: { outcome: 'done', result: hubSyncStatusOf(step.result) }, refusal, cap: capOf(step.result) }
      : { step, refusal, cap: null };
  };

  /** The rows waiting to push, counted with no contact by the strategy's `pendingPush()`; a `done` null when it has none. */
  const pendingStep = async (sync: Sync): Promise<HubContactStep<number | null>> => {
    const count = memberOf(sync, 'pendingPush');
    if (count === null) return { outcome: 'done', result: null };
    const { step } = await attempted('pending push', count, true);
    return step.outcome === 'done'
      ? { outcome: 'done', result: countOf(step.result) }
      : step;
  };

  /**
   * A `sync()` run's push, split under `cap` outside a dry run, one dry
   * run under `dry-run`, and skipped for a strategy with no dry run;
   * each asks `leaveOutConflicted: true` when `leaveOut` says so. See
   * the module note.
   */
  const pushStep = (sync: Sync, dryRun: boolean, cap: number | null, leaveOut: boolean): Promise<Attempted<SyncPushResult>> => {
    if (!dryRun) return attempted('push', () => splitPush(sync, cap, leaveOut), true);
    if (memberOf(sync, 'pendingPush') === null) return Promise.resolve({ step: SKIPPED, refusal: null });
    const request: SyncPushRequest & { readonly dryRun: true; readonly leaveOutConflicted?: true } = leaveOut
      ? { to: null, dryRun: true, leaveOutConflicted: true }
      : { to: null, dryRun: true };
    return attempted('push', () => sync.push(request), true);
  };

  /** The rows a dry-run push counted, as the reading's `pending`: null when the push did not answer. */
  const pendingOfPush = (push: HubContactStep<SyncPushResult>): HubContactStep<number | null> | null => {
    if (push.outcome === 'skipped') return { outcome: 'done', result: null };
    return push.outcome === 'done'
      ? { outcome: 'done', result: dryRunRowsOf(push.result) }
      : null;
  };

  /** What a `sync()` run's push puts on its reading: the step, a dry run's count, the conflicted rows it left out and its refusal. */
  const pushFields = (pushed: Attempted<SyncPushResult>, dryRun: boolean): PushFields => {
    const push = pushed.step;
    const pending = dryRun
      ? pendingOfPush(push)
      : null;
    const conflicted = push.outcome === 'done'
      ? conflictedOf(push.result)
      : null;
    return { push, pending, conflicted, refusal: pushed.refusal };
  };

  /** The hub line's facts after a `sync()` run's pull: the status read's and the pull's merge, with no second status read. */
  const syncFacts = (status: HubSyncStatus, pull: SyncPullResult): HubContactStep<HubSyncLineFacts> => {
    const { contractVersion, projectId, projectName } = status;
    const facts = { contractVersion, projectId, projectName, ...pulledOf(pull), conflicts: conflictsOf(pull) };
    return { outcome: 'done', result: Object.freeze(facts) };
  };

  /** The order `pushThenPull()` and `sync()` run under `effort.syncMerge`: pull first under `ff-only`, push first under `merge`. */
  const ordered: HubContactDirection = config.effortSyncMerge === 'merge'
    ? 'push-then-pull'
    : 'pull-then-push';

  /** Runs a `sync()` over the selected `sync`, step by step, stopping at `stop` or the first step the run cannot pass. */
  const syncSteps = async (sync: Sync, stop: HubSyncStop | null): Promise<HubSyncContacted> => {
    const at = {
      state: 'contacted', strategy, stop, refusal: null, pending: null, push: null, pull: null, conflicted: null, hub: SKIPPED,
    } as const;
    const read = await readStatus(sync);
    const status = read.step;
    if (status.outcome !== 'done') return { ...at, status, refusal: read.refusal };
    const skew = skewCheck({ status: status.result, migrations: known, syncSkew: config.effortSyncSkew, hubUrl: config.hubUrl });
    if (skew !== null) tell(skew);
    if (skew !== null) return { ...at, status, refusal: skew };
    if (stop === 'status') return { ...at, status, pending: await pendingStep(sync) };

    const dryRun = stop === 'dry-run';
    const pullFirst = ordered === 'pull-then-push';
    const pushNow = async (): Promise<PushFields> => pushFields(await pushStep(sync, dryRun, read.cap, pullFirst), dryRun);
    const pullNow = (): Promise<Attempted<SyncPullResult>> => attempted(
      'pull',
      () => pagedPull(sync, { ...pullRequest, dryRun }, read.cap, noticed),
      true,
    );
    // A push refused or finding the hub unreachable ends the run: its line stands in the hub line's place.
    const ends = (pushed: PushFields): boolean => pushed.refusal !== null || pushed.push.outcome === 'unreachable';

    if (pullFirst) {
      const pulled = await pullNow();
      const ran = { ...at, status, pull: pulled.step, refusal: pulled.refusal };
      if (pulled.step.outcome !== 'done') return ran;
      const pushed = { ...ran, ...await pushNow() };
      return ends(pushed)
        ? pushed
        : { ...pushed, hub: syncFacts(status.result, pulled.step.result) };
    }
    const pushed = await pushNow();
    if (ends(pushed)) return { ...at, status, ...pushed };
    const pulled = await pullNow();
    const ran = { ...at, status, ...pushed, pull: pulled.step, refusal: pulled.refusal };
    return pulled.step.outcome === 'done'
      ? { ...ran, hub: syncFacts(status.result, pulled.step.result) }
      : ran;
  };

  const syncRun = async (options: HubSyncOptions = {}): Promise<HubSyncReading> => {
    const reached = await reach();
    return 'reading' in reached
      ? reached.reading
      : syncSteps(reached.sync, options.stop ?? null);
  };

  return Object.freeze({
    pushThenPull: async () => (await run(ordered)).reading,
    pull: async () => (await run('pull')).reading,
    status,
    sync: syncRun,
  });
}

/** What {@link pullBeforeRead} is made with. */
export interface PullBeforeReadInput {
  /** The project root and the home the config is read under. */
  readonly roots: ConfigRoots;
  /** Writes one warning, as a command's `output.warn` does. */
  readonly warn: (message: string) => void;
}

/**
 * The pull a command makes before it reads the store: the config read
 * under `roots`, then one contact pulling the others' rows alone; see
 * the module note's `Before a read`. Answers null, having contacted
 * nothing, when the config is one the loop cannot run on.
 */
export async function pullBeforeRead(input: PullBeforeReadInput, seams: HubContactSeams = {}): Promise<HubContactReading | null> {
  const { roots, warn } = input;
  let resolved: ResolvedConfig;
  try {
    // Read silently: the command reads the config itself and writes its warnings once.
    resolved = await loadConfig(roots, {}, () => {});
  } catch (error) {
    if (error instanceof ConfigError) return null;
    throw error;
  }
  return createHubContact({ root: roots.root, home: roots.home, resolved, warn }, seams).pull();
}
