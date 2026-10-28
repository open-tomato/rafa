/**
 * The barrel over the config's value readers: every name
 * `config-sections.ts`, `config-readers.ts`, `branch-template.ts` and
 * `merge-method.ts` export, and nothing else.
 *
 * A file outside `packages/rafa/src/core/` imports this file and never the four behind
 * it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `packages/rafa/src/core/` imports the four directly and never this file.
 *
 * ## Why the pair has a barrel of its own
 *
 * `packages/rafa/src/core/config/` has three barrels, all listed under `CORE_BARRELS`
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
 * `branch-template.ts` joined the pair with the readers of a branch name
 * through the `naming.branch` template, `branchGlob` and `stubOfBranch`.
 * It imports `config-readers.ts` alone, so it is a leaf as the pair is,
 * and it sits beside `branchFromTemplate`, the writer it reads back.
 * `DEFAULT_BASE_BRANCH`, the base `pr.base` unset is read as, joined it
 * from `packages/rafa-run/src/next/sources.ts`, so a reader of the base takes it beside
 * `DEFAULT_BRANCH_TEMPLATE` without reaching `rafa next`'s composition.
 *
 * `merge-method.ts` joined with the words `pr.mergeMethod` takes, its
 * list and its guard, moved out of `packages/rafa/src/pr/types.ts` so the release
 * section reads them without reaching the pull request port. It imports
 * nothing, so it is a leaf too, and `packages/rafa/src/pr/types.ts` re-exports its
 * names from here.
 *
 * ## What it exports
 *
 * Each name is spelled, types apart from values, as the entries
 * `src/index.ts` and `src/plan/index.ts` spell theirs.
 *
 * `sections.test.ts` holds the list to the four files: every name any
 * of them exports is here once, as the same binding, and no name is here
 * that none of them exports.
 */
export type {
  ReleasePublishMode,
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
  DuplicatesLevel,
  InjectMode,
  LessonSwitch,
  Mapping,
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
export type { MergeMethod } from './merge-method.js';

export { branchGlob, DEFAULT_BASE_BRANCH, stubOfBranch } from './branch-template.js';
export {
  BRANCH_STUB,
  branchFromTemplate,
  branchTemplate,
  DEFAULT_BRANCH_TEMPLATE,
  directory,
  fragmentsDirectory,
  isBranchTemplate,
  mapOf,
  RELEASE_PUBLISH_MODES,
  RELEASE_SETTLE_MODES,
  RELEASE_STRATEGIES,
  RELEASE_TAG_MODES,
  releaseFile,
  releasePublishMode,
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
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  CONFIG_VERSIONS,
  dayCount,
  describeValue,
  DUPLICATE_LEVELS,
  duplicatesLevel,
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
export { isMergeMethod, MERGE_METHODS } from './merge-method.js';
