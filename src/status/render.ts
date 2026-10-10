/**
 * The words `rafa status` shows for what `./sections.ts` read: the six
 * sections as text lines, and the same reading as the JSON data of the
 * terminal result. It prints nothing; the command writes each line at
 * the level {@link StatusLine.level} names.
 *
 * ## The text lines
 *
 * One line per section, in the order {@link STATUS_SECTION_TITLES} lists
 * them, each opening with its title:
 *
 * | Section | Its line |
 * | --- | --- |
 * | `branch` | the branch, and the plan it names with `formatCounts`'s task counts, or `no plan` |
 * | `loops` | how many sessions are running and how many tasks are blocked |
 * | `pull` | the number, title, mergeability and checks, or `none open` |
 * | `board` | the roadmap's next issue and whether it is ready, then how many issues carry `spec:blocked`, or in `native` mode how many have an open blocker |
 * | `claims` | how many claim branches `origin` holds as last fetched, and how many are held, stale and released |
 * | `housekeeping` | the four `rafa cleanup` group counts, and how many worktrees are idle |
 *
 * Three lines have lines under them, indented two spaces. The loops line
 * has one per running loop (`sessionLine`, which names a paused one
 * `paused`), then one per blocked task, naming its plan, its line in the
 * checklist and the blocker its line trails, when it trails one.
 *
 * The board line has the place lines, only when the board reading
 * carries a `place` (a position file, or an open `type:roadmap` issue;
 * see `./sections.ts`): the place line (`placeLine`, `./place-line.ts`),
 * the away line (`awayLine`) while the current place is not home, the
 * waiting line (`waitingLine`) while the place carries a pull request a
 * hop left waiting on its owner's review, then each notice the place
 * fell back with, at the `warn` level. A project with neither gets the
 * board line alone, as it did before boards.
 *
 * The claims line has one per claim branch (`claimLine`): its issue and
 * branch, the store that owns the claim (with a handover pending, the
 * store it is offered to) or the one that released it, the stage labels
 * on the issue, and whether it is stale, how long its tip has stood and
 * which `rafa claim take` would take it.
 *
 * ## A section not read
 *
 * A section `./sections.ts` could not read is still one line, at the
 * `warn` level rather than `info`: `<title>: not read: <problem>`. So a
 * section is never left out, and a `gh` that timed out is exactly one
 * `warn` line for each section it cost. It has no lines under it. The
 * place notices are the only other `warn` lines.
 *
 * ## What the text leaves to the JSON
 *
 * A section's `notes` — a plans directory not listed, a branch scan
 * whose remote half did not answer, a provider the housekeeping could
 * not reach — qualify its reading without changing it, and the text
 * holds one line per section; they are in the JSON data only. So are
 * the plan and tracker paths, the pull request's URL, and the counts a
 * line leaves at zero.
 *
 * ## The JSON data
 *
 * {@link statusData} is the six sections under their own keys, each
 * `{ read: false, problem }` or its reading with `read: true` first.
 * Every reading `./sections.ts` answers is plain JSON already (dates are
 * ISO 8601 strings there), so the data is the reading, copied, and
 * `JSON.parse(JSON.stringify(data))` gives it back unchanged.
 */
import type { ClaimRow, ClaimsReading } from './claims.js';
import type {
  BlockedSession,
  BoardReading,
  BranchReading,
  HousekeepingReading,
  LoopsReading,
  PullReading,
  Section,
  StatusSections,
} from './sections.js';
import type { ChecksVerdict } from '../pr/checks.js';
import type { Mergeability } from '../pr/index.js';

import { blockedLineSentence } from '../board/blocked-line.js';
import { SPEC_BLOCKED_LABEL } from '../board/blocked.js';
import { idleText } from '../board/roadmap-claims.js';
import { planLabel, sessionLine } from '../loop/session-readings.js';
import { formatCounts } from '../plan/plan-files.js';

import { awayLine, placeLine, waitingLine } from './place-line.js';

/** Each section's title, in the order the text lists them. */
export const STATUS_SECTION_TITLES = Object.freeze({
  branch: 'Branch',
  loops: 'Loops',
  pull: 'Pull request',
  board: 'Board',
  claims: 'Claims',
  housekeeping: 'Housekeeping',
});

/** A section's key in {@link StatusSections}. */
export type StatusSectionKey = keyof typeof STATUS_SECTION_TITLES;

/** How far a line under the loops line is indented. */
const INDENT = '  ';

/** Each mergeability as the pull request line names it. */
const MERGEABILITY_WORDS: Readonly<Record<Mergeability, string>> = Object.freeze({
  mergeable: 'mergeable',
  conflicting: 'conflicting',
  unknown: 'mergeability unknown',
});

/** Each checks verdict as the pull request line names it. */
const VERDICT_WORDS: Readonly<Record<ChecksVerdict, string>> = Object.freeze({
  green: 'checks green',
  red: 'checks red',
  pending: 'checks pending',
  none: 'no checks',
});

/** One text line, and the level it is written at; see the module note. */
export interface StatusLine {
  /** `warn` for a section not read and a place notice, `info` for every other line. */
  readonly level: 'info' | 'warn';
  readonly text: string;
}

/** The JSON data of the terminal result: the six sections; see the module note. */
export type StatusData = StatusSections;

/** `count` and `noun`, the noun plural unless the count is one. */
function counted(count: number, noun: string, plural = `${noun}s`): string {
  return `${String(count)} ${count === 1
    ? noun
    : plural}`;
}

/** An `info` line. */
function info(text: string): StatusLine {
  return { level: 'info', text };
}

/** The branch line. */
function branchText(reading: BranchReading): string {
  const plan = reading.plan === null
    ? 'no plan'
    : `plan \`${reading.plan.stub}\` (${formatCounts(reading.plan.tasks)})`;
  return `\`${reading.branch}\`, ${plan}`;
}

/** Every blocked task across the checklists. */
function blockedTaskCount(blocked: readonly BlockedSession[]): number {
  return blocked.reduce((sum, one) => sum + one.tasks.length, 0);
}

/** The loops line. */
function loopsText(reading: LoopsReading): string {
  const tasks = blockedTaskCount(reading.blocked);
  return `${String(reading.live.length)} running, ${counted(tasks, 'task')} blocked`;
}

/** The lines under the loops line: the running loops, then the blocked tasks. */
function loopsBody(reading: LoopsReading): readonly StatusLine[] {
  const running = reading.live.map((record) => info(`${INDENT}${sessionLine(record)}`));
  const blocked = reading.blocked.flatMap((one) => one.tasks.map((task) => {
    const blocker = task.blocker === null
      ? ''
      : ` (${task.blocker})`;
    return info(`${INDENT}blocked: plan \`${planLabel(one.session)}\` line ${String(task.line)}: ${task.text}${blocker}`);
  }));
  return [...running, ...blocked];
}

/** The pull request line. */
function pullText(reading: PullReading): string {
  if (reading.pull === null) return 'none open';
  const { summary, mergeable, verdict } = reading.pull;
  return `#${String(summary.number)} ${summary.title}, ${MERGEABILITY_WORDS[mergeable]}, ${VERDICT_WORDS[verdict]}`;
}

/**
 * The blocked count ending the board line, worded in the mode it was read
 * in: the `spec:blocked` label, or in `native` mode an open blocker, which
 * is what `./blocked-count.ts` counts there.
 */
function blockedText(reading: BoardReading): string {
  const { blockedIssues } = reading;
  if (reading.mode === 'native') {
    return blockedIssues === null
      ? 'the issues with an open blocker were not read'
      : `${counted(blockedIssues, 'issue')} with an open blocker`;
  }
  return blockedIssues === null
    ? `the ${SPEC_BLOCKED_LABEL} issues were not read`
    : `${counted(blockedIssues, 'issue')} labelled ${SPEC_BLOCKED_LABEL}`;
}

/** The board line. */
function boardText(reading: BoardReading): string {
  const roadmap = `roadmap #${String(reading.roadmap)}`;
  const next = reading.next === null
    ? `${roadmap} has no line left`
    : `next is #${String(reading.next.line.issue)} on ${roadmap}, ${nextStanding(reading.next)}`;
  return `${next}; ${blockedText(reading)}`;
}

/** The lines under the board line: the place, the away line, the waiting line, the notices; none without a place. */
function boardBody(reading: BoardReading): readonly StatusLine[] {
  const { place } = reading;
  if (place === undefined) return [];
  const away = awayLine(place.current, place.home);
  return [
    info(`${INDENT}${placeLine(place.view)}`),
    ...away === null
      ? []
      : [info(`${INDENT}${away}`)],
    ...place.waiting === undefined
      ? []
      : [info(`${INDENT}${waitingLine(place.waiting.issue)}`)],
    ...place.notices.map((notice): StatusLine => ({ level: 'warn', text: `${INDENT}${notice}` })),
  ];
}

/** Whether the next line can be planned: what blocks it, else whether it is ready. */
function nextStanding(next: NonNullable<BoardReading['next']>): string {
  if (next.blocked !== null) return blockedLineSentence(next.blocked);
  return next.ready
    ? 'ready'
    : 'not ready';
}

/** The claims line. */
function claimsText(reading: ClaimsReading): string {
  const { claims } = reading;
  if (claims.length === 0) return 'none on origin as last fetched';
  const count = (states: readonly ClaimRow['state'][]): number => claims.filter((row) => states.includes(row.state)).length;
  return `${counted(claims.length, 'claim branch', 'claim branches')} on origin as last fetched:`
    + ` ${String(count(['held']))} held, ${String(count(['stale-claimed', 'stale-in-development']))} stale,`
    + ` ${String(count(['released']))} released`;
}

/** Who a claim row names: its owner, with a pending handover, or who released it. */
function claimHolder(row: ClaimRow): string {
  if (row.owner === null) return `released by store ${row.releasedBy ?? 'unknown'}`;
  return row.handingTo === null
    ? `owned by store ${row.owner}`
    : `owned by store ${row.owner}, handing over to store ${row.handingTo}`;
}

/** The stage labels a claim row names. */
function claimStage(stage: ClaimRow['stage']): string {
  if (stage === null) return 'stage labels not read';
  return stage.length === 0
    ? 'no stage label'
    : stage.join(' and ');
}

/** Whether a claim row is stale, and what would take it. */
function claimStanding(row: ClaimRow): string {
  const idle = `idle ${idleText(row.idleMs)}`;
  const take = `rafa claim take ${String(row.issue)}`;
  if (row.state === 'released') return `free to claim (${idle})`;
  if (row.state === 'held') return `not stale (${idle})`;
  return row.state === 'stale-claimed'
    ? `stale (${idle}): ${take} takes it over`
    : `stale (${idle}) but in development: only ${take} --stale takes it over`;
}

/** One line under the claims line; see the module note. */
export function claimLine(row: ClaimRow): string {
  return `#${String(row.issue)} \`${row.branch}\`: ${claimHolder(row)}, ${claimStage(row.stage)}, ${claimStanding(row)}`;
}

/** The lines under the claims line: one per claim branch. */
function claimsBody(reading: ClaimsReading): readonly StatusLine[] {
  return reading.claims.map((row) => info(`${INDENT}${claimLine(row)}`));
}

/** The housekeeping line. */
function housekeepingText(reading: HousekeepingReading): string {
  const { merged, stale, notPushed, worktrees } = reading.counts;
  return `${String(merged)} merged, ${String(stale)} stale, ${String(notPushed)} not pushed,`
    + ` ${counted(worktrees, 'worktree')} (${String(reading.idleWorktrees)} idle)`;
}

/** A section's line, `warn` when it was not read, and the lines under it. */
function sectionLines<T>(
  key: StatusSectionKey,
  section: Section<T>,
  text: (reading: T) => string,
  body: (reading: T) => readonly StatusLine[] = () => [],
): readonly StatusLine[] {
  const title = STATUS_SECTION_TITLES[key];
  if (!section.read) return [{ level: 'warn', text: `${title}: not read: ${section.problem}` }];
  return [info(`${title}: ${text(section)}`), ...body(section)];
}

/** The lines text mode writes for `sections`; see the module note. */
export function renderStatus(sections: StatusSections): readonly StatusLine[] {
  return [
    ...sectionLines('branch', sections.branch, branchText),
    ...sectionLines('loops', sections.loops, loopsText, loopsBody),
    ...sectionLines('pull', sections.pull, pullText),
    ...sectionLines('board', sections.board, boardText, boardBody),
    ...sectionLines('claims', sections.claims, claimsText, claimsBody),
    ...sectionLines('housekeeping', sections.housekeeping, housekeepingText),
  ];
}

/** A section as JSON data: `read` first, then its reading. */
function sectionData<T>(section: Section<T>): Section<T> {
  const copy = JSON.parse(JSON.stringify(section)) as Readonly<Record<string, unknown>>;
  const reading = Object.fromEntries(Object.entries(copy).filter(([key]) => key !== 'read'));
  return { read: section.read, ...reading } as Section<T>;
}

/** `sections` as the JSON data of the terminal result; see the module note. */
export function statusData(sections: StatusSections): StatusData {
  return {
    branch: sectionData(sections.branch),
    loops: sectionData(sections.loops),
    pull: sectionData(sections.pull),
    board: sectionData(sections.board),
    claims: sectionData(sections.claims),
    housekeeping: sectionData(sections.housekeeping),
  };
}
