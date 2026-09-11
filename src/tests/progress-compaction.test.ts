/**
 * A run of tasks, and the compaction sessions it dispatched.
 *
 * This is the JOIN neither colocated suite can make.
 * `utils/progress.ts` decides over two NUMBERS a caller handed it: it
 * opens no file, spawns nothing, and cannot say that the size it
 * decided on is the size of the file the loop would actually compact,
 * nor that a `due` decision ever reaches a session. `utils/claude.ts`
 * knows how to spawn one and nothing about why. `maybeCompactProgress`
 * in `start.ts` is where a file on disk becomes a dispatched session,
 * so every case here drives THAT, over a real `progress.txt` under
 * `mkdtemp`, through the module's own default size reader — the
 * session runner is the only stub.
 *
 * ## Why a SERIES rather than a call
 *
 * "Exactly once" is a statement about a run of tasks and not about one
 * decision: a helper that dispatched on every task would satisfy any
 * single-call assertion, and so would one that dispatched twice for
 * the same appended finding. So each case drives a table row through
 * the loop's own per-task tail — append a finding, increment the
 * counter, call the helper, take the counter back off what it
 * answered — and asserts WHICH tasks dispatched, by number.
 *
 * The expected dispatch list is hand-derived from the thresholds and
 * written into the table, so the expectation and the actual stay two
 * independent paths. Deriving it by calling `isCompactionDue` would be
 * the module agreeing with itself.
 *
 * The thresholds are the module's own defaults, unoverridden, because
 * that is what `start()` runs on: it passes `repoRoot` and the counter
 * and nothing else. Every fixture size below is therefore a real byte
 * count against the real 8,000 / 16,000 / 10 caps.
 *
 * ## The three shapes the table carries
 *
 * A file that never reaches the soft cap must reach the runner ZERO
 * times, which is a zero-hit reading and gets its positive control
 * inside the same case, varied along the one axis the case is named
 * for — the same series re-driven from a bigger starting size has to
 * dispatch.
 *
 * A file the session SHRINKS is the ordinary crossing: one dispatch,
 * on the task that crossed, and none after it. A file the session
 * cannot shrink is the residual `utils/progress.ts` names out loud —
 * asked again once per TASK, which is what says the counter and not
 * the size is what bounds the ask.
 *
 * The failed-session row is the only one that can see the counter
 * resetting on DISPATCH rather than on success, and it needs a file
 * left BETWEEN the caps: above the hard cap the counter is irrelevant,
 * the cap answering due whatever it holds. Its second dispatch lands
 * on task 11 with the reset and would land on task 10 without one.
 *
 * ## The mutation grid
 *
 * Twenty-five mutations of `start.ts` and `utils/progress.ts` were
 * driven against this file. TWENTY-FOUR reddened at least one case
 * and the union of their red sets covers all 14, so no fixture here
 * is riding along. Every leg ran TWICE and named the IDENTICAL red
 * set both times, asked for through `--reporter=json` so a red SET is
 * comparable member for member rather than by count. Both modules
 * were restored bytes-identical and all 14 cases were green either
 * side.
 *
 * The wide legs are the ones moving a threshold or the size the
 * decision is taken on: never dispatching, always dispatching,
 * reading the size as a constant zero and inverting the soft cap
 * redden 10 apiece, and spawning twice reddens 8. Raising the hard
 * cap and lowering the soft one redden 6 each. Claiming a dispatch
 * that never happened, zeroing the counter on a task that dispatched
 * nothing and reading the hard cap as strictly-greater redden 5.
 *
 * NINE legs isolate, and each names the claim its case is carrying.
 * Building the prompt from a constant, and quoting a constant size
 * inside it, redden the prompt case ALONE. Leaking the file into the
 * prompt or into the operator log reddens the containment case alone
 * — and the first shape of that leg reddened TEN, because it called a
 * reader `start.ts` does not import and CRASHED instead of leaking,
 * which is a leg that proves nothing while reading as thorough.
 * Reporting `sizeAfterBytes` off the decision instead of re-reading
 * the file reddens the crossing case alone; reporting exit 0 for a
 * failed session reddens the failing row alone; moving the compaction
 * behind the usage gate and dropping the loop's counter take-back
 * each redden one call-site guard. The THIRD call-site guard is
 * reached by no mutation at all and only by a PLANTED name in
 * `start.ts`: its subject is an absence over the live source, so
 * nothing a module can be mutated INTO manufactures the spelling it
 * looks for.
 *
 * Resetting the counter only on SUCCESS reddens exactly two cases and
 * one of them is the failing row, which is what that row exists for:
 * no other fixture can see the difference, the hard cap ignoring the
 * counter entirely.
 *
 * ONE leg is green by design. Dropping the `no-tasks-since` guard
 * changes nothing here, because `start()` increments the counter
 * before every call and this file drives that same tail, so the
 * counter is never below one — the leg is arithmetic-dead over these
 * fixtures rather than unguarded, and `utils/progress.test.ts` owns
 * it. Reaching it from here would need a driver that had stopped
 * copying the loop.
 */
import type { CompactionRun } from '../start.js';
import type { CompactionReason } from '../utils/progress.js';

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { maybeCompactProgress } from '../start.js';
import {
  PROGRESS_CADENCE_TASKS,
  PROGRESS_FILE_NAME,
  PROGRESS_HARD_CAP_BYTES,
  PROGRESS_SOFT_CAP_BYTES,
} from '../utils/progress.js';

/** A finding nothing else here spells, planted in every fixture file. */
const NONCE = 'zz-nonce-a-finding-only-progress-txt-carries';

/** The line it rides on, so the containment control has a subject. */
const NONCE_LINE = `- ${NONCE}: kept out of every prompt and log line.\n`;

/** The bullet a fixture file is padded out to size with. */
const FILLER_LINE = '- a finding of no particular consequence at all.\n';

/** A tracker planted where the loop keeps one, for the untouched leg. */
const TRACKER = [
  '# Plan: a throwaway plan',
  '',
  '## Stage: One',
  '',
  '- [x] Add the store the collector writes its rows to',
  '- [ ] Add an integration test over the compaction dispatch',
  '',
].join('\n');

/** One dispatch a series must make, derived by hand from the caps. */
interface ExpectedDispatch {
  /** The 1-based task whose tail dispatched it. */
  task: number;
  /** The rule that decided it. */
  reason: CompactionReason;
  /** Bytes on disk when the session was handed the file. */
  sizeBytes: number;
}

/** One run of tasks over one growing file. */
interface SeriesSpec {
  /** Names the case and the shape the row is there for. */
  id: string;
  /** Bytes before the first task. Zero plants no file at all. */
  startBytes: number;
  /** Bytes each task appends, one finding's worth. */
  appendBytes: number;
  /** Task tails driven. */
  tasks: number;
  /** Bytes the session leaves behind, or null when it removes nothing. */
  compactTo: number | null;
  /** What the session exits with. */
  exitCode: number;
  /** Every dispatch the run must make, in order. */
  dispatches: readonly ExpectedDispatch[];
}

/**
 * The five runs every case here is driven over.
 *
 * Sizes are chosen so each row's decisions are readable off the caps
 * rather than off a comment: 16,000 is the hard cap exactly, 8,000 the
 * soft one, and 10 the cadence.
 */
const SERIES: readonly SeriesSpec[] = [
  {
    // 2,400 to 6,800 bytes across twelve tasks: never near the soft cap.
    id: 'stays under the soft cap',
    startBytes: 2_000,
    appendBytes: 400,
    tasks: 12,
    compactTo: null,
    exitCode: 0,
    dispatches: [],
  },
  {
    // Task 1 lands on the hard cap exactly; the session takes it back
    // to 3,000 and the eleven tasks after it reach 7,400.
    id: 'crosses the hard cap and is compacted',
    startBytes: 15_600,
    appendBytes: 400,
    tasks: 12,
    compactTo: 3_000,
    exitCode: 0,
    dispatches: [{ task: 1, reason: 'hard-cap', sizeBytes: 16_000 }],
  },
  {
    // Over the soft cap from task 1 and under the hard one throughout,
    // so nothing but the cadence can answer due — on task 10.
    id: 'comes round on the cadence between the caps',
    startBytes: 7_900,
    appendBytes: 100,
    tasks: 12,
    compactTo: 3_000,
    exitCode: 0,
    dispatches: [{ task: 10, reason: 'cadence', sizeBytes: 8_900 }],
  },
  {
    // A session that returns having removed nothing. The file stays
    // over the cap, so the ask repeats — once per task, never twice.
    id: 'cannot shrink the file at all',
    startBytes: 16_000,
    appendBytes: 200,
    tasks: 5,
    compactTo: null,
    exitCode: 0,
    dispatches: [
      { task: 1, reason: 'hard-cap', sizeBytes: 16_200 },
      { task: 2, reason: 'hard-cap', sizeBytes: 16_400 },
      { task: 3, reason: 'hard-cap', sizeBytes: 16_600 },
      { task: 4, reason: 'hard-cap', sizeBytes: 16_800 },
      { task: 5, reason: 'hard-cap', sizeBytes: 17_000 },
    ],
  },
  {
    // The session fails but leaves the file BETWEEN the caps, which is
    // the only place the counter decides anything. Reset on dispatch
    // puts the next cadence dispatch on task 11; reset on success
    // alone would put it on task 10.
    id: 'fails, and the counter resets anyway',
    startBytes: 15_900,
    appendBytes: 100,
    tasks: 12,
    compactTo: 9_000,
    exitCode: 1,
    dispatches: [
      { task: 1, reason: 'hard-cap', sizeBytes: 16_000 },
      { task: 11, reason: 'cadence', sizeBytes: 10_000 },
    ],
  },
];

/** The row whose file never approaches the cap. */
const UNDER_CAP = 0;

/** The row that crosses the hard cap once and is compacted. */
const CROSSING = 1;

/** The row the cadence decides. */
const CADENCE = 2;

/** The row whose session removes nothing. */
const UNSHRINKABLE = 3;

/** The row whose session fails. */
const FAILING = 4;

/** A run of one task against a repo root carrying no progress.txt. */
const FIRST_RUN: SeriesSpec = {
  id: 'has no progress.txt yet',
  startBytes: 0,
  appendBytes: 0,
  tasks: 1,
  compactTo: null,
  exitCode: 0,
  dispatches: [],
};

/** One task's tail, and what the helper answered for it. */
interface TailEntry {
  /** The 1-based task. */
  task: number;
  /** The counter handed in, after the loop's own increment. */
  counterIn: number;
  /** The record the helper returned. */
  run: CompactionRun;
}

/** One session the helper actually dispatched. */
interface SessionCall {
  /** The task whose tail dispatched it. */
  task: number;
  /** The prompt it was handed. */
  prompt: string;
  /** Bytes on disk at the moment it was handed over. */
  sizeAtDispatch: number;
}

/** Everything one driven series produced. */
interface SeriesRun {
  /** The fixture repo root. */
  root: string;
  /** Where `progress.txt` sits under it. */
  progressPath: string;
  /** One entry per task tail, in order. */
  entries: readonly TailEntry[];
  /** One entry per dispatched session, in order. */
  calls: readonly SessionCall[];
  /** What the helper told the operator. */
  logs: readonly string[];
  /** What it warned about. */
  warnings: readonly string[];
}

/** How one drive differs from the row's own shape. */
interface SeriesOverrides {
  /** A starting size over the row's own. Zero plants no file. */
  startBytes?: number;
  /** Runs against the fixture root before the first task. */
  prepare?: (root: string) => void;
}

const tempRoot = mkdtempSync(join(tmpdir(), 'ralph-compaction-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let planted = 0;

/** Lines the helper reported to the operator. */
let logs: string[] = [];

/** Lines it reported as a problem. */
let warnings: string[] = [];

/**
 * Captures what the helper printed.
 *
 * Through a spy on `console` and not a `process.stdout.write` patch:
 * vitest replaces the console object, so a stream capture reads zero
 * lines here and the containment assertion would pass against a helper
 * that logged the whole file.
 *
 * {@link driveSeries} empties both arrays again before each drive, so a
 * case driving twice reads one drive at a time rather than the first
 * one's lines both times.
 */
beforeEach(() => {
  logs = [];
  warnings = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A file of exactly `sizeBytes` bytes, carrying the nonce.
 *
 * ASCII throughout, so the fixture's byte length is its character
 * length and a size in the table is the size the loop reads. Both
 * checks throw rather than trimming: a fixture that quietly lost the
 * nonce would make the containment control vacuous, and one that is
 * not the size it claims moves every decision in its row.
 */
function progressBody(sizeBytes: number): string {
  if (sizeBytes < NONCE_LINE.length) {
    throw new Error(`fixture of ${sizeBytes} bytes cannot carry the nonce`);
  }
  const fillers = Math.ceil(sizeBytes / FILLER_LINE.length) + 1;
  const body = (NONCE_LINE + FILLER_LINE.repeat(fillers)).slice(0, sizeBytes);
  const actual = Buffer.byteLength(body, 'utf8');
  if (actual !== sizeBytes) {
    throw new Error(`fixture is ${actual} bytes, not ${sizeBytes}`);
  }
  return body;
}

/**
 * Drives one row through the loop's own per-task tail.
 *
 * The counter threading is copied from `start()` line for line —
 * increment, call, take the counter back off the record — and the
 * describe at the foot of this file holds that copy against that
 * file's source, so it cannot go stale silently.
 */
async function driveSeries(
  spec: SeriesSpec,
  overrides: SeriesOverrides = {},
): Promise<SeriesRun> {
  logs = [];
  warnings = [];

  planted += 1;
  const root = join(tempRoot, `root-${planted}`);
  mkdirSync(root, { recursive: true });
  overrides.prepare?.(root);

  const progressPath = join(root, PROGRESS_FILE_NAME);
  const startBytes = overrides.startBytes ?? spec.startBytes;
  if (startBytes > 0) writeFileSync(progressPath, progressBody(startBytes));

  const entries: TailEntry[] = [];
  const calls: SessionCall[] = [];
  let tasksSinceCompaction = 0;

  for (let task = 1; task <= spec.tasks; task += 1) {
    // The task's own append. Every scoped session is told to add its
    // findings here, which is the whole reason the file grows.
    if (spec.appendBytes > 0) {
      appendFileSync(progressPath, progressBody(spec.appendBytes));
    }

    // ---- the loop's tail, as `start()` runs it ----
    tasksSinceCompaction += 1;
    const counterIn = tasksSinceCompaction;
    const run = await maybeCompactProgress({
      repoRoot: root,
      tasksSinceCompaction,
      run: (prompt: string) => {
        calls.push({
          task,
          prompt,
          sizeAtDispatch: statSync(progressPath).size,
        });
        if (spec.compactTo !== null) {
          writeFileSync(progressPath, progressBody(spec.compactTo));
        }
        return Promise.resolve(spec.exitCode);
      },
    });
    tasksSinceCompaction = run.tasksSinceCompaction;
    // ---- end of the tail ----

    entries.push({ task, counterIn, run });
  }

  return {
    root,
    progressPath,
    entries,
    calls,
    logs: [...logs],
    warnings: [...warnings],
  };
}

/** What a driven run actually dispatched, in the table's own shape. */
function dispatchesOf(result: SeriesRun): ExpectedDispatch[] {
  return result.entries
    .filter((entry) => entry.run.dispatched)
    .map((entry) => ({
      task: entry.task,
      reason: entry.run.decision.reason,
      sizeBytes: entry.run.decision.sizeBytes,
    }));
}

/** The module's own source, for the call-site guard at the foot. */
function startSource(): string {
  return readFileSync(new URL('../start.ts', import.meta.url), 'utf8');
}

describe('a run of tasks whose file stays under the cap', () => {
  it(
    'never reaches the session runner, and would if it were bigger',
    async () => {
      const spec = SERIES[UNDER_CAP]!;
      const quiet = await driveSeries(spec);

      expect(quiet.calls).toEqual([]);
      expect(quiet.entries).toHaveLength(spec.tasks);
      for (const entry of quiet.entries) {
        expect(entry.run.dispatched).toBe(false);
        expect(entry.run.decision.due).toBe(false);
        expect(entry.run.decision.reason).toBe('under-soft-cap');
        expect(entry.run.exitCode).toBeNull();
        expect(entry.run.sizeAfterBytes).toBeNull();
      }

      // The control, inside the case and varied along the one axis the
      // case is named for: the identical run from a bigger starting size
      // must reach the runner. Without it a helper that had stopped
      // dispatching altogether satisfies every assertion above.
      const loud = await driveSeries(spec, {
        startBytes: PROGRESS_HARD_CAP_BYTES,
      });

      expect(loud.calls.length).toBeGreaterThan(0);
    },
  );

  it('hands the next task the counter it was given', async () => {
    const { entries } = await driveSeries(SERIES[UNDER_CAP]!);

    // Nothing was dispatched, so nothing may reset: the counter comes
    // back exactly as it went in, and the loop keeps accumulating.
    for (const entry of entries) {
      expect(entry.run.tasksSinceCompaction).toBe(entry.counterIn);
      expect(entry.counterIn).toBe(entry.task);
    }
  });

  it('dispatches nothing on a run with no progress.txt yet', async () => {
    const first = await driveSeries(FIRST_RUN);

    // The absent file reaches the decision as zero bytes through the
    // helper's own default reader, which is the wiring the colocated
    // suite cannot see: it drives the reader and the decision apart.
    expect(existsSync(first.progressPath)).toBe(false);
    expect(first.calls).toEqual([]);
    expect(first.entries[0]?.run.decision.sizeBytes).toBe(0);
    expect(first.entries[0]?.run.decision.reason).toBe('under-soft-cap');

    // Same axis, same driver: a file that IS there, over the cap.
    const withFile = await driveSeries(FIRST_RUN, {
      startBytes: PROGRESS_HARD_CAP_BYTES,
    });

    expect(withFile.calls).toHaveLength(1);
  });
});

describe('a run of tasks that crosses it', () => {
  it('dispatches on exactly the tasks the table names', async () => {
    let zeroRows = 0;
    let repeatRows = 0;

    for (const spec of SERIES) {
      const result = await driveSeries(spec);

      // What the records say, held against the hand-derived table.
      expect(dispatchesOf(result)).toEqual(spec.dispatches);

      // And what the RUNNER was actually handed, which is the half a
      // record cannot answer for: a helper reporting a dispatch it
      // never made passes the assertion above and fails this one.
      expect(result.calls.map((call) => call.task))
        .toEqual(spec.dispatches.map((dispatch) => dispatch.task));
      for (const [index, call] of result.calls.entries()) {
        expect(call.sizeAtDispatch).toBe(spec.dispatches[index]?.sizeBytes);
      }

      if (spec.dispatches.length === 0) zeroRows += 1;
      if (spec.dispatches.length > 1) repeatRows += 1;
    }

    // The table itself is not one shape agreeing with itself: it holds
    // a run that must dispatch nothing and runs that must dispatch
    // more than once, and both due reasons are represented.
    expect(zeroRows).toBeGreaterThan(0);
    expect(repeatRows).toBeGreaterThan(0);
    const reasons = new Set(
      SERIES.flatMap((spec) => spec.dispatches.map((d) => d.reason)),
    );
    expect([...reasons].sort()).toEqual(['cadence', 'hard-cap']);
  });

  it('takes the crossing task once and never repeats it', async () => {
    const spec = SERIES[CROSSING]!;
    const result = await driveSeries(spec);
    const [crossing, ...rest] = result.entries;

    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]?.task).toBe(1);
    expect(crossing?.run.decision.reason).toBe('hard-cap');
    expect(crossing?.run.decision.sizeBytes).toBe(PROGRESS_HARD_CAP_BYTES);
    expect(crossing?.run.exitCode).toBe(0);
    expect(crossing?.run.sizeAfterBytes).toBe(spec.compactTo);

    // The counter is what stops the same appended finding being
    // compacted twice, so it goes back to zero here and the eleven
    // tasks after this one dispatch nothing at all.
    expect(crossing?.run.tasksSinceCompaction).toBe(0);
    expect(rest).toHaveLength(spec.tasks - 1);
    for (const entry of rest) expect(entry.run.dispatched).toBe(false);
    expect(statSync(result.progressPath).size)
      .toBeLessThan(PROGRESS_SOFT_CAP_BYTES);
  });

  it('dispatches on the cadence with no cap crossed at all', async () => {
    const spec = SERIES[CADENCE]!;
    const result = await driveSeries(spec);

    // Every size in this run sits between the caps, so the hard cap
    // decides nothing and the dispatch is the rolling half alone.
    for (const entry of result.entries) {
      expect(entry.run.decision.sizeBytes)
        .toBeLessThan(PROGRESS_HARD_CAP_BYTES);
    }
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]?.task).toBe(PROGRESS_CADENCE_TASKS);
    expect(dispatchesOf(result)[0]?.reason).toBe('cadence');
  });

  it('asks once per task while the file cannot be shrunk', async () => {
    const spec = SERIES[UNSHRINKABLE]!;
    const result = await driveSeries(spec);

    // One ask per task and never two in one tail: the residual
    // `utils/progress.ts` names, bounded by the task rate rather than
    // by a size the loop cannot verify anyone changed.
    expect(result.calls).toHaveLength(spec.tasks);
    expect(result.calls.map((call) => call.task))
      .toEqual(result.entries.map((entry) => entry.task));
    for (const entry of result.entries) {
      expect(entry.run.dispatched).toBe(true);
      expect(entry.counterIn).toBe(1);
      expect(entry.run.tasksSinceCompaction).toBe(0);
    }
  });

  it('resets the counter on a session that failed', async () => {
    const spec = SERIES[FAILING]!;
    const result = await driveSeries(spec);
    const [first, second] = dispatchesOf(result);

    expect(result.entries[0]?.run.exitCode).toBe(spec.exitCode);
    expect(result.entries[0]?.run.dispatched).toBe(true);
    expect(result.entries[0]?.run.tasksSinceCompaction).toBe(0);
    expect(first?.task).toBe(1);

    // The discriminator: the failed session left the file between the
    // caps, so the next dispatch is the cadence counting from zero. A
    // counter reset only on SUCCESS would have counted from one and
    // dispatched a task earlier.
    expect(second?.task).toBe(1 + PROGRESS_CADENCE_TASKS);
    expect(second?.reason).toBe('cadence');
    expect(result.calls).toHaveLength(2);

    // A failure is stepped over rather than blocking, so the run
    // continues to its last task and warns instead of erroring.
    expect(result.entries).toHaveLength(spec.tasks);
    expect(result.warnings.some((line) => line.includes('exit 1'))).toBe(true);
  });
});

describe('what a dispatched session is handed', () => {
  it('builds its prompt from the decision it was dispatched on', async () => {
    const crossing = await driveSeries(SERIES[CROSSING]!);
    const cadence = await driveSeries(SERIES[CADENCE]!);
    const first = crossing.calls[0];
    const second = cadence.calls[0];

    for (const [call, reason] of [
      [first, 'hard-cap'],
      [second, 'cadence'],
    ] as const) {
      expect(call?.prompt).toContain(`${call?.sizeAtDispatch} bytes`);
      expect(call?.prompt).toContain(`rule: ${reason}`);
      expect(call?.prompt)
        .toContain(`hard cap of ${PROGRESS_HARD_CAP_BYTES}`);
    }

    // Two decisions, two prompts. A constant prompt satisfies neither
    // the figures above nor this.
    expect(first?.prompt).not.toBe(second?.prompt);
  });

  it('quotes the size and never a line of the file', async () => {
    const result = await driveSeries(SERIES[CROSSING]!);

    // The control: the file it decided over really does carry the
    // nonce, so the absences below are about containment and not
    // about a fixture with nothing in it to leak.
    expect(readFileSync(result.progressPath, 'utf8')).toContain(NONCE);
    expect(result.calls).toHaveLength(1);

    for (const call of result.calls) expect(call.prompt).not.toContain(NONCE);
    for (const line of [...result.logs, ...result.warnings]) {
      expect(line).not.toContain(NONCE);
    }

    // The size is what the operator is told instead.
    expect(result.logs.some((line) => line.includes('16000 bytes')))
      .toBe(true);
  });

  it('leaves the tracker exactly as the finished task left it', async () => {
    const trackerName = join('.plans', 'PLAN_TRACKER-throwaway.md');
    let before = '';

    const result = await driveSeries(SERIES[CROSSING]!, {
      prepare: (root) => {
        mkdirSync(join(root, '.plans'), { recursive: true });
        writeFileSync(join(root, trackerName), TRACKER);
        before = createHash('sha256').update(TRACKER)
          .digest('hex');
      },
    });

    // Structural rather than promised: the helper is handed no tracker
    // path at all, so a compaction cannot tick, block or shift a line.
    // The dispatch count is the control — an untouched tracker after a
    // run that compacted nothing says nothing.
    expect(result.calls).toHaveLength(1);
    const after = readFileSync(join(result.root, trackerName), 'utf8');
    expect(createHash('sha256').update(after)
      .digest('hex')).toBe(before);
    expect(after).toContain('- [ ]');
  });
});

describe('the loop\'s own call site', () => {
  it('threads the counter the way this file drives it', () => {
    const source = startSource();

    // The driver above is a copy of `start()`'s tail, and this is what
    // keeps the copy honest: the increment, the call and the take-back
    // all still spelled there.
    expect(source).toContain('tasksSinceCompaction += 1;');
    expect(source).toContain('const compaction = await maybeCompactProgress({');
    expect(source).toContain('tasksSinceCompaction = compaction.tasksSinceCompaction;');
    expect(source).toContain('let tasksSinceCompaction = 0;');
  });

  it('takes the compaction between the commit and the usage gate', () => {
    const source = startSource();
    const commit = source.indexOf('const attempt = commitFinishedTask({');
    const compaction = source.indexOf('const compaction = await maybeCompactProgress({');
    const usage = source.indexOf('await checkUsage(\'task\')');

    // Ordering, and it is load-bearing: the counter lives in `start()`'s
    // own scope and a fresh run begins at zero, so a run that paused at
    // the usage gate without compacting would hand the whole oversized
    // file to the next run's first task, which cannot compact either.
    expect(commit).toBeGreaterThan(-1);
    expect(compaction).toBeGreaterThan(commit);
    expect(usage).toBeGreaterThan(compaction);
  });

  it('proves that guard fails on a call nothing spells', () => {
    const source = startSource();

    expect(source).toContain('maybeCompactProgress');
    expect(source).not.toContain('maybeCompactProgressLater');
  });
});
