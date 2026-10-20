/**
 * The facade of `rafa-effort`: every name a file outside the
 * package imports from it, re-exported from where it lives today.
 * Written by `bun scripts/survey/facade-names.ts --package=rafa-effort --entry`.
 */

export type { HubShape } from '../../src/config-schema-hub.js';
export {
  HUB_DEFAULTS,
  HUB_SECTION,
  HUB_SETTINGS,
} from '../../src/config-schema-hub.js';

export {
  planStubsFromFileNames,
  resolvePlanStub,
} from '../../src/effort/attribution.js';

export {
  default as collect,
  collectSessionRow,
} from '../../src/effort/collect.js';

export { formatDashboard } from '../../src/effort/dashboard-format.js';

export type { Dashboard } from '../../src/effort/dashboard.js';
export { readDashboard } from '../../src/effort/dashboard.js';

export type { EpicCost } from '../../src/effort/epic-cost.js';
export {
  readEpicCost,
  renderEpicCost,
} from '../../src/effort/epic-cost.js';

export { fileStamp } from '../../src/effort/file-stamp.js';

export { parseReportArgs } from '../../src/effort/report-args.js';

export { default as report } from '../../src/effort/report.js';

export { sessionLogDir } from '../../src/effort/session-log-dirs.js';

export { readSessionLog } from '../../src/effort/session-log.js';

export { SKILL_USE_CLI_VERSION } from '../../src/effort/skill-use.js';

export type { PullBeforeReadInput } from '../../src/effort/sync/contact.js';
export {
  createHubContact,
  pullBeforeRead,
} from '../../src/effort/sync/contact.js';

export type {
  DoctorEffortSyncReading,
  DoctorEffortSyncSeams,
} from '../../src/effort/sync/doctor-reading.js';
export {
  EFFORT_SYNC_ROW,
  readDoctorEffortSync,
} from '../../src/effort/sync/doctor-reading.js';

export type { FileSyncOptions } from '../../src/effort/sync/file.js';
export { createFileSync } from '../../src/effort/sync/file.js';

export { createLocalSync } from '../../src/effort/sync/select.js';

export {
  mergeFrontmatter,
  readFrontmatter,
  readFrontmatterDocument,
  renderFrontmatter,
  writeFrontmatter,
} from '../../src/schema/frontmatter.js';

export {
  AGENT_DEFINITION_DIR,
  agentEffortLookup,
  findAgentDefinition,
} from '../../src/utils/agent-definition.js';
