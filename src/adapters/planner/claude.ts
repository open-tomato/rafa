/**
 * The `claude` Planner adapter: a plan generated from a spec by one
 * Claude Code session, as `rafa plan` has generated one since phase 0.
 *
 * The phase 1 table names `claude` as the Planner port's core adapter,
 * "today's `plan.ts`". The part of `rafa plan` that generated the plan
 * once the command line was checked is this module now: it makes the
 * plans directory, runs the session and reads what the session left
 * behind. The command (`src/plan.ts`) keeps what belongs to the command
 * line: the config it refuses, the `--spec`, `--stub` and `--no-progress`
 * flags, the usage check and every line the operator reads. It makes
 * this adapter through the adapter registry's `planner/claude` entry.
 *
 * ## What the adapter is made with
 *
 *   - `repoRoot`: the repository plans are written under. A spec path is
 *     resolved against it, as `rafa plan` resolves `--spec=`.
 *   - `planDir`: the directory plans are written into, the run's resolved
 *     `plan.dir`, relative to `repoRoot` or absolute. There is no default:
 *     a planner falling back on one would write the plan somewhere the
 *     project's config sends neither `rafa loop start` nor
 *     `rafa effort collect`.
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
 *   - `spawn`: the seam the session goes through, handed to
 *     `runClaudeCaptured` with the argument list that builds.
 *     {@link spawnClaudeCaptured} when left out. The tests hand over a
 *     spawner that records what it is handed, so no case spawns
 *     `claude`.
 *
 * ## What `create` does, in order
 *
 *   1. Rejects when the plan is already there, before any session. A plan
 *      already there would be read as the session's, so a session that
 *      wrote none would pass. `rafa plan` refuses the same plan earlier,
 *      naming the flag to change, so this is the guard for every other
 *      caller.
 *   2. Reads the spec, rejecting with the read's own error when it cannot.
 *   3. Makes `planDir` when it is missing, since the session writes into
 *      it.
 *   4. Runs one session with the built prompt on stdin, CAPTURING its
 *      stdout.
 *   5. Reads the session's `rafa:spec-review` block out of that stdout,
 *      once, whatever the session went on to do.
 *   6. Rejects when the session exits nonzero, whatever it wrote.
 *   7. Rejects when the session exits 0 and the plan is not there.
 *   8. Answers the plan's path, the prerequisites' path when the
 *      session wrote that file or null when it did not, and the review
 *      of step 5.
 *
 * The rejections of steps 1, 6 and 7 are {@link ClaudePlannerError}s. The
 * messages of steps 6 and 7 are the lines `rafa plan` printed for those
 * failures before this adapter existed, so the command prints them as
 * they were.
 *
 * ## The review the session rides back on
 *
 * The plan prompt asks the session to judge the spec before planning and
 * to open its answer with a `rafa:spec-review` block, which is check 3
 * of the readiness gate. That block is in the session's OUTPUT and
 * nowhere else, which is why this adapter spawns through the capturing
 * door: {@link spawnClaude} answers an exit code alone, and a planner
 * holding that exit code holds nothing the gate can read. The operator
 * still sees the session as it runs, through the tee in
 * {@link spawnClaudeCaptured}.
 *
 * `parseSpecReview` never throws and answers one of four readings, so
 * the review is read ONCE, right after the session returns, and carried
 * on every answer that session stands behind: the {@link GeneratedPlan},
 * the failed-session rejection and the plan-not-written rejection. That
 * last one is the ordinary shape of a not-ready verdict — a session that
 * judged the spec unplannable writes no plan — so a rejection that lost
 * the reading would leave `rafa plan` with nothing to post. The two
 * rejections raised BEFORE any session, the plan already there and the
 * spec that cannot be read, carry no review, because no session judged
 * anything.
 *
 * Nothing here acts on the verdict. A planner that refused a not-ready
 * spec would put the gate in two places and make `--skip-review`
 * unreachable, since that flag bypasses check 3 alone and the session
 * still writes its block. Removing a plan file a not-ready session left
 * behind, posting the gaps, moving the labels and the exit code are
 * `rafa plan`'s.
 *
 * ## Paths
 *
 * Both paths are {@link planFilePath}s of `planDir`, as the port documents
 * them and as the plan prompt names them to the session:
 * `<planDir>/PLAN-<stub>.md` and `<planDir>/PREREQUISITES-<stub>.md`,
 * repository-relative unless `planDir` is absolute, and read against the
 * root either way. `rafa plan` spells the plan it refuses and the plan it
 * announces through the same function. The stub is used as it is handed
 * over, as `rafa plan` used `--stub=`, so a stub holding a `/` names a
 * file below a directory this adapter does not make.
 */
import type { SpecReviewReading } from '../../board/spec-review.js';
import type { ClaudeSettingSource } from '../../config.js';
import type { GeneratedPlan, Planner, PlanRequest } from '../../ports/index.js';
import type { CapturingSpawner } from '../../utils/claude.js';

import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';

import { parseSpecReview } from '../../board/spec-review.js';
import { runClaudeCaptured, spawnClaudeCaptured } from '../../utils/claude.js';

/** The exit code of a rejection no session exit code stands behind. */
const FAILURE_EXIT_CODE = 1;

/**
 * A file in the plans directory `planDir`, as a planner answers it and as
 * the plan prompt names it: the two joined with `/`, relative to the
 * repository root unless `planDir` is absolute.
 */
export function planFilePath(planDir: string, fileName: string): string {
  return posix.join(planDir, fileName);
}

/** Builds one session's prompt from the spec's content and the plan's stub. */
export type PlanPromptBuilder = (specContent: string, stub: string) => string;

/** What {@link createClaudePlanner} makes a planner with. */
export interface ClaudePlannerOptions {
  /** The repository plans are written under, and spec paths resolved against. */
  readonly repoRoot: string;
  /** Where plans are written: the run's resolved `plan.dir`, relative to `repoRoot` or absolute. */
  readonly planDir: string;
  /** What the session loads settings from: the run's resolved `loop.settingSources`. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** The session's prompt for one spec and stub. */
  readonly buildPrompt: PlanPromptBuilder;
  /** The spawner the session goes through; {@link spawnClaudeCaptured} when left out. */
  readonly spawn?: CapturingSpawner;
}

/**
 * What a `claude` planner rejects with when it generated no plan: the
 * plan was already there, the session failed, or the session wrote no
 * plan. A spec that cannot be read rejects with the read's own error.
 */
export class ClaudePlannerError extends Error {
  /** The session's exit code when the session failed, and 1 otherwise. */
  readonly exitCode: number;

  /**
   * What the session said about the spec, or null when the rejection
   * came before any session ran. See the module note.
   */
  readonly review: SpecReviewReading | null;

  constructor(message: string, exitCode: number, review: SpecReviewReading | null = null) {
    super(message);
    this.name = 'ClaudePlannerError';
    this.exitCode = exitCode;
    this.review = review;
  }
}

/**
 * Makes a `claude` Planner over one repository; see the module note for
 * what `create` does. The planner answered is frozen.
 */
export function createClaudePlanner(options: ClaudePlannerOptions): Planner {
  const { repoRoot, planDir, settingSources, buildPrompt, spawn = spawnClaudeCaptured } = options;

  const create = async ({ specPath, stub }: PlanRequest): Promise<GeneratedPlan> => {
    const planPath = planFilePath(planDir, `PLAN-${stub}.md`);
    const prerequisitesPath = planFilePath(planDir, `PREREQUISITES-${stub}.md`);
    const isWritten = (path: string): boolean => existsSync(resolve(repoRoot, path));

    if (isWritten(planPath)) {
      throw new ClaudePlannerError(`${planPath} already exists`, FAILURE_EXIT_CODE);
    }
    const specContent = await readFile(resolve(repoRoot, specPath), 'utf8');
    await mkdir(resolve(repoRoot, planDir), { recursive: true });

    const session = await runClaudeCaptured(
      buildPrompt(specContent, stub),
      settingSources,
      [],
      spawn,
    );
    const review = parseSpecReview(session.stdout);
    const { exitCode } = session;
    if (exitCode !== 0) {
      throw new ClaudePlannerError(`Plan generation failed (exit ${exitCode}).`, exitCode, review);
    }
    if (!isWritten(planPath)) {
      throw new ClaudePlannerError(
        `The session finished but ${planPath} was not created — inspect the output above.`,
        FAILURE_EXIT_CODE,
        review,
      );
    }
    return {
      planPath,
      prerequisitesPath: isWritten(prerequisitesPath)
        ? prerequisitesPath
        : null,
      review,
    };
  };

  return Object.freeze({ create });
}
