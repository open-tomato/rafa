/**
 * Where the project stands, in ONE answer: the twelve states of
 * `.rafa/specs/rafa-63-one-command-next-step.md` and the thirteenth
 * `.rafa/specs/rafa-86-merge-pull-request-reports.md` adds, read in the
 * spec's order, the first match winning.
 *
 * Each answer carries three things and nothing else: the action id
 * `src/next/actions.ts` runs a registered command for, the one-line
 * READING of what is true, and the one-line PROPOSAL of what to do
 * about it. Nothing here asks a question, runs a command, spawns a
 * shell line or writes anything — the command layer does all four,
 * which is what keeps every refusal an action carries the action's own.
 *
 * ## The two pre-conditions, ahead of the table
 *
 * Before any row answers, two conditions stop the table and are
 * reported in its place, each with what the PERSON does about it
 * rather than an action rafa runs. Both answer `none`, so a caller
 * prints the two lines and has nothing to offer.
 *
 *  - {@link NEXT_PRECONDITIONS}`[0]`, `tree-modified`: the working tree
 *    has changes to tracked files. Every action the table can propose
 *    switches branches, pulls, merges or hands the checkout to a model
 *    session, and each of those loses or conflicts those changes. The
 *    reading NAMES the files and the proposal is prose only — "commit
 *    or set aside your changes; rafa will not touch them" — with no
 *    command in it, because the choice between committing them,
 *    stashing them and moving them elsewhere is the person's and rafa
 *    does not make it. An untracked file is not one of these: nothing
 *    rafa runs loses one (`trackedChanges` in
 *    `src/start/branch-decision.ts`).
 *  - {@link NEXT_PRECONDITIONS}`[1]`, `pulls-unusable`: the pull
 *    request provider could not be ASKED — no network, no
 *    authentication, a `gh` that did not run. The port answers null for
 *    a pull request that is not there and throws when it could not look
 *    (`src/pr/types.ts`), so a throw is this condition and never an
 *    empty repository. The proposal names `rafa doctor`, which is the
 *    command that reports what the provider needs.
 *
 * The tree is read ahead of EVERY row, since one `git status
 * --porcelain` asks nothing of the network. The provider is read where
 * the table would read it, ahead of rows 5, 6, 7 and 8 and not before:
 * asking it earlier would spend a `gh` call on a state rows 1 to 4
 * settle without one, and a provider nobody asked is a provider nobody
 * can report on. So a running loop is still row 1 with the provider
 * unusable beside it, and it says so without ever finding out.
 *
 * ## The table
 *
 * | # | {@link NextStateId} | Action | Matches |
 * | --- | --- | --- | --- |
 * | 1 | `loop-running` | none | a session record for this project reads `running` or `paused` |
 * | 2 | `base-behind` | `sync` | the branch is the base and the base is behind its remote |
 * | 3 | `tracker-blocked` | `resume` | the branch is a plan branch whose checklist holds a blocked task |
 * | 4 | `tracker-open` | `resume` | the branch is a plan branch whose checklist holds an open task |
 * | 5 | `pr-pending` | `wait` | the branch has an open pull request that is still settling |
 * | 6 | `pr-red` | `triage` | that pull request is red, or conflicts |
 * | 7 | `pr-no-checks` | `merge-unchecked` | that pull request reports no check at all and merges |
 * | 8 | `pr-green` | `merge` | that pull request is green and merges |
 * | 9 | `plan-unstarted` | `start` | the branch is the base and a plan has no run and no branch |
 * | 10 | `issue-ready` | `plan` | the branch is the base and the roadmap's next line is ready |
 * | 11 | `issue-blocked` | `unblock` | that line waits on issues that have not closed |
 * | 12 | `issue-not-ready` | `ready` | that line carries no `spec:ready` label |
 * | 13 | `nothing-left` | none | nothing above is true |
 *
 * The order IS the resolution. Each row states only what is new, and
 * every earlier row's negation is implied by reaching it: row 10's "no
 * plan" is row 9's reading negated, and row 4's "no loop running" is row
 * 1's. So a plan branch carrying open tasks AND an open pull request
 * resumes the loop (row 4) rather than waiting on CI (row 5), a
 * conflicting pull request with no checks is triaged (row 6) rather than
 * merged unchecked (row 7), and a green pull request is merged (row 8)
 * rather than starting the plan that is sitting unstarted beside it
 * (row 9).
 *
 * ## Where a row is read wider than the spec's words, and why
 *
 * Three readings say more than the table's prose does, because the rows
 * have to PARTITION what they are read over: a state the table names
 * nothing for would leave `rafa next` with nothing to say.
 *
 *  - Row 5 also takes an open pull request whose mergeability GitHub
 *    answers `unknown`. Rows 7 and 8 need `mergeable` and row 6 needs
 *    `conflicting`, so `unknown` is none of them, and it is what `pr merge`
 *    refuses with "GitHub may still be computing the merge"
 *    (`src/pr/merge.ts`) — which is a wait.
 *  - Row 10 also requires the line NOT to be blocked. `spec:ready` and
 *    `spec:blocked` are independent facts (`src/board/blocked.ts`), so
 *    an issue can carry both; without the conjunct the first-match rule
 *    would answer `plan` for an issue whose work waits on another, and
 *    row 11 would never be reached for it.
 *  - Row 13 is the LAST row and answers whatever the twelve above did
 *    not. On the base branch that is a roadmap with no line left. Off
 *    it, it is a checkout with nothing to do — the finished plan whose
 *    pull request somebody merged in the browser is the one that lands
 *    there — and it says so, naming the base as where the cycle goes on.
 *
 * Rows 5 to 8 partition an open pull request between them because of
 * the first reading: `pending` or `unknown` is row 5, then `red` or
 * `conflicting` is row 6, then a `none` verdict that merges is row 7,
 * and what is left — green and mergeable — is row 8.
 *
 * ## Row 7: no check at all
 *
 * A pull request reporting no check at all (verdict `none`, zero check
 * rows, `verdictOf` in `src/pr/checks.ts`) has nothing for `pr triage`
 * to fix, so it is its own row rather than a clause of row 6. Its action
 * is `merge-unchecked`, which `pr merge --skip-checks` does, and which
 * asks its own question. Row 6 still takes such a pull request when it
 * conflicts, since a conflict is what triage repairs and a pull request
 * that conflicts is often one GitHub never scheduled a check for.
 *
 * ## What it reads, and what it never spends
 *
 * `./readings.ts` holds the readings and the order they are asked in:
 * each is made at most once per answer and only when it is asked for,
 * so the working tree is read once ahead of the table, the provider is
 * reached from row 5 on and the board from row 10 on. A reading that
 * failed is carried out as {@link NextState.problems} rather than
 * thrown, and the caller prints those beside the answer.
 */
import type { NextSources, NextWorld, OpenPull } from './readings.js';

import { blockedLineSentence, notReadySentence } from '../board/blocked-line.js';
import { SPEC_BLOCKED_LABEL } from '../board/blocked.js';
import { SPEC_READY_LABEL } from '../board/readiness.js';
import { planLabel } from '../commands/loop/loop-sessions.js';
import { plural } from '../commands/plan/plan-files.js';
import { messageOf } from '../config-sections.js';
import { hasDiverged } from '../start/branch-decision.js';

import { branchLabel, onBase, openWorld } from './readings.js';

/** What a defect this module raises opens with. */
const PREFIX = 'rafa next';

/** How many changed files the tree pre-condition names before eliding. */
const MAX_NAMED_FILES = 5;

/**
 * The action a state proposes, as `--yes` names one and
 * `src/next/actions.ts` maps one onto a registered command. `none` is
 * the state that proposes nothing to run.
 */
export type NextActionId =
  | 'none'
  | 'sync'
  | 'resume'
  | 'wait'
  | 'triage'
  | 'merge'
  | 'merge-unchecked'
  | 'start'
  | 'plan'
  | 'unblock'
  | 'ready';

/** Which row of the table answered; the module note holds what each matches. */
export type NextStateId =
  | 'loop-running'
  | 'base-behind'
  | 'tracker-blocked'
  | 'tracker-open'
  | 'pr-pending'
  | 'pr-red'
  | 'pr-no-checks'
  | 'pr-green'
  | 'plan-unstarted'
  | 'issue-ready'
  | 'issue-blocked'
  | 'issue-not-ready'
  | 'nothing-left';

/**
 * The two conditions reported ahead of the table, which stop it; the
 * module note holds what each matches and what it says.
 */
export type NextPreconditionId = 'tree-modified' | 'pulls-unusable';

/**
 * The two pre-conditions, in the order they are read. Frozen, and taken
 * by the caller rather than spelled again, the way {@link NEXT_STATES}
 * is taken off the table.
 */
export const NEXT_PRECONDITIONS: readonly NextPreconditionId[] = Object.freeze([
  'tree-modified',
  'pulls-unusable',
] as const);

/** What one answer is about: a row of the table, or a pre-condition ahead of it. */
export type NextAnswerId = NextStateId | NextPreconditionId;

/** Whether an answer is one of the two pre-conditions rather than a row. */
export function isPrecondition(id: NextAnswerId): id is NextPreconditionId {
  return (NEXT_PRECONDITIONS as readonly string[]).includes(id);
}

/** The one state a reading answers. */
export interface NextState {
  /** The row that answered, or the pre-condition that stopped the table. */
  readonly id: NextAnswerId;
  /** What to run, or `none` when the state carries nothing to run. */
  readonly action: NextActionId;
  /** What is true, one line, no full stop: the sentence `rafa next` prints first. */
  readonly reading: string;
  /** What to do about it, one line, no full stop: the sentence it asks about. */
  readonly proposal: string;
  /** The pull request the state is about, or null. */
  readonly pullRequest: number | null;
  /** The issue the state is about, or null. */
  readonly issue: number | null;
  /** The plan's stub, or null. */
  readonly planStub: string | null;
  /** The plan file, absolute, for the rows whose action runs on one; null otherwise. */
  readonly planPath: string | null;
  /** One sentence per reading that failed; see `./readings.ts`. */
  readonly problems: readonly string[];
}

/** What a row or a pre-condition answers with; the nulls and the problems are filled in around it. */
interface RowAnswer {
  readonly id: NextAnswerId;
  readonly action: NextActionId;
  readonly reading: string;
  readonly proposal: string;
  readonly pullRequest?: number;
  readonly issue?: number;
  readonly planStub?: string | null;
  readonly planPath?: string;
}

/** The changed files a pre-condition names, capped and quoted. */
function nameFiles(paths: readonly string[]): string {
  const shown = paths.slice(0, MAX_NAMED_FILES).map((path) => `\`${path}\``);
  const hidden = paths.length - shown.length;
  return hidden > 0
    ? `${shown.join(', ')} and ${hidden} more`
    : shown.join(', ');
}

/**
 * A sentence on one line: every run of whitespace a space. What a
 * provider threw can be several lines, and a reading is one.
 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Pre-condition 1: the working tree has changes to tracked files. Prose
 * only, and no tool named; see the module note.
 */
function readTreeModified(world: NextWorld): RowAnswer | null {
  const paths = world.tracked();
  if (paths.length === 0) return null;

  return {
    id: 'tree-modified',
    action: 'none',
    reading: `the working tree has changes to ${plural(paths.length, 'tracked file')}: ${nameFiles(paths)}`,
    proposal: 'commit or set aside your changes; rafa will not touch them',
  };
}

/**
 * Pre-condition 2: the provider could not be asked. Answered by ASKING
 * it — the one reading that tells a provider that is unusable from a
 * repository that simply has no pull request — so it is read where the
 * table would read the provider and not before; see the module note.
 */
async function readPullsUnusable(world: NextWorld): Promise<RowAnswer | null> {
  try {
    await world.openPull();
    return null;
  } catch (error) {
    return {
      id: 'pulls-unusable',
      action: 'none',
      reading: `the \`${world.sources.pulls.kind}\` pull request provider could not be asked: ${oneLine(messageOf(error))}`,
      proposal: 'run `rafa doctor` to see what the provider needs, then read the state again',
    };
  }
}

/** A pull request as a sentence names it. */
function prLabel(open: OpenPull): string {
  return `#${open.summary.number}`;
}

/** Row 1: a loop is running for this project. */
function readLoopRunning(world: NextWorld): RowAnswer | null {
  const record = world.liveRun();
  if (record === null) return null;

  return {
    id: 'loop-running',
    action: 'none',
    reading: `a loop for \`${planLabel(record)}\` is ${record.state} on \`${record.branch}\`, session ${record.sessionId}`,
    proposal: 'nothing to start while it runs; `rafa loop status` says where it is',
    planStub: record.planStub,
  };
}

/** Row 2: on the base branch, and it is behind its remote. */
function readBaseBehind(world: NextWorld): RowAnswer | null {
  if (!onBase(world)) return null;

  const standing = world.standing();
  if (standing === null || standing.behind === 0) return null;

  const { base } = world.sources;
  const tracking = `${world.remote}/${base}`;
  const ahead = hasDiverged(standing)
    ? ` and ${plural(standing.ahead, 'commit')} ahead of it`
    : '';
  return {
    id: 'base-behind',
    action: 'sync',
    reading: `\`${base}\` is ${plural(standing.behind, 'commit')} behind \`${tracking}\`${ahead}`,
    proposal: `fast-forward \`${base}\` to \`${tracking}\``,
  };
}

/** Row 3: on a plan branch whose checklist holds a blocked task. */
function readTrackerBlocked(world: NextWorld): RowAnswer | null {
  const plan = world.branchPlan();
  if (plan === null || plan.tasks.blocked === 0) return null;

  const held = `${plural(plan.tasks.blocked, 'blocked task')} and ${plural(plan.tasks.open, 'open one')}`;
  return {
    id: 'tracker-blocked',
    action: 'resume',
    reading: `\`${plan.stub}\` has ${held} on ${branchLabel(world)}`,
    proposal: `resume the loop on \`${plan.stub}\`, which retries a blocked task first`,
    planStub: plan.stub,
    planPath: plan.plan,
  };
}

/** Row 4: on a plan branch whose checklist holds an open task. */
function readTrackerOpen(world: NextWorld): RowAnswer | null {
  const plan = world.branchPlan();
  if (plan === null || plan.tasks.open === 0) return null;

  return {
    id: 'tracker-open',
    action: 'resume',
    reading: `\`${plan.stub}\` has ${plural(plan.tasks.open, 'open task')} left on ${branchLabel(world)}`,
    proposal: `resume the loop on \`${plan.stub}\``,
    planStub: plan.stub,
    planPath: plan.plan,
  };
}

/** Row 5: the branch has an open pull request that is still settling. */
async function readPrPending(world: NextWorld): Promise<RowAnswer | null> {
  const open = await world.openPull();
  if (open === null) return null;
  if (open.verdict !== 'pending' && open.mergeable !== 'unknown') return null;

  const settling = open.verdict === 'pending'
    ? 'its checks are still running'
    : `GitHub has not settled whether it merges into \`${open.summary.baseRefName}\``;
  return {
    id: 'pr-pending',
    action: 'wait',
    reading: `${prLabel(open)} is open on \`${open.summary.headRefName}\` and ${settling}`,
    proposal: `wait for the checks on ${prLabel(open)}`,
    pullRequest: open.summary.number,
  };
}

/** Why row 6 takes a pull request, or null when it does not; see the module note. */
function redClause(open: OpenPull): string | null {
  if (open.mergeable === 'conflicting') return `conflicts with \`${open.summary.baseRefName}\``;
  return open.verdict === 'red'
    ? 'its checks are red'
    : null;
}

/** Row 6: that pull request is red, or conflicts. */
async function readPrRed(world: NextWorld): Promise<RowAnswer | null> {
  const open = await world.openPull();
  if (open === null) return null;

  const why = redClause(open);
  if (why === null) return null;

  return {
    id: 'pr-red',
    action: 'triage',
    reading: `${prLabel(open)} is open on \`${open.summary.headRefName}\` and ${why}`,
    proposal: `triage ${prLabel(open)}`,
    pullRequest: open.summary.number,
  };
}

/**
 * Row 7: that pull request reports no check at all and merges. Row 6
 * has taken it when it conflicts and row 5 when GitHub has not settled
 * the merge; see the module note.
 */
async function readPrNoChecks(world: NextWorld): Promise<RowAnswer | null> {
  const open = await world.openPull();
  if (open === null || open.verdict !== 'none' || open.mergeable !== 'mergeable') return null;

  const base = `\`${open.summary.baseRefName}\``;
  return {
    id: 'pr-no-checks',
    action: 'merge-unchecked',
    reading: `${prLabel(open)} is open on \`${open.summary.headRefName}\`, reports no check at all and merges into ${base}`,
    proposal: `merge ${prLabel(open)} into ${base} with no checks`,
    pullRequest: open.summary.number,
  };
}

/** Row 8: that pull request is green and merges. */
async function readPrGreen(world: NextWorld): Promise<RowAnswer | null> {
  const open = await world.openPull();
  if (open === null || open.verdict !== 'green' || open.mergeable !== 'mergeable') return null;

  const base = `\`${open.summary.baseRefName}\``;
  return {
    id: 'pr-green',
    action: 'merge',
    reading: `${prLabel(open)} is open on \`${open.summary.headRefName}\`, green and merges into ${base}`,
    proposal: `merge ${prLabel(open)} into ${base}`,
    pullRequest: open.summary.number,
  };
}

/** Row 9: on the base branch, and a plan has no run and no branch. */
function readPlanUnstarted(world: NextWorld): RowAnswer | null {
  if (!onBase(world)) return null;

  const plan = world.unstartedPlan();
  if (plan === null) return null;

  return {
    id: 'plan-unstarted',
    action: 'start',
    reading: `\`${plan.stub}\` is planned, with no run and no branch`,
    proposal: `start the loop on \`${plan.stub}\`, creating its branch`,
    planStub: plan.stub,
    planPath: plan.plan,
  };
}

/** Row 10: the roadmap's next line is ready, and it waits on nothing. */
async function readIssueReady(world: NextWorld): Promise<RowAnswer | null> {
  const picked = await world.picked();
  if (picked === null || !picked.ready || picked.blocked !== null) return null;

  const { issue } = picked.line;
  return {
    id: 'issue-ready',
    action: 'plan',
    reading: `#${issue} is next on the roadmap and carries \`${SPEC_READY_LABEL}\``,
    proposal: `create the plan for #${issue}`,
    issue,
  };
}

/** Row 11: that line waits on issues that have not closed. */
async function readIssueBlocked(world: NextWorld): Promise<RowAnswer | null> {
  const picked = await world.picked();
  if (picked === null || picked.blocked === null) return null;

  const { issue } = picked.line;
  return {
    id: 'issue-blocked',
    action: 'unblock',
    reading: blockedLineSentence(picked.blocked),
    proposal: `re-read the blockers of #${issue} and take \`${SPEC_BLOCKED_LABEL}\` off once they have all closed`,
    issue,
  };
}

/**
 * Row 12: that line carries no `spec:ready` label. Rows 10 and 11 have
 * taken every line that is ready and unblocked and every line that is
 * blocked, so a line reaching this row carries neither label.
 */
async function readIssueNotReady(world: NextWorld): Promise<RowAnswer | null> {
  const picked = await world.picked();
  if (picked === null) return null;

  const { issue } = picked.line;
  return {
    id: 'issue-not-ready',
    action: 'ready',
    reading: notReadySentence(issue),
    proposal: `check the spec of #${issue} and mark it ready`,
    issue,
  };
}

/** Row 13 off the base branch: a checkout with nothing left to do. */
function readNothingHere(world: NextWorld): RowAnswer {
  const where = branchLabel(world);
  const plan = world.branchPlan();
  return {
    id: 'nothing-left',
    action: 'none',
    reading: plan === null
      ? `${where} is no plan branch, and it has no open pull request`
      : `\`${plan.stub}\` has no task left on ${where}, and it has no open pull request`,
    proposal: `nothing to run from ${where}; the cycle goes on from \`${world.sources.base}\``,
    planStub: plan?.stub ?? null,
  };
}

/** Row 13: nothing the twelve rows above name is true; see the module note. */
async function readNothingLeft(world: NextWorld): Promise<RowAnswer> {
  if (!onBase(world)) return readNothingHere(world);

  const roadmap = await world.roadmap();
  const passed = plural(roadmap.passed, 'line');
  return {
    id: 'nothing-left',
    action: 'none',
    reading: `the roadmap, issue #${roadmap.roadmap}, has no line left that is not done or taken (${passed} passed)`,
    proposal: 'open the next spec issue and add it to the roadmap',
  };
}

/** What a row answers: its state, or null when the row does not match. */
type NextRowReader = (world: NextWorld) => RowAnswer | null | Promise<RowAnswer | null>;

/** One row of the table: the state it answers, and what it reads to answer it. */
interface NextRow {
  readonly id: NextStateId;
  readonly read: NextRowReader;
  /** True for a row that reads the provider, which the pre-condition is checked ahead of. */
  readonly pulls?: true;
}

/** The thirteen rows, in the spec's order; the first that answers wins. */
const ROWS: readonly NextRow[] = Object.freeze([
  { id: 'loop-running', read: readLoopRunning },
  { id: 'base-behind', read: readBaseBehind },
  { id: 'tracker-blocked', read: readTrackerBlocked },
  { id: 'tracker-open', read: readTrackerOpen },
  { id: 'pr-pending', read: readPrPending, pulls: true },
  { id: 'pr-red', read: readPrRed, pulls: true },
  { id: 'pr-no-checks', read: readPrNoChecks, pulls: true },
  { id: 'pr-green', read: readPrGreen, pulls: true },
  { id: 'plan-unstarted', read: readPlanUnstarted },
  { id: 'issue-ready', read: readIssueReady },
  { id: 'issue-blocked', read: readIssueBlocked },
  { id: 'issue-not-ready', read: readIssueNotReady },
  { id: 'nothing-left', read: readNothingLeft },
] as const);

/**
 * The thirteen states, in the order they are read. Taken off the table
 * itself, so the order a caller reads here and the order an answer is
 * decided by cannot drift apart.
 */
export const NEXT_STATES: readonly NextStateId[] = Object.freeze(ROWS.map((row) => row.id));

/** A row's answer, with the nulls filled in and the problems carried. */
function answer(row: RowAnswer, problems: readonly string[]): NextState {
  return Object.freeze({
    id: row.id,
    action: row.action,
    reading: row.reading,
    proposal: row.proposal,
    pullRequest: row.pullRequest ?? null,
    issue: row.issue ?? null,
    planStub: row.planStub ?? null,
    planPath: row.planPath ?? null,
    problems: Object.freeze([...problems]),
  });
}

/**
 * The ONE state the project is in: the thirteen rows read in order, the
 * first that answers winning, with every reading that failed carried
 * beside it.
 *
 * The two pre-conditions come first: the working tree ahead of every
 * row, the provider ahead of the four rows that read it. Either one
 * answers in the table's place, carrying `none` to run.
 *
 * A row asks only the readings it needs and each of them at most once,
 * so a state an early row settles costs nothing a later one would have
 * spent. See the module note for the order, for the two pre-conditions
 * and for the three rows read wider than the spec's prose.
 */
export async function readNextState(sources: NextSources): Promise<NextState> {
  const world = openWorld(sources);

  const modified = readTreeModified(world);
  if (modified !== null) return answer(modified, world.problems());

  for (const row of ROWS) {
    if (row.pulls === true) {
      const unusable = await readPullsUnusable(world);
      if (unusable !== null) return answer(unusable, world.problems());
    }

    const found = await row.read(world);
    if (found !== null) return answer(found, world.problems());
  }

  // Unreachable: row 13 answers for every reading. A table edited to end
  // on a row that can answer null is the defect this catches.
  throw new Error(`${PREFIX}: no row of the table answered, and the last row answers for every reading`);
}
