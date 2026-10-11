/**
 * The settings a cleanup reading that never fetches runs with: the
 * resolved config's, laid over a project root and a home. This is the
 * library half of `../commands/doctor-cleanup.ts`, which keeps the
 * reading `rafa doctor` runs with them (`readDoctorCleanup`) and the
 * one row it prints.
 *
 * Nothing here reads a command's context, its arguments or its flags,
 * and nothing here imports from `src/commands/`, so any folder may take
 * {@link doctorCleanupSettings}: `../status/sections.ts` reads the
 * housekeeping section of `rafa status` with it, and `../status/seen.ts`
 * the snapshot taken before a command runs.
 *
 * ## Without fetching
 *
 * `fetch` is false, so a `readCleanup` over these settings runs no
 * `git fetch --prune` and sends nothing over the network for git: an
 * upstream reads as gone as of the last fetch that ran, which is
 * `rafa cleanup`'s to refresh (`./index.ts`, "The fetch").
 *
 * ## Where it reads
 *
 * `cwd` and `projectRoot` are both the project root, where every probe
 * `rafa doctor` checks runs, not the directory the command was typed
 * in: the counts are the project's, and a run from a subdirectory reads
 * the same ones. The rest are the resolved config's `pr.base`,
 * `cleanup.keep`, `cleanup.staleDays` and `cleanup.worktreeIdleDays`,
 * as `rafa cleanup` reads them, and `loop.worktreeDir`, which
 * `rafa status` and the status hook hand in too; a config that lacks it
 * reads the loop's worktrees under the default `.rafa/worktrees`.
 *
 * Nothing here runs git, reads the disk, prints or writes: the one
 * function answers a new settings object from what it is handed.
 */
import type { CleanupSettings } from './index.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { RafaConfig } from '../config.js';

import { CONFIG_DEFAULTS } from '../config.js';

/** What a cleanup reading that never fetches reads from. */
export interface DoctorCleanupInput {
  /** The project root: git runs here, and its `.rafa/runs/` holds the loop's sessions. */
  readonly root: string;
  /** The home `~/.rafa/worktrees/` is under. */
  readonly home: string;
  /** The resolved config the four settings are read from. */
  readonly config: Pick<RafaConfig, 'prBase' | 'cleanupKeep' | 'cleanupStaleDays' | 'cleanupWorktreeIdleDays'>
    & Partial<Pick<RafaConfig, 'loopWorktreeDir'>>;
  /** The `gh` runner `doctor` opened for the board, or null for a provider that is not `gh`. */
  readonly gh: GhRunner | null;
}

/** The settings `input` reads with: the config's, `fetch` false; see the module note. */
export function doctorCleanupSettings(input: DoctorCleanupInput, now: Date): CleanupSettings {
  const { config } = input;
  return {
    fetch: false,
    base: config.prBase,
    keep: config.cleanupKeep,
    staleDays: config.cleanupStaleDays,
    worktreeIdleDays: config.cleanupWorktreeIdleDays,
    now,
    home: input.home,
    cwd: input.root,
    projectRoot: input.root,
    worktreeDir: config.loopWorktreeDir ?? CONFIG_DEFAULTS.loopWorktreeDir,
  };
}
