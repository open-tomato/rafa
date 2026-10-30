/**
 * The commented lines the config `rafa init` writes carries for the
 * seven settings the release-settle plan and the lock plan add: five
 * under `release`, then `pr.versionCollision` and
 * `dangerous.acceptVersionCollision`, each
 * spelled at its schema default, read off the release section that
 * defines it (`PR_DEFAULTS`, `RELEASE_DEFAULTS` and
 * `DANGEROUS_RELEASE_DEFAULTS` of `packages/rafa/src/config-schema-release.ts`), the
 * values `CONFIG_DEFAULTS` of `src/config-registry.ts` spreads.
 * `src/project/scaffold.ts` places them, each under its own section.
 *
 * The lines are constants built as this module loads, which is before
 * an entry registers the config sections, so they read the section and
 * not core's `registeredDefaults()`: that read refuses until the
 * registration, and `rafa --version` exited 1 with it in a load-time
 * constant of `packages/rafa-board/src/board/refs-gate.ts`, measured on 2026-10-20.
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
import { DANGEROUS_RELEASE_DEFAULTS, PR_DEFAULTS, RELEASE_DEFAULTS } from '@open-tomato/rafa/config-schema-release';

/**
 * The commented lines the config `rafa init` writes carries for the
 * four `release` settings that fold change fragments into a version,
 * then `moveLock`, which has settle also write `rafa.lock`, each at its
 * schema default. `src/project/scaffold.ts` places them under
 * `# release:`, after `heading`.
 */
export const RELEASE_FRAGMENT_LINES: readonly string[] = Object.freeze([
  `#   fragments: ${RELEASE_DEFAULTS.releaseFragments}           # relative path, not under .rafa/, the change fragments are written into`,
  `#   strategy: ${RELEASE_DEFAULTS.releaseStrategy}      # semver-by-level, the only strategy`,
  `#   settle: ${RELEASE_DEFAULTS.releaseSettle}                 # push | pr, how settle lands the version on the base branch`,
  `#   tag: ${RELEASE_DEFAULTS.releaseTag}                  # manual | settle, who tags a settled version`,
  `#   moveLock: ${String(RELEASE_DEFAULTS.releaseMoveLock)}              # true has settle also write rafa.lock to the version it settles, for the repository that releases rafa`,
]);

/** The commented `pr.versionCollision` line, placed under `# pr:`. */
export const PR_VERSION_COLLISION_LINE: string =
  `#   versionCollision: ${PR_DEFAULTS.prVersionCollision}       # allow | report | ask | refuse, how pr merge meets a missing or stale fragment`;

/** The commented `dangerous.acceptVersionCollision` line, placed under `# dangerous:`. */
export const DANGEROUS_VERSION_COLLISION_LINE: string =
  `#   acceptVersionCollision: ${String(DANGEROUS_RELEASE_DEFAULTS.dangerousAcceptVersionCollision)}  # true has pr merge accept a version collision on every run`;
