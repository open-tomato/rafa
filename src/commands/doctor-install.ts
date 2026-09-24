/**
 * The readings about the install `rafa doctor` warns by, moved here
 * whole from `./doctor.ts` so that file stays under its line cap: where
 * `~/.rafa/bin` sits on the `PATH` handed in (`../project/bin-path.ts`),
 * an effort store left under `.ralph/effort/`
 * (`../effort/store/legacy.ts`), a `plan.dir` or `specs.dir` still
 * naming a pre-init directory (`../project/pre-init-dirs.ts`), and the
 * previous copies under `specs.dir` (`./doctor-previous.ts`).
 *
 * `doctor` reads them before its preflight and writes them after it,
 * whatever it did, a refusal included; `./doctor.ts`'s module note says
 * what each warns about. A reading that cannot be taken is a warning or
 * a null, never a failure, and none changes the exit code.
 */
import type { PreviousCopiesReading } from './doctor-previous.js';
import type { RafaContext } from '../cli/command.js';
import type { LegacyStoreReading } from '../effort/store/legacy.js';
import type { BinPathReading } from '../project/bin-path.js';
import type { PreInitDirsReading } from '../project/pre-init-dirs.js';
import type { ProjectFound } from '../project/scope.js';

import { loadConfig } from '../config-load.js';
import { messageOf } from '../config-sections.js';
import { readLegacyStore } from '../effort/store/legacy.js';
import { readBinPath } from '../project/bin-path.js';
import { readPreInitDirs } from '../project/pre-init-dirs.js';

import { readPreviousCopies } from './doctor-previous.js';

/** The two directories of the project the readings take: its root, and the home its `~/.rafa/bin` is under. */
type InstallProject = Pick<ProjectFound, 'root' | 'home'>;

/** The three readings about the install, read before the preflight. */
export interface InstallReadings {
  readonly binPath: BinPathReading;
  readonly legacyStore: LegacyStoreReading | null;
  /** Which of `plan.dir` and `specs.dir` still name a pre-init directory; null for a config that could not be loaded. */
  readonly preInitDirs: PreInitDirsReading | null;
  /** How many previous copies `previous/` under `specs.dir` holds; null when they could not be counted. */
  readonly previousCopies: PreviousCopiesReading | null;
  /** Why the effort directories could not be checked, as a warning; null when they were. */
  readonly storeProblem: string | null;
}

/**
 * Which of `plan.dir` and `specs.dir` still name a pre-init directory,
 * or null for a config that cannot be loaded, which the preflight
 * refuses on its own. The config is loaded a second time here, before
 * the preflight loads it, with the warnings dropped so a person reads
 * each of them once: `resolvedConfig` writes them.
 */
function readPreInit(project: InstallProject): PreInitDirsReading | null {
  try {
    const { config } = loadConfig({ root: project.root, home: project.home }, {}, () => undefined);
    return readPreInitDirs(config);
  } catch {
    return null;
  }
}

/** The previous-copy count under `specs.dir`; null for a config that could not be loaded or a `previous/` that could not be read. */
function readPrevious(project: InstallProject): PreviousCopiesReading | null {
  try {
    const { config } = loadConfig({ root: project.root, home: project.home }, {}, () => undefined);
    return readPreviousCopies(project.root, config);
  } catch {
    return null;
  }
}

/** Every reading about the install; a store that cannot be checked is a warning, not a failure. */
export function readInstall(context: Pick<RafaContext, 'env'>, project: InstallProject): InstallReadings {
  const binPath = readBinPath(context.env['PATH'], project.home);
  const preInitDirs = readPreInit(project);
  const previousCopies = readPrevious(project);
  try {
    return { binPath, legacyStore: readLegacyStore(project.root), preInitDirs, previousCopies, storeProblem: null };
  } catch (error) {
    const storeProblem = `rafa doctor: the effort store directories could not be checked: ${messageOf(error)}`;
    return { binPath, legacyStore: null, preInitDirs, previousCopies, storeProblem };
  }
}

/** Writes each warning the readings carry, and in text mode the line saying the `PATH` order holds. */
export function writeInstall(context: Pick<RafaContext, 'output' | 'outputMode'>, install: InstallReadings): void {
  const { binPath, legacyStore, preInitDirs, previousCopies, storeProblem } = install;
  if (storeProblem !== null) context.output.warn(storeProblem);
  if (legacyStore !== null && legacyStore.warning !== null) context.output.warn(legacyStore.warning);
  if (preInitDirs !== null && preInitDirs.warning !== null) context.output.warn(preInitDirs.warning);
  if (previousCopies !== null && previousCopies.warning !== null) context.output.warn(previousCopies.warning);
  if (binPath.warning !== null) {
    context.output.warn(binPath.warning);
    return;
  }
  if (context.outputMode !== 'json') {
    context.output.info(`${binPath.rafaBin} is on PATH, and ${binPath.bunBin} is not ahead of it.`);
  }
}
