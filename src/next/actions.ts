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
 * | `start` | `loop start` | `--plan=<plan file> --create-branch` |
 * | `plan` | `plan create` | `--next` |
 * | `unblock` | `issue unblock` | `<issue>` |
 * | `ready` | `issue ready` | `<issue>` |
 *
 * The words come off the state: the pull request of rows 5, 6, 7 and 8,
 * the issue of rows 11 and 12, and the absolute plan file of rows 3, 4
 * and 9, which `--plan` resolves against the project root and therefore
 * takes as it is (`src/start/plan-path.ts`). A state whose row left the
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
 *
 * ## The one action with no command
 *
 * `sync`, row 2, is not here. Fast-forwarding the base is not a
 * registered command: it runs through the `GitRunner` seam of
 * `src/pr/git.ts`, and the spec's table says so. `./sync.ts` holds that
 * step and its refusals. {@link actionInvocation} answers null for it,
 * as it does for `none`, and {@link runAction} refuses it as the
 * caller's mistake.
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
 * eight commands here end by naming the step that follows
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
import type { NextActionId, NextState } from './state.js';
import type { RafaCommand, RafaContext } from '../cli/command.js';

import { CommandExit, commandSpelling } from '../cli/command.js';
import { parseArgs } from '../cli/core/parseArgs.js';

import { HINT_FLAG } from './hint.js';

/** What a defect and a refusal this module raises open with. */
const PREFIX = 'rafa next';

/** An action id that runs a registered command: every one but `none` and `sync`. */
export type NextCommandActionId = Exclude<NextActionId, 'none' | 'sync'>;

/** The command one action runs, and the words it runs with, read off the state. */
interface ActionCommandSpec {
  /** The first routing word: `pr` in `rafa pr merge`. */
  readonly subject: string;
  /** The second: `merge`. */
  readonly action: string;
  /** The words after them, as a person would type them. */
  readonly argv: (state: NextState) => readonly string[];
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

/** The nine actions that run a command, each with its own; see the module note. */
const ACTION_COMMANDS: Readonly<Record<NextCommandActionId, ActionCommandSpec>> = Object.freeze({
  resume: { subject: 'loop', action: 'start', argv: (state) => [planFlagOf(state)] },
  wait: { subject: 'pr', action: 'wait', argv: (state) => [pullRequestOf(state)] },
  triage: { subject: 'pr', action: 'triage', argv: (state) => [pullRequestOf(state)] },
  merge: { subject: 'pr', action: 'merge', argv: (state) => [pullRequestOf(state), '--yes'] },
  'merge-unchecked': { subject: 'pr', action: 'merge', argv: (state) => [pullRequestOf(state), '--skip-checks'] },
  start: { subject: 'loop', action: 'start', argv: (state) => [planFlagOf(state), '--create-branch'] },
  plan: { subject: 'plan', action: 'create', argv: () => ['--next'] },
  unblock: { subject: 'issue', action: 'unblock', argv: (state) => [issueOf(state)] },
  ready: { subject: 'issue', action: 'ready', argv: (state) => [issueOf(state)] },
});

/**
 * The nine action ids that run a registered command, in the table's
 * order. Taken off the table itself, so a caller reading the ids and
 * the mapping that answers for them cannot drift apart.
 */
export const NEXT_COMMAND_ACTIONS: readonly NextCommandActionId[] = Object.freeze(
  Object.keys(ACTION_COMMANDS) as NextCommandActionId[],
);

/** Whether an action id runs a registered command, which `none` and `sync` do not. */
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
 * The command a state's action runs and the words it runs with, or null
 * for the two ids that run none: `none`, which proposes nothing, and
 * `sync`, which the module note places.
 *
 * Throws, naming the state and the action, on a state proposing an
 * action over a field its row left null.
 */
export function actionInvocation(state: NextState): NextInvocation | null {
  if (!runsCommand(state.action)) return null;

  const spec = ACTION_COMMANDS[state.action];
  return Object.freeze({
    action: state.action,
    command: commandSpelling(spec),
    argv: Object.freeze(spec.argv(state)),
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
 * Runs the state's action: the registered command it names, called as
 * that command's own function over a context built off `caller`. See
 * the module note for the table, the context and what an action's words
 * carry.
 *
 * Whatever the command throws is thrown on, a `CommandExit` with its own
 * exit code and message included. Refuses with exit code 1 when the
 * caller's registry holds no such command, and throws on a state whose
 * action runs none.
 */
export async function runAction(caller: RafaContext, state: NextState): Promise<void> {
  const invocation = actionInvocation(state);
  if (invocation === null) {
    throw new Error(`${PREFIX}: the action "${state.action}" of state "${state.id}" runs no registered command`);
  }

  const spec = ACTION_COMMANDS[invocation.action];
  const command = caller.registry.find(spec.subject, spec.action);
  if (command === undefined) {
    throw new CommandExit(1, `❌ ${PREFIX}: the "${invocation.action}" step runs "rafa ${invocation.command}", which is registered by nothing`);
  }

  await command.run(actionContext(caller, command, invocation.argv));
}
