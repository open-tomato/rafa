/**
 * The `features` section of the config schema: four switches, one per
 * bundled feature, each saying whether that feature's commands are
 * loaded for the invocation. {@link FEATURES_SECTION} hands them to core
 * as one `ConfigSection`, package `features`, and the `declare module`
 * below adds {@link FeaturesSettings} to `RafaConfig`.
 * {@link FeaturesShape} holds the keys a file writes, which
 * `src/config/shape.ts` composes into `ConfigShape`, the nested file
 * shape. `config-registry.ts` registers the section fourteenth in
 * `CONFIG_SECTIONS`, and its `CONFIG_DEFAULTS` and `SETTINGS` spread the
 * objects below last, after the `checks` section.
 *
 * ## The keys
 *
 * `features.board`, `features.pr`, `features.run` and `features.release`
 * each name one bundled feature by its name. Each is read with core's
 * `flag`, so it takes `true` or `false` and refuses anything else, a
 * quoted `"false"` included, naming the key. Each defaults to `true`: a
 * project that names no feature loads every bundled one, as it did
 * before the section existed. None is a `CommandLineSetting`.
 *
 * The section holds the switches and nothing that reads them: what a
 * `false` turns off is the loader's (`src/modules/load.ts`), which reads
 * these settings off the resolved `RafaConfig`.
 */
import type { ConfigSection, SettingSpec } from '@open-tomato/rafa/core/config';

import { flag } from '@open-tomato/rafa/core/config/sections';

declare module '@open-tomato/rafa/core/config/config-schema' {
  /** The `features` section's fields, added to core's. */
  interface RafaConfig extends FeaturesSettings {}
}

/** The `features` keys as a file writes them. */
export interface FeaturesShape {
  /** The `features` keys, each `true` or `false`. */
  readonly features: {
    /** `features.board`: whether the board feature's commands load. */
    readonly board: boolean;
    /** `features.pr`: whether the pull-request feature's commands load. */
    readonly pr: boolean;
    /** `features.run`: whether the run feature's commands load. */
    readonly run: boolean;
    /** `features.release`: whether the release feature's commands load. */
    readonly release: boolean;
  };
}

/** The `features` section's settings, resolved. */
export interface FeaturesSettings {
  /** Whether the board feature's commands load. `features.board`. */
  featuresBoard: boolean;
  /** Whether the pull-request feature's commands load. `features.pr`. */
  featuresPr: boolean;
  /** Whether the run feature's commands load. `features.run`. */
  featuresRun: boolean;
  /** Whether the release feature's commands load. `features.release`. */
  featuresRelease: boolean;
}

/** What the `features` settings resolve to when no layer names them: every feature on. */
export const FEATURES_DEFAULTS: Readonly<FeaturesSettings> = Object.freeze({
  featuresBoard: true,
  featuresPr: true,
  featuresRun: true,
  featuresRelease: true,
});

/** The `features` section's setting specs, in the order they are reported. */
export const FEATURES_SETTINGS: {
  readonly [K in keyof FeaturesSettings]: SettingSpec<K>;
} = {
  featuresBoard: { key: 'features.board', read: flag, cli: false },
  featuresPr: { key: 'features.pr', read: flag, cli: false },
  featuresRun: { key: 'features.run', read: flag, cli: false },
  featuresRelease: { key: 'features.release', read: flag, cli: false },
};

/** The `features` section: the four switches, with their defaults and no check. */
export const FEATURES_SECTION: ConfigSection = Object.freeze({
  package: 'features',
  settings: Object.freeze(FEATURES_SETTINGS),
  defaults: FEATURES_DEFAULTS,
});
