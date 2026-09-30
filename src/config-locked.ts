/**
 * The settings every device of one project must share.
 *
 * A locked setting is one whose value a team decides once, for every
 * device: how the effort store travels (`effort.sync`), which
 * preflight items halt a run (`prerequisites.required`), when a
 * planned issue's claim goes stale (`claims.staleAfter`) and whether a
 * claim may reach one issue ahead (`claims.ahead`). This module
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
  'claimsStaleAfter',
  'claimsAhead',
] as const satisfies readonly ConfigSetting[]);
