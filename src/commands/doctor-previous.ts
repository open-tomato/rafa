/**
 * The previous-copy reading `rafa doctor` warns by: how many previous
 * copies of issue specs `previous/` under the configured `specs.dir`
 * holds, and the warning line once that count passes
 * {@link PREVIOUS_COPY_WARN_ABOVE}.
 *
 * Every rewrite of a saved issue copy moves the old one to `previous/`
 * (`../board/previous-copy.ts`), and nothing ever deletes one, so the
 * directory only grows. The copies are small and safe to delete; the
 * line exists so a person learns that before the directory is large.
 * Fifty copies print nothing, fifty-one print the line.
 *
 * A missing `previous/` counts zero, since no rewrite has happened yet;
 * any other failure to read it throws, as {@link countPreviousCopies}
 * does. A warning here is not a fault: `doctor` keeps its exit code
 * whatever this reading says. This module prints nothing.
 */
import type { RafaConfig } from '../config.js';

import { countPreviousCopies, PREVIOUS_COPY_WARN_ABOVE, previousDir } from '../board/previous-copy.js';

/** What `rafa doctor` learns about `previous/` under `specs.dir`. */
export interface PreviousCopiesReading {
  /** The number of previous copies `previous/` holds; zero when it is missing. */
  readonly count: number;
  /** The line to warn with, or null at or below {@link PREVIOUS_COPY_WARN_ABOVE}. */
  readonly warning: string | null;
}

/**
 * The warning line for `count` previous copies under `specsDir` as
 * configured: `rafa doctor: <specs.dir>/previous/ holds <n> previous
 * copies of issue specs; they are safe to delete`.
 */
export function previousCopiesWarning(specsDir: string, count: number): string {
  return `rafa doctor: ${previousDir(specsDir)}/ holds ${count} previous copies of issue specs; they are safe to delete`;
}

/**
 * Counts the previous copies under `config.specsDir`, resolved against
 * `repoRoot`, and answers the warning only when the count is above
 * {@link PREVIOUS_COPY_WARN_ABOVE}.
 */
export function readPreviousCopies(repoRoot: string, config: Pick<RafaConfig, 'specsDir'>): PreviousCopiesReading {
  const count = countPreviousCopies(repoRoot, config.specsDir);
  const warning = count > PREVIOUS_COPY_WARN_ABOVE
    ? previousCopiesWarning(config.specsDir, count)
    : null;
  return { count, warning };
}
