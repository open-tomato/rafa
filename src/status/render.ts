/**
 * The words `rafa status` shows for what `./sections.ts` read: the five
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
 * | `board` | the roadmap's next issue and whether it is ready, then how many issues carry `spec:blocked` |
 * | `housekeeping` | the four `rafa cleanup` group counts, and how many worktrees are idle |
 *
 * The loops line alone has lines under it, indented two spaces: one per
 * running loop (`sessionLine`, which names a paused one `paused`), then
 * one per blocked task, naming its plan, its line in the checklist and
 * the blocker its line trails, when it trails one.
 *
 * ## A section not read
 *
 * A section `./sections.ts` could not read is still one line, at the
 * `warn` level rather than `info`: `<title>: not read: <problem>`. So a
 * section is never left out, and a `gh` that timed out is exactly one
 * `warn` line for each section it cost. It has no lines under it.
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
 * {@link statusData} is the five sections under their own keys, each
 * `{ read: false, problem }` or its reading with `read: true` first.
 * Every reading `./sections.ts` answers is plain JSON already (dates are
 * ISO 8601 strings there), so the data is the reading, copied, and
 * `JSON.parse(JSON.stringify(data))` gives it back unchanged.
 */
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
import { planLabel, sessionLine } from '../commands/loop/loop-sessions.js';
import { formatCounts } from '../commands/plan/plan-files.js';

/** Each section's title, in the order the text lists them. */
export const STATUS_SECTION_TITLES = Object.freeze({
  branch: 'Branch',
  loops: 'Loops',
  pull: 'Pull request',
  board: 'Board',
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
  /** `warn` for a section not read, `info` for every other line. */
  readonly level: 'info' | 'warn';
  readonly text: string;
}

/** The JSON data of the terminal result: the five sections; see the module note. */
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

/** The board line. */
function boardText(reading: BoardReading): string {
  const roadmap = `roadmap #${String(reading.roadmap)}`;
  const next = reading.next === null
    ? `${roadmap} has no line left`
    : `next is #${String(reading.next.line.issue)} on ${roadmap}, ${nextStanding(reading.next)}`;
  const blocked = reading.blockedIssues === null
    ? `the ${SPEC_BLOCKED_LABEL} issues were not read`
    : `${counted(reading.blockedIssues, 'issue')} labelled ${SPEC_BLOCKED_LABEL}`;
  return `${next}; ${blocked}`;
}

/** Whether the next line can be planned: what blocks it, else whether it is ready. */
function nextStanding(next: NonNullable<BoardReading['next']>): string {
  if (next.blocked !== null) return blockedLineSentence(next.blocked);
  return next.ready
    ? 'ready'
    : 'not ready';
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
    ...sectionLines('board', sections.board, boardText),
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
    housekeeping: sectionData(sections.housekeeping),
  };
}
