/**
 * The barrel over the config's value readers: every name
 * `config-sections.ts` and `config-readers.ts` export, and nothing else.
 *
 * A file outside `src/core/` imports this file and never the two behind
 * it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `src/core/` imports the two directly and never this file.
 *
 * ## Why the pair has a barrel of its own
 *
 * `src/core/config/` has three barrels, all listed under `CORE_BARRELS`
 * in `scripts/survey/core-moves.ts`. This one holds the leaf pair: the
 * two files import each other one way (`config-readers.ts` reads
 * `config-sections.ts`), `node:path`, and four modules that import none
 * of the config back. The schema's section files (`src/config-schema-*.ts`)
 * import the pair by value. While `config-merged.ts` imported them by
 * value in turn, one barrel over the pair and the schema would have made
 * every section file import a barrel that imports it back: a runtime
 * cycle that fails as a `ReferenceError` at load, in one import order
 * only. That file is retired, and measured since, no value import of a
 * file behind `index.ts` reaches a section file, so that cycle is no
 * longer what keeps the two barrels apart; they stay as the move left
 * them, a name with one barrel to be learned from.
 *
 * ## What it exports
 *
 * Each name is spelled, types apart from values, as the entries
 * `src/index.ts` and `src/plan/index.ts` spell theirs. `MergeMethod` is
 * the one name here neither file declares: `config-sections.ts`
 * re-exports it from `pr/types.ts` so `config-schema-release.ts` can type
 * a field with it, and it passes through unchanged.
 *
 * `sections.test.ts` holds the list to the two files: every name either
 * exports is here once, as the same binding, and no name is here that
 * neither exports.
 */
export type {
  ReleaseSettleMode,
  ReleaseStrategy,
  ReleaseTagMode,
  VersionCollisionMode,
} from './config-readers.js';
export type {
  BoardRelationshipMode,
  ClaimsAhead,
  ClaimsStaleAfter,
  ClaudeSettingSource,
  ConfigExtra,
  ConfigVersion,
  InjectMode,
  LessonSwitch,
  Mapping,
  MergeMethod,
  OutputMode,
  PrProvider,
  Reader,
  Reading,
  ReleaseEnabled,
  RouteTarget,
  SkillResolverName,
  StoreBackend,
  SyncStrategy,
  TierPin,
  TierSwitch,
  ValueAt,
} from './config-sections.js';

export {
  directory,
  fragmentsDirectory,
  mapOf,
  RELEASE_SETTLE_MODES,
  RELEASE_STRATEGIES,
  RELEASE_TAG_MODES,
  releaseFile,
  releaseSettleMode,
  releaseStrategy,
  releaseTagMode,
  routeTable,
  tierPins,
  trackerKind,
  VERSION_COLLISION_MODES,
  versionCollisionMode,
} from './config-readers.js';
export {
  below,
  BOARD_PROJECT_TEMPLATE_DEFAULT,
  BOARD_RELATIONSHIP_MODES,
  BUSY_TIMEOUT_MAX_MS,
  BUSY_TIMEOUT_MIN_MS,
  busyTimeoutMs,
  claimDurationHours,
  CLAIMS_AHEAD,
  CLAIMS_STALE_DISABLED,
  claimsAhead,
  claimsStaleAfter,
  CLAUDE_SETTING_SOURCES,
  confidence,
  CONFIG_VERSIONS,
  dayCount,
  describeValue,
  flag,
  githubLogin,
  INJECT_MODES,
  isBusyTimeoutMs,
  isGitHubLogin,
  isMapping,
  issueNumber,
  LESSON_SWITCHES,
  lessonSwitch,
  listOf,
  mapReading,
  mergeMethod,
  messageOf,
  oneOf,
  OUTPUT_MODES,
  PR_PROVIDERS,
  projectNumber,
  projectUrl,
  recurrenceCount,
  refused,
  refusedWith,
  RELEASE_AUTO,
  releaseEnabled,
  routeTarget,
  SKILL_RESOLVERS,
  skillResolverName,
  STORE_BACKENDS,
  subsetOf,
  SYNC_STRATEGIES,
  text,
  TIER_SWITCHES,
  tierPin,
  tierSwitch,
  usdAmount,
} from './config-sections.js';
