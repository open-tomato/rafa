/**
 * `run`: check, seed, the project's own suite command, then place, in
 * that order. It owns none of their logic.
 *
 * A gap stops the run before seed, so the package's snapshot folder is
 * untouched. Place runs after the suite whatever its exit code, because
 * a failed assert still has to say what kind of run it was. The suite's
 * command is split on whitespace (no shell, no quoting), run in the
 * package folder, and given the words after `--` as they were typed.
 */
import type { LoadedConfig } from '../config/load.js';
import type { HostFacts } from '../host.js';
import type { ProcessRunner } from '../process.js';
import type { CheckReport } from './check.js';
import type { PlaceResult } from './place.js';
import type { SeedResult } from './seed.js';

import { join } from 'node:path';

import { checkVisual } from './check.js';
import { placeVisual } from './place.js';
import { seedVisual } from './seed.js';

/** What `run` may run. */
export interface RunSeams {
  readonly run: ProcessRunner;
  readonly host: HostFacts;
  readonly now: () => Date;
  readonly random: () => number;
  /** Capture the suite's output instead of passing it through; for tests. */
  readonly quiet?: boolean;
  /** Called with the check report before anything else runs, so it prints ahead of the suite's output. */
  readonly onCheck?: (check: CheckReport) => void;
}

/** What one run came to. */
export interface RunResult {
  readonly check: CheckReport;
  readonly seed: SeedResult | null;
  /** The suite's exit code, or null when it did not run. */
  readonly suiteExit: number | null;
  readonly place: PlaceResult | null;
  /** Why place failed, or null. */
  readonly placeError: string | null;
}

/** The suite's argv: its command split on whitespace, then the passed words. */
export function suiteArgv(command: string, passArgs: readonly string[]): readonly string[] {
  return [...command.trim().split(/\s+/), ...passArgs];
}

/** Runs check, seed, the suite and place. Refuses a runner this version does not run, before anything is touched. */
export async function runVisual(loaded: LoadedConfig, passArgs: readonly string[], seams: RunSeams): Promise<RunResult> {
  const { runner, suite } = loaded.config.visual;
  if (runner.kind === 'remote') throw new Error(`visual.runner.kind is remote; runs on ${runner.host} are your own setup, and this version starts none`);
  const check = await checkVisual(loaded, seams);
  seams.onCheck?.(check);
  const stopped = { check, seed: null, suiteExit: null, place: null, placeError: null };
  if (check.gaps.length > 0 || check.runnerKey === null) return stopped;

  const seed = await seedVisual(loaded, check, seams);
  const suiteResult = await seams.run(suiteArgv(suite.command, passArgs), { cwd: join(loaded.workRoot, suite.package), inherit: seams.quiet !== true });
  try {
    const place = await placeVisual(loaded, { runnerKey: check.runnerKey, runId: seed.runId }, { now: seams.now, host: seams.host });
    return { check, seed, suiteExit: suiteResult.exitCode, place, placeError: null };
  } catch (error) {
    return { check, seed, suiteExit: suiteResult.exitCode, place: null, placeError: error instanceof Error
      ? error.message
      : String(error) };
  }
}
