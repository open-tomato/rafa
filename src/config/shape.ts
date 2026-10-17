/**
 * The nested file shape: {@link ConfigShape}, every key a config file
 * writes, nested as the file nests it (`plan: { inject: 'stage' }` for
 * `plan.inject`), each leaf typed as the file spells it. It is the type a
 * `rafa.config.ts` entry is a deep partial of (`entry.ts`), and the
 * `./config` subpath (`index.ts`) publishes it.
 *
 * ## The file's spelling, not the resolved value
 *
 * A leaf holds what the setting's reader accepts, which is not always
 * what `RafaConfig` resolves it to. A map (`routing`, `tiers.skills`,
 * `tiers.agents`, `logger.modules`) is a plain object here and a
 * `ReadonlyMap` there; `loop.settingSources` is the comma-separated
 * string the file writes (`project,local`) and a list there; an item of
 * `prerequisites.required` or `modules` names its kind by its key
 * (`{ tool: 'bun' }`, `{ npm: 'rafa-board' }`) where the resolved item
 * carries `kind` and `name`; and a setting whose default is null
 * (`pr.base`, `hub.url`) takes no null, since no reader accepts one.
 *
 * ## Who declares what
 *
 * This module declares core's own top-level keys, the keys of
 * `packages/rafa/src/core/config/core-section.ts`, and composes {@link ConfigShape}
 * from them and the interface each of the thirteen section files
 * (`src/config-schema-*.ts`) exports for the keys it writes: `HubShape`
 * for `hub`, `ReleaseShape` for `pr` and `release`, and so on, each
 * extended by {@link ConfigShape}. A namespace two packages share is a
 * named interface here holding core's keys and extending the part each
 * section exports as an interface of its own: {@link LoopShape} extends
 * `LoopRetriesShape`, `LoopContinueShape` and `WrapUpShape`,
 * {@link BoardProjectShape} extends `BoardProjectLimitsShape`, and
 * {@link DangerousShape} extends `ReleaseDangerousShape`.
 *
 * The composition is written out, not merged into this file by a
 * section's `declare module`, so the declaration emitted for this file
 * imports each section's emitted declaration and a reader of the
 * `./config` subpath's `.d.ts` files alone sees every key.
 * `shape.test.ts` emits the declarations in memory over
 * `src/config/index.ts` and reads `ConfigShape['hub']['url']` as
 * `string` from them.
 *
 * `shape.test.ts` reads every leaf back as a setting's key and every
 * setting's key as a leaf, so a key added to a section without its leaf
 * here, or the other way round, fails there.
 *
 * Every type is `import type`, so this module loads nothing.
 */
import type { BoardProjectLimitsShape } from '../config-schema-board-project.js';
import type { BugsShape } from '../config-schema-bugs.js';
import type { ChecksShape } from '../config-schema-checks.js';
import type { ErrorsShape } from '../config-schema-errors.js';
import type { FeaturesShape } from '../config-schema-features.js';
import type { HubShape } from '../config-schema-hub.js';
import type { IssuesShape } from '../config-schema-issues.js';
import type { LoggerShape } from '../config-schema-logger.js';
import type { LoopContinueShape } from '../config-schema-loop-continue.js';
import type { LoopRetriesShape } from '../config-schema-loop-retries.js';
import type { ReleaseDangerousShape, ReleaseShape } from '../config-schema-release.js';
import type { TestsShape } from '../config-schema-tests.js';
import type { TriageShape } from '../config-schema-triage.js';
import type { WrapUpShape } from '../config-schema-wrap-up.js';
import type {
  ModuleSourceKind,
  PrerequisiteKind,
} from '@open-tomato/rafa/core/config';
import type {
  BoardRelationshipMode,
  ClaimsAhead,
  ClaimsStaleAfter,
  ConfigVersion,
  DuplicatesLevel,
  InjectMode,
  LessonSwitch,
  OutputMode,
  RouteTarget,
  SkillResolverName,
  StoreBackend,
  SyncStrategy,
  TierPin,
  TierSwitch,
} from '@open-tomato/rafa/core/config/sections';

/**
 * An item keyed by its kind: one of `K` as its key, naming the item.
 * `KindKeyed<'tool' | 'env'>` is `{ tool: string } | { env: string }`.
 */
type KindKeyed<K extends string> = { readonly [P in K]: { readonly [Q in P]: string } }[K];

/** One `prerequisites.required` item as a file writes it: `{ tool: 'bun', probe: 'bun --version' }`. */
export type PrerequisiteFileItem = KindKeyed<PrerequisiteKind> & {
  /** The command that proves the item; left out or null to check presence alone. */
  readonly probe?: string | null;
};

/** One `prerequisites.optional` item as a file writes it: a required item's keys and `reason`. */
export type OptionalPrerequisiteFileItem = PrerequisiteFileItem & {
  /** Why the item helps, for the line naming it missing. */
  readonly reason?: string | null;
};

/**
 * One `modules` entry as a file writes it: `{ npm: 'rafa-board' }`,
 * `{ path: '../board' }`, or `{ github: 'owner/repo', ref: 'v1' }`.
 */
export type ModuleFileItem =
  | KindKeyed<Exclude<ModuleSourceKind, 'github'>>
  | {
    /** The `owner/repo` the module is cloned from. */
    readonly github: string;
    /** The git ref to check out; left out or null for the default branch. */
    readonly ref?: string | null;
  };

/**
 * The `loop` namespace: core's two keys, and the keys the
 * `loop-retries`, `loop-continue` and `wrap-up` sections write.
 */
export interface LoopShape extends LoopRetriesShape, LoopContinueShape, WrapUpShape {
  /** `loop.settingSources`: a comma-separated subset of `user`, `project`, `local`. */
  readonly settingSources: string;
  /** `loop.worktreeDir`: where the loop's worktrees are made. */
  readonly worktreeDir: string;
}

/** The `board.project` namespace: core's two keys and the `board-project` section's limits. */
export interface BoardProjectShape extends BoardProjectLimitsShape {
  /** `board.project.template`: the project board copied for a new board. */
  readonly template: string;
  /** `board.project.number`: the project board this repository's issues go on. */
  readonly number: number;
}

/** The `board` namespace, core's, with the shared {@link BoardProjectShape} under `project`. */
export interface BoardShape {
  /** `board.trustedAuthors`: the GitHub logins whose board items are read without a prompt. */
  readonly trustedAuthors: readonly string[];
  /** `board.relationships`: how a parent and its children are linked. */
  readonly relationships: BoardRelationshipMode;
  /** The `board.project` keys. */
  readonly project: BoardProjectShape;
}

/**
 * The `dangerous` namespace: each key a person's consent to a step rafa
 * otherwise refuses. Core's two, and the one the `release` section writes.
 */
export interface DangerousShape extends ReleaseDangerousShape {
  /** `dangerous.acceptStaleRefs`. */
  readonly acceptStaleRefs: boolean;
  /** `dangerous.selfUpdateDuringLoop`. */
  readonly selfUpdateDuringLoop: boolean;
}

/** The nested file shape: core's keys, and each section's; see the module note. */
export interface ConfigShape extends
  BugsShape,
  ChecksShape,
  ErrorsShape,
  FeaturesShape,
  HubShape,
  IssuesShape,
  LoggerShape,
  ReleaseShape,
  TestsShape,
  TriageShape {
  /** `version`: the config format's version. */
  readonly version: ConfigVersion;
  /** `store`: the effort store's backend. */
  readonly store: StoreBackend;
  /** The `effort` keys. */
  readonly effort: {
    readonly busyTimeoutMs: number;
    readonly sync: SyncStrategy;
  };
  /** The `plan` keys. */
  readonly plan: {
    readonly inject: InjectMode;
    readonly dir: string;
  };
  /** The `specs` keys. */
  readonly specs: {
    readonly dir: string;
  };
  /** The `tracker` keys. */
  readonly tracker: {
    readonly default: string;
    readonly fallback: readonly string[];
  };
  /** The `learning` keys. */
  readonly learning: {
    readonly adapter: string;
    readonly bless: {
      readonly minConfidence: number;
    };
    readonly promote: {
      readonly after: number;
      readonly minConfidence: number;
    };
  };
  /** The `output` keys. */
  readonly output: {
    readonly mode: OutputMode;
  };
  /** The `prerequisites` keys. */
  readonly prerequisites: {
    readonly required: readonly PrerequisiteFileItem[];
    readonly optional: readonly OptionalPrerequisiteFileItem[];
  };
  /** The `tracking` keys. */
  readonly tracking: {
    readonly specs: boolean;
    readonly plans: boolean;
    readonly all: boolean;
  };
  /** `modules`: where each module is installed from. */
  readonly modules: readonly ModuleFileItem[];
  /** `allowList`. */
  readonly allowList: readonly string[];
  /** The `loop` keys. */
  readonly loop: LoopShape;
  /** The `board` keys. */
  readonly board: BoardShape;
  /** The `roadmap` keys. */
  readonly roadmap: {
    readonly issue: number;
  };
  /** The `claims` keys. */
  readonly claims: {
    readonly staleAfter: ClaimsStaleAfter;
    readonly ahead: ClaimsAhead;
  };
  /** The `cleanup` keys. */
  readonly cleanup: {
    readonly staleDays: number;
    readonly worktreeIdleDays: number;
    readonly keep: readonly string[];
  };
  /** The `dangerous` keys. */
  readonly dangerous: DangerousShape;
  /** The `status` keys. */
  readonly status: {
    readonly notice: boolean;
  };
  /** The `tiers` keys, each map a name to `false` or a tier. */
  readonly tiers: {
    readonly rafa: TierSwitch;
    readonly skills: Readonly<Record<string, TierPin>>;
    readonly agents: Readonly<Record<string, TierPin>>;
  };
  /** `routing`: a task shape to an agent, or `false`. */
  readonly routing: Readonly<Record<string, RouteTarget>>;
  /** The `task` keys. */
  readonly task: {
    readonly skills: SkillResolverName;
    readonly lessons: LessonSwitch;
  };
  /** The `merge` keys. */
  readonly merge: {
    /** `merge.duplicates`: how two entries of one file setting one key are reported. */
    readonly duplicates: DuplicatesLevel;
  };
  /** The `naming` keys. */
  readonly naming: {
    /** `naming.branch`: the template the branch `loop start` creates is named from, holding `{stub}` once. */
    readonly branch: string;
  };
  /** `templates`: the config templates this file adopts, by name. */
  readonly templates: readonly string[];
}
