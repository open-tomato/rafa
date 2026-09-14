/**
 * The `claude` Planner adapter: a plan generated from a spec by one
 * Claude Code session, as `rafa plan` has generated one since phase 0.
 *
 * The phase 1 table names `claude` as the Planner port's core adapter,
 * "today's `plan.ts`". The part of `rafa plan` that generated the plan
 * once the command line was checked is this module now: it makes
 * `.plans/`, runs the session and reads what the session left behind.
 * The command (`src/plan.ts`) keeps what belongs to the command line:
 * the config it refuses, the `--spec`, `--stub` and `--no-progress`
 * flags, the usage check and every line the operator reads. It makes
 * this adapter through the adapter registry's `planner/claude` entry.
 *
 * ## What the adapter is made with
 *
 *   - `repoRoot`: the repository plans are written under. A spec path is
 *     resolved against it, as `rafa plan` resolves `--spec=`.
 *   - `settingSources`: what the session loads settings from, the run's
 *     resolved `loop.settingSources`. There is no default, for the reason
 *     `src/utils/claude.ts` gives.
 *   - `buildPrompt`: the session's prompt for one spec and stub.
 *     `rafa plan` hands over `buildPlanPrompt` bound to the template and
 *     the plan format it read beside itself, and to the progress notes
 *     it read or skipped. Those are read there rather than here, for two
 *     reasons. A bundle answers `import.meta.url` with its own directory,
 *     and `plan.ts` sits directly in `src/` as the bundles sit directly in
 *     `dist/`, where a module two directories down finds neither file.
 *     And `plan.ts` imports the registry, which imports this module, so
 *     this module importing `buildPlanPrompt` from `plan.ts` would close
 *     an import cycle, where `src/` held none.
 *   - `spawn`: the seam the session goes through, handed to `runClaude`
 *     with the argument list `runClaude` builds. {@link spawnClaude} when
 *     left out. The tests hand over a spawner that records what it is
 *     handed, so no case spawns `claude`.
 *
 * ## What `create` does, in order
 *
 *   1. Rejects when the plan is already there, before any session. A plan
 *      already there would be read as the session's, so a session that
 *      wrote none would pass. `rafa plan` refuses the same plan earlier,
 *      naming the flag to change, so this is the guard for every other
 *      caller.
 *   2. Reads the spec, rejecting with the read's own error when it cannot.
 *   3. Makes `.plans/` under the root when it is missing, since the session
 *      writes into it.
 *   4. Runs one session with the built prompt on stdin.
 *   5. Rejects when the session exits nonzero, whatever it wrote.
 *   6. Rejects when the session exits 0 and the plan is not there.
 *   7. Answers the plan's path, and the prerequisites' path when the
 *      session wrote that file, or null when it did not.
 *
 * The rejections of steps 1, 5 and 6 are {@link ClaudePlannerError}s. The
 * messages of steps 5 and 6 are the lines `rafa plan` printed for those
 * failures before this adapter existed, so the command prints them as
 * they were.
 *
 * ## Paths
 *
 * Both paths are repository-relative and spelled with `/`, as the port
 * documents them and as the plan prompt names them to the session:
 * `.plans/PLAN-<stub>.md` and `.plans/PREREQUISITES-<stub>.md`. The scope
 * stage moves them under `plan.dir`. The stub is used as it is handed
 * over, as `rafa plan` used `--stub=`, so a stub holding a `/` names a
 * file below a directory this adapter does not make.
 */
import type { ClaudeSettingSource } from '../../config.js';
import type { GeneratedPlan, Planner, PlanRequest } from '../../ports/index.js';
import type { ClaudeSpawner } from '../../utils/claude.js';

import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { runClaude, spawnClaude } from '../../utils/claude.js';

/** The directory plans are written under, relative to the repository root. */
const PLANS_DIR = '.plans';

/** The exit code of a rejection no session exit code stands behind. */
const FAILURE_EXIT_CODE = 1;

/** Builds one session's prompt from the spec's content and the plan's stub. */
export type PlanPromptBuilder = (specContent: string, stub: string) => string;

/** What {@link createClaudePlanner} makes a planner with. */
export interface ClaudePlannerOptions {
  /** The repository plans are written under, and spec paths resolved against. */
  readonly repoRoot: string;
  /** What the session loads settings from: the run's resolved `loop.settingSources`. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** The session's prompt for one spec and stub. */
  readonly buildPrompt: PlanPromptBuilder;
  /** The spawner the session goes through; {@link spawnClaude} when left out. */
  readonly spawn?: ClaudeSpawner;
}

/**
 * What a `claude` planner rejects with when it generated no plan: the
 * plan was already there, the session failed, or the session wrote no
 * plan. A spec that cannot be read rejects with the read's own error.
 */
export class ClaudePlannerError extends Error {
  /** The session's exit code when the session failed, and 1 otherwise. */
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = 'ClaudePlannerError';
    this.exitCode = exitCode;
  }
}

/**
 * Makes a `claude` Planner over one repository; see the module note for
 * what `create` does. The planner answered is frozen.
 */
export function createClaudePlanner(options: ClaudePlannerOptions): Planner {
  const { repoRoot, settingSources, buildPrompt, spawn = spawnClaude } = options;

  const create = async ({ specPath, stub }: PlanRequest): Promise<GeneratedPlan> => {
    const planPath = `${PLANS_DIR}/PLAN-${stub}.md`;
    const prerequisitesPath = `${PLANS_DIR}/PREREQUISITES-${stub}.md`;
    const isWritten = (relative: string): boolean => existsSync(join(repoRoot, relative));

    if (isWritten(planPath)) {
      throw new ClaudePlannerError(`${planPath} already exists`, FAILURE_EXIT_CODE);
    }
    const specContent = await readFile(resolve(repoRoot, specPath), 'utf8');
    await mkdir(join(repoRoot, PLANS_DIR), { recursive: true });

    const exitCode = await runClaude(buildPrompt(specContent, stub), settingSources, [], spawn);
    if (exitCode !== 0) {
      throw new ClaudePlannerError(`Plan generation failed (exit ${exitCode}).`, exitCode);
    }
    if (!isWritten(planPath)) {
      throw new ClaudePlannerError(
        `The session finished but ${planPath} was not created — inspect the output above.`,
        FAILURE_EXIT_CODE,
      );
    }
    return {
      planPath,
      prerequisitesPath: isWritten(prerequisitesPath)
        ? prerequisitesPath
        : null,
    };
  };

  return Object.freeze({ create });
}
