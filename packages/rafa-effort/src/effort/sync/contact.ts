/**
 * The one call a command makes to sync its effort store with the other
 * devices of its project: {@link createHubContact}, which selects the
 * `Sync` the project's `effort.sync` names through the loaded module
 * registry, then runs a push followed by a pull, or a pull alone, or a
 * pull answering the hub line's facts after it (`status()`).
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
 *     <kind> failed: <message>`, and a refused push still pulls.
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
import type { AdapterRegistry } from '@open-tomato/rafa/core/adapters';
import type { ResolvedConfig } from '@open-tomato/rafa/core/config';
import type { ConfigRoots } from '@open-tomato/rafa/core/config/load';
import type { ModuleLoadSeams } from '@open-tomato/rafa/modules/load';
import type { Sync, SyncPullRequest, SyncPullResult, SyncPushResult } from '@open-tomato/rafa/ports';

import { ConfigError } from '@open-tomato/rafa/core/config';
import { loadConfig } from '@open-tomato/rafa/core/config/load';
import { describeValue, messageOf } from '@open-tomato/rafa/core/config/sections';
import { baseAdapterRegistry } from '@open-tomato/rafa/modules/activate';
import { loadModules, moduleSettings } from '@open-tomato/rafa/modules/load';

import { selectSync } from './select.js';

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

/** What every line a contact writes opens with. */
const OPENING = 'effort sync';

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

/** `value` when it is a string holding anything, else null. */
function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== ''
    ? value
    : null;
}

/**
 * The hub's facts a `hubStatus()` answer carries, read by shape: each
 * field of another type, and every field of an answer that is no
 * object, null. See the module note's `The hub line`.
 */
export function hubFactsOf(answer: unknown): HubFacts {
  const fields: Readonly<Record<string, unknown>> = typeof answer === 'object' && answer !== null
    ? answer as Readonly<Record<string, unknown>>
    : {};
  const { contractVersion } = fields;
  return Object.freeze({
    contractVersion: typeof contractVersion === 'number' && Number.isInteger(contractVersion)
      ? contractVersion
      : null,
    projectId: textOf(fields.projectId),
    projectName: textOf(fields.projectName),
  });
}

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

/** The rows a pull's merge added and held back; both 0 for a pull with nothing to merge. */
function pulledOf(result: SyncPullResult): Pick<HubLineFacts, 'pulled' | 'heldBack'> {
  return result.status === 'pulled'
    ? { pulled: result.merge.rowsAdded, heldBack: result.merge.rowsHeld }
    : { pulled: 0, heldBack: 0 };
}

/** The selected `Sync`'s `hubStatus`, read by shape, or null when it has none. */
function hubStatusOf(sync: Sync): (() => Promise<unknown>) | null {
  const { hubStatus } = sync as { readonly hubStatus?: unknown };
  if (typeof hubStatus !== 'function') return null;
  const ask = hubStatus as (this: Sync) => unknown;
  return () => Promise.resolve(ask.call(sync));
}

/** Which directions a run takes. */
export type HubContactDirection = 'push-then-pull' | 'pull';

/** What one direction of a run came to. */
export type HubContactStep<Result> =
  /** The strategy answered. */
  | { readonly outcome: 'done'; readonly result: Result }
  /** The hub was unreachable; `problem` is why, as the error said it. */
  | { readonly outcome: 'unreachable'; readonly problem: string }
  /** The hub speaks another contract version; `problem` is the line, written through `warn` once per contact. */
  | { readonly outcome: 'mismatch'; readonly problem: string }
  /** The hub or this rafa is behind the other's migrations; `problem` is the line, written through `warn` once per contact. */
  | { readonly outcome: 'refused'; readonly problem: string }
  /** The strategy refused or failed for another reason, written through `warn`. */
  | { readonly outcome: 'failed'; readonly problem: string }
  /** Not run: the push before it found the hub unreachable or speaking another contract. */
  | { readonly outcome: 'skipped' };

/** What one run of a contact did. */
export type HubContactReading =
  /** `effort.sync` is core's `local` or `file`: nothing was loaded, selected or contacted. */
  | { readonly state: 'not-contacted'; readonly strategy: string }
  /** No `Sync` could be selected; `problem` was written through `warn` once. */
  | { readonly state: 'unselected'; readonly strategy: string; readonly problem: string }
  /** The selected `Sync` was run; `push` is null for a pull alone. */
  | {
    readonly state: 'contacted';
    readonly strategy: string;
    readonly push: HubContactStep<SyncPushResult> | null;
    readonly pull: HubContactStep<SyncPullResult>;
  };

/** The hub's own facts the hub line names, each null when the strategy answered none; see the module note's `The hub line`. */
export interface HubFacts {
  /** The wire contract version the hub speaks. */
  readonly contractVersion: number | null;
  /** The project push and pull name. */
  readonly projectId: string | null;
  /** The hub's name for that project. */
  readonly projectName: string | null;
}

/** Everything the hub line says: the hub's facts and what the pull before it merged. */
export interface HubLineFacts extends HubFacts {
  /** The rows the pull's merge added; 0 when it had nothing to merge. */
  readonly pulled: number;
  /** The rows the pull's merge held back for a later refill; 0 for a pull that was not projected. */
  readonly heldBack: number;
}

/** What a `status()` run did: a pull's reading, a contacted one also saying what the hub line names. */
export type HubStatusReading =
  | Exclude<HubContactReading, { readonly state: 'contacted' }>
  | (Extract<HubContactReading, { readonly state: 'contacted' }> & {
    /** The hub line's facts, or `skipped` when the pull did not answer and its own line stands in the hub line's place. */
    readonly hub: HubContactStep<HubLineFacts>;
  });

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

/** How a contact loads modules. Each left out is the loader's own. */
export interface HubContactSeams {
  readonly modules?: ModuleLoadSeams;
}

/** One invocation's contact with the other devices; see the module note. */
export interface HubContact {
  /** Pushes this store's rows, then pulls the others' unless the push found the hub unreachable or mismatched. */
  readonly pushThenPull: () => Promise<HubContactReading>;
  /** Pulls the others' rows alone. */
  readonly pull: () => Promise<HubContactReading>;
  /** Pulls as {@link HubContact.pull} does, then answers the hub line's facts with no second status read; see the module note. */
  readonly status: () => Promise<HubStatusReading>;
}

/** The selected `Sync`, or why there is none. */
type Selection =
  | { readonly sync: Sync }
  | { readonly problem: string };

/** What one run came to, and the `Sync` it ran over: null when it contacted none. */
type Ran =
  | { readonly reading: Exclude<HubContactReading, { readonly state: 'contacted' }>; readonly sync: null }
  | { readonly reading: Extract<HubContactReading, { readonly state: 'contacted' }>; readonly sync: Sync };

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

  /** Runs one direction, writing the unreachable, mismatch and skew lines once per contact and any other failure each time. */
  const attempt = async <Result>(direction: 'push' | 'pull' | 'hub status', run: () => Promise<Result>): Promise<HubContactStep<Result>> => {
    try {
      return { outcome: 'done', result: await run() };
    } catch (error) {
      const problem = messageOf(error);
      if (isHubContractMismatch(error)) {
        const line = firstLine(problem);
        if (!toldMismatch) input.warn(line);
        toldMismatch = true;
        return { outcome: 'mismatch', problem: line };
      }
      if (isSkewRefusal(error)) {
        const line = firstLine(problem);
        if (!toldRefusals.has(line)) input.warn(line);
        toldRefusals.add(line);
        return { outcome: 'refused', problem: line };
      }
      if (!isHubUnreachable(error)) {
        input.warn(`${OPENING}: ${direction} over ${strategy} failed: ${problem}`);
        return { outcome: 'failed', problem };
      }
      if (!toldUnreachable) input.warn(hubUnreachableLine(config.hubUrl, error));
      toldUnreachable = true;
      return { outcome: 'unreachable', problem };
    }
  };

  /** Runs `direction`, answering its reading and the `Sync` it ran over, null when none was. */
  const run = async (direction: HubContactDirection): Promise<Ran> => {
    if (isCoreStrategy(config.effortSync)) return { reading: { state: 'not-contacted', strategy }, sync: null };
    const answer = await selected();
    if ('problem' in answer) return { reading: { state: 'unselected', strategy, problem: answer.problem }, sync: null };
    const { sync } = answer;

    const push = direction === 'push-then-pull'
      ? await attempt('push', () => sync.push({ to: null }))
      : null;
    const pull: HubContactStep<SyncPullResult> = push?.outcome === 'unreachable' || push?.outcome === 'mismatch'
      ? { outcome: 'skipped' }
      : await attempt('pull', () => sync.pull(pullRequest));
    const notice = pull.outcome === 'done'
      ? noticeOf(pull.result)
      : null;
    if (notice !== null) input.warn(notice);
    return { reading: { state: 'contacted', strategy, push, pull }, sync };
  };

  /** The hub line's facts after `pull`: skipped unless it answered, and asked of `sync` once; see the module note. */
  const hubStep = async (sync: Sync, pull: HubContactStep<SyncPullResult>): Promise<HubContactStep<HubLineFacts>> => {
    if (pull.outcome !== 'done') return { outcome: 'skipped' };
    const ask = hubStatusOf(sync);
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

  return Object.freeze({
    pushThenPull: async () => (await run('push-then-pull')).reading,
    pull: async () => (await run('pull')).reading,
    status,
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
