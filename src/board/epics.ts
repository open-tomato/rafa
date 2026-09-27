/**
 * The epics on one board listing, read: each `type:epic` issue's
 * members, its computed state, its progress, the epics its members wait
 * on, whether it is late, the state stored on the issue itself and the
 * line printed when the two disagree.
 *
 * An epic is an issue labelled `type:epic` and `epic:<slug>`
 * (`.rafa/specs/rafa-244-epics-group-issues-features.md`). Its state is
 * COMPUTED on every read from ONE board listing (`./roadmap-board.ts`)
 * and never stored, so nothing here spawns `gh`, reads git or opens a
 * file: {@link readEpics} is a pure function over the listing, the set of
 * claimed issue numbers and today's date, all handed in, and every case
 * in `./epics.test.ts` is a literal listing.
 *
 * ## Membership is the label
 *
 * An issue is a member of the epic whose `epic:<slug>` label it carries.
 * {@link groupByEpicLabel} groups the listing by every `epic:` label an
 * issue carries, as the tracker reads a `type:` label: the prefix matched
 * as written and the slug taken exactly, since GitHub keeps no two labels
 * differing only in case. An issue with two `epic:` labels is therefore a
 * member of both, which is a fault `./epic-problems.ts` names and not one
 * this module hides by picking. A `type:epic` issue is never a member of
 * any epic, its own included. An epic's slug is its first `epic:` label;
 * an epic carrying none has no members and reads `empty`.
 *
 * The body's checklist ORDERS the specs and is read by
 * `./epic-body.ts`, which takes `parseRoadmapBody` whole; it has no say
 * in who is a member.
 *
 * ## The computed state
 *
 * A member closed with `stateReason` `NOT_PLANNED` was dropped, not
 * done: it is tallied in {@link EpicProgress.notPlanned} and counts on
 * neither side of `done/total`. Every other member is COUNTED: `total`
 * is how many there are, `done` how many of them are closed, whatever
 * other reason `gh` wrote. A member is CLAIMED when its number is in the
 * `claims` set — a plan file, a branch or an open pull request claims it,
 * read by the helpers the roadmap's `has` column uses (`hasPlanFor`,
 * `branchClaims`, `closedIssuesIn`) before this is called.
 *
 * ```text
 * unknown      the listing failed; the reason is kept
 * empty        the epic has no members
 * done         every counted member is closed, and there is one
 * in-progress  a counted member is closed or claimed, another is open
 * backlog      no counted member is closed or claimed
 * ```
 *
 * `empty` is read before anything else, so an epic with no members is
 * never `done`. An epic whose every member was closed as not planned has
 * members and nothing counted, and reads `backlog` with `0/0`: nothing on
 * it was done, and its not-planned tally says why. A failed listing is
 * `unknown` with its reason, never `backlog`: {@link unknownEpic}
 * answers it for an epic a caller knows by number when the listing it
 * would have been read from failed.
 *
 * ## The stored state
 *
 * The epic issue's own state and close reason are stored by whoever
 * closed it. `open` and `closed` read `state`; an epic closed as not
 * planned is `cancelled` when work had started on it and `discarded`
 * when it had not. Work STARTED when a counted member is closed or any
 * member is claimed — a not-planned member with a branch or plan left
 * over was worked on before it was dropped. An `unknown` epic has no
 * stored state to read.
 *
 * ## The disagreement
 *
 * When the computed state and the stored one say different things, the
 * epic carries the line a report prints, never a fix:
 *
 * - `done` and `open` — `done, but epic #<n> is still open`.
 * - anything short of `done` and `closed` — `<computed>, but epic #<n>
 *   is closed`, `empty` included, since a closed epic with no members is
 *   usually a mistyped slug.
 *
 * `cancelled` and `discarded` agree with every computed state (the epic
 * was dropped on purpose), and `unknown` disagrees with nothing, since
 * there is nothing to compare.
 *
 * ## Blocked by
 *
 * The epics an epic waits on are read from its OPEN members'
 * `Blocked by:` lines with `readBlockedBy` (`./blocked.ts`), taken only
 * when a line reads `blocked` — a faulty line's ids are for printing,
 * not for acting on. Each named blocker that is open is owned by the
 * epics whose `epic:` label it carries, or is one itself when it is a
 * `type:epic` issue; those epics, the reading epic left out, deduped and
 * in ascending number, are {@link Epic.blockedBy}. A closed blocker
 * waits on nothing.
 *
 * ## Late
 *
 * An epic is late when its body's date (`./epic-body.ts`, null when
 * absent or malformed) is before today and it is not `done`. Today is
 * the injected `Date` read as a LOCAL calendar day, the day the person
 * running the command is living, so an epic dated the 31st is not late
 * on the evening of the 31st anywhere. On the date itself it is not yet
 * late.
 */
import type { EpicBody } from './epic-body.js';
import type { BoardIssue } from './roadmap-board.js';

import { readBlockedBy } from './blocked.js';
import { readEpicBody } from './epic-body.js';

/** What an `epic:<slug>` label opens with. */
export const EPIC_LABEL_PREFIX = 'epic:';

/** The close reason `gh` writes for an issue closed as not planned. */
export const NOT_PLANNED_REASON = 'NOT_PLANNED';

/** The five states an epic is computed to be in. */
export type EpicState = 'backlog' | 'in-progress' | 'done' | 'empty' | 'unknown';

/** The four states an epic issue's own state and close reason store. */
export type StoredEpicState = 'open' | 'closed' | 'cancelled' | 'discarded';

/** An epic's `done/total`, and the members counted on neither side. */
export interface EpicProgress {
  /** Counted members that are closed. */
  readonly done: number;
  /** Members that are not closed as not planned. */
  readonly total: number;
  /** Members closed as not planned. */
  readonly notPlanned: number;
}

/** One `type:epic` issue, read against the listing. */
export interface Epic {
  /** The epic issue's number. */
  readonly number: number;
  /** The epic issue's title. */
  readonly title: string;
  /** Its first `epic:` label's slug, or null when it carries none. */
  readonly slug: string | null;
  /** Its body, read; null when the listing failed. */
  readonly body: EpicBody | null;
  /** Every issue carrying its `epic:<slug>` label, in ascending number. */
  readonly members: readonly BoardIssue[];
  /** The state computed from the members. */
  readonly state: EpicState;
  /** Why the state is `unknown`, or null when it is not. */
  readonly reason: string | null;
  /** `done/total` and the not-planned tally. */
  readonly progress: EpicProgress;
  /** The epics owning an open blocker of an open member, in ascending number. */
  readonly blockedBy: readonly number[];
  /** True when its date is before today and it is not `done`. */
  readonly late: boolean;
  /** The state stored on the epic issue, or null when the listing failed. */
  readonly stored: StoredEpicState | null;
  /** The line a report prints when stored and computed disagree, or null. */
  readonly disagreement: string | null;
}

/** What {@link readEpics} reads. */
export interface EpicsInput {
  /** The board listing, or null when it failed. */
  readonly issues: readonly BoardIssue[] | null;
  /** Why the listing failed; read only when `issues` is null. */
  readonly reason?: string;
  /** The issue numbers a plan file, a branch or an open pull request claims. */
  readonly claims: ReadonlySet<number>;
  /** Today, read as a local calendar day. */
  readonly today: Date;
}

/** Every epic on one listing, or the reason there is none to read. */
export interface Epics {
  /** Every `type:epic` issue, in ascending number; empty when the listing failed. */
  readonly epics: readonly Epic[];
  /** Why the listing failed, or null when it was read. */
  readonly unknown: string | null;
}

/** The reason kept when a caller names no reason for a failed listing. */
const NO_REASON = 'the board listing failed and gave no reason';

/** Nothing counted. */
const NO_PROGRESS: EpicProgress = Object.freeze({ done: 0, total: 0, notPlanned: 0 });

/** Every slug `labels` carries, in label order, deduped. */
export function epicSlugsOf(labels: readonly string[]): readonly string[] {
  const slugs = labels
    .filter((label) => label.startsWith(EPIC_LABEL_PREFIX))
    .map((label) => label.slice(EPIC_LABEL_PREFIX.length));
  return Object.freeze([...new Set(slugs)]);
}

/** True when `issue` was closed as not planned. */
export function isNotPlanned(issue: BoardIssue): boolean {
  return issue.state === 'CLOSED' && issue.stateReason === NOT_PLANNED_REASON;
}

/**
 * The listing grouped by `epic:<slug>`: every slug any issue carries,
 * with the issues carrying it that are not themselves `type:epic`, in
 * ascending number. An issue with two slugs sits in both groups.
 */
export function groupByEpicLabel(issues: readonly BoardIssue[]): ReadonlyMap<string, readonly BoardIssue[]> {
  const groups = new Map<string, readonly BoardIssue[]>();
  const sorted = [...issues].sort((left, right) => left.number - right.number);
  for (const issue of sorted) {
    if (issue.type === 'epic') continue;
    for (const slug of epicSlugsOf(issue.labels)) {
      groups.set(slug, [...groups.get(slug) ?? [], issue]);
    }
  }
  return groups;
}

/** `members`' progress: the not-planned ones apart, the rest counted. */
function progressOf(members: readonly BoardIssue[]): EpicProgress {
  const counted = members.filter((member) => !isNotPlanned(member));
  return Object.freeze({
    done: counted.filter((member) => member.state === 'CLOSED').length,
    total: counted.length,
    notPlanned: members.length - counted.length,
  });
}

/** True when a counted member is closed or claimed. */
function countedStarted(members: readonly BoardIssue[], claims: ReadonlySet<number>): boolean {
  return members.some((member) => !isNotPlanned(member)
    && (member.state === 'CLOSED' || claims.has(member.number)));
}

/** The computed state of a read epic; the module note holds the order. */
function computedState(members: readonly BoardIssue[], progress: EpicProgress, claims: ReadonlySet<number>): EpicState {
  if (members.length === 0) return 'empty';
  if (progress.total > 0 && progress.done === progress.total) return 'done';
  return countedStarted(members, claims)
    ? 'in-progress'
    : 'backlog';
}

/** The state stored on `epic`, given the work its members show. */
function storedState(epic: BoardIssue, members: readonly BoardIssue[], claims: ReadonlySet<number>): StoredEpicState {
  if (epic.state === 'OPEN') return 'open';
  if (!isNotPlanned(epic)) return 'closed';
  const started = countedStarted(members, claims) || members.some((member) => claims.has(member.number));
  return started
    ? 'cancelled'
    : 'discarded';
}

/** The line a report prints when `state` and `stored` disagree, or null. */
export function disagreementOf(number: number, state: EpicState, stored: StoredEpicState | null): string | null {
  const id = `epic #${String(number)}`;
  if (state === 'done' && stored === 'open') return `done, but ${id} is still open`;
  if (state !== 'done' && state !== 'unknown' && stored === 'closed') return `${state}, but ${id} is closed`;
  return null;
}

/** `date` as the local `YYYY-MM-DD` day. */
export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
}

/** Everything the per-epic reading needs, taken once for a whole listing. */
interface EpicsView {
  readonly groups: ReadonlyMap<string, readonly BoardIssue[]>;
  readonly byNumber: ReadonlyMap<number, BoardIssue>;
  readonly epicsBySlug: ReadonlyMap<string, readonly number[]>;
  readonly known: ReadonlySet<number>;
  readonly claims: ReadonlySet<number>;
  readonly today: string;
}

/** The epics owning `blocker`: its slugs' epics, or itself when it is one. */
function ownersOf(blocker: BoardIssue, view: EpicsView): readonly number[] {
  if (blocker.type === 'epic') return [blocker.number];
  return epicSlugsOf(blocker.labels).flatMap((slug) => view.epicsBySlug.get(slug) ?? []);
}

/** The epics owning an open blocker of one of `members` still open, `self` left out. */
function blockedByOf(self: number, members: readonly BoardIssue[], view: EpicsView): readonly number[] {
  const owners = members
    .filter((member) => member.state === 'OPEN')
    .map((member) => readBlockedBy(member.number, member.body, view.known))
    .filter((reading) => reading.kind === 'blocked')
    .flatMap((reading) => reading.blockers)
    .map((blocker) => view.byNumber.get(blocker))
    .filter((blocker): blocker is BoardIssue => blocker?.state === 'OPEN')
    .flatMap((blocker) => ownersOf(blocker, view))
    .filter((owner) => owner !== self);
  return Object.freeze([...new Set(owners)].sort((left, right) => left - right));
}

/** One `type:epic` issue read against the listing. */
function epicOf(epic: BoardIssue, view: EpicsView): Epic {
  const slug = epicSlugsOf(epic.labels)[0] ?? null;
  const members = slug === null
    ? []
    : view.groups.get(slug) ?? [];
  const body = readEpicBody(epic.body);
  const progress = progressOf(members);
  const state = computedState(members, progress, view.claims);
  const stored = storedState(epic, members, view.claims);

  return Object.freeze({
    number: epic.number,
    title: epic.title,
    slug,
    body,
    members: Object.freeze([...members]),
    state,
    reason: null,
    progress,
    blockedBy: blockedByOf(epic.number, members, view),
    late: body.date !== null && body.date < view.today && state !== 'done',
    stored,
    disagreement: disagreementOf(epic.number, state, stored),
  });
}

/**
 * Epic `number` as a failed listing leaves it: `unknown` with `reason`,
 * no members, no progress and no stored state. What a caller that knows
 * an epic by number answers when the listing it needed failed.
 */
export function unknownEpic(number: number, reason: string): Epic {
  return Object.freeze({
    number,
    title: '',
    slug: null,
    body: null,
    members: Object.freeze([]),
    state: 'unknown',
    reason,
    progress: NO_PROGRESS,
    blockedBy: Object.freeze([]),
    late: false,
    stored: null,
    disagreement: null,
  });
}

/**
 * Every `type:epic` issue on the listing, read. A failed listing (`issues`
 * null) answers no epics and its reason in {@link Epics.unknown}; ask
 * {@link unknownEpic} for one epic known by number. Never throws.
 */
export function readEpics(input: EpicsInput): Epics {
  if (input.issues === null) {
    return Object.freeze({ epics: Object.freeze([]), unknown: input.reason ?? NO_REASON });
  }

  const epicIssues = input.issues
    .filter((issue) => issue.type === 'epic')
    .sort((left, right) => left.number - right.number);
  const epicsBySlug = new Map<string, readonly number[]>();
  for (const epic of epicIssues) {
    const slug = epicSlugsOf(epic.labels)[0];
    if (slug !== undefined) epicsBySlug.set(slug, [...epicsBySlug.get(slug) ?? [], epic.number]);
  }

  const view: EpicsView = {
    groups: groupByEpicLabel(input.issues),
    byNumber: new Map(input.issues.map((issue) => [issue.number, issue])),
    epicsBySlug,
    known: new Set(input.issues.map((issue) => issue.number)),
    claims: input.claims,
    today: localDay(input.today),
  };
  return Object.freeze({
    epics: Object.freeze(epicIssues.map((epic) => epicOf(epic, view))),
    unknown: null,
  });
}
