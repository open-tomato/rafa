/**
 * The two tracker parsers, driven over lines that carry declarations.
 *
 * `utils/declaration.ts` was written on a claim about code it does not
 * own: that `findNextTask` and `updateTrackerLine` need no change to
 * survive a trailing routing block. Its own TSDoc states it, and the
 * colocated suite cannot check it — every fixture there is a bare
 * string, and neither tracker function appears in the module at all.
 * This file is where that claim is measured rather than asserted in
 * prose.
 *
 * Both halves matter to the loop and each fails differently. If
 * `findNextTask` read a braced line as anything other than a task, the
 * plan would stall on its first declared item with the loop reporting
 * no work left. If `updateTrackerLine` rewrote more of the line than
 * the checkbox, the block would be gone from the tracker after the
 * first tick — and since the tracker is copied from the plan ONCE at
 * loop start, nothing would ever put it back, so a resumed run would
 * silently dispatch every remaining task at the loop's defaults.
 *
 * ## The fixture is a table, and both trackers come out of it
 *
 * `TASKS` carries five task specs, each with the sentence the loop
 * should dispatch, the block the plan wrote after it, and whatever the
 * line trails. `trackerFor` builds a tracker from that table twice —
 * once with the blocks and once without — so the two files differ by
 * EXACTLY the blocks and by nothing else, line count and line indices
 * included. That is what makes `the same task at the same line` a
 * comparison rather than a restatement: the plain tracker is the
 * control, run through the same two functions in the same order.
 *
 * Three of the five lines carry a real declaration and two do not, and
 * the two are chosen for what they defend. One is an ordinary
 * undeclared task, which is what the loop meets most often. The other
 * ends on a code span holding a JSON object — braces the tracker must
 * hand through untouched and the parser must refuse — so a fixture
 * where every brace is a declaration cannot be what the equality rests
 * on. The last spec trails two spaces after its block, which is the
 * only fixture that can tell `findNextTask`'s `.trim()` from a parser
 * that keeps what it was given, and the only one that can tell a
 * checkbox rewrite from one that also tidied the line.
 *
 * ## Every case carries its control
 *
 * The claims here are absences — nothing shifted, nothing rewritten —
 * and an absence is satisfied by a parser that finds nothing and a
 * writer that writes nothing. So each case varies one axis in its own
 * body and holds the rest fixed:
 *
 *   - the lockstep walk, against the undeclared tracker built from the
 *     same table, plus a count of which lines actually parsed as
 *     declarations on each side (three and zero) so the equality
 *     cannot be two identical files agreeing with each other;
 *   - the block reaching the caller, against the two undeclared specs
 *     in the same loop, whose text must come through with no block and
 *     no declaration;
 *   - the ticked line, against the pre-tick file RECONSTRUCTED from
 *     the post-tick one by putting the box back, so a rewrite that
 *     retouched a neighbouring line or dropped a trailing space is a
 *     red rather than a byte nobody looked at;
 *   - the resumed blocked task, against the unchecked task the loop
 *     reaches once it is ticked, at its own line;
 *   - the line marked blocked, against the same reconstruction and
 *     then read back the way the next iteration reads it.
 *
 * The reconstruction is deliberately parser-independent: it puts the
 * box back with a `replace` on the line's own text rather than
 * rebuilding it from `taskInfo.task`, so a parser and a writer that
 * dropped the block in the same way cannot agree their way past it.
 *
 * ## The mutation grid
 *
 * Eleven mutations of `utils/tracker.ts` were driven against this
 * file and TEN reddened at least one case. Every leg ran TWICE and
 * named the IDENTICAL red set on both passes, asked for through
 * `--reporter=json` so a red SET is comparable member for member —
 * a red COUNT cannot separate two legs reddening the same number of
 * different cases. The module was restored bytes-identical and all 5
 * cases were green either side.
 *
 * The wide legs first. Writing the tick one line BELOW reddens all
 * five; making the unchecked capture refuse braces (`(.+)` to
 * `([^{}]+)`) and dropping its `.trim()` redden four each — every
 * case but the blocked resumption, which reads the other branch.
 * Refusing braces in the BLOCKED capture, no longer preferring a
 * blocked task, and stripping the block on the way to `- [x]` redden
 * two apiece.
 *
 * The four that ISOLATE are what the fixtures are shaped for, and
 * each names which claim its case is carrying. Trimming the line the
 * tick rewrites reddens the byte-identical case ALONE. Not resolving
 * a `- [BLOCKED]` box to `- [x]` reddens the resumption case alone.
 * Dropping the blocked branch's `.trim()`, and rebuilding a blocked
 * line out of its own text instead of replacing the prefix, redden
 * the blocked-mark case alone — and BOTH of those were green until
 * that case was moved onto the trailing-space spec, which is the
 * whole reason the table carries one. A leg over a rule about
 * whitespace can only be reddened by a fixture that has some.
 *
 * The union of the ten red sets covers all 5 cases, so no fixture
 * here is riding along.
 *
 * The ONE green is named rather than dropped and is not a hole in
 * this file: dropping the `^` anchor from the unchecked match reddens
 * nothing, because every line in every fixture here puts `- [ ] ` at
 * its start. Closing it needs a tracker carrying that spelling in
 * PROSE, which is a claim about a plain tracker rather than a
 * declared one and belongs beside the rest of them in
 * `tests/findNextTask.test.ts`.
 */
import type { TaskInfo } from '../utils/tracker.js';

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  parseTaskDeclaration,
  stripTaskDeclaration,
} from '../utils/declaration.js';
import { findNextTask, updateTrackerLine } from '../utils/tracker.js';

/** The two spaces a tracker line puts between text and block. */
const GAP = '  ';

/** A code span's delimiter, kept out of the template literals. */
const TICK = '`';

/** What the last fixture line trails after its block. */
const TRAIL = '  ';

/** Zero-indexed line the first task sits on in every tracker here. */
const FIRST_TASK_LINE = 5;

/** The routing-table task of this plan, without its block. */
const ROUTING_TASK = [
  'Add the task-shape to agent routing table to `context/workflow.md`,',
  'mapping prose to `doc-updater`, tests to `tdd-guide`, migrations to',
  '`database-reviewer`, repair to `build-error-resolver`, cleanup to',
  '`refactor-cleaner`, review to the read-only reviewers, and',
  'implementation to `loop-implementer`',
].join(' ');

/** One task line, as the table spells it. */
interface TaskSpec {
  /** The sentence the loop should dispatch, block removed. */
  text: string;
  /** The block the plan wrote after it, or null for no block. */
  block: string | null;
  /** Whatever the line carries after that, spaces included. */
  trailing: string;
}

/**
 * The five lines both trackers are built from.
 *
 * Two of the three declared blocks are the declaration-bearing task
 * lines of the plan this work belongs to, copied rather than sketched.
 */
const TASKS: readonly TaskSpec[] = [
  {
    text: 'Capture the three gates into per-run capture files',
    block: null,
    trailing: '',
  },
  {
    text: 'Update the skill cap sentence',
    block: '{agent=doc-updater model=haiku effort=low}',
    trailing: '',
  },
  {
    text: ROUTING_TASK,
    block: '{tools=Read,Write,Edit,Grep,Glob model=haiku effort=low}',
    trailing: '',
  },
  {
    text: `Refuse a settings payload of ${TICK}{"mode": "fast"}${TICK}`,
    block: null,
    trailing: '',
  },
  {
    text: 'Run the collector',
    block: '{effort=low}',
    trailing: TRAIL,
  },
];

/** How many of those five carry a block the grammar answers to. */
const DECLARED_LINES = 3;

/** One task line at the given checkbox mark. */
function lineFor(spec: TaskSpec, mark: string, withBlock: boolean): string {
  const block = !withBlock || spec.block === null
    ? ''
    : `${GAP}${spec.block}`;
  return `- [${mark}] ${spec.text}${block}${spec.trailing}`;
}

/**
 * A tracker in a real plan's shape, with or without the blocks.
 *
 * The already-done line above the open ones is deliberate: it makes
 * `- [x] ` a spelling the parser must SKIP rather than one it has
 * never seen, so a tick landing on the wrong line has somewhere wrong
 * to land.
 */
function trackerFor(
  withBlock: boolean,
  marks: readonly string[] = [],
): string {
  const tasks: string[] = [];
  for (const [index, spec] of TASKS.entries()) {
    tasks.push(lineFor(spec, marks[index] ?? ' ', withBlock));
  }

  return [
    '# Plan: a throwaway plan',
    '',
    '## Stage: One',
    '',
    '- [x] Add the store the collector writes its rows to',
    ...tasks,
    '',
  ].join('\n');
}

const tempRoot = mkdtempSync(join(tmpdir(), 'ralph-tracker-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let planted = 0;

/** Writes a tracker where the loop keeps one, and answers its path. */
function plant(content: string): string {
  planted += 1;
  const dir = join(tempRoot, `plan-${planted}`, '.plans');
  mkdirSync(dir, { recursive: true });
  const trackerPath = join(dir, 'PLAN_TRACKER-throwaway.md');
  writeFileSync(trackerPath, content, 'utf8');
  return trackerPath;
}

/** The whole tracker as it currently sits on disk. */
function read(trackerPath: string): string {
  return readFileSync(trackerPath, 'utf8');
}

/**
 * The task the loop would dispatch next, read the way the loop reads
 * it. Throws rather than answering null, so a fixture that stopped
 * carrying an open task is a red case and not a silently skipped one.
 */
function nextTask(trackerPath: string): TaskInfo {
  const info = findNextTask(read(trackerPath));
  if (!info) throw new Error(`no open task in ${trackerPath}`);
  return info;
}

/** One pass of the loop's own read-dispatch-tick-read sequence. */
interface Step {
  /** What the loop would have dispatched. */
  info: TaskInfo;
  /** The whole file before this line was written. */
  before: string;
  /** The whole file after it. */
  after: string;
}

/** Walks a tracker to its end, ticking each task the loop reaches. */
function walk(trackerPath: string, expected: number): Step[] {
  const steps: Step[] = [];
  for (let index = 0; index < expected; index++) {
    const before = read(trackerPath);
    const info = nextTask(trackerPath);
    updateTrackerLine(trackerPath, info.lineNum, 'done');
    steps.push({ info, before, after: read(trackerPath) });
  }
  return steps;
}

/** True when a step's dispatched text still carries its block. */
function carriesBlock(step: Step): boolean {
  return parseTaskDeclaration(step.info.task).declaration !== null;
}

/** One line of a tracker's text, by its zero-indexed number. */
function lineOf(content: string, lineNum: number): string {
  return content.split('\n')[lineNum] ?? '';
}

describe('a tracker whose task lines carry declarations', () => {
  it('names the same task at the same line as a plain tracker', () => {
    const declared = plant(trackerFor(true));
    const plain = plant(trackerFor(false));

    // The control's own precondition: two files that differ by the
    // blocks and by nothing else. Equal files would satisfy every
    // comparison below without either function being exercised.
    expect(read(declared)).not.toBe(read(plain));

    const declaredSteps = walk(declared, TASKS.length);
    const plainSteps = walk(plain, TASKS.length);

    for (const [index, step] of declaredSteps.entries()) {
      const control = plainSteps[index]!;

      expect(step.info.lineNum).toBe(FIRST_TASK_LINE + index);
      expect(step.info.lineNum).toBe(control.info.lineNum);
      expect(step.info.status).toBe(control.info.status);
      expect(stripTaskDeclaration(step.info.task)).toBe(control.info.task);
    }

    // Which side actually carried blocks, so the agreement above is
    // not two undeclared trackers agreeing with each other.
    expect(declaredSteps.filter(carriesBlock)).toHaveLength(DECLARED_LINES);
    expect(plainSteps.filter(carriesBlock)).toHaveLength(0);

    expect(findNextTask(read(declared))).toBeNull();
    expect(findNextTask(read(plain))).toBeNull();
  });

  it('hands each block through inside the dispatched text', () => {
    const declared = plant(trackerFor(true));
    const steps = walk(declared, TASKS.length);

    for (const [index, step] of steps.entries()) {
      const spec = TASKS[index]!;
      const line = lineOf(step.before, step.info.lineNum);

      // What the parser dropped is exactly what the line trailed.
      expect(line).toBe(`- [ ] ${step.info.task}${spec.trailing}`);

      if (spec.block === null) {
        expect(step.info.task).toBe(spec.text);
        expect(parseTaskDeclaration(step.info.task).declaration).toBeNull();
        continue;
      }

      expect(step.info.task).toBe(`${spec.text}${GAP}${spec.block}`);
      expect(parseTaskDeclaration(step.info.task).declaration?.raw)
        .toBe(spec.block);
      expect(stripTaskDeclaration(step.info.task)).toBe(spec.text);
    }

    expect(steps).toHaveLength(TASKS.length);
  });

  it('leaves a ticked line byte-identical apart from its box', () => {
    const declared = plant(trackerFor(true));
    const steps = walk(declared, TASKS.length);

    for (const [index, step] of steps.entries()) {
      const spec = TASKS[index]!;
      const lines = step.after.split('\n');
      const ticked = lines[step.info.lineNum] ?? '';

      expect(ticked).toBe(`- [x] ${step.info.task}${spec.trailing}`);

      // Put the box back and the whole file must be the pre-tick one,
      // which covers the block, the trailing spaces and every other
      // line at once. Rebuilt from the line's own text rather than
      // from the parsed task, so a parser and a writer that dropped
      // the same bytes cannot agree their way past this.
      lines[step.info.lineNum] = ticked.replace(/^- \[x\]/, '- [ ]');
      expect(lines.join('\n')).toBe(step.before);
      expect(step.after).not.toBe(step.before);
    }
  });

  it('resumes a blocked declared task at the same line', () => {
    const marks = [' ', ' ', 'BLOCKED'];
    const declared = plant(trackerFor(true, marks));
    const plain = plant(trackerFor(false, marks));
    const spec = TASKS[2]!;

    const info = nextTask(declared);
    const control = nextTask(plain);

    expect(info.status).toBe('blocked');
    expect(info.lineNum).toBe(FIRST_TASK_LINE + 2);
    expect(info.lineNum).toBe(control.lineNum);
    expect(info.status).toBe(control.status);
    expect(info.task).toBe(`${spec.text}${GAP}${spec.block}`);
    expect(stripTaskDeclaration(info.task)).toBe(control.task);

    const before = read(declared);
    updateTrackerLine(declared, info.lineNum, 'done');
    const lines = read(declared).split('\n');
    const ticked = lines[info.lineNum] ?? '';

    expect(ticked).toBe(`- [x] ${info.task}${spec.trailing}`);
    lines[info.lineNum] = ticked.replace(/^- \[x\]/, '- [BLOCKED]');
    expect(lines.join('\n')).toBe(before);

    // The control along the one axis: with the blocked line ticked the
    // loop reaches the first UNCHECKED task, above it.
    const next = nextTask(declared);
    expect(next.status).toBe('unchecked');
    expect(next.lineNum).toBe(FIRST_TASK_LINE);
  });

  it('keeps the block when a line is marked blocked', () => {
    // The trailing-space spec on purpose: it is the only fixture that
    // can tell a prefix rewrite from one that rebuilt the line out of
    // its own text, and the only one whose resumed read can tell the
    // blocked branch's `.trim()` from a parser that kept everything.
    const marks = ['x', 'x', 'x', 'x'];
    const declared = plant(trackerFor(true, marks));
    const plain = plant(trackerFor(false, marks));
    const spec = TASKS[4]!;

    const info = nextTask(declared);
    const control = nextTask(plain);

    expect(info.lineNum).toBe(FIRST_TASK_LINE + 4);
    expect(info.lineNum).toBe(control.lineNum);
    expect(info.status).toBe('unchecked');
    expect(stripTaskDeclaration(info.task)).toBe(control.task);

    const before = read(declared);
    updateTrackerLine(declared, info.lineNum, 'blocked');
    const lines = read(declared).split('\n');
    const marked = lines[info.lineNum] ?? '';

    expect(marked).toBe(`- [BLOCKED] ${info.task}${spec.trailing}`);
    lines[info.lineNum] = marked.replace(/^- \[BLOCKED\]/, '- [ ]');
    expect(lines.join('\n')).toBe(before);

    // Read back the way the next iteration reads it: the same line,
    // the same text, the same block, now resumed first.
    const resumed = nextTask(declared);

    expect(resumed.lineNum).toBe(info.lineNum);
    expect(resumed.task).toBe(info.task);
    expect(resumed.status).toBe('blocked');
    expect(parseTaskDeclaration(resumed.task).declaration?.effort)
      .toBe('low');
  });
});
