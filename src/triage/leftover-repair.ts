/**
 * The repair task the triage adds for a leftover of the plan's own: an
 * `out_of_scope_bugs` entry read as `own-fallout` (an earlier task of
 * this plan turned a test red) or `own-gap` (this plan built something
 * and left it unfinished). Such an entry is repaired in the same pull
 * request rather than filed, while the plan holds fewer of these repairs
 * than the run's cap.
 *
 * ## The line
 *
 * {@link insertLeftoverRepair} writes it through `insertTrackerTask`
 * (`utils/tracker.ts`) directly above the first open plan task, in
 * document order, `[ ]` or `[BLOCKED]`, or after the checklist's last
 * task when none is open:
 *
 * ```text
 * - [BLOCKED] Repair the own-fallout leftover: <what> <!-- leftover -->  {agent=build-error-resolver}  <!-- blocked: ... -->
 * ```
 *
 * {@link leftoverRepairText} answers the line between the checkbox and
 * the blocker comment. The sentence quotes the entry's `what`, and the
 * blocker comment holds the `what` and the `artifact` the session gets
 * handed. Being blocked, the line is the one `findNextTask` answers
 * first, so the next task the run dispatches is the repair.
 *
 * Every word of it a session wrote is escaped as `escapeBlockerText`
 * escapes a blocker, so a line break in the `what` stays on the one
 * line, where a `- [ ]` after it opens no task, and a `<!--` in it
 * becomes `<\!--`, which opens no comment and is no marker. The
 * declaration `insertTrackerTask` appends is the last brace group of
 * the text and the marker is written before it, so a brace group the
 * `what` holds is never at the end of the text and is never read as
 * the line's declaration.
 *
 * An `own-fallout` repair is declared for {@link LEFTOVER_AGENTS}'
 * `build-error-resolver`, the agent of the suite step's repair
 * (`REPAIR_AGENT` in `start/suite-blocker.ts`); an `own-gap` repair for
 * `loop-implementer`, since it finishes what the plan built.
 *
 * ## The marker and the cap
 *
 * The sentence ends on {@link LEFTOVER_MARKER}, so the tracker alone
 * tells how many leftover repairs a plan holds:
 * {@link countLeftoverRepairs} counts every task line, ticked ones
 * included, whose sentence {@link isLeftoverRepairTask} reads as one,
 * never a line inside a closed `rafa:*` block. `isRepairTask` in
 * `start/suite-blocker.ts` reads the same sentence as a repair's, so a
 * red step after a leftover repair writes its blocker on the repair's
 * own line, and the repair's `done` keeps the run's retry count.
 *
 * {@link insertLeftoverRepair} inserts nothing once the count has
 * reached the cap, the run's resolved retry count (`resolveRunRetries`
 * in `start/retry-budget.ts`), `false` reading as zero: under the
 * default every leftover goes to the follow-up issue instead. A
 * tracker that cannot be read, or a line `insertTrackerTask` refuses,
 * throws, as `insertTrackerTask` does; the caller answers the throw.
 */
import type { LoopRetries } from '../config-schema-loop-retries.js';
import type { InsertedTask } from '../utils/tracker.js';
import type { BugKind } from '@open-tomato/rafa/report/parse';

import { readFileSync } from 'node:fs';

import { parseTaskDeclaration , escapeBlockerText } from '@open-tomato/rafa/core/plan';

import { insertTrackerTask, listTrackerTasks } from '../utils/tracker.js';

/** The two kinds a leftover repair is inserted for. */
export type LeftoverKind = Extract<BugKind, 'own-fallout' | 'own-gap'>;

/** The agent each leftover kind's repair is declared for; see the module note. */
export const LEFTOVER_AGENTS: Readonly<Record<LeftoverKind, string>> = Object.freeze({
  'own-fallout': 'build-error-resolver',
  'own-gap': 'loop-implementer',
});

/** What a leftover repair's sentence ends on. */
export const LEFTOVER_MARKER = '<!-- leftover -->';

/** A leftover repair's sentence, its declaration off: the opening, the quoted `what`, and the marker. */
const LEFTOVER_REPAIR = /^Repair the own-(?:fallout|gap) leftover: .*\s<!-- leftover -->$/;

/** The entry a leftover repair is written for. */
export interface LeftoverEntry {
  /** The kind the triage read the entry as. */
  readonly kind: LeftoverKind;
  /** What the session wrote the leftover is. */
  readonly what: string;
  /** The byte string that showed it, or null when the entry held none. */
  readonly artifact: string | null;
}

/** What {@link insertLeftoverRepair} did. */
export type LeftoverInsert =
  | { readonly inserted: true; readonly line: number }
  | { readonly inserted: false; readonly count: number; readonly cap: number };

/** What each kind's blocker says the leftover is. */
const KIND_SENTENCE: Readonly<Record<LeftoverKind, string>> = Object.freeze({
  'own-fallout': 'An earlier task of this plan broke this, and the triage read it as the plan\'s own fallout',
  'own-gap': 'This plan built this and left it unfinished, in files the plan\'s commits touched',
});

/** The task sentence of `entry`'s repair, its `what` escaped, ending on the marker. */
function leftoverSentence(entry: LeftoverEntry): string {
  return `Repair the ${entry.kind} leftover: ${escapeBlockerText(entry.what.trim())} ${LEFTOVER_MARKER}`;
}

/** The blocker `entry`'s repair is handed: what kind of leftover it is, its `what` and its `artifact`. */
function leftoverBlocker(entry: LeftoverEntry): string {
  const artifact = entry.artifact === null || entry.artifact.trim().length === 0
    ? ''
    : ` The artifact that showed it: ${entry.artifact.trim()}`;
  return `${KIND_SENTENCE[entry.kind]}: ${entry.what.trim()}${artifact}`;
}

/** The task {@link insertLeftoverRepair} hands `insertTrackerTask` for `entry`. */
export function leftoverRepairTask(entry: LeftoverEntry): InsertedTask {
  return {
    task: leftoverSentence(entry),
    declaration: `agent=${LEFTOVER_AGENTS[entry.kind]}`,
    blocker: leftoverBlocker(entry),
  };
}

/**
 * The line of `entry`'s repair between its checkbox and its blocker
 * comment: the escaped sentence, the {@link LEFTOVER_MARKER} and the
 * agent declaration, as `insertTrackerTask` writes them.
 */
export function leftoverRepairText(entry: LeftoverEntry): string {
  const task = leftoverRepairTask(entry);
  return `${task.task}  {${task.declaration}}`;
}

/** True when `text`, a task's sentence without its declaration, is a leftover repair's. */
export function isLeftoverRepairTask(text: string): boolean {
  return LEFTOVER_REPAIR.test(text.trim());
}

/** How many leftover repairs `trackerContent` holds, ticked ones included. */
function countIn(trackerContent: string): number {
  return listTrackerTasks(trackerContent)
    .filter((task) => isLeftoverRepairTask(parseTaskDeclaration(task.task).text))
    .length;
}

/** How many leftover repairs the tracker at `trackerPath` holds, ticked ones included; see the module note. */
export function countLeftoverRepairs(trackerPath: string): number {
  return countIn(readFileSync(trackerPath, 'utf8'));
}

/** `retries` as a count of leftover repairs: `false` is none. */
export function leftoverCap(retries: LoopRetries): number {
  return retries === false
    ? 0
    : retries;
}

/**
 * Inserts `entry`'s repair above the first open task of the tracker at
 * `trackerPath`, or after its last task when none is open, while the
 * tracker holds fewer leftover repairs than `retries` allows; past the
 * cap it writes nothing and answers the count and the cap. See the
 * module note.
 */
export function insertLeftoverRepair(trackerPath: string, entry: LeftoverEntry, retries: LoopRetries): LeftoverInsert {
  const content = readFileSync(trackerPath, 'utf8');
  const cap = leftoverCap(retries);
  const count = countIn(content);
  if (count >= cap) return { inserted: false, count, cap };
  const firstOpen = listTrackerTasks(content).find((task) => task.status !== 'done')?.lineNum ?? null;
  return { inserted: true, line: insertTrackerTask(trackerPath, leftoverRepairTask(entry), firstOpen) };
}
