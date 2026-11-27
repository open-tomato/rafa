/**
 * `rafa effort sync [--status | --dry-run]`: one contact with the hub
 * the project's `effort.sync` strategy names, run through a hub
 * contact's `sync({ stop })` kind (`createHubContact`,
 * `packages/rafa-effort/src/effort/sync/contact.ts`, whose module note,
 * `The sync`, is the long form of every step). It is all code: it starts
 * no Claude session and declares no `spends`.
 *
 * ## The steps
 *
 * The contact runs them in order and stops where the flag says:
 *
 *   1. read the hub's status (reachable, contract, project, the hub's
 *      migrations);
 *   2. the skew check, the hub's contract and migrations against this
 *      rafa's, where `--status` stops, sending and merging nothing;
 *   3. and 4. the push of the rows past the push cursor and the pull
 *      with its merge, in the order `effort.syncMerge` names: the pull
 *      first under `ff-only`, the default, its push leaving out the rows
 *      `merge_conflicts` names and run only once the pull completed, and
 *      the push first under `merge`. `--dry-run` runs both without
 *      writing either the store or the state file;
 *   5. the hub line.
 *
 * The two flags are two stop points, so typing both is refused. The
 * config is read once with its warnings, then once more for the contact,
 * silently, as `rafa status` reads it.
 *
 * ## What it writes
 *
 * Every line the contact writes (the offline line, a refusal naming its
 * next step, a pull's own `projected` or `refilled` line) is a `warn`
 * line, written as the contact writes it, once per contact. After a step
 * that answered, the command adds one `info` line of its own:
 *
 *   - a whole sync: the hub line `hubLine` makes, `hub: reachable,
 *     contract <n>, project <name>; pulled <n> rows`, ending `; <m> rows
 *     held back` when the pull held rows back. A push that left out
 *     conflicted rows (the reading's `conflicted` above zero, which only
 *     `ff-only` asks for) is first given the held line `conflictedLine`
 *     makes, a `warn` line, `effort sync: <n> rows held: they differ
 *     from the hub's copy (merge_conflicts); the rest was pushed`: the
 *     contact's `sync()` counts them and writes no line;
 *   - `--status`: `hub: reachable, contract <n>, project <name>; <p>
 *     rows waiting to push`, the count left out when the strategy counts
 *     none;
 *   - `--dry-run`: `hub: reachable, contract <n>, project <name>; dry
 *     run: <p> rows to push, <n> rows to pull, <c> rows in conflict;
 *     nothing was written`, `push not counted` in the first place when
 *     the strategy has no dry-run push, and `; <h> rows would be held`
 *     after the conflicts when the dry push counted conflicted rows it
 *     would leave out (never under `merge`, which leaves none out);
 *   - `effort.sync` set to `local` or `file`, which no contact reaches:
 *     `effort sync: effort.sync is "<kind>", which syncs with no hub;
 *     nothing to sync`.
 *
 * A step that did not answer writes its own line and the command adds
 * none, so a contact is three lines at most: the pull's own line, the
 * held line, then the hub line or the line standing in its place.
 *
 * With `--output=json` the same lines are `log` events, and a run
 * exiting 0 gives {@link SyncCommandData} as the data of the terminal
 * result: whether a hub was contacted, the outcome, the hub's facts and
 * counts, and `lines`, every line written, in order. A run exiting 1
 * carries no data, since the dispatcher keeps none past a nonzero exit;
 * its error's message is those lines, one per line, so a reader of the
 * result still has them.
 *
 * ## Exit codes
 *
 * By the contact's reading ({@link syncExitCode}):
 *
 *   - **0** for a sync that completed, for each flag's stop point
 *     reached, for nothing to sync (`local` or `file`), and for a hub
 *     that cannot be reached, whose offline line is the one line: the
 *     store this device holds is still whole.
 *   - **1** for a refusal: skew, a contract mismatch, a project the hub
 *     does not serve, or a missing token; and for a run that could not
 *     finish otherwise, a strategy no module selects or a step that
 *     failed for any other reason, each written as the contact words it.
 *     Also 1, contacting nothing, for an argument, a flag given a value,
 *     both flags at once, and a config that cannot be used.
 */
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { ResolvedConfig } from '@open-tomato/rafa/core/config';
import type { ConfigRoots } from '@open-tomato/rafa/core/config/load';
import type { HubSyncReading, HubSyncStop } from '@open-tomato/rafa-effort';

import { conflictedLine, createHubContact, hubLine } from '@open-tomato/rafa-effort';

import { expectNoArgument, readSwitch, requireProject, resolveProjectConfig } from '@open-tomato/rafa/commands/plan/plan-files';
import { CommandExit } from '@open-tomato/rafa/core/command';
import { loadConfig } from '@open-tomato/rafa/core/config/load';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa effort sync';

/** The line its refusals end with. */
export const SYNC_USAGE = 'rafa effort sync [--status | --dry-run]';

const STATUS_FLAG = 'status';
const DRY_RUN_FLAG = 'dry-run';

/** The exit code of a refusal and of a run that could not finish; see the module note. */
export const SYNC_REFUSED_EXIT = 1;

/** What a hub line names for a fact the strategy answered none of, as `hubLine` names it. */
const UNKNOWN = 'unknown';

/** What the contact seam is handed. */
export interface SyncContactInput {
  /** The project root and the home the config is read under. */
  readonly roots: ConfigRoots;
  /** Writes one line the contact has, as a command's `output.warn` does. */
  readonly warn: (message: string) => void;
  /** Where the run stops; null for a whole sync. */
  readonly stop: HubSyncStop | null;
}

/** How the command reaches the hub; each left out is the system's own. */
export interface SyncCommandSeams {
  /** Runs one contact's `sync({ stop })`. {@link syncContact} when left out. */
  readonly contact?: (input: SyncContactInput) => Promise<HubSyncReading>;
}

/** What a run that exits 0 came to, the `outcome` of {@link SyncCommandData}. */
export type SyncOutcome =
  /** Every step ran: pushed, pulled and merged. */
  | 'synced'
  /** `--status` stopped after the skew check, sending and merging nothing. */
  | 'checked'
  /** `--dry-run` pushed and pulled without writing. */
  | 'dry-run'
  /** `effort.sync` is `local` or `file`: nothing was contacted. */
  | 'nothing-to-sync'
  /** The hub could not be reached; the offline line was written. */
  | 'unreachable';

/** The data of the terminal result a run exiting 0 gives with `--output=json`; see the module note. */
export interface SyncCommandData {
  /** The strategy `effort.sync` names. */
  readonly strategy: string;
  /** Whether a hub was contacted: false under `local` and `file`. */
  readonly contacted: boolean;
  /** Where the run was asked to stop; null for a whole sync. */
  readonly stop: HubSyncStop | null;
  readonly outcome: SyncOutcome;
  /** The wire contract version the hub speaks, null when unknown or not read. */
  readonly contractVersion: number | null;
  /** The project push and pull name, null when unknown or not read. */
  readonly projectId: string | null;
  /** The hub's name for that project, null when it names none. */
  readonly projectName: string | null;
  /** The rows waiting to push (`--status`) or a dry-run push counted; null when none was counted. */
  readonly pending: number | null;
  /** The rows the pull's merge added, or would have under `--dry-run`; null when no pull answered. */
  readonly pulled: number | null;
  /** The rows the pull's merge held back for a later refill; null when no pull answered. */
  readonly heldBack: number | null;
  /** The rows the pull's merge found in conflict; null when no pull answered. */
  readonly conflicts: number | null;
  /** Every line the run wrote, in order. */
  readonly lines: readonly string[];
}

/** The contacted reading, the one kind that names steps. */
type Contacted = Extract<HubSyncReading, { readonly state: 'contacted' }>;

/**
 * The contact `rafa effort sync` makes: the config read silently under
 * `roots`, its warnings having been written once by the command, then
 * one contact's `sync({ stop })` run. See the module note.
 */
export async function syncContact(input: SyncContactInput): Promise<HubSyncReading> {
  const { roots, warn, stop } = input;
  // Read silently: the command has read the config already and written its warnings once.
  const resolved: ResolvedConfig = await loadConfig(roots, {}, () => {});
  return createHubContact({ root: roots.root, home: roots.home, resolved, warn }).sync({ stop });
}

/** Whether any step of a contacted run failed for a reason the contact names no refusal cause for. */
function anyFailed(reading: Contacted): boolean {
  return [reading.status, reading.pending, reading.push, reading.pull, reading.hub]
    .some((step) => step?.outcome === 'failed');
}

/** The exit code a sync reading makes; see the module note's `Exit codes`. */
export function syncExitCode(reading: HubSyncReading): number {
  if (reading.state === 'not-contacted') return 0;
  if (reading.state === 'unselected') return SYNC_REFUSED_EXIT;
  return reading.refusal !== null || anyFailed(reading)
    ? SYNC_REFUSED_EXIT
    : 0;
}

/** The opening of the command's own hub lines: reachable, the contract and the project, as `hubLine` words them. */
function hubOpening(reading: Contacted): string | null {
  if (reading.status.outcome !== 'done') return null;
  const { contractVersion, projectId, projectName } = reading.status.result;
  const contract = contractVersion === null
    ? UNKNOWN
    : String(contractVersion);
  return `hub: reachable, contract ${contract}, project ${projectName ?? projectId ?? UNKNOWN}`;
}

/** The rows a run counted waiting to push, null when none was counted. */
function pendingOf(reading: Contacted): number | null {
  return reading.pending?.outcome === 'done'
    ? reading.pending.result
    : null;
}

/** The `--status` line, or null when the run stopped before the check passed. */
function statusLine(reading: Contacted): string | null {
  const opening = hubOpening(reading);
  if (opening === null || reading.refusal !== null || reading.pending?.outcome !== 'done') return null;
  const pending = pendingOf(reading);
  return pending === null
    ? opening
    : `${opening}; ${String(pending)} rows waiting to push`;
}

/** The `--dry-run` line, or null when the pull did not answer and its own line stands instead. */
function dryRunLine(reading: Contacted): string | null {
  const opening = hubOpening(reading);
  if (opening === null || reading.hub.outcome !== 'done') return null;
  const { pulled, heldBack, conflicts } = reading.hub.result;
  const pending = pendingOf(reading);
  const push = pending === null
    ? 'push not counted'
    : `${String(pending)} rows to push`;
  const held = heldBack > 0
    ? `, ${String(heldBack)} rows held back`
    : '';
  const conflicted = conflictedOf(reading);
  const wouldHold = conflicted > 0
    ? `; ${String(conflicted)} rows would be held`
    : '';
  return `${opening}; dry run: ${push}, ${String(pulled)} rows to pull${held}, ${String(conflicts)} rows in conflict${wouldHold};`
    + ' nothing was written';
}

/** The conflicted rows the run's push left out, or a dry push would have: 0 when no push answered. */
function conflictedOf(reading: Contacted): number {
  return reading.conflicted ?? 0;
}

/** The held line a whole sync writes before its hub line, or null when its push left no row out; see the module note. */
function heldLine(reading: Contacted): string | null {
  if (reading.stop !== null) return null;
  const conflicted = conflictedOf(reading);
  return conflicted > 0
    ? conflictedLine(conflicted)
    : null;
}

/** The line the command adds after a contacted run, or null when the contact's own line stands; see the module note. */
function closingLine(reading: Contacted): string | null {
  if (reading.stop === 'status') return statusLine(reading);
  if (reading.stop === 'dry-run') return dryRunLine(reading);
  return reading.hub.outcome === 'done'
    ? hubLine(reading.hub.result)
    : null;
}

/** The one line a run under `local` or `file` writes. */
export function nothingToSyncLine(strategy: string): string {
  return `effort sync: effort.sync is "${strategy}", which syncs with no hub; nothing to sync`;
}

/** The outcome of a run exiting 0. */
function outcomeOf(reading: Contacted): SyncOutcome {
  const steps = [reading.status, reading.push, reading.pull];
  if (steps.some((step) => step?.outcome === 'unreachable')) return 'unreachable';
  if (reading.stop === 'status') return 'checked';
  return reading.stop === 'dry-run'
    ? 'dry-run'
    : 'synced';
}

/** The data a run exiting 0 gives in json mode; see {@link SyncCommandData}. */
export function syncData(reading: HubSyncReading, lines: readonly string[]): SyncCommandData {
  const none = {
    strategy: reading.strategy,
    contacted: false,
    stop: null,
    outcome: 'nothing-to-sync',
    contractVersion: null,
    projectId: null,
    projectName: null,
    pending: null,
    pulled: null,
    heldBack: null,
    conflicts: null,
    lines: Object.freeze([...lines]),
  } as const;
  if (reading.state !== 'contacted') return Object.freeze(none);
  const facts = reading.status.outcome === 'done'
    ? reading.status.result
    : null;
  const merged = reading.hub.outcome === 'done'
    ? reading.hub.result
    : null;
  return Object.freeze({
    ...none,
    contacted: true,
    stop: reading.stop,
    outcome: outcomeOf(reading),
    contractVersion: facts?.contractVersion ?? null,
    projectId: facts?.projectId ?? null,
    projectName: facts?.projectName ?? null,
    pending: pendingOf(reading),
    pulled: merged?.pulled ?? null,
    heldBack: merged?.heldBack ?? null,
    conflicts: merged?.conflicts ?? null,
  });
}

/** Where the line asks the run to stop, refusing both flags at once with {@link SYNC_REFUSED_EXIT}. */
function readStop(context: RafaContext): HubSyncStop | null {
  const hint = `Usage: ${SYNC_USAGE}`;
  const status = readSwitch(STATUS_FLAG, context.flags[STATUS_FLAG], hint);
  const dryRun = readSwitch(DRY_RUN_FLAG, context.flags[DRY_RUN_FLAG], hint);
  if (status && dryRun) {
    throw new CommandExit(
      SYNC_REFUSED_EXIT,
      `❌ ${COMMAND_NAME}: --status and --dry-run are two stop points; give one of them\n${hint}`,
    );
  }
  if (status) return 'status';
  return dryRun
    ? 'dry-run'
    : null;
}

/** Runs `effort sync` with `seams`; see the module note. */
export async function runSync(context: RafaContext, seams: SyncCommandSeams): Promise<void> {
  expectNoArgument(context.args, SYNC_USAGE);
  const stop = readStop(context);
  const project = requireProject(context, COMMAND_NAME);
  await resolveProjectConfig(project, COMMAND_NAME, (message) => {
    context.output.warn(message);
  });

  const lines: string[] = [];
  const warn = (message: string): void => {
    lines.push(message);
    context.output.warn(message);
  };
  const info = (message: string): void => {
    lines.push(message);
    context.output.info(message);
  };
  const reading = await (seams.contact ?? syncContact)({ roots: { root: project.root, home: project.home }, warn, stop });
  const closing = reading.state === 'contacted'
    ? closingLine(reading)
    : null;
  const held = reading.state === 'contacted'
    ? heldLine(reading)
    : null;
  if (reading.state === 'not-contacted') info(nothingToSyncLine(reading.strategy));
  if (held !== null) warn(held);
  if (closing !== null) info(closing);

  const exitCode = syncExitCode(reading);
  if (exitCode !== 0) {
    // The lines are written already; json mode alone repeats them as the error's message, since no data survives the exit.
    throw new CommandExit(exitCode, context.outputMode === 'json'
      ? lines.join('\n')
      : '');
  }
  if (context.outputMode === 'json') context.output.result(syncData(reading, lines));
}

/** The command, reading `seams`; see the module note. */
export function createSyncCommand(seams: SyncCommandSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'effort sync',
    subject: 'effort',
    action: 'sync',
    summary: 'sync the effort store with the hub: read its status, check skew, then pull and push in the order effort.syncMerge names',
    description: 'Makes one contact with the hub the `service` sync strategy names, in five steps: reads the'
      + ' hub\'s status (its contract, this project and its migrations), checks it against this rafa, pulls and'
      + ' merges the other devices\' rows and pushes the rows past the push cursor in the order `effort.syncMerge`'
      + ' names, then prints the hub line, `hub: reachable, contract <n>, project <name>; pulled <n> rows`, ending'
      + ' `; <m> rows held back` when the pull held rows back. Under `ff-only`, the default, the pull comes first,'
      + ' the push runs only once it completed and leaves out the rows `merge_conflicts` names, and a push that'
      + ' left rows out prints `effort sync: <n> rows held: they differ from the hub\'s copy (merge_conflicts); the'
      + ' rest was pushed` before the hub line; under `merge` the push comes first and nothing is left out. A'
      + ' pull\'s own line, for rows projected to this rafa\'s schema or refilled, comes first. `--status` stops'
      + ' after the check and prints the rows waiting to push; `--dry-run` pulls and pushes without writing the'
      + ' store or the state file and prints what would be pushed, pulled and recorded as conflicts, adding'
      + ' `; <n> rows would be held` when the push would leave rows out. A hub that cannot be reached is one `warn` line and exits 0, the local store'
      + ' kept as it is; under `effort.sync: local` or `file` it prints one line saying there is nothing to sync'
      + ' and exits 0. Exit code 1 for a refusal, each one line naming its next step: the hub or this rafa behind'
      + ' the other, a contract mismatch, a project the hub does not serve, a missing token; and for a strategy'
      + ' no module provides or a step that failed otherwise. With `--output=json` a run exiting 0 gives whether'
      + ' a hub was contacted, the outcome, the counts and every line written as the data of the terminal result'
      + ' event, and a run exiting 1 gives the lines as the error\'s message. Starts no session.',
    args: [],
    flags: [
      {
        name: STATUS_FLAG,
        description: 'Stop after the skew check: read the hub\'s status, print the hub\'s contract and project and'
          + ' the rows waiting to push, and send and merge nothing.',
        type: 'boolean',
      },
      {
        name: DRY_RUN_FLAG,
        description: 'Pull and push without writing: count the rows a push would send and hold, and what the merge'
          + ' would add and record as conflicts, leaving the store and the state file as they are.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa effort sync',
        note: 'Pulls and pushes in the order effort.syncMerge names and prints the hub line, or the one line saying why it could not.',
      },
      {
        cmd: 'rafa effort sync --status',
        note: 'Asks the hub where it stands and moves nothing.',
      },
      {
        cmd: 'rafa effort sync --dry-run',
        note: 'Shows what a sync would push, hold, pull and record as conflicts, writing nothing.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => runSync(context, seams),
  };
  return Object.freeze(command);
}

const command: RafaCommand = createSyncCommand();
export default command;
