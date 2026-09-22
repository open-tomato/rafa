/**
 * `--yes` read as a RISK CEILING: which of the actions `./state.ts`
 * proposes may run with no question put, which lists are refused before
 * anything is read, and which two actions are asked about whatever a
 * list says.
 *
 * Without the flag every action is asked about, one `[y/N]` each. With
 * it, the ids it names may run unasked and the chain STOPS at the first
 * action outside the list, that action's proposal already printed, so
 * the person reads what is left to do and decides. It is a ceiling and
 * not a script: it says how far a run may go by itself, never what to
 * do, which stays `./state.ts`'s answer.
 *
 * This module is the reading and the two refusals. Printing the
 * proposal and stopping the chain there is `src/commands/next.ts`, the
 * one module of the surface that writes a line.
 *
 * ## The eight ids
 *
 * {@link YES_ACTIONS}: `sync`, the one action that runs no registered
 * command (`./sync.ts`), and the seven of {@link NEXT_COMMAND_ACTIONS}
 * that {@link ALWAYS_ASKED} does not hold. They are taken off that table
 * rather than spelled again, so an id the table gains is accepted here
 * the same day and the list `--yes` names cannot drift from the list
 * the chain can run. `none` is not among them: it is the state that
 * proposes nothing, and there is nothing there to allow.
 *
 * ## The four bare `--yes` allows
 *
 * {@link BARE_YES_ACTIONS}: `sync`, `wait`, `unblock` and `plan` — the
 * four that neither merge, nor start a loop, nor push. So bare `--yes`
 * over a green pull request fast-forwards nothing it has to undo: the
 * chain prints the merge proposal and merges nothing. The other four
 * are typed out one at a time, `--yes=merge,start`, which is the shape
 * of a ceiling: the cheap steps are the default, the costly ones are
 * asked for by name.
 *
 * ## The two refusals, both exit 2
 *
 * A list naming an id of {@link ALWAYS_ASKED} — `ready` or
 * `merge-unchecked` — is refused, and so is a list naming a word that
 * is no action id at all. Neither is a mistyped line — the words parse
 * and the flag takes a value — so neither ends with the exit code 1
 * this command's line refusals carry: what is refused is the permission
 * the words ask for, and the spec sets that apart as
 * {@link CEILING_REFUSAL_EXIT}, as `src/pr/provider.ts` does for a
 * repository whose `pr.provider` cannot answer.
 *
 * `ready` is refused rather than quietly dropped because dropping it
 * would read as allowed to the person who typed it. Marking an issue
 * ready is a claim about a spec that a person makes, and `issue ready`
 * itself declares no flag that skips its own question; a chain reaching
 * that step asks, `--yes=ready` or no `--yes` at all.
 *
 * `merge-unchecked` is refused for the same reason, with the question
 * held somewhere else: merging a pull request no check has reported on
 * is asked by `pr merge --skip-checks` itself, which alone reads
 * whether the repository has workflows and so whether its own `--yes`
 * may answer. `rafa next` runs it without `--yes` (`./actions.ts`), and
 * a ceiling that let it run unasked would claim an answer `rafa next`
 * never gives.
 *
 * An unknown id is refused rather than ignored for the same reason in
 * the other direction: `--yes=mrege` silently allowing nothing would
 * stop the chain at the merge it was typed to allow, and the person
 * would read the stop line and not the typo.
 *
 * ## Two places hold "never unasked", and why
 *
 * {@link readYesCeiling} refuses each id of {@link ALWAYS_ASKED} in a
 * list, and {@link allowedUnasked} answers false for each whatever the
 * ceiling holds. The first is the enforcement for every line a person types;
 * the second is what holds for a ceiling built in code, which
 * `runNextChain` takes as an argument and does not parse. They are one
 * rule read at two boundaries, and `ceiling.test.ts` measures both.
 */
import type { NextActionId } from './state.js';
import type { RafaContext } from '../cli/command.js';

import { CommandExit } from '../cli/command.js';

import { NEXT_COMMAND_ACTIONS } from './actions.js';

/** The flag that names the actions which may run unasked. */
export const YES_FLAG = 'yes';

/** The two actions no list runs unasked, whatever it names. */
type AlwaysAskedId = Extract<NextActionId, 'ready' | 'merge-unchecked'>;

/** Why each of {@link ALWAYS_ASKED} is refused in a list, as the refusal words it; see the module note. */
const ALWAYS_ASKED_WHY: Readonly<Record<AlwaysAskedId, string>> = Object.freeze({
  'ready': 'marking an issue ready is a claim about a spec that a person makes,'
    + ' and rafa next asks it however the list is spelled',
  'merge-unchecked': 'merging a pull request no check has reported on is asked by'
    + ' rafa pr merge --skip-checks itself, however the list is spelled',
});

/** The actions no list runs unasked, whatever it names; see the module note. */
export const ALWAYS_ASKED: ReadonlySet<NextActionId> = new Set<NextActionId>(['ready', 'merge-unchecked']);

/** Whether `action` is one of {@link ALWAYS_ASKED}, narrowed to the ids its reasons are keyed by. */
function isAlwaysAsked(action: string): action is AlwaysAskedId {
  return (ALWAYS_ASKED as ReadonlySet<string>).has(action);
}

/** The exit code a refused list ends with; see the module note. */
export const CEILING_REFUSAL_EXIT = 2;

/**
 * The eight ids a list may name: `sync`, which runs no command, and the
 * seven of the action table that {@link ALWAYS_ASKED} does not hold.
 * Taken off that table, so the two cannot drift; see the module note.
 */
export const YES_ACTIONS: readonly NextActionId[] = Object.freeze([
  'sync',
  ...NEXT_COMMAND_ACTIONS.filter((action) => !ALWAYS_ASKED.has(action)),
]);

/** The four bare `--yes` allows: the ones that neither merge, nor start a loop, nor push. */
export const BARE_YES_ACTIONS: readonly NextActionId[] = Object.freeze([
  'sync',
  'wait',
  'unblock',
  'plan',
] as const);

/** The action ids that may run unasked, or null where every one is asked about. */
export type NextCeiling = readonly NextActionId[] | null;

/** A refusal of the list: the problem, then the usage line, with the exit code the module note holds. */
function ceilingRefusal(problem: string, usage: string): CommandExit {
  return new CommandExit(CEILING_REFUSAL_EXIT, `❌ ${problem}\nUsage: ${usage}`);
}

/** One word of a list as an action id, or the refusal it earns. */
function readCeilingId(word: string, usage: string): NextActionId {
  if (isAlwaysAsked(word)) {
    throw ceilingRefusal(`--${YES_FLAG} names ${word}, which no list runs unasked: ${ALWAYS_ASKED_WHY[word]}`, usage);
  }

  const named = YES_ACTIONS.find((action) => action === word);
  if (named !== undefined) return named;
  throw ceilingRefusal(
    `--${YES_FLAG} names "${word}", which is no step of rafa next;`
    + ` the ids are ${YES_ACTIONS.join(', ')}`,
    usage,
  );
}

/**
 * The action ids `--yes` named, or null where the line leaves the flag
 * out: bare it names {@link BARE_YES_ACTIONS}, and a value is read as a
 * comma list, each word trimmed and an empty one dropped. `--no-yes`
 * names nothing, as leaving the flag out does, and `--yes=` names no
 * action — a ceiling that allows nothing, which stops the chain at its
 * first action rather than being a line refused.
 *
 * Throws `CommandExit(2, ...)` naming `usage` for a list holding an id
 * of {@link ALWAYS_ASKED} and for one holding a word that is no action
 * id; see the module note.
 */
export function readYesCeiling(flags: RafaContext['flags'], usage: string): NextCeiling {
  const value = flags[YES_FLAG];
  if (value === undefined || value === false) return null;
  if (value === true) return BARE_YES_ACTIONS;

  return Object.freeze(value
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '')
    .map((word) => readCeilingId(word, usage)));
}

/**
 * Whether `action` may run with no question put: true only where a
 * ceiling names it, and never for an id of {@link ALWAYS_ASKED},
 * whatever the ceiling holds. A null ceiling is no `--yes` at all, where every
 * action is asked about.
 */
export function allowedUnasked(action: NextActionId, ceiling: NextCeiling): boolean {
  if (ceiling === null || ALWAYS_ASKED.has(action)) return false;
  return ceiling.includes(action);
}
