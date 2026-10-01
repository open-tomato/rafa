/**
 * The one call a command makes to sync its effort store with the other
 * devices of its project: {@link createHubContact}, which selects the
 * `Sync` the project's `effort.sync` names through the loaded module
 * registry, then runs a push followed by a pull, or a pull alone.
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
 * `loadModules` (`src/modules/load.ts`) answers for the config's
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
 *   - A push or pull that rejects with anything but `HubUnreachable` —
 *     a refused token, a migration the hub or this rafa lacks, the
 *     merge's own refusal — is written as `effort sync: <direction> over
 *     <kind> failed: <message>`, and a refused push still pulls.
 *
 * Each run answers a {@link HubContactReading} saying what was done.
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
import type { AdapterRegistry } from '../../adapters/registry.js';
import type { ConfigRoots } from '../../config-load.js';
import type { ResolvedConfig } from '../../config.js';
import type { ModuleLoadSeams } from '../../modules/load.js';
import type { Sync, SyncPullRequest, SyncPullResult, SyncPushResult } from '../../ports/index.js';

import { CORE_ADAPTER_REGISTRY } from '../../adapters/registry.js';
import { loadConfig } from '../../config-load.js';
import { describeValue, messageOf } from '../../config-sections.js';
import { ConfigError } from '../../config.js';
import { loadModules, moduleSettings } from '../../modules/load.js';

import { selectSync } from './select.js';

/** The `name` an error carries when a push or pull found the hub unreachable. */
export const HUB_UNREACHABLE = 'HubUnreachable';

/** What every line a contact writes opens with. */
const OPENING = 'effort sync';

/**
 * A push or pull found the hub unreachable. A module need not throw
 * this class: any error whose `name` is {@link HUB_UNREACHABLE} counts.
 */
export class HubUnreachable extends Error {
  override readonly name = HUB_UNREACHABLE;
}

/** Whether a thrown value says the hub was unreachable; see the module note. */
export function isHubUnreachable(error: unknown): boolean {
  return error instanceof Error && error.name === HUB_UNREACHABLE;
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

/** Which directions a run takes. */
export type HubContactDirection = 'push-then-pull' | 'pull';

/** What one direction of a run came to. */
export type HubContactStep<Result> =
  /** The strategy answered. */
  | { readonly outcome: 'done'; readonly result: Result }
  /** The hub was unreachable; `problem` is why, as the error said it. */
  | { readonly outcome: 'unreachable'; readonly problem: string }
  /** The strategy refused or failed for another reason, written through `warn`. */
  | { readonly outcome: 'failed'; readonly problem: string }
  /** Not run: the push before it found the hub unreachable. */
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
  /** Pushes this store's rows, then pulls the others' unless the push found the hub unreachable. */
  readonly pushThenPull: () => Promise<HubContactReading>;
  /** Pulls the others' rows alone. */
  readonly pull: () => Promise<HubContactReading>;
}

/** The selected `Sync`, or why there is none. */
type Selection =
  | { readonly sync: Sync }
  | { readonly problem: string };

/** The strategy as a reading names it: the string itself, or a description of a value that is none. */
function strategyOf(kind: unknown): string {
  return typeof kind === 'string'
    ? kind
    : describeValue(kind);
}

/** Whether core registers `kind`, so a contact leaves it alone. */
function isCoreStrategy(kind: unknown): boolean {
  return typeof kind === 'string' && CORE_ADAPTER_REGISTRY.find('sync', kind) !== undefined;
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

  /** Runs one direction, writing the unreachable line once per contact and any other failure each time. */
  const attempt = async <Result>(direction: 'push' | 'pull', run: () => Promise<Result>): Promise<HubContactStep<Result>> => {
    try {
      return { outcome: 'done', result: await run() };
    } catch (error) {
      const problem = messageOf(error);
      if (!isHubUnreachable(error)) {
        input.warn(`${OPENING}: ${direction} over ${strategy} failed: ${problem}`);
        return { outcome: 'failed', problem };
      }
      if (!toldUnreachable) input.warn(hubUnreachableLine(config.hubUrl, error));
      toldUnreachable = true;
      return { outcome: 'unreachable', problem };
    }
  };

  const run = async (direction: HubContactDirection): Promise<HubContactReading> => {
    if (isCoreStrategy(config.effortSync)) return { state: 'not-contacted', strategy };
    const answer = await selected();
    if ('problem' in answer) return { state: 'unselected', strategy, problem: answer.problem };
    const { sync } = answer;

    const push = direction === 'push-then-pull'
      ? await attempt('push', () => sync.push({ to: null }))
      : null;
    const pull: HubContactStep<SyncPullResult> = push?.outcome === 'unreachable'
      ? { outcome: 'skipped' }
      : await attempt('pull', () => sync.pull(pullRequest));
    return { state: 'contacted', strategy, push, pull };
  };

  return Object.freeze({
    pushThenPull: () => run('push-then-pull'),
    pull: () => run('pull'),
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
    resolved = loadConfig(roots, {}, () => {});
  } catch (error) {
    if (error instanceof ConfigError) return null;
    throw error;
  }
  return createHubContact({ root: roots.root, home: roots.home, resolved, warn }, seams).pull();
}
