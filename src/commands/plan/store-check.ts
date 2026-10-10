/**
 * The effort-store rules read over one plan file and its PREREQUISITES
 * file, shared by `rafa plan validate` (`./validate.ts`) and
 * `rafa plan create` (`src/plan.ts`), so the two commands hold a plan to
 * one reading of `src/plan/store-rules.ts`.
 *
 * ## The reading
 *
 * {@link checkStoreRules} reads the PREREQUISITES file that sits beside
 * the plan under the name `prerequisitesPathForPlan` derives from it,
 * `PREREQUISITES-<stub>.md`, absent when the plan's name carries no stub
 * or no file sits there, and hands both texts to
 * `findStoreRuleProblems`. It is pure but for that one read; the plan's
 * own text is the caller's.
 *
 * ## The refusal on `plan create`
 *
 * {@link enforceStoreRules} runs straight after the planner answers and
 * before the readiness gate settles its verdict, so a plan that
 * `loop start`'s preflight would refuse is never announced as ready. On
 * any problem it moves the plan, and the PREREQUISITES file when there
 * is one, into `rejected/` beside them (`rejectedPath` in
 * `./plan-files.ts`, shared with `src/board/gate.ts` so neither module
 * imports the other), where the next `loop start` does not pick them
 * up and an operator can still read what the session cost, and throws
 * `CommandExit(1)` listing one `storeRuleLine` per problem, the plan
 * named by the path the planner answered. A file that cannot be moved is
 * warned about and the refusal is thrown all the same.
 *
 * The check runs under `--skip-review` too: that flag bypasses the
 * readiness gate alone, and the store rules are no part of it.
 *
 * A plan the planner answered that is not on disk is not read here, and
 * refuses nothing: the `claude` adapter already rejects a session that
 * wrote no plan ("was not created"), so the case is a planner that keeps
 * its plan elsewhere, or the fixture planner `src/plan.test.ts` resolves,
 * which answers a path it never writes. `loop start`'s preflight reads
 * the plan where the loop finds it, with the same rules.
 */
import type { StoreRuleProblem } from '../../plan/store-rules.js';
import type { GeneratedPlan, Output } from '../../ports/index.js';

import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { activeOutput } from '../../adapters/output/active.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { findStoreRuleProblems, storeRuleLine } from '../../plan/store-rules.js';
import { prerequisitesPathForPlan } from '../../preflight/prerequisites-md.js';

import { isFile, plural, rejectedPath } from './plan-files.js';

/** The text at `path`, or null when no file sits there. */
function readFileOrNull(path: string | null): string | null {
  return path !== null && isFile(path)
    ? readFileSync(path, 'utf8')
    : null;
}

/**
 * The effort-store rules the plan at `file`, whose text is `markdown`,
 * breaks, read with the PREREQUISITES file beside it; see the module
 * note.
 */
export function checkStoreRules(file: string, markdown: string): readonly StoreRuleProblem[] {
  const prerequisitesPath = prerequisitesPathForPlan(file);
  return findStoreRuleProblems({
    plan: markdown,
    prerequisites: readFileOrNull(prerequisitesPath),
    prerequisitesName: basename(prerequisitesPath ?? 'PREREQUISITES-<stub>.md'),
  });
}

/** Moves `path`, under `repoRoot`, into `rejected/` beside it when it is a file, reporting the move. */
function moveRejected(repoRoot: string, path: string, output: Output): void {
  const full = resolve(repoRoot, path);
  if (!isFile(full)) return;
  const destination = rejectedPath(path);
  try {
    mkdirSync(resolve(repoRoot, dirname(destination)), { recursive: true });
    renameSync(full, resolve(repoRoot, destination));
    output.info(`🗃  Moved ${path} to ${destination}: the plan breaks the effort-store rules.`);
  } catch (error) {
    output.warn(`${path} breaks the effort-store rules and could not be moved: ${messageOf(error)}`);
  }
}

/**
 * Refuses the plan the planner answered when it breaks an effort-store
 * rule: both files moved into `rejected/`, then `CommandExit(1)` with
 * one `storeRuleLine` per problem. Returns quietly on a plan that breaks
 * none, and on one that is not on disk. Paths are read against `repoRoot`; see the module note.
 */
export function enforceStoreRules(
  repoRoot: string,
  generated: GeneratedPlan,
  output: Output = activeOutput(),
): void {
  const planFile = resolve(repoRoot, generated.planPath);
  if (!isFile(planFile)) return;
  const problems = checkStoreRules(planFile, readFileSync(planFile, 'utf8'));
  if (problems.length === 0) return;

  const prerequisites = generated.prerequisitesPath ?? prerequisitesPathForPlan(generated.planPath);
  for (const path of [generated.planPath, prerequisites]) {
    if (path !== null) moveRejected(repoRoot, path, output);
  }
  throw new CommandExit(1, [
    `❌ ${generated.planPath}: ${plural(problems.length, 'broken effort-store rule')};`
      + ' rafa loop start would refuse this plan, so no plan stands.',
    ...problems.map((problem) => `   ${storeRuleLine(generated.planPath, problem)}`),
  ].join('\n'));
}
