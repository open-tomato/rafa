/**
 * Loop-owned triage in `loop start`: what the run does with a task
 * report's blockers and out-of-scope bugs once the report is stored and
 * the task's tracker line is marked.
 *
 * `start()` makes one {@link StartTriage} per run through
 * {@link createStartTriage}, before its first dispatch, and hands it each
 * task right after `storeTaskReport` (`start/dispatch.ts`), whatever became
 * of the task: done, blocked, failed or interrupted. The triage reads the
 * session's output with `parseReport`, as the store did, and hands the
 * report to `triageReport` (`triage/triage.ts`), which writes the blocker
 * text onto the task's line and files, or comments on, each out-of-scope
 * bug. An output with no report, and a report with no blocker text and no
 * out-of-scope bug, are left alone: nothing is resolved, called or printed.
 *
 * ## The tracker chain, once per run
 *
 * The public tracker is resolved through `resolveTracker`
 * (`adapters/tracker/resolve.ts`) at most once per run: when a report
 * first lists a bug `triageReport` may take to it, one with a `what`
 * and a `security` flag of `false`. A machine-scoped bug carries that
 * shape and reaches no tracker at all (`triage/triage.ts`), so a report
 * whose only such bug is that one resolves a chain it then files
 * nothing to. Every later report of the run files
 * through the tracker that resolution landed on. A chain that landed
 * nowhere is not tried again either: it is warned about once, and each
 * public bug of the run fails on its refusal.
 *
 * It is resolved then, rather than before the first dispatch, because a
 * resolution is not free: `github`'s preflight runs `gh auth status` and
 * `gh repo view` (`adapters/tracker/github.ts`), and every kind passed over
 * prints a `tracker chain:` warning. Resolved up front, a run whose
 * sessions report no public bug would spend both for nothing.
 *
 * A report whose bugs are all security bugs resolves nothing, so its bugs
 * meet no public tracker, not even a preflight. `triageReport` still takes
 * a public tracker, so such a report is handed {@link unresolvedTracker},
 * which refuses every call, and which `triageReport` never calls for a
 * security bug. The same stand-in carries a chain that landed nowhere: each
 * public bug then fails with the chain's own refusal as its problem, while
 * the report's blocker text and security bugs are written as ever.
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
 * ## Secrets
 *
 * The named secrets are read once, when the triage is made: `namedSecrets`
 * over the run's resolved config and the environment, `process.env` unless
 * `env` names another. `triageReport` redacts every filed text of them, and
 * this module redacts every failure it warns about.
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
 * wants one fixed declares a task. Nothing here adds a line to the tracker
 * file. A bug becomes an issue file or a comment, and a stored reference,
 * unless it is machine-scoped: that one becomes a warned line here and
 * its stored row alone (`triage/triage.ts`).
 * A blocker's text goes onto its own task's line, escaped
 * (`writeTrackerBlocker` in `utils/tracker.ts`), so no text a session wrote
 * opens a line `findNextTask` could answer as a task.
 *
 * Every line goes through the active output (`adapters/output/active.ts`):
 * what was written, filed or commented on through `info`, and everything
 * that was not through `warn`.
 */
import type { ResolveTrackerOptions, TrackerResolution } from '../adapters/tracker/resolve.js';
import type { RafaConfig } from '../config.js';
import type { TaskDispatch } from './dispatch.js';
import type { FindingOutcome, FindingsWriterSeams } from '../effort/store/findings.js';
import type { IssueRef, Tracker, TrackerKind } from '../ports/index.js';
import type { ReportBug, TaskReport } from '../report/parse.js';
import type { SuiteFailure } from '../suite/run.js';
import type { InheritedTriage } from '../triage/inherited.js';
import type { BugTriage, SecretEnvironment, TriageResult } from '../triage/triage.js';

import { homedir } from 'node:os';

import { activeOutput } from '../adapters/output/active.js';
import { resolveTracker } from '../adapters/tracker/resolve.js';
import { messageOf } from '../config-sections.js';
import { parseReport } from '../report/parse.js';
import { baselinePathFor, readBaseline } from '../suite/baseline.js';
import { artifactOf, hasText } from '../triage/bug-key.js';
import { inheritedFailureOf } from '../triage/inherited.js';
import { localPathRedactor } from '../triage/local-paths.js';
import {
  blockerTextOf,
  namedSecrets,
  redactSecrets,
  triageReport,
} from '../triage/triage.js';

import { emitLoopEvent } from './loop-events.js';

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
};

/** What the run's triage is made with. */
export interface StartTriageOptions {
  /** The repo root: where the store and both issue directories live, and the chain's context. */
  readonly repoRoot: string;
  /**
   * The run's resolved config: `tracker.default` and `tracker.fallback` for
   * the chain, and the prerequisite tiers whose `env` items name secrets.
   */
  readonly config: Pick<
    RafaConfig,
    'trackerDefault' | 'trackerFallback' | 'prerequisitesRequired' | 'prerequisitesOptional'
  >;
  /** The environment the secrets' values are read from. `process.env` when left out. */
  readonly env?: SecretEnvironment;
  /** Resolves the chain. `resolveTracker` over the core registry when left out. */
  readonly resolve?: (options: ResolveTrackerOptions) => Promise<TrackerResolution>;
  /** Where security bugs go. `triageReport`'s own, under the repo root, when left out. */
  readonly privateTracker?: Tracker;
  /** Seams for the reference write. */
  readonly seams?: FindingsWriterSeams;
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

/**
 * A tracker standing in for one the run did not resolve: its preflight
 * answers `reason`, and every other call rejects with it. See the module
 * note.
 */
export function unresolvedTracker(kind: TrackerKind, reason: string): Tracker {
  const refuse = (): Promise<never> => Promise.reject(new Error(reason));
  return Object.freeze({
    kind,
    capabilities: () => ({ projects: false, customFields: false, issueTypes: false }),
    preflight: () => Promise.resolve({ ok: false as const, reason }),
    find: refuse,
    get: refuse,
    create: refuse,
    comment: refuse,
    transition: refuse,
  });
}

/**
 * True for a bug that may reach the public tracker: a `what`, and a flag
 * of `false`. Not every one of them does, since `triageReport` keeps a
 * machine-scoped bug off every tracker (`triage/triage.ts`); the reading
 * is the module note's, and is not taken again here.
 */
function filesPublicly(bug: ReportBug): boolean {
  return bug.security === false && typeof bug.what === 'string' && bug.what.trim().length > 0;
}

/** True for a report holding a blocker text or an out-of-scope bug. */
function hasTriage(report: TaskReport): boolean {
  return blockerTextOf(report.blockers) !== null || report.outOfScopeBugs.length > 0;
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
  const test = failure === undefined
    ? 'a red test the run started with'
    : `the run-start failure ${failureName(failure)}`;
  const comment = bug.ref === null
    ? ''
    : `, and ${issueName(bug.ref)} on ${where}, found by ${FOUND_BY[bug.foundBy ?? 'find']}, was commented on`;
  return `${name}: inherited: ${test}; nothing was filed${comment}.`;
}

/**
 * The lines for one bug: a note for an issue it reached or a failure it
 * inherited, and a warning for everything else.
 */
function bugLines(bug: BugTriage, inherited: SuiteFailure | undefined): StartTriageLines {
  const name = `out_of_scope_bugs[${bug.index}]`;
  const where = `the ${bug.channel} tracker`;

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
    : `${name}: recurs in ${issue} on ${where}, found by ${FOUND_BY[bug.foundBy ?? 'find']}; commented on it.`;
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
 * What the operator is told about one triage, each line opening
 * `Triage: `: a note for the blocker text written and for each bug filed,
 * commented on or inherited, and a warning for everything that was not.
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
    notes: prefixed([...blockerNotes, ...bugs.flatMap((lines) => lines.notes)]),
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
  const secrets = namedSecrets(options.config, options.env ?? process.env);
  const redact = (text: string): string => redactSecrets(text, secrets);
  const local = localPathRedactor(options.repoRoot, homedir());
  let publicTracker: Promise<Tracker> | null = null;
  let inherited: InheritedTriage | null = null;

  const inheritedFor = (trackerPath: string): InheritedTriage => {
    inherited ??= { failures: runStartFailures(trackerPath), commented: new Set() };
    return inherited;
  };

  const trackerFor = (report: TaskReport): Promise<Tracker> => {
    if (!report.outOfScopeBugs.some(filesPublicly)) {
      return Promise.resolve(unresolvedTracker(options.config.trackerDefault, NOT_RESOLVED_REASON));
    }
    publicTracker ??= resolvePublicTracker(options, redact);
    return publicTracker;
  };

  const triageTask = async (input: TaskTriageInput): Promise<TriageResult | null> => {
    const reading = parseReport(input.dispatch.output);
    if (!reading.present || !hasTriage(reading.report)) return null;

    const { report } = reading;
    const run = inheritedFor(input.trackerPath);
    const result = await triageReport({
      repoRoot: options.repoRoot,
      trackerPath: input.trackerPath,
      lineNum: input.lineNum,
      dispatch: {
        sessionId: input.dispatch.sessionId,
        planStub: input.planStub,
        taskLine: input.dispatch.taskText,
      },
      outcome: input.outcome,
      report,
      tracker: await trackerFor(report),
      privateTracker: options.privateTracker,
      secrets,
      seams: options.seams,
      inherited: run,
    });

    const named = inheritedByIndex(result, report, run.failures, local, redact);
    const { notes, warnings } = describeStartTriage(result, named);
    for (const note of notes) activeOutput().info(`${INDENT}${note}`);
    for (const warning of warnings) activeOutput().warn(`${INDENT}${warning}`);
    for (const failure of named.values()) emitLoopEvent({ kind: 'inherited', file: failure.file, name: failure.name });
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
