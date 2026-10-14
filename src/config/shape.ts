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
 * Core declares {@link ConfigShape} with its own top-level keys, the
 * keys of `src/core/config/core-section.ts`. The eleven section files
 * (`src/config-schema-*.ts`) add theirs by declaration merging, a
 * `declare module` on this file beside the one each writes on
 * `src/core/config/config-schema.ts` for `RafaConfig`, so this module
 * names no section file and nothing here imports one.
 *
 * A namespace two packages share is a named interface here that each
 * adds its keys to: {@link LoopShape}, {@link BoardShape},
 * {@link BoardProjectShape} and {@link DangerousShape}. A property
 * declared twice across augmentations is a compile error, so a section
 * adds no top-level key core declares, and core declares no namespace
 * it holds no key of: `pr` and `release` are the `release` section's
 * own, declared there, since an interface core left empty for them
 * would be refused by `@typescript-eslint/no-empty-object-type`.
 *
 * `naming.branch` is declared ahead of its setting: no section reads it
 * yet, and `shape.test.ts` names it as the one leaf no setting holds.
 * That test reads every other leaf back as a setting's key and every
 * setting's key as a leaf, so a key added to a section without its leaf
 * here, or the other way round, fails there.
 *
 * Every type is `import type`, so this module loads nothing.
 */
import type {
  ModuleSourceKind,
  PrerequisiteKind,
} from '../core/config/index.js';
import type {
  BoardRelationshipMode,
  ClaimsAhead,
  ClaimsStaleAfter,
  ConfigVersion,
  InjectMode,
  LessonSwitch,
  OutputMode,
  RouteTarget,
  SkillResolverName,
  StoreBackend,
  SyncStrategy,
  TierPin,
  TierSwitch,
} from '../core/config/sections.js';

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
 * `loop-retries`, `loop-continue` and `wrap-up` sections add.
 */
export interface LoopShape {
  /** `loop.settingSources`: a comma-separated subset of `user`, `project`, `local`. */
  readonly settingSources: string;
  /** `loop.worktreeDir`: where the loop's worktrees are made. */
  readonly worktreeDir: string;
}

/** The `board.project` namespace: core's two keys and the `board-project` section's limits. */
export interface BoardProjectShape {
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
 * otherwise refuses. Core's two, and the one the `release` section adds.
 */
export interface DangerousShape {
  /** `dangerous.acceptStaleRefs`. */
  readonly acceptStaleRefs: boolean;
  /** `dangerous.selfUpdateDuringLoop`. */
  readonly selfUpdateDuringLoop: boolean;
}

/** The nested file shape; see the module note. */
export interface ConfigShape {
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
  /** The `naming` keys. */
  readonly naming: {
    /** `naming.branch`: a branch name template holding `{stub}`, declared ahead of its setting. */
    readonly branch: string;
  };
}
