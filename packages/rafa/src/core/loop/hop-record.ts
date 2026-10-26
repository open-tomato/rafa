/**
 * The shapes of the hop record and of a place, with the checks that read
 * them from parsed JSON: the part of `packages/rafa/src/next/hop-record.ts` and
 * `packages/rafa/src/project/position.ts` a session record needs (`sessions.ts` keeps a
 * hop record in its `hop` field).
 *
 * It sits in core so `sessions.ts` reads them without importing above
 * core. `packages/rafa/src/project/position.ts` re-exports `Place` and `asPlace`, and
 * `packages/rafa/src/next/hop-record.ts` re-exports `HopKind`, `HopState`, `HopRecord`
 * and `asHopRecord`, each under the same name; the reading and writing of
 * `.rafa/position.json` and `.rafa/hop.json`, and the module notes that
 * describe both files, stay there. `isRecord` is exported for the
 * position's own check in `position.ts`.
 *
 * The file imports nothing.
 */

/** A (board, epic) pair of issue numbers; `epic` is null on a board with no epic chosen. */
export interface Place {
  readonly board: number;
  readonly epic: number | null;
}

/** Why the hop went: H's blocker, or a home epic that ran dry. */
export type HopKind = 'blocker' | 'dry';

/** Where the hop stands: working its target, back home waiting on it or with it merged, or back home from a halt. */
export type HopState = 'away' | 'waiting' | 'merged' | 'halted';

/** The record `.rafa/hop.json` holds; see the module note of `packages/rafa/src/next/hop-record.ts`. */
export interface HopRecord {
  readonly kind: HopKind;
  readonly home: Place;
  readonly from: Place;
  /** H, the home issue its blocker stopped; null on a dry hop. */
  readonly blocked: number | null;
  /** C, H's blocker the hop works; null on a dry hop. */
  readonly target: number | null;
  readonly targetEpic: number;
  readonly targetBoard: number;
  readonly state: HopState;
  /** The target's pull request, null before it is opened. */
  readonly pullRequest: number | null;
  /** ISO 8601. */
  readonly startedAt: string;
}

const HOP_KINDS: readonly string[] = ['blocker', 'dry'] satisfies readonly HopKind[];
const HOP_STATES: readonly string[] = ['away', 'waiting', 'merged', 'halted'] satisfies readonly HopState[];

/** True for a plain object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for an issue number: a positive integer. */
function isIssueNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** `value` as a place, or null when it is not one; the hop record reads its places through it. */
export function asPlace(value: unknown): Place | null {
  if (!isRecord(value) || !isIssueNumber(value.board)) return null;
  if (value.epic !== null && !isIssueNumber(value.epic)) return null;
  return { board: value.board, epic: value.epic };
}

/** True for an issue number or null. */
function isIssueOrNull(value: unknown): value is number | null {
  return value === null || isIssueNumber(value);
}

/** True for a string `Date` can read. */
function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** True when `blocked` and `target` match the kind: both set on a blocker hop, both null on a dry one. */
function issuesMatchKind(kind: HopKind, blocked: number | null, target: number | null): boolean {
  return kind === 'blocker'
    ? blocked !== null && target !== null
    : blocked === null && target === null;
}

/**
 * `value` as a hop record, or null when it is not one: the check
 * `readHopRecord` (`packages/rafa/src/next/hop-record.ts`) makes on the parsed file,
 * which the session record makes on its `hop` field (`sessions.ts`).
 */
export function asHopRecord(value: unknown): HopRecord | null {
  if (!isRecord(value)) return null;
  const { kind, blocked, target, targetEpic, targetBoard, state, pullRequest, startedAt } = value;
  const home = asPlace(value.home);
  const from = asPlace(value.from);
  if (typeof kind !== 'string' || !HOP_KINDS.includes(kind)) return null;
  if (typeof state !== 'string' || !HOP_STATES.includes(state)) return null;
  if (home === null || from === null) return null;
  if (!isIssueOrNull(blocked) || !isIssueOrNull(target) || !isIssueOrNull(pullRequest)) return null;
  if (!isIssueNumber(targetEpic) || !isIssueNumber(targetBoard) || !isTimestamp(startedAt)) return null;
  const hopKind = kind as HopKind;
  if (!issuesMatchKind(hopKind, blocked, target)) return null;
  return {
    kind: hopKind,
    home,
    from,
    blocked,
    target,
    targetEpic,
    targetBoard,
    state: state as HopState,
    pullRequest,
    startedAt,
  };
}
