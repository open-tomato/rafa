/**
 * What becomes of a task whose session returned 0: its work committed,
 * then its tracker line marked by what git answered and by what the
 * session's own report said.
 *
 * `start()` hands each such task to {@link finishCleanExit}, which reads
 * what the report holds the task back on ({@link readReportHolds}),
 * commits and marks through {@link commitFinishedTask}, and answers the
 * outcome the loop stores the report under. `start()` stops the run on
 * every outcome but `done`. The commit goes through `utils/commit.ts`
 * unless the `commit` seam names another runner.
 *
 * What the operator is told goes through the active output
 * (`adapters/output/active.ts`): the done, commit and nothing-to-commit
 * lines through `info`, and a refused commit and what held a task
 * through `error`.
 */
import type { FindingOutcome } from '../effort/store/findings.js';
import type { CommitAttempt, CommitOptions } from '../utils/commit.js';
import type { TaskInfo } from '../utils/tracker.js';

import { activeOutput } from '../adapters/output/active.js';
import { parseReport } from '../report/parse.js';
import { commitTaskWork } from '../utils/commit.js';
import { stripTaskDeclaration } from '../utils/declaration.js';
import { updateTrackerLine } from '../utils/tracker.js';

/** How one git invocation is made on a finished task's behalf. */
export type TaskCommitRunner = (options: CommitOptions) => CommitAttempt;

/** What {@link commitFinishedTask} needs to commit and record one task. */
export interface FinishedTaskOptions {
  /** Tracker whose line is marked once git has answered. */
  trackerPath: string;
  /** The task whose session just returned 0. */
  taskInfo: TaskInfo;
  /** Directory git stages and commits in — the repo root. */
  repoRoot: string;
  /** Commit seam. Defaults to the real helper. */
  commit?: TaskCommitRunner;
  /**
   * What the task's own report holds it back on, as
   * {@link readReportHolds} answers it. A task with any is committed and
   * then marked `[BLOCKED]` rather than ticked. Defaults to none.
   */
  holds?: readonly string[];
}

/** What {@link finishCleanExit} needs: the task, and its session's output. */
export interface CleanExitOptions extends Omit<FinishedTaskOptions, 'holds'> {
  /** Everything the session wrote to stdout, its report included. */
  output: string;
}

/** What the loop made of a task whose session returned 0. */
export type CleanExitOutcome = Exclude<FindingOutcome, 'failed'>;

/** What {@link finishCleanExit} did with one task. */
export interface FinishedTask {
  /** What git answered. */
  attempt: CommitAttempt;
  /** What the report held the task back on. Empty when nothing did. */
  holds: readonly string[];
  /** `done` for a ticked task, `blocked` for one marked `[BLOCKED]`. */
  outcome: CleanExitOutcome;
}

/**
 * The field path the report parser gives a `blockers` entry it dropped,
 * as against `blockers[0].what` for a field of an entry it kept.
 */
const DROPPED_BLOCKER_FIELD = /^blockers\[\d+\]$/;

/** Indents every line, so a multi-line git message reads as one block. */
function indentBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => `   ${line}`)
    .join('\n');
}

/**
 * What one session's output holds its task back on, one line each, or
 * none when nothing does.
 *
 * The last `rafa:report` block holds its task when it says `status:
 * blocked`, and when it lists a blocker whatever its status says. The
 * prompt pairs `done` with `blockers: []`, so a `done` beside a blocker
 * is a session that named something left undone and claimed the task
 * anyway, and the blocker is the more specific of the two.
 *
 * A blocker counts as listed when the session wrote an entry under
 * `blockers`, kept or not. The parser drops an entry that is not a
 * mapping, a bare string among them, and keeps one with no usable
 * `what`; either still says something stopped the task, and ticking the
 * task past it would pass while wrong, where holding it costs one re-run.
 * A `blockers` value that is not a list names no entry and holds nothing.
 *
 * An output with no report the parser can read holds nothing: the exit
 * code and the commit decide that task, as they did before reports were
 * read, and `report/record.ts` stores the absence. Nor does a status the
 * parser could not read, `Blocked` included: only the closed word does.
 *
 * Lines come in the order status, kept blockers, dropped blockers.
 */
export function readReportHolds(output: string): readonly string[] {
  const reading = parseReport(output);
  if (!reading.present) return [];

  const { report, issues } = reading;
  const holds: string[] = [];
  if (report.status === 'blocked') holds.push('status: blocked');
  for (const blocker of report.blockers) {
    holds.push(`blocker: ${blocker.what ?? 'an entry with no usable what'}`);
  }
  for (const issue of issues) {
    if (!DROPPED_BLOCKER_FIELD.test(issue.field)) continue;
    holds.push(`blocker: ${issue.field}, an entry the report parser dropped`);
  }
  return holds;
}

/**
 * Stages and commits one finished task, then marks its tracker line:
 * ticked, or `[BLOCKED]` when git refused or the report held the task.
 *
 * The commit runs BEFORE the mark because the mark depends on it:
 * `updateTrackerLine` turns `- [ ]` into `- [x]` and has no way back, so a
 * tick written first could not be retracted by a commit that then failed.
 *
 * `nothing-to-commit` marks the line exactly as `committed` does. A task
 * whose whole output is a `.plans/` edit, a `progress.txt` append or a
 * `/tmp` capture changes no tracked file and has still done what it was
 * asked; blocking it would stall a plan on its most ordinary shape. See
 * `utils/commit.ts` for the rest of that reasoning.
 *
 * A task its report holds is committed all the same, and then marked
 * `[BLOCKED]`. The partial work is kept in the history rather than left
 * in the tree, where the next task's commit would take it under that
 * task's subject; the re-run of this task starts from it.
 *
 * The declaration comes off the text first. A commit subject is derived
 * from the task sentence, so a block left on it would reach the git
 * history — where nothing here can ever go back and take it out. A
 * `rafa:*` block needs no strip here: `findNextTask` never answers a
 * task line inside a closed one, so none reaches `taskInfo`. Nor does a
 * blocker comment: `findNextTask` takes it off the task text, and the
 * tick takes it off the line.
 *
 * A blocked task stops the loop rather than moving on, however it came
 * to be blocked. It has to: `findNextTask` resumes a blocked task FIRST,
 * so carrying on would re-dispatch this same task immediately and
 * forever, and neither a rejected hook, a broken index nor a blocker the
 * session named is something the next task can fix. A refused commit
 * leaves the work STAGED — git does not unstage what a pre-commit hook
 * refused — so the next run sees the tree as the session left it.
 */
export function commitFinishedTask(options: FinishedTaskOptions): CommitAttempt {
  const { taskInfo, trackerPath } = options;
  const commit = options.commit ?? commitTaskWork;
  const holds = options.holds ?? [];
  const taskText = stripTaskDeclaration(taskInfo.task);

  const attempt = commit({ taskText, cwd: options.repoRoot });
  const out = activeOutput();

  if (attempt.outcome === 'failed') {
    updateTrackerLine(trackerPath, taskInfo.lineNum, 'blocked');
    out.error(`\n❌ Commit refused at the ${attempt.failedStep} step (exit ${attempt.exitCode}).`);
    if (attempt.message.length > 0) out.error(indentBlock(attempt.message));
    out.error('   The work is staged and still in the tree. Task marked as blocked.');
    out.error('   Fix the cause and run again to retry this task.');
    return attempt;
  }

  const held = holds.length > 0;
  updateTrackerLine(trackerPath, taskInfo.lineNum, held
    ? 'blocked'
    : 'done');
  if (held) {
    out.error(`\n⛔ Task blocked by its own report: ${taskText}`);
    for (const hold of holds) out.error(indentBlock(hold));
  } else {
    out.info(`✅ Task done: ${taskText}`);
  }
  if (attempt.outcome === 'committed') {
    const sha = attempt.sha?.slice(0, 7) ?? 'unknown sha';
    out.info(`   Committed ${sha} ${attempt.subject}`);
  } else {
    out.info('   Nothing to commit: the task changed no tracked file.');
  }
  if (held) {
    out.error('   Task marked as blocked. Resolve what its report names, then run again to resume it.');
  }

  return attempt;
}

/**
 * Settles a task whose session returned 0: reads what its report holds
 * it back on, commits and marks it, and answers the outcome its report
 * is stored under.
 *
 * `blocked` when git refused the commit or the report held the task,
 * `done` otherwise. The exit code alone decides `failed`, so a clean
 * exit never answers it, whatever the report says.
 */
export function finishCleanExit(options: CleanExitOptions): FinishedTask {
  const { output, ...task } = options;
  const holds = readReportHolds(output);
  const attempt = commitFinishedTask({ ...task, holds });
  const blocked = attempt.outcome === 'failed' || holds.length > 0;
  return {
    attempt,
    holds,
    outcome: blocked
      ? 'blocked'
      : 'done',
  };
}
