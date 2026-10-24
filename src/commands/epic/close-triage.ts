/**
 * The filing of `rafa epic close` (`./close.ts`), step 7 of its module
 * note: every check that answered `fail` is filed through `triageReport`
 * (`src/triage/triage.ts`) or, when its criterion names only
 * documentation, sent to the `docs` channel (`./close-docs.ts`).
 * {@link fileFailures} runs it, reading only the part of the close's run
 * it needs, {@link FilingRun}.
 *
 * ## Filing a failed check
 *
 * Each failed check is one report of its own, holding one bug and no
 * blocker, handed to `triageReport` with the check session's id, since
 * that session is where the evidence came from, and `failed` as the
 * outcome. The bug is `security: false` and `kind: bug`, its module
 * `epic`, its action `close`, its reproduce `rafa epic close <n>` and no
 * cause: a criterion that does not hold is a product bug, so it goes to
 * the public tracker the chain resolves, resolved once and only when a
 * check failed
 * (`resolveTracker`, with `unresolvedTracker` from
 * `packages/rafa/src/ports/unresolved-tracker.ts`
 * standing in for a chain that landed nowhere, so each bug then fails
 * with its refusal). Its
 * `what` names the epic and the criterion, and its `artifact` is
 * {@link failedCheckArtifact}: the epic and the criterion's text on one
 * line, which is what stays the same when the close is run again. The
 * recurrence key is that artifact, stripped of its numbers as
 * `src/triage/bug-key.ts` strips it, after {@link closeTriageFile}'s base
 * name, which keeps the epic's number, so a second close failing the same
 * criterion comments on the first issue rather than filing another, unless
 * that issue was closed as completed, when a new one is filed in its place
 * (`src/triage/triage.ts`). A criterion whose key finds nothing is compared
 * with the open bugs by its words, as the run's `triage.similarity` settings
 * say, and comments on the nearest at the threshold. No file is read or written at
 * that path: the report carries no blocker, and a blocker is the only
 * thing `triageReport` writes into its tracker file. The feedback holds
 * the check, the commit and the evidence. Triage is handed the project
 * root as the checkout, the git runner the run reads `origin/main` with
 * (`EpicCloseSeams.git`), the command's environment and the bug
 * record's rules, `bugRulesOf` over the run's config. When #249's
 * ladder lands it routes these bugs; until then they are filed as out-of-scope bugs are.
 *
 * Each bug triage answers is one line, {@link bugLine}, at `info` or
 * `warn` as the line says; a chain that resolved nothing and a triage
 * that threw are each a `warn` line, and the next criterion is filed all
 * the same.
 *
 * ## A filed bug, onto the project
 *
 * Once a failure's {@link bugLine} lines are written, the bug it filed on
 * the public `github` tracker is added to the repository's project and
 * filled, through `addFiledBugs` (`src/board/project/add-filed.ts`), and
 * every line that add answers is written at `warn`, after those lines and
 * before the next criterion is filed. Nothing is sent with
 * `board.project.number` unset, nor for a bug commented on, inherited,
 * failed, skipped, routed elsewhere or filed on a tracker of another
 * kind; a docs-only failure files no bug, so it sends nothing either.
 *
 * The runner every project call goes through is the close's `gh` seam,
 * or a `gh` runner in the project root when left out, opened retrying as
 * `./epic-project.ts` opens it (`openProjectRunner` with
 * `commandRetrySeams` over the command's output, its mode and the
 * `sleep` seam), at most once per run and only once a bug is to be
 * added. The `sleep` seam is also the add's pause between writes. A
 * planted `projectRefresh` seam is the refresh of each added issue,
 * handed the issues and the widening the add asks for and not the
 * add's known item, which an epic action's refresh does not take; left
 * out, the add's own refresh fills the issue from that item.
 *
 * The add never rejects: a token without the `project` scope, a number
 * naming no project, or a refresh that failed is each a warning line,
 * and the close's exit code and its own lines stand as without it. A
 * throw from it all the same is one `warn` line,
 * `Criterion <n>: filed, but not added to the project: <message>`.
 *
 * A failed check whose criterion's text names only documentation
 * (`namesOnlyDocs`, `packages/rafa/src/triage/doc-only.ts`) is no bug: in place of the
 * report it is one `unsettled` stale-docs row with no plan stub and one
 * line on the release's stale-docs issue, on the same tracker, the
 * version read once per run (`EpicCloseSeams.staleDocsVersion`).
 * `./close-docs.ts` says what is stored and written.
 */
import type { EpicCloseSeams } from './close.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { AddIssueOptions, RefreshAddedItems } from '../../board/project/add-issue.js';
import type { EpicCriterion } from '../../epic/verify-plan.js';
import type { CheckAnswered } from '../../epic/verify-run.js';
import type { BugTriage, TriageResult } from '../../triage/triage.js';
import type { RafaContext } from '@open-tomato/rafa/core/command';
import type { RafaConfig } from '@open-tomato/rafa/core/config';
import type { IssueRef, Tracker } from '@open-tomato/rafa/ports';
import type { TaskReport } from '@open-tomato/rafa/report/parse';
import type { NamedSecret } from '@open-tomato/rafa/triage/filed-text';

import { join } from 'node:path';

import { bugRulesOf } from '@open-tomato/rafa/config-schema-issues';
import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { createGitRunner } from '@open-tomato/rafa/core/git';
import { unresolvedTracker } from '@open-tomato/rafa/ports/unresolved-tracker';
import { namedSecrets, redactSecrets } from '@open-tomato/rafa/triage/filed-text';
import { localPathRedactor } from '@open-tomato/rafa/triage/local-paths';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { resolveTracker } from '../../adapters/tracker/resolve.js';
import { addFiledBugs } from '../../board/project/add-filed.js';
import { commandRetrySeams, openProjectRunner } from '../../board/project/project-runner.js';
import { readStaleDocsVersion } from '../../start/stale-docs.js';
import { triageReport } from '../../triage/triage.js';

import { isDocsOnlyCriterion, routeDocsOnlyFailure } from './close-docs.js';

/** The seams the filing reads off the close's. */
export type FilingSeams = Pick<
  EpicCloseSeams,
  'findings' | 'gh' | 'git' | 'privateTracker' | 'projectRefresh' | 'resolve' | 'sleep' | 'staleDocsVersion' | 'triageReport'
>;

/** The part of the close's run the filing reads. */
export interface FilingRun {
  readonly context: Pick<RafaContext, 'env' | 'output' | 'outputMode'>;
  readonly root: string;
  readonly home: string;
  readonly config: RafaConfig;
  readonly seams: FilingSeams;
}

/** `#40`. */
function ref(issue: number): string {
  return `#${String(issue)}`;
}

/** Text on one line, every run of whitespace one space. */
function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
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
      kind: 'bug',
      module: 'epic',
      action: 'close',
      reproduce: `rafa epic close ${String(epic)}`,
      cause: null,
      extras: [],
    })],
    changes: [],
    staleDocs: [],
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
    case 'inherited': {
      return { text: `${which}: not filed: a test failure the run started with.`, warn: false };
    }
    case 'skipped': {
      return { text: `${which}: not filed: ${bug.problem ?? 'no reason given'}.`, warn: true };
    }
    case 'failed': {
      return { text: `${which}: not filed on the ${bug.channel} tracker: ${bug.problem ?? 'no reason given'}`, warn: true };
    }
    case 'repair':
    case 'follow-up':
    case 'pr-body':
    case 'docs': {
      // Answered only by kind routing, which this run never turns on.
      return { text: `${which}: not filed: routed to ${bug.action} by its kind.`, warn: true };
    }
  }
}

/** Writes `text` at `warn` when `warn` is set, at `info` otherwise. */
function write(run: FilingRun, line: { readonly text: string; readonly warn: boolean }): void {
  if (line.warn) run.context.output.warn(line.text);
  else run.context.output.info(line.text);
}

/**
 * What the add of each filed bug is made with: the runner opened retrying
 * at most once per run, and the `projectRefresh` seam, when planted, as
 * the refresh; see the module note.
 */
function addOptionsOf(run: FilingRun): AddIssueOptions {
  const { seams } = run;
  let gh: GhRunner | null = null;
  const openGh = (): GhRunner => {
    gh ??= openProjectRunner(
      seams.gh ?? createGhRunner({ cwd: run.root }),
      run.config,
      commandRetrySeams(run.context.output, run.context.outputMode, seams.sleep),
    );
    return gh;
  };
  const planted = seams.projectRefresh;
  // The epic actions' refresh takes no known items, so the add's is dropped.
  const refresh: RefreshAddedItems | undefined = planted === undefined
    ? undefined
    : (options, issues, widening) => planted(options, issues, widening);
  return {
    config: run.config,
    openGh,
    ...(refresh === undefined
      ? {}
      : { refresh }),
    ...(seams.sleep === undefined
      ? {}
      : { sleep: seams.sleep }),
  };
}

/** Adds the bugs `result` filed on the public `github` tracker to the project, each line at `warn`; never rejects. */
async function addToProject(run: FilingRun, add: AddIssueOptions, criterion: EpicCriterion, result: TriageResult): Promise<void> {
  try {
    for (const line of await addFiledBugs(add, result)) run.context.output.warn(line);
  } catch (error) {
    run.context.output.warn(`Criterion ${String(criterion.number)}: filed, but not added to the project: ${messageOf(error)}`);
  }
}

/** Files each failed check through `triageReport`, the public tracker resolved once; see the module note. */
export async function fileFailures(run: FilingRun, epic: number, failures: readonly CheckAnswered[], commit: string): Promise<void> {
  const secrets: readonly NamedSecret[] = namedSecrets(run.config, run.context.env);
  let tracker: Tracker;
  try {
    const resolved = await (run.seams.resolve ?? resolveTracker)({ config: run.config, context: { repoRoot: run.root } });
    tracker = resolved.tracker;
  } catch (error) {
    run.context.output.warn(`No tracker resolved, so no failed check is filed: ${messageOf(error)}`);
    tracker = unresolvedTracker(run.config.trackerDefault, messageOf(error));
  }
  const local = localPathRedactor([run.root], run.home);
  const git = run.seams.git ?? createGitRunner(run.root);
  const bugRules = bugRulesOf(run.config);
  const triage = run.seams.triageReport ?? triageReport;
  const add = addOptionsOf(run);
  let version: string | null = null;
  const docs = {
    repoRoot: run.root, epic, tracker, seams: run.seams.findings,
    redact: (text: string): string => local(redactSecrets(text, secrets)),
    version: (): string => version ??= (run.seams.staleDocsVersion ?? (() => readStaleDocsVersion({ repoRoot: run.root, checkout: run.root, config: run.config })))(),
  };
  for (const failure of failures) {
    const { criterion } = failure.check;
    if (isDocsOnlyCriterion(criterion)) {
      for (const line of await routeDocsOnlyFailure({ ...docs, criterion, sessionId: failure.sessionId })) write(run, line);
      continue;
    }
    try {
      const result = await triage({
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
        similarity: run.config,
        checkout: run.root,
        git,
        env: run.context.env,
        bugRules,
      });
      for (const bug of result.bugs) write(run, bugLine(criterion, bug));
      await addToProject(run, add, criterion, result);
    } catch (error) {
      run.context.output.warn(`Criterion ${String(criterion.number)}: not filed: ${messageOf(error)}`);
    }
  }
}
