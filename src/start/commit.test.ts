/**
 * Tests for how the loop settles a task whose session returned 0: what
 * its report holds the task back on, and the mark and the outcome that
 * follow.
 *
 * {@link readReportHolds} is pure over an output, so its cases hand it
 * whole session outputs, prose and then a `rafa:report` block.
 * {@link finishCleanExit} is driven over a real tracker file under a
 * temporary directory with only the commit runner stubbed: whether git was
 * asked the right thing is `tests/finished-task.test.ts`'s claim, and the
 * readings here are the tracker line, the outcome and the operator's lines.
 * Each stub records the tracker line as it stood when it was called, so a
 * mark written before the commit is a red rather than a line nobody read.
 *
 * Every hold is paired with its control through the same helper: a report
 * saying `done` beside `blockers: []`, which holds nothing and ticks.
 *
 * Eight mutations of `commit.ts` were driven against this file,
 * `tests/finished-task.test.ts` and `tests/task-report.test.ts`, each an
 * exact string found once and restored sha256-identical, the files green
 * before and after, and every one reddened at least one case here: holds
 * never marking the line (4 red), `status: blocked` holding nothing (4),
 * kept blockers uncounted (6), dropped ones uncounted (1), the dropped-entry
 * pattern left unanchored, so a kept entry's `blockers[1].what` counts a
 * second time (1), the outcome ignoring holds (3), the mark written before
 * the commit (2), and a held task handed no commit (3). None reddened
 * `finished-task.test.ts`. Four cases here were reached by no leg, each an
 * absence no leg aimed at: the clean report, a `blockers` value that is no
 * list beside a status spelled `Blocked`, a refused commit, and an output
 * with no report.
 */
import type { CommitAttempt } from '../utils/commit.js';

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';

import { findNextTask } from '../utils/tracker.js';

import { finishCleanExit, readReportHolds } from './commit.js';

/** A fence, kept out of the template literals. */
const FENCE = '```';

/** A session output ending with a report holding `lines`. */
function outputWith(...lines: string[]): string {
  return ['Work finished.', '', `${FENCE}rafa:report`, ...lines, FENCE, ''].join('\n');
}

/** A report that holds nothing: `done`, every list empty. */
const CLEAN = outputWith(
  'status: done',
  'feedback: "all of it"',
  'findings: []',
  'skills_used: []',
  'blockers: []',
  'out_of_scope_bugs: []',
);

/** A report claiming `blocked` with no blocker listed. */
const STATUS_BLOCKED = outputWith('status: blocked', 'feedback: "half of it"', 'blockers: []');

/** A report claiming `done` beside one blocker. */
const DONE_WITH_BLOCKER = outputWith(
  'status: done',
  'blockers:',
  '  - what: "LINEAR_API_KEY unset"',
  '    artifact: "401 Unauthorized"',
);

/** The open task every planted tracker dispatches first. */
const FIRST_TASK = 'Wire the report into the loop';

/** The task after it. */
const SECOND_TASK = 'Show the status in the effort report';

/** A tracker with a done task above two open ones. */
const TRACKER = [
  '# Plan: a throwaway plan',
  '',
  '- [x] Add the table',
  `- [ ] ${FIRST_TASK}`,
  `- [ ] ${SECOND_TASK}`,
  '',
].join('\n');

/** What a stubbed runner answers for a commit git made. */
const COMMITTED: CommitAttempt = {
  outcome: 'committed',
  subject: 'feat: wire the report into the loop',
  sha: 'abc1234def5678',
  failedStep: null,
  exitCode: 0,
  message: '',
};

/** What a stubbed runner answers for a commit a hook refused. */
const REFUSED: CommitAttempt = {
  outcome: 'failed',
  subject: 'feat: wire the report into the loop',
  sha: null,
  failedStep: 'commit',
  exitCode: 1,
  message: 'gate says no',
};

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-clean-exit-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Lines reported on stdout. */
let logs: string[] = [];

/** Lines reported on stderr. */
let errors: string[] = [];

beforeEach(() => {
  logs = [];
  errors = [];
  spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  mock.restore();
});

/** One tracker line, by its zero-indexed number. */
function lineAt(trackerPath: string, lineNum: number): string {
  return readFileSync(trackerPath, 'utf8').split('\n')[lineNum] ?? '';
}

/** What one settle did, and what the tracker said when git was asked. */
interface Settled {
  readonly finished: ReturnType<typeof finishCleanExit>;
  /** The task line when the runner was called, once per call. */
  readonly linesAtCommit: readonly string[];
  /** The task text the runner was handed, once per call. */
  readonly committedTexts: readonly string[];
  /** The task line afterwards. */
  readonly line: string;
  /** The tracker, for reading the next task off it. */
  readonly trackerPath: string;
}

/** Settles the first task of a fresh tracker over `output`. */
function settle(output: string, answer: CommitAttempt): Settled {
  planted += 1;
  const trackerPath = join(tempRoot, `PLAN_TRACKER-${planted}.md`);
  writeFileSync(trackerPath, TRACKER, 'utf8');
  const taskInfo = findNextTask(TRACKER);
  if (taskInfo === null) throw new Error('the fixture tracker holds no open task');

  const linesAtCommit: string[] = [];
  const committedTexts: string[] = [];
  const finished = finishCleanExit({
    trackerPath,
    taskInfo,
    repoRoot: tempRoot,
    output,
    commit: (options) => {
      linesAtCommit.push(lineAt(trackerPath, taskInfo.lineNum));
      committedTexts.push(options.taskText);
      return answer;
    },
  });
  return {
    finished,
    linesAtCommit,
    committedTexts,
    line: lineAt(trackerPath, taskInfo.lineNum),
    trackerPath,
  };
}

describe('readReportHolds', () => {
  it('holds nothing for a done report whose blockers list is empty', () => {
    expect(readReportHolds(CLEAN)).toEqual([]);
  });

  it('holds a report that says status blocked', () => {
    expect(readReportHolds(STATUS_BLOCKED)).toEqual(['status: blocked']);
  });

  it('holds a done report that lists a blocker, naming the blocker', () => {
    expect(readReportHolds(DONE_WITH_BLOCKER)).toEqual(['blocker: LINEAR_API_KEY unset']);
  });

  it('names the status first, then each blocker in order', () => {
    const output = outputWith(
      'status: blocked',
      'blockers:',
      '  - what: "the first"',
      '  - what: "the second"',
    );

    expect(readReportHolds(output))
      .toEqual(['status: blocked', 'blocker: the first', 'blocker: the second']);
  });

  it('counts a blocker entry the parser dropped and one it kept with no what', () => {
    const output = outputWith(
      'status: done',
      'blockers:',
      '  - "a bare string where a mapping belongs"',
      '  - artifact: "only an artifact"',
    );

    // The kept entry reports `blockers[1].what` missing, which must not
    // count a second time as a dropped entry.
    expect(readReportHolds(output)).toEqual([
      'blocker: an entry with no usable what',
      'blocker: blockers[0], an entry the report parser dropped',
    ]);
  });

  it('holds nothing for a blockers value that is no list, or a status spelled otherwise', () => {
    expect(readReportHolds(outputWith('status: done', 'blockers: "none"'))).toEqual([]);
    expect(readReportHolds(outputWith('status: Blocked', 'blockers: []'))).toEqual([]);
  });

  it('holds nothing for an output whose last block cannot be read', () => {
    const broken = outputWith('status: blocked', 'feedback: it broke: twice');

    expect(readReportHolds('No block at all.')).toEqual([]);
    expect(readReportHolds(broken)).toEqual([]);

    // The control: the same status in a block that parses holds.
    expect(readReportHolds(outputWith('status: blocked', 'feedback: "it broke twice"')))
      .toEqual(['status: blocked']);
  });
});

describe('finishCleanExit', () => {
  it.each([
    ['says status blocked', STATUS_BLOCKED],
    ['says done beside a blocker', DONE_WITH_BLOCKER],
  ])('commits a task whose report %s, then marks it blocked and answers blocked', (_label, output) => {
    const held = settle(output, COMMITTED);

    expect(held.committedTexts).toEqual([FIRST_TASK]);
    expect(held.linesAtCommit).toEqual([`- [ ] ${FIRST_TASK}`]);
    expect(held.line).toBe(`- [BLOCKED] ${FIRST_TASK}`);
    expect(held.finished.outcome).toBe('blocked');
    expect(held.finished.holds).toEqual(readReportHolds(output));
    expect(held.finished.holds.length).toBeGreaterThan(0);
    expect(held.finished.attempt).toBe(COMMITTED);

    // The next run resumes this task first, which is why the loop stops.
    const resumed = findNextTask(readFileSync(held.trackerPath, 'utf8'));
    expect(resumed).toMatchObject({ task: FIRST_TASK, status: 'blocked' });

    // The control: the same helper over a report that holds nothing.
    const clean = settle(CLEAN, COMMITTED);

    expect(clean.committedTexts).toEqual([FIRST_TASK]);
    expect(clean.line).toBe(`- [x] ${FIRST_TASK}`);
    expect(clean.finished).toMatchObject({ outcome: 'done', holds: [] });
    expect(findNextTask(readFileSync(clean.trackerPath, 'utf8')))
      .toMatchObject({ task: SECOND_TASK, status: 'unchecked' });
  });

  it('marks a held task blocked when git had nothing to commit', () => {
    const nothing: CommitAttempt = { ...COMMITTED, outcome: 'nothing-to-commit', sha: null };

    const held = settle(DONE_WITH_BLOCKER, nothing);
    const clean = settle(CLEAN, nothing);

    expect(held.line).toBe(`- [BLOCKED] ${FIRST_TASK}`);
    expect(held.finished.outcome).toBe('blocked');
    expect(clean.line).toBe(`- [x] ${FIRST_TASK}`);
    expect(clean.finished.outcome).toBe('done');
  });

  it('answers blocked for a refused commit whatever the report says', () => {
    const refused = settle(CLEAN, REFUSED);

    expect(refused.line).toBe(`- [BLOCKED] ${FIRST_TASK}`);
    expect(refused.finished).toMatchObject({ outcome: 'blocked', holds: [], attempt: REFUSED });
    expect(errors.join('\n')).toContain('Commit refused at the commit step');
  });

  it('ticks a task whose output holds no report, answering done', () => {
    const silent = settle('Done, and nothing to report.', COMMITTED);

    expect(silent.line).toBe(`- [x] ${FIRST_TASK}`);
    expect(silent.finished).toMatchObject({ outcome: 'done', holds: [] });
  });

  it('tells the operator what held the task, and that its work was committed', () => {
    settle(DONE_WITH_BLOCKER, COMMITTED);

    const spoken = errors.join('\n');
    expect(spoken).toContain(`Task blocked by its own report: ${FIRST_TASK}`);
    expect(spoken).toContain('   blocker: LINEAR_API_KEY unset');
    expect(spoken).toContain('Task marked as blocked.');
    expect(logs.join('\n')).toContain('Committed abc1234 feat: wire the report into the loop');
    expect(logs.join('\n')).not.toContain('Task done');

    // The control: a report that holds nothing prints the done line and
    // no error at all.
    logs = [];
    errors = [];
    settle(CLEAN, COMMITTED);

    expect(logs.join('\n')).toContain(`Task done: ${FIRST_TASK}`);
    expect(logs.join('\n')).toContain('Committed abc1234');
    expect(errors).toEqual([]);
  });
});
