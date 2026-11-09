/**
 * The `hints` section of the config schema: one switch, `hints.skills`,
 * saying whether a step rafa hands over is followed by the skill case
 * that explains it. {@link HINTS_SECTION} hands it to core as one
 * `ConfigSection`, package `hints`, and the `declare module` below adds
 * {@link HintsSettings} to `RafaConfig`. {@link HintsShape} holds the key
 * a file writes, which `src/config/shape.ts` composes into
 * `ConfigShape`, the nested file shape. `config-registry.ts` registers
 * the section sixteenth and last in `CONFIG_SECTIONS`, and its
 * `CONFIG_DEFAULTS` and `SETTINGS` spread the objects below last, after
 * the `features` section.
 *
 * ## The key
 *
 * `hints.skills` is read with core's `flag`, so it takes `true` or
 * `false` and refuses anything else, a quoted `"true"` included, naming
 * the key. It defaults to `false`: a step reads as it did before the key
 * existed, and a project opts in. When it is `true`, a `Next:` step of
 * `rafa release tag`, `rafa release settle` or `rafa release publish`
 * whose case has a file under `.claude/skills/rafa-release/` is followed
 * by one indented line, `skill: rafa-release › <case>`. It is not a
 * `CommandLineSetting`, as no boolean `release` key is.
 *
 * The section holds the switch and nothing that reads it: the release
 * steps read the setting off the resolved `RafaConfig`.
 */
import type { ConfigSection, SettingSpec } from './core/config/index.js';

import { flag } from './core/config/sections.js';

declare module './core/config/config-schema.js' {
  /** The `hints` section's fields, added to core's. */
  interface RafaConfig extends HintsSettings {}
}

/** The `hints` keys as a file writes them. */
export interface HintsShape {
  /** The `hints` keys. */
  readonly hints: {
    /** `hints.skills`: whether a handed-over step names the skill case that explains it. */
    readonly skills: boolean;
  };
}

/** The `hints` section's settings, resolved. */
export interface HintsSettings {
  /** Whether a handed-over step is followed by its skill case line. `hints.skills`. */
  hintsSkills: boolean;
}

/** What the `hints` settings resolve to when no layer names them: no skill line. */
export const HINTS_DEFAULTS: Readonly<HintsSettings> = Object.freeze({
  hintsSkills: false,
});

/** The `hints` section's setting specs, in the order they are reported. */
export const HINTS_SETTINGS: {
  readonly [K in keyof HintsSettings]: SettingSpec<K>;
} = {
  hintsSkills: { key: 'hints.skills', read: flag, cli: false },
};

/** The `hints` section: the one switch, with its default and no check. */
export const HINTS_SECTION: ConfigSection = Object.freeze({
  package: 'hints',
  settings: Object.freeze(HINTS_SETTINGS),
  defaults: HINTS_DEFAULTS,
});
