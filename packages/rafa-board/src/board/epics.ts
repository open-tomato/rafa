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
 * in `./epics.test.ts` and `./epics-native.test.ts` is a literal listing.
 *
 * ## The mode
 *
 * Who is in an epic, in what order, and which epics its members wait on
 * are relationships, and the board records them in the mode
 * `board.relationships` names (`./relations/port.ts`). {@link readEpics}
 * takes the board's port as {@link EpicsInput.relations}:
 *
 * - Left out, or in `labels` mode, the epics are read from the `epic:`
 *   labels and `Blocked by:` lines as the next two sections spell it.
 *   That reading IS the `labels` adapter's (`./relations/labels.ts`
 *   wraps this function rather than reimplementing it), so the port is
 *   not called back: its `blockersOf` reads a line only under
 *   `spec:blocked` and without the listing's numbers, and routing the
 *   blocked-by epics through it would change what `labels` mode prints.
 * - In `native` mode the port's one reading over the listing answers
 *   everything relational, and no `epic:` label, `spec:blocked` or
 *   `Blocked by:` line is read. An epic's members are `membersOf`'s, the
 *   rows whose `parent` is the epic, in its sub-issue order, and the
 *   epic carries {@link Epic.order} `sub-issues` to say so. Its slug is
 *   null: a native epic is named by its number and title. The epics it
 *   waits on are read from its open members' `blockersOf`: each blocker
 *   on this board whose `blockedBy` node reads `OPEN` and whose row the
 *   listing holds is owned by the epic `epicOf` puts it in, or is one
 *   itself when its row is typed `epic`. A foreign blocker owns no epic
 *   on this board.
 *
 * The computed and stored states, the disagreement and lateness below
 * read the members and not the mode, so both modes answer them alike.
 *
 * ## Membership is the label
 *
 * In `labels` mode, an issue is a member of the epic whose `epic:<slug>` label it carries.
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
 * read before this is called: the plan file by `hasPlanFor`, the branch
 * and the pull request by the roadmap walk's own taken reading
 * (`createRoadmapReadings` in `./roadmap.ts`, its `branchClaimFor` and
 * `pullRequestFor`), so an epic weighs a branch exactly as `rafa next`
 * weighs it. A branch claims its member when {@link branchClaimsMember}
 * says so: whenever the walk passes the line over for it, taken or
 * offered for a takeover, and never when the claim on it was released.
 *
 * | The branch's claim | The member |
 * |---|---|
 * | none, held, stale in development, or unreadable | claimed |
 * | stale `rafa:claimed` | claimed: its owner has not let go |
 * | released | not claimed by that branch |
 *
 * A stale `rafa:claimed` claim is a takeover candidate to the walk, yet
 * it counts here, since somebody planned the member and nobody released
 * it; staleness therefore never changes an epic's state, and only a
 * release does.
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
 * In `labels` mode, the epics an epic waits on are read from its OPEN members'
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
import type { BoardRelations, RelationsReading } from './relations/port.js';
import type { BoardIssue } from './roadmap-board.js';
import type { BranchClaimReading } from './roadmap.js';

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

/**
 * The part of the relationships port (`./relations/port.ts`) the epic
 * readers ask: the mode, and the reads over one listing. A whole
 * `BoardRelations`, as `selectBoardRelations` makes it, is one.
 */
export type EpicRelations = Pick<BoardRelations, 'mode' | 'read'>;

/** How an epic's members are ordered: kept only in `native` mode, where the epic's sub-issue order is the order. */
export type EpicOrder = 'sub-issues';

/** One `type:epic` issue, read against the listing. */
export interface Epic {
  /** The epic issue's number. */
  readonly number: number;
  /** The epic issue's title. */
  readonly title: string;
  /** Its first `epic:` label's slug, or null when it carries none, and always in `native` mode. */
  readonly slug: string | null;
  /** Its body, read; null when the listing failed. */
  readonly body: EpicBody | null;
  /**
   * Its members: in `labels` mode every issue carrying its `epic:<slug>`
   * label, in ascending number; in `native` mode every row whose `parent`
   * is the epic, in its sub-issue order.
   */
  readonly members: readonly BoardIssue[];
  /** `sub-issues` in `native` mode, where {@link Epic.members} is in the epic's order; left out in `labels` mode. */
  readonly order?: EpicOrder;
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
  /** The board's relationships; `labels` mode's reading when left out. See the module note. */
  readonly relations?: EpicRelations;
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

/**
 * Whether `reading`, the taken reading's answer for a member's branch
 * (`RoadmapReadings.branchClaimFor`), claims the member: a branch names
 * it and the claim on that branch was not released. See the module note.
 */
export function branchClaimsMember(reading: BranchClaimReading | null): boolean {
  return reading !== null && reading.claim.state !== 'released';
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

/**
 * Where one mode reads an epic's slug, its members and the epics owning
 * a member's blockers: taken once for a whole listing, so each epic's
 * reading is a lookup.
 */
interface MembershipSource {
  /** The epic's slug; null when it carries none, and always in `native` mode. */
  readonly slugOf: (epic: BoardIssue) => string | null;
  /** The epic's members, in the mode's order. */
  readonly membersOf: (epic: BoardIssue, slug: string | null) => readonly BoardIssue[];
  /** The epics owning an open blocker of `member`, in any order, repeats allowed. */
  readonly blockerOwnersOf: (member: BoardIssue) => readonly number[];
  /** Kept in `native` mode only; see {@link Epic.order}. */
  readonly order?: EpicOrder;
}

/** Everything the per-epic reading needs besides its mode's source. */
interface EpicsView {
  readonly source: MembershipSource;
  readonly claims: ReadonlySet<number>;
  readonly today: string;
}

/** The slug an epic owns: its first `epic:` label's, or null for none. */
function firstSlugOf(epic: BoardIssue): string | null {
  return epicSlugsOf(epic.labels)[0] ?? null;
}

/** `labels` mode's source: the module note's `epic:` labels and `Blocked by:` lines. */
function labelsSource(issues: readonly BoardIssue[], epicIssues: readonly BoardIssue[]): MembershipSource {
  const groups = groupByEpicLabel(issues);
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const known = new Set(issues.map((issue) => issue.number));
  const epicsBySlug = new Map<string, readonly number[]>();
  for (const epic of epicIssues) {
    const slug = firstSlugOf(epic);
    if (slug !== null) epicsBySlug.set(slug, [...epicsBySlug.get(slug) ?? [], epic.number]);
  }
  const ownersOf = (blocker: BoardIssue): readonly number[] => blocker.type === 'epic'
    ? [blocker.number]
    : epicSlugsOf(blocker.labels).flatMap((slug) => epicsBySlug.get(slug) ?? []);

  return {
    slugOf: firstSlugOf,
    membersOf: (_epic, slug) => slug === null
      ? []
      : groups.get(slug) ?? [],
    blockerOwnersOf: (member) => {
      const reading = readBlockedBy(member.number, member.body, known);
      if (reading.kind !== 'blocked') return [];
      return reading.blockers
        .map((blocker) => byNumber.get(blocker))
        .filter((blocker): blocker is BoardIssue => blocker?.state === 'OPEN')
        .flatMap(ownersOf);
    },
  };
}

/** The epic owning local blocker row `blocker` in `native` mode: itself when it is one, else its parent epic. */
function nativeOwnerOf(blocker: BoardIssue, reading: RelationsReading): readonly number[] {
  if (blocker.type === 'epic') return [blocker.number];
  const epic = reading.epicOf(blocker);
  return epic.kind === 'epic'
    ? [epic.epic]
    : [];
}

/** `native` mode's source: the port's reading over the listing; see the module note. */
function nativeSource(issues: readonly BoardIssue[], relations: EpicRelations): MembershipSource {
  const reading = relations.read(issues);
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  return {
    slugOf: () => null,
    membersOf: (epic) => reading.membersOf(epic).members,
    blockerOwnersOf: (member) => {
      const blockers = reading.blockersOf(member);
      if (blockers.kind !== 'blocked') return [];
      return blockers.blockers
        .filter((blocker) => blocker.repository === null && blocker.state === 'OPEN')
        .flatMap((blocker) => {
          const row = byNumber.get(blocker.number);
          return row === undefined
            ? []
            : nativeOwnerOf(row, reading);
        });
    },
    order: 'sub-issues',
  };
}

/** The epics owning an open blocker of one of `members` still open, `self` left out. */
function blockedByOf(self: number, members: readonly BoardIssue[], source: MembershipSource): readonly number[] {
  const owners = members
    .filter((member) => member.state === 'OPEN')
    .flatMap((member) => source.blockerOwnersOf(member))
    .filter((owner) => owner !== self);
  return Object.freeze([...new Set(owners)].sort((left, right) => left - right));
}

/** One `type:epic` issue read against the listing. */
function epicOf(epic: BoardIssue, view: EpicsView): Epic {
  const { source } = view;
  const slug = source.slugOf(epic);
  const members = source.membersOf(epic, slug);
  const body = readEpicBody(epic.body);
  const progress = progressOf(members);
  const state = computedState(members, progress, view.claims);
  const stored = storedState(epic, members, view.claims);

  const read: Epic = {
    number: epic.number,
    title: epic.title,
    slug,
    body,
    members: Object.freeze([...members]),
    state,
    reason: null,
    progress,
    blockedBy: blockedByOf(epic.number, members, source),
    late: body.date !== null && body.date < view.today && state !== 'done',
    stored,
    disagreement: disagreementOf(epic.number, state, stored),
  };
  return Object.freeze(source.order === undefined
    ? read
    : { ...read, order: source.order });
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
 * {@link unknownEpic} for one epic known by number. Membership and the
 * blocked-by epics are read in the mode `relations` answers, `labels`
 * when it is left out; the module note holds both.
 *
 * Throws only what a `native` adapter's read throws: a `TypeError` for a
 * listing read without the native fields. Never throws otherwise.
 */
export function readEpics(input: EpicsInput): Epics {
  if (input.issues === null) {
    return Object.freeze({ epics: Object.freeze([]), unknown: input.reason ?? NO_REASON });
  }

  const epicIssues = input.issues
    .filter((issue) => issue.type === 'epic')
    .sort((left, right) => left.number - right.number);
  const { relations } = input;
  const source = relations === undefined || relations.mode === 'labels'
    ? labelsSource(input.issues, epicIssues)
    : nativeSource(input.issues, relations);

  const view: EpicsView = { source, claims: input.claims, today: localDay(input.today) };
  return Object.freeze({
    epics: Object.freeze(epicIssues.map((epic) => epicOf(epic, view))),
    unknown: null,
  });
}
