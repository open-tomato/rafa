/**
 * The commented lines the config `rafa init` writes carries for the
 * seven settings the release-settle plan and the lock plan add: five
 * under `release`, then `pr.versionCollision` and
 * `dangerous.acceptVersionCollision`, each
 * spelled at its schema default (`CONFIG_DEFAULTS` of
 * `packages/rafa/src/core/config/config.ts`).
 * `src/project/scaffold.ts` places them, each under its own section.
 *
 * This is the library half of the release step of `rafa init`; its
 * command half, `src/commands/init-release.ts`, holds the one question
 * the step asks, the decision order and the line it prints, and edits
 * the file these lines sit in without touching them. Nothing here
 * imports a file under `src/commands/`.
 *
 * Nothing here reads the disk, the clock or the environment: the three
 * exports are constants built once from the defaults.
 */
import { CONFIG_DEFAULTS } from '../config-registry.js';

/**
 * The commented lines the config `rafa init` writes carries for the
 * four `release` settings that fold change fragments into a version,
 * then `moveLock`, which has settle also write `rafa.lock`, each at its
 * schema default. `src/project/scaffold.ts` places them under
 * `# release:`, after `heading`.
 */
export const RELEASE_FRAGMENT_LINES: readonly string[] = Object.freeze([
  `#   fragments: ${CONFIG_DEFAULTS.releaseFragments}           # relative path, not under .rafa/, the change fragments are written into`,
  `#   strategy: ${CONFIG_DEFAULTS.releaseStrategy}      # semver-by-level, the only strategy`,
  `#   settle: ${CONFIG_DEFAULTS.releaseSettle}                 # push | pr, how settle lands the version on the base branch`,
  `#   tag: ${CONFIG_DEFAULTS.releaseTag}                  # manual | settle, who tags a settled version`,
  `#   moveLock: ${String(CONFIG_DEFAULTS.releaseMoveLock)}              # true has settle also write rafa.lock to the version it settles, for the repository that releases rafa`,
]);

/** The commented `pr.versionCollision` line, placed under `# pr:`. */
export const PR_VERSION_COLLISION_LINE: string =
  `#   versionCollision: ${CONFIG_DEFAULTS.prVersionCollision}       # allow | report | ask | refuse, how pr merge meets a missing or stale fragment`;

/** The commented `dangerous.acceptVersionCollision` line, placed under `# dangerous:`. */
export const DANGEROUS_VERSION_COLLISION_LINE: string =
  `#   acceptVersionCollision: ${String(CONFIG_DEFAULTS.dangerousAcceptVersionCollision)}  # true has pr merge accept a version collision on every run`;
