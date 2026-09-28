/**
 * The horizon change core: what `rafa epic defer` and `rafa epic promote`
 * change on an epic, read from one board listing, and the two writes that
 * make the change.
 *
 * An epic carries one `horizon:now|next|later` label
 * (`.rafa/specs/rafa-246-epic-lifecycle.md`), and moving it between
 * horizons swaps that label and leaves a comment saying why. Deferring an
 * epic that work has started on also parks that work, so the command
 * names the open branches and pull requests of its members and asks
 * whether to keep them. {@link readHorizonChange} answers all three —
 * the labels to swap, the {@link HorizonChange} the comment is rendered
 * from, and the open work — and {@link applyHorizonChange} makes the
 * swap and posts the comment. The question, the reason and what happens
 * to a pull request on a no are the commands'; nothing here asks.
 *
 * ## What is read
 *
 * The board listing is read ONCE by the command, through
 * `BOARD_LIST_FIELDS` and `parseBoardListing` (`./roadmap-board.ts`),
 * and handed in as {@link HorizonChangeInput.issues}; this module reads
 * no listing of its own. The epic's computed state is `readEpics`'
 * (`./epics.ts`), over the claims the roadmap's `has` column reads: a
 * plan file ({@link hasPlanFor}), a branch ({@link scanClaimBranches},
 * {@link branchClaims}) and an open pull request
 * ({@link closedIssuesIn}). Each of those three is read at most once,
 * and none of them is read when the epic has no open member, since such
 * an epic cannot be `in-progress` and has no open work to name.
 *
 * ## Refusals
 *
 * Every refusal throws `CommandExit({@link EPIC_HORIZON_REFUSAL_EXIT})`
 * before anything is read beyond the listing and before anything is
 * written, and its message ends saying nothing was changed:
 *
 * - an issue that is not on the listing, not `type:epic`, or closed — only
 *   an open epic changes horizon;
 * - an epic whose `horizon:` labels do not name ONE known horizon — none,
 *   two or more, or an unknown value such as `horizon:someday`. The views
 *   place such an epic under `later` (`horizonOf`, `./roadmap-epic-rows.ts`)
 *   and `./epic-problems.ts` names the fault, but a write cannot take that
 *   fallback: a swap removes one label, so with none there is nothing to
 *   remove, and with two one would stay behind beside the new one.
 * - a target equal to the standing horizon, which would post a comment
 *   recording a move that did not happen.
 *
 * ## The open work
 *
 * Answered only for an `in-progress` epic, and null for any other state,
 * so a caller asks the keep question exactly when the spec says to. It
 * is the work of the epic's OPEN members: a closed member's branch is
 * finished or abandoned work that parking the epic does not touch.
 *
 * - A branch is every scanned ref {@link branchClaims} reads as a
 *   member's, named as a person types it: `refs/heads/` and
 *   `refs/remotes/<remote>/` are taken off, so the local branch, its
 *   remote-tracking ref and the remote's own head are one name, kept in
 *   the order first scanned.
 * - A pull request is every open one whose body closes a member by
 *   GitHub's keywords, or whose head branch {@link branchClaims} reads as
 *   a member's, in ascending number. The head branch is read here,
 *   unlike in the roadmap's `taken` reading (`./roadmap.ts`), because
 *   that reading only asks WHETHER a line is taken and the branch scan
 *   answers first; this one names every pull request a no would close,
 *   and one opened without `Closes #<n>` is still the member's.
 *
 * A reading that failed — either half of the branch scan, the pull
 * request listing, the plan dir — is carried out as a sentence in
 * {@link HorizonChangeReading.problems}, never swallowed and never
 * thrown, so the command can print that the list it names may be short.
 *
 * ## The writes
 *
 * {@link applyHorizonChange} sends the swap through `IssueBoard.swapLabels`
 * (`./issue-board.ts`), one `gh issue edit` carrying both labels, then the
 * comment `renderHorizonComment` (`./epic-trail.ts`) spells through
 * `IssueBoard.comment`. The swap goes first, so a comment never records a
 * move whose swap failed; a failed write rejects to the caller with the
 * board's own message.
 */
import type { HorizonChange } from './epic-trail.js';
import type { Epic } from './epics.js';
import type { IssueBoard } from './issue-board.js';
import type { BoardIssue } from './roadmap-board.js';
import type { Horizon } from './roadmap-epic-rows.js';
import type { PlanNames } from './roadmap-rows.js';
import type { OpenPullRequestLister, RoadmapPullRequest } from './roadmap.js';
import type { GitRunner } from '../pr/git.js';

import { CommandExit } from '../cli/command.js';
import { messageOf } from '../config-sections.js';

import { HORIZON_LABEL_PREFIX } from './epic-problems.js';
import { renderHorizonComment } from './epic-trail.js';
import { readEpics } from './epics.js';
import { HORIZONS } from './roadmap-epic-rows.js';
import { hasPlanFor } from './roadmap-rows.js';
import { branchClaims, closedIssuesIn, scanClaimBranches } from './roadmap.js';

/** The exit code every refusal of a horizon change ends the command with. */
export const EPIC_HORIZON_REFUSAL_EXIT = 2;

/** The ref prefixes a branch name is read out of; see the module note. */
const BRANCH_REF = /^refs\/(?:heads\/|remotes\/[^/]+\/)/u;

/** What {@link readHorizonChange} reads. */
export interface HorizonChangeInput {
  /** The board listing, read once by the command. */
  readonly issues: readonly BoardIssue[];
  /** The epic whose horizon changes. */
  readonly epic: number;
  /** The horizon it moves to. */
  readonly to: Horizon;
  /** Runs the branch scan's two git reads. */
  readonly git: GitRunner;
  /** The remote the branch scan asks; `origin` when left out. */
  readonly remote?: string;
  /** Every open pull request. */
  readonly pullRequests: OpenPullRequestLister;
  /** The file names in the plan dir. */
  readonly planNames: PlanNames;
  /** Today, for `readEpics`; the clock when left out. */
  readonly today?: Date;
}

/** The open branches and pull requests of an in-progress epic's open members. */
export interface EpicOpenWork {
  /** Branch names as a person types them, in the order first scanned. */
  readonly branches: readonly string[];
  /** Open pull request numbers, ascending. */
  readonly pullRequests: readonly number[];
}

/** What {@link readHorizonChange} answers for a change it does not refuse. */
export interface HorizonChangeReading {
  /** The change, as the trail renders its comment. */
  readonly change: HorizonChange;
  /** The label the swap takes off: the standing `horizon:` label. */
  readonly removed: string;
  /** The label the swap puts on. */
  readonly added: string;
  /** The epic as `readEpics` computed it. */
  readonly state: Epic['state'];
  /** The open work of an `in-progress` epic; null for any other state. */
  readonly work: EpicOpenWork | null;
  /** A sentence per reading that failed; see the module note. */
  readonly problems: readonly string[];
}

/** `horizon:<horizon>`. */
export function horizonLabel(horizon: Horizon): string {
  return `${HORIZON_LABEL_PREFIX}${horizon}`;
}

/** The refusal `message` ends the command with. */
function refusal(message: string): CommandExit {
  return new CommandExit(EPIC_HORIZON_REFUSAL_EXIT, `❌ ${message}; nothing was changed`);
}

/** `#40`. */
function ref(issue: number): string {
  return `#${String(issue)}`;
}

/** The open epic `number` on `issues`; a refusal when it is not one. */
function openEpic(issues: readonly BoardIssue[], number: number): BoardIssue {
  const found = issues.find((issue) => issue.number === number);
  if (found === undefined) {
    throw refusal(`${ref(number)} is not on the board listing, so it is not an open epic`);
  }
  if (found.type !== 'epic') {
    throw refusal(`${ref(number)} is not an epic: it carries no type:epic label`);
  }
  if (found.state !== 'OPEN') {
    throw refusal(`Epic ${ref(number)} is closed, and only an open epic changes horizon`);
  }
  return found;
}

/** The one known horizon `epic` stands on; a refusal when its labels name none or several. */
function standingHorizon(epic: BoardIssue): Horizon {
  const labels = epic.labels.filter((label) => label.startsWith(HORIZON_LABEL_PREFIX));
  const value = labels.length === 1
    ? (labels[0] ?? '').slice(HORIZON_LABEL_PREFIX.length)
    : '';
  const known = HORIZONS.find((horizon) => horizon === value);
  if (known !== undefined) return known;
  const carried = labels.length === 0
    ? 'no horizon: label'
    : labels.join(', ');
  throw refusal(
    `Epic ${ref(epic.number)} carries ${carried}, so its standing horizon cannot be read;`
      + ' leave exactly one of horizon:now, horizon:next or horizon:later on it and run again',
  );
}

/** A scanned ref as a person types the branch; see the module note. */
export function branchNameOf(ref: string): string {
  return ref.replace(BRANCH_REF, '');
}

/** Every claim reading one epic needs, each taken once, with what failed. */
interface ClaimReadings {
  readonly refs: readonly string[];
  readonly pulls: readonly RoadmapPullRequest[];
  readonly planNames: readonly string[];
  readonly problems: readonly string[];
}

/** The three claim readings; a failure is a problem sentence, never a throw. */
async function readClaims(input: HorizonChangeInput): Promise<ClaimReadings> {
  const scan = scanClaimBranches(input.git, input.remote);
  const problems = [...scan.problems];
  let pulls: readonly RoadmapPullRequest[] = [];
  try {
    pulls = await input.pullRequests();
  } catch (error) {
    problems.push(`the open pull requests could not be read, so none is named: ${messageOf(error)}`);
  }
  let planNames: readonly string[] = [];
  try {
    planNames = input.planNames();
  } catch (error) {
    problems.push(`the plan dir could not be read, so no plan counts as started work: ${messageOf(error)}`);
  }
  return { refs: scan.refs, pulls, planNames, problems };
}

/** True when `pull` is `issue`'s: its body closes it or its head branch claims it. */
function pullIsFor(pull: RoadmapPullRequest, issue: number): boolean {
  return closedIssuesIn(pull.body).includes(issue) || branchClaims(pull.headRefName, issue);
}

/** Every issue on `issues` one of `readings` claims. */
function claimsOf(issues: readonly BoardIssue[], readings: ClaimReadings): ReadonlySet<number> {
  return new Set(issues
    .map((issue) => issue.number)
    .filter((number) => hasPlanFor(readings.planNames, number)
      || readings.pulls.some((pull) => closedIssuesIn(pull.body).includes(number))
      || readings.refs.some((scanned) => branchClaims(scanned, number))));
}

/** The open work of `open` members; see the module note. */
function openWorkOf(open: readonly number[], readings: ClaimReadings): EpicOpenWork {
  const branches = readings.refs
    .filter((scanned) => open.some((issue) => branchClaims(scanned, issue)))
    .map(branchNameOf);
  const pulls = readings.pulls
    .filter((pull) => open.some((issue) => pullIsFor(pull, issue)))
    .map((pull) => pull.number);
  return Object.freeze({
    branches: Object.freeze([...new Set(branches)]),
    pullRequests: Object.freeze([...new Set(pulls)].sort((left, right) => left - right)),
  });
}

/** The open members of `epic`, as `readEpics` grouped them. */
function openMembersOf(epic: Epic): readonly number[] {
  return epic.members.filter((member) => member.state === 'OPEN').map((member) => member.number);
}

/** `epic` read from `issues` with `claims`. */
function epicOn(issues: readonly BoardIssue[], number: number, claims: ReadonlySet<number>, today: Date): Epic {
  const read = readEpics({ issues, claims, today }).epics.find((epic) => epic.number === number);
  if (read === undefined) throw new Error(`board horizon: epic ${ref(number)} vanished from its own listing`);
  return read;
}

/**
 * The horizon change `input` asks for, read; see the module note.
 *
 * @throws CommandExit with {@link EPIC_HORIZON_REFUSAL_EXIT} for an issue
 *   that is not an open epic, an epic whose standing horizon cannot be
 *   read, and a target equal to it.
 */
export async function readHorizonChange(input: HorizonChangeInput): Promise<HorizonChangeReading> {
  const issue = openEpic(input.issues, input.epic);
  const from = standingHorizon(issue);
  if (from === input.to) {
    throw refusal(`Epic ${ref(input.epic)} is already ${horizonLabel(from)}`);
  }

  const today = input.today ?? new Date();
  const unclaimed = epicOn(input.issues, input.epic, new Set(), today);
  const open = openMembersOf(unclaimed);
  const readings = open.length === 0
    ? null
    : await readClaims(input);
  const epic = readings === null
    ? unclaimed
    : epicOn(input.issues, input.epic, claimsOf(input.issues, readings), today);

  return Object.freeze({
    change: Object.freeze({ kind: 'horizon', epic: input.epic, from, to: input.to }),
    removed: horizonLabel(from),
    added: horizonLabel(input.to),
    state: epic.state,
    work: epic.state === 'in-progress' && readings !== null
      ? openWorkOf(open, readings)
      : null,
    problems: Object.freeze([...readings?.problems ?? []]),
  });
}

/**
 * Makes `reading`'s change on the board: the one label swap, then the
 * comment with `reason`. Rejects with the board's message when a write
 * fails; a failed swap posts no comment.
 */
export async function applyHorizonChange(
  board: IssueBoard,
  reading: Pick<HorizonChangeReading, 'change' | 'removed' | 'added'>,
  reason: string,
): Promise<void> {
  await board.swapLabels(reading.change.epic, reading.removed, reading.added);
  await board.comment(reading.change.epic, renderHorizonComment(reading.change, reason));
}
