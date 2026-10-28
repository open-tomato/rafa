/**
 * The type half of rafa's settings: {@link RafaConfig}, the name of a
 * setting, the settings a command line can name, and what a section
 * knows about each setting it defines. This module declares types alone
 * and exports no value: which settings exist at runtime, the file key
 * each is spelled with, its reader and its default are the sections'
 * to say.
 *
 * {@link RafaConfig} declares core's own fields here, and nothing else.
 * Their file keys, readers and defaults are `core-section.ts`'s, which
 * hands them in as `CORE_SECTION`. The other fields are the eleven
 * section files' (`src/config-schema-*.ts`), each declaring its own
 * interface and adding it to {@link RafaConfig} by declaration merging,
 * a `declare module` on this file, so this module names no section file
 * and {@link ConfigSetting} still names every setting. Nothing merged —
 * the settings record, the defaults, the key indexes — is exported
 * here: `src/config-registry.ts` merges the sections into them, and
 * core reads the registered ones off `section.ts`.
 *
 * `config.ts` re-exports {@link RafaConfig}, {@link ConfigSetting} and
 * {@link CommandLineSetting}, and the config barrel `index.ts` every
 * name here, so nothing outside `packages/rafa/src/core/config/` imports this file.
 */
import type {
  ModuleSource,
  OptionalPrerequisiteItem,
  PrerequisiteItem,
} from './config-items.js';
import type {
  BoardRelationshipMode,
  ClaimsAhead,
  ClaimsStaleAfter,
  ClaudeSettingSource,
  ConfigVersion,
  DuplicatesLevel,
  InjectMode,
  LessonSwitch,
  OutputMode,
  Reader,
  RouteTarget,
  SkillResolverName,
  StoreBackend,
  SyncStrategy,
  TierPin,
  TierSwitch,
} from './config-sections.js';

/**
 * Every setting, resolved. The fields below are core's, each naming the
 * file key it holds; `core-section.ts` gives each its spec and default.
 * A section file's fields join them by declaration merging, as the
 * module note says.
 */
export interface RafaConfig {
  /** The schema version the file was written for. `version`. */
  version: ConfigVersion;
  /** The backend the effort store writes through. `store`. */
  store: StoreBackend;
  /**
   * How long an effort store open waits for another process's write
   * lock, in milliseconds. `effort.busyTimeoutMs`.
   */
  effortBusyTimeoutMs: number;
  /** How the effort store travels between devices. `effort.sync`. */
  effortSync: SyncStrategy;
  /** How much of the plan a task prompt receives. `plan.inject`. */
  inject: InjectMode;
  /** Where plans are written and read. `plan.dir`. */
  planDir: string;
  /** Where specs are read. `specs.dir`. */
  specsDir: string;
  /** The tracker kind tried first. `tracker.default`. */
  trackerDefault: string;
  /** The tracker kinds tried next, in order. `tracker.fallback`. */
  trackerFallback: readonly string[];
  /** The learning adapter kind. `learning.adapter`. */
  learningAdapter: string;
  /** The least confidence a lesson tasks may use. `learning.bless.minConfidence`. */
  learningBlessMinConfidence: number;
  /** The distinct sources a lesson needs to be promotable. `learning.promote.after`. */
  learningPromoteAfter: number;
  /** The least confidence of a promotable lesson. `learning.promote.minConfidence`. */
  learningPromoteMinConfidence: number;
  /** How commands write their output. `output.mode`. */
  outputMode: OutputMode;
  /** Items whose failure halts a run. `prerequisites.required`. */
  prerequisitesRequired: readonly PrerequisiteItem[];
  /** Items whose failure is only named. `prerequisites.optional`. */
  prerequisitesOptional: readonly OptionalPrerequisiteItem[];
  /** Whether `.rafa/specs/` is tracked by git. `tracking.specs`. */
  trackingSpecs: boolean;
  /** Whether `.rafa/plans/` is tracked by git. `tracking.plans`. */
  trackingPlans: boolean;
  /** Whether all of `.rafa/` is tracked by git. `tracking.all`. */
  trackingAll: boolean;
  /** Where modules are installed from. `modules`. */
  modules: readonly ModuleSource[];
  /** The module names enabled. `allowList`. */
  allowList: readonly string[];
  /** What each spawned session loads settings from. `loop.settingSources`. */
  settingSources: readonly ClaudeSettingSource[];
  /**
   * The directory a loop adds its worktrees under, read from the
   * project root. `loop.worktreeDir`.
   */
  loopWorktreeDir: string;
  /**
   * The shell command a `--as-worktree` run runs in its new or reused
   * worktree before the first session, or null to run nothing.
   * `loop.worktreeSetup`.
   */
  loopWorktreeSetup: string | null;
  /**
   * The logins trusted with board text besides the repository's own
   * write-holders. `board.trustedAuthors`.
   */
  boardTrustedAuthors: readonly string[];
  /**
   * Where the board's epics and blockers are read and written: `labels`
   * (`epic:` labels, `spec:blocked` and `Blocked by:` lines) or `native`
   * (GitHub's sub-issue parent and blocked-by links).
   * `board.relationships`.
   */
  boardRelationships: BoardRelationshipMode;
  /**
   * The GitHub project `rafa init --board` copies the board's project
   * from, by URL. `board.project.template`.
   */
  boardProjectTemplate: string;
  /**
   * The number of the GitHub project the board is mirrored to, under the
   * repository's owner, or null for a repository with no project.
   * `board.project.number`.
   */
  boardProjectNumber: number | null;
  /**
   * The issue whose task list `plan create --next` reads its order off,
   * or null for the issue titled `Roadmap`. `roadmap.issue`.
   */
  roadmapIssue: number | null;
  /**
   * How long a `rafa:claimed` claim stands before another device may
   * take it over, or `disabled`. `claims.staleAfter`.
   */
  claimsStaleAfter: ClaimsStaleAfter;
  /** Whether a claim may reach one issue ahead. `claims.ahead`. */
  claimsAhead: ClaimsAhead;
  /**
   * The age in days past which `rafa cleanup` lists a branch as Stale.
   * `cleanup.staleDays`.
   */
  cleanupStaleDays: number;
  /**
   * The idle days past which `rafa cleanup` lists a worktree.
   * `cleanup.worktreeIdleDays`.
   */
  cleanupWorktreeIdleDays: number;
  /** Glob patterns naming branches `rafa cleanup` never lists. `cleanup.keep`. */
  cleanupKeep: readonly string[];
  /**
   * Whether check 4 of the readiness gate accepts every dangling and
   * suspect reference of a spec on every run, as `--accept-refs` does
   * on one. `dangerous.acceptStaleRefs`.
   */
  dangerousAcceptStaleRefs: boolean;
  /**
   * Whether `rafa self-update` replaces the install while a loop of the
   * project is live, where it otherwise waits for that loop to finish.
   * `dangerous.selfUpdateDuringLoop`.
   */
  dangerousSelfUpdateDuringLoop: boolean;
  /**
   * Whether a command that runs inside a project prints the one-line
   * since-last-command notice on stderr. `status.notice`.
   */
  statusNotice: boolean;
  /** Whether the tier rafa ships is loaded. `tiers.rafa`. */
  tiersRafa: TierSwitch;
  /**
   * Skills turned off (`false`) or pinned to the tier that serves them,
   * by name. `tiers.skills`.
   */
  tiersSkills: ReadonlyMap<string, TierPin>;
  /**
   * Agents turned off (`false`) or pinned to the tier that serves them,
   * by name. `tiers.agents`.
   */
  tiersAgents: ReadonlyMap<string, TierPin>;
  /**
   * The agent each task shape is routed to, or `false` for a shape
   * routed nowhere. `routing`.
   */
  routing: ReadonlyMap<string, RouteTarget>;
  /** The resolver that picks each task's skills at dispatch. `task.skills`. */
  taskSkills: SkillResolverName;
  /** Whether blessed lessons join each task's prompt. `task.lessons`. */
  taskLessons: LessonSwitch;
  /**
   * How two entries of one config file setting one key are reported:
   * `warn`, `error` or `allow`. `merge.duplicates`.
   */
  mergeDuplicates: DuplicatesLevel;
  /**
   * The template a plan's branch is named from, holding `{stub}` exactly
   * once; `loop start` creates the branch it names. `naming.branch`.
   */
  namingBranch: string;
  /**
   * The config templates a file adopts, by name: each a non-empty
   * string, in the order written. `templates`.
   */
  templates: readonly string[];
}

/** The name of one setting, as a field of {@link RafaConfig}. */
export type ConfigSetting = keyof RafaConfig;

/**
 * The settings a command line can name. A flag parser hands over
 * strings, so these are the settings the file spells as one string: a
 * list, a boolean or a mapping has no command-line spelling this module
 * would have to invent.
 */
export type CommandLineSetting = 'store' | 'inject' | 'planDir' | 'specsDir'
  | 'trackerDefault' | 'learningAdapter' | 'outputMode' | 'settingSources'
  | 'taskSkills';

/** What a section knows about one setting it defines. */
export interface SettingSpec<K extends ConfigSetting> {
  /** Where the file spells it, as a dotted path. */
  key: string;
  /** The reader deciding which raw values it accepts. */
  read: Reader<RafaConfig[K]>;
  /** Whether a command line can name it; checked against the type. */
  cli: K extends CommandLineSetting
    ? true
    : false;
  /** For a list of mappings, the keys each item reads. */
  itemKeys?: readonly string[];
  /**
   * Whether the value is a map that `resolveConfig` (`config.ts`) merges
   * by key across the default, the user's file and the project's, the
   * later layer's entry winning for a key both name. Unset, a layer's
   * value replaces a lower layer's whole.
   */
  map?: true;
}
