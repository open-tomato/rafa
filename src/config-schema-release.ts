/**
 * The `pr` and `release` sections of the config schema, and the one
 * `dangerous` key the release plan adds: each setting's field, its
 * default and its spec. `config-schema.ts`'s `RafaConfig` extends
 * {@link PrSettings}, {@link ReleaseSettings} and
 * {@link DangerousReleaseSettings}, and its `CONFIG_DEFAULTS` and
 * `SETTINGS` spread the objects below at the places the two sections
 * always sat, and the `dangerous` key right after
 * `dangerous.acceptStaleRefs`, so the order settings are reported in,
 * and the order a warning lists keys in, holds each key's section.
 *
 * They moved out of `config-schema.ts` when that module stood at 780
 * lines, measured with `wc -l`, before the release plan's six keys
 * joined these two sections and `dangerous`: new keys in a module near
 * the 800-line cap of `context/source.md` would be paid for by
 * rewrapping prose. The six keys then joined here. Every rule the schema module states about a KEY
 * still holds here, and `config-sections.ts` still holds every rule
 * about a VALUE. Only `config-schema.ts` imports this file; a caller
 * reads these settings off the resolved `RafaConfig`.
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
import type {
  ReleaseSettleMode,
  ReleaseStrategy,
  ReleaseTagMode,
  VersionCollisionMode,
} from './config-readers.js';
import type { SettingSpec } from './config-schema.js';
import type {
  MergeMethod,
  PrProvider,
  ReleaseEnabled,
} from './config-sections.js';

import {
  fragmentsDirectory,
  releaseFile,
  releaseSettleMode,
  releaseStrategy,
  releaseTagMode,
  versionCollisionMode,
} from './config-readers.js';
import {
  flag,
  mergeMethod,
  oneOf,
  PR_PROVIDERS,
  RELEASE_AUTO,
  releaseEnabled,
  text,
  usdAmount,
} from './config-sections.js';

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
});

/** What the release plan's `dangerous` setting resolves to when no layer names it. */
export const DANGEROUS_RELEASE_DEFAULTS: Readonly<DangerousReleaseSettings> = Object.freeze({
  dangerousAcceptVersionCollision: false,
});

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
