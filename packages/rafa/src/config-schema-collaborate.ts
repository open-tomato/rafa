/**
 * The `collaborate` section of the config schema: the one key a project
 * sets to report a gap or a bug on the board of a tool it consumes,
 * `collaborate.rafa`, with its field, its default, its spec and its
 * reader, and {@link collaborateTarget}, which answers the board a
 * `--upstream=<tool>` names. {@link COLLABORATE_SECTION} hands them to
 * core as one `ConfigSection`, package `collaborate`, and the
 * `declare module` below adds {@link CollaborateSettings} to
 * `RafaConfig`. {@link CollaborateShape} holds the keys a file writes,
 * which `src/config/shape.ts` composes into `ConfigShape`, the nested
 * file shape. `config-registry.ts`'s `CONFIG_DEFAULTS` and `SETTINGS`
 * spread {@link COLLABORATE_DEFAULTS} and {@link COLLABORATE_SETTINGS}.
 *
 * The section sits in a module of its own, as `config-schema-hub.ts`
 * does, and every rule `config.ts` and `section.ts` state about a KEY
 * holds here, as every rule `config-sections.ts` states about a VALUE
 * does: nothing is coerced.
 *
 * ## The key
 *
 * `.rafa/specs/rafa-751-report-rafa-gaps-bugs.md` names it:
 * `collaborate.rafa: <owner>/<name>`, the repository whose board
 * `rafa issue create`, `rafa issue comment` and `rafa issue list` reach
 * under `--upstream=rafa`. Four readings this module makes:
 *
 *   - It defaults to NULL, meaning "nobody has said", as `hub.url`
 *     does, and null keeps reporting upstream off: no default
 *     repository is one this module could spell for every team.
 *   - Its value is one `owner/name`, the pattern
 *     `packages/rafa-board/src/board/repository.ts` holds a board's
 *     `nameWithOwner` to: two parts, each holding no `/` and no
 *     whitespace. A non-string, a blank string, `rafa`,
 *     `open-tomato/rafa/x` and `open tomato/rafa` are each refused at
 *     load, the refusal naming `collaborate.rafa`. The pattern is
 *     spelled again here rather than imported: core does not depend on
 *     `rafa-board`.
 *   - Only `rafa` is read under `collaborate`. Any other key under it,
 *     `collaborate.bun` included, names no setting and is warned about
 *     as the loader warns about every unknown key; a later tool's key
 *     arrives with the code that reads it.
 *   - It is not a `CommandLineSetting`: where a project may report is
 *     the project's word, and `--upstream` names a tool, never a board.
 */
import type { ConfigSection, SettingSpec } from './core/config/index.js';
import type { Reader } from './core/config/sections.js';

import { refused } from './core/config/sections.js';

declare module './core/config/config-schema.js' {
  /** The `collaborate` section's fields, added to core's. */
  interface RafaConfig extends CollaborateSettings {}
}

/** The `collaborate` keys a file writes; `src/config/shape.ts` composes them into `ConfigShape`. */
export interface CollaborateShape {
  readonly collaborate: {
    readonly rafa: string;
  };
}

/** The `collaborate` section's settings, resolved. */
export interface CollaborateSettings {
  /**
   * The `owner/name` of the repository a rafa gap or bug is reported
   * on, or null when nobody has said and reporting upstream is off.
   * `collaborate.rafa`.
   */
  collaborateRafa: string | null;
}

/** A tool a key under `collaborate` names, as `--upstream=<tool>` spells it. */
export type CollaborateTool = 'rafa';

/** Every tool a key under `collaborate` names, in the order the section reads them. */
export const COLLABORATE_TOOLS: readonly CollaborateTool[] = Object.freeze(['rafa']);

/** The `collaborate` section's defaults: every key absent, read as null. */
export const COLLABORATE_DEFAULTS: Readonly<CollaborateSettings> = Object.freeze({
  collaborateRafa: null,
});

/** A repository as `owner/name`: the pattern `repository.ts` names `REPOSITORY`. */
const REPOSITORY = /^[^/\s]+\/[^/\s]+$/u;

/** What a refused repository was expected to be. */
const REPOSITORY_EXPECTED = 'a repository as owner/name, such as open-tomato/rafa';

/** Accepts one `owner/name`, kept as written; see the module note. */
export const collaborateRepository: Reader<string> = (raw, at) => typeof raw === 'string' && REPOSITORY.test(raw)
  ? { value: raw, problems: [], extras: [] }
  : refused(at, raw, REPOSITORY_EXPECTED);

/** The `collaborate` section's specs, spread into `SETTINGS`. */
export const COLLABORATE_SETTINGS: { readonly [K in keyof CollaborateSettings]: SettingSpec<K> } = {
  collaborateRafa: { key: 'collaborate.rafa', read: collaborateRepository, cli: false },
};

/** The field each tool's key resolves into. */
const FIELD_OF: { readonly [T in CollaborateTool]: keyof CollaborateSettings } = Object.freeze({
  rafa: 'collaborateRafa',
});

/** The `collaborate` section: its one setting and its default, with no check. */
export const COLLABORATE_SECTION: ConfigSection = Object.freeze({
  package: 'collaborate',
  settings: Object.freeze(COLLABORATE_SETTINGS),
  defaults: COLLABORATE_DEFAULTS,
  checks: Object.freeze([]),
});

/**
 * The `owner/name` the resolved config names for `tool`, or null when
 * its key is absent, so reporting upstream to it is off. A setting left
 * out of `config` reads as its default, null.
 */
export function collaborateTarget(config: Partial<CollaborateSettings>, tool: CollaborateTool): string | null {
  return config[FIELD_OF[tool]] ?? null;
}
