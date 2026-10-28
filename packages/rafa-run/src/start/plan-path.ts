/**
 * The plan a run executes: the file `--plan` names, or the default plan
 * when the line names none.
 *
 * The default is `PLAN.md` in `plan.dir` under the project root, the
 * directory `rafa plan create` writes plans into, when that file exists,
 * and `PLAN.md` at the project root otherwise, where a hand-written plan
 * sits. `plan.dir` is the value the config resolves: relative to the
 * project root, or absolute. A `.rafa/plans/PLAN.md` is read only when
 * `plan.dir` names `.rafa/plans`.
 *
 * `--plan` resolves against the project root whatever `plan.dir` says, so
 * a plan named on the line is found where it was named. A bare `--plan=`
 * names nothing and falls back to the default, as it did before `plan.dir`
 * was read.
 *
 * The path answered is absolute and need not exist: `start()` refuses a
 * plan file that does not, naming the path answered here.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** The file name of the plan a run falls back to when `--plan` names none. */
export const DEFAULT_PLAN_FILE = 'PLAN.md';

/**
 * The absolute path of the plan a run executes, from the project root,
 * the resolved `plan.dir` and the value of `--plan`, undefined when the
 * flag is not given; see the module note.
 */
export function resolvePlanPath(
  repoRoot: string,
  planDir: string,
  planArg: string | undefined,
): string {
  if (planArg) return resolve(repoRoot, planArg);

  const inPlanDir = resolve(repoRoot, planDir, DEFAULT_PLAN_FILE);
  return existsSync(inPlanDir)
    ? inPlanDir
    : resolve(repoRoot, DEFAULT_PLAN_FILE);
}
