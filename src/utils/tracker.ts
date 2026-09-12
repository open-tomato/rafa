import fs from 'fs';

import { readRafaBlocks } from '../plan/blocks.js';

export interface TaskInfo {
  task: string;
  lineNum: number; // 0-indexed
  status: 'blocked' | 'unchecked';
}

/**
 * The index, counting from zero, of every line a closed `rafa:*` block
 * spans, its fences included.
 *
 * A block's span counts from one, so the line at index `i` of the
 * tracker's `split('\n')` is span line `i + 1`. The two splits agree on
 * every index: `readRafaBlocks` only drops a carriage return off a
 * line's end and the empty line after a final newline.
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
 * Finds the next task to execute in a tracker file.
 *
 * Blocked tasks are resumed first; otherwise the first unchecked task wins.
 * Only lines starting with `- [ ]` / `- [BLOCKED]` count — headings, stage
 * comments, and prose between items are ignored, so plans may carry stage
 * headings without confusing the loop.
 *
 * ## A line inside a `rafa:*` block is never a task
 *
 * Every place the loop quotes a task back — the prompt header, the
 * operator log, the commit subject and the commit body — quotes the text
 * this function answers, so this is where the declaration strip rule
 * reaches `rafa:*` blocks. A declaration sits ON a task line, and each
 * quoting site takes it off (`utils/declaration.ts`). A block sits AROUND
 * lines, and only a reader holding the whole document can tell that a
 * line is its body. Without this rule a `- [ ] ` at column 0 in a
 * `rafa:context` body was dispatched as a task, and its text reached all
 * four sites, the git history among them. So an open or blocked task
 * line inside a block is that block's body, as `plan/parse.ts` reads it,
 * whatever the block's kind: a `rafa:report`, or a kind a later phase
 * names, included.
 *
 * Blocks are found by `plan/blocks.ts`, which tracks fences the way a
 * renderer shows them. Every other fence stays transparent: a `- [ ] `
 * at column 0 inside a `text` illustration fence is dispatched as it
 * always was, and so is one inside a `rafa:` fence nested in such an
 * illustration, that fence being the illustration's body and no block.
 * A plan illustrating the format indents its example lines.
 *
 * A block NEVER CLOSED is the one exception: the lines after its fence
 * are read as they always were. An unclosed fence runs to the end of the
 * document, which is where a plan's remaining tasks sit, and taking them
 * as its body would answer null. `start.ts` reads null as a finished
 * plan, so the run would wrap up and push with those tasks never run.
 * `parsePlan` reports such a block as `unclosed-block`, and each open
 * task line after its fence as `task-in-block`.
 */
export function findNextTask(trackerContent: string): TaskInfo | null {
  const lines = trackerContent.split('\n');
  const inBlock = closedBlockLines(trackerContent);

  // Prefer resuming a blocked task first
  for (let i = 0; i < lines.length; i++) {
    if (inBlock.has(i)) continue;
    const match = lines[i]!.match(/^- \[BLOCKED\] (.+)/);
    if (match?.[1]) return { task: match[1].trim(), lineNum: i, status: 'blocked' };
  }

  // Otherwise find the next unchecked task
  for (let i = 0; i < lines.length; i++) {
    if (inBlock.has(i)) continue;
    const match = lines[i]!.match(/^- \[ \] (.+)/);
    if (match?.[1]) return { task: match[1].trim(), lineNum: i, status: 'unchecked' };
  }

  return null;
}

/** Rewrites one tracker line to the given status. */
export function updateTrackerLine(
  trackerPath: string,
  lineNum: number,
  newStatus: 'done' | 'blocked',
): void {
  const lines = fs.readFileSync(trackerPath, 'utf8').split('\n');
  const line = lines[lineNum];
  if (!line) return;

  if (newStatus === 'done') {
    lines[lineNum] = line.replace(/^- \[ \]/, '- [x]').replace(/^- \[BLOCKED\]/, '- [x]');
  } else {
    lines[lineNum] = line.replace(/^- \[ \]/, '- [BLOCKED]');
    // Already [BLOCKED]? No change needed.
  }
  fs.writeFileSync(trackerPath, lines.join('\n'), 'utf8');
}

/**
 * Derives the tracker path for a plan file: `PLAN.md` → `PLAN_TRACKER.md`,
 * `PLAN-foo.md` → `PLAN_TRACKER-foo.md`. Keeping one tracker per plan lets
 * several plans coexist without clobbering each other's progress.
 */
export function trackerPathFor(planPath: string): string {
  return planPath.replace(/PLAN(-[^/]*)?\.md$/, (_m, stub: string | undefined) => `PLAN_TRACKER${stub ?? ''}.md`);
}
