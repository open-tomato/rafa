/**
 * The drift check: where the board's checklists and its claim labels
 * disagree with each other or with git (`.rafa/plans/rafa-324-claim-issue-so-two`).
 * It REPORTS and nothing else: it never edits a label, a checklist or a
 * body, and it never throws for the board or for git, so a caller can run
 * it as a report-only item and carry on whatever it answers.
 *
 * ## The two findings
 *
 * | Finding | When |
 * |---|---|
 * | `ticked-labelled` | a checklist line is ticked while its issue still carries `rafa:in-development` or `rafa:claimed` |
 * | `label-without-branch` | an issue carries a stage label and no `feat/rafa-<n>-*` branch names it |
 *
 * A ticked line is done (`./labels.ts` takes both stage labels off when
 * the pull request merges through `rafa pr merge`), so a stage label left
 * behind it is a merge made some other way, or a removal that failed. A
 * stage label with no claim branch is a claim that never reached git, or
 * a branch deleted since. Each finding carries the issue's state, `OPEN`
 * or `CLOSED`, as the listing read it, and names every stage label the
 * issue carries, so a failed swap that left both is shown as both.
 *
 * ## Which lines are compared
 *
 * The `- [ ] #<n>` lines {@link parseRoadmapBody} reads, of every issue
 * {@link checklistIssues} names: each board (a `type:roadmap` row, or a
 * number the caller names, such as an unlabelled default board) and each
 * epic (a row the listing types `epic`), open or closed. An issue listed
 * on two checklists is compared on each, one finding per ticked line. A
 * line naming an issue the listing does not hold cannot be compared and
 * answers a notice rather than a finding.
 *
 * The second finding is read over the WHOLE listing, not only the issues
 * a checklist names: a stage label is rafa's own, wherever it sits.
 *
 * ## Which branches count
 *
 * Every ref the branch scan answered (`scanClaimBranches`,
 * `src/board/roadmap.ts`): this checkout's branches and remote-tracking
 * refs, and the remote's heads. A ref counts when `claimBranchOfRef`
 * (`src/board/roadmap-claims.ts`) reads a claim branch in it, so a branch
 * held only by this checkout — a plan written with no network, its claim
 * commit waiting to be pushed — is a branch, and no finding. No claim
 * commit is read: a branch whose claim was released is still a branch.
 *
 * The scan is asked only when some issue carries a stage label, since
 * `git ls-remote` is a network call. A scan that reported a problem saw
 * only part of the branches, so an issue it found no branch for may yet
 * have one: the second finding is then not reported at all, and the
 * scan's problems are answered as notices, since a check that could not
 * see a branch must not claim there is none.
 *
 * ## The board
 *
 * The listing arrives as a {@link BoardListing}, the seam
 * `createCachedBoardListing` (`src/board/board-cache.ts`) answers, so a
 * check spends one small incremental read. A listing that rejects answers
 * a report with no finding and the rejection as its one notice.
 */
import type { BoardIssue, BoardIssueState, BoardListing } from '../board/roadmap-board.js';
import type { BranchScan } from '../board/roadmap.js';

import { isEpicIssue } from '../board/epic-walk.js';
import { claimBranchOfRef } from '../board/roadmap-claims.js';
import { parseRoadmapBody } from '../board/roadmap.js';
import { ROADMAP_LABEL } from '../board/setup.js';
import { messageOf } from '../config-sections.js';

import { claimBranchIssue } from './git.js';
import { STAGE_LABELS } from './labels.js';

/** What every line {@link driftLines} writes opens with. */
const PREFIX = 'claim drift';

/** A ticked checklist line whose issue still carries a stage label. */
export interface TickedLabelledDrift {
  readonly kind: 'ticked-labelled';
  /** The issue whose body holds the line: a board or an epic. */
  readonly checklist: number;
  /** Where the line sits in that body, counting from 1. */
  readonly lineNumber: number;
  /** The issue the line names. */
  readonly issue: number;
  readonly state: BoardIssueState;
  /** The stage labels the issue still carries, in {@link STAGE_LABELS} order. */
  readonly labels: readonly string[];
}

/** An issue carrying a stage label that no claim branch names. */
export interface LabelWithoutBranchDrift {
  readonly kind: 'label-without-branch';
  readonly issue: number;
  readonly state: BoardIssueState;
  /** The stage labels the issue carries, in {@link STAGE_LABELS} order. */
  readonly labels: readonly string[];
}

/** One disagreement the check found; see the module note. */
export type DriftFinding = TickedLabelledDrift | LabelWithoutBranchDrift;

/** What the check answered. */
export interface DriftReport {
  readonly findings: readonly DriftFinding[];
  /** What the check could not read, and so did not compare. */
  readonly notices: readonly string[];
}

/** The branch refs the check reads, and what the scan could not read. */
export type DriftBranches = Pick<BranchScan, 'refs' | 'problems'>;

/** What {@link findDrift} compares. */
export interface DriftInput {
  /** Every issue on the board. */
  readonly issues: readonly BoardIssue[];
  /** The issues whose checklists are compared; {@link checklistIssues} names them. */
  readonly checklists: readonly number[];
  /** Asked at most once, and only when some issue carries a stage label. */
  readonly branches: () => DriftBranches;
}

/** What {@link checkDrift} reads through. */
export interface DriftCheckOptions {
  /** The board listing; the cached one in use. */
  readonly listing: BoardListing;
  /** Board numbers the listing's labels do not mark, such as an unlabelled default board. */
  readonly boards?: readonly number[];
  /** The branch scan; `scanClaimBranches` in use. */
  readonly branches: () => DriftBranches;
}

/** The stage labels among `labels`, in {@link STAGE_LABELS} order. */
function stageLabelsOf(labels: readonly string[]): readonly string[] {
  return STAGE_LABELS.filter((label) => labels.includes(label));
}

/**
 * The issues whose checklists the check compares, lowest number first:
 * every `type:roadmap` row and every epic of `issues`, and every number
 * of `boards`. See the module note.
 */
export function checklistIssues(issues: readonly BoardIssue[], boards: readonly number[] = []): readonly number[] {
  const marked = issues
    .filter((issue) => issue.labels.includes(ROADMAP_LABEL) || isEpicIssue(issue))
    .map((issue) => issue.number);
  return Object.freeze([...new Set([...marked, ...boards])].sort((left, right) => left - right));
}

/** The ticked lines of `checklist` whose issue carries a stage label, and a notice per line not compared. */
function tickedDrift(
  checklist: number,
  byNumber: ReadonlyMap<number, BoardIssue>,
): { readonly findings: readonly DriftFinding[]; readonly notices: readonly string[] } {
  const row = byNumber.get(checklist);
  if (row === undefined) {
    return { findings: [], notices: [`#${String(checklist)} is not in the board listing, so its checklist was not compared`] };
  }
  const findings: DriftFinding[] = [];
  const notices: string[] = [];
  for (const line of parseRoadmapBody(row.body)) {
    if (!line.ticked) continue;
    const issue = byNumber.get(line.issue);
    if (issue === undefined) {
      notices.push(`#${String(line.issue)}, ticked on #${String(checklist)}, is not in the board listing, so it was not compared`);
      continue;
    }
    const labels = stageLabelsOf(issue.labels);
    if (labels.length === 0) continue;
    findings.push(Object.freeze({
      kind: 'ticked-labelled',
      checklist,
      lineNumber: line.lineNumber,
      issue: issue.number,
      state: issue.state,
      labels: Object.freeze(labels),
    }));
  }
  return { findings, notices };
}

/** The issues `refs` name a claim branch for. */
function branchIssues(refs: readonly string[]): ReadonlySet<number> {
  const issues = refs
    .map(claimBranchOfRef)
    .map((branch) => branch === null
      ? null
      : claimBranchIssue(branch))
    .filter((issue) => issue !== null);
  return new Set(issues);
}

/**
 * The labelled issues of `issues` no claim branch names, lowest number
 * first, or only the scan's problems as notices when it saw part of the
 * branches. See the module note.
 */
function branchlessDrift(
  issues: readonly BoardIssue[],
  branches: () => DriftBranches,
): { readonly findings: readonly DriftFinding[]; readonly notices: readonly string[] } {
  const labelled = issues.filter((issue) => stageLabelsOf(issue.labels).length > 0);
  if (labelled.length === 0) return { findings: [], notices: [] };

  const scan = branches();
  if (scan.problems.length > 0) {
    const skipped = 'so no stage label was reported as having no claim branch';
    return { findings: [], notices: scan.problems.map((problem) => `${problem}; ${skipped}`) };
  }
  const named = branchIssues(scan.refs);
  const findings = labelled
    .filter((issue) => !named.has(issue.number))
    .sort((left, right) => left.number - right.number)
    .map((issue): DriftFinding => Object.freeze({
      kind: 'label-without-branch',
      issue: issue.number,
      state: issue.state,
      labels: Object.freeze(stageLabelsOf(issue.labels)),
    }));
  return { findings, notices: [] };
}

/** Both findings over `input`; see the module note. Reads git only through `input.branches`. */
export function findDrift(input: DriftInput): DriftReport {
  const byNumber = new Map(input.issues.map((issue) => [issue.number, issue]));
  const ticked = input.checklists.map((checklist) => tickedDrift(checklist, byNumber));
  const branchless = branchlessDrift(input.issues, input.branches);
  return Object.freeze({
    findings: Object.freeze([...ticked.flatMap((part) => part.findings), ...branchless.findings]),
    notices: Object.freeze([...ticked.flatMap((part) => part.notices), ...branchless.notices]),
  });
}

/**
 * Reads the board through `options.listing` and answers {@link findDrift}
 * over it; never rejects. See the module note's last section.
 */
export async function checkDrift(options: DriftCheckOptions): Promise<DriftReport> {
  let issues: readonly BoardIssue[];
  try {
    issues = await options.listing();
  } catch (error) {
    return Object.freeze({
      findings: Object.freeze([]),
      notices: Object.freeze([`the board could not be read, so no drift was checked: ${messageOf(error)}`]),
    });
  }
  return findDrift({ issues, checklists: checklistIssues(issues, options.boards), branches: options.branches });
}

/** The sentence one finding is printed as. */
export function driftSentence(finding: DriftFinding): string {
  const issue = `#${String(finding.issue)}`;
  const labels = finding.labels.join(' and ');
  const state = finding.state.toLowerCase();
  return finding.kind === 'ticked-labelled'
    ? `${issue} is ticked on #${String(finding.checklist)} (line ${String(finding.lineNumber)}) but still labelled ${labels} (${state})`
    : `${issue} is labelled ${labels} (${state}) but no feat/rafa-${String(finding.issue)}-* claim branch names it`;
}

/** The report as lines to print: each finding, then each notice, every one prefixed. Empty when there is nothing to say. */
export function driftLines(report: DriftReport): readonly string[] {
  return Object.freeze([
    ...report.findings.map((finding) => `${PREFIX}: ${driftSentence(finding)}`),
    ...report.notices.map((notice) => `${PREFIX}: ${notice}`),
  ]);
}
