/**
 * The blocked tasks of a session's checklist, each with the blocker
 * comment its line trails. This is the library half of
 * `../commands/loop/status.ts`, which keeps the `rafa loop status`
 * command, the session it picks, its ETA and everything it writes.
 *
 * Nothing here reads a command's context, its arguments or its flags,
 * and nothing here imports from `src/commands/`, so any folder may take
 * {@link blockedTasks}: `../status/sections.ts` lists a live session's
 * blocked tasks with it, and `../status/seen.ts` keeps their line
 * numbers.
 *
 * ## The blockers
 *
 * Every `- [BLOCKED]` line of the checklist is answered with the blocker
 * comment it trails, which is what the run wrote when the task ended
 * blocked: the budget note, the nothing-reported note, or the triage
 * assessment (`../utils/tracker.ts`, `writeTrackerBlocker`). The comment
 * is read off the LINE, through `splitBlockerComment`, because the plan
 * model takes it off a task's text and so does not hold it. A line the
 * run blocked before comments were written, or one whose comment is
 * blank, reads as none.
 *
 * ## What is read
 *
 * The checklist handed over (`readSessionChecklist`,
 * `./session-readings.ts`) and nothing else: no file, no record and no
 * store. A session with no checklist, its plan and tracker both gone,
 * has no blocked task.
 */
import type { SessionChecklist } from './session-readings.js';

import { splitBlockerComment } from '../utils/tracker.js';

/** A blocked task line, as `utils/tracker.ts` writes one. The capture is its text, the comment included. */
const BLOCKED_TASK_LINE = /^- \[BLOCKED\] (.+)/;

/** One blocked task of the checklist, with what its line trails. See the module note. */
export interface BlockedTask {
  /** Its line in the checklist, counting from one, as a record's task line does. */
  readonly line: number;
  /** The task's sentence, its declaration and its blocker comment off. */
  readonly text: string;
  /** The comment's text, unescaped, or null when the line trails none or a blank one. */
  readonly blocker: string | null;
}

/** The comment the checklist line at `lineNum` trails, or null when it is no blocked line or trails none. */
function blockerAt(checklist: SessionChecklist, lineNum: number): string | null {
  const capture = BLOCKED_TASK_LINE.exec(checklist.lines[lineNum] ?? '')?.[1];
  return capture === undefined
    ? null
    : splitBlockerComment(capture.trim()).blocker;
}

/** Every blocked task of `checklist`, in file order, with the blocker its line trails. */
export function blockedTasks(checklist: SessionChecklist | null): readonly BlockedTask[] {
  if (checklist === null) return [];
  return checklist.tasks
    .filter((task) => task.status === 'blocked')
    .map((task) => ({
      line: task.lineNum + 1,
      text: task.text,
      blocker: blockerAt(checklist, task.lineNum),
    }));
}
