/**
 * The `pr` and `release` sections of the config schema, and the one
 * `dangerous` key the release plan adds: each setting's field, its
 * default and its spec. {@link RELEASE_SECTION} hands them to core as
 * one `ConfigSection`, package `release`, and the `declare module` below
 * adds {@link PrSettings}, {@link ReleaseSettings} and
 * {@link DangerousReleaseSettings} to `RafaConfig`.
 * {@link ReleaseShape} holds the keys a file writes and
 * {@link ReleaseDangerousShape} its part of the shared `dangerous`
 * namespace, which `src/config/shape.ts` composes into `ConfigShape`,
 * the nested file shape.
 * `config-registry.ts`'s `CONFIG_DEFAULTS` and `SETTINGS`
 * spread the objects below at the places the two sections always sat,
 * and the `dangerous` key right after `dangerous.acceptStaleRefs`, so
 * the order settings are reported in, and the order a warning lists keys
 * in, holds each key's section.
 *
 * They moved out of `config-schema.ts` when that module stood at 780
 * lines, measured with `wc -l`, before the release plan's six keys
 * joined these two sections and `dangerous`: new keys in a module near
 * the 800-line cap of `context/source.md` would be paid for by
 * rewrapping prose. The six keys then joined here. Every rule the schema module states about a KEY
 * still holds here, and `config-sections.ts` still holds every rule
 * about a VALUE. `config-registry.ts` imports this file to spread it; a
 * caller reads these settings off the resolved `RafaConfig`.
 *
 * ## The `pr` section
 *
 * `.rafa/specs/rafa-20-pr-commands.md` spells it `pr: { provider: gh | none,
 * mergeMethod: squash | merge | rebase, base: <default branch> }`, and
 * names `pr.resolveBudget` as what a `triage --resolve` session's
 * `--max-budget-usd` comes from. Four readings it leaves to this module:
 *
 *   - `pr.provider` and `pr.base` default to NULL, and null here means
 *     "nobody has said", not "off". The spec's default for the provider
 *     is `gh` when `origin` is a GitHub remote and `none` otherwise, and
 *     its default base is whatever the remote calls its default branch;
 *     neither is a value this module can spell, because both are read
 *     off the repository at use (`pr/provider.ts`). Writing either
 *     default as a literal would be the silent choice the config refuses
 *     everywhere else: `prBase: 'main'` would open a pull request into a
 *     branch that may not exist on a repository whose default is
 *     `master`. A file spelling `provider:` or `base:` with no value
 *     says nothing, as every null does, and resolves to the same null.
 *   - `pr.mergeMethod` defaults to `squash`, the first method the spec
 *     lists and the one the merge flow is written for: it deletes the
 *     local branch with `-D` because a squash leaves it unmerged in
 *     git's eyes.
 *   - `pr.resolveBudget` defaults to 2 US dollars, which the attempt
 *     guard's default of two attempts caps at 4 for one pull request.
 *     It is a number and not null: the spec has every resolve run carry
 *     `--max-budget-usd`, so a session with no budget is not a state
 *     this setting can be left in.
 *   - No `pr` setting is a `CommandLineSetting`. `pr merge` takes
 *     a `--method` flag, but that flag is the command's own argument for
 *     one merge, read by the command beside this setting, and not a
 *     layer over the config: a global `--merge-method` nobody typed
 *     would be a flag this module invented.
 *   - `pr.versionCollision` defaults to `report`. It sets how `rafa pr
 *     merge` reacts to a branch the release guard reads as `missing`
 *     (source changes and no fragment) or `stale` (a stamped version
 *     the base branch has passed): `report` names it and merges,
 *     `allow` is silent, `ask` asks and `refuse` stops. A `collision` is
 *     not this setting's: it always refuses, unless
 *     `dangerous.acceptVersionCollision` says otherwise. A default of
 *     `refuse` would stop every project whose branches still stamp their
 *     own versions the day it upgrades.
 *
 * ## The `release` section
 *
 * `.rafa/specs/rafa-21-changelog-and-release.md` spells it `release: {
 * enabled: auto, versionFile: package.json, changelog: CHANGELOG.md,
 * heading: "## {version} — {date}, {title}" }`, and those four values
 * are the defaults here. Four readings it leaves to this module:
 *
 *   - `release.enabled` is not a flag. `auto`, its default, is a third
 *     value meaning "on when both files below exist" — a reading
 *     `release/enabled.ts` makes against a disk, which no value here
 *     could stand for. What the reader takes beside it, and why `on`
 *     and `off` are refused, is `config-sections.ts`'s to say.
 *   - `release.versionFile` and `release.changelog` are paths relative
 *     to the repository root, and neither is null. Null elsewhere here
 *     means "nobody has said", and the spec has said: `package.json`
 *     and `CHANGELOG.md`. The absence the spec cares about is the
 *     FILE's — "a project with no version file gets the changelog
 *     entry under a date heading and no bump" — which is a question
 *     about a disk, answered at use and not spellable as a default.
 *   - `release.heading` is free text. The spec makes it a template so
 *     "a consumer's changelog has another shape" is an edit rather
 *     than a fork, and which placeholders it may carry, and what an
 *     unknown one renders to, is `release/changelog.ts`'s to say. So
 *     nothing here refuses a heading for the placeholders it spells.
 *   - No `release` setting is a `CommandLineSetting`, for the
 *     reason the `pr` section gives: the `release` commands read these
 *     settings beside their own arguments, and a global flag nobody
 *     typed would be one this module invented.
 *
 * Four more `release` settings belong to the plan in which no branch
 * owns a version number — a branch commits one change fragment, and
 * `rafa release settle` folds the fragments into a version on the base
 * branch after the merges:
 *
 *   - `release.fragments` defaults to `.changes`, the directory a
 *     fragment is written into. It is a path relative to the repository
 *     root and never under `.rafa/`, which is gitignored; the reader,
 *     `config-readers.ts`'s `fragmentsDirectory`, says why.
 *   - `release.strategy` defaults to `semver-by-level`, and that is the
 *     only value it accepts today: a closed list of one, so a file
 *     naming a strategy that does not exist is refused rather than
 *     folded by a strategy it did not name.
 *   - `release.settle` defaults to `push`: settle pushes the settled
 *     commit to the base branch, and `pr` opens a pull request with it
 *     instead, for a base branch that takes no direct push.
 *   - `release.tag` defaults to `manual`: `rafa release tag` stays the
 *     one write of the tag, and `settle` has settle put it on the
 *     commit it pushes.
 *
 * One more `release` setting is text `rafa release tag` prints and
 * `rafa release publish` runs:
 *
 *   - `release.publishCommand` defaults to `npm publish`, the command
 *     `rafa release tag` names for the publish after the tag and
 *     `rafa release publish` runs in each tagged unit's folder. It is free
 *     text, so a project that publishes with another tool, or with a
 *     flag such as `--tag next`, says so here. It was read off the
 *     manifest's `packageManager` field until 2026-09-30, which named
 *     `bun publish` for this repository while its releases are
 *     published with `npm publish`: the tool a project installs with is
 *     not the tool it publishes with.
 *
 * One more `release` setting says who publishes a tagged version:
 *
 *   - `release.publish` defaults to `manual`: a person runs the publish
 *     after the tag. `ci` says the pushed tag publishes through the
 *     project's CI workflow instead. It is the third key the release
 *     ladder is read off, beside `release.settle` and `release.tag`.
 *
 * One more `release` setting is for the repository that releases rafa:
 *
 *   - `release.moveLock` defaults to `false`. When it is `true`, settle
 *     also writes `rafa.lock` at the repository root to the version it
 *     settles, in the same release commit as the version file and the
 *     changelog, so the repository's own lock follows the rafa it
 *     publishes. It is read through `flag`, so `"true"`, `yes` and `1`
 *     are refused, and it is not a `CommandLineSetting`.
 *
 * ## The `dangerous` key
 *
 * `dangerous.acceptVersionCollision` has `rafa pr merge` accept, on
 * every run, a branch the release guard reads as a `collision` — its
 * version already on the base branch with different notes — which it
 * refuses whatever `pr.versionCollision` says. It is read as `dangerous.acceptStaleRefs`
 * is, for the reasons `config-schema.ts`'s "The `dangerous` section"
 * gives: it defaults to `false` and not null, it goes through `flag` so
 * `"true"`, `yes` and `1` are refused, and it is not a
 * `CommandLineSetting`.
 */
import type { MergeMethod } from './pr/types.js';
import type { ConfigSection, SettingSpec } from '@open-tomato/rafa/core/config';
import type {
  PrProvider,
  Reader,
  ReleaseEnabled,
  ReleasePublishMode,
  ReleaseSettleMode,
  ReleaseStrategy,
  ReleaseTagMode,
  VersionCollisionMode,
} from '@open-tomato/rafa/core/config/sections';

import {
  flag,
  fragmentsDirectory,
  oneOf,
  PR_PROVIDERS,
  RELEASE_AUTO,
  releaseEnabled,
  releaseFile,
  releasePublishMode,
  releaseSettleMode,
  releaseStrategy,
  releaseTagMode,
  text,
  usdAmount,
  versionCollisionMode,
} from '@open-tomato/rafa/core/config/sections';

import { MERGE_METHODS } from './pr/types.js';

declare module '@open-tomato/rafa/core/config/config-schema' {
  /** The `release` section's fields, added to core's. */
  interface RafaConfig extends PrSettings, ReleaseSettings, DangerousReleaseSettings {}
}

/**
 * The `pr` and `release` keys a file writes, both namespaces this
 * section's alone; `src/config/shape.ts` composes them into `ConfigShape`.
 */
export interface ReleaseShape {
  readonly pr: {
    readonly provider: PrProvider;
    readonly mergeMethod: MergeMethod;
    readonly base: string;
    readonly resolveBudget: number;
    readonly versionCollision: VersionCollisionMode;
  };
  readonly release: {
    readonly enabled: ReleaseEnabled;
    readonly versionFile: string;
    readonly changelog: string;
    readonly heading: string;
    readonly fragments: string;
    readonly strategy: ReleaseStrategy;
    readonly settle: ReleaseSettleMode;
    readonly tag: ReleaseTagMode;
    readonly publishCommand: string;
    readonly publish: ReleasePublishMode;
    readonly moveLock: boolean;
  };
}

/**
 * `dangerous.acceptVersionCollision`, the section's part of the shared
 * `dangerous` namespace; `src/config/shape.ts` composes it into
 * `DangerousShape` beside core's consents.
 */
export interface ReleaseDangerousShape {
  readonly acceptVersionCollision: boolean;
}

/** The `pr` section's settings, resolved. */
export interface PrSettings {
  /**
   * The provider every `pr` action goes through, or null to read it off
   * the `origin` remote. `pr.provider`.
   */
  prProvider: PrProvider | null;
  /** How `pr merge` merges, unless `--method` names another. `pr.mergeMethod`. */
  prMergeMethod: MergeMethod;
  /**
   * The branch a pull request is opened into, or null for whatever the
   * remote calls its default branch. `pr.base`.
   */
  prBase: string | null;
  /**
   * The budget in US dollars each `pr triage --resolve` session is
   * spawned with. `pr.resolveBudget`.
   */
  prResolveBudget: number;
  /**
   * How `pr merge` reacts to a branch the release guard reads as
   * `missing` or `stale`. `pr.versionCollision`.
   */
  prVersionCollision: VersionCollisionMode;
}

/** The `release` section's settings, resolved. */
export interface ReleaseSettings {
  /**
   * Whether a run bumps the version and writes a changelog entry, or
   * `auto` to decide it off the two files below. `release.enabled`.
   */
  releaseEnabled: ReleaseEnabled;
  /**
   * The manifest the version is read from and written back to, from
   * the repository root. `release.versionFile`.
   */
  releaseVersionFile: string;
  /**
   * The changelog an entry is inserted into, from the repository root.
   * `release.changelog`.
   */
  releaseChangelog: string;
  /** The template one entry's heading is rendered from. `release.heading`. */
  releaseHeading: string;
  /**
   * The directory change fragments are written into, from the
   * repository root. `release.fragments`.
   */
  releaseFragments: string;
  /** The strategy the fragments are folded into a version by. `release.strategy`. */
  releaseStrategy: ReleaseStrategy;
  /** How settle lands the settled version on the base branch. `release.settle`. */
  releaseSettle: ReleaseSettleMode;
  /** Who tags a settled version. `release.tag`. */
  releaseTag: ReleaseTagMode;
  /** The command `rafa release tag` prints for the publish and `rafa release publish` runs. `release.publishCommand`. */
  releasePublishCommand: string;
  /** Who publishes a tagged version: a person, or CI on the pushed tag. `release.publish`. */
  releasePublish: ReleasePublishMode;
  /**
   * Whether settle also writes `rafa.lock` to the version it settles,
   * in the same release commit. `release.moveLock`.
   */
  releaseMoveLock: boolean;
}

/** The `dangerous` setting the release plan adds, resolved. */
export interface DangerousReleaseSettings {
  /**
   * Whether `pr merge` accepts, on every run, a branch the release
   * guard reads as a `collision`. `dangerous.acceptVersionCollision`.
   */
  dangerousAcceptVersionCollision: boolean;
}

/** What every `pr` setting resolves to when no layer names it. */
export const PR_DEFAULTS: Readonly<PrSettings> = Object.freeze({
  prProvider: null,
  prMergeMethod: 'squash',
  prBase: null,
  prResolveBudget: 2,
  prVersionCollision: 'report',
});

/** What every `release` setting resolves to when no layer names it. */
export const RELEASE_DEFAULTS: Readonly<ReleaseSettings> = Object.freeze({
  releaseEnabled: RELEASE_AUTO,
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseHeading: '## {version} — {date}, {title}',
  releaseFragments: '.changes',
  releaseStrategy: 'semver-by-level',
  releaseSettle: 'push',
  releaseTag: 'manual',
  releasePublishCommand: 'npm publish',
  releasePublish: 'manual',
  releaseMoveLock: false,
});

/** What the release plan's `dangerous` setting resolves to when no layer names it. */
export const DANGEROUS_RELEASE_DEFAULTS: Readonly<DangerousReleaseSettings> = Object.freeze({
  dangerousAcceptVersionCollision: false,
});

/**
 * Accepts one of the pull request port's three merge methods. The list
 * is the port's (`pr/types.ts`), which spells them to match what
 * `gh pr merge` takes, so a second spelling here could not disagree
 * with it.
 *
 * It sits here, beside the one setting that reads it, and not among
 * core's readers in `config-sections.ts`, so no core file imports
 * `pr/types.ts`. The port is reached at `./pr/types.js` and not through
 * the `./pr/index.js` barrel, because the barrel carries `pr/gh.ts`,
 * which imports the config's sections barrel and the `gh` spawner:
 * importing it here would put the CLI adapter behind every config read.
 * `pr/types.ts` imports types alone, so this import reaches nothing back.
 */
export const mergeMethod: Reader<MergeMethod> = oneOf(MERGE_METHODS);

/** The `pr` section's setting specs, in the order problems are reported. */
export const PR_SETTINGS: {
  readonly [K in keyof PrSettings]: SettingSpec<K>;
} = {
  prProvider: { key: 'pr.provider', read: oneOf(PR_PROVIDERS), cli: false },
  prMergeMethod: { key: 'pr.mergeMethod', read: mergeMethod, cli: false },
  prBase: { key: 'pr.base', read: text('a branch name'), cli: false },
  prResolveBudget: { key: 'pr.resolveBudget', read: usdAmount, cli: false },
  prVersionCollision: {
    key: 'pr.versionCollision',
    read: versionCollisionMode,
    cli: false,
  },
};

/** The `release` section's setting specs, in the order problems are reported. */
export const RELEASE_SETTINGS: {
  readonly [K in keyof ReleaseSettings]: SettingSpec<K>;
} = {
  releaseEnabled: { key: 'release.enabled', read: releaseEnabled, cli: false },
  releaseVersionFile: {
    key: 'release.versionFile',
    read: releaseFile,
    cli: false,
  },
  releaseChangelog: { key: 'release.changelog', read: releaseFile, cli: false },
  releaseHeading: {
    key: 'release.heading',
    read: text('a changelog heading template'),
    cli: false,
  },
  releaseFragments: {
    key: 'release.fragments',
    read: fragmentsDirectory,
    cli: false,
  },
  releaseStrategy: { key: 'release.strategy', read: releaseStrategy, cli: false },
  releaseSettle: { key: 'release.settle', read: releaseSettleMode, cli: false },
  releaseTag: { key: 'release.tag', read: releaseTagMode, cli: false },
  releasePublishCommand: {
    key: 'release.publishCommand',
    read: text('a publish command'),
    cli: false,
  },
  releasePublish: { key: 'release.publish', read: releasePublishMode, cli: false },
  releaseMoveLock: { key: 'release.moveLock', read: flag, cli: false },
};

/** The release plan's `dangerous` setting spec. */
export const DANGEROUS_RELEASE_SETTINGS: {
  readonly [K in keyof DangerousReleaseSettings]: SettingSpec<K>;
} = {
  dangerousAcceptVersionCollision: {
    key: 'dangerous.acceptVersionCollision',
    read: flag,
    cli: false,
  },
};

/** The `release` section: the `pr` and `release` keys and `dangerous.acceptVersionCollision`, with their defaults and no check. */
export const RELEASE_SECTION: ConfigSection = Object.freeze({
  package: 'release',
  settings: Object.freeze({ ...PR_SETTINGS, ...RELEASE_SETTINGS, ...DANGEROUS_RELEASE_SETTINGS }),
  defaults: Object.freeze({ ...PR_DEFAULTS, ...RELEASE_DEFAULTS, ...DANGEROUS_RELEASE_DEFAULTS }),
});
