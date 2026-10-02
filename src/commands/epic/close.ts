/**
 * `rafa epic close <n> [--accept-unchecked]`: the closing gate
 * (`.rafa/specs/rafa-246-epic-lifecycle.md`). An epic closes as
 * completed only once every member is closed AND its acceptance criteria
 * hold against main, because "every issue closed" is not the same as "the
 * feature works". It is the one epic command that starts Claude sessions,
 * so it declares `spends: { when: 'always', ... }`.
 *
 * ## The steps, in order
 *
 * Each step that refuses ends the run there, with
 * {@link EPIC_CLOSE_REFUSAL_EXIT} unless said otherwise, and the epic is
 * left open.
 *
 * 1. The line: one epic number, a whole number from 1, and
 *    `--accept-unchecked`, which takes no value. Refused with exit 1.
 * 2. The board listing, read once (`createGhBoardListing`); a listing
 *    that cannot be read is refused. {@link readEpicToClose} then refuses
 *    an issue not on it, one that is not `type:epic`, a closed epic, one
 *    carrying no `epic:` label, one with no member, and one with an OPEN
 *    member, naming each open member. Membership is the `epic:<slug>`
 *    label (`groupByEpicLabel`, `src/board/epics.ts`), the slug the epic's
 *    first; in `native` mode it is the epic's sub-issues (see "The
 *    mode"). No session has started at this point.
 * 3. The criteria: the body's `Acceptance criteria` section
 *    (`readEpicBody`) cut into criteria by `splitCriteria`
 *    (`src/epic/verify-plan.ts`). An epic with none is refused, since the
 *    gate would close it over nothing.
 * 4. The plan: one captured planning session, handed `buildVerifyPrompt`'s
 *    prompt in the project root with `--tools` naming {@link PLAN_TOOLS}
 *    alone, whose `rafa:verify` answer `parseVerifyPlan` reads into one
 *    check or one uncheckable-with-reason per criterion. When every
 *    criterion is still the template's placeholder there is nothing to
 *    ask, and no session starts. A session that exits non-zero or ends
 *    with no readable block is refused: it judged nothing, and reading it
 *    as "every criterion uncheckable" would let the flag close an epic on
 *    no check at all.
 * 5. The uncheckable criteria are named; any at all refuses the close
 *    BEFORE a check runs, unless `--accept-unchecked` was passed, so a
 *    refused run spends no check session.
 * 6. The run: `runVerification` (`src/epic/verify-run.ts`) fetches
 *    `origin`, adds a detached worktree at `origin/main` under
 *    `<home>/.rafa/worktrees`, runs each check as its own session, and
 *    removes the worktree. A git step it refuses is exit 1, naming the
 *    command and what git said; a removal git refuses is a `warn` line.
 * 7. The verdicts. Every check that answered `fail` is filed as an
 *    out-of-scope bug through `triageReport` (`src/triage/triage.ts`) and
 *    the close is refused. A check whose session answered nothing is
 *    neither a pass nor a fail, and refuses the close too, filing
 *    nothing: running the close again asks it again.
 * 8. The close: one `IssueBoard.closeIssue` with reason `completed` and
 *    the trail's `renderCloseComment` (`src/board/epic-trail.ts`), naming
 *    each passed criterion and each one closed over with the flag, with
 *    its reason. A close `gh` refuses is exit 1.
 * 9. The cost: `readEpicCost` over the members at close time
 *    (`src/effort/epic-cost.ts`), printed by `renderEpicCost` beside the
 *    body's `Estimate:`, with the line saying cost follows membership. A
 *    store that cannot be read is a `warn` line: the epic is closed.
 *
 * ## The mode
 *
 * Who is in the epic is a relationship, read in the mode
 * `board.relationships` names through the board's relationships port
 * (`src/board/relations/port.ts`), {@link EpicCloseSeams.relations};
 * left out, the mode is `labels` (`LABELS_READS`), and step 2 reads as
 * spelled above, sending the same one listing.
 *
 * In `native` mode the listing is read with the native fields
 * (`boardListFields`), no `epic:` label is read, and a native epic is
 * named by its number and title, so {@link EpicToClose.slug} is null and
 * no refusal names a label. The members are the port's `membersOf`: the
 * rows whose `parent` is the epic, in sub-issue order. Step 2 refuses an
 * epic with no sub-issue on the listing and none in GitHub's count
 * (`subIssuesSummary`), and one with an open member, naming each. GitHub's
 * count also holds sub-issues the listing does not (one in another
 * repository, or past the listing's limit), whose state the listing
 * cannot show, so step 2 also refuses an epic with a sub-issue off the
 * listing while the count has any sub-issue not completed. How GitHub
 * counts a sub-issue closed as not planned is not recorded
 * (`src/board/epic-summary.ts`), so that refusal may fire over one; it
 * errs toward keeping the epic open. The cost in step 9 is read over
 * the members the listing holds.
 *
 * ## Filing a failed check
 *
 * Each failed check is one report of its own, holding one bug and no
 * blocker, handed to `triageReport` with the check session's id, since
 * that session is where the evidence came from, and `failed` as the
 * outcome. The bug is `security: false`: a criterion that does not hold is
 * a product bug, so it goes to the public tracker the chain resolves,
 * resolved once and only when a check failed (`resolveTracker`, with
 * `unresolvedTracker` from `src/start/triage.ts` standing in for a chain
 * that landed nowhere, so each bug then fails with its refusal). Its
 * `what` names the epic and the criterion, and its `artifact` is
 * {@link failedCheckArtifact}: the epic and the criterion's text on one
 * line, which is what stays the same when the close is run again. The
 * recurrence key is that artifact, stripped of its numbers as
 * `src/triage/bug-key.ts` strips it, after {@link closeTriageFile}'s base
 * name, which keeps the epic's number, so a second close failing the same
 * criterion comments on the first issue rather than filing another. No file is read or written at
 * that path: the report carries no blocker, and a blocker is the only
 * thing `triageReport` writes into its tracker file. The feedback holds
 * the check, the commit and the evidence. When #249's ladder lands it
 * routes these bugs; until then they are filed as out-of-scope bugs are.
 *
 * ## What it writes
 *
 * Every line goes through the command's output, `info` or `warn`, in
 * text and json mode alike, and each session's own output is echoed as
 * it runs. A refusal is the thrown `CommandExit`, so in json mode what
 * the gate found before it refused is in those log events. A close ends
 * json mode with an {@link EpicCloseResult} as the terminal result's
 * `data`.
 *
 * Git, `gh`, the Claude spawner, the effort store and the tracker chain
 * arrive through {@link EpicCloseSeams}, so `./close.test.ts` starts no
 * Claude session, reaches no `origin` and opens no project's store.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { ResolveTrackerOptions, TrackerResolution } from '../../adapters/tracker/resolve.js';
import type { EpicBody } from '../../board/epic-body.js';
import type { UncheckedCriterion } from '../../board/epic-trail.js';
import type { EpicRelations } from '../../board/epics.js';
import type { BoardIssue } from '../../board/roadmap-board.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { RafaConfig } from '../../config.js';
import type { EpicCost } from '../../effort/epic-cost.js';
import type { FindingsWriterSeams } from '../../effort/store/findings.js';
import type { EffortStore } from '../../effort/store/types.js';
import type { CriterionUncheckable, CriterionVerdict, EpicCriterion, VerifyPlanIssue } from '../../epic/verify-plan.js';
import type { CheckAnswered, CheckUnanswered, VerifyRunRan } from '../../epic/verify-run.js';
import type { IssueRef, Tracker } from '../../ports/index.js';
import type { GitRunner } from '../../pr/git.js';
import type { TaskReport } from '../../report/parse.js';
import type { BugTriage, NamedSecret } from '../../triage/triage.js';
import type { CapturingSpawner } from '../../utils/claude.js';

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { resolveTracker } from '../../adapters/tracker/resolve.js';
import { readEpicBody } from '../../board/epic-body.js';
import { PLACEHOLDER_REASON } from '../../board/epic-template.js';
import { renderCloseComment } from '../../board/epic-trail.js';
import { EPIC_LABEL_PREFIX, epicSlugsOf, groupByEpicLabel } from '../../board/epics.js';
import { createGhIssueBoard } from '../../board/issue-board.js';
import { LABELS_READS } from '../../board/relations/labels.js';
import { createGhBoardListing } from '../../board/roadmap-board.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { readEpicCost, renderEpicCost } from '../../effort/epic-cost.js';
import { selectEffortStore } from '../../effort/store/index.js';
import { buildVerifyPrompt, criteriaToAsk, parseVerifyPlan, readVerifyPrompt, splitCriteria } from '../../epic/verify-plan.js';
import { runVerification } from '../../epic/verify-run.js';
import { createGitRunner } from '../../pr/git.js';
import { SESSION_ID_FLAG } from '../../start/dispatch.js';
import { unresolvedTracker } from '../../start/triage.js';
import { namedSecrets, triageReport } from '../../triage/triage.js';
import { claudeArgs, spawnClaudeCaptured } from '../../utils/claude.js';
import { issueProject, issueSubjectConfig, lineRefusal } from '../issue/issue-tracker.js';
import { readSwitch } from '../plan/plan-files.js';

/** The exit code every refusal of the gate ends the command with. */
export const EPIC_CLOSE_REFUSAL_EXIT = 2;

/** The flag that closes over criteria the plan could not turn into checks. */
export const ACCEPT_UNCHECKED_FLAG = 'accept-unchecked';

/** The only tools the planning session is given: it reads, and runs nothing. */
export const PLAN_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob'];

/** The usage line a refusal names. */
const USAGE = `rafa epic close <n> [--${ACCEPT_UNCHECKED_FLAG}]`;

/** An issue number as a line types it: a whole number from 1. */
const ISSUE_NUMBER = /^[1-9]\d*$/u;

/** What a line asks for, read before anything is opened. */
export interface CloseLine {
  readonly epic: number;
  readonly acceptUnchecked: boolean;
}

/** The epic the gate checks, read off the listing. */
export interface EpicToClose {
  readonly epic: BoardIssue;
  /** The slug of its first `epic:` label; null in `native` mode, where an epic is named by number and title. */
  readonly slug: string | null;
  /**
   * Every issue carrying `epic:<slug>`, in ascending number; in `native`
   * mode every row whose `parent` is the epic, in sub-issue order. Each
   * one closed.
   */
  readonly members: readonly BoardIssue[];
  readonly body: EpicBody;
}

/** What json mode gives as the terminal result's `data` for a closed epic. */
export interface EpicCloseResult {
  readonly status: 'closed';
  readonly epic: number;
  /** The commit the checks ran against, or null when no check ran. */
  readonly commit: string | null;
  /** The numbers of the criteria whose check passed. */
  readonly passed: readonly number[];
  /** The criteria closed over with `--accept-unchecked`, with their reasons. */
  readonly unchecked: readonly UncheckedCriterion[];
  /** What the members cost, or null when the store could not be read. */
  readonly cost: EpicCost | null;
  /** The body's `Estimate:`, or null when it wrote none. */
  readonly estimate: string | null;
}

/** How the command reaches `gh`, `git`, Claude, the store and the tracker chain; each left out is the system's own. */
export interface EpicCloseSeams {
  readonly gh?: GhRunner;
  /** A git runner for the operator checkout. */
  readonly git?: GitRunner;
  /** The planning and check sessions' spawner. */
  readonly spawn?: CapturingSpawner;
  /** Picks each session's id. `randomUUID` when left out. */
  readonly sessionId?: () => string;
  /** Opens the effort store the cost is read from. `selectEffortStore` when left out. */
  readonly openStore?: (root: string, config: RafaConfig) => EffortStore;
  /** Resolves the public tracker a failed check is filed on. `resolveTracker` when left out. */
  readonly resolve?: (options: ResolveTrackerOptions) => Promise<TrackerResolution>;
  /** Where a bug routed private goes. `triageReport`'s own when left out. */
  readonly privateTracker?: Tracker;
  /** Seams for the tracker reference `triageReport` stores. */
  readonly findings?: FindingsWriterSeams;
  /** The board's relationships, which read the epic's members; `labels` mode when left out. See the module note. */
  readonly relations?: EpicRelations;
}

/** `#40`. */
function ref(issue: number): string {
  return `#${String(issue)}`;
}

/** Text on one line, every run of whitespace one space. */
function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** `criterion 2: <text on one line>`. */
function criterionName(criterion: EpicCriterion): string {
  return `criterion ${String(criterion.number)}: ${oneLine(criterion.text)}`;
}

/** `1 criterion` or `3 criteria`. */
function criteria(count: number): string {
  return count === 1
    ? '1 criterion'
    : `${String(count)} criteria`;
}

/** A refusal before anything was changed. */
function refusal(message: string): CommandExit {
  return new CommandExit(EPIC_CLOSE_REFUSAL_EXIT, `❌ ${message}; the epic stays open and nothing was changed`);
}

/** What a line asks for; a refusal with exit code 1 for anything but one epic number. */
export function readCloseLine(context: Pick<RafaContext, 'args' | 'flags'>): CloseLine {
  const { args, flags } = context;
  const [word] = args;
  if (args.length !== 1 || word === undefined) {
    const got = args.length === 0
      ? 'none'
      : `${String(args.length)}: ${args.join(' ')}`;
    throw lineRefusal(`Expected one epic number, got ${got}`, USAGE);
  }
  if (!ISSUE_NUMBER.test(word)) throw lineRefusal(`"${word}" is no epic number, which is a whole number from 1`, USAGE);
  const acceptUnchecked = readSwitch(
    ACCEPT_UNCHECKED_FLAG,
    flags[ACCEPT_UNCHECKED_FLAG],
    `Write it after the epic number: rafa epic close <n> --${ACCEPT_UNCHECKED_FLAG}.`,
  );
  return Object.freeze({ epic: Number(word), acceptUnchecked });
}

/** Refuses epic `number` when a member of `members` is open, naming each; see the module note, step 2. */
function refuseOpenMembers(number: number, members: readonly BoardIssue[]): void {
  const open = members.filter((member) => member.state === 'OPEN');
  if (open.length === 0) return;
  const named = open.map((member) => `${ref(member.number)} ${oneLine(member.title)}`).join(', ');
  throw refusal(`Epic ${ref(number)} has ${String(open.length)} open ${open.length === 1
    ? 'member'
    : 'members'}: ${named}. The gate checks an epic only once every member is closed: close them, or move them`
    + ' out with rafa epic move <issue> --to=<epic>. No session was started');
}

/** The `labels`-mode members of `epic`: the issues carrying its first `epic:` label. */
function labelsEpicToClose(issues: readonly BoardIssue[], epic: BoardIssue): EpicToClose {
  const { number } = epic;
  const [slug] = epicSlugsOf(epic.labels);
  if (slug === undefined) throw refusal(`Epic ${ref(number)} carries no ${EPIC_LABEL_PREFIX} label, so it has no members`);
  const members = groupByEpicLabel(issues).get(slug) ?? [];
  if (members.length === 0) {
    throw refusal(`Epic ${ref(number)} has no members: no issue carries ${EPIC_LABEL_PREFIX}${slug}, so no work was done under it`);
  }
  refuseOpenMembers(number, members);
  return Object.freeze({ epic, slug, members, body: readEpicBody(epic.body) });
}

/** The `native`-mode members of `epic`: its sub-issues, checked against GitHub's own count; see the module note. */
function nativeEpicToClose(issues: readonly BoardIssue[], epic: BoardIssue, relations: EpicRelations): EpicToClose {
  const { number } = epic;
  const { members } = relations.read(issues).membersOf(epic);
  const summary = epic.subIssuesSummary ?? { total: members.length, completed: 0 };
  if (members.length === 0 && summary.total === 0) {
    throw refusal(`Epic ${ref(number)} has no members: it has no sub-issue, so no work was done under it`);
  }
  refuseOpenMembers(number, members);
  const unlisted = summary.total - members.length;
  const notCompleted = summary.total - summary.completed;
  if (unlisted > 0 && notCompleted > 0) {
    throw refusal(`Epic ${ref(number)} has ${String(unlisted)} ${unlisted === 1
      ? 'sub-issue'
      : 'sub-issues'} the board listing does not hold, in another repository or past its limit, and GitHub counts`
      + ` ${String(notCompleted)} of its ${String(summary.total)} sub-issues not completed, so the gate cannot tell every`
      + ' member is closed: close them on GitHub, or take them out of the epic. No session was started');
  }
  return Object.freeze({ epic, slug: null, members, body: readEpicBody(epic.body) });
}

/**
 * The epic `number` names on `issues`, with its members, read in the
 * mode `relations` answers, `labels` when left out; see the module note,
 * step 2 and "The mode".
 *
 * @throws CommandExit with {@link EPIC_CLOSE_REFUSAL_EXIT} for each
 *   refusal step 2 lists.
 */
export function readEpicToClose(issues: readonly BoardIssue[], number: number, relations: EpicRelations = LABELS_READS): EpicToClose {
  const epic = issues.find((issue) => issue.number === number);
  if (epic === undefined) throw refusal(`${ref(number)} is not on the board listing`);
  if (epic.type !== 'epic') throw refusal(`${ref(number)} is not an epic: it carries no type:epic label`);
  if (epic.state !== 'OPEN') throw refusal(`Epic ${ref(number)} is closed already`);
  return relations.mode === 'native'
    ? nativeEpicToClose(issues, epic, relations)
    : labelsEpicToClose(issues, epic);
}

/** The flags the planning session is spawned with, `--tools` last since it is variadic. */
export function planFlags(sessionId: string): string[] {
  return [SESSION_ID_FLAG, sessionId, '--tools', PLAN_TOOLS.join(',')];
}

/** What the planning step answered. */
export type VerifyPlanning =
  | {
    readonly status: 'planned';
    /** The planning session's id, or null when every criterion was a placeholder and none ran. */
    readonly sessionId: string | null;
    readonly verdicts: readonly CriterionVerdict[];
    readonly issues: readonly VerifyPlanIssue[];
  }
  | { readonly status: 'absent'; readonly sessionId: string; readonly text: string };

/** What one planning step is run with. */
export interface PlanningInput {
  readonly epic: BoardIssue;
  readonly criteria: readonly EpicCriterion[];
  readonly root: string;
  readonly settingSources: RafaConfig['settingSources'];
  readonly spawn: CapturingSpawner;
  readonly sessionId: () => string;
  /** Reads the prompt template. `readVerifyPrompt` when left out. */
  readonly template?: () => string;
}

/** Runs step 4 of the module note: one planning session, or none when there is nothing to ask. */
export async function planVerification(input: PlanningInput): Promise<VerifyPlanning> {
  if (criteriaToAsk(input.criteria).length === 0) {
    const verdicts = input.criteria.map((criterion): CriterionVerdict => Object.freeze({
      kind: 'uncheckable', criterion, reason: PLACEHOLDER_REASON, source: 'placeholder',
    }));
    return Object.freeze({ status: 'planned', sessionId: null, verdicts, issues: [] });
  }
  const prompt = buildVerifyPrompt((input.template ?? readVerifyPrompt)(), {
    epic: input.epic.number,
    title: input.epic.title,
    criteria: input.criteria,
  });
  const sessionId = input.sessionId();
  const session = await input.spawn(claudeArgs(input.settingSources, planFlags(sessionId)), prompt, { cwd: input.root });
  if (session.exitCode !== 0) {
    return Object.freeze({ status: 'absent', sessionId, text: `the planning session exited ${String(session.exitCode)}` });
  }
  const reading = parseVerifyPlan(session.stdout, input.criteria);
  if (!reading.present) return Object.freeze({ status: 'absent', sessionId, text: reading.text });
  return Object.freeze({ status: 'planned', sessionId, verdicts: reading.verdicts, issues: reading.issues });
}

/** The file name half of a failed check's recurrence key; see the module note. Nothing is at this path. */
export function closeTriageFile(root: string, epic: number): string {
  return join(root, '.rafa', `epic-${String(epic)}-close`);
}

/** A failed check's artifact: what stays the same when the close is run again. */
export function failedCheckArtifact(epic: number, criterion: EpicCriterion): string {
  return `epic ${ref(epic)} acceptance criterion: ${oneLine(criterion.text)}`;
}

/** The report one failed check is filed through `triageReport` as; see the module note. */
export function failedCheckReport(epic: number, failure: CheckAnswered, commit: string): TaskReport {
  const { criterion } = failure.check;
  const feedback = [
    `Epic ${ref(epic)} was being closed through the closing gate, and this acceptance criterion's check failed.`,
    '',
    `Criterion ${String(criterion.number)}:`,
    criterion.text,
    '',
    'Check:',
    failure.check.check,
    '',
    `Evidence, against commit ${commit}:`,
    failure.evidence,
  ].join('\n');
  return Object.freeze({
    status: null,
    feedback,
    findings: [],
    skillsUsed: [],
    blockers: [],
    outOfScopeBugs: [Object.freeze({
      what: `Epic ${ref(epic)} acceptance criterion ${String(criterion.number)} fails against main: ${oneLine(criterion.text)}`,
      artifact: failedCheckArtifact(epic, criterion),
      security: false,
      extras: [],
    })],
    changes: [],
    extras: [],
  });
}

/** How a line names an issue: its URL, or its kind and id. */
function issueName(issue: IssueRef): string {
  return issue.url ?? `${issue.kind} issue ${issue.externalId}`;
}

/** The line one filed bug is reported with, and whether it is a warning. */
export function bugLine(criterion: EpicCriterion, bug: BugTriage): { readonly text: string; readonly warn: boolean } {
  const which = `Criterion ${String(criterion.number)}`;
  switch (bug.action) {
    case 'filed': {
      return { text: `${which}: filed on the ${bug.channel} tracker as ${bug.ref === null
        ? 'an issue'
        : issueName(bug.ref)}.`, warn: false };
    }
    case 'commented': {
      return { text: `${which}: recurs in ${bug.ref === null
        ? 'an issue'
        : issueName(bug.ref)} on the ${bug.channel} tracker; commented on it.`, warn: false };
    }
    case 'skipped': {
      return { text: `${which}: not filed: ${bug.problem ?? 'no reason given'}.`, warn: true };
    }
    case 'failed': {
      return { text: `${which}: not filed on the ${bug.channel} tracker: ${bug.problem ?? 'no reason given'}`, warn: true };
    }
  }
}

/** Everything a run writes through, and the seams it runs with, resolved. */
interface CloseRun {
  readonly context: RafaContext;
  readonly root: string;
  readonly home: string;
  readonly config: RafaConfig;
  readonly seams: EpicCloseSeams;
  readonly spawn: CapturingSpawner;
  readonly sessionId: () => string;
}

/** Writes `text` at `info`. */
function say(run: CloseRun, text: string): void {
  run.context.output.info(text);
}

/** Writes `text` at `warn`. */
function warn(run: CloseRun, text: string): void {
  run.context.output.warn(text);
}

/** Files each failed check through `triageReport`, the public tracker resolved once; see the module note. */
async function fileFailures(run: CloseRun, epic: number, failures: readonly CheckAnswered[], commit: string): Promise<void> {
  const secrets: readonly NamedSecret[] = namedSecrets(run.config, run.context.env);
  let tracker: Tracker;
  try {
    const resolved = await (run.seams.resolve ?? resolveTracker)({ config: run.config, context: { repoRoot: run.root } });
    tracker = resolved.tracker;
  } catch (error) {
    warn(run, `No tracker resolved, so no failed check is filed: ${messageOf(error)}`);
    tracker = unresolvedTracker(run.config.trackerDefault, messageOf(error));
  }
  for (const failure of failures) {
    const { criterion } = failure.check;
    try {
      const result = await triageReport({
        repoRoot: run.root,
        trackerPath: closeTriageFile(run.root, epic),
        lineNum: 0,
        dispatch: { sessionId: failure.sessionId, planStub: null, taskLine: `rafa epic close ${String(epic)}` },
        outcome: 'failed',
        report: failedCheckReport(epic, failure, commit),
        tracker,
        privateTracker: run.seams.privateTracker,
        secrets,
        seams: run.seams.findings,
      });
      for (const bug of result.bugs) {
        const line = bugLine(criterion, bug);
        if (line.warn) warn(run, line.text);
        else say(run, line.text);
      }
    } catch (error) {
      warn(run, `Criterion ${String(criterion.number)}: not filed: ${messageOf(error)}`);
    }
  }
}

/** Names each uncheckable criterion, refusing unless `--accept-unchecked` closes over them. */
function weighUnchecked(run: CloseRun, epic: number, unchecked: readonly CriterionUncheckable[], accept: boolean): void {
  for (const verdict of unchecked) {
    warn(run, `Uncheckable ${criterionName(verdict.criterion)} — ${verdict.reason}`);
  }
  if (unchecked.length === 0 || accept) return;
  throw refusal(`Epic ${ref(epic)} has ${criteria(unchecked.length)} the verification plan could not turn into a check,`
    + ` named above: make each one checkable in the epic's body, or pass --${ACCEPT_UNCHECKED_FLAG} to close over`
    + ' them. No check was run');
}

/** Reads what the run answered; refuses on a failed or unanswered check, after filing each failure. */
async function weighResults(run: CloseRun, epic: number, ran: VerifyRunRan): Promise<readonly CheckAnswered[]> {
  const answered = ran.results.filter((result): result is CheckAnswered => result.kind === 'answered');
  const unanswered = ran.results.filter((result): result is CheckUnanswered => result.kind === 'unanswered');
  const failed = answered.filter((result) => result.result === 'fail');
  for (const result of ran.results) {
    const name = criterionName(result.check.criterion);
    if (result.kind === 'unanswered') warn(run, `No answer for ${name} — ${result.reason}`);
    else if (result.result === 'pass') say(run, `✓ Passed ${name} — ${oneLine(result.evidence)}`);
    else warn(run, `✗ Failed ${name} — ${oneLine(result.evidence)}`);
  }
  if (!ran.removal.ok) {
    const said = ran.removal.said === ''
      ? 'git said nothing'
      : ran.removal.said;
    warn(run, `The verification worktree was not removed: ${said}; remove it with ${ran.removal.command}`);
  }
  if (failed.length > 0) await fileFailures(run, epic, failed, ran.commit);
  if (failed.length === 0 && unanswered.length === 0) return answered;

  const parts = [
    ...(failed.length === 0
      ? []
      : [`${criteria(failed.length)} failed ${failed.length === 1
        ? 'its check'
        : 'their checks'}, each filed as a bug`]),
    ...(unanswered.length === 0
      ? []
      : [`${criteria(unanswered.length)} got no answer; run the close again to ask again`]),
  ];
  throw new CommandExit(EPIC_CLOSE_REFUSAL_EXIT, `❌ Epic ${ref(epic)} was not closed: against ${ran.commit}, ${parts.join(', and ')}.`);
}

/** Closes the epic with the trail's comment; exit code 1 when `gh` refuses. */
async function closeWithComment(run: CloseRun, epic: number, passed: readonly CheckAnswered[], unchecked: readonly CriterionUncheckable[]): Promise<readonly UncheckedCriterion[]> {
  const accepted = unchecked.map((verdict) => Object.freeze({ criterion: verdict.criterion.text, reason: verdict.reason }));
  const comment = renderCloseComment({ passed: passed.map((result) => result.check.criterion.text), unchecked: accepted });
  const gh = run.seams.gh ?? createGhRunner({ cwd: run.root });
  try {
    await createGhIssueBoard({ gh }).closeIssue(epic, 'completed', comment);
  } catch (error) {
    throw new CommandExit(1, `❌ Every check passed, but epic ${ref(epic)} could not be closed: ${messageOf(error)}\n`
      + 'Close it as completed by hand, or run the close again.');
  }
  return Object.freeze(accepted);
}

/** Reads and prints the cost beside the estimate; a store that cannot be read is a warning. */
function printCost(run: CloseRun, target: EpicToClose): EpicCost | null {
  try {
    const store = (run.seams.openStore ?? selectEffortStore)(run.root, run.config);
    const cost = readEpicCost(store, target.members.map((member) => member.number));
    for (const line of renderEpicCost(cost, target.body.estimate)) say(run, line);
    return cost;
  } catch (error) {
    warn(run, `The epic is closed, but its cost could not be read from the effort store: ${messageOf(error)}`);
    return null;
  }
}

/** Runs the gate over one line; see the module note for each step. */
export async function closeEpic(context: RafaContext, seams: EpicCloseSeams): Promise<EpicCloseResult> {
  const line = readCloseLine(context);
  const project = issueProject(context);
  const config = issueSubjectConfig(project, (message) => context.output.warn(message));
  const run: CloseRun = {
    context,
    root: project.root,
    home: project.home,
    config,
    seams,
    spawn: seams.spawn ?? spawnClaudeCaptured,
    sessionId: seams.sessionId ?? randomUUID,
  };

  const gh = seams.gh ?? createGhRunner({ cwd: project.root });
  let listing: readonly BoardIssue[];
  try {
    listing = await createGhBoardListing(seams.relations === undefined
      ? { gh }
      : { gh, mode: seams.relations.mode })();
  } catch (error) {
    throw new CommandExit(EPIC_CLOSE_REFUSAL_EXIT, `❌ Could not read the board, so nothing was changed: ${messageOf(error)}`);
  }
  const target = readEpicToClose(listing, line.epic, seams.relations);
  const epic = line.epic;
  const split = splitCriteria(target.body.criteria);
  if (split.length === 0) {
    throw refusal(`Epic ${ref(epic)} has no acceptance criteria, so the gate has nothing to check; write them under`
      + ' its "Acceptance criteria" heading. No session was started');
  }

  say(run, `Every member of epic ${ref(epic)} is closed. Planning the checks for its ${criteria(split.length)}.`);
  const planning = await planVerification({ epic: target.epic, criteria: split, root: run.root, settingSources: config.settingSources, spawn: run.spawn, sessionId: run.sessionId });
  if (planning.status === 'absent') {
    throw refusal(`The verification plan for epic ${ref(epic)} answered nothing: ${planning.text}. No check was run`);
  }
  for (const issue of planning.issues) warn(run, `The verification plan's ${issue.field}: ${issue.text}`);
  const unchecked = planning.verdicts.filter((verdict): verdict is CriterionUncheckable => verdict.kind === 'uncheckable');
  weighUnchecked(run, epic, unchecked, line.acceptUnchecked);

  const checks = planning.verdicts.filter((verdict) => verdict.kind === 'check');
  const outcome = await runVerification({ epic, checks, settingSources: config.settingSources, home: run.home, git: seams.git ?? createGitRunner(run.root), spawn: run.spawn, sessionId: run.sessionId });
  if (outcome.status === 'not-run') {
    throw new CommandExit(1, `❌ The checks for epic ${ref(epic)} could not run: ${outcome.step.command} failed: ${outcome.step.said}; the epic stays open`);
  }
  const passed = outcome.status === 'ran'
    ? await weighResults(run, epic, outcome)
    : [];
  const accepted = await closeWithComment(run, epic, passed, unchecked);
  const commit = outcome.status === 'ran'
    ? outcome.commit
    : null;
  say(run, `Closed epic ${ref(epic)} as completed: ${criteria(passed.length)} passed${commit === null
    ? ''
    : ` against ${commit}`}${accepted.length === 0
    ? ''
    : `, ${criteria(accepted.length)} closed over with --${ACCEPT_UNCHECKED_FLAG}`}.`);
  const cost = printCost(run, target);
  return Object.freeze({
    status: 'closed',
    epic,
    commit,
    passed: passed.map((result) => result.check.criterion.number),
    unchecked: accepted,
    cost,
    estimate: target.body.estimate,
  });
}

/** Runs one `epic close` line with `seams`; json mode ends on the result. */
export async function runEpicClose(context: RafaContext, seams: EpicCloseSeams): Promise<void> {
  const result = await closeEpic(context, seams);
  if (context.outputMode === 'json') context.output.result(result);
}

/** The command, reaching `gh`, `git`, Claude, the store and the tracker chain through `seams`; see the module note. */
export function createEpicCloseCommand(seams: EpicCloseSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'epic close',
    subject: 'epic',
    action: 'close',
    summary: 'close an epic through the gate: every member closed, then its criteria checked against main',
    description: 'Refuses with exit code 2, naming them, while any member of the epic is open. Then one session'
      + ' plans a check for each acceptance criterion, or names it uncheckable with a reason, and each check runs'
      + ' as its own session in a detached worktree of origin/main. Any uncheckable criterion refuses the close'
      + ` before a check runs, unless --${ACCEPT_UNCHECKED_FLAG} is passed; each failed check is filed as a bug and`
      + ' refuses the close. Otherwise the epic is closed as completed with a comment naming each criterion, and'
      + ' what its members cost, summed from the effort store, is printed beside its estimate. With'
      + ' `--output=json` the close is the data of the terminal result event.',
    args: [
      {
        name: 'n',
        description: 'The epic\'s issue number.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: ACCEPT_UNCHECKED_FLAG,
        description: 'Close over the criteria the verification plan could not turn into checks, naming each in the comment.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa epic close 40',
        note: 'Checks #40\'s criteria against origin/main and closes it when every check passes.',
      },
      {
        cmd: `rafa epic close 40 --${ACCEPT_UNCHECKED_FLAG}`,
        note: 'The same, closing over any criterion that could not be turned into a check.',
      },
    ],
    outputs: ['text', 'json'],
    spends: { when: 'always', what: 'one verification planning session and one session per check' },
    run: (context) => runEpicClose(context, seams),
  };
  return Object.freeze(command);
}

export default createEpicCloseCommand();
