/**
 * The one-hop decision: for H, an issue the `rafa next --roadmap` walk
 * reached blocked, and C, one of its blockers, whether the loop hops to
 * C's epic, waits on C, halts with the chain, or stays where it is
 * (`.rafa/specs/rafa-247-rafa-next-roadmap.md`).
 *
 * It reads; it writes neither the board, the position nor the hop record.
 * {@link decideHop} reads the ONE board listing a turn already read,
 * handed in as a {@link BoardView}, and the two taken readings the walk
 * already holds ({@link TakenReadings}, `RoadmapReadings`' own), and
 * lists nothing again. A reading that rejects (the default board thunk,
 * the open pull request list) rejects the decision with it: a board or a
 * pull request list nobody could read is no answer.
 *
 * ## The four answers, in the order they are read
 *
 * ```text
 * stay  the locator (src/board/blocker-epic.ts) gives a reason not to hop
 * halt  the move from where H was read to C's place has neither end home
 * wait  C is taken: a branch claims it, or an open pull request closes it
 * halt  C is itself blocked: an open blocker B, H included, or a fault
 * hop   none of the above: C's epic and board, the move to make
 * ```
 *
 * The first that holds answers. C is located with the place H was READ
 * at, the position's `current`, as H's place: `same-epic` means C sits in
 * the epic the walk is in, whichever that is.
 *
 * ## The one-hop rule
 *
 * A move is allowed only when one of its two ends is home
 * ({@link oneHopAllows}). Read at home, every located C passes it, since
 * the move starts at home. Read away, H's epic is the one a hop reached,
 * and a move to any place but home would be a second hop: the answer is
 * `halt`, reason `both-away`, with the chain `#H ← #C`. The rule is read
 * before C is asked about, so no taken reading is spent on a move that
 * is refused anyway.
 *
 * ## Taken before blocked
 *
 * A C a branch or an open pull request has taken is someone's work under
 * way; its own blockers are theirs to meet, and the loop leaves C alone
 * either way. So `wait` is answered before C's blockers are read. The
 * branch is asked first and the pull request after, the order
 * `readRoadmapSkip` (`src/board/roadmap.ts`) asks them in, so the pull
 * request list is read only when no branch answered.
 *
 * ## C blocked is a halt, never a second hop
 *
 * C is blocked exactly as the walk reads any line blocked,
 * `readBlockedLine` (`src/board/blocked-line.ts`): it carries
 * `spec:blocked`, and its `Blocked by:` line names a blocker the listing
 * holds open, one the listing does not hold (state not read, which is
 * not cleared), or is a fault. Each blocker's state is read off the
 * listing, never asked of `gh`. The answer is `halt`, reason
 * `blocked-blocker`, with the chain `#H ← #C ← #B`, every open and
 * unread B in line order. When H is among them the two issues block
 * each other, the mutual block, and {@link HopChain.mutual} says so. A
 * fault halts with the chain `#H ← #C` and the fault's own sentence.
 */
import type { BlockedLine, BlockerState } from '../board/blocked-line.js';
import type { BlockerEpic, UnhoppableBlocker } from '../board/blocker-epic.js';
import type { BoardView } from '../board/epic-board.js';
import type { RoadmapReadings } from '../board/roadmap.js';
import type { Place, Position } from '../project/position.js';

import { readBlockedLine } from '../board/blocked-line.js';
import { locateBlockerEpic, noHopSentence } from '../board/blocker-epic.js';
import { samePlace } from '../board/place.js';

/** The two taken readings the walk holds, asked about C. */
export type TakenReadings = Pick<RoadmapReadings, 'branchFor' | 'pullRequestFor'>;

/** What {@link decideHop} reads. */
export interface HopRequest {
  /** H: the issue the walk reached blocked. */
  readonly blocked: number;
  /** C: one of H's blockers, a local number or a foreign `owner/repo#<n>` token. */
  readonly blocker: number | string;
  /** Where H was read (`current`) and where home is. */
  readonly position: Pick<Position, 'current' | 'home'>;
  /** The turn's one listing and its default board. */
  readonly view: BoardView;
  /** Whether a branch or an open pull request has taken C. */
  readonly taken: TakenReadings;
}

/** The chain a halt reports: `#H ← #C ← #B`. */
export interface HopChain {
  /** H. */
  readonly blocked: number;
  /** C. */
  readonly blocker: number;
  /** C's open and unread blockers, in line order; empty for `both-away` and a fault. */
  readonly next: readonly number[];
  /** True when H is among {@link HopChain.next}: H and C block each other. */
  readonly mutual: boolean;
}

/** Go to C's epic. */
export interface HopMove {
  readonly kind: 'hop';
  readonly blocked: number;
  readonly blocker: number;
  /** The epic holding C, and its slug. */
  readonly epic: number;
  readonly slug: string;
  /** The open board listing that epic. */
  readonly board: number;
  /** Where H was read. */
  readonly from: Place;
  /** C's epic on its board. */
  readonly to: Place;
}

/** What took C. */
export type TakenBy =
  | { readonly by: 'branch'; readonly branch: string }
  | { readonly by: 'pull-request'; readonly pullRequest: number };

/** Leave C to whoever took it. */
export interface HopWait {
  readonly kind: 'wait';
  readonly blocked: number;
  readonly blocker: number;
  readonly epic: number;
  readonly board: number;
  readonly taken: TakenBy;
}

/** Why a halt was answered: a second hop, or C blocked in turn. */
export type HaltReason = 'both-away' | 'blocked-blocker';

/** Stop, report the chain, and go home. */
export interface HopHalt {
  readonly kind: 'halt';
  readonly reason: HaltReason;
  readonly chain: HopChain;
  /** Where H was read. */
  readonly from: Place;
  /** C's epic on its board. */
  readonly to: Place;
  /** The fault C's `Blocked by:` line was reported with, else null. */
  readonly fault: string | null;
}

/** Do not move: the locator's reason. */
export interface HopStay {
  readonly kind: 'stay';
  readonly blocked: number;
  readonly located: UnhoppableBlocker;
}

/** What {@link decideHop} answers. */
export type HopDecision = HopMove | HopWait | HopHalt | HopStay;

/** True when a move from `from` to `to` has an end at `home`: the one-hop rule. */
export function oneHopAllows(from: Place, to: Place, home: Place): boolean {
  return samePlace(from, home) || samePlace(to, home);
}

/** `#210 ← #118 ← #90, #91`, or `#210 ← #118` when C has no blocker named. */
export function chainText(chain: HopChain): string {
  const head = `#${String(chain.blocked)} ← #${String(chain.blocker)}`;
  return chain.next.length === 0
    ? head
    : `${head} ← ${chain.next.map((id) => `#${String(id)}`).join(', ')}`;
}

/** `epic #40 on board #11`, or `board #11` with no epic chosen. */
function placeText(place: Place): string {
  return place.epic === null
    ? `board #${String(place.board)}`
    : `epic #${String(place.epic)} on board #${String(place.board)}`;
}

/** `epic #20`, or `board #10` with no epic chosen: what a hop left. */
function leftText(place: Place): string {
  return place.epic === null
    ? `board #${String(place.board)}`
    : `epic #${String(place.epic)}`;
}

/** The sentence a halt is printed with. */
function haltSentence(halt: HopHalt): string {
  const chain = `halt: ${chainText(halt.chain)}`;
  if (halt.reason === 'both-away') {
    return `${chain}: the move from ${placeText(halt.from)} to ${placeText(halt.to)} has neither end at home`;
  }
  if (halt.fault !== null) return `${chain}: ${halt.fault}`;
  return halt.chain.mutual
    ? `${chain}: #${String(halt.chain.blocked)} and #${String(halt.chain.blocker)} block each other`
    : `${chain}: #${String(halt.chain.blocker)} is blocked in turn`;
}

/** The sentence a decision is printed with; a hop's is the spec's log line. */
export function hopDecisionSentence(decision: HopDecision): string {
  if (decision.kind === 'hop') {
    return `hop from ${leftText(decision.from)}: #${String(decision.blocked)} blocked by #${String(decision.blocker)}, in epic #${String(decision.epic)}`;
  }
  if (decision.kind === 'wait') {
    const taken = decision.taken.by === 'branch'
      ? `branch ${decision.taken.branch} exists`
      : `PR #${String(decision.taken.pullRequest)} open`;
    return `#${String(decision.blocked)} waits on #${String(decision.blocker)}, taken: ${taken}`;
  }
  if (decision.kind === 'halt') return haltSentence(decision);
  return `#${String(decision.blocked)} stays: ${noHopSentence(decision.located)}`;
}

/** What took `blocker`, or null: the branch first, then the pull request. */
async function takenBy(blocker: number, taken: TakenReadings): Promise<TakenBy | null> {
  const branch = taken.branchFor(blocker);
  if (branch !== null) return { by: 'branch', branch };
  const pullRequest = await taken.pullRequestFor(blocker);
  return pullRequest === null
    ? null
    : { by: 'pull-request', pullRequest };
}

/** C's own blocked reading, its blockers' states read off the listing. */
function blockerLine(blocker: number, view: BoardView): Promise<BlockedLine | null> {
  const row = view.rows.get(blocker);
  if (row === undefined) return Promise.resolve(null);
  const states = (issue: number): Promise<BlockerState> => Promise.resolve(view.rows.get(issue)?.state ?? null);
  return readBlockedLine({ ...row, author: '' }, states);
}

/** A frozen chain. */
function chainOf(blocked: number, blocker: number, next: readonly number[]): HopChain {
  return Object.freeze({ blocked, blocker, next: Object.freeze([...next]), mutual: next.includes(blocked) });
}

/** A frozen halt. */
function halt(reason: HaltReason, chain: HopChain, from: Place, to: Place, fault: string | null = null): HopHalt {
  return Object.freeze({ kind: 'halt', reason, chain, from, to, fault });
}

/** Hop, wait, halt or stay for H blocked by C; see the module note for the order. */
export async function decideHop(request: HopRequest): Promise<HopDecision> {
  const { blocked, blocker, position, view } = request;
  const from = position.current;
  const located: BlockerEpic = await locateBlockerEpic({ blocker, home: from, view });
  if (located.kind === 'no-hop') return Object.freeze({ kind: 'stay', blocked, located });

  const to: Place = Object.freeze({ board: located.board, epic: located.epic });
  if (!oneHopAllows(from, to, position.home)) {
    return halt('both-away', chainOf(blocked, located.blocker, []), from, to);
  }

  const taken = await takenBy(located.blocker, request.taken);
  if (taken !== null) {
    return Object.freeze({
      kind: 'wait', blocked, blocker: located.blocker, epic: located.epic, board: located.board, taken: Object.freeze(taken),
    });
  }

  const line = await blockerLine(located.blocker, view);
  if (line !== null) {
    const held = line.blockers.filter((id) => line.open.includes(id) || line.unread.includes(id));
    const chain = chainOf(blocked, located.blocker, held);
    return halt('blocked-blocker', chain, from, to, line.fault);
  }

  return Object.freeze({
    kind: 'hop', blocked, blocker: located.blocker, epic: located.epic, slug: located.slug, board: located.board, from, to,
  });
}
