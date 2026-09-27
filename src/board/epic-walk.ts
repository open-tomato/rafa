/**
 * The descent into an epic: the roadmap's lines turned into the lines a
 * `--next` walk reads, where a line naming an epic is replaced by that
 * epic's specs.
 *
 * A roadmap line may point at an epic, an issue labelled `type:epic`
 * (`.rafa/specs/rafa-244-epics-group-issues-features.md`). `rafa next`
 * and `plan create --next` both walk the roadmap with
 * `pickNextRoadmapLine` (`./roadmap.ts`), and both take the descent from
 * this module, so the two can never read an epic two ways.
 *
 * Nothing here spawns or prints. The issues arrive through the memoised
 * {@link SpecIssueReader} the walk already reads through, the done and
 * taken readings through its {@link RoadmapReadings}, and the board
 * through a {@link BoardListing}; every case in `./epic-walk.test.ts`
 * plants fakes behind those three seams. The sentences are pure
 * functions of what was read, and printing them is the caller's.
 *
 * ## Which roadmap lines are passed over
 *
 * {@link descendRoadmap} reads the lines from the top, the way the walk
 * does:
 *
 * - A TICKED line is passed as the walk passes it, whatever it names:
 *   the tick costs no read, so a ticked epic line is never read as an
 *   epic and says `#<n> done: ticked on the roadmap`, as today.
 * - A line whose issue does not carry `type:epic` (read with the
 *   tracker's own `typeOfLabels`, as the board listing reads it) is
 *   asked `./roadmap.ts`'s own done and taken questions,
 *   `readRoadmapSkip`, and passed when one answers yes.
 * - An epic line is passed when the epic issue is CLOSED, when it does
 *   not carry exactly one `horizon:` label and that label is
 *   {@link NOW_HORIZON_LABEL}, or when every counted member is closed
 *   (the `done` state `./epics.ts` computes). The three are asked in that
 *   order, cheapest first: the first two read the labels already in hand,
 *   and only the third needs the board.
 * - The FIRST epic line not passed is walked into, and nothing after it
 *   on the roadmap is read.
 *
 * ## Why the descent is lazy
 *
 * The descent stops reading the roadmap at the first line the walk would
 * stop on: a non-epic line neither done nor taken. Reading on to find
 * out whether some later line is an epic would spend a `gh issue view` on
 * lines the walk never reaches, so a roadmap with no epic line would cost
 * more than it did before epics existed. Stopping there, every read the
 * descent makes is one the walk makes anyway: the label is read off the
 * issue the walk reads to ask whether it is closed, and both go through
 * the one memoised reader. That is why {@link EpicDescentSeams.issues}
 * must be the reader {@link EpicDescentSeams.readings} was made over; a
 * second, unmemoised one reads every line twice.
 *
 * The board listing is read at most once, and only for an epic line that
 * is open and `now`. A roadmap with no such line never lists the board.
 *
 * ## What the descent answers
 *
 * - When it met NO epic line before it stopped, the lines come back
 *   unchanged, `passed` empty and no epic: the walk reads them exactly as
 *   it did before this module existed and prints the same lines.
 * - When it walked into an epic, `lines` holds that epic's lines ONLY and
 *   `passed` everything the descent passed to reach it, in roadmap order.
 *   The walk therefore stops at the epic's last line and can never cross
 *   into a second epic; a blocked pick's alternative
 *   (`./blocked-line.ts`) is looked for among the same lines.
 * - When it met an epic line but passed it, and stopped on a spec line
 *   or at the roadmap's end, `lines` is the roadmap from that spec line on,
 *   as written, and `passed` what came before it. The lines after the one
 *   the walk stops on are not read, so an epic line among them is not
 *   expanded; only a blocked pick's alternative walks on to them.
 *
 * ## Order inside an epic
 *
 * First its body's checklist, as `./epic-body.ts` reads it with
 * `parseRoadmapBody`: a ticked line there is passed as a ticked roadmap
 * line is, and a checklist spec missing the epic's label is still walked,
 * since the checklist is the order. Then every OPEN member carrying the
 * epic's `epic:<slug>` label and missing from the checklist, by ascending
 * number, each named in {@link DescendedEpic.labelOnly} so the caller can
 * report it by name. A closed member missing from the checklist is not
 * walked: the listing already says it is done, and walking it would
 * spend a read to learn that again.
 *
 * A label-only member sits on no body line, so its line is numbered past
 * the epic body's last line, one apiece. `pickPlannableLine` resumes
 * after a blocked line by its number, and every number in one epic's
 * lines is distinct that way.
 *
 * ## The dry epic
 *
 * An epic walked into whose every line is done or taken has RUN DRY:
 * {@link pickDescendedLine} answers `dry` and {@link dryEpicSentence}
 * says so, naming the epic. The walk stops there and does not move on to
 * the roadmap's next line, because that line may be a second epic and
 * the spec keeps every command but `rafa roadmap --full` to one epic's
 * issues. An epic with no members is `empty`, never `done`, so it is
 * walked into and runs dry at once unless its checklist holds a line.
 *
 * ## What is not read here
 *
 * The epic's computed state is read only for `done`, which depends on its
 * members' states alone; the claims and the date `readEpics` also takes
 * are handed in empty and fixed, so the `backlog`, `in-progress` and
 * `late` it answers beside them are not read and not carried out. An
 * epic missing from the listing (a board larger than
 * `BOARD_LISTING_LIMIT` leaves its oldest issues out) is refused with an
 * error naming it rather than walked as if it had no members, and a
 * listing that fails throws its own error, as a failed `gh issue view`
 * does in the walk: neither is guessed at as `backlog`.
 */
import type { Epic, EpicProgress } from './epics.js';
import type { SpecIssue, SpecIssueReader } from './issue.js';
import type { BoardIssue, BoardListing } from './roadmap-board.js';
import type { RoadmapLine, RoadmapPick, RoadmapReadings, RoadmapSkip } from './roadmap.js';

import { typeOfLabels } from '../adapters/tracker/github.js';

import { HORIZON_LABEL_PREFIX } from './epic-problems.js';
import { EPIC_LABEL_PREFIX, readEpics } from './epics.js';
import { pickNextRoadmapLine, readRoadmapSkip, skipSentence } from './roadmap.js';

/** What every failure this module raises opens with. */
const PREFIX = 'board epic walk';

/** The one horizon an epic is walked into under. */
export const NOW_HORIZON_LABEL = `${HORIZON_LABEL_PREFIX}now`;

/** No claims: the computed state is read only for `done`; see the module note. */
const NO_CLAIMS: ReadonlySet<number> = new Set();

/** The day handed to `readEpics`, whose lateness is not read here. */
const UNREAD_DAY = new Date(0);

/** How a body splits into lines; `parseRoadmapBody`'s own rule. */
const LINE_BREAK = /\r\n?|\n/u;

/** Why an epic line was passed over, in the order they are asked. */
export type EpicSkipReason = 'closed' | 'horizon' | 'done';

/** One epic line passed over, and what was read about it. */
export interface EpicSkip {
  /** The roadmap line naming the epic. */
  readonly line: RoadmapLine;
  /** Which reading passed it. */
  readonly reason: EpicSkipReason;
  /**
   * What it read: the epic's `horizon:` labels, comma separated, for
   * `horizon` (empty when it carries none); its `done/total` for `done`;
   * empty for `closed`.
   */
  readonly detail: string;
}

/** One line the descent passed before it stopped: a roadmap line, or an epic line. */
export type DescentPass =
  | { readonly kind: 'line'; readonly skip: RoadmapSkip }
  | { readonly kind: 'epic'; readonly skip: EpicSkip };

/** The epic walked into. */
export interface DescendedEpic {
  /** The roadmap line naming it. */
  readonly line: RoadmapLine;
  /** The epic issue's number. */
  readonly number: number;
  /** The epic issue's title. */
  readonly title: string;
  /** Its `epic:` slug, or null when it carries none. */
  readonly slug: string | null;
  /** Its `done/total` and not-planned tally. */
  readonly progress: EpicProgress;
  /** Its checklist's lines, as its body writes them. */
  readonly checklist: readonly RoadmapLine[];
  /** Its open members missing from the checklist, walked after it by ascending number. */
  readonly labelOnly: readonly BoardIssue[];
}

/** The lines a walk reads, and what the descent passed to reach them. */
export interface EpicDescent {
  /** The lines to walk; the module note holds the three shapes they take. */
  readonly lines: readonly RoadmapLine[];
  /** Every line passed before {@link EpicDescent.lines}; empty when no epic line was met. */
  readonly passed: readonly DescentPass[];
  /** The epic walked into, or null when none was. */
  readonly epic: DescendedEpic | null;
}

/** The three seams the descent reads through. */
export interface EpicDescentSeams {
  /** The walk's own memoised issue reader; the module note holds why it must be. */
  readonly issues: SpecIssueReader;
  /** The walk's done and taken readings, made over {@link EpicDescentSeams.issues}. */
  readonly readings: RoadmapReadings;
  /** The board listing, read at most once, and only for an open `now` epic line. */
  readonly listing: BoardListing;
}

/** What one epic line comes to: passed, or walked into. */
type EpicLineOutcome =
  | { readonly skip: EpicSkip }
  | { readonly epic: DescendedEpic; readonly lines: readonly RoadmapLine[] };

/** `listing`, called on the first ask and never again. */
function listOnce(listing: BoardListing): BoardListing {
  let read: Promise<readonly BoardIssue[]> | null = null;
  return (): Promise<readonly BoardIssue[]> => {
    read = read ?? listing();
    return read;
  };
}

/** True when `issue` is an epic, read as the board listing reads a type. */
export function isEpicIssue(issue: Pick<SpecIssue, 'labels'>): boolean {
  return typeOfLabels(issue.labels) === 'epic';
}

/** True when `labels` carry exactly one `horizon:` label and it is {@link NOW_HORIZON_LABEL}. */
export function isNowEpic(labels: readonly string[]): boolean {
  const horizons = labels.filter((label) => label.startsWith(HORIZON_LABEL_PREFIX));
  return horizons.length === 1 && horizons[0] === NOW_HORIZON_LABEL;
}

/** The epic numbered `number` on `listing`, read, with its row; throws when it is missing. */
function epicOnListing(number: number, listing: readonly BoardIssue[]): { readonly epic: Epic; readonly row: BoardIssue } {
  const epic = readEpics({ issues: listing, claims: NO_CLAIMS, today: UNREAD_DAY }).epics
    .find((read) => read.number === number);
  const row = listing.find((issue) => issue.number === number);
  if (epic === undefined || row === undefined) {
    throw new Error(`${PREFIX}: epic #${String(number)} is not on the board listing, so its members cannot be read;`
      + ' the listing reads the newest issues only, and an epic it leaves out is not walked as if it had none');
  }
  return { epic, row };
}

/** The epic's lines: its checklist, then its label-only members; the module note holds the order. */
function descended(line: RoadmapLine, epic: Epic, row: BoardIssue): EpicLineOutcome {
  const checklist = epic.body?.lines ?? [];
  const listed = new Set(checklist.map((item) => item.issue));
  const labelOnly = epic.members.filter((member) => member.state === 'OPEN' && !listed.has(member.number));
  const past = row.body.split(LINE_BREAK).length;
  const extra = labelOnly.map((member, index) => Object.freeze({
    issue: member.number,
    ticked: false,
    why: member.title,
    lineNumber: past + index + 1,
  }));

  return {
    epic: Object.freeze({
      line,
      number: epic.number,
      title: epic.title,
      slug: epic.slug,
      progress: epic.progress,
      checklist,
      labelOnly: Object.freeze([...labelOnly]),
    }),
    lines: Object.freeze([...checklist, ...extra]),
  };
}

/** What `line`, naming the epic `issue`, comes to; the module note holds the order asked. */
async function readEpicLine(line: RoadmapLine, issue: SpecIssue, listing: BoardListing): Promise<EpicLineOutcome> {
  if (issue.state === 'CLOSED') return { skip: { line, reason: 'closed', detail: '' } };
  if (!isNowEpic(issue.labels)) {
    const horizons = issue.labels.filter((label) => label.startsWith(HORIZON_LABEL_PREFIX));
    return { skip: { line, reason: 'horizon', detail: horizons.join(', ') } };
  }

  const { epic, row } = epicOnListing(line.issue, await listing());
  if (epic.state === 'done') {
    const { done, total } = epic.progress;
    return { skip: { line, reason: 'done', detail: `${String(done)}/${String(total)}` } };
  }
  return descended(line, epic, row);
}

/** What the descent answers when it stopped at `index` without walking into an epic. */
function stoppedAt(
  lines: readonly RoadmapLine[],
  index: number,
  passed: readonly DescentPass[],
  metEpic: boolean,
): EpicDescent {
  return metEpic
    ? Object.freeze({ lines: Object.freeze(lines.slice(index)), passed: Object.freeze(passed), epic: null })
    : Object.freeze({ lines, passed: Object.freeze([]), epic: null });
}

/**
 * `lines` as a `--next` walk reads them: every line before the first
 * `now` epic that is not done passed as the walk passes it, and that
 * epic's own lines in its place. The module note holds what is passed,
 * why the read stops where it does, and the three shapes the answer
 * takes. Throws what the seams throw, and an error naming an epic the
 * listing does not hold.
 */
export async function descendRoadmap(lines: readonly RoadmapLine[], seams: EpicDescentSeams): Promise<EpicDescent> {
  const listing = listOnce(seams.listing);
  let passed: readonly DescentPass[] = [];
  let metEpic = false;

  for (const [index, line] of lines.entries()) {
    const issue = line.ticked
      ? null
      : await seams.issues(line.issue);

    if (issue === null || !isEpicIssue(issue)) {
      const skip = await readRoadmapSkip(line, seams.readings);
      if (skip === null) return stoppedAt(lines, index, passed, metEpic);
      passed = [...passed, { kind: 'line', skip }];
      continue;
    }

    metEpic = true;
    const outcome = await readEpicLine(line, issue, listing);
    if ('skip' in outcome) {
      passed = [...passed, { kind: 'epic', skip: outcome.skip }];
      continue;
    }
    return Object.freeze({ lines: outcome.lines, passed: Object.freeze(passed), epic: outcome.epic });
  }

  return stoppedAt(lines, lines.length, passed, metEpic);
}

/** The descent, the walk over its lines, and whether the epic it walked into ran dry. */
export interface DescendedPick {
  /** What the descent answered. */
  readonly descent: EpicDescent;
  /** `pickNextRoadmapLine` over {@link EpicDescent.lines}. */
  readonly pick: RoadmapPick;
  /** True when an epic was walked into and none of its lines was picked. */
  readonly dry: boolean;
}

/**
 * {@link descendRoadmap}, then `pickNextRoadmapLine` over what it
 * answered, with the same readings: the one walk `rafa next` and
 * `plan create --next` both take. The descent's reads are the walk's
 * own, memoised, so the walk over lines the descent already read spends
 * no second call.
 */
export async function pickDescendedLine(lines: readonly RoadmapLine[], seams: EpicDescentSeams): Promise<DescendedPick> {
  const descent = await descendRoadmap(lines, seams);
  const pick = await pickNextRoadmapLine(descent.lines, seams.readings);
  return Object.freeze({ descent, pick, dry: descent.epic !== null && pick.line === null });
}

/** The sentence a walk prints for one passed epic line. */
export function epicSkipSentence(skip: EpicSkip): string {
  const id = `epic #${String(skip.line.issue)}`;
  if (skip.reason === 'closed') return `${id} done: the epic is closed`;
  if (skip.reason === 'done') return `${id} done: every member is closed (${skip.detail})`;
  return skip.detail === ''
    ? `${id} passed: it carries no ${HORIZON_LABEL_PREFIX} label, and only a ${NOW_HORIZON_LABEL} epic is walked into`
    : `${id} passed: it carries ${skip.detail}, and only a ${NOW_HORIZON_LABEL} epic is walked into`;
}

/** The sentence a walk prints for one passed line, whichever kind it is. */
export function descentPassSentence(pass: DescentPass): string {
  return pass.kind === 'line'
    ? skipSentence(pass.skip)
    : epicSkipSentence(pass.skip);
}

/** The sentence a walk prints on walking into `epic`. */
export function epicHeaderSentence(epic: DescendedEpic): string {
  const { done, total } = epic.progress;
  return `walking into epic #${String(epic.number)} ${epic.title} (${String(done)}/${String(total)} done):`
    + ' its checklist, then its labelled members missing from it';
}

/** The sentence a walk prints for one open member missing from `epic`'s checklist. */
export function labelOnlySentence(epic: DescendedEpic, member: BoardIssue): string {
  const label = epic.slug === null
    ? 'its label'
    : `${EPIC_LABEL_PREFIX}${epic.slug}`;
  return `#${String(member.number)} ${member.title} carries ${label} but is not on epic #${String(epic.number)}'s checklist;`
    + ' it is walked after the checklist, by issue number';
}

/** The sentence a walk prints when `epic` has run dry. */
export function dryEpicSentence(epic: DescendedEpic): string {
  const { done, total } = epic.progress;
  return `epic #${String(epic.number)} ${epic.title} has run dry: every line of its checklist and every open member it labels`
    + ` is done or taken, though the epic is not done (${String(done)}/${String(total)});`
    + ' the walk stops here and does not move on to another epic';
}
