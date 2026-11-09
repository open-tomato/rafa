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
 *
 * ## The keyed marker and the join
 *
 * An entry handed a `key`, its recurrence key (`bugKeyOf`), or a
 * `symbol`, the one the kind check's `plan-symbol` row matched, writes
 * them in a keyed marker right before the bare one:
 *
 * ```text
 * Repair the own-gap leftover: <what> <!-- leftover key=<hash> symbol=<name> --> <!-- leftover -->
 * ```
 *
 * The `<hash>` is the first {@link KEY_HASH_LENGTH} hex digits of the
 * key's SHA-256, so the line names no text of the key; the `<name>` is
 * the symbol percent-encoded as `encodeURIComponent` does, one token
 * with no space, brace, `<` or `>`. Either part is left out when the
 * entry has none, and an entry with neither writes the bare marker
 * alone, the line every tracker held before keys. The bare marker still
 * ends every sentence, so {@link isLeftoverRepairTask}, the cap and
 * `isRepairTask` read a keyed line and an old one alike, and a test or a
 * reader looking for {@link LEFTOVER_MARKER} still finds it. A `what`
 * never forges a keyed marker: its `<!--` is escaped as above.
 *
 * Before the cap is read, {@link insertLeftoverRepair} looks for an
 * open leftover line, `[ ]` or `[BLOCKED]`, whose keyed marker holds the
 * entry's key hash or its symbol. The first such line in document order
 * is joined: nothing is written and the answer names that line and what
 * matched, so one cause reported twice holds one repair and one slot
 * under the cap. A ticked line is never joined, its repair being done,
 * and a line with the bare marker alone, holding no key, is never
 * joined either.
 */
import type { LoopRetries } from '@open-tomato/rafa/config-schema-loop-retries';
import type { BugKind } from '@open-tomato/rafa/report/parse';
import type { InsertedTask } from '@open-tomato/rafa/utils/tracker';

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseTaskDeclaration , escapeBlockerText } from '@open-tomato/rafa/core/plan';
import { insertTrackerTask, listTrackerTasks } from '@open-tomato/rafa/utils/tracker';

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

/** How many hex digits of the key's SHA-256 a keyed marker holds. */
export const KEY_HASH_LENGTH = 12;

/** The keyed marker before the bare one at a sentence's end; its group holds the ` name=value` parts. */
const KEYED_MARKER = /\s<!-- leftover((?: (?:key|symbol)=\S+)+) --> <!-- leftover -->$/;

/** One ` name=value` part of a keyed marker. */
const MARKER_PART = / (key|symbol)=(\S+)/g;

/** The entry a leftover repair is written for. */
export interface LeftoverEntry {
  /** The kind the triage read the entry as. */
  readonly kind: LeftoverKind;
  /** What the session wrote the leftover is. */
  readonly what: string;
  /** The byte string that showed it, or null when the entry held none. */
  readonly artifact: string | null;
  /** Its recurrence key (`bugKeyOf`), hashed into the keyed marker; left out or null when it has none. */
  readonly key?: string | null;
  /** The symbol the `plan-symbol` row matched, written in the keyed marker; left out or null when none. */
  readonly symbol?: string | null;
}

/** What a leftover repair's keyed marker holds, each part null when the marker leaves it out. */
export interface LeftoverMarkerParts {
  /** The key's hash, {@link KEY_HASH_LENGTH} hex digits. */
  readonly key: string | null;
  /** The symbol, percent-encoded. */
  readonly symbol: string | null;
}

/** What {@link insertLeftoverRepair} did. */
export type LeftoverInsert =
  | { readonly inserted: true; readonly line: number }
  /** An open leftover line held the entry's key hash or symbol; `line` counts from zero. */
  | { readonly inserted: false; readonly joined: true; readonly line: number; readonly by: 'key' | 'symbol' }
  | { readonly inserted: false; readonly count: number; readonly cap: number };

/** What each kind's blocker says the leftover is. */
const KIND_SENTENCE: Readonly<Record<LeftoverKind, string>> = Object.freeze({
  'own-fallout': 'An earlier task of this plan broke this, and the triage read it as the plan\'s own fallout',
  'own-gap': 'This plan built this and left it unfinished, in files the plan\'s commits touched',
});

/** The first {@link KEY_HASH_LENGTH} hex digits of `key`'s SHA-256. */
export function leftoverKeyHash(key: string): string {
  return createHash('sha256')
    .update(key)
    .digest('hex')
    .slice(0, KEY_HASH_LENGTH);
}

/** `text` when it holds more than whitespace, else null. */
function textOrNull(text: string | null | undefined): string | null {
  return typeof text === 'string' && text.trim().length > 0
    ? text
    : null;
}

/** The keyed marker parts `entry` writes: its key hashed and its symbol encoded, each null when absent. */
export function leftoverMarkerPartsOf(entry: Pick<LeftoverEntry, 'key' | 'symbol'>): LeftoverMarkerParts {
  const key = textOrNull(entry.key);
  const symbol = textOrNull(entry.symbol);
  return {
    key: key === null
      ? null
      : leftoverKeyHash(key),
    symbol: symbol === null
      ? null
      : encodeURIComponent(symbol.trim()),
  };
}

/** The markers `entry`'s sentence ends on: the keyed one, when it has parts, then the bare one. */
function markersOf(entry: LeftoverEntry): string {
  const parts = leftoverMarkerPartsOf(entry);
  const written = [
    ...parts.key === null
      ? []
      : [`key=${parts.key}`],
    ...parts.symbol === null
      ? []
      : [`symbol=${parts.symbol}`],
  ];
  return written.length === 0
    ? LEFTOVER_MARKER
    : `<!-- leftover ${written.join(' ')} --> ${LEFTOVER_MARKER}`;
}

/** The task sentence of `entry`'s repair, its `what` escaped, ending on the markers. */
function leftoverSentence(entry: LeftoverEntry): string {
  return `Repair the ${entry.kind} leftover: ${escapeBlockerText(entry.what.trim())} ${markersOf(entry)}`;
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
 * comment: the escaped sentence, the keyed marker when the entry has a
 * key or a symbol, the {@link LEFTOVER_MARKER} and the agent
 * declaration, as `insertTrackerTask` writes them.
 */
export function leftoverRepairText(entry: LeftoverEntry): string {
  const task = leftoverRepairTask(entry);
  return `${task.task}  {${task.declaration}}`;
}

/** True when `text`, a task's sentence without its declaration, is a leftover repair's. */
export function isLeftoverRepairTask(text: string): boolean {
  return LEFTOVER_REPAIR.test(text.trim());
}

/**
 * The keyed marker parts of `text`, a task's sentence without its
 * declaration, or null when it is no leftover repair's or ends on the
 * bare marker alone.
 */
export function leftoverMarkerPartsIn(text: string): LeftoverMarkerParts | null {
  const sentence = text.trim();
  if (!isLeftoverRepairTask(sentence)) return null;
  const found = KEYED_MARKER.exec(sentence)?.[1];
  if (found === undefined) return null;
  const parts = new Map([...found.matchAll(MARKER_PART)].map((part) => [part[1], part[2] ?? null] as const));
  return { key: parts.get('key') ?? null, symbol: parts.get('symbol') ?? null };
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
 * Joins the open leftover line holding `entry`'s key hash or symbol, or
 * inserts `entry`'s repair above the first open task of the tracker at
 * `trackerPath`, or after its last task when none is open, while the
 * tracker holds fewer leftover repairs than `retries` allows; a join or
 * a count past the cap writes nothing, answering the joined line or the
 * count and the cap. See the module note.
 */
export function insertLeftoverRepair(trackerPath: string, entry: LeftoverEntry, retries: LoopRetries): LeftoverInsert {
  const content = readFileSync(trackerPath, 'utf8');
  const joined = joinOf(content, entry);
  if (joined !== null) return joined;
  const cap = leftoverCap(retries);
  const count = countIn(content);
  if (count >= cap) return { inserted: false, count, cap };
  const firstOpen = listTrackerTasks(content).find((task) => task.status !== 'done')?.lineNum ?? null;
  return { inserted: true, line: insertTrackerTask(trackerPath, leftoverRepairTask(entry), firstOpen) };
}

/** What of `wanted` the parts `held` match, the key first, or null when neither does. */
function matchOf(held: LeftoverMarkerParts, wanted: LeftoverMarkerParts): 'key' | 'symbol' | null {
  if (wanted.key !== null && held.key === wanted.key) return 'key';
  if (wanted.symbol !== null && held.symbol === wanted.symbol) return 'symbol';
  return null;
}

/**
 * The join of `entry` onto the first open leftover line of
 * `trackerContent` whose keyed marker holds its key hash or symbol, or
 * null when none does; see the module note.
 */
function joinOf(trackerContent: string, entry: LeftoverEntry): LeftoverInsert | null {
  const wanted = leftoverMarkerPartsOf(entry);
  if (wanted.key === null && wanted.symbol === null) return null;
  for (const task of listTrackerTasks(trackerContent)) {
    if (task.status === 'done') continue;
    const held = leftoverMarkerPartsIn(parseTaskDeclaration(task.task).text);
    const by = held === null
      ? null
      : matchOf(held, wanted);
    if (by !== null) return { inserted: false, joined: true, line: task.lineNum, by };
  }
  return null;
}
