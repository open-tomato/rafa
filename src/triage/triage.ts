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
 *   - Out-of-scope bugs, one at a time in list order, each routed before
 *     anything is looked up: to the machine channel when the
 *     machine-fault reading answers, and otherwise by its `security`
 *     flag. A bug with no usable `what` is skipped: it says nothing to
 *     file, and the store's triage writer refuses it for the same
 *     reason. A public bug the run inherited files nothing; see below.
 *
 * The loop never dispatches a task for a bug. A plan that wants one fixed
 * declares a task for it.
 *
 * ## The key a bug is looked up by
 *
 * A bug's recurrence key is built from its artifact and `what`, with
 * their local paths taken out and the artifact stripped of numbers,
 * commit hashes and folder prefixes ({@link bugKeyOf}): the test file,
 * case and evidence line of a bug naming a test case, else the tracker
 * file it was reported against WITH its artifact. `./bug-key.ts` builds
 * it, and its note holds why a test failure keys on the test and every
 * other bug on its file too, what stripping takes out, the legacy keys
 * step 1 below also asks for, and why a bug with no artifact has no key
 * and is filed every time.
 *
 * ## A public bug
 *
 * A bug the machine reading below did not match, and whose flag is
 * `false`, goes to the tracker the degradation chain landed on, looked
 * up by its key:
 *
 *   1. The reference stored under the key, then under each legacy key
 *      (`readTrackerRef`, which keeps a reference under the text its
 *      caller keys by, this module's key rather than the bare artifact,
 *      and answers the newest under it). The first one of the tracker's
 *      own kind is the issue, answered as the next section says, and is
 *      not stored again when commented on. One of another kind is passed
 *      over, since the tracker cannot read it: a run that fell back from
 *      `github` to `local` asks `local` instead.
 *   2. No stored reference is found: `tracker.find` for a `bug` whose
 *      text holds the key's text, the same key built from the redacted
 *      artifact and `what`. Every issue this module files carries that
 *      text in its `Recurrence key` section, so an issue filed for this
 *      bug from a checkout whose store this run does not have is found,
 *      while an issue that only quotes the artifact, under another key, is
 *      not. An issue filed before #486 carries a legacy key there, and is
 *      found by step 1 only. The first ref `find` answers is the issue,
 *      answered as the next section says, and once commented on is stored
 *      under the key (`writeTrackerRef`), so a later recurrence is
 *      answered by step 1.
 *   3. Neither: the bug is filed with `tracker.create`, and the reference
 *      it answers is stored under the key.
 *
 * ## The state of the issue a recurrence finds
 *
 * Before anything is written for an issue steps 1 and 2 found, its state
 * is read with `tracker.get`:
 *
 *   - Open, any state but the closed three: the bug is commented on there.
 *   - Closed as completed, `done` or `released` ({@link COMPLETED_ISSUE_STATES}):
 *     the fix did not hold, so the bug is filed as a new issue whose body
 *     opens with a `Supersedes` section naming the closed one
 *     (`./issue-text.ts`), and the new reference is stored under the key
 *     with `supersedes` naming the closed one. The closed issue's row is
 *     kept, and `readTrackerRef` answers the new one as the newest, so the
 *     next recurrence comments on it. Its action is `filed`. A store that
 *     refuses the superseding write, `SupersedeInSessionRefusal` among the
 *     refusals (`store/tracker-refs.ts`), leaves the issue filed and names
 *     the refusal, as any store failure here does.
 *   - Closed as `cancelled`, which the GitHub adapter answers for an issue
 *     closed as not planned or as a duplicate: somebody decided the bug is
 *     not to be fixed there, or is tracked elsewhere, so it is commented on
 *     and nothing is filed, as for an open one.
 *   - A read that fails: the bug answers `failed`, naming the issue it was
 *     for, and nothing is filed or commented on, since a second issue for a
 *     bug whose first may still be open is the refiling this read exists
 *     to stop.
 *
 * Only the public route reads the state. The private tracker stores no
 * reference, so its `find`, which answers the oldest issue first, would
 * find the closed one again on every recurrence, and filing in its place
 * would file once per recurrence; a security bug is commented on as found.
 *
 * A reference therefore goes into a findings row of its own, keyed by the
 * bug's key and not by the artifact the report's findings are keyed by, so
 * a finding this session reported under that artifact keeps its row
 * whichever was written first, and `progress.txt` renders the reference's
 * row as one more `- artifact: <key>` bullet (`store/tracker-refs.ts`).
 *
 * ## An inherited bug
 *
 * Given {@link TriageOptions.inherited}, a public bug that `./inherited.ts`
 * reads as one of the run-start baseline's failures is a red test the run
 * started with, not one its task made: its action is `inherited`, and
 * nothing is filed for it. Its key is looked up as steps 1 and 2 above
 * look one up, and the issue they find has its state read (`get`); an
 * open one is commented on and, when `find` found it, stored under the
 * key, as a recurrence is. A closed issue, or none, is left alone, and
 * `create` is never called. The key goes into the option's `commented`
 * set once the comment is made, and a bug whose key the set already
 * holds is answered `inherited` with no call at all, so one red test
 * reported by every task of a run comments once. A lookup, state read or
 * comment that fails answers `failed`, as for any public bug, and leaves
 * the set as it was. Security and machine-scoped bugs are never read
 * against the failures: their channels never look anything up on the
 * public tracker.
 *
 * ## A security bug
 *
 * A bug the machine reading below did not match, and whose flag is
 * `true` or missing, is filed only to the private tracker: a second
 * `local` tracker rooted at {@link PRIVATE_TRIAGE_DIR},
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
 * ## A machine-scoped bug
 *
 * A bug whose `what` and `artifact` name a system toolchain, a machine's
 * SDK path or a package-manager build failure is a fault of the MACHINE
 * the session ran on and not of rafa. `./machine-fault.ts` is the whole
 * of that reading, and its note holds the families, the near misses that
 * shaped them and what it reads over the 27 bugs rafa's own runs filed.
 * Such a bug goes to a third channel, which has no tracker at all:
 *
 *   - neither tracker is asked anything, the public one or the private
 *     one: no `find`, no `create`, no `comment`;
 *   - no reference is stored, and none is read. Nothing was filed for
 *     it, so there is no issue a recurrence could be answered with;
 *   - its action is `skipped`, its channel `machine`, and its problem is
 *     one line for the operator naming the family and the text that
 *     matched ({@link machineFaultSentence}, redacted as every problem
 *     here is), so a run says why nothing was filed rather than saying
 *     nothing.
 *
 * The bug is not lost. `writeTriage` (`effort/store/triage.ts`) stores
 * every out-of-scope bug whatever triage did with it, and reads the SAME
 * module for its row's `scope` column, so the row says `machine` and the
 * routing and the row can never disagree about one bug. What is kept off
 * is the board: nobody reading it can act on a malformed SDK stub on one
 * machine, no rafa commit can fix one, and the artifact would carry that
 * machine's own paths onto a public tracker. Issue #17 on
 * `open-tomato/rafa` is the bug this channel exists for.
 *
 * The reading is taken BEFORE the `security` flag, so a machine fault a
 * session flagged reaches the private tracker no more than it reaches
 * the public one, and before the `what` check, so a machine-scoped bug
 * with no `what` is skipped as a machine one: nothing was called for it
 * either way, and the store refuses its row for the missing `what`
 * whichever channel it went to.
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
 * The title and the body, its sections and the comment a recurrence
 * gets are `./issue-text.ts`'s, whose note holds what each shows. The
 * `Refs` section among them is built here, from the redacted artifact,
 * by {@link TriageOptions.verifyRefs}.
 *
 * ## Local paths and named secrets
 *
 * Every value a session or the plan supplied, and every problem this
 * module answers, has its local paths taken out first, as the key does
 * ({@link TriageOptions.home} names the home), then its secrets.
 *
 * {@link namedSecrets} answers the value of every `env` item under
 * `prerequisites`, both tiers, and of each of {@link SECRET_ENV_NAMES}
 * that is set. {@link redactSecrets} replaces each value with
 * `[redacted: <NAME>]`. Every value a session or the plan supplied goes
 * through it before it reaches a title, a body, a comment or a `find`
 * query: the key is searched for as it was filed, built from the redacted
 * artifact, and the title is cut after redaction, so no cut leaves part of
 * a secret behind. The stored reference stays keyed by the key built
 * before secrets are redacted, since the store is local, and two artifacts
 * differing only in a secret's value would otherwise share one key.
 *
 * ## Failures
 *
 * Each bug settles on its own, so one tracker that rejects never costs
 * the bugs after it, and nothing here rejects for a tracker, a store or a
 * tracker file that fails: each failure is answered in the result, for
 * the loop to warn about. A bug whose stored reference cannot be read
 * fails there, with no tracker call, rather than filing what may be a
 * second issue, and one whose found issue's state cannot be read fails
 * there, as the section above says. A bug filed or commented on whose
 * reference then cannot be stored keeps its action and names the store's
 * problem.
 */
import type { InheritedTriage } from './inherited.js';
import type { BugValues } from './issue-text.js';
import type { MachineFault } from './machine-fault.js';
import type { LocalTrackerOptions } from '../adapters/tracker/local.js';
import type { RafaConfig } from '../config.js';
import type {
  FindingOutcome,
  FindingsDispatch,
  FindingsWriterSeams,
} from '../effort/store/findings.js';
import type { TrackerRefWriteAction } from '../effort/store/tracker-refs.js';
import type { IssueDraft, IssueRef, IssueState, Tracker } from '../ports/index.js';
import type { RefVerifier } from '../refs/verify.js';
import type { ReportBlocker, ReportBug, TaskReport } from '../report/parse.js';

import { homedir } from 'node:os';
import { join } from 'node:path';

import { createLocalTracker } from '../adapters/tracker/local.js';
import { messageOf } from '../config-sections.js';
import { readTrackerRef, writeTrackerRef } from '../effort/store/tracker-refs.js';
import { writeTrackerBlocker } from '../utils/tracker.js';

import { artifactOf, bugKeyOf, hasText, legacyBugKeyOf } from './bug-key.js';
import { inheritedFailureOf, isOpenIssueState } from './inherited.js';
import { COMMENT_OPENING, ISSUE_OPENING, issueText, issueTitle } from './issue-text.js';
import { localPathRedactor } from './local-paths.js';
import { machineFaultSentence, readMachineFault } from './machine-fault.js';
import { buildRefsSection, createArtifactRefsVerifier } from './refs-section.js';

/** Where security bugs are filed, under a repository root. */
export const PRIVATE_TRIAGE_DIR = join('.rafa', 'triage', 'private');

/** The variables named as secrets whatever the config says, each when set. */
export const SECRET_ENV_NAMES = ['GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'LINEAR_API_KEY'] as const;

/** The module every triage draft names; see the module note. */
export const TRIAGE_MODULE = 'unassigned';

/** What joins the text of one report's blockers in the line's one comment. */
export const BLOCKER_SEPARATOR = '; ';

/** Names `./bug-key.ts` and `./issue-text.ts` now hold, still answered from here. */
export { CASE_SEPARATOR, KEY_SEPARATOR, bugKeyOf, legacyBugKeyOf } from './bug-key.js';
export { TITLE_MAX_LENGTH, issueTitle } from './issue-text.js';

/** One named secret: the variable's name and the value it held. */
export interface NamedSecret {
  readonly name: string;
  readonly value: string;
}

/**
 * Where a bug goes: the tracker the chain landed on, the private one, or
 * `machine`, the channel with no tracker at all; see the module note.
 */
export type BugChannel = 'public' | 'private' | 'machine';

/** What became of one bug. */
export type BugTriageAction =
  /** A new issue was created for it. */
  | 'filed'
  /** An issue it recurs in was found and commented on. */
  | 'commented'
  /**
   * It is a test failure the run started with: nothing was filed, and the
   * open issue its key found, if any, was commented on unless it already
   * was this run.
   */
  | 'inherited'
  /**
   * Nothing was called for it: it is machine-scoped, or it had no `what`
   * to file. Its problem says which.
   */
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
  /**
   * The issue filed or commented on, or the one a failed comment or state
   * read was for; else null, as for an inherited bug that commented on
   * nothing.
   */
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
  /** The tracker file holding the task's line, and half of the key of each bug naming no test case. */
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
  /**
   * Reads the paths and symbols a bug's artifact names, for its `Refs`
   * section. `createArtifactRefsVerifier` over `repoRoot` when left out.
   */
  readonly verifyRefs?: RefVerifier;
  /** The home directory taken out of every filed text; `os.homedir()` when left out. */
  readonly home?: string;
  /** Seams for the reference write. */
  readonly seams?: FindingsWriterSeams;
  /**
   * The run-start failures and the keys commented on this run, for
   * answering a public bug the run inherited; see the module note. Left
   * out, no bug is inherited.
   */
  readonly inherited?: InheritedTriage;
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

/** Everything one bug is filed, commented and searched with, redacted. */
interface Filing {
  readonly draft: IssueDraft;
  readonly comment: string;
  /** The redacted key `find` is asked for, or null for a bug with none. */
  readonly searchText: string | null;
  /** The key a reference is stored under, from the artifact and `what` with local paths taken out. */
  readonly key: string | null;
  /**
   * The legacy keys step 1 asks the store for after {@link key}: from the
   * artifact without, then with, its local paths, each once and never
   * {@link key} itself.
   */
  readonly legacyKeys: readonly string[];
  /** The values {@link draft}'s body was built from, for the body of an issue filed in place of a closed one. */
  readonly values: BugValues;
}

/** The filing for one bug: `local` takes out paths only, `redact` secrets too; see the module note. */
async function filingFor(
  what: string,
  bug: ReportBug,
  options: TriageOptions,
  local: (text: string) => string,
  redact: (text: string) => string,
  verifyRefs: RefVerifier,
): Promise<Filing> {
  const reported = artifactOf(bug);
  const artifact = reported === null
    ? null
    : local(reported);
  const searchText = artifact === null
    ? null
    : bugKeyOf(options.trackerPath, redact(artifact), redact(what));
  const key = artifact === null
    ? null
    : bugKeyOf(options.trackerPath, artifact, local(what));
  const refs = await buildRefsSection(artifact === null
    ? null
    : redact(artifact), verifyRefs);
  const values: BugValues = {
    what,
    artifact,
    key: searchText,
    refs,
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
    key,
    legacyKeys: legacyKeysOf(options.trackerPath, key, reported, artifact),
    values,
  };
}

/** The legacy keys of a bug whose artifact is `reported`, `artifact` once local paths are out; see {@link Filing}. */
function legacyKeysOf(
  trackerPath: string,
  key: string | null,
  reported: string | null,
  artifact: string | null,
): readonly string[] {
  if (key === null || reported === null || artifact === null) return [];
  const keys = [legacyBugKeyOf(trackerPath, artifact), legacyBugKeyOf(trackerPath, reported)];
  return [...new Set(keys)].filter((legacy) => legacy !== key);
}

/** The channels that have a tracker to route a bug to: every one but `machine`. */
type TrackedChannel = Exclude<BugChannel, 'machine'>;

/** Where one channel files, and the store calls only the public channel makes. */
interface Route {
  readonly channel: TrackedChannel;
  readonly tracker: Tracker;
  /** The reference stored under a key; null for a channel that never reads the store. */
  readonly readStored: ((key: string) => IssueRef | null) | null;
  /**
   * Stores a reference under a key, superseding `supersedes` when given;
   * null for a channel that never writes the store.
   */
  readonly store: ((key: string, ref: IssueRef, supersedes?: IssueRef) => TrackerRefWriteAction) | null;
  /** True when the issue a recurrence finds has its state read before anything is written. */
  readonly readsState: boolean;
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

/**
 * Stores the reference of an issue reached, when the route stores and the
 * bug has a key, as superseding `supersedes` when given.
 */
async function settle(
  run: BugRun,
  action: 'filed' | 'commented' | 'inherited',
  ref: IssueRef,
  foundBy: RecurrenceSource | null,
  supersedes?: IssueRef,
): Promise<BugTriage> {
  const { store } = run.route;
  const { key } = run.filing;
  if (store === null || key === null) return resultOf(run, action, { ref, foundBy });

  const stored = await step(run, 'storing the reference', () => store(key, ref, supersedes));
  return stored.ok
    ? resultOf(run, action, { ref, foundBy, stored: stored.value })
    : resultOf(run, action, { ref, foundBy, problem: stored.problem });
}

/**
 * Files the bug as a new issue, in place of `supersedes`, an issue closed
 * as completed, when given: its body then names that issue, and its
 * reference is stored as superseding it.
 */
async function fileNew(run: BugRun, supersedes?: IssueRef): Promise<BugTriage> {
  const { filing } = run;
  const draft = supersedes === undefined
    ? filing.draft
    : { ...filing.draft, body: issueText(ISSUE_OPENING, { ...filing.values, supersedes }, run.redact) };
  const created = await step(run, `the ${run.route.channel} tracker create`, () => run.route.tracker.create(draft));
  return created.ok
    ? settle(run, 'filed', created.value, null, supersedes)
    : resultOf(run, 'failed', { problem: created.problem });
}

/** Comments on the issue the bug recurs in, answering `action` once the comment is made. */
async function commentOn(
  run: BugRun,
  ref: IssueRef,
  foundBy: RecurrenceSource,
  action: 'commented' | 'inherited' = 'commented',
): Promise<BugTriage> {
  const commented = await step(run, `the ${run.route.channel} tracker comment`, () => run.route.tracker.comment(ref, run.filing.comment));
  if (!commented.ok) return resultOf(run, 'failed', { ref, foundBy, problem: commented.problem });
  return foundBy === 'store'
    ? resultOf(run, action, { ref, foundBy })
    : settle(run, action, ref, foundBy);
}

/** The issue a bug's key found, and how. */
interface Recurrence {
  readonly ref: IssueRef;
  readonly foundBy: RecurrenceSource;
}

/**
 * The issue a bug's key finds: the stored reference under the key, then
 * each legacy key, then `find` for the redacted key; null when none is
 * found, or the failed result of the step that failed.
 */
async function lookUp(run: BugRun, key: string, searchText: string): Promise<StepOutcome<Recurrence | null>> {
  const { route, filing } = run;
  const { readStored } = route;
  if (readStored !== null) {
    for (const storedKey of [key, ...filing.legacyKeys]) {
      const stored = await step(run, 'reading the stored reference', () => readStored(storedKey));
      if (!stored.ok) return stored;
      if (stored.value !== null && stored.value.kind === route.tracker.kind) {
        return { ok: true, value: { ref: stored.value, foundBy: 'store' } };
      }
    }
  }

  const found = await step(run, `the ${route.channel} tracker find`, () => route.tracker.find({ text: searchText, type: 'bug' }));
  if (!found.ok) return found;
  const [match] = found.value;
  return {
    ok: true,
    value: match === undefined
      ? null
      : { ref: match, foundBy: 'find' },
  };
}

/** The issue states closed as completed: a bug back after one is filed again; see the module note. */
export const COMPLETED_ISSUE_STATES: readonly IssueState[] = ['done', 'released'];

/**
 * Answers a recurrence: on a route that reads state, the issue found is
 * read first, and one closed as completed is superseded by a new issue,
 * while any other is commented on; a read that fails answers `failed`.
 * See the module note.
 */
async function answerRecurrence(run: BugRun, { ref, foundBy }: Recurrence): Promise<BugTriage> {
  if (!run.route.readsState) return commentOn(run, ref, foundBy);

  const issue = await step(run, `the ${run.route.channel} tracker get`, () => run.route.tracker.get(ref));
  if (!issue.ok) return resultOf(run, 'failed', { ref, foundBy, problem: issue.problem });
  return COMPLETED_ISSUE_STATES.includes(issue.value.state)
    ? fileNew(run, ref)
    : commentOn(run, ref, foundBy);
}

/** Looks the bug up by its key, then answers what is found or files it. */
async function triageBug(run: BugRun): Promise<BugTriage> {
  const { key, searchText } = run.filing;
  if (key === null || searchText === null) return fileNew(run);

  const found = await lookUp(run, key, searchText);
  if (!found.ok) return resultOf(run, 'failed', { problem: found.problem });
  return found.value === null
    ? fileNew(run)
    : answerRecurrence(run, found.value);
}

/**
 * Answers a bug the run inherited: files nothing, and comments on the
 * open issue its key finds unless its key was commented on this run,
 * adding the key to `commented` once it is; see the module note.
 */
async function triageInherited(run: BugRun, commented: Set<string>): Promise<BugTriage> {
  const { key, searchText } = run.filing;
  if (key === null || searchText === null || commented.has(key)) return resultOf(run, 'inherited');

  const found = await lookUp(run, key, searchText);
  if (!found.ok) return resultOf(run, 'failed', { problem: found.problem });
  if (found.value === null) return resultOf(run, 'inherited');

  const { ref, foundBy } = found.value;
  const issue = await step(run, `the ${run.route.channel} tracker get`, () => run.route.tracker.get(ref));
  if (!issue.ok) return resultOf(run, 'failed', { ref, foundBy, problem: issue.problem });
  if (!isOpenIssueState(issue.value.state)) return resultOf(run, 'inherited');

  const result = await commentOn(run, ref, foundBy, 'inherited');
  if (result.action === 'inherited') commented.add(key);
  return result;
}

/** A bug's `what` and artifact with their local paths taken out, as its key reads them. */
function localBug(bug: ReportBug, what: string, local: (text: string) => string): Pick<ReportBug, 'what' | 'artifact'> {
  const artifact = artifactOf(bug);
  return {
    what: local(what),
    artifact: artifact === null
      ? null
      : local(artifact),
  };
}

/** A bug nothing was called for: its row, on the channel it was read onto. */
function skippedRow(index: number, channel: BugChannel, problem: string): BugTriage {
  return { index, channel, action: 'skipped', ref: null, foundBy: null, stored: null, problem };
}

/**
 * The one line a machine-scoped bug's row carries, for the operator to
 * read: the bug's place in the report, then the family and the text that
 * matched. Redacted, as every problem this module answers is.
 */
function machineProblem(
  index: number,
  fault: MachineFault,
  redact: (text: string) => string,
): string {
  return redact(`out_of_scope_bugs[${index}] is ${machineFaultSentence(fault)}`);
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
 * tracker line, then files, or comments on, each out-of-scope bug
 * through the channel it is routed to — the machine one, which files
 * nothing, when the machine-fault reading answers, and otherwise the one
 * its `security` flag names — and answers what became of each; see the
 * module note.
 *
 * Rejects, having written and called nothing, only for a private tracker
 * it refuses. Every other failure is answered in the result.
 */
export async function triageReport(options: TriageOptions): Promise<TriageResult> {
  const { repoRoot } = options;
  const privateTracker = options.privateTracker ?? createPrivateTriageTracker(repoRoot);
  checkPrivateTracker(options.tracker, privateTracker);

  const blocker = triageBlockers(options);
  const local = localPathRedactor(repoRoot, options.home ?? homedir());
  const redact = (text: string): string => redactSecrets(local(text), options.secrets);
  const verifyRefs = options.verifyRefs ?? createArtifactRefsVerifier(repoRoot);
  const routes: Readonly<Record<TrackedChannel, Route>> = {
    public: {
      channel: 'public',
      tracker: options.tracker,
      readStored: (key) => readTrackerRef(repoRoot, key),
      store: (key, ref, supersedes) => writeTrackerRef(repoRoot, {
        dispatch: options.dispatch,
        outcome: options.outcome,
        artifact: key,
        ref,
        ...supersedes === undefined
          ? {}
          : { supersedes },
      }, options.seams).action,
      readsState: true,
    },
    private: { channel: 'private', tracker: privateTracker, readStored: null, store: null, readsState: false },
  };

  const bugs: BugTriage[] = [];
  for (const [index, bug] of options.report.outOfScopeBugs.entries()) {
    const fault = readMachineFault(bug);
    if (fault !== null) {
      bugs.push(skippedRow(index, 'machine', machineProblem(index, fault, redact)));
      continue;
    }
    const route = bug.security === false
      ? routes.public
      : routes.private;
    const what = bug.what;
    if (!hasText(what)) {
      bugs.push(skippedRow(index, route.channel, `out_of_scope_bugs[${index}] has no what to file`));
      continue;
    }
    const filing = await filingFor(what, bug, options, local, redact, verifyRefs);
    const run: BugRun = { route, index, filing, redact };
    const { inherited } = options;
    const isInherited = route.channel === 'public'
      && inherited !== undefined
      && inheritedFailureOf(localBug(bug, what, local), inherited.failures) !== null;
    bugs.push(isInherited
      ? await triageInherited(run, inherited.commented)
      : await triageBug(run));
  }
  return { blocker, bugs };
}
