/**
 * What becomes of a task whose session returned 0: its work committed,
 * then its tracker line marked.
 *
 * `start()` hands each such task to {@link commitFinishedTask} and stops
 * the run on an attempt git refused. The commit goes through
 * `utils/commit.ts` unless the `commit` seam names another runner.
 */
import type { CommitAttempt, CommitOptions } from '../utils/commit.js';
import type { TaskInfo } from '../utils/tracker.js';

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
}

/** Indents every line, so a multi-line git message reads as one block. */
function indentBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => `   ${line}`)
    .join('\n');
}

/**
 * Stages and commits one finished task, then marks its tracker line.
 *
 * The commit runs BEFORE the mark because the mark depends on it:
 * `updateTrackerLine` turns `- [ ]` into `- [x]` and has no way back, so a
 * tick written first could not be retracted by a commit that then failed.
 *
 * `nothing-to-commit` ticks the box exactly as `committed` does. A task
 * whose whole output is a `.plans/` edit, a `progress.txt` append or a
 * `/tmp` capture changes no tracked file and has still done what it was
 * asked; blocking it would stall a plan on its most ordinary shape. See
 * `utils/commit.ts` for the rest of that reasoning.
 *
 * The declaration comes off the text first. A commit subject is derived
 * from the task sentence, so a block left on it would reach the git
 * history — where nothing here can ever go back and take it out. A
 * `rafa:*` block needs no strip here: `findNextTask` never answers a
 * task line inside a closed one, so none reaches `taskInfo`.
 *
 * A failure blocks the task, and the caller stops the loop rather than
 * moving on. It has to: `findNextTask` resumes a blocked task FIRST, so
 * carrying on would re-dispatch this same task immediately and forever,
 * and a rejected hook or a broken index is not something the next task
 * can fix. The work is left STAGED — git does not unstage what a
 * pre-commit hook refused — so the next run sees the tree as the session
 * left it.
 */
export function commitFinishedTask(options: FinishedTaskOptions): CommitAttempt {
  const { taskInfo, trackerPath } = options;
  const commit = options.commit ?? commitTaskWork;
  const taskText = stripTaskDeclaration(taskInfo.task);

  const attempt = commit({ taskText, cwd: options.repoRoot });

  if (attempt.outcome === 'failed') {
    updateTrackerLine(trackerPath, taskInfo.lineNum, 'blocked');
    console.error(`\n❌ Commit refused at the ${attempt.failedStep} step (exit ${attempt.exitCode}).`);
    if (attempt.message.length > 0) console.error(indentBlock(attempt.message));
    console.error('   The work is staged and still in the tree. Task marked as blocked.');
    console.error('   Fix the cause and run again to retry this task.');
    return attempt;
  }

  updateTrackerLine(trackerPath, taskInfo.lineNum, 'done');
  console.log(`✅ Task done: ${taskText}`);
  if (attempt.outcome === 'committed') {
    const sha = attempt.sha?.slice(0, 7) ?? 'unknown sha';
    console.log(`   Committed ${sha} ${attempt.subject}`);
  } else {
    console.log('   Nothing to commit: the task changed no tracked file.');
  }

  return attempt;
}
