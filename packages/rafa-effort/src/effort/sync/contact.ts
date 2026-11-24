/**
 * The one call a command makes to sync its effort store with the other
 * devices of its project: {@link createHubContact}, which selects the
 * `Sync` the project's `effort.sync` names through the loaded module
 * registry, then runs a push followed by a pull, or a pull alone, or a
 * pull answering the hub line's facts after it (`status()`), or the
 * steps of a whole sync, stopping where it is asked to (`sync()`).
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
 * the pull after it, so a command waits out one timeout and not two.
 * Every later run still pushes and pulls: rows sync on the next contact.
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
 * since the same hub refuses the pull for the same reason; a later run
 * still tries, and writes nothing more.
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
 * can read; a later run still tries both.
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
 * `warn` as it stands, once for each pull that answers one, since each
 * reports rows that pull merged.
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
 *     <kind> failed: <message>`, and a refused push still pulls. Under
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
 * `hubStatus()` is asked only after a pull that answered, once per run.
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
 *   3. The push. Under `stop: 'dry-run'` it is asked with `dryRun:
 *      true` and answers the rows it would send as `pending`; it is
 *      asked so only of a strategy carrying `pendingPush`, the count the
 *      `service` strategy's dry run came with, and is `skipped` for any
 *      other, since a strategy ignoring the flag would send.
 *   4. The pull and its merge, asked as `pull()` asks it, with `dryRun`
 *      true under `stop: 'dry-run'`, its notice written as `pull()`
 *      writes it.
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
 * the reading. A push that failed for another reason still pulls, as
 * `pushThenPull()`'s does. A refusal sets no exit code: the reading
 * says the run was refused, and the command exits on it.
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
import type {
  HubContactDirection,
  HubContactReading,
  HubContactStep,
  HubLineFacts,
  HubRefusal,
  HubRefusalCause,
  HubStatusReading,
  HubSyncContacted,
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

import {
  conflictsOf,
  countOf,
  dryRunRowsOf,
  hubFactsOf,
  hubSyncStatusOf,
  KNOWN_MIGRATIONS,
  OPENING,
  pulledOf,
  skewCheck,
} from './contact-facts.js';
import { selectSync } from './select.js';

export type { SkewCheckInput } from './contact-facts.js';
export { hubFactsOf, hubSyncStatusOf, skewCheck } from './contact-facts.js';

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

/** The `name` an error carries when a push or pull found the hub unreachable. */
export const HUB_UNREACHABLE = 'HubUnreachable';

/** The `name` an error carries when the hub speaks another wire contract version than this rafa. */
export const HUB_CONTRACT_MISMATCH = 'HubContractMismatch';

/** The `name` an error carries when the hub's store lacks a migration this rafa's applied: the hub is behind. */
export const HUB_UPGRADE_REQUIRED = 'HubUpgradeRequired';

/** The `name` an error carries when the hub's rows name a migration this rafa lacks: this rafa is behind. */
export const RAFA_UPDATE_REQUIRED = 'RafaUpdateRequired';

/** The names of the two skew refusals, whose messages are written as they stand; see the module note. */
export const SKEW_REFUSALS: readonly string[] = Object.freeze([HUB_UPGRADE_REQUIRED, RAFA_UPDATE_REQUIRED]);

/** The `name` an error carries when the hub token cannot be read: the `service` strategy's `HubTokenError`. */
export const HUB_TOKEN_ERROR = 'HubTokenError';

/** The `name` the hub's own refusal of a project it does not serve carries, as `rafa-hub`'s store throws it. */
export const HUB_PROJECT_NOT_SERVED = 'HubProjectNotServed';

/** What a message refusing a project the hub does not serve says, however the client wraps it. */
const NOT_SERVED = /project \S+ is not served here/;

/**
 * A push or pull found the hub unreachable. A module need not throw
 * this class: any error whose `name` is {@link HUB_UNREACHABLE} counts.
 */
export class HubUnreachable extends Error {
  override readonly name: 'HubUnreachable' = HUB_UNREACHABLE;
}

/** Whether a thrown value says the hub was unreachable; see the module note. */
export function isHubUnreachable(error: unknown): boolean {
  return error instanceof Error && error.name === HUB_UNREACHABLE;
}

/** Whether a thrown value says the hub speaks another contract version; see the module note. */
export function isHubContractMismatch(error: unknown): boolean {
  return error instanceof Error && error.name === HUB_CONTRACT_MISMATCH;
}

/** Whether a thrown value is a skew refusal, `HubUpgradeRequired` or `RafaUpdateRequired`; see the module note. */
export function isSkewRefusal(error: unknown): boolean {
  return error instanceof Error && SKEW_REFUSALS.includes(error.name);
}

/** The `notice` a `pulled` answer carries, or null when it carries none; see the module note's `A pull's notice`. */
export function noticeOf(result: SyncPullResult): string | null {
  if (result.status !== 'pulled' || !('notice' in result)) return null;
  const { notice } = result as { readonly notice: unknown };
  return typeof notice === 'string' && notice.trim() !== ''
    ? notice
    : null;
}

/** The first line of `text` holding anything, trimmed, or the whole text described when none does. */
function firstLine(text: string): string {
  return text.split('\n').map((line) => line.trim())
    .find((line) => line !== '') ?? describeValue(text);
}

/**
 * The one line a contact writes when the hub is unreachable: the hub's
 * url when the config names one, the first line of why, and that the
 * command used the local store.
 */
export function hubUnreachableLine(hubUrl: string | null, error: unknown): string {
  const hub = hubUrl === null
    ? 'the hub'
    : `the hub at ${hubUrl}`;
  return `${OPENING}: ${hub} is unreachable (${firstLine(messageOf(error))});`
    + ' this command used the local store, and its rows sync on the next contact';
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

/** The selected `Sync`'s method `name`, read by shape and called with the strategy as `this`, or null when it has none. */
function memberOf(sync: Sync, name: 'hubStatus' | 'pendingPush'): (() => Promise<unknown>) | null {
  const member = (sync as unknown as Readonly<Record<string, unknown>>)[name];
  if (typeof member !== 'function') return null;
  const ask = member as (this: Sync) => unknown;
  return () => Promise.resolve(ask.call(sync));
}

/**
 * Why a thrown value refuses a `sync()` run, or null when it is no
 * refusal: a contract mismatch, a skew refusal, the token reader's
 * `HubTokenError`, or a project the hub does not serve, matched by its
 * `name` or the hub's own sentence. See the module note's `The sync`.
 */
export function refusalCauseOf(error: unknown): HubRefusalCause | null {
  if (!(error instanceof Error)) return null;
  if (isHubContractMismatch(error)) return 'contract';
  if (isSkewRefusal(error)) return 'skew';
  if (error.name === HUB_TOKEN_ERROR) return 'token';
  return error.name === HUB_PROJECT_NOT_SERVED || NOT_SERVED.test(error.message)
    ? 'project'
    : null;
}

/** A refusal's one line: the first line of why, opening with what every contact line opens with. */
function refusalLine(problem: string): string {
  const line = firstLine(problem);
  return line.startsWith(OPENING)
    ? line
    : `${OPENING}: ${line}`;
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
  /** Pushes this store's rows, then pulls the others' unless the push found the hub unreachable or mismatched. */
  readonly pushThenPull: () => Promise<HubContactReading>;
  /** Pulls the others' rows alone. */
  readonly pull: () => Promise<HubContactReading>;
  /** Pulls as {@link HubContact.pull} does, then answers the hub line's facts with no second status read; see the module note. */
  readonly status: () => Promise<HubStatusReading>;
  /** Reads the hub's status, checks skew, pushes and pulls, in that order, stopping where `stop` says; see the module note's `The sync`. */
  readonly sync: (options?: HubSyncOptions) => Promise<HubSyncReading>;
}

/** The selected `Sync`, or why there is none. */
type Selection =
  | { readonly sync: Sync }
  | { readonly problem: string };

/** A run's reading when it contacted nothing. */
type Uncontacted = Exclude<HubContactReading, { readonly state: 'contacted' }>;

/** What one run came to, and the `Sync` it ran over: null when it contacted none. */
type Ran =
  | { readonly reading: Uncontacted; readonly sync: null }
  | { readonly reading: Extract<HubContactReading, { readonly state: 'contacted' }>; readonly sync: Sync };

/** What a direction is named in the line its failure writes. */
type Direction = 'push' | 'pull' | 'hub status' | 'pending push';

/** One direction's step and the refusal it came to, null when it came to none. */
interface Attempted<Result> {
  readonly step: HubContactStep<Result>;
  readonly refusal: HubRefusal | null;
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
  let toldUnreachable = false;
  let toldMismatch = false;
  const toldRefusals = new Set<string>();
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

  /** Writes a refusal's line once per contact: a contract mismatch's once whatever it says, any other once per line. */
  const tell = (refusal: HubRefusal): void => {
    if (refusal.cause === 'contract') {
      if (!toldMismatch) input.warn(refusal.line);
      toldMismatch = true;
      return;
    }
    if (!toldRefusals.has(refusal.line)) input.warn(refusal.line);
    toldRefusals.add(refusal.line);
  };

  /**
   * The step a direction that threw came to, writing its line: the
   * unreachable, mismatch and skew lines once per contact and any other
   * failure each time. Under `refusals`, a `sync()` run's, a missing
   * token and a project the hub does not serve are refusals too.
   */
  const caught = (direction: Direction, error: unknown, refusals: boolean): Attempted<never> => {
    const problem = messageOf(error);
    const cause = refusalCauseOf(error);
    if (cause === 'contract' || cause === 'skew' || (refusals && cause !== null)) {
      const refusal: HubRefusal = { cause, line: cause === 'project' || cause === 'token'
        ? refusalLine(problem)
        : firstLine(problem) };
      tell(refusal);
      const step = cause === 'contract'
        ? { outcome: 'mismatch', problem: refusal.line } as const
        : { outcome: 'refused', problem: refusal.line } as const;
      return { step, refusal };
    }
    if (!isHubUnreachable(error)) {
      input.warn(`${OPENING}: ${direction} over ${strategy} failed: ${problem}`);
      return { step: { outcome: 'failed', problem }, refusal: null };
    }
    if (!toldUnreachable) input.warn(hubUnreachableLine(config.hubUrl, error));
    toldUnreachable = true;
    return { step: { outcome: 'unreachable', problem }, refusal: null };
  };

  /** Runs one direction, answering its step and the refusal it came to; see {@link caught}. */
  const attempted = async <Result>(direction: Direction, run: () => Promise<Result>, refusals: boolean): Promise<Attempted<Result>> => {
    try {
      return { step: { outcome: 'done', result: await run() }, refusal: null };
    } catch (error) {
      return caught(direction, error, refusals);
    }
  };

  /** Runs one direction for `pushThenPull()`, `pull()` and `status()`, whose steps name no refusal cause. */
  const attempt = async <Result>(direction: Direction, run: () => Promise<Result>): Promise<HubContactStep<Result>> => (
    await attempted(direction, run, false)
  ).step;

  /** Writes a `pulled` answer's notice, once for each pull that answers one. */
  const noticed = (pull: HubContactStep<SyncPullResult>): void => {
    const notice = pull.outcome === 'done'
      ? noticeOf(pull.result)
      : null;
    if (notice !== null) input.warn(notice);
  };

  /** Runs `direction`, answering its reading and the `Sync` it ran over, null when none was. */
  const run = async (direction: HubContactDirection): Promise<Ran> => {
    const reached = await reach();
    if ('reading' in reached) return { reading: reached.reading, sync: null };
    const { sync } = reached;

    const push = direction === 'push-then-pull'
      ? await attempt('push', () => sync.push({ to: null }))
      : null;
    const pull: HubContactStep<SyncPullResult> = push?.outcome === 'unreachable' || push?.outcome === 'mismatch'
      ? SKIPPED
      : await attempt('pull', () => sync.pull(pullRequest));
    noticed(pull);
    return { reading: { state: 'contacted', strategy, push, pull }, sync };
  };

  /** The hub line's facts after `pull`: skipped unless it answered, and asked of `sync` once; see the module note. */
  const hubStep = async (sync: Sync, pull: HubContactStep<SyncPullResult>): Promise<HubContactStep<HubLineFacts>> => {
    if (pull.outcome !== 'done') return SKIPPED;
    const ask = memberOf(sync, 'hubStatus');
    const asked: HubContactStep<unknown> = ask === null
      ? { outcome: 'done', result: null }
      : await attempt('hub status', ask);
    if (asked.outcome !== 'done') return asked;
    return { outcome: 'done', result: Object.freeze({ ...hubFactsOf(asked.result), ...pulledOf(pull.result) }) };
  };

  const status = async (): Promise<HubStatusReading> => {
    const ran = await run('pull');
    if (ran.sync === null) return ran.reading;
    return { ...ran.reading, hub: await hubStep(ran.sync, ran.reading.pull) };
  };

  /** A `sync()` run's first step: the hub's status, asked once, every fact unknown for a strategy with no `hubStatus`. */
  const readStatus = async (sync: Sync): Promise<Attempted<HubSyncStatus>> => {
    const ask = memberOf(sync, 'hubStatus');
    if (ask === null) return { step: { outcome: 'done', result: hubSyncStatusOf(null) }, refusal: null };
    const { step, refusal } = await attempted('hub status', ask, true);
    return step.outcome === 'done'
      ? { step: { outcome: 'done', result: hubSyncStatusOf(step.result) }, refusal }
      : { step, refusal };
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

  /** A `sync()` run's push, a dry run under `dry-run` and skipped for a strategy with no dry run; see the module note. */
  const pushStep = (sync: Sync, dryRun: boolean): Promise<Attempted<SyncPushResult>> => {
    if (!dryRun) return attempted('push', () => sync.push({ to: null }), true);
    if (memberOf(sync, 'pendingPush') === null) return Promise.resolve({ step: SKIPPED, refusal: null });
    const request: SyncPushRequest & { readonly dryRun: true } = { to: null, dryRun: true };
    return attempted('push', () => sync.push(request), true);
  };

  /** The rows a dry-run push counted, as the reading's `pending`: null when the push did not answer. */
  const pendingOfPush = (push: HubContactStep<SyncPushResult>): HubContactStep<number | null> | null => {
    if (push.outcome === 'skipped') return { outcome: 'done', result: null };
    return push.outcome === 'done'
      ? { outcome: 'done', result: dryRunRowsOf(push.result) }
      : null;
  };

  /** Runs a `sync()` over the selected `sync`, step by step, stopping at `stop` or the first step the run cannot pass. */
  const syncSteps = async (sync: Sync, stop: HubSyncStop | null): Promise<HubSyncContacted> => {
    const at = { state: 'contacted', strategy, stop, refusal: null, pending: null, push: null, pull: null, hub: SKIPPED } as const;
    const read = await readStatus(sync);
    const status = read.step;
    if (status.outcome !== 'done') return { ...at, status, refusal: read.refusal };
    const skew = skewCheck({ status: status.result, migrations: known, syncSkew: config.effortSyncSkew, hubUrl: config.hubUrl });
    if (skew !== null) tell(skew);
    if (skew !== null) return { ...at, status, refusal: skew };
    if (stop === 'status') return { ...at, status, pending: await pendingStep(sync) };

    const dryRun = stop === 'dry-run';
    const pushed = await pushStep(sync, dryRun);
    const push = pushed.step;
    const pending = dryRun
      ? pendingOfPush(push)
      : null;
    if (pushed.refusal !== null || push.outcome === 'unreachable') return { ...at, status, pending, push, refusal: pushed.refusal };
    const pulled = await attempted('pull', () => sync.pull({ ...pullRequest, dryRun }), true);
    const pull = pulled.step;
    noticed(pull);
    const ran = { ...at, status, pending, push, pull, refusal: pulled.refusal };
    if (pull.outcome !== 'done') return ran;
    const { contractVersion, projectId, projectName } = status.result;
    const facts = { contractVersion, projectId, projectName, ...pulledOf(pull.result), conflicts: conflictsOf(pull.result) };
    return { ...ran, hub: { outcome: 'done', result: Object.freeze(facts) } };
  };

  const syncRun = async (options: HubSyncOptions = {}): Promise<HubSyncReading> => {
    const reached = await reach();
    return 'reading' in reached
      ? reached.reading
      : syncSteps(reached.sync, options.stop ?? null);
  };

  return Object.freeze({
    pushThenPull: async () => (await run('push-then-pull')).reading,
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
