/**
 * Loop-owned triage: what a task report's blockers and out-of-scope bugs
 * become once the report is stored and the task's tracker line is marked.
 *
 * {@link triageReport} takes one parsed report and does two things, in
 * this order:
 *
 *   - Blockers. The `what` of every blocker that has one, joined with
 *     {@link BLOCKER_SEPARATOR}, is written into the task's tracker line
 *     as its blocker comment through `writeTrackerBlocker`
 *     (`utils/tracker.ts`), so the next dispatch of that task reads it in
 *     its prompt. That writer keeps one comment per line, the latest, so
 *     the blockers of one report go in together. A report with no blocker
 *     text writes nothing and leaves an earlier comment as it was. The
 *     writer marks the line `[BLOCKED]` and refuses a ticked line, so a
 *     task the loop ticked keeps its tick.
 *   - Out-of-scope bugs, one at a time in list order, each routed by its
 *     `security` flag before anything is looked up. A bug with no usable
 *     `what` is skipped: it says nothing to file, and the store's triage
 *     writer refuses it for the same reason.
 *
 * The loop never dispatches a task for a bug. A plan that wants one fixed
 * declares a task for it.
 *
 * ## The key a bug is looked up by
 *
 * A bug's recurrence key is its artifact WITH the file it was reported
 * against: the base name of the task's tracker file, then the artifact on
 * one line, joined by {@link KEY_SEPARATOR} ({@link bugKeyOf}). The
 * artifact alone is not the defect. Two plans quoting one error string
 * report two different bugs, and keying on that string alone commented the
 * second on the first one's issue; keyed by the file as well, they stay
 * two issues, and two wordings of one defect under one file stay one.
 *
 * A bug with no artifact has no key (roadmap Q18): it is filed every time,
 * with no lookup and no reference stored. An artifact that is blank, or
 * that holds a lone UTF-16 surrogate, which the store cannot key a
 * reference by, counts as none.
 *
 * ## A public bug
 *
 * A bug whose flag is `false` goes to the tracker the degradation chain
 * landed on, looked up by its key:
 *
 *   1. The reference stored under the key (`readTrackerRef`, which keeps a
 *      reference under the text its caller keys by, this module's key
 *      rather than the bare artifact). One of the tracker's own kind is
 *      the issue: the bug is commented on there, and nothing is stored.
 *      One of another kind is passed over, since the tracker cannot read
 *      it: a run that fell back from `github` to `local` asks `local`
 *      instead.
 *   2. The stored reference is missing: `tracker.find` for a `bug` whose
 *      text holds the key's normalized text, the same key built from the
 *      redacted artifact. Every issue this module files carries that text
 *      in its `Recurrence key` section, so an issue filed for this bug
 *      from a checkout whose store this run does not have is found, while
 *      an issue that only quotes the artifact under another file is not.
 *      The first ref it answers is commented on, and stored under the key
 *      (`writeTrackerRef`), so a later recurrence is answered by step 1.
 *   3. Neither: the bug is filed with `tracker.create`, and the reference
 *      it answers is stored under the key.
 *
 * A reference therefore goes into a findings row of its own, keyed by the
 * bug's key and not by the artifact the report's findings are keyed by, so
 * a finding this session reported under that artifact keeps its row
 * whichever was written first, and `progress.txt` renders the reference's
 * row as one more `- artifact: <key>` bullet (`store/tracker-refs.ts`).
 *
 * ## A security bug
 *
 * A bug whose flag is `true`, or missing, is filed only to the private
 * tracker: a second `local` tracker rooted at {@link PRIVATE_TRIAGE_DIR},
 * which `.gitignore` keeps ignored under every tracking flag
 * (`project/gitignore.ts`). The parser never defaults a missing flag, and
 * the qa-bug-reporter rule treats ambiguity as a match, so null counts as
 * true. Searching a public tracker for a vulnerability's terms is itself a
 * disclosure, so such a bug:
 *
 *   - never reaches the public tracker: no `find`, no `create`, no
 *     `comment`;
 *   - never has a reference stored. Every `findings` row answers
 *     `readTrackerRef`, the public lookup, so the store is neither read
 *     nor written for it.
 *
 * A recurrence is found by the private tracker's own `find`, which reads
 * the files under that directory and sends nothing anywhere, and is
 * commented on there. The GitHub advisory channel stays one a human
 * opens. Nothing here can tell where a `Tracker` keeps its issues, so
 * {@link triageReport} refuses, before anything is written, a private
 * tracker that is not of kind `local` or that is the public tracker
 * itself; {@link createPrivateTriageTracker} makes the one it defaults to.
 *
 * ## What is filed
 *
 * The draft is a `bug` with `opt: 0`, since rafa keeps no OPT ledger and
 * each adapter numbers its own issues, `priority: null`, which the port
 * spells as the adapter applying `needs-triage`, no project and no
 * blocking issue. Its `module` is {@link TRIAGE_MODULE}, `unassigned`,
 * the module the GitHub adapter's `get` answers for an issue with no
 * module label, since a report names no module.
 *
 * The title is the bug's `what` on one line, cut to
 * {@link TITLE_MAX_LENGTH} code points. The body opens with a sentence
 * saying where the issue came from, then six sections, each value in a
 * fence one backtick longer than any backtick run it holds, so the text a
 * session wrote is shown verbatim and never rendered: `What`, `Artifact`,
 * `Recurrence key` (the key step 2 searches for), `Plan` (the plan stub),
 * `Task` (the task text, as the dispatch quoted it) and `Feedback` (the
 * report's feedback). A missing artifact, key, stub or feedback is a
 * sentence saying so. A recurrence's comment carries the same six sections
 * under its own opening sentence, so an issue filed before this rafa, with
 * no key section of its own, gains one from the first recurrence commented
 * on it.
 *
 * ## Named secrets
 *
 * {@link namedSecrets} answers the value of every `env` item under
 * `prerequisites`, both tiers, and of each of {@link SECRET_ENV_NAMES}
 * that is set. {@link redactSecrets} replaces each value with
 * `[redacted: <NAME>]`. Every value a session or the plan supplied goes
 * through it before it reaches a title, a body, a comment or a `find`
 * query: the key is searched for as it was filed, built from the redacted
 * artifact, and the title is cut after redaction, so no cut leaves part of
 * a secret behind. A problem this module answers is redacted too. The
 * stored reference stays keyed by the key built from the artifact as
 * reported, since the store is local, and two artifacts differing only in
 * a secret's value would otherwise share one key.
 *
 * ## Failures
 *
 * Each bug settles on its own, so one tracker that rejects never costs
 * the bugs after it, and nothing here rejects for a tracker, a store or a
 * tracker file that fails: each failure is answered in the result, for
 * the loop to warn about. A bug whose stored reference cannot be read
 * fails there, with no tracker call, rather than filing what may be a
 * second issue. A bug filed or commented on whose reference then cannot
 * be stored keeps its action and names the store's problem.
 */
import type { LocalTrackerOptions } from '../adapters/tracker/local.js';
import type { RafaConfig } from '../config.js';
import type {
  FindingOutcome,
  FindingsDispatch,
  FindingsWriterSeams,
} from '../effort/store/findings.js';
import type { TrackerRefWriteAction } from '../effort/store/tracker-refs.js';
import type { IssueDraft, IssueRef, Tracker } from '../ports/index.js';
import type { ReportBlocker, ReportBug, TaskReport } from '../report/parse.js';

import { basename, join } from 'node:path';

import { createLocalTracker } from '../adapters/tracker/local.js';
import { messageOf } from '../config-sections.js';
import { textProblem } from '../effort/store/findings.js';
import { readTrackerRef, writeTrackerRef } from '../effort/store/tracker-refs.js';
import { writeTrackerBlocker } from '../utils/tracker.js';

/** Where security bugs are filed, under a repository root. */
export const PRIVATE_TRIAGE_DIR = join('.rafa', 'triage', 'private');

/** The variables named as secrets whatever the config says, each when set. */
export const SECRET_ENV_NAMES = ['GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'LINEAR_API_KEY'] as const;

/** The module every triage draft names; see the module note. */
export const TRIAGE_MODULE = 'unassigned';

/** What joins the text of one report's blockers in the line's one comment. */
export const BLOCKER_SEPARATOR = '; ';

/** What stands between a bug's file and its artifact in its key. */
export const KEY_SEPARATOR = ': ';

/** The most code points a filed title holds, its cut marker included. */
export const TITLE_MAX_LENGTH = 120;

/** What ends a title that was cut. */
const TITLE_CUT = '...';

/** The shortest fence a value is shown in. */
const MIN_FENCE_LENGTH = 3;

/** What opens a filed issue's body. */
const ISSUE_OPENING = 'An out-of-scope bug a rafa task session reported. The loop filed it and'
  + ' dispatches no task for it: a plan that wants it fixed declares a task.';

/** What opens a recurrence's comment. */
const COMMENT_OPENING = 'Reported again by a rafa task session.';

/** One named secret: the variable's name and the value it held. */
export interface NamedSecret {
  readonly name: string;
  readonly value: string;
}

/** Where a bug goes: the tracker the chain landed on, or the private one. */
export type BugChannel = 'public' | 'private';

/** What became of one bug. */
export type BugTriageAction =
  /** A new issue was created for it. */
  | 'filed'
  /** An issue it recurs in was found and commented on. */
  | 'commented'
  /** It had no `what` to file; nothing was called. */
  | 'skipped'
  /** A step failed before an issue was filed or commented on. */
  | 'failed';

/** How the issue a recurrence was commented on was found. */
export type RecurrenceSource = 'store' | 'find';

/** What became of one report's blockers. */
export interface BlockerTriage {
  /** The text written, or null when no blocker had a `what`. */
  readonly text: string | null;
  /** True when the tracker line now trails the text. */
  readonly written: boolean;
  /** Why a text was not written, or null. */
  readonly problem: string | null;
}

/** What became of one out-of-scope bug. */
export interface BugTriage {
  /** The bug's index in the report's list. */
  readonly index: number;
  readonly channel: BugChannel;
  readonly action: BugTriageAction;
  /** The issue filed or commented on, or the one a failed comment was for; else null. */
  readonly ref: IssueRef | null;
  /** How the issue was found, for a comment or a failed one; else null. */
  readonly foundBy: RecurrenceSource | null;
  /** What storing the reference did, or null when none was stored. */
  readonly stored: TrackerRefWriteAction | null;
  /** Why it was skipped or failed, or why its reference was not stored; else null. */
  readonly problem: string | null;
}

/** What {@link triageReport} did. */
export interface TriageResult {
  readonly blocker: BlockerTriage;
  /** One per out-of-scope bug, in the report's order. */
  readonly bugs: readonly BugTriage[];
}

/** What {@link triageReport} needs to triage one report. */
export interface TriageOptions {
  /** The repo root the store lives under. */
  readonly repoRoot: string;
  /** The tracker file holding the task's line, and half of each bug's key. */
  readonly trackerPath: string;
  /** The task's line, counting from zero, as `findNextTask` answered it. */
  readonly lineNum: number;
  /** The dispatch the report came from: the session, the plan stub and the task text. */
  readonly dispatch: FindingsDispatch;
  /** What the loop made of the task, stored with each reference. */
  readonly outcome: FindingOutcome;
  /** The report, as `parseReport` answered it. */
  readonly report: TaskReport;
  /** The tracker the degradation chain landed on. */
  readonly tracker: Tracker;
  /**
   * Where security bugs go. {@link createPrivateTriageTracker} over
   * `repoRoot` when left out. Refused unless of kind `local` and not
   * `tracker` itself.
   */
  readonly privateTracker?: Tracker;
  /**
   * The secrets every filed text is redacted of, as {@link namedSecrets}
   * answers them. Required rather than defaulted, so no caller files
   * unredacted text by leaving them out.
   */
  readonly secrets: readonly NamedSecret[];
  /** Seams for the reference write. */
  readonly seams?: FindingsWriterSeams;
}

/** The environment a secret's value is read from. */
export type SecretEnvironment = Readonly<Record<string, string | undefined>>;

/** Where a security bug's issue files live under a repository root. */
export function privateTriageDir(repoRoot: string): string {
  return join(repoRoot, PRIVATE_TRIAGE_DIR);
}

/** The private tracker: a `local` tracker over {@link privateTriageDir}, reached by no fallback. */
export function createPrivateTriageTracker(
  repoRoot: string,
  options: Pick<LocalTrackerOptions, 'now' | 'warn'> = {},
): Tracker {
  return createLocalTracker({
    issuesDir: privateTriageDir(repoRoot),
    fallbackReason: null,
    now: options.now,
    warn: options.warn,
  });
}

/**
 * The named secrets, in order: each `env` item of `prerequisites.required`
 * then `prerequisites.optional`, then {@link SECRET_ENV_NAMES}, each name
 * once, at its first place. A variable that is unset, empty or blank names
 * nothing, since there is no value to take out.
 */
export function namedSecrets(
  config: Pick<RafaConfig, 'prerequisitesRequired' | 'prerequisitesOptional'>,
  env: SecretEnvironment,
): readonly NamedSecret[] {
  const configured = [...config.prerequisitesRequired, ...config.prerequisitesOptional]
    .filter((item) => item.kind === 'env')
    .map((item) => item.name);
  const names = [...new Set([...configured, ...SECRET_ENV_NAMES])];
  return names.flatMap((name) => {
    const value = env[name];
    return typeof value === 'string' && value.trim().length > 0
      ? [{ name, value }]
      : [];
  });
}

/** A text matched literally inside a regular expression. */
function literalPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `text` with every value of `secrets` replaced by `[redacted: <NAME>]`.
 *
 * A value is matched byte for byte, and also with its surrounding
 * whitespace trimmed when it has some, as a variable read from a file
 * often does. Two names holding one value are both redacted under the
 * first. The replacement is one pass that tries longer values first, so a
 * value holding another is replaced whole, and a marker already written is
 * never matched again.
 */
export function redactSecrets(text: string, secrets: readonly NamedSecret[]): string {
  const nameByValue = new Map<string, string>();
  for (const { name, value } of secrets) {
    for (const form of [value, value.trim()]) {
      if (form.trim().length > 0 && !nameByValue.has(form)) nameByValue.set(form, name);
    }
  }
  if (nameByValue.size === 0) return text;

  const values = [...nameByValue.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(values.map(literalPattern).join('|'), 'g');
  return text.replace(pattern, (value) => `[redacted: ${nameByValue.get(value)}]`);
}

/** True for text with something in it. */
function hasText(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** The text written for a report's blockers, or null when none has a `what`. */
export function blockerTextOf(blockers: readonly ReportBlocker[]): string | null {
  const texts = blockers.map((blocker) => blocker.what).filter(hasText);
  return texts.length === 0
    ? null
    : texts.join(BLOCKER_SEPARATOR);
}

/** Writes the report's blocker text onto the task's line; see the module note. */
function triageBlockers(options: TriageOptions): BlockerTriage {
  const text = blockerTextOf(options.report.blockers);
  if (text === null) return { text, written: false, problem: null };

  try {
    return writeTrackerBlocker(options.trackerPath, options.lineNum, text)
      ? { text, written: true, problem: null }
      : {
        text,
        written: false,
        problem: `tracker line ${options.lineNum + 1} is no open or blocked task line with text`,
      };
  } catch (error) {
    return { text, written: false, problem: `the blocker was not written: ${messageOf(error)}` };
  }
}

/** A bug's artifact when it can key a reference, or null; see the module note. */
function artifactOf(bug: ReportBug): string | null {
  return hasText(bug.artifact) && textProblem(bug.artifact) === null
    ? bug.artifact
    : null;
}

/** `text` on one line, every run of whitespace one space, trimmed. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The key a bug's issue is looked up and kept under: the base name of the
 * tracker file it was reported against, then its artifact on one line,
 * joined by {@link KEY_SEPARATOR}. The base name, rather than the path, so
 * one plan keys the same from two checkouts; see the module note.
 */
export function bugKeyOf(trackerPath: string, artifact: string): string {
  return `${basename(trackerPath)}${KEY_SEPARATOR}${oneLine(artifact)}`;
}

/** A value in a fence one backtick longer than any run of backticks it holds. */
function fenced(value: string): string {
  const runs = Array.from(value.matchAll(/`+/g), (run) => run[0].length);
  const fence = '`'.repeat(Math.max(MIN_FENCE_LENGTH, ...runs.map((length) => length + 1)));
  const body = value.endsWith('\n')
    ? value
    : `${value}\n`;
  return `${fence}\n${body}${fence}`;
}

/** The title a bug is filed under: its redacted `what` on one line, cut to the cap. */
export function issueTitle(redactedWhat: string): string {
  const line = oneLine(redactedWhat);
  const points = Array.from(line);
  if (points.length <= TITLE_MAX_LENGTH) return line;
  const kept = points.slice(0, TITLE_MAX_LENGTH - TITLE_CUT.length).join('');
  return `${kept.trimEnd()}${TITLE_CUT}`;
}

/** The values one bug's issue and comment show, before redaction. */
interface BugValues {
  readonly what: string;
  readonly artifact: string | null;
  /** The key `find` is asked for, redacted, or null for a bug with none. */
  readonly key: string | null;
  readonly planStub: string | null;
  readonly taskText: string;
  readonly feedback: string | null;
}

/** One section: its heading, then its value redacted in a fence, or the sentence for none. */
function section(
  heading: string,
  value: string | null,
  absent: string,
  redact: (text: string) => string,
): string {
  const shown = value === null
    ? absent
    : fenced(redact(value));
  return `## ${heading}\n\n${shown}`;
}

/** An issue body or a comment: `opening`, then the six sections; see the module note. */
function issueText(opening: string, values: BugValues, redact: (text: string) => string): string {
  return [
    opening,
    section('What', values.what, '', redact),
    section('Artifact', values.artifact, 'The report gave no artifact, so a recurrence files again.', redact),
    section('Recurrence key', values.key, 'The report gave no artifact, so this bug has no key.', redact),
    section('Plan', values.planStub, 'The dispatch resolved no plan stub.', redact),
    section('Task', values.taskText, '', redact),
    section('Feedback', values.feedback, 'The report gave no feedback.', redact),
  ].join('\n\n') + '\n';
}

/** Everything one bug is filed, commented and searched with, redacted. */
interface Filing {
  readonly draft: IssueDraft;
  readonly comment: string;
  /** The redacted key `find` is asked for, or null for a bug with none. */
  readonly searchText: string | null;
  /** The key a reference is stored under, from the artifact as reported. */
  readonly key: string | null;
}

/** The filing for one bug. */
function filingFor(
  what: string,
  bug: ReportBug,
  options: TriageOptions,
  redact: (text: string) => string,
): Filing {
  const artifact = artifactOf(bug);
  const searchText = artifact === null
    ? null
    : bugKeyOf(options.trackerPath, redact(artifact));
  const values: BugValues = {
    what,
    artifact,
    key: searchText,
    planStub: options.dispatch.planStub,
    taskText: options.dispatch.taskLine,
    feedback: options.report.feedback,
  };
  return {
    draft: {
      opt: 0,
      title: issueTitle(redact(what)),
      body: issueText(ISSUE_OPENING, values, redact),
      type: 'bug',
      module: TRIAGE_MODULE,
      priority: null,
      project: null,
      blockedBy: [],
    },
    comment: issueText(COMMENT_OPENING, values, redact),
    searchText,
    key: artifact === null
      ? null
      : bugKeyOf(options.trackerPath, artifact),
  };
}

/** Where one channel files, and the store calls only the public channel makes. */
interface Route {
  readonly channel: BugChannel;
  readonly tracker: Tracker;
  /** The reference stored under a key; null for a channel that never reads the store. */
  readonly readStored: ((key: string) => IssueRef | null) | null;
  /** Stores a reference under a key; null for a channel that never writes the store. */
  readonly store: ((key: string, ref: IssueRef) => TrackerRefWriteAction) | null;
}

/** One bug on its way through a route. */
interface BugRun {
  readonly route: Route;
  readonly index: number;
  readonly filing: Filing;
  readonly redact: (text: string) => string;
}

/** A step's value, or the redacted problem it failed with. */
type StepOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: string };

/** Runs one step, answering its failure rather than rejecting. */
async function step<T>(run: BugRun, name: string, action: () => T | Promise<T>): Promise<StepOutcome<T>> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, problem: run.redact(`${name} failed: ${messageOf(error)}`) };
  }
}

/** The result for one bug, its unset fields null. */
function resultOf(run: BugRun, action: BugTriageAction, fields: Partial<BugTriage> = {}): BugTriage {
  return {
    index: run.index,
    channel: run.route.channel,
    action,
    ref: null,
    foundBy: null,
    stored: null,
    problem: null,
    ...fields,
  };
}

/** Stores the reference of an issue reached, when the route stores and the bug has a key. */
async function settle(
  run: BugRun,
  action: 'filed' | 'commented',
  ref: IssueRef,
  foundBy: RecurrenceSource | null,
): Promise<BugTriage> {
  const { store } = run.route;
  const { key } = run.filing;
  if (store === null || key === null) return resultOf(run, action, { ref, foundBy });

  const stored = await step(run, 'storing the reference', () => store(key, ref));
  return stored.ok
    ? resultOf(run, action, { ref, foundBy, stored: stored.value })
    : resultOf(run, action, { ref, foundBy, problem: stored.problem });
}

/** Files the bug as a new issue. */
async function fileNew(run: BugRun): Promise<BugTriage> {
  const created = await step(run, `the ${run.route.channel} tracker create`, () => run.route.tracker.create(run.filing.draft));
  return created.ok
    ? settle(run, 'filed', created.value, null)
    : resultOf(run, 'failed', { problem: created.problem });
}

/** Comments on the issue the bug recurs in. */
async function commentOn(run: BugRun, ref: IssueRef, foundBy: RecurrenceSource): Promise<BugTriage> {
  const commented = await step(run, `the ${run.route.channel} tracker comment`, () => run.route.tracker.comment(ref, run.filing.comment));
  if (!commented.ok) return resultOf(run, 'failed', { ref, foundBy, problem: commented.problem });
  return foundBy === 'store'
    ? resultOf(run, 'commented', { ref, foundBy })
    : settle(run, 'commented', ref, foundBy);
}

/** Looks the bug up by its key, then comments on what is found or files it. */
async function triageBug(run: BugRun): Promise<BugTriage> {
  const { route, filing } = run;
  const { key, searchText } = filing;
  if (key === null || searchText === null) return fileNew(run);

  const { readStored } = route;
  if (readStored !== null) {
    const stored = await step(run, 'reading the stored reference', () => readStored(key));
    if (!stored.ok) return resultOf(run, 'failed', { problem: stored.problem });
    if (stored.value !== null && stored.value.kind === route.tracker.kind) {
      return commentOn(run, stored.value, 'store');
    }
  }

  const found = await step(run, `the ${route.channel} tracker find`, () => route.tracker.find({ text: searchText, type: 'bug' }));
  if (!found.ok) return resultOf(run, 'failed', { problem: found.problem });
  const [match] = found.value;
  return match === undefined
    ? fileNew(run)
    : commentOn(run, match, 'find');
}

/** Throws unless `privateTracker` may take security bugs; see the module note. */
function checkPrivateTracker(tracker: Tracker, privateTracker: Tracker): void {
  if (privateTracker.kind !== 'local') {
    throw new TypeError(
      `triage: refused a private tracker of kind ${JSON.stringify(privateTracker.kind)};`
        + ' security bugs are filed to a local tracker only, and nothing was triaged',
    );
  }
  if (privateTracker === tracker) {
    throw new TypeError(
      'triage: refused the public tracker as the private one; nothing was triaged',
    );
  }
}

/**
 * Triages one stored report: writes its blocker text onto the task's
 * tracker line, then files, or comments on, each out-of-scope bug through
 * the channel its `security` flag routes it to, and answers what became of
 * each; see the module note.
 *
 * Rejects, having written and called nothing, only for a private tracker
 * it refuses. Every other failure is answered in the result.
 */
export async function triageReport(options: TriageOptions): Promise<TriageResult> {
  const { repoRoot } = options;
  const privateTracker = options.privateTracker ?? createPrivateTriageTracker(repoRoot);
  checkPrivateTracker(options.tracker, privateTracker);

  const blocker = triageBlockers(options);
  const redact = (text: string): string => redactSecrets(text, options.secrets);
  const routes: Readonly<Record<BugChannel, Route>> = {
    public: {
      channel: 'public',
      tracker: options.tracker,
      readStored: (key) => readTrackerRef(repoRoot, key),
      store: (key, ref) => writeTrackerRef(repoRoot, {
        dispatch: options.dispatch,
        outcome: options.outcome,
        artifact: key,
        ref,
      }, options.seams).action,
    },
    private: { channel: 'private', tracker: privateTracker, readStored: null, store: null },
  };

  const bugs: BugTriage[] = [];
  for (const [index, bug] of options.report.outOfScopeBugs.entries()) {
    const route = bug.security === false
      ? routes.public
      : routes.private;
    const what = bug.what;
    if (!hasText(what)) {
      bugs.push({
        index,
        channel: route.channel,
        action: 'skipped',
        ref: null,
        foundBy: null,
        stored: null,
        problem: `out_of_scope_bugs[${index}] has no what to file`,
      });
      continue;
    }
    const filing = filingFor(what, bug, options, redact);
    bugs.push(await triageBug({ route, index, filing, redact }));
  }
  return { blocker, bugs };
}
