/**
 * The task prompt's tracker line: the words that hand a session the
 * tracker holding its task's line, by absolute path, and where its
 * close-out notes go in it. `buildTaskPrompt` (`dispatch.ts`) places the
 * line directly after the scoped-task lines, ahead of the blocker line.
 *
 * ## Why the line exists
 *
 * The tracker is `trackerPathFor` over the plan path (`src/start.ts`),
 * which sits in the main checkout's `.rafa/plans/`, a gitignored
 * directory. A session runs in its dispatch's checkout, which may be a
 * linked worktree under `.rafa/worktrees/`, and a worktree holds no copy
 * of a gitignored file: a session told only "the tracker" looks for it
 * in its own working tree and does not find it. So the line names the
 * path in full, and a relative path, which the session would resolve
 * against the wrong directory, is refused as a programming error.
 *
 * ## Why it says where the notes go
 *
 * The loop reads the tracker after the session. `findNextTask`
 * dispatches any unchecked `- [ ]` line, so a note written as one would
 * run as a task; and `updateTrackerLine` marks the task by its line
 * number, so a line written above it would move the task's line and the
 * mark would land on another. A note indented below the task's line is
 * neither.
 */
import { isAbsolute } from 'node:path';

/**
 * What opens the prompt line naming the tracker. The loop's words open
 * it, as they open the blocker and base lines.
 */
export const TRACKER_PROMPT_PREFIX = 'The tracker holding this task\'s line is ';

/**
 * The prompt line naming `trackerPath` and where the session's
 * close-out notes go in it, or none for no path. Throws on a relative
 * path: the session runs in a checkout that may not be the directory
 * the path is relative to, and the loop only ever hands it the absolute
 * path `trackerPathFor` answered.
 */
export function trackerLines(trackerPath: string | null): string[] {
  if (trackerPath === null) return [];
  if (!isAbsolute(trackerPath)) {
    throw new Error(`The tracker path \`${trackerPath}\` is not absolute; the session may run in a worktree it does not resolve against.`);
  }
  return [
    `${TRACKER_PROMPT_PREFIX}\`${trackerPath}\`, by its absolute path, since a worktree checkout holds no copy of it: write any close-out notes there, indented below this task's line, never as a \`- [ ]\` line (the loop dispatches any such line) and never above this task's line (the loop marks it by its line number).`,
  ];
}
