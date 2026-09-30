/**
 * What `rafa next` RUNS once `./state.ts` has answered: each action id
 * mapped onto the registered command that does it, called as that
 * command's own function.
 *
 * ## An action is a command call, never a line
 *
 * The spec's rule is that every action is a registered command, run by
 * calling that command's function and never by spawning a shell line.
 * So this module looks the command up in the registry the caller was
 * routed through ({@link RafaContext.registry}) and awaits its `run`.
 * Nothing here spawns `rafa`, `git` or `gh`, which is what keeps an
 * action's own refusals, its own message and its own exit code intact:
 * a {@link CommandExit} the command throws travels out of
 * {@link runAction} untouched, and the chain that stops on it reports
 * the action's code rather than a shell's.
 *
 * ## The table
 *
 * | Action | Command | The words after it |
 * | --- | --- | --- |
 * | `resume` | `loop start` | `--plan=<plan file>` |
 * | `wait` | `pr wait` | `<pull request>` |
 * | `triage` | `pr triage` | `<pull request>` |
 * | `merge` | `pr merge` | `<pull request> --yes` |
 * | `merge-unchecked` | `pr merge` | `<pull request> --skip-checks` |
 * | `settle` | `release settle` | none |
 * | `start` | `loop start` | `--plan=<plan file> --create-branch` |
 * | `plan` | `plan create` | `--next` |
 * | `unblock` | `issue unblock` | `<issue>` |
 * | `ready` | `issue ready` | `<issue>` |
 *
 * The words come off the state: the pull request of rows 5, 6, 7 and 8,
 * the issue of rows 11 and 12, and the absolute plan file of rows 3, 4
 * and 9, which `--plan` resolves against the project root and therefore
 * takes as it is (`src/start/plan-path.ts`). `settle` takes none: the
 * settle step read after a merge (`./settle-step.ts`) is about the
 * fragments waiting on the base, which `release settle` reads itself. A state whose row left the
 * field it proposes an action over null is a defect of the table and
 * throws here, naming the state and the action, rather than running a
 * command over a guess.
 *
 * Three of those lines say something the table alone does not:
 *
 *  - `merge` passes `--yes`. `rafa next` prints the proposal and asks
 *    `[y/N]` before an action runs at all, so `pr merge`'s own
 *    `Merge? [y/N]` would be the SAME decision asked twice, and under
 *    `--yes=merge` with no terminal `pr merge` refuses rather than
 *    asks. Its flag skips that question and nothing else: the refusals
 *    the spec names — a dirty tree, a pull request that is not green,
 *    one that does not merge, a head branch checked out elsewhere — are
 *    all read before the question, and the unblock question it ends
 *    with is one `--yes` does not answer either (`src/commands/pr/merge.ts`).
 *  - `merge-unchecked` passes `--skip-checks` and NOT `--yes`. The
 *    question `Merge #<n> with no checks? [y/N]` is `pr merge`'s own,
 *    asked after it has read the workflow count and printed the warning
 *    that count calls for, so it is the one decision `rafa next` must
 *    not answer on the person's behalf; and where workflows exist
 *    `pr merge` refuses `--yes` beside `--skip-checks` outright.
 *    Without a terminal it refuses rather than merging unasked.
 *  - `triage` passes the number alone, so no action ever passes
 *    `--resolve`: the words are the same whether the person typed `y`
 *    or `--yes` allowed the step, and a repair session is never spent
 *    unasked.
 *  - `start` passes `--create-branch` and `resume` does not. Row 9 is
 *    read on the base branch, where `loop start` would otherwise stop
 *    to offer the plan's branch; rows 3 and 4 are read on that branch
 *    already.
 *  - `settle` passes no `--dry-run`: the question `rafa next` put, or
 *    the `--yes` list naming `settle`, is the decision to fold the
 *    waiting fragments into a version and push it to the base, and
 *    `release settle` asks none of its own.
 *
 * ## Under `--roadmap`
 *
 * `rafa next --roadmap` hands {@link NextActionOptions.roadmap} to both
 * functions here, and the three actions of {@link ROADMAP_PASSED_ACTIONS}
 * — `plan`, `start` and `resume` — carry `--roadmap` last among their
 * words: `plan create --next --roadmap` picks the away hop's target
 * rather than the epic's first line, and `loop start --roadmap` stamps
 * the hop on the run's session record. The word is in the invocation, so
 * the proposal line prints it and the step records it, as it does every
 * other word that runs. Without the option no word is added, and every
 * line is what it was before the flag existed.
 *
 * `rafa next --roadmap --claim-ahead` hands
 * {@link NextActionOptions.claimAhead} as well, and `plan` alone carries
 * {@link CLAIM_AHEAD_WORD} after `--roadmap`: `plan create --next
 * --roadmap --claim-ahead` also claims the line after its pick
 * (`src/claims/ahead.ts`). `start` and `resume` claim nothing ahead, so
 * their words are unchanged, and without `roadmap` the option adds no
 * word to any action.
 *
 * ## In `native` mode
 *
 * `unblock` is offered in `labels` mode only, the one id of
 * {@link LABELS_ONLY_ACTIONS}: `issue unblock` re-reads a line's
 * blockers and takes `spec:blocked` off, a label only `labels` mode
 * holds, and with `board.relationships` set to `native` the tracker
 * clears a blocker when it closes, so there is nothing to unblock.
 * Row 11 of `./state.ts` already answers nothing there; this module
 * holds the same rule at the table. {@link offeredCommandActions}
 * answers the ids a mode offers — the whole table in `labels`, the
 * table without `unblock` in `native` — and, handed
 * {@link NextActionOptions.mode} `native`, {@link actionInvocation} and
 * so {@link runAction} throw over a state proposing `unblock`, naming
 * the state and the mode, rather than run `issue unblock` for a
 * relationship the board does not record in labels. Left out, the mode
 * is `labels` and every line is what it was before the mode existed.
 *
 * ## The actions with no command
 *
 * `sync`, row 2, is not here. Fast-forwarding the base is not a
 * registered command: it runs through the `GitRunner` seam of
 * `src/pr/git.ts`, and the spec's table says so. `./sync.ts` holds that
 * step and its refusals. {@link actionInvocation} answers null for it,
 * as it does for `none`, and {@link runAction} refuses it as the
 * caller's mistake.
 *
 * `hop` and `home`, the actions the hop rows of `rafa next --roadmap`
 * propose (`./hop-rows.ts`), run no command of their own name either:
 * they write the hop record and move the position (`./hop-action.ts`).
 * {@link actionInvocation} answers null for both, as for `sync`, and the
 * three are {@link NEXT_IN_PROCESS_ACTIONS}, the actions that run
 * in-process. Unlike `sync`, {@link runAction} runs these two itself,
 * off the `NextState.hop` step their row carries, since all they need
 * is the caller's context: the project root the two files sit under,
 * the output their log line goes to, and the registry `hop` finds
 * `rafa switch` in, which it runs as `switch <epic> --no-rehome` the
 * way every command here is run, over a context built the same way. A
 * `hop` or `home` state carrying no step of its own action is a defect
 * of the row and throws, naming the state.
 *
 * ## The context an action runs with
 *
 * {@link runAction} builds one off the caller's: the same output, output
 * mode, verbosity, environment, abort signal, registry and project, with
 * the action's own `argv` and with `args` and `flags` read from those
 * words against the command's own `args` and `flags` — the same
 * `parseArgs` call the dispatcher makes, so a default the command
 * declares is filled and an alias it declares is read.
 *
 * What the caller typed does NOT reach the action: `rafa next`'s own
 * `args`, `flags` and `argv` are replaced, so a `--dry-run` or a
 * `--yes=merge,plan` on the `next` line is no flag of `pr merge`.
 *
 * One flag is set rather than read: {@link HINT_FLAG} is false in every
 * action's context, whatever the command declares it as. Six of the
 * nine commands here end by naming the step that follows
 * (`./ending.ts`), and the chain reads the state again itself after
 * every action — so leaving the flag at its default would read the
 * state twice for one step and, with a terminal, put two questions
 * about it. The words are untouched: the action's `argv` carries no
 * `--no-hint`, so the line `rafa next` prints stays the line a person
 * would type.
 *
 * The output mode is the caller's whatever the action's words say,
 * because one invocation renders one way and ends in one terminal
 * event. That event holds one result: the dispatcher's output refuses a
 * second (`src/cli/dispatch.ts`), so a json-mode chain running two
 * actions that each give one throws inside the second. `rafa next`
 * owns that, and this module hands the result through as the command
 * gave it.
 */
import type { HopActionWorld } from './hop-action.js';
import type { NextActionId, NextState } from './state.js';
import type { RafaCommand, RafaContext } from '../cli/command.js';
import type { BoardRelationshipMode } from '../config-sections.js';

import { CommandExit, commandSpelling } from '../cli/command.js';
import { parseArgs } from '../cli/core/parseArgs.js';

import { HINT_FLAG } from './hint.js';
import { runHome, runHop } from './hop-action.js';

/** What a defect and a refusal this module raises open with. */
const PREFIX = 'rafa next';

/** An action id that runs a registered command: every one but `none`, `sync`, `hop` and `home`. */
export type NextCommandActionId = Exclude<NextActionId, 'none' | 'sync' | 'hop' | 'home'>;

/** An action id that runs in-process, as no registered command of its own name: `sync`, `hop` and `home`. */
export type NextInProcessActionId = Extract<NextActionId, 'sync' | 'hop' | 'home'>;

/** The three action ids that run in-process; see the module note. */
export const NEXT_IN_PROCESS_ACTIONS: readonly NextInProcessActionId[] = Object.freeze(['sync', 'hop', 'home'] as const);

/** Whether an action id runs in-process: `sync`, `hop` and `home`. */
export function runsInProcess(action: NextActionId): action is NextInProcessActionId {
  return (NEXT_IN_PROCESS_ACTIONS as readonly string[]).includes(action);
}

/** A registered command, by its two routing words. */
interface CommandName {
  /** The first routing word: `pr` in `rafa pr merge`. */
  readonly subject: string;
  /** The second: `merge`. */
  readonly action: string;
}

/** The command one action runs, and the words it runs with, read off the state. */
interface ActionCommandSpec extends CommandName {
  /** The words after them, as a person would type them. */
  readonly argv: (state: NextState) => readonly string[];
}

/** The command `hop` moves the position through: `rafa switch`. */
const SWITCH_COMMAND: CommandName = Object.freeze({ subject: 'switch', action: 'switch' });

/** The flag `rafa next --roadmap` passes on to the actions of {@link ROADMAP_PASSED_ACTIONS}. */
export const ROADMAP_WORD = '--roadmap';

/** The actions whose words carry {@link ROADMAP_WORD} under `--roadmap`; see the module note. */
export const ROADMAP_PASSED_ACTIONS: ReadonlySet<NextCommandActionId> = new Set<NextCommandActionId>(['plan', 'start', 'resume']);

/** The flag `rafa next --roadmap --claim-ahead` passes on to `plan`; see the module note. */
export const CLAIM_AHEAD_WORD = '--claim-ahead';

/** How the two functions here read a state beside the state itself. */
export interface NextActionOptions {
  /** Whether the run was typed with `--roadmap`; see the module note. False when left out. */
  readonly roadmap?: boolean;
  /**
   * The board's `board.relationships` mode, which decides whether
   * `unblock` is offered; see the module note. `labels` when left out.
   */
  readonly mode?: BoardRelationshipMode;
  /** Whether it was typed with `--claim-ahead` too; read only beside `roadmap`. False when left out. */
  readonly claimAhead?: boolean;
}

/** The words `action` adds after its own under `options`; see the module note. */
function passedWords(action: NextCommandActionId, options: NextActionOptions): readonly string[] {
  if (options.roadmap !== true || !ROADMAP_PASSED_ACTIONS.has(action)) return [];
  return options.claimAhead === true && action === 'plan'
    ? [ROADMAP_WORD, CLAIM_AHEAD_WORD]
    : [ROADMAP_WORD];
}

/** The value a row filled in, or the defect of a row that proposed an action over none. */
function needed(state: NextState, value: number | string | null, what: string): string {
  if (value === null) {
    throw new Error(`${PREFIX}: state "${state.id}" proposes "${state.action}" and names no ${what}`);
  }
  return String(value);
}

/** The pull request the action runs on, as a word. */
function pullRequestOf(state: NextState): string {
  return needed(state, state.pullRequest, 'pull request');
}

/** The issue the action runs on, as a word. */
function issueOf(state: NextState): string {
  return needed(state, state.issue, 'issue');
}

/** The `--plan` the action runs on: the plan file, absolute. */
function planFlagOf(state: NextState): string {
  return `--plan=${needed(state, state.planPath, 'plan file')}`;
}

/** The ten actions that run a command, each with its own; see the module note. */
const ACTION_COMMANDS: Readonly<Record<NextCommandActionId, ActionCommandSpec>> = Object.freeze({
  resume: { subject: 'loop', action: 'start', argv: (state) => [planFlagOf(state)] },
  wait: { subject: 'pr', action: 'wait', argv: (state) => [pullRequestOf(state)] },
  triage: { subject: 'pr', action: 'triage', argv: (state) => [pullRequestOf(state)] },
  merge: { subject: 'pr', action: 'merge', argv: (state) => [pullRequestOf(state), '--yes'] },
  'merge-unchecked': { subject: 'pr', action: 'merge', argv: (state) => [pullRequestOf(state), '--skip-checks'] },
  settle: { subject: 'release', action: 'settle', argv: () => [] },
  start: { subject: 'loop', action: 'start', argv: (state) => [planFlagOf(state), '--create-branch'] },
  plan: { subject: 'plan', action: 'create', argv: () => ['--next'] },
  unblock: { subject: 'issue', action: 'unblock', argv: (state) => [issueOf(state)] },
  ready: { subject: 'issue', action: 'ready', argv: (state) => [issueOf(state)] },
});

/**
 * The ten action ids that run a registered command, in the table's
 * order. Taken off the table itself, so a caller reading the ids and
 * the mapping that answers for them cannot drift apart.
 */
export const NEXT_COMMAND_ACTIONS: readonly NextCommandActionId[] = Object.freeze(
  Object.keys(ACTION_COMMANDS) as NextCommandActionId[],
);

/** The actions offered in `labels` mode only: `unblock`; see the module note. */
export const LABELS_ONLY_ACTIONS: ReadonlySet<NextCommandActionId> = new Set<NextCommandActionId>(['unblock']);

/** The command actions each mode offers, in the table's order; see the module note. */
const OFFERED_COMMAND_ACTIONS: Readonly<Record<BoardRelationshipMode, readonly NextCommandActionId[]>> = Object.freeze({
  labels: NEXT_COMMAND_ACTIONS,
  native: Object.freeze(NEXT_COMMAND_ACTIONS.filter((action) => !LABELS_ONLY_ACTIONS.has(action))),
});

/**
 * The action ids that run a registered command which `mode` offers, in
 * the table's order: all ten in `labels`, the nine without `unblock` in
 * `native`. See the module note.
 */
export function offeredCommandActions(mode: BoardRelationshipMode): readonly NextCommandActionId[] {
  return OFFERED_COMMAND_ACTIONS[mode];
}

/** The defect of a row that proposed an action the board's mode does not offer. */
function notOffered(state: NextState, mode: BoardRelationshipMode): Error {
  return new Error(`${PREFIX}: state "${state.id}" proposes "${state.action}", which is offered in labels mode only`
    + ` and board.relationships is ${mode}: the tracker clears a blocker when it closes`);
}

/** Whether an action id runs a registered command, which `none`, `sync`, `hop` and `home` do not. */
export function runsCommand(action: NextActionId): action is NextCommandActionId {
  return (NEXT_COMMAND_ACTIONS as readonly string[]).includes(action);
}

/** One command call: the action it does, the command, and the words it runs with. */
export interface NextInvocation {
  /** The action of the state this was read off. */
  readonly action: NextCommandActionId;
  /** The command as a person types it after `rafa`: `pr merge`. */
  readonly command: string;
  /** The words after the command, as typed. */
  readonly argv: readonly string[];
}

/**
 * The command a state's action runs and the words it runs with,
 * `--roadmap` added under {@link NextActionOptions.roadmap} and
 * `--claim-ahead` after it under {@link NextActionOptions.claimAhead}
 * for `plan`, or null
 * for the four ids that run none: `none`, which proposes nothing, and
 * `sync`, `hop` and `home`, which the module note places.
 *
 * Throws, naming the state and the action, on a state proposing an
 * action over a field its row left null, and, naming the mode as well,
 * on one proposing an action {@link NextActionOptions.mode} does not
 * offer: `unblock` in `native` mode.
 */
export function actionInvocation(state: NextState, options: NextActionOptions = {}): NextInvocation | null {
  if (!runsCommand(state.action)) return null;
  const mode = options.mode ?? 'labels';
  if (!offeredCommandActions(mode).includes(state.action)) throw notOffered(state, mode);

  const spec = ACTION_COMMANDS[state.action];
  return Object.freeze({
    action: state.action,
    command: commandSpelling(spec),
    argv: Object.freeze([...spec.argv(state), ...passedWords(state.action, options)]),
  });
}

/** The context one action runs with: the caller's, with its own line read against the command's spec. */
function actionContext(caller: RafaContext, command: RafaCommand, argv: readonly string[]): RafaContext {
  const { positional, flags } = parseArgs(argv, command);
  return Object.freeze({
    ...caller,
    args: Object.freeze(positional),
    flags: Object.freeze({ ...flags, [HINT_FLAG]: false }),
    argv: Object.freeze([...argv]),
  });
}

/**
 * Runs `name` from the caller's registry over `argv`, as the `step`
 * action runs it; a refusal with exit code 1 when nothing registers it.
 */
async function runRegistered(caller: RafaContext, name: CommandName, argv: readonly string[], step: NextActionId): Promise<void> {
  const command = caller.registry.find(name.subject, name.action);
  if (command === undefined) {
    throw new CommandExit(1, `❌ ${PREFIX}: the "${step}" step runs "rafa ${commandSpelling(name)}", which is registered by nothing`);
  }

  await command.run(actionContext(caller, command, argv));
}

/** What `hop` and `home` write and print through, off the caller's context; see the module note. */
function hopWorld(caller: RafaContext, state: NextState): HopActionWorld {
  if (caller.project === null) {
    throw new Error(`${PREFIX}: the action "${state.action}" of state "${state.id}" runs inside a project, and was handed none`);
  }
  return {
    root: caller.project.root,
    switchTo: (argv) => runRegistered(caller, SWITCH_COMMAND, argv, state.action),
    info: (line) => {
      caller.output.info(line);
    },
    warn: (line) => {
      caller.output.warn(line);
    },
    now: () => new Date(),
  };
}

/** The defect of a row that proposed `hop` or `home` and carried no step of that action. */
function noStep(state: NextState): Error {
  return new Error(`${PREFIX}: state "${state.id}" proposes "${state.action}" and carries no ${state.action} step`);
}

/** Runs `hop` or `home` off the step the state carries; see the module note. */
async function runHopStep(caller: RafaContext, state: NextState): Promise<void> {
  const step = state.hop;
  if (step?.action !== state.action) throw noStep(state);
  if (step.action === 'hop') {
    await runHop(hopWorld(caller, state), step);
    return;
  }
  runHome(hopWorld(caller, state), step);
}

/**
 * Runs the state's action: the registered command it names, called as
 * that command's own function over a context built off `caller`, or,
 * for `hop` and `home`, the in-process step of `./hop-action.ts`. See
 * the module note for the table, the context and what an action's words
 * carry.
 *
 * Whatever the command throws is thrown on, a `CommandExit` with its own
 * exit code and message included. Refuses with exit code 1 when the
 * caller's registry holds no such command, throws on a state whose
 * action runs none, `sync` among them, and throws on one whose action
 * {@link NextActionOptions.mode} does not offer, before any command is
 * looked up.
 */
export async function runAction(caller: RafaContext, state: NextState, options: NextActionOptions = {}): Promise<void> {
  if (state.action === 'hop' || state.action === 'home') {
    await runHopStep(caller, state);
    return;
  }

  const invocation = actionInvocation(state, options);
  if (invocation === null) {
    throw new Error(`${PREFIX}: the action "${state.action}" of state "${state.id}" runs no registered command`);
  }

  await runRegistered(caller, ACTION_COMMANDS[invocation.action], invocation.argv, invocation.action);
}
