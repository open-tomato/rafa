/**
 * The package's ports: the five interfaces core defines for an adapter
 * to implement, declared as types with no implementation behind any of
 * them.
 *
 * The spec's `exports` map names this module's build as the `./ports`
 * subpath, declared in phase 0 and filled in phase 1. Phase 1 puts one
 * adapter per port under `src/adapters/` and lets an add-on register
 * more by name; core imports an add-on only from a `path` source the
 * config's `allowList:` names (`src/modules/load.ts`). What those adapters
 * implement is declared here first, so a service (the orchestrator's
 * worker pool, a Drizzle-backed store) can type an implementation
 * against the subpath without importing the CLI.
 *
 * ## Types, and nothing else
 *
 * The entry exports no runtime value, so importing it runs nothing and
 * adds nothing to a service's bundle. Its one import is an `import
 * type`, which the bundler erases, so naming {@link GeneratedPlan}'s
 * review type pulls `src/board/spec-review.ts` into no bundle. That
 * keeps three things a port could otherwise carry out of this module:
 *
 *   - The store's key projection, `EFFORT_KEY_PROJECTIONS`, which is a
 *     value. It stays on `./store`, beside the backends that read it.
 *   - The Tracker source's `as const` tuples. Each union they derived
 *     is spelled out as a literal union instead, keeping the members and
 *     dropping the tuple, so nothing here enumerates them at runtime.
 *   - The number core compares a port version against. The modules spec
 *     gives every port a version and has core refuse a module whose
 *     version it no longer serves. Each version is declared here as a
 *     number literal type, gathered in {@link PortVersions} under the
 *     port types the adapter registry keys by. The number core compares
 *     is `PORT_VERSIONS` in `src/adapters/registry.ts`, held equal to
 *     these literals there.
 *
 * ## Where each port comes from
 *
 *   - {@link Tracker}: copied from open-tomato's
 *     `packages/shared/issue-tracker/src/port.ts` at commit
 *     `45aaab563e5b4f4e6258e19ebf752b7cfeb67bf0` (2026-08-05). The phase
 *     1 spec asks for a copy rather than a dependency, with its source
 *     commit recorded, so the monorepo can later be pointed at this
 *     export and the port does not live twice. Member types and their
 *     TSDoc are carried over as written, so they speak of open-tomato's
 *     OPT numbers, CLI and ledger, with two exceptions: {@link TrackerKind}
 *     is opened, and the note on `IssueRef.externalId` names the `local`
 *     adapter's issue number where the source named a file path. Left
 *     out: `BOARD_COLUMNS`, `CLOSED_STATES` and `GITHUB_ISSUE_TYPES`,
 *     which are values and the GitHub adapter's projections, and
 *     `LedgerEntry`, the local ledger's line. rafa ports no OPT ledger,
 *     so the degradation chain (`src/adapters/tracker/resolve.ts`)
 *     arrived without it, and the `local` adapter records the reason the
 *     chain hands it in each issue file instead.
 *   - {@link Store}: the effort store port phase 0 already built, in
 *     `src/effort/store/types.ts`, re-exported under the port's name
 *     rather than declared again. `Store` is `EffortStore`, and the rows
 *     and results it is typed against come with it.
 *   - {@link Learning}: `distributed-learning-library.md`, "rafa's
 *     Learning port", with the records it passes taken from that spec's
 *     package shape. That library, phase 5's, will own the records; the
 *     port imports them from it once it exists.
 *   - {@link Output}: open-tomato's `packages/shared/cli-core`, the
 *     events from `src/events.ts` at
 *     `2b00895eaec9edcdce02839831429da97441c0f5` and the interface from
 *     `src/output.ts` at `18f94c843fff1bce65ed2245f8712ed9b64a2d51`
 *     (both 2026-06-25), where it is named `CliOutput`. The source's
 *     `text` and `json` factories are the two adapters phase 1 ports.
 *   - {@link Planner}: no spec gives it a signature. The phase 1 table
 *     names its core adapter as today's `plan.ts`, so the request and the
 *     answer are read off what `rafa plan` takes and leaves behind.
 *
 * ## Property signatures
 *
 * Every function a port declares is a function-typed property, never a
 * method, as the store port's already are. TypeScript compares a
 * method's parameters bivariantly and a property's strictly, so an
 * adapter accepting less than the port hands it, such as a `transition`
 * taking only `done`, compiles against a method and is refused against a
 * property. The Tracker source and the Learning spec both spell methods.
 * This is the one change the Learning copy makes to a member's type; the
 * Tracker copy makes one more, opening {@link TrackerKind}.
 *
 * ## Left open for phase 1
 *
 *   - {@link MergeResult}: the spec names `discarded` and describes the
 *     rest, a list saying which rule applied to each incoming record and
 *     what it produced, without naming it. `decisions`,
 *     {@link MergeDecision} and the {@link MergeRule} names are this
 *     module's, one rule per row of the spec's merge table plus the
 *     record no existing trigger shares.
 *   - {@link PlanRequest} and {@link GeneratedPlan} carry what `rafa
 *     plan` has today. The webhook adapter phase 6 adds lands a plan on a
 *     branch, which may widen the answer.
 */
import type { SpecReviewReading } from '../board/spec-review.js';

export type {
  AppendResult,
  CommitEffortRow,
  EffortKeyProjections,
  EffortRow,
  EffortRowByKind,
  EffortRowKind,
  EffortStore as Store,
  SessionEffortRow,
  SessionMode,
} from '../effort/store/types.js';

// ---------------------------------------------------------------------
// Port versions
// ---------------------------------------------------------------------

/** The version of the {@link Tracker} port this entry declares. */
export type TrackerPortVersion = 1;

/** The version of the {@link Store} port this entry declares. */
export type StorePortVersion = 1;

/** The version of the {@link Learning} port this entry declares. */
export type LearningPortVersion = 1;

/** The version of the {@link Output} port this entry declares. */
export type OutputPortVersion = 1;

/** The version of the {@link Planner} port this entry declares. */
export type PlannerPortVersion = 1;

/**
 * Each port's version, under the port type the adapter registry keys its
 * adapters by. An adapter states the version of its port it implements,
 * and the registry refuses one core does not serve.
 */
export interface PortVersions {
  tracker: TrackerPortVersion;
  store: StorePortVersion;
  learning: LearningPortVersion;
  output: OutputPortVersion;
  planner: PlannerPortVersion;
}

/** The five port types: `tracker`, `store`, `learning`, `output` and `planner`. */
export type PortType = keyof PortVersions;

// ---------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------

/**
 * The platform a tracker adapter projects issues onto, named as the
 * adapter registry keys it.
 *
 * The source closes this over `github`, `linear` and `local`. The copy
 * keeps those three and admits any other name, because an add-on
 * registers a tracker under a kind core has never heard of (`obsidian`
 * in the phase 1 table), and the config accepts any kind name for
 * `tracker.default` and `tracker.fallback`. Whether a kind has an
 * adapter is the registry's answer, not this type's.
 *
 * `string & {}` is a string the checker does not merge with the three
 * named members. Under `| string` the union reduces to `string`, and the
 * three names are gone from the type.
 */
export type TrackerKind = 'github' | 'linear' | 'local' | (string & {});

/** What an issue is for. */
export type IssueType = 'code' | 'bug' | 'spike' | 'adr' | 'chore' | 'package-api';

/** How urgent an issue is, once triage has set it. */
export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low';

/**
 * One state per board column, plus `cancelled`, spelled in lifecycle
 * order.
 */
export type IssueState =
  | 'backlog'
  | 'todo'
  | 'in-progress'
  | 'in-review'
  | 'done'
  | 'released'
  | 'cancelled';

/** A resolved pointer to an issue on some tracker. */
export interface IssueRef {
  /** Internal OPT number — stable across trackers. */
  opt: number;
  kind: TrackerKind;
  /**
   * GitHub issue number as a string, Linear uuid, or the number the `local`
   * adapter gave the issue under `.rafa/issues/`, as a string.
   */
  externalId: string;
  url: string | null;
  /**
   * Module the issue belongs to, when the caller already knows it (e.g. from
   * a ledger entry). `transition()` on the GitHub adapter needs this to
   * resolve which project board an issue lives on; when it's absent, the
   * adapter falls back to reading the `module:` label via `get()` — an extra
   * `gh issue view` round trip that a caller who already has this for free
   * (the CLI, reading the ledger) can skip by setting it here.
   */
  module?: string;
  /**
   * `owner/name` for github refs. Absent means the configured default repo
   * (`github.repo`) — set only when the issue's module routes to a repo of
   * its own (`modules.*.repo`), so the common case stays untagged.
   */
  repo?: string;
  /**
   * Set when the issue was filed but a follow-up step failed — today, Projects
   * v2 board placement. The issue exists and MUST still be recorded in the
   * ledger; the caller is responsible for surfacing this to the user.
   */
  warning?: string;
}

/** Everything needed to create an issue, before any platform is chosen. */
export interface IssueDraft {
  opt: number;
  title: string;
  body: string;
  type: IssueType;
  module: string;
  /** null means triage has not set one yet — the adapter applies needs-triage. */
  priority: IssuePriority | null;
  /** Project/board name, or null when the tracker has no project concept. */
  project: string | null;
  /** OPT numbers this issue is blocked by. */
  blockedBy: readonly number[];
}

/** An issue as a tracker holds it: the draft, where it lives, its state. */
export interface Issue extends IssueDraft {
  ref: IssueRef;
  state: IssueState;
}

/** What `find` narrows by; an absent field narrows by nothing. */
export interface IssueQuery {
  module?: string;
  text?: string;
  type?: IssueType;
  state?: IssueState;
  limit?: number;
}

/** What a tracker's platform supports beyond issues themselves. */
export interface TrackerCapabilities {
  /** Supports project/board grouping (GitHub Projects v2, Linear projects). */
  projects: boolean;
  /** Supports custom single-select fields (priority as a board field). */
  customFields: boolean;
  /** Supports native issue types (GitHub org issue types). */
  issueTypes: boolean;
}

/** A preflight's answer: reachable, or the reason it is not. */
export type PreflightResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Outcome of a `transition()` call. Mirrors `IssueRef.warning`'s convention
 * rather than inventing a new shape: the transition's primary write (the
 * tracker's own open/closed or workflow state) succeeded — otherwise
 * `transition()` throws — but a secondary write (the GitHub adapter's board
 * column) may not have landed. `warning` set means exactly that: the caller
 * MUST NOT treat this as a full success, and — for callers that persist a
 * state claim of their own (the ledger) — must not persist that claim when a
 * board-shaped warning says the board never received it.
 */
export interface TransitionResult {
  warning?: string;
}

/**
 * An issue tracker: where `loop start` files what a task report's
 * out-of-scope bugs name, through its triage (`start/triage.ts`, over
 * `triage/triage.ts`). A report's blockers are written onto its task's
 * tracker line instead.
 */
export interface Tracker {
  readonly kind: TrackerKind;
  capabilities: () => TrackerCapabilities;
  /** Cheap reachability/auth probe. Must not throw — returns a reason instead. */
  preflight: () => Promise<PreflightResult>;
  find: (query: IssueQuery) => Promise<IssueRef[]>;
  get: (ref: IssueRef) => Promise<Issue>;
  create: (draft: IssueDraft) => Promise<IssueRef>;
  comment: (ref: IssueRef, body: string) => Promise<void>;
  transition: (ref: IssueRef, state: IssueState) => Promise<TransitionResult>;
}

// ---------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------

/**
 * One instinct: a trigger, the action to take on it, and how far to
 * trust that action. The fields are snake case, as the spec spells the
 * record a sync payload carries.
 */
export interface InstinctRecord {
  id: string;
  trigger: string;
  action: string;
  /** `sha256(trim(lower(action)))`: two records share an action by it. */
  action_hash: string;
  /** From 0.3 to 0.9. */
  confidence: number;
  /** The weight a merge gives the confidence, and sums on a match. */
  usage_count: number;
  /** The recurrence key; phase 2's field. */
  artifact?: string;
  signal: 'loud' | 'silent';
  /** A `flagged` record is excluded from every blessed bundle. */
  status: 'active' | 'flagged';
  created_at: string;
  updated_at: string;
}

/**
 * What one source pushes. Under the `local` adapter the source is the
 * task's session id, so two tasks of one plan are two sources.
 */
export interface SyncPayload {
  source_id: string;
  instincts: InstinctRecord[];
}

/** What a pull answers: the instincts blessed for injection. */
export interface BlessedBundle {
  version: string;
  instincts: InstinctRecord[];
}

/**
 * The rule a merge applied to one incoming record, one per row of the
 * spec's merge table plus the record whose trigger nothing shares:
 *
 *   - `new-trigger`: no held record shares the trigger, so it is kept.
 *   - `same-action`: the same `action_hash`, so the confidences are
 *     weighted by usage and the usage counts summed.
 *   - `higher-confidence`: a different action, confidences more than
 *     0.10 apart, so the higher one wins.
 *   - `flagged`: a different action, confidences within 0.10, so both
 *     are kept and flagged.
 */
export type MergeRule = 'new-trigger' | 'same-action' | 'higher-confidence' | 'flagged';

/** Which rule applied to one incoming record, and what it produced. */
export interface MergeDecision {
  incoming: InstinctRecord;
  rule: MergeRule;
  /** The records the trigger is held as once the rule has applied. */
  produced: InstinctRecord[];
}

/** What a push did, so a consumer can log each decision. */
export interface MergeResult {
  /** One per incoming record, in the payload's order. */
  decisions: MergeDecision[];
  /** The records a higher-confidence action displaced; none is deleted. */
  discarded: InstinctRecord[];
}

/**
 * The learning tunnel: findings go in as instincts, blessed instincts
 * come out for dispatch to inject. The modules spec closes it to third
 * parties; there is core's `local` adapter and a first-party `remote`
 * one, never a second source of blessed instincts.
 */
export interface Learning {
  /** Merges one source's instincts into what the adapter holds. */
  push: (payload: SyncPayload) => Promise<MergeResult>;
  /** The instincts currently blessed. */
  pullBlessed: () => Promise<BlessedBundle>;
  /** Flags one instinct by id, keeping it out of every later bundle. */
  flag: (id: string, reason: string) => Promise<void>;
}

// ---------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------

/** A command began. `ts` is an ISO 8601 timestamp on every event. */
export interface CliEventStart {
  type: 'start';
  command: string;
  ts: string;
}

/** A named step of the command began. */
export interface CliEventStep {
  type: 'step';
  name: string;
  ts: string;
}

/** One message at one level. */
export interface CliEventLog {
  type: 'log';
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  ts: string;
}

/** The command's outcome: its data when it succeeded, its error when not. */
export interface CliEventResult {
  type: 'result';
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
  ts: string;
}

/** Every event an output renders, closed over its four kinds. */
export type CliEvent = CliEventStart | CliEventStep | CliEventLog | CliEventResult;

/**
 * Where a command's output goes: a terminal's text, or NDJSON events a
 * service or the TUI reads. Phase 1 routes the sibling's `console.log`
 * calls through it.
 */
export interface Output {
  /** A message at `info`. */
  info: (message: string) => void;
  /** A message at `warn`. */
  warn: (message: string) => void;
  /** A message at `error`. */
  error: (message: string) => void;
  /** A message at `debug`. */
  debug: (message: string) => void;
  /** One event, rendered as the adapter renders its kind. */
  emit: (event: CliEvent) => void;
  /** The command's answer. */
  result: (payload: unknown) => void;
}

// ---------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------

/**
 * One plan to generate, from one spec. The adapter is bound to a
 * repository when it is made, as a store is opened on a root, so the
 * paths here are that repository's.
 */
export interface PlanRequest {
  /** The spec, as `--spec=` names it: repository-relative or absolute. */
  specPath: string;
  /** The plan's stub. `rafa plan` defaults it to the spec's basename. */
  stub: string;
}

/**
 * Where a planner left the plan it generated: repository-relative, or
 * absolute when the directory it writes plans into is.
 */
export interface GeneratedPlan {
  /** The plan: `PLAN-<stub>.md` in `plan.dir` under today's planner. */
  planPath: string;
  /**
   * The setup steps the planner found no task could automate, or null
   * when it wrote none: `PREREQUISITES-<stub>.md` in `plan.dir` today.
   */
  prerequisitesPath: string | null;
  /**
   * What the planner's own session said about the spec BEFORE it
   * planned, read out of that session's output: the `rafa:spec-review`
   * block of the readiness gate's check 3
   * (`src/board/spec-review.ts`).
   *
   * Optional, because a planner that reads no session output has judged
   * nothing and must still satisfy this port — the fixture planners the
   * command's tests resolve, and the `webhook` adapter phase 6 adds.
   * The `claude` adapter carries one on every plan it answers, `absent`
   * when its session returned no block. Nothing here acts on it: the
   * gate is `rafa plan`'s, which is what lets `--skip-review` weigh a
   * verdict the planner still read.
   */
  review?: SpecReviewReading;
}

/**
 * Generates a plan from a spec: core's `claude` adapter runs a Claude
 * Code session, as `rafa plan` does, and phase 6's `webhook` adapter
 * hands the spec to hyperloop's plan-to-branch.
 */
export interface Planner {
  /**
   * Generates the plan. Rejects when none was generated: the session
   * failed, or it finished without writing the plan.
   */
  create: (request: PlanRequest) => Promise<GeneratedPlan>;
}
