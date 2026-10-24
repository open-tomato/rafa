/**
 * The shapes the service registry's function types are written over:
 * what a board call site hands each service and what it reads back,
 * declared in core so the call site states neither from run nor from pr.
 *
 * ## Why each is narrow
 *
 * Each declaration holds the fields a board call site passes and the
 * fields it reads, and no more. The higher package's function is checked
 * against the service type at the root's registration, where
 * `CORE_SERVICES` of `src/service-registry.ts` `satisfies RafaServices`:
 * a function that stops taking a field passed here, or answers a value
 * outside a union spelled here, fails `tsc` there. A union is therefore
 * spelled out in full rather than read off the higher package, so a
 * value that package adds is a failure at the root and not a widening
 * the call site never sees.
 *
 * ## What it imports
 *
 * Types alone, each by relative path from the file that declares it, as
 * `packages/rafa/src/core/adapters/registry.ts` imports its own: every
 * one is a file of core's package, so nothing here reaches run, pr or
 * any package after core, and no import here loads a value.
 *
 * ## The stale-docs line
 *
 * {@link StaleDocsTracker}, {@link StaleDocLineResult} and
 * {@link AddStaleDocLineOptions} moved here from
 * `src/docs/release-issue.ts`, which declares `addStaleDocLine` over
 * them and imports them from `@open-tomato/rafa/core/services`. They are
 * the whole shape of that function, so core states it with no copy.
 *
 * ## The service types
 *
 * The four function types `RafaServices` (`./registry.ts`) is keyed by
 * close the file, one per service, named for its key. They are declared
 * here rather than in the registry, so the registry imports from this
 * file alone.
 */
import type { BugRules } from '../../bugs/record.js';
import type {
  FindingOutcome,
  FindingsDispatch,
  FindingsWriterSeams,
} from '../../effort/store/findings.js';
import type { IssueRef, Tracker } from '../../ports/index.js';
import type { TaskReport } from '../../report/parse.js';
import type { NamedSecret, SecretEnvironment } from '../../triage/filed-text.js';
import type { StaleDocEntry } from '../../triage/stale-doc-line.js';
import type { RafaContext } from '../command/command.js';
import type { Prompter } from '../command/confirm.js';
import type { RafaConfig } from '../config/config-schema.js';
import type { GhRunner } from '../git/gh-runner.js';
import type { GitRunner } from '../git/git.js';

/**
 * How an ending reaches the terminal, the clock, the prompter, git,
 * `gh`, `origin` and the pids; each left out is the system's own.
 *
 * The members of run's `NextEndingSeams` chain (`src/next/ending.ts`,
 * `src/next/hint.ts`, `src/next/sources.ts`) whose types core holds.
 * `readState` and `pullRequests` are left out, since their types are
 * run's and pr's: every member is optional and the check is structural,
 * so an object carrying them still passes where this is asked, and the
 * registered function reads them at run time.
 */
export interface EndingSeams {
  /** True when a question can be answered. `process.stdin.isTTY` when left out. */
  readonly isTerminal?: () => boolean;
  /** Resolves once the hint has waited `ms`, which ends it. A real timer when left out. */
  readonly expire?: (ms: number) => Promise<void>;
  /** Opens the prompter the question is put through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
  /** Opens the runner every `gh` command goes through. `gh` spawned at the project root when left out. */
  readonly openGh?: (root: string) => GhRunner;
  /** Opens the runner every git command goes through. `createGitRunner` when left out. */
  readonly openGit?: (root: string) => GitRunner;
  /** The `origin` probe the provider is resolved by. `gitRemoteUrl` when left out. */
  readonly readRemote?: (dir: string) => string | null;
  /** Whether a pid is alive, as a session record's state is read. `isPidAlive` when left out. */
  readonly isAlive?: (pid: number) => boolean;
}

/**
 * What the `triageReport` service is handed for one report: the fields
 * `rafa epic close` passes (`src/commands/epic/close-triage.ts`), each
 * one pr's `TriageOptions` (`src/triage/triage.ts`) takes.
 */
export interface TriageServiceOptions {
  /** The repo root the store lives under. */
  readonly repoRoot: string;
  /** The tracker file holding the task's line, and half of the key of each bug naming no test case. */
  readonly trackerPath: string;
  /** The task's line, counting from zero. */
  readonly lineNum: number;
  /** The dispatch the report came from: the session, the plan stub and the task text. */
  readonly dispatch: FindingsDispatch;
  /** What the loop made of the task, stored with each reference. */
  readonly outcome: FindingOutcome;
  /** The report, as `parseReport` answered it. */
  readonly report: TaskReport;
  /** The tracker the degradation chain landed on. */
  readonly tracker: Tracker;
  /** Where security bugs go; the private `local` tracker when left out. */
  readonly privateTracker?: Tracker;
  /** The secrets every filed text is redacted of, as `namedSecrets` answers them. */
  readonly secrets: readonly NamedSecret[];
  /** The environment the run sees. */
  readonly env: SecretEnvironment;
  /** Seams for the reference write. */
  readonly seams?: FindingsWriterSeams;
  /**
   * The run's config, read for the `triage.similarity` settings. pr's
   * option is a `Pick` of it, so the whole config passes.
   */
  readonly similarity: RafaConfig;
  /** The checkout the task ran in. */
  readonly checkout: string;
  /** A git runner in {@link checkout}. */
  readonly git: GitRunner;
  /** The rules a bug record is built under, as `bugRulesOf` answers them. */
  readonly bugRules: BugRules;
}

/** Where a bug goes; pr's `BugChannel`, spelled here. */
export type TriagedChannel = 'public' | 'private' | 'machine' | 'docs';

/** What became of one bug; pr's `BugTriageAction`, spelled here, every value of it. */
export type TriagedAction =
  | 'filed'
  | 'commented'
  | 'inherited'
  | 'skipped'
  | 'failed'
  | 'repair'
  | 'follow-up'
  | 'pr-body'
  | 'docs';

/**
 * What board reads of one triaged bug, pr's `BugTriage`: the fields
 * `bugLine` (`src/commands/epic/close-triage.ts`) and `filedIssueNumber`
 * (`src/board/project/add-filed.ts`) read.
 */
export interface TriagedBug {
  readonly channel: TriagedChannel;
  readonly action: TriagedAction;
  /** The issue filed or commented on, or the one a failed step was for; else null. */
  readonly ref: IssueRef | null;
  /** Why it was skipped or failed; else null. */
  readonly problem: string | null;
}

/** What board reads of what the `triageReport` service did, pr's `TriageResult`. */
export interface TriageServiceResult {
  /** One per out-of-scope bug, in the report's order. */
  readonly bugs: readonly TriagedBug[];
  /** One per `stale_docs` entry, in the report's order. */
  readonly staleDocs: readonly TriagedBug[];
}

/**
 * What the `readStaleDocsVersion` service reads. run's
 * `StartStaleDocsConfig` (`src/start/stale-docs.ts`) is a `Pick` of
 * `RafaConfig`, so the whole config passes.
 */
export interface StaleDocsVersionOptions {
  /** The project root. */
  readonly repoRoot: string;
  /** The checkout git runs in. */
  readonly checkout: string;
  /** The run's config. */
  readonly config: RafaConfig;
}

/** What `addStaleDocLine` did with one line. */
export type StaleDocLineResult =
  /** No issue of the title was open: one was created holding the line. */
  | { readonly action: 'created'; readonly title: string; readonly ref: IssueRef }
  /** The issue was found and the line appended to its body. */
  | { readonly action: 'appended'; readonly title: string; readonly ref: IssueRef }
  /** The issue already holds the line; nothing was written. */
  | { readonly action: 'held'; readonly title: string; readonly ref: IssueRef }
  /** No tracker can hold the issue; the caller keeps the line. */
  | { readonly action: 'kept'; readonly title: string; readonly reason: string }
  /** A tracker call rejected; nothing more was tried. */
  | { readonly action: 'failed'; readonly title: string; readonly problem: string };

/** The tracker members adding a line calls. */
export type StaleDocsTracker = Pick<Tracker, 'create'> & Partial<Pick<Tracker, 'openIssues' | 'edit'>>;

/** What `addStaleDocLine` adds, and where. */
export interface AddStaleDocLineOptions {
  /** The tracker the run resolved, or null when it resolved none. */
  readonly tracker: StaleDocsTracker | null;
  /** The version the issue is titled for, from `staleDocsVersion`. */
  readonly version: string;
  /** The line to add. */
  readonly entry: StaleDocEntry;
}

/**
 * Ends a command by naming the step that follows. The call site reads
 * nothing of what it answers, so the answer is `unknown`.
 */
export type EndWithNextStepService = (context: RafaContext, seams?: EndingSeams) => Promise<unknown>;

/** Triages one report: files, comments on or skips each out-of-scope bug. */
export type TriageReportService = (options: TriageServiceOptions) => Promise<TriageServiceResult>;

/**
 * The version the stale-docs issue is titled for. The real function's
 * second parameter, the git runner, has a default and is not stated.
 */
export type ReadStaleDocsVersionService = (options: StaleDocsVersionOptions) => string;

/** Adds one line to the stale-docs issue of a version. Never rejects. */
export type AddStaleDocLineService = (options: AddStaleDocLineOptions) => Promise<StaleDocLineResult>;
