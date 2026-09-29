/**
 * The sync-strategy check of the preflight `loop start` runs
 * (`start/preflight.ts`): a run whose `effort.sync` names a kind no
 * adapter serves is refused before any probe and any session.
 *
 * ## What it reads
 *
 * The same reading as the `effort sync` row of `rafa doctor`, taken
 * through `readDoctorEffortSync` (`commands/doctor-effort-sync.ts`) so the
 * two can never disagree: the resolved config's `effortSync` selected
 * through `selectSync` over `CORE_ADAPTER_REGISTRY` for a kind core
 * holds (`local`, `file`), and over the registry `loadModules` answers
 * for any other. Selecting makes the adapter and touches nothing on disk,
 * so a passing reading prints nothing and stores no row.
 *
 * ## The refusal
 *
 * A failing reading throws `CommandExit` with exit code 1, the problem
 * `selectSync` worded indented under one opening line. For a module
 * strategy no loaded module serves, that problem is
 * `SyncModuleMissing`'s, so the refusal names the kind and the
 * `modules:` and `allowList:` lines that load a module providing it:
 *
 *     ❌ Refusing to start: effort.sync names a strategy no adapter serves.
 *        effort.sync is "git", and no module registers a sync adapter of
 *        that kind (registered: local, file). Core ships no git strategy;
 *        load a module that provides one with these lines in
 *        .rafa/config.yaml:
 *        modules:
 *          - path: <module directory>
 *        allowList:
 *          - <module name>
 *        Nothing was checked and nothing was dispatched.
 *
 * That is `preflight-sync.test.ts`'s reading, its long line wrapped here.
 */
import type { DoctorEffortSyncReading, DoctorEffortSyncSeams } from '../commands/doctor-effort-sync.js';
import type { ResolvedConfig } from '../config.js';

import { CommandExit } from '../cli/command.js';
import { readDoctorEffortSync } from '../commands/doctor-effort-sync.js';

/** What the sync-strategy check reads, and the seams it loads modules through. */
export interface StartPreflightSync {
  /** The config as the run resolved it; its `effortSync`, `modules` and `allowList` are read. */
  readonly resolved: ResolvedConfig;
  /** The home a user-scope `modules:` source resolves against. */
  readonly home: string;
  /** How modules are loaded for a kind core does not serve. Each left out is the loader's own. */
  readonly seams?: DoctorEffortSyncSeams;
}

/** The refusal for a failing reading; see the module note. */
export function syncRefusal(reading: DoctorEffortSyncReading): string {
  const problem = String(reading.problem)
    .split('\n')
    .map((line) => `   ${line}`);
  return [
    '❌ Refusing to start: effort.sync names a strategy no adapter serves.',
    ...problem,
    '   Nothing was checked and nothing was dispatched.',
  ].join('\n');
}

/**
 * Refuses the run when the project's `effort.sync` names a kind no
 * adapter serves, throwing `CommandExit` with exit code 1; answers the
 * passing reading otherwise. See the module note.
 */
export async function refuseUnservedSync(repoRoot: string, sync: StartPreflightSync): Promise<DoctorEffortSyncReading> {
  const reading = await readDoctorEffortSync({ root: repoRoot, home: sync.home, resolved: sync.resolved }, sync.seams);
  if (reading.outcome === 'fail') throw new CommandExit(1, syncRefusal(reading));
  return reading;
}
