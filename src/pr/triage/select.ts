/**
 * Which pull request a bare `rafa pr triage` assesses.
 *
 * With a number — `rafa pr triage 21` — there is nothing to decide, and
 * that reading is the caller's. Without one there is: the repository may
 * have no red pull request at all, or one, or a dozen, and assessing is
 * neither free nor silent (a conflict read, a run listing and a log tail
 * per failing job, then a comment written or edited on the pull
 * request). So the spec gives the bare form a selection rule
 * (`.rafa/specs/rafa-20-pr-commands.md`), and this module is that rule:
 *
 *   1. A pull request open on the CURRENT branch is the answer, whatever
 *      colour it is. Someone standing on a branch asking for a triage is
 *      asking about that branch, and `./rerun.ts` is what decides that a
 *      green one has nothing to assess.
 *   2. Otherwise the red pull requests are the candidates. One is
 *      assessed. Two or three are assessed if they moved inside
 *      {@link TRIAGE_FRESH_HOURS}, and the older ones are NAMED as
 *      skipped with the command that would assess them. More than three
 *      are listed with a command each and nothing is assessed.
 *   3. `--resolve` with more than one candidate refuses, exit
 *      {@link REFUSE_EXIT_CODE}, listing the commands.
 *
 * Pure and total, like `./classify.ts` and `./rerun.ts`: no clock, no
 * process, no await, no throw. The clock is an input
 * ({@link TriageSelectionInput.now}), so the 72-hour rule is driven from
 * literals. Every input reaches exactly one of
 * {@link TRIAGE_SELECTION_DECISIONS}.
 *
 * ## Why one candidate is assessed however old it is
 *
 * The 72-hour rule reads as a freshness policy, and it is not one. It
 * exists to stop a bare command from fanning out over a backlog: with
 * two or three red pull requests, the ones nobody has touched in days
 * are usually not what the operator has in mind, and assessing them
 * writes a comment on each. With ONE candidate there is no fan-out and
 * no ambiguity about which pull request was meant, so the spec triages
 * it and this module does — an eleven-day-old lone red pull request is
 * assessed, and its age is in the headline rather than in a refusal.
 * That is the one place `single` and `some` genuinely differ, which is
 * why they are separate decisions rather than one arm counting.
 *
 * ## Why `--resolve` counts CANDIDATES and not what would be assessed
 *
 * The refusal fires on more than one candidate, before the 72-hour rule
 * narrows them. So three red pull requests of which one is fresh refuse
 * under `--resolve`, even though a bare run would have assessed exactly
 * that one. This is the spec's wording taken literally, and it is the
 * right way round for a flag that PUSHES: `--resolve` merges a base,
 * rewrites a lockfile and pushes to a branch, and choosing which branch
 * to do that to by a freshness heuristic is not a choice to make on the
 * operator's behalf. Listing the three commands costs one paste.
 *
 * A pull request on the current branch is not narrowed by anything, so
 * `--resolve` there is a single explicit target and never refuses here.
 *
 * ## An unreadable timestamp is stale, and so is an unreadable clock
 *
 * `updatedAt` is GitHub's ISO 8601, but this module never asserts that:
 * a value it cannot parse — and equally a `now` it cannot parse — leaves
 * the age unknown, and an unknown age cannot be SHOWN to be inside the
 * window. Such a candidate reads as stale, is listed with its command
 * and is described as moving `at an unrecorded time`. The alternative,
 * treating unknown as fresh, would assess and comment on a pull request
 * on the strength of a timestamp nobody could read. A lone candidate is
 * still assessed, because rule 2 never asks about its age.
 *
 * A timestamp AHEAD of the clock — a skewed runner, a clock set back —
 * is fresh and reads as `just now`. It is inside the window by
 * subtraction, and the window is inclusive at exactly
 * {@link TRIAGE_FRESH_HOURS}: a pull request touched 72 hours to the
 * millisecond ago is assessed, not skipped.
 *
 * ## What the messages are, and what they are not
 *
 * The spec writes the multi-candidate reading as one line ("3 red:
 * assessing #21 and #24; #9 last moved 11 days ago and is skipped, run
 * `rafa pr triage 9`"). Here that is a {@link TriageSelection.headline}
 * and one {@link TriageSelection.lines} entry per pull request not
 * assessed, joined into {@link TriageSelection.message}: the same words,
 * wrapped so that five candidates do not become one unreadable line.
 * Commands are written bare, as `rafa pr merge` writes its own triage
 * pointer, so the line pastes into a shell without stripping backticks.
 *
 * Numbers are sorted ascending wherever several are named, because the
 * port answers newest first and a list that reorders itself between runs
 * is one an operator cannot scan.
 */
import type { PullRequestSummary } from '../types.js';

/**
 * What the selection concluded. Exactly one of these is the answer; the
 * precedence between them is in the module note.
 */
export type TriageSelectionDecision
  = | 'branch'
    | 'single'
    | 'some'
    | 'list'
    | 'none'
    | 'refuse';

/**
 * Every decision, in the order {@link selectTriagePullRequests} asks for
 * them. Frozen, because a caller that pushed onto it would change what
 * every later reader accepts.
 */
export const TRIAGE_SELECTION_DECISIONS: readonly TriageSelectionDecision[] = Object.freeze([
  'branch',
  'refuse',
  'none',
  'single',
  'some',
  'list',
] as const);

/** Whether a value is one of {@link TRIAGE_SELECTION_DECISIONS}. */
export function isTriageSelectionDecision(value: unknown): value is TriageSelectionDecision {
  return typeof value === 'string'
    && (TRIAGE_SELECTION_DECISIONS as readonly string[]).includes(value);
}

/** How long ago a pull request must have moved to be assessed alongside others. */
export const TRIAGE_FRESH_HOURS = 72;

const HOUR_MS = 3_600_000;

const DAY_MS = 24 * HOUR_MS;

/** {@link TRIAGE_FRESH_HOURS} in milliseconds; the window is inclusive. */
export const TRIAGE_FRESH_WINDOW_MS = TRIAGE_FRESH_HOURS * HOUR_MS;

/** How many candidates a bare `rafa pr triage` assesses before it lists instead. */
export const MAX_TRIAGE_CANDIDATES = 3;

/** The exit code the `--resolve` refusal carries. */
export const REFUSE_EXIT_CODE = 2;

/** Above this many hours an age is said in days. */
const DAYS_FROM_HOURS = 48;

/** How the `--resolve` refusal opens. */
const REFUSAL_PREFIX = 'rafa pr triage --resolve refuses';

/** The indent a listed line carries, as `rafa pr merge` indents its own. */
const INDENT = '   ';

/** Everything {@link selectTriagePullRequests} decides from. */
export interface TriageSelectionInput {
  /**
   * The open pull request whose head is the current branch — `findOpen`
   * of it — or null when the branch has none. It outranks every
   * candidate; see the module note.
   */
  readonly current: PullRequestSummary | null;
  /**
   * The red pull requests, as the caller read them. Which are red is
   * the caller's reading (`verdictOf` over each one's rows), so this
   * module stays pure and takes no port.
   */
  readonly candidates: readonly PullRequestSummary[];
  /** `--resolve`, which refuses above one candidate. */
  readonly resolve?: boolean;
  /** The clock, ISO 8601, the same spelling `updatedAt` carries. */
  readonly now: string;
}

/** One candidate that is not being assessed, as a listed line names it. */
export interface SkippedCandidate {
  readonly number: number;
  readonly title: string;
  /** Its `updatedAt` verbatim, as the port answered it. */
  readonly updatedAt: string;
  /** When it last moved, in words: `11 days ago`, `at an unrecorded time`. */
  readonly age: string;
  /** Whether it moved inside {@link TRIAGE_FRESH_WINDOW_MS}. */
  readonly fresh: boolean;
  /** The command that assesses it, `--resolve` included when it was asked for. */
  readonly command: string;
}

/** What the selection concluded, and what it prints. */
export interface TriageSelection {
  /** The reading. One of {@link TRIAGE_SELECTION_DECISIONS}. */
  readonly decision: TriageSelectionDecision;
  /** The pull requests to assess, ascending by number. Empty for every other decision. */
  readonly assess: readonly PullRequestSummary[];
  /**
   * Every candidate NOT being assessed: the older ones under `some`,
   * all of them under `list` and `refuse`, none under the rest.
   */
  readonly skipped: readonly SkippedCandidate[];
  /** {@link REFUSE_EXIT_CODE} for the refusal, 0 for every other decision. */
  readonly exitCode: number;
  /** One line naming the reading. Never empty. */
  readonly headline: string;
  /** The listed lines under it, indented; empty when there are none. */
  readonly lines: readonly string[];
  /** The headline and the lines, joined; ends without a newline. */
  readonly message: string;
}

/**
 * How long ago `updatedAt` was, against `now`, in milliseconds. Null
 * when either side could not be parsed; negative when the timestamp is
 * ahead of the clock. See the module note.
 */
export function ageMs(updatedAt: string, now: string): number | null {
  const then = Date.parse(updatedAt);
  const at = Date.parse(now);
  if (Number.isNaN(then) || Number.isNaN(at)) return null;
  return at - then;
}

/**
 * Whether a pull request moved inside {@link TRIAGE_FRESH_WINDOW_MS}.
 * An age that could not be read is not fresh; the window is inclusive.
 */
export function isFreshCandidate(updatedAt: string, now: string): boolean {
  const age = ageMs(updatedAt, now);
  return age !== null && age <= TRIAGE_FRESH_WINDOW_MS;
}

/** `1 thing` or `n things`, so a count reads as English. */
function plural(count: number, singular: string, many: string): string {
  return count === 1
    ? `1 ${singular}`
    : `${count} ${many}`;
}

/** When a pull request last moved, in words. See the module note. */
export function describeAge(updatedAt: string, now: string): string {
  const age = ageMs(updatedAt, now);
  if (age === null) return 'at an unrecorded time';
  if (age < 0) return 'just now';
  const hours = Math.floor(age / HOUR_MS);
  if (hours < 1) return 'less than an hour ago';
  if (hours < DAYS_FROM_HOURS) return `${plural(hours, 'hour', 'hours')} ago`;
  return `${plural(Math.floor(age / DAY_MS), 'day', 'days')} ago`;
}

/** The command that assesses one pull request, as a listed line prints it. */
export function triageCommand(number: number, resolve = false): string {
  return resolve
    ? `rafa pr triage ${number} --resolve`
    : `rafa pr triage ${number}`;
}

/** `#21`, `#21 and #24`, `#21, #24 and #27`. */
function joinNumbers(pulls: readonly PullRequestSummary[]): string {
  const names = pulls.map((pull) => `#${pull.number}`);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** Ascending by number, over a copy, for the reason in the module note. */
function byNumber(pulls: readonly PullRequestSummary[]): readonly PullRequestSummary[] {
  return Object.freeze([...pulls].sort((left, right) => left.number - right.number));
}

/** One candidate as a listed line reads it. */
function skipped(
  pull: PullRequestSummary,
  now: string,
  resolve: boolean,
): SkippedCandidate {
  return Object.freeze({
    number: pull.number,
    title: pull.title,
    updatedAt: pull.updatedAt,
    age: describeAge(pull.updatedAt, now),
    fresh: isFreshCandidate(pull.updatedAt, now),
    command: triageCommand(pull.number, resolve),
  });
}

/** The line one skipped candidate prints under a headline. */
function skippedLine(one: SkippedCandidate): string {
  return `${INDENT}#${one.number} last moved ${one.age}, run ${one.command}`;
}

/** A reading with no listed lines. */
function plain(
  decision: TriageSelectionDecision,
  assess: readonly PullRequestSummary[],
  headline: string,
): TriageSelection {
  return Object.freeze({
    decision,
    assess,
    skipped: Object.freeze([]),
    exitCode: 0,
    headline,
    lines: Object.freeze([]),
    message: headline,
  });
}

/** A reading that lists what it is not assessing. */
function listing(
  decision: TriageSelectionDecision,
  assess: readonly PullRequestSummary[],
  rest: readonly SkippedCandidate[],
  headline: string,
  exitCode = 0,
): TriageSelection {
  const lines = Object.freeze(rest.map((one) => skippedLine(one)));
  return Object.freeze({
    decision,
    assess,
    skipped: Object.freeze([...rest]),
    exitCode,
    headline,
    lines,
    message: [headline, ...lines].join('\n'),
  });
}

/** The refusal `--resolve` answers above one candidate. */
function refusal(rest: readonly SkippedCandidate[], count: number): TriageSelection {
  const headline = `${REFUSAL_PREFIX}: ${plural(count, 'red pull request', 'red pull requests')}, `
    + 'and --resolve acts on one. Run one of:';
  return listing('refuse', Object.freeze([]), rest, headline, REFUSE_EXIT_CODE);
}

/** The reading for two or three candidates, of which at least one is fresh. */
function someReading(
  fresh: readonly PullRequestSummary[],
  stale: readonly SkippedCandidate[],
  count: number,
): TriageSelection {
  const older = stale.length === 0
    ? ''
    : `; ${plural(stale.length, 'older one is', 'older ones are')} skipped`;
  const headline = `${count} red: assessing ${joinNumbers(fresh)}${older}`;
  return listing('some', fresh, stale, headline);
}

/** The reading that assesses nothing and lists every candidate. */
function listReading(rest: readonly SkippedCandidate[], count: number): TriageSelection {
  const headline = count > MAX_TRIAGE_CANDIDATES
    ? `${count} red, more than the ${MAX_TRIAGE_CANDIDATES} a bare rafa pr triage assesses at once. `
      + 'Run one of:'
    : `${count} red, none moved in the last ${TRIAGE_FRESH_HOURS} hours. Run one of:`;
  return listing('list', Object.freeze([]), rest, headline);
}

/**
 * Which pull request a bare `rafa pr triage` assesses, over the branch's
 * pull request and the red ones.
 *
 * Total and pure: every input reaches exactly one of
 * {@link TRIAGE_SELECTION_DECISIONS}, nothing is spawned, nothing is
 * awaited and nothing is thrown. The precedence, the 72-hour rule and
 * the `--resolve` refusal are in the module note.
 */
export function selectTriagePullRequests(input: TriageSelectionInput): TriageSelection {
  const resolve = input.resolve === true;
  const { current, now } = input;

  if (current !== null) {
    return plain(
      'branch',
      Object.freeze([current]),
      `assessing #${current.number}, the pull request open on ${current.headRefName}`,
    );
  }

  const candidates = byNumber(input.candidates);
  const count = candidates.length;
  const lines = candidates.map((pull) => skipped(pull, now, resolve));

  if (resolve && count > 1) return refusal(lines, count);
  if (count === 0) {
    return plain(
      'none',
      Object.freeze([]),
      'no red pull request to triage, and no pull request on the current branch',
    );
  }
  if (count === 1) {
    const only = candidates[0] as PullRequestSummary;
    return plain(
      'single',
      Object.freeze([only]),
      `1 red: assessing #${only.number}, last moved ${describeAge(only.updatedAt, now)}`,
    );
  }
  if (count > MAX_TRIAGE_CANDIDATES) return listReading(lines, count);

  const fresh = candidates.filter((pull) => isFreshCandidate(pull.updatedAt, now));
  const stale = lines.filter((one) => !one.fresh);
  if (fresh.length === 0) return listReading(stale, count);
  return someReading(Object.freeze(fresh), stale, count);
}
