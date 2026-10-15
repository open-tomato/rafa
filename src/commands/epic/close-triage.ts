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
 * (`resolveTracker`, with `unresolvedTracker` from `src/start/triage.ts`
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
 * A failed check whose criterion's text names only documentation
 * (`namesOnlyDocs`, `src/triage/doc-only.ts`) is no bug: in place of the
 * report it is one `unsettled` stale-docs row with no plan stub and one
 * line on the release's stale-docs issue, on the same tracker, the
 * version read once per run (`EpicCloseSeams.staleDocsVersion`).
 * `./close-docs.ts` says what is stored and written.
 */
import type { EpicCloseSeams } from './close.js';
import type { RafaContext } from '../../core/command/index.js';
import type { RafaConfig } from '../../core/config/index.js';
import type { EpicCriterion } from '../../epic/verify-plan.js';
import type { CheckAnswered } from '../../epic/verify-run.js';
import type { IssueRef, Tracker } from '../../ports/index.js';
import type { TaskReport } from '../../report/parse.js';
import type { BugTriage, NamedSecret } from '../../triage/triage.js';

import { join } from 'node:path';

import { resolveTracker } from '../../adapters/tracker/resolve.js';
import { bugRulesOf } from '../../config-schema-issues.js';
import { messageOf } from '../../core/config/sections.js';
import { createGitRunner } from '../../core/git/index.js';
import { readStaleDocsVersion } from '../../start/stale-docs.js';
import { unresolvedTracker } from '../../start/triage.js';
import { localPathRedactor } from '../../triage/local-paths.js';
import { namedSecrets, redactSecrets, triageReport } from '../../triage/triage.js';

import { isDocsOnlyCriterion, routeDocsOnlyFailure } from './close-docs.js';

/** The seams the filing reads off the close's. */
export type FilingSeams = Pick<EpicCloseSeams, 'findings' | 'git' | 'privateTracker' | 'resolve' | 'staleDocsVersion' | 'triageReport'>;

/** The part of the close's run the filing reads. */
export interface FilingRun {
  readonly context: Pick<RafaContext, 'env' | 'output'>;
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
    } catch (error) {
      run.context.output.warn(`Criterion ${String(criterion.number)}: not filed: ${messageOf(error)}`);
    }
  }
}
