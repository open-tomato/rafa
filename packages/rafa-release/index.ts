/**
 * The facade of `rafa-release`: every name a file outside the
 * package imports from it, re-exported from where it lives today.
 * Written by `bun scripts/survey/facade-names.ts --package=rafa-release --entry`.
 */

export type {
  PastHeadCommit,
  PastHeadRead,
  PastHeadReading,
  PastHeadSettings,
} from '../../src/cleanup/past-head.js';
export { readPastHead } from '../../src/cleanup/past-head.js';

export type {
  DoctorLadderConfig,
  DoctorLadderReading,
} from '../../src/commands/doctor-ladder.js';
export {
  readDoctorLadder,
  writeDoctorLadder,
} from '../../src/commands/doctor-ladder.js';

export { RELEASE_SUBJECT } from '../../src/commands/release/declarations.js';

export type { WaitingReading } from '../../src/commands/release/status-fragments.js';
export {
  forecastPhrase,
  readWaiting,
  waitingSettingsOf,
} from '../../src/commands/release/status-fragments.js';

export type {
  ReleaseDangerousShape,
  ReleaseShape,
} from '../../src/config-schema-release.js';
export {
  DANGEROUS_RELEASE_DEFAULTS,
  DANGEROUS_RELEASE_SETTINGS,
  PR_DEFAULTS,
  PR_SETTINGS,
  RELEASE_DEFAULTS,
  RELEASE_SECTION,
  RELEASE_SETTINGS,
} from '../../src/config-schema-release.js';

export type { EpicEndRelease } from '../../src/next/epic-end.js';
export {
  epicEndLines,
  readEpicEndRelease,
  watchDryEpic,
} from '../../src/next/epic-end.js';

export {
  LOCK_FILE,
  readProjectLock,
  writeProjectLock,
} from '../../src/project/lock.js';

export {
  forecastMoved,
  readBodyForecast,
} from '../../src/release/body-forecast.js';

export type {
  BranchForecast,
  BranchForecastInput,
  BranchForecastSettings,
} from '../../src/release/branch-forecast.js';
export {
  bodyWithRelease,
  forecastLine,
  readBranchForecast,
  releaseBodyBlock,
  releaseBodyLines,
} from '../../src/release/branch-forecast.js';

export type { ChangelogNote } from '../../src/release/changelog.js';

export type { ReleaseFileSettings } from '../../src/release/enabled.js';
export { resolveReleaseEnabled } from '../../src/release/enabled.js';

export type {
  ForecastBasis,
  SettleForecast,
} from '../../src/release/forecast.js';
export { forecastSettle } from '../../src/release/forecast.js';

export {
  directoryPrefix,
  fragmentIdOf,
  readFragmentTree,
} from '../../src/release/fragment-tree.js';

export {
  FRAGMENT_PLAN_ID_PATTERN,
  allocateFragmentName,
  parseFragment,
  serializeFragment,
} from '../../src/release/fragment.js';

export type {
  GuardReaction,
  MergeGuardSettings,
} from '../../src/release/guard-merge.js';
export {
  guardReaction,
  mergeGuardSettings,
  readMergeGuard,
} from '../../src/release/guard-merge.js';

export type {
  GuardAnswer,
  GuardReading,
  GuardStamp,
  GuardVerdict,
} from '../../src/release/guard.js';
export {
  guardLines,
  localPlanNotes,
  readGuard,
} from '../../src/release/guard.js';

export { releaseLevelReport } from '../../src/release/level.js';

export type {
  ReleasePreparation,
  ReleasePreparationInput,
  ReleasePrepared,
  ReleaseSettings,
  ReleaseSkipped,
} from '../../src/release/prepare.js';
export { prepareRelease } from '../../src/release/prepare.js';

export type { ReleaseDelivery } from '../../src/release/release-delivery.js';
export {
  releaseDeliveryLine,
  releaseDeliveryOf,
} from '../../src/release/release-delivery.js';

export { moveSpelling } from '../../src/release/release-move.js';

export {
  DANGEROUS_VERSION_COLLISION_LINE,
  PR_VERSION_COLLISION_LINE,
  RELEASE_FRAGMENT_LINES,
} from '../../src/release/scaffold.js';

export {
  RELEASE_ENABLED_SETTING,
  readReleaseSetting,
  releaseEnabledIn,
  withReleaseEnabled,
} from '../../src/release/setting.js';

export type { SettleSettings } from '../../src/release/settle.js';
export {
  readSettle,
  settleMoves,
  versionAt,
} from '../../src/release/settle.js';

export {
  changelogVersions,
  compareVersions,
  readTags,
} from '../../src/release/status-readings.js';

export type { FoldFragment } from '../../src/release/strategy.js';
export { releaseStrategyFor } from '../../src/release/strategy.js';

export type {
  ReleaseVerification,
  ReleaseVerificationContext,
} from '../../src/release/verify.js';
export { verifyRelease } from '../../src/release/verify.js';

export {
  RELEASE_BASE_BRANCH,
  RELEASE_REMOTE,
  gitPathOf,
  nextVersion,
  parseSemanticVersion,
  readManifestVersion,
  replaceManifestVersion,
} from '../../src/release/version.js';

export type { WorkspacePackage } from '../../src/release/workspace-packages.js';
export {
  publishableOf,
  readWorkspacePackages,
} from '../../src/release/workspace-packages.js';
