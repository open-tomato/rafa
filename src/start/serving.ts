/**
 * The served directory for one loop session, made just before that
 * session spawns.
 *
 * Both session doors call {@link serveSession}: the task door
 * (`dispatchTask` in `start/dispatch.ts`) and the wrap-up door
 * (`preserveProgress` in `start/wrap-up.ts`). The wrap-up's call reads
 * the three tiers' skill and agent trees (`readTrees` in
 * `inventory/trees.ts`) and resolves them under the run's settings
 * (`resolveTiers` in `tiers/resolve.ts`); the task door has already
 * done that once for its dispatch, through
 * {@link resolveSessionTiers}, and hands that resolution in, so the
 * skills its prompt offers (`start/handout.ts`) are chosen from the
 * resolution its session is served. Either way the call copies the
 * rafa-tier winners into `.rafa/runs/<run>/served/` (`serveResolution`
 * in `tiers/serve.ts`) and answers that module's {@link ServedSet}. The
 * door hands its `flags` to the spawn, and prints each `skipped` message
 * as a warning.
 *
 * The trees are read again for every session and never once per
 * run. `.rafa/specs/rafa-26-skill-tiers.md` has rafa serve "before each
 * task or wrap-up session", and `serveResolution` replaces the run's
 * served directory whole. So a session is served what the tiers hold
 * when it starts, and nothing an earlier session was served.
 *
 * Only the three tiers are read, not plugins or add-ons, since
 * `resolveTiers` leaves those rows out. The trees are read with no
 * `PATH` directories: those feed only the checker's command lookups
 * in a skill body, and a row's verdict decides nothing here.
 *
 * A collision is served by nobody, which is `resolveTiers`' outcome.
 * Refusing to start a run over one is the preflight's job, so the
 * collision is not reported here.
 *
 * The reading and the resolution are {@link resolveSessionTiers}, which
 * `rafa plan` also calls (`plan.ts`) to render the planner's skill
 * index, so the index lists what a loop session under the same settings
 * is served.
 */
import type { Resolution, TierSettings } from '../tiers/resolve.js';
import type { ServedSet } from '../tiers/serve.js';

import { readTrees } from '../inventory/trees.js';
import { readItemBytes, resolveTiers } from '../tiers/resolve.js';
import { serveResolution } from '../tiers/serve.js';

/** Where the three tiers are read, and the settings they resolve under. */
export interface TierReading {
  /** The project root. It holds the project tier. */
  readonly root: string;
  /** The home directory the user tier resolves under. */
  readonly home: string;
  /** The run's settings; a `RafaConfig` is one. */
  readonly settings: TierSettings;
  /** The entry the rafa tier sits beside. Defaults to `Bun.main`. */
  readonly entry?: string;
}

/** What one session is served against: a {@link TierReading} and the run. */
export interface SessionServing extends TierReading {
  /** The run's session id, which names `.rafa/runs/<run>/` under the root. */
  readonly run: string;
}

/**
 * The three tiers' skill and agent trees read under `reading`, resolved
 * under its settings. See the module note.
 */
export function resolveSessionTiers(reading: TierReading): Resolution {
  const rows = readTrees({
    home: reading.home,
    projectRoot: reading.root,
    pathDirs: [],
    ...(reading.entry === undefined
      ? {}
      : { entry: reading.entry }),
  }).flatMap((listing) => listing.items);
  return resolveTiers(rows, reading.settings, readItemBytes);
}

/**
 * Serves the rafa-tier winners of `resolution` into the run's served
 * directory, and answers what was served. The resolution defaults to
 * the three tiers read now under `serving`; a door that already read
 * them for this session hands in what it read. See the module note.
 */
export function serveSession(
  serving: SessionServing,
  resolution: Resolution = resolveSessionTiers(serving),
): ServedSet {
  return serveResolution(resolution, { root: serving.root, run: serving.run });
}
