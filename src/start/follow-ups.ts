/**
 * The plan's follow-up issue: one `bug` issue per plan holding, one line
 * each, the leftovers of the plan's own (`own-fallout`, `own-gap`) that
 * the triage held past the plan's cap on repair tasks
 * (`triage/kind-route.ts`). {@link fileFollowUps} writes it once, after
 * the last task, from `start/wrap-up-run.ts`.
 *
 * ## The lines
 *
 * The plan's `bug_routes` rows (`readBugRoutesForPlan`,
 * `effort/store/bug-routes.ts`) routed `follow-up` are the lines, in
 * append order, one per text: two rows that read as the same line, from
 * two sessions of one task, are one. Each is {@link followUpLine},
 * `- <kind>: <what>`. A plan with no such row has no follow-up issue:
 * nothing is resolved, called or printed.
 *
 * `what` is a session's text and stored as it reported it, so each line
 * is redacted before it is built, since the issue is public: of the
 * run's named secrets (`namedSecrets` over the config's prerequisite
 * tiers and the environment) first, then of local paths under the
 * project root, the checkout and the home directory. It is then escaped
 * as `escapeBlockerText` (`utils/tracker.ts`) escapes a blocker, so a
 * line break is written `\n` and no entry opens a second line, an HTML
 * comment, or a marker of its own. An entry whose `security` flag was
 * true or missing never reaches a `follow-up` row: it took the private
 * channel (`triage/kind-route.ts`).
 *
 * ## The issue
 *
 * Titled {@link followUpsTitle}, `Follow-ups of <stub>`, of type `bug`,
 * its body opening with {@link followUpsMarker},
 * `<!-- rafa:follow-ups <stub> -->`, which tells it from a person's issue
 * of the same title. It is found by `tracker.openIssues('bug')`, kept to
 * the bodies holding the marker, then the first whose title is the title
 * exactly.
 *
 *   - Found: the lines its body does not already hold, each compared
 *     with every body line trimmed, go below its last line, and the body
 *     is written back whole through `tracker.edit` (the port's `edit`
 *     writes a body whole). A body holding every line is left alone: the
 *     answer is `held` and nothing is written, so a second wrap-up of
 *     the same plan, a resumed run's included, adds no duplicate.
 *   - Not found: `tracker.create` with the marker, one opening sentence
 *     and the lines.
 *
 * ## No tracker that can hold it
 *
 * The tracker is the run's chain (`resolveTracker`), resolved only once
 * a line exists, since a resolution runs `gh auth status` and
 * `gh repo view` for `github`. A chain that lands nowhere, or on a
 * tracker with no `edit` or no `openIssues`, creates nothing: with no
 * `edit` the issue found by a later run could not be appended to, and
 * with no `openIssues` it could never be found again, so each run would
 * open one more. The lines are then printed once, under one heading
 * naming the issue they would have gone to.
 *
 * ## A failure never stops the run
 *
 * {@link fileFollowUps} never rejects. A store that cannot be read, a
 * listing, a create or an edit the tracker refuses, and anything thrown
 * are each one warning line, redacted. The rows stay in the store, so
 * the next wrap-up of the plan files them again.
 *
 * Every line goes through the active output (`core/output/active.ts`):
 * what was written and the print through `info`, a failure through
 * `warn`.
 */
import type { RafaConfig } from '@open-tomato/rafa/core/config';
import type { IssueDraft, IssueRef, OpenIssue, Tracker } from '@open-tomato/rafa/ports';
import type { BugRouteRow } from '@open-tomato/rafa/store/bug-routes';
import type { ResolveTrackerOptions, TrackerResolution } from '@open-tomato/rafa-board';
import type { SecretEnvironment } from '@open-tomato/rafa-pr';

import { homedir } from 'node:os';

import { resolveTracker } from '@open-tomato/rafa-board';
import {
  TRIAGE_MODULE,
  localPathRedactor,
  namedSecrets,
  redactSecrets,
} from '@open-tomato/rafa-pr';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { activeOutput } from '@open-tomato/rafa/core/output';
import { escapeBlockerText } from '@open-tomato/rafa/core/plan';
import { readBugRoutesForPlan } from '@open-tomato/rafa/store/bug-routes';

/** What every line this module prints opens with, after its indent. */
const LINE_PREFIX = 'Follow-ups: ';

/** The indent every printed line takes, as the dispatch indents its own. */
const INDENT = '   ';

/** The sentence a new issue's body holds under the marker, above its lines. */
export const FOLLOW_UPS_OPENING: string = 'What this plan broke or left unfinished in its own work, '
  + 'past its cap on repair tasks. Each line names the kind the loop read and what was reported.';

/** Why the lines are printed rather than filed. */
export const NO_EDITABLE_TRACKER = 'no tracker resolved that can list and edit issues';

/** The title of the follow-up issue of the plan `stub`. */
export function followUpsTitle(stub: string): string {
  return `Follow-ups of ${stub}`;
}

/** The comment the follow-up issue of `stub` holds, which marks it as the plan's. */
export function followUpsMarker(stub: string): string {
  return `<!-- rafa:follow-ups ${stub} -->`;
}

/** What one line is built from: the kind the loop read and the reported text. */
export type FollowUpEntry = Pick<BugRouteRow, 'kind' | 'what'>;

/**
 * One line of the issue, `- <kind>: <what>`, `what` escaped as
 * `escapeBlockerText` escapes a blocker. Redacting is the caller's, who
 * knows the secrets and the roots: the text is written as handed.
 */
export function followUpLine(entry: FollowUpEntry): string {
  return `- ${entry.kind}: ${escapeBlockerText(entry.what.trim())}`;
}

/**
 * The lines of `rows` routed `follow-up`, each redacted by `redact` and
 * built by {@link followUpLine}, in row order, one per text.
 */
export function followUpLines(
  rows: readonly BugRouteRow[],
  redact: (text: string) => string = (text) => text,
): string[] {
  const lines = rows
    .filter((row) => row.route === 'follow-up')
    .map((row) => followUpLine({ kind: row.kind, what: redact(row.what) }));
  return [...new Set(lines)];
}

/** The body of a new follow-up issue of `stub` holding `lines`. */
export function followUpsBody(stub: string, lines: readonly string[]): string {
  return `${followUpsMarker(stub)}\n\n${FOLLOW_UPS_OPENING}\n\n${lines.join('\n')}\n`;
}

/** True when a line of `body`, trimmed, is `line`. */
function bodyHolds(body: string, line: string): boolean {
  return body.split(/\r?\n/).some((held) => held.trim() === line);
}

/** `body` with `lines` below its last line. */
function appendLines(body: string, lines: readonly string[]): string {
  const trimmed = body.trimEnd();
  if (trimmed === '') return `${lines.join('\n')}\n`;
  const last = trimmed.split(/\r?\n/).at(-1) ?? '';
  const gap = last.startsWith('- ')
    ? '\n'
    : '\n\n';
  return `${trimmed}${gap}${lines.join('\n')}\n`;
}

/** The draft of a new follow-up issue of `stub` holding `lines`. */
function issueDraft(stub: string, lines: readonly string[]): IssueDraft {
  return {
    opt: 0,
    title: followUpsTitle(stub),
    body: followUpsBody(stub, lines),
    type: 'bug',
    module: TRIAGE_MODULE,
    priority: null,
    project: null,
    blockedBy: [],
  };
}

/** The tracker members filing the issue calls. */
export type FollowUpsTracker = Pick<Tracker, 'create'> & Partial<Pick<Tracker, 'openIssues' | 'edit'>>;

/** A tracker that can both list and edit, and so can hold the issue. */
type HoldingTracker = FollowUpsTracker & Required<Pick<Tracker, 'openIssues' | 'edit'>>;

/** True when `tracker` can list its open issues and edit one; see the module note. */
function canHoldIssue(tracker: FollowUpsTracker | null): tracker is HoldingTracker {
  return tracker !== null && tracker.openIssues !== undefined && tracker.edit !== undefined;
}

/** What {@link fileFollowUps} did with the plan's lines. */
export type FollowUpsResult =
  /** No row of the plan is routed `follow-up`, or the run has no plan stub; nothing was done. */
  | { readonly action: 'none' }
  /** No issue was open: one was created holding every line. */
  | { readonly action: 'created'; readonly title: string; readonly ref: IssueRef; readonly lines: readonly string[] }
  /** The issue was found and the lines it lacked appended. */
  | { readonly action: 'appended'; readonly title: string; readonly ref: IssueRef; readonly lines: readonly string[] }
  /** The issue already holds every line; nothing was written. */
  | { readonly action: 'held'; readonly title: string; readonly ref: IssueRef }
  /** No tracker can hold the issue: the lines were printed. */
  | { readonly action: 'printed'; readonly title: string; readonly reason: string; readonly lines: readonly string[] }
  /** A read or a tracker call failed; nothing more was tried. */
  | { readonly action: 'failed'; readonly problem: string };

/** What filed answers, before it is told. */
type Filed = Exclude<FollowUpsResult, { readonly action: 'none' | 'printed' }>;

/** The open issue of `stub` titled exactly, whose body holds the marker, or undefined. */
function findIssue(open: readonly OpenIssue[], stub: string): OpenIssue | undefined {
  const marker = followUpsMarker(stub);
  const title = followUpsTitle(stub);
  return open.find((issue) => issue.body.includes(marker) && issue.title === title);
}

/** Runs one tracker call, answering its rejection as a problem rather than throwing. */
async function call<T>(step: string, action: () => Promise<T>): Promise<{ readonly value: T } | { readonly problem: string }> {
  try {
    return { value: await action() };
  } catch (error) {
    return { problem: `${step} failed: ${messageOf(error)}` };
  }
}

/** Puts `lines` in the follow-up issue of `stub` on `tracker`; see the module note. */
async function fileOn(tracker: HoldingTracker, stub: string, lines: readonly string[]): Promise<Filed> {
  const title = followUpsTitle(stub);
  const listed = await call('listing the open bug issues', () => tracker.openIssues('bug'));
  if ('problem' in listed) return { action: 'failed', problem: listed.problem };

  const found = findIssue(listed.value, stub);
  if (found === undefined) {
    const created = await call('creating the follow-up issue', () => tracker.create(issueDraft(stub, lines)));
    return 'problem' in created
      ? { action: 'failed', problem: created.problem }
      : { action: 'created', title, ref: created.value, lines };
  }

  const missing = lines.filter((line) => !bodyHolds(found.body, line));
  if (missing.length === 0) return { action: 'held', title, ref: found.ref };
  const body = appendLines(found.body, missing);
  const edited = await call('editing the follow-up issue', () => tracker.edit(found.ref, { body }));
  return 'problem' in edited
    ? { action: 'failed', problem: edited.problem }
    : { action: 'appended', title, ref: found.ref, lines: missing };
}

/** The config keys filing reads: the chain and the secrets. */
export type FollowUpsConfig = Pick<
  RafaConfig,
  'trackerDefault' | 'trackerFallback' | 'prerequisitesRequired' | 'prerequisitesOptional'
>;

/** What {@link fileFollowUps} files, as `runWrapUp` hands it. */
export interface FollowUpsInput {
  /** The project root, holding `.rafa/`: the store is read there, and the chain is resolved with it. */
  readonly repoRoot: string;
  /** The run's checkout, whose paths are redacted too. */
  readonly checkout: string;
  /** The run's resolved config. */
  readonly settings: FollowUpsConfig;
  /** The plan's stub, or null for a plan whose file name carries none, which has no follow-up issue. */
  readonly planStub: string | null;
}

/** The effects {@link fileFollowUps} reaches through; each defaults to the real one. */
export interface FollowUpsSeams {
  /** Reads a plan's rows. `readBugRoutesForPlan` when left out. */
  readonly readRows?: (repoRoot: string, planStub: string) => readonly BugRouteRow[];
  /** Resolves the chain. `resolveTracker` over the core registry when left out. */
  readonly resolve?: (options: ResolveTrackerOptions) => Promise<TrackerResolution>;
  /** The environment the secrets' values are read from. `process.env` when left out. */
  readonly env?: SecretEnvironment;
  /** The home directory lines are redacted of. `homedir()` when left out. */
  readonly home?: string;
}

/** How a line names an issue: its URL, or its kind and id when it has none. */
function refName(ref: IssueRef): string {
  return ref.url ?? `${ref.kind} issue ${ref.externalId}`;
}

/** `1 line` or `<n> lines`. */
function lineCount(count: number): string {
  return count === 1
    ? '1 line'
    : `${String(count)} lines`;
}

/** Says what became of the lines; see the module note. */
function tell(result: FollowUpsResult, redact: (text: string) => string): void {
  const out = activeOutput();
  switch (result.action) {
    case 'none':
      return;
    case 'created':
      out.info(`${INDENT}${LINE_PREFIX}opened ${refName(result.ref)}, ${result.title}, with ${lineCount(result.lines.length)}.`);
      return;
    case 'appended':
      out.info(`${INDENT}${LINE_PREFIX}added ${lineCount(result.lines.length)} to ${refName(result.ref)}, ${result.title}.`);
      return;
    case 'held':
      out.info(`${INDENT}${LINE_PREFIX}${refName(result.ref)}, ${result.title}, already holds every line.`);
      return;
    case 'printed':
      out.info(`📝 ${result.title}, with no tracker to hold them (${result.reason}):`);
      for (const line of result.lines) out.info(`${INDENT}${line}`);
      return;
    case 'failed':
      out.warn(`${INDENT}${LINE_PREFIX}the follow-up issue was not written, and the next wrap-up tries again: ${redact(result.problem)}`);
  }
}

/** Resolves the chain, answering null and the reason when it lands nowhere. */
async function resolveChain(
  input: FollowUpsInput,
  resolve: (options: ResolveTrackerOptions) => Promise<TrackerResolution>,
): Promise<{ readonly tracker: Tracker | null; readonly reason: string }> {
  try {
    const { tracker } = await resolve({ config: input.settings, context: { repoRoot: input.repoRoot } });
    return { tracker, reason: NO_EDITABLE_TRACKER };
  } catch (error) {
    return { tracker: null, reason: `${NO_EDITABLE_TRACKER}: ${messageOf(error)}` };
  }
}

/** Files the plan's lines; what {@link fileFollowUps} runs inside its catch. */
async function fileLines(
  input: FollowUpsInput,
  seams: FollowUpsSeams,
  redact: (text: string) => string,
): Promise<FollowUpsResult> {
  const stub = input.planStub;
  if (stub === null) return { action: 'none' };
  const rows = (seams.readRows ?? readBugRoutesForPlan)(input.repoRoot, stub);
  const lines = followUpLines(rows, redact);
  if (lines.length === 0) return { action: 'none' };

  const { tracker, reason } = await resolveChain(input, seams.resolve ?? resolveTracker);
  if (!canHoldIssue(tracker)) {
    return { action: 'printed', title: followUpsTitle(stub), reason: redact(reason), lines };
  }
  return fileOn(tracker, stub, lines);
}

/**
 * Writes the plan's follow-up issue: found by its marker and exact
 * title and appended to through `edit`, else created, else its lines
 * printed once. See the module note. Never rejects.
 */
export async function fileFollowUps(input: FollowUpsInput, seams: FollowUpsSeams = {}): Promise<FollowUpsResult> {
  const secrets = namedSecrets(input.settings, seams.env ?? process.env);
  const local = localPathRedactor([input.repoRoot, input.checkout], seams.home ?? homedir());
  const redact = (text: string): string => local(redactSecrets(text, secrets));
  let result: FollowUpsResult;
  try {
    result = await fileLines(input, seams, redact);
  } catch (error) {
    result = { action: 'failed', problem: `the plan's follow-up rows were not read: ${messageOf(error)}` };
  }
  tell(result, redact);
  return result;
}
