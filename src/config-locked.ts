/**
 * The settings every device of one project must share.
 *
 * A locked setting is one whose value a team decides once, for every
 * device: how the effort store travels (`effort.sync`) and which
 * preflight items halt a run (`prerequisites.required`). This module
 * only DECLARES which settings are locked; serving their values to the
 * devices of a team is `rafa-hub`'s, and nothing here reads or enforces
 * them.
 *
 * Entries are {@link ConfigSetting} names, the keys of `SETTINGS`, so a
 * name outside `SETTINGS` does not compile. The dotted file key of each
 * entry is read off `SETTINGS[name].key`.
 *
 * @module
 */
import type { ConfigSetting } from './config-schema.js';

/** The settings a team shares across every device, in file-key order. */
export const LOCKED_SETTINGS: readonly ConfigSetting[] = Object.freeze([
  'effortSync',
  'prerequisitesRequired',
] as const satisfies readonly ConfigSetting[]);
