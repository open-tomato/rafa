/**
 * The facade of `rafa-inventory`: every name a file outside the
 * package imports from it, re-exported from where it lives today.
 * Written by `bun scripts/survey/facade-names.ts --package=rafa-inventory --entry`.
 */

export { toHeldRecords } from './src/adapters/learning/held.js';

export {
  createLocalLearning,
  localInstinctsDir,
} from './src/adapters/learning/local.js';

export type {
  AgentDefinitionFile,
  MissingAgent,
  SkillCollision,
  UnresolvedSkill,
} from './src/agents/roster.js';
export {
  VENDOR_COMMAND,
  collidingPlanSkills,
  missingAgentLine,
  missingPlanAgents,
  readAgentDirectory,
  resolveAgentRoster,
  skillCollisionLine,
  unresolvedPlanSkills,
  unresolvedSkillLine,
} from './src/agents/roster.js';

export type { VendorableAgent } from './src/agents/vendorable.js';
export {
  vendorableAgentWarnings,
  vendorableAgents,
} from './src/agents/vendorable.js';

export type { BackupResult } from './src/backfill/backup.js';
export {
  backupDirectory,
  backupFiles,
  countBackups,
} from './src/backfill/backup.js';

export type {
  DerivationAction,
  DerivationKind,
  DerivationOptions,
  DerivationPlan,
} from './src/backfill/derive.js';
export {
  DERIVATION_KINDS,
  applyDerivation,
  countDerivations,
  planDerivation,
} from './src/backfill/derive.js';

export { selectProposals } from './src/backfill/proposal-batch.js';

export type { ProposalFile } from './src/backfill/proposal-file.js';
export {
  ANSWERED_ROW,
  BACKFILL_PATH,
  REVIEWED_FILE,
  readProposalFiles,
} from './src/backfill/proposal-file.js';

export type {
  ProposalAction,
  ProposalActionKind,
} from './src/backfill/propose.js';
export {
  PROPOSAL_ACTION_KINDS,
  applyProposals,
  runProposalPass,
} from './src/backfill/propose.js';

export type { CheckKind } from './src/check/layout.js';

export {
  checkReferences,
  pathDirectories,
} from './src/check/references.js';

export type {
  CheckIssue,
  CheckOptions,
  CheckReport,
  DirectoryReport,
} from './src/check/run.js';
export { checkDirectory } from './src/check/run.js';

export { toolOf } from './src/check/shell-lines.js';

export type {
  DemotionAction,
  DemotionActionKind,
} from './src/demote/apply.js';
export {
  DEMOTION_ACTION_KINDS,
  applyDemotion,
  planDemotion,
} from './src/demote/apply.js';

export type { DemotionVerdict } from './src/demote/classify.js';
export { DEMOTION_VERDICTS } from './src/demote/classify.js';

export { buildDemotionReport } from './src/demote/draft.js';

export type { DemotionReport } from './src/demote/report.js';
export {
  REVIEWED_STATUS,
  countVerdicts,
  parseDemotionReport,
  writeDemotionReport,
} from './src/demote/report.js';

export type { DemotionScope } from './src/demote/select.js';
export {
  resolveDemotionScope,
  selectSources,
} from './src/demote/select.js';

export type { OverrideReading } from './src/inventory/disabled.js';
export {
  OVERRIDES_KEY,
  OVERRIDE_DISABLED,
  OVERRIDE_SCOPES,
  overrideFor,
  overrideSettingsPath,
  readSettings,
  readSkillOverrides,
} from './src/inventory/disabled.js';

export type {
  Inventory,
  InventorySeams,
} from './src/inventory/index.js';
export { buildInventory } from './src/inventory/index.js';

export type {
  McpDeclaration,
  McpReading,
  McpScope,
} from './src/inventory/mcp.js';
export {
  CLAUDE_JSON_FILE,
  DISABLE_KEY,
  MCP_SCOPES,
  PROJECTS_KEY,
  REJECT_KEY,
  mcpDeclarationsOf,
  mcpServerFor,
  readMcpServers,
} from './src/inventory/mcp.js';

export type {
  InventoryKind,
  InventoryRecord,
  InventorySource,
  InventoryState,
} from './src/inventory/record.js';

export type { SearchOutcome } from './src/inventory/search/index.js';
export {
  droppedLine,
  rankSearch,
  runSearch,
} from './src/inventory/search/index.js';

export type { RankedCandidate } from './src/inventory/search/rank.js';

export type { ShowView } from './src/inventory/show.js';
export {
  findShown,
  readShowView,
  renderShowView,
} from './src/inventory/show.js';

export {
  BUNDLED_AGENTS_DIR,
  bundledAgentsDirectory,
} from './src/inventory/trees.js';

export { promotable } from './src/learning/bless.js';

export { triggerKey } from './src/learning/identity.js';

export type {
  BlessedBundle,
  InstinctRecord,
} from './src/learning/types.js';

export type {
  CommandFinding,
  PathSeams,
  RiskLevel,
} from './src/plan/risk/commands.js';
export {
  readBodyCommands,
  readTaskLineCommands,
} from './src/plan/risk/commands.js';

export { readLongRuns } from './src/plan/risk/long-runs.js';

export { reportLessons } from './src/report/lessons.js';

export type {
  Instinct,
  InstinctEvidence,
  InstinctScope,
} from './src/schema/instinct.js';
export {
  ACTION_HEADING,
  CAUSE_HEADING,
} from './src/schema/instinct.js';

export type {
  Provenance,
  ProvenanceIssueCode,
} from './src/schema/provenance.js';
export {
  PROVENANCE_FIELD,
  checkProvenance,
  readProvenance,
} from './src/schema/provenance.js';

export type {
  InstinctRecordEntry,
  ScopeListing,
} from './src/schema/scope-records.js';
export { readScopes } from './src/schema/scope-records.js';

export type { SessionServing } from './src/start/serving.js';
export {
  resolveSessionTiers,
  serveSession,
} from './src/start/serving.js';

export type {
  ResolvedSkill,
  TaskInput,
} from './src/task/resolve-skills.js';
export { SKILL_RESOLVER_BY_NAME } from './src/task/resolve-skills.js';

export {
  renderLessonsSection,
  renderSkillsSection,
} from './src/task/sections.js';

export { selectLessons } from './src/task/select-lessons.js';

export { renderSkillIndex } from './src/task/skill-index.js';

export { SERVE_CLI_VERSION } from './src/tiers/delivery.js';

export type {
  Resolution,
  ServedItem,
  TierCollision,
  TierRow,
  TierSettings,
} from './src/tiers/resolve.js';
export {
  pinKey,
  pinLine,
} from './src/tiers/resolve.js';

export {
  DEFAULT_ROUTES,
  DEFAULT_ROUTING,
} from './src/tiers/routing.js';

export {
  SKILL_FILE,
  provenanceBlock,
} from './src/tiers/serve.js';

export { bareSkillName } from './src/tiers/skill-names.js';
