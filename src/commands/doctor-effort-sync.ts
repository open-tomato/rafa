/**
 * The `effort sync` row of `rafa doctor`: whether the strategy the
 * project's `effort.sync` names has an adapter to carry the store, read
 * as the commands that sync would select it.
 *
 * ## What it reads
 *
 * The resolved config's `effortSync` (default `local`), selected through
 * `selectSync` (`effort/sync/select.ts`), which makes the adapter and
 * touches nothing on disk. The kinds core registers, `local` and `file`,
 * resolve through `CORE_ADAPTER_REGISTRY`, and no module is loaded for
 * them: a module cannot register a kind core holds (the registry refuses
 * it), so the modules could not change the answer. Any other kind is
 * selected through the registry `loadModules` (`modules/load.ts`)
 * answers for the config's `modules:` and `allowList:`, so a module that
 * provides `git` makes `git` pass. The loader's warnings are not written
 * here: the dispatcher writes them for every command already.
 *
 * ## The outcome
 *
 *   - `ok`, naming the strategy and whether core or a module serves it.
 *   - `fail` when no adapter serves it. For `git`, `service` and `p2p`
 *     that is `selectSync`'s `SyncModuleMissing`, whose message names the
 *     kind and the `modules:` and `allowList:` lines that load a module
 *     providing it; `missingModule` is then true. Any other throw — a kind
 *     outside `SYNC_STRATEGIES` a hand-built config carries, or an
 *     adapter's own refusal — fails the row with its message, and the row
 *     never throws. `doctor` then exits 1 with {@link effortSyncRefusal}.
 *
 * ## The lines
 *
 * {@link renderDoctorEffortSync} gives text mode one row on every run,
 * since every project has a strategy: `Effort sync: ok, <strategy>`,
 * with ` (module)` for a strategy a module serves, or
 * `Effort sync: fail, <strategy>` with each line of the problem indented
 * under it. json mode gives the reading as the result's `effortSync`.
 */
import type { AdapterRegistry } from '../adapters/registry.js';
import type { ResolvedConfig } from '../config.js';
import type { ModuleLoadSeams } from '../modules/load.js';

import { CORE_ADAPTER_REGISTRY } from '../adapters/registry.js';
import { describeValue, messageOf } from '../config-sections.js';
import { SyncModuleMissing, selectSync } from '../effort/sync/select.js';
import { loadModules, moduleSettings } from '../modules/load.js';

/** The row's name, as its refusal spells it. */
export const EFFORT_SYNC_ROW = 'effort sync';

/** How the row came out; see the module note. */
export type EffortSyncOutcome = 'ok' | 'fail';

/** Where the adapter that served the strategy came from; null when none did. */
export type EffortSyncSource = 'core' | 'module';

/** What the row read; json mode gives it as the result's `effortSync`. */
export interface DoctorEffortSyncReading {
  readonly outcome: EffortSyncOutcome;
  /** The strategy `effort.sync` names, as the config resolved it. */
  readonly strategy: string;
  /** Whether core or a loaded module serves it; null for a failing row. */
  readonly source: EffortSyncSource | null;
  /** Whether the row fails for a module strategy no loaded module serves. */
  readonly missingModule: boolean;
  /** Why the row fails, without the row's own name; null when it passes. */
  readonly problem: string | null;
}

/** How the modules are loaded for a kind core does not serve. Each left out is the loader's own. */
export interface DoctorEffortSyncSeams {
  readonly syncModules?: ModuleLoadSeams;
}

/** What one run hands {@link readDoctorEffortSync}. */
export interface DoctorEffortSyncInput {
  /** The project root, which modules and the adapter resolve against. */
  readonly root: string;
  /** The home, which a user-scope `modules:` source resolves against. */
  readonly home: string;
  /** The config as it resolves for the project. */
  readonly resolved: ResolvedConfig;
}

/** The opening a `selectSync` refusal carries, which the row's name already says. */
const ROW_PREFIX = `${EFFORT_SYNC_ROW}: `;

/** `message` without the row's name opening it. */
function withoutRowName(message: string): string {
  return message.startsWith(ROW_PREFIX)
    ? message.slice(ROW_PREFIX.length)
    : message;
}

/** The registry the strategy is selected through: core's when it holds the kind, the modules' otherwise. */
async function registryFor(input: DoctorEffortSyncInput, kind: unknown, seams: DoctorEffortSyncSeams): Promise<{
  readonly registry: AdapterRegistry;
  readonly source: EffortSyncSource;
}> {
  if (typeof kind === 'string' && CORE_ADAPTER_REGISTRY.find('sync', kind) !== undefined) {
    return { registry: CORE_ADAPTER_REGISTRY, source: 'core' };
  }
  const settings = moduleSettings(input.resolved, { root: input.root, home: input.home });
  const loaded = await loadModules(settings, seams.syncModules);
  return { registry: loaded.adapters, source: 'module' };
}

/** The strategy as the row names it: the string itself, or a description of a value that is none. */
function strategyOf(kind: unknown): string {
  return typeof kind === 'string'
    ? kind
    : describeValue(kind);
}

/**
 * The row for the project's `effort.sync`; never a throw. See the module
 * note for which registry each kind is selected through.
 */
export async function readDoctorEffortSync(
  input: DoctorEffortSyncInput,
  seams: DoctorEffortSyncSeams = {},
): Promise<DoctorEffortSyncReading> {
  const { config } = input.resolved;
  const kind: unknown = config.effortSync;
  const strategy = strategyOf(kind);
  try {
    const { registry, source } = await registryFor(input, kind, seams);
    selectSync(input.root, config, registry);
    return { outcome: 'ok', strategy, source, missingModule: false, problem: null };
  } catch (error) {
    const missingModule = error instanceof SyncModuleMissing;
    return { outcome: 'fail', strategy, source: null, missingModule, problem: withoutRowName(messageOf(error)) };
  }
}

/** The lines text mode writes for the row; see the module note. */
export function renderDoctorEffortSync(reading: DoctorEffortSyncReading): readonly string[] {
  const served = reading.source === 'module'
    ? ' (module)'
    : '';
  const row = `Effort sync: ${reading.outcome}, ${reading.strategy}${served}`;
  if (reading.problem === null) return [row];
  return [row, ...reading.problem.split('\n').map((line) => `  ${line}`)];
}

/** The text `doctor` exits 1 with for a failing row, or null for a row that passes. */
export function effortSyncRefusal(reading: DoctorEffortSyncReading): string | null {
  if (reading.outcome !== 'fail') return null;
  return `rafa doctor: ${EFFORT_SYNC_ROW}: ${String(reading.problem)}`;
}
