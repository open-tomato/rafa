/**
 * Loop-owned triage in `loop start`: what the run does with a task
 * report's blockers, out-of-scope bugs and stale-doc entries once the
 * report is stored and the task's tracker line is marked.
 *
 * `start()` makes one {@link StartTriage} per run through
 * {@link createStartTriage}, before its first dispatch, and hands it each
 * task right after `storeTaskReport` (`start/dispatch.ts`), whatever became
 * of the task: done, blocked, failed or interrupted. The triage reads the
 * session's output with `parseReport`, as the store did, and hands the
 * report to `triageReport` (`triage/triage.ts`), which writes the blocker
 * text onto the task's line, routes each out-of-scope entry by its kind
 * (see below), files, or comments on, each one routed as a bug, and
 * answers each `stale_docs` entry with nothing filed. An output with no
 * report, and a report with no blocker text, no out-of-scope bug and no
 * `stale_docs` entry, are left alone: nothing is resolved, called or
 * printed.
 *
 * ## Kinds, and the route each entry took
 *
 * Made with {@link StartTriageOptions.kinds}, as `start()` makes it, the
 * triage hands `triageReport`, for each report listing an out-of-scope
 * entry, the readings its kind check takes: the plan's base and files,
 * the head, `runNamedTestAt` over the run's checkout, and the run's
 * resolved retry count as the cap on the plan's repair tasks; the
 * tracker path is the task's own. `start/triage-kinds.ts` reads them
 * and says what each costs. Left out, every entry is triaged as it was
 * before kinds existed.
 *
 * Whatever became of each entry, its `bug_routes` row is then written
 * through `writeBugRoutes` (`start/triage-kinds.ts` holds the table of
 * routes), and a write the store refuses is one warning line.
 *
 * ## The tracker chain, once per run
 *
 * The public tracker is resolved through `resolveTracker`
 * (`adapters/tracker/resolve.ts`) at most once per run: when a report
 * first lists a bug `triageReport` will take to it, one with a `what`
 * and a `security` flag of `false` that is not machine-scoped and whose
 * kind the check reads as `bug`. That check is taken here before
 * `triageReport` takes it again, and both read one answer per test case
 * (`start/triage-kinds.ts`), so a report whose entries all route to a
 * repair task, the follow-up issue, the pull request's body, the store
 * or the machine channel resolves nothing. Every later report of the
 * run files through the tracker that resolution landed on. A chain that
 * landed nowhere is not tried again either: it is warned about once, and
 * each public bug of the run fails on its refusal.
 *
 * It is resolved then, rather than before the first dispatch, because a
 * resolution is not free: `github`'s preflight runs `gh auth status` and
 * `gh repo view` (`adapters/tracker/github.ts`), and every kind passed over
 * prints a `tracker chain:` warning. Resolved up front, a run whose
 * sessions report no public bug would spend both for nothing.
 *
 * A report whose bugs are all security bugs resolves nothing, so its bugs
 * meet no public tracker, not even a preflight. `triageReport` still takes
 * a public tracker, so such a report is handed `unresolvedTracker`
 * (`packages/rafa/src/ports/unresolved-tracker.ts`),
 * which refuses every call, and which `triageReport` never calls for a
 * security bug. The same stand-in carries a chain that landed nowhere: each
 * public bug then fails with the chain's own refusal as its problem, while
 * the report's blocker text and security bugs are written as ever.
 *
 * ## Stale documentation
 *
 * A `stale_docs` entry is no bug and reaches no tracker
 * (`triage/stale-docs.ts`), so it never counts towards resolving the
 * chain: a report holding only such entries is triaged, and resolves
 * nothing. Each entry is printed as one note, through `info`, naming
 * `stale_docs[<index>]`, where the stale line is and what no longer
 * matches, as stored with nothing filed.
 *
 * "Stored" is the caller's order and not a reading taken here: `start()`
 * stores the report before it hands the task over, and that write puts
 * each entry in the store's `stale_docs` table (`report/record.ts`). A
 * write that refused an entry is warned about by the store step itself;
 * this module is handed no result of it, so the note is printed either
 * way.
 *
 * ## Inherited red, read once per run
 *
 * The run-start suite baseline (`suite/baseline.ts`), the
 * `SUITE_BASELINE-<stub>.json` beside the tracker, is read once per run:
 * when the first report with something to triage arrives, since `start()`
 * records it at the first dispatch, after this triage is made. Its
 * failures, and one set of keys commented on that the whole run shares,
 * go to every `triageReport` of the run as its `inherited` option, so a
 * public bug that is one of those failures files nothing and comments at
 * most once per run on its open issue (`triage/inherited.ts`).
 *
 * A baseline that is missing, unreadable, or whose JUnit file was not read
 * (`junit` other than `read`) names no failure, and neither does a tracker
 * whose file name names no baseline: nothing is then inherited, and every
 * bug is triaged as it was before. That reading is kept for the run too;
 * the suite steps say what became of the baseline, so nothing is printed
 * here about it.
 *
 * Each inherited bug is named, by the run-start failure's file and case,
 * in its `Triage:` note and in one `inherited` loop event
 * (`start/loop-events.ts`), which the events output prints as a `rafa· `
 * line. The failure is read again from the bug as `triageReport` read it,
 * local paths taken out, and its file and case are redacted of the named
 * secrets before either line is printed.
 *
 * ## The nearest open bug
 *
 * The run's `triage.similarity` settings go to every `triageReport` as its
 * `similarity` option, so a public bug whose key finds nothing is compared
 * with the open bugs of the tracker the chain landed on
 * (`triage/triage.ts`). A recurrence found that way is noted with its score.
 *
 * ## Secrets
 *
 * The named secrets are read once, when the triage is made: `namedSecrets`
 * over the run's resolved config and the environment, `process.env` unless
 * `env` names another. `triageReport` redacts every filed text of them, and
 * this module redacts every failure it warns about.
 *
 * ## The checkout, its git and the bug record
 *
 * Every `triageReport` is handed the run's checkout
 * ({@link StartTriageOptions.checkout}, the repo root when left out), a
 * git runner in it, the environment the secrets are read from, and the
 * rules a bug record is checked against, `bugRulesOf`
 * (`config-schema-issues.ts`) over the run's resolved config, read once
 * when the triage is made. Paths are taken out over the checkout and the
 * repo root in one pass, here as in `triageReport`, so a run in a
 * worktree outside the project names neither in a filed body nor in a
 * line printed here. The store and both issue directories stay at the
 * repo root.
 *
 * ## A failure never stops the run
 *
 * The triage never rejects. A blocker text not written, a bug skipped or
 * not filed, and a reference not stored, or kept beside another, are each
 * warned about in one line ({@link describeStartTriage}), and so is
 * anything thrown, a private tracker `triageReport` refuses among them. The
 * task's commit, its tracker mark and its stored report were all settled
 * before the triage ran, so a failure here changes none of them, and the
 * loop goes on, or stops, as it would have without it.
 *
 * ## No task for a bug
 *
 * The loop never dispatches a task for an out-of-scope bug; a plan that
 * wants one fixed declares a task. A bug becomes an issue file or a
 * comment, and a stored reference, unless it is machine-scoped: that one
 * becomes a warned line here and its stored row alone
 * (`triage/triage.ts`). A `stale_docs` entry becomes a noted line here
 * and its stored row alone.
 *
 * The one line the triage adds to the tracker file is the repair task of
 * a leftover of the plan's own, `own-fallout` or `own-gap`, inserted by
 * `triage/kind-route.ts` while the plan holds fewer such repairs than
 * the cap, and each is noted here in one line naming its tracker line.
 * An entry past the cap, a `convention` and a `docs` entry are each
 * noted in one line too, as held for the follow-up issue, held for the
 * pull request's body, or stored as a stale-doc sighting.
 * A blocker's text goes onto its own task's line, escaped
 * (`writeTrackerBlocker` in `utils/tracker.ts`), so no text a session wrote
 * opens a line `findNextTask` could answer as a task.
 *
 * Every line goes through the active output (`core/output/active.ts`):
 * what was written, filed or commented on through `info`, and everything
 * that was not through `warn`.
 *
 * ## A filed bug, onto the project
 *
 * Once a report's lines are printed and its routes stored, each bug it
 * filed on the public `github` tracker is added to the repository's
 * project and filled, through `addFiledBugs`
 * (`board/project/add-filed.ts`), in the order filed. Every line that add
 * answers is printed last, as a warning under the `Triage: ` prefix,
 * redacted of the named secrets, so it follows the bug's `filed` note
 * whatever the task's own output does. Nothing is sent with
 * `board.project.number` unset, nor for a bug commented on, inherited,
 * failed, skipped, routed elsewhere, filed on another kind of tracker or
 * filed privately.
 *
 * The runner every project call goes through is
 * {@link StartTriageProjectSeams.gh}, or a `gh` runner in the repo root
 * when left out, opened retrying (`board/project/project-runner.ts`) with
 * each retry reported to the active output. It is opened at most once per
 * run, and only once a report filed a bug the add sends calls for.
 *
 * The add never rejects: a project the token may not read, a number
 * naming no project, or a refresh that failed is each a warning line, and
 * the task's tracker line and stored reference stand as the triage left
 * them. A throw from it all the same is the `nothing more was triaged`
 * warning above, never a rejection to `start()`.
 */
import type { TaskDispatch } from './dispatch.js';
import type { KindReader, StartKindOptions } from './triage-kinds.js';
import type { SuiteFailure } from '../suite/run.js';
import type { IssuesConfigSettings } from '@open-tomato/rafa/config-schema-issues';
import type { RafaConfig } from '@open-tomato/rafa/core/config';
import type { GitRunner } from '@open-tomato/rafa/core/git';
import type { IssueRef, Tracker } from '@open-tomato/rafa/ports';
import type { ReportBug, TaskReport } from '@open-tomato/rafa/report/parse';
import type { FindingOutcome, FindingsWriterSeams } from '@open-tomato/rafa/store/findings';
import type { SecretEnvironment } from '@open-tomato/rafa/triage/filed-text';
import type {
  GhRunner,
  RefreshAddedItems,
  RefreshConfig,
  ResolveTrackerOptions,
  TrackerResolution,
} from '@open-tomato/rafa-board';
import type {
  BugTriage,
  InheritedTriage,
  KindRouteOptions,
  TriageOptions,
  TriageResult,
} from '@open-tomato/rafa-pr';

import { homedir } from 'node:os';

import {
  addFiledBugs,
  createGhRunner,
  openProjectRunner,
  resolveTracker,
} from '@open-tomato/rafa-board';
import {
  blockerTextOf,
  checkedKindOf,
  inheritedFailureOf,
  scoreText,
  triageReport,
} from '@open-tomato/rafa-pr';

import { bugRulesOf } from '@open-tomato/rafa/config-schema-issues';
import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { createGitRunner } from '@open-tomato/rafa/core/git';
import { activeOutput } from '@open-tomato/rafa/core/output';
import { unresolvedTracker } from '@open-tomato/rafa/ports/unresolved-tracker';
import { parseReport } from '@open-tomato/rafa/report/parse';
import { isMachineFault } from '@open-tomato/rafa/store/machine-fault';
import { artifactOf, hasText } from '@open-tomato/rafa/triage/bug-key';
import { namedSecrets, redactSecrets } from '@open-tomato/rafa/triage/filed-text';
import { localPathRedactor } from '@open-tomato/rafa/triage/local-paths';

import { baselinePathFor, readBaseline } from '../suite/baseline.js';

import { emitLoopEvent } from './loop-events.js';
import {
  bugRouteEntriesOf,
  createKindReader,
  saidKindsOf,
  storeBugRoutes,
} from './triage-kinds.js';

/** Why the stand-in handed to a report with no public bug refuses. */
export const NOT_RESOLVED_REASON = 'start triage: no public tracker is resolved for a report with no public bug';

/** What every line this module prints opens with, after its indent. */
const LINE_PREFIX = 'Triage: ';

/** The indent every printed line takes, as the dispatch indents its own. */
const INDENT = '   ';

/** How the operator is told a recurrence was found. */
const FOUND_BY: Readonly<Record<NonNullable<BugTriage['foundBy']>, string>> = {
  store: 'its stored reference',
  find: 'a tracker find',
  similarity: 'word similarity',
};

/** How a line names what found a recurrence: {@link FOUND_BY}, then the score when it has one. */
function foundByText(bug: BugTriage): string {
  const found = FOUND_BY[bug.foundBy ?? 'find'];
  return bug.score === undefined
    ? found
    : `${found} (score ${scoreText(bug.score)})`;
}

/**
 * How the add of a filed bug reaches the project, the shape of an epic
 * action's seams; see the module note.
 */
export interface StartTriageProjectSeams {
  /** Runs every project call; a `gh` runner in the repo root when left out. */
  readonly gh?: GhRunner;
  /** The refresh of each added issue; `refreshProjectItems` when left out. */
  readonly projectRefresh?: RefreshAddedItems;
  /** The wait before a retried call and between two writes; `Bun.sleep` when left out. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** What the run's triage is made with. */
export interface StartTriageOptions {
  /** The repo root: where the store and both issue directories live, and the chain's context. */
  readonly repoRoot: string;
  /**
   * The run's resolved config: `tracker.default` and `tracker.fallback` for
   * the chain, the prerequisite tiers whose `env` items name secrets, and
   * the `triage.similarity` settings, the `issues` keys and
   * `errors.codes` the bug record's rules are read from, and the
   * `board.project` keys and the rest of what the project refresh reads,
   * for the add of each filed bug.
   */
  readonly config: Pick<
    RafaConfig,
    | 'trackerDefault'
    | 'trackerFallback'
    | 'prerequisitesRequired'
    | 'prerequisitesOptional'
    | 'triageSimilarityThreshold'
    | 'triageSimilarityCandidates'
    | 'triageSimilarityWeightsCauseLeaf'
    | 'triageSimilarityWeightsCauseFamily'
    | 'triageSimilarityWeightsBoundary'
    | keyof IssuesConfigSettings
    | 'errorsCodes'
    | keyof RefreshConfig
  >;
  /**
   * The environment the secrets' values are read from, handed to every
   * `triageReport` as its own. `process.env` when left out.
   */
  readonly env?: SecretEnvironment;
  /**
   * The checkout the run's tasks run in: the repo root, or a worktree of
   * it. Its paths are taken out of every filed and printed text with the
   * repo root's, and `triageReport` reads `Refs` in it. The repo root
   * when left out.
   */
  readonly checkout?: string;
  /** A git runner in {@link checkout}, handed to every `triageReport`. `createGitRunner(checkout)` when left out. */
  readonly git?: GitRunner;
  /** Triages one report. `triageReport` when left out; a seam for tests. */
  readonly triageReport?: (options: TriageOptions) => Promise<TriageResult>;
  /** Resolves the chain. `resolveTracker` over the core registry when left out. */
  readonly resolve?: (options: ResolveTrackerOptions) => Promise<TrackerResolution>;
  /** Where security bugs go. `triageReport`'s own, under the repo root, when left out. */
  readonly privateTracker?: Tracker;
  /** Seams for the reference write and the `bug_routes` write. */
  readonly seams?: FindingsWriterSeams;
  /**
   * The run's checkout, `pr.base` and resolved retry count, which every
   * entry is routed by its kind with (`start/triage-kinds.ts`). Left out,
   * no entry is routed by its kind, and each is triaged as before kinds
   * existed.
   */
  readonly kinds?: StartKindOptions;
  /** How each filed bug's add reaches the project; see the module note. */
  readonly project?: StartTriageProjectSeams;
}

/** One task whose report `start()` has just stored. */
export interface TaskTriageInput {
  /** The tracker file holding the task's line. */
  readonly trackerPath: string;
  /** The task's line, counting from zero, as `findNextTask` answered it. */
  readonly lineNum: number;
  /** The plan the run executes, or null when its file name gives none. */
  readonly planStub: string | null;
  /** The session's id, the task sentence the dispatch quoted, and everything the session wrote. */
  readonly dispatch: Pick<TaskDispatch, 'sessionId' | 'taskText' | 'output'>;
  /** What the loop made of the task. */
  readonly outcome: FindingOutcome;
}

/**
 * Triages one task's stored report, answering what `triageReport` did, or
 * null when nothing was triaged. Never rejects; see the module note.
 */
export type StartTriage = (input: TaskTriageInput) => Promise<TriageResult | null>;

/** What the operator is told about one triage. */
export interface StartTriageLines {
  /** What was written, filed or commented on. */
  readonly notes: readonly string[];
  /** Everything that was not, in the order it was found. */
  readonly warnings: readonly string[];
}

/** True for a bug that may reach the public tracker: a `what`, and a flag of `false`. */
function filesPublicly(bug: ReportBug): boolean {
  return bug.security === false && typeof bug.what === 'string' && bug.what.trim().length > 0;
}

/**
 * True for a bug `triageReport` will take to the public tracker: one
 * that {@link filesPublicly}, is not machine-scoped, and, with `kinds`
 * given, whose kind the check reads as `bug`. See the module note.
 */
async function routesPublicly(bug: ReportBug, kinds: KindRouteOptions | undefined): Promise<boolean> {
  if (!filesPublicly(bug) || isMachineFault(bug)) return false;
  if (kinds === undefined) return true;
  return (await checkedKindOf(bug, kinds)).kind === 'bug';
}

/** True when any of `bugs` {@link routesPublicly}, checking them one at a time. */
async function anyRoutesPublicly(bugs: readonly ReportBug[], kinds: KindRouteOptions | undefined): Promise<boolean> {
  for (const bug of bugs) {
    if (await routesPublicly(bug, kinds)) return true;
  }
  return false;
}

/** True for a report holding a blocker text, an out-of-scope bug or a `stale_docs` entry. */
function hasTriage(report: TaskReport): boolean {
  return blockerTextOf(report.blockers) !== null
    || report.outOfScopeBugs.length > 0
    || report.staleDocs.length > 0;
}

/** How a line names an issue: its URL, or its kind and id when it has none. */
function issueName(ref: IssueRef): string {
  return ref.url ?? `${ref.kind} issue ${ref.externalId}`;
}

/** How a line names a run-start failure: its file, then its case. */
function failureName(failure: SuiteFailure): string {
  return `${failure.file} > ${failure.name}`;
}

/** The note for a bug the run inherited from `failure`, naming the issue commented on, if any. */
function inheritedNote(bug: BugTriage, name: string, where: string, failure: SuiteFailure | undefined): string {
  const unnamed = bug.kind === undefined
    ? 'a red test the run started with'
    : 'a test red on the plan\'s base as on its head';
  const test = failure === undefined
    ? unnamed
    : `the run-start failure ${failureName(failure)}`;
  const comment = bug.ref === null
    ? ''
    : `, and ${issueName(bug.ref)} on ${where}, found by ${foundByText(bug)}, was commented on`;
  return `${name}: inherited: ${test}; nothing was filed${comment}.`;
}

/** What a note says became of an entry its kind routed away from every tracker. */
function settledText(bug: BugTriage): string | null {
  switch (bug.action) {
    case 'repair':
      return bug.repairLine === undefined
        ? 'a repair task was added above the next plan task'
        : `a repair task was added at tracker line ${bug.repairLine + 1}, above the next plan task`;
    case 'follow-up':
      return bug.problem === null
        ? 'held for this plan\'s follow-up issue, past its cap on repair tasks'
        : 'held for this plan\'s follow-up issue';
    case 'pr-body':
      return 'held for the pull request\'s body';
    case 'docs':
      return 'stored as a stale-doc sighting';
    default:
      return null;
  }
}

/**
 * The lines for one entry its kind routed away from every tracker: one
 * note, and its problem as a warning, which names the entry itself
 * (`triage/kind-route.ts`). Null for any other entry.
 */
function settledLines(bug: BugTriage, name: string): StartTriageLines | null {
  const text = settledText(bug);
  if (text === null) return null;
  const kind = bug.kind === undefined
    ? ''
    : ` ${bug.kind}:`;
  return {
    notes: [`${name}:${kind} ${text}; nothing was filed.`],
    warnings: bug.problem === null
      ? []
      : [bug.problem],
  };
}

/**
 * The lines for one bug: a note for an issue it reached, a failure it
 * inherited, or a route its kind took, and a warning for everything else.
 */
function bugLines(bug: BugTriage, inherited: SuiteFailure | undefined): StartTriageLines {
  const name = `out_of_scope_bugs[${bug.index}]`;
  const where = `the ${bug.channel} tracker`;

  const settled = settledLines(bug, name);
  if (settled !== null) return settled;
  if (bug.action === 'skipped') {
    return { notes: [], warnings: [`${bug.problem}; nothing was filed.`] };
  }
  if (bug.action === 'failed') {
    const warning = bug.ref === null
      ? `${name}: not filed on ${where}: ${bug.problem}`
      : `${name}: recurs in ${issueName(bug.ref)} on ${where}, not commented on: ${bug.problem}`;
    return { notes: [], warnings: [warning] };
  }

  const issue = bug.ref === null
    ? 'an issue'
    : issueName(bug.ref);
  const reached = bug.action === 'filed'
    ? `${name}: filed on ${where} as ${issue}.`
    : `${name}: recurs in ${issue} on ${where}, found by ${foundByText(bug)}; commented on it.`;
  const note = bug.action === 'inherited'
    ? inheritedNote(bug, name, where, inherited)
    : reached;
  const problem = bug.problem === null
    ? []
    : [`${name}: ${bug.problem}`];
  const conflict = bug.stored === 'conflict'
    ? [`${name}: the store keeps another reference for its artifact, in place of ${issue}.`]
    : [];
  return { notes: [note], warnings: [...problem, ...conflict] };
}

/**
 * The note for one `stale_docs` entry: its problem line, which names
 * `stale_docs[<index>]`, where the stale line is and what no longer
 * matches, already redacted and on one line (`triage/stale-docs.ts`),
 * then that it is stored and nothing was filed. See the module note for
 * what "stored" rests on.
 */
function staleDocNote(entry: BugTriage): string {
  const named = entry.problem ?? `stale_docs[${entry.index}] is stale documentation`;
  return `${named}; stored as a stale-doc row, and nothing was filed.`;
}

/**
 * What the operator is told about one triage, each line opening
 * `Triage: `: a note for the blocker text written, for each bug filed,
 * commented on or inherited, and for each `stale_docs` entry, after the
 * bugs' notes, and a warning for everything that was not.
 * `inherited` holds, by a bug's index, the run-start failure an inherited
 * bug is, which its note names. Pure, so the lines are tested beside what
 * triage did.
 */
export function describeStartTriage(
  result: TriageResult,
  inherited: ReadonlyMap<number, SuiteFailure> = new Map(),
): StartTriageLines {
  const { blocker } = result;
  const blockerNotes = blocker.written
    ? ['blockers: written onto the task line, for the next dispatch of this task.']
    : [];
  const blockerWarnings = blocker.problem === null
    ? []
    : [`blockers: ${blocker.problem}`];
  const bugs = result.bugs.map((bug) => bugLines(bug, inherited.get(bug.index)));
  const prefixed = (lines: readonly string[]): string[] => lines.map((line) => `${LINE_PREFIX}${line}`);
  return {
    notes: prefixed([
      ...blockerNotes,
      ...bugs.flatMap((lines) => lines.notes),
      ...result.staleDocs.map(staleDocNote),
    ]),
    warnings: prefixed([...blockerWarnings, ...bugs.flatMap((lines) => lines.warnings)]),
  };
}

/**
 * Resolves the chain once, printing where public bugs go, and answers the
 * tracker it landed on, or the stand-in carrying its refusal.
 */
async function resolvePublicTracker(
  options: StartTriageOptions,
  redact: (text: string) => string,
): Promise<Tracker> {
  const resolve = options.resolve ?? resolveTracker;
  try {
    const { tracker, attempts } = await resolve({
      config: options.config,
      context: { repoRoot: options.repoRoot },
    });
    const passed = attempts.filter((attempt) => !attempt.ok).map((attempt) => `\`${attempt.kind}\``);
    const fallback = passed.length === 0
      ? ''
      : `, having passed over ${passed.join(', ')}`;
    activeOutput().info(`${INDENT}${LINE_PREFIX}public bugs of this run go to the \`${tracker.kind}\` tracker${fallback}.`);
    return tracker;
  } catch (error) {
    const reason = messageOf(error);
    activeOutput().warn(`${INDENT}${LINE_PREFIX}no tracker resolved, so no public bug of this run is filed: ${redact(reason)}`);
    return unresolvedTracker(options.config.trackerDefault, reason);
  }
}

/** The baseline file beside `trackerPath`, or null for a file name no baseline is named from. */
function baselinePathOrNull(trackerPath: string): string | null {
  try {
    return baselinePathFor(trackerPath);
  } catch {
    return null;
  }
}

/**
 * The failures of the run-start suite baseline beside `trackerPath`, as
 * `readBaseline` reads them: none when the file is missing or unreadable,
 * when its JUnit file was not read, or when the tracker's name names no
 * baseline. See the module note.
 */
export function runStartFailures(trackerPath: string): readonly SuiteFailure[] {
  const path = baselinePathOrNull(trackerPath);
  const reading = path === null
    ? null
    : readBaseline(path);
  return reading?.state === 'read' && reading.baseline.junit === 'read'
    ? reading.baseline.failures
    : [];
}

/**
 * The run-start failure each inherited bug of `result` is, by its index,
 * read again as `triageReport` read it: from the bug's `what` and artifact
 * with local paths taken out. File and case are redacted by `redact`.
 */
function inheritedByIndex(
  result: TriageResult,
  report: TaskReport,
  failures: readonly SuiteFailure[],
  local: (text: string) => string,
  redact: (text: string) => string,
): ReadonlyMap<number, SuiteFailure> {
  const named = result.bugs.flatMap((bug): (readonly [number, SuiteFailure])[] => {
    const reported = report.outOfScopeBugs[bug.index];
    if (bug.action !== 'inherited' || reported === undefined || !hasText(reported.what)) return [];
    const artifact = artifactOf(reported);
    const failure = inheritedFailureOf({
      what: local(reported.what),
      artifact: artifact === null
        ? null
        : local(artifact),
    }, failures);
    return failure === null
      ? []
      : [[bug.index, { file: redact(failure.file), name: redact(failure.name) }]];
  });
  return new Map(named);
}

/**
 * Makes the triage of one run: the chain unresolved, the secrets named,
 * the run-start baseline not yet read. See the module note.
 */
export function createStartTriage(options: StartTriageOptions): StartTriage {
  const env = options.env ?? process.env;
  const secrets = namedSecrets(options.config, env);
  const redact = (text: string): string => redactSecrets(text, secrets);
  const checkout = options.checkout ?? options.repoRoot;
  const local = localPathRedactor([checkout, options.repoRoot], homedir());
  const git = options.git ?? createGitRunner(checkout);
  const bugRules = bugRulesOf(options.config);
  const triage = options.triageReport ?? triageReport;
  const kindReader: KindReader | null = options.kinds === undefined
    ? null
    : createKindReader(options.kinds);
  let publicTracker: Promise<Tracker> | null = null;
  let inherited: InheritedTriage | null = null;
  let projectGh: GhRunner | null = null;
  const project = options.project ?? {};

  const openProjectGh = (): GhRunner => {
    projectGh ??= openProjectRunner(project.gh ?? createGhRunner({ cwd: options.repoRoot }), options.config, project.sleep === undefined
      ? {}
      : { sleep: project.sleep });
    return projectGh;
  };

  const addToProject = (result: TriageResult): Promise<readonly string[]> => addFiledBugs({
    config: options.config,
    openGh: openProjectGh,
    ...(project.projectRefresh === undefined
      ? {}
      : { refresh: project.projectRefresh }),
    ...(project.sleep === undefined
      ? {}
      : { sleep: project.sleep }),
  }, result);

  const inheritedFor = (trackerPath: string): InheritedTriage => {
    inherited ??= { failures: runStartFailures(trackerPath), commented: new Set() };
    return inherited;
  };

  const trackerFor = async (report: TaskReport, kinds: KindRouteOptions | undefined): Promise<Tracker> => {
    if (!await anyRoutesPublicly(report.outOfScopeBugs, kinds)) {
      return unresolvedTracker(options.config.trackerDefault, NOT_RESOLVED_REASON);
    }
    publicTracker ??= resolvePublicTracker(options, redact);
    return publicTracker;
  };

  const dispatchOf = (input: TaskTriageInput) => ({
    sessionId: input.dispatch.sessionId,
    planStub: input.planStub,
    taskLine: input.dispatch.taskText,
  });

  const triageTask = async (input: TaskTriageInput): Promise<TriageResult | null> => {
    const reading = parseReport(input.dispatch.output);
    if (!reading.present || !hasTriage(reading.report)) return null;

    const { report } = reading;
    const run = inheritedFor(input.trackerPath);
    const kinds = kindReader === null || report.outOfScopeBugs.length === 0
      ? undefined
      : kindReader();
    const dispatch = dispatchOf(input);
    const result = await triage({
      repoRoot: options.repoRoot,
      trackerPath: input.trackerPath,
      lineNum: input.lineNum,
      dispatch,
      outcome: input.outcome,
      report,
      tracker: await trackerFor(report, kinds),
      privateTracker: options.privateTracker,
      secrets,
      seams: options.seams,
      inherited: run,
      similarity: options.config,
      kinds,
      checkout,
      git,
      env,
      bugRules,
    });

    const routes = bugRouteEntriesOf(result, report, saidKindsOf(reading.block.body));
    const unstored = storeBugRoutes(options.repoRoot, dispatch, routes, options.seams);
    const named = inheritedByIndex(result, report, run.failures, local, redact);
    const { notes, warnings } = describeStartTriage(result, named);
    for (const note of notes) activeOutput().info(`${INDENT}${note}`);
    for (const warning of warnings) activeOutput().warn(`${INDENT}${warning}`);
    for (const warning of unstored) activeOutput().warn(`${INDENT}${LINE_PREFIX}${redact(warning)}`);
    for (const failure of named.values()) emitLoopEvent({ kind: 'inherited', file: failure.file, name: failure.name });
    const added = await addToProject(result);
    for (const warning of added) activeOutput().warn(`${INDENT}${LINE_PREFIX}${redact(warning)}`);
    return result;
  };

  return async (input) => {
    try {
      return await triageTask(input);
    } catch (error) {
      activeOutput().warn(`${INDENT}${LINE_PREFIX}nothing more was triaged for this task: ${redact(messageOf(error))}`);
      return null;
    }
  };
}
