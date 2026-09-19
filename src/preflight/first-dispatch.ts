/**
 * Whether a plan's run is its FIRST DISPATCH: the reading the `[start]`
 * tier is probed on (`preflight/prerequisites-md.ts`).
 *
 * A `[start]` item names the state a run begins from — the sibling
 * checkout holding no uncommitted change, say — which is true before the
 * first session and false once the run itself has changed it. So such an
 * item is probed on a first dispatch and skipped on a resume, and this
 * module is where that one bit is read.
 *
 * ## What the reading is off
 *
 * The TRACKER beside the plan, `PLAN_TRACKER-<stub>.md` as
 * {@link trackerPathFor} names it, never the plan: the plan keeps its
 * boxes open and the loop ticks the tracker's
 * (`updateTrackerLine` (`utils/tracker.ts`)). `start/preflight.ts` already reads the
 * tracker when one exists, for its agent roster check, and this reads
 * the same document.
 *
 * A run is a RESUME when that tracker exists AND already holds a ticked
 * task; it is a first dispatch otherwise. Both halves matter:
 *
 *   - **No tracker** is the first run of the plan. The tracker is copied
 *     from the plan after the preflight, so on a first `loop start` the
 *     path does not exist yet.
 *   - **A tracker with no tick** is a run whose every earlier attempt
 *     dispatched nothing that finished: a plan whose first task halted
 *     in the preflight, or was blocked, leaves a tracker whose boxes are
 *     all `- [ ]` or `- [BLOCKED]`. Nothing has moved the repository, so
 *     the state a `[start]` item names still holds and is still worth
 *     halting on.
 *
 * A tick therefore means at least one task of this plan has run to a
 * commit, which is exactly when a `[start]` probe stops being a reading
 * of the operator's machine and becomes a reading of the loop's own work.
 *
 * ## Which lines count as ticked
 *
 * A ticked line is `- [x] ` at column 0 with text after it, the shape
 * `updateTrackerLine` (`utils/tracker.ts`) writes, and `- [X] ` as well, since an
 * operator ticking a task by hand may use either. A line with an empty
 * box, a `- [BLOCKED]` line, an indented line and a line with nothing
 * after its box are no tick.
 *
 * A ticked line INSIDE a closed `rafa:*` block is block body and no
 * tick, as it is for `findNextTask` (`utils/tracker.ts`): a
 * `rafa:report` a session wrote may quote a checklist, and a quoted tick
 * is not a task this run finished. An UNCLOSED block is transparent, as
 * it is there too — its fence runs to the end of the document, which is
 * where the checklist sits, so reading its body as block would hide
 * every tick the run made.
 *
 * A tracker that cannot be read — absent, a directory, unreadable —
 * reads as a first dispatch. That is the tier that halts a run, so the
 * unreadable case fails towards checking more rather than less.
 */
import { readFileSync } from 'node:fs';

import { readRafaBlocks } from '../plan/blocks.js';
import { trackerPathFor } from '../utils/tracker.js';

/** A ticked task line, as the loop and an operator write one. */
const TICKED_TASK = /^- \[[xX]\] (.+)/;

/** The text at `path`, or null when nothing readable sits there. */
function readIfReadable(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * The index, counting from zero, of every line a closed `rafa:*` block
 * spans, its fences included; a block's span counts from one.
 */
function closedBlockLines(trackerContent: string): ReadonlySet<number> {
  const inside = new Set<number>();
  for (const block of readRafaBlocks(trackerContent)) {
    if (!block.closed) continue;
    for (let line = block.span.first; line <= block.span.last; line += 1) {
      inside.add(line - 1);
    }
  }
  return inside;
}

/**
 * Whether a tracker's text holds a ticked task; see the module note for
 * which lines count.
 */
export function hasTickedTask(trackerContent: string): boolean {
  const inBlock = closedBlockLines(trackerContent);
  return trackerContent
    .split('\n')
    .some((line, index) => !inBlock.has(index) && TICKED_TASK.test(line));
}

/**
 * Whether the run of the plan at `planPath` is a first dispatch: false
 * when the tracker beside it exists and already holds a ticked task,
 * true otherwise. See the module note.
 */
export function isFirstDispatch(planPath: string): boolean {
  const tracker = readIfReadable(trackerPathFor(planPath));
  return tracker === null || !hasTickedTask(tracker);
}
