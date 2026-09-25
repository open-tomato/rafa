/**
 * The served directory for one loop session, made just before that
 * session spawns.
 *
 * Both session doors call {@link serveSession}: the task door
 * (`dispatchTask` in `start/dispatch.ts`) and the wrap-up door
 * (`preserveProgress` in `start/wrap-up.ts`). Each call reads the three
 * tiers' skill and agent trees (`readTrees` in `inventory/trees.ts`),
 * resolves them under the run's settings (`resolveTiers` in
 * `tiers/resolve.ts`), and copies the rafa-tier winners into
 * `.rafa/runs/<run>/served/` (`serveResolution` in `tiers/serve.ts`).
 * It answers that module's {@link ServedSet}. The door hands its `flags`
 * to the spawn, and prints each `skipped` message as a warning.
 *
 * The trees are read again before every session and never once per
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
 */
import type { TierSettings } from '../tiers/resolve.js';
import type { ServedSet } from '../tiers/serve.js';

import { readTrees } from '../inventory/trees.js';
import { readItemBytes, resolveTiers } from '../tiers/resolve.js';
import { serveResolution } from '../tiers/serve.js';

/** What one session is served against. */
export interface SessionServing {
  /** The project root. It holds the project tier and `.rafa/runs/`. */
  readonly root: string;
  /** The run's session id, which names `.rafa/runs/<run>/`. */
  readonly run: string;
  /** The home directory the user tier resolves under. */
  readonly home: string;
  /** The run's settings; a `RafaConfig` is one. */
  readonly settings: TierSettings;
  /** The entry the rafa tier sits beside. Defaults to `Bun.main`. */
  readonly entry?: string;
}

/**
 * Serves the rafa-tier winners of the three tiers into the run's served
 * directory, and answers what was served. See the module note.
 */
export function serveSession(serving: SessionServing): ServedSet {
  const rows = readTrees({
    home: serving.home,
    projectRoot: serving.root,
    pathDirs: [],
    ...(serving.entry === undefined
      ? {}
      : { entry: serving.entry }),
  }).flatMap((listing) => listing.items);
  const resolution = resolveTiers(rows, serving.settings, readItemBytes);
  return serveResolution(resolution, { root: serving.root, run: serving.run });
}
