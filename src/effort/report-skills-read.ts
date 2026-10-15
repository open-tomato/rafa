/**
 * Reads the skills report, for `rafa effort report --skills`: the store
 * under the repo root, each skill's failure strings read from the tiers as
 * they resolve now under the config, and each lesson resolved through the
 * held set. `report-skills.ts` holds every figure; this module only reads.
 *
 * It sits apart from `report.ts`, which imports it, so the command module
 * stays under the size cap. It imports nothing from `report.ts`, so the
 * two form no cycle.
 */
import type { SkillsReport } from './report-skills.js';

import { loadConfig } from '../core/config/load.js';
import { resolveSessionTiers } from '../start/serving.js';

import { buildSkillsReport, readHeldLessons } from './report-skills.js';

/** Where the skills report reads from and what it narrows to. */
export interface SkillsReportOptions {
  /** The project root, with no default. Governs the config, the tiers, the lessons and the store. */
  repoRoot: string;
  /** The home the user scope's config, tier and lessons are read under. No default. */
  home: string;
  /** The plan stubs to read; every plan when null or left out. */
  plans?: readonly string[] | null;
  /** The entry the rafa tier sits beside. Defaults to `Bun.main`. */
  entry?: string;
}

/**
 * The skills report over the store under the repo root, each skill's
 * failure strings read from the tiers as they resolve now under the
 * config and each lesson resolved through the held set. See the module
 * note.
 *
 * Throws a `ConfigError`, having read no row, when a config file under
 * the repo root or the home is one the loop cannot run on.
 */
export async function readSkillsReport(options: SkillsReportOptions): Promise<SkillsReport> {
  const { repoRoot: root, home, entry } = options;
  const { config } = await loadConfig({ root, home });
  const pinned = entry === undefined
    ? {}
    : { entry };
  return buildSkillsReport({
    repoRoot: root,
    ...(options.plans === null || options.plans === undefined
      ? {}
      : { plans: options.plans }),
    resolution: resolveSessionTiers({ root, home, settings: config, ...pinned }),
    lessons: readHeldLessons({ home, projectRoot: root, ...pinned }),
  });
}
