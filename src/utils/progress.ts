/**
 * Deciding whether `progress.txt` is due for a compaction.
 *
 * `progress.txt` is the loop's scratch memory, and every task pays
 * for its size twice. `PROMPT.md` line 1 tells each scoped session to
 * read the file IN FULL before it starts, so the whole of it enters
 * the context of every task; line 7 tells the same session to append
 * to it, so it is strictly larger for the next one. The only step
 * that ever shrinks it lives in `preserveProgress`, which runs after
 * the LAST task — so within a run the file only grows, and the run's
 * final task reads everything its predecessors wrote.
 *
 * This module is the loop's own answer to that, and the emphasis is
 * on OWN. A prompt can ask a session to compact and the session is
 * free to decide it has better things to do; nothing observes the
 * outcome. A size read off `statSync` and a counter the loop already
 * holds are observable, cheap, and answer the same question before
 * any model is involved.
 *
 * Three zones, decided in this order:
 *
 *   - Nothing has been appended since the last compaction
 *     ({@link ProgressState.tasksSinceCompaction} below
 *     {@link MIN_TASKS_SINCE_COMPACTION}). Never due, whatever the
 *     size. This is the guard, not a nicety — see below.
 *   - At or over {@link CompactionThresholds.hardCapBytes}. Due
 *     immediately, on the first task that pushed it there.
 *   - Under {@link CompactionThresholds.softCapBytes}. Never due,
 *     whatever the counter says: a compaction session over a file
 *     with a handful of findings in it costs a whole session and
 *     removes nothing.
 *   - Between the two, due every
 *     {@link CompactionThresholds.cadenceTasks} tasks. This is the
 *     rolling half.
 *
 * The counter is REQUIRED rather than an optimisation. Without it a
 * file the model could not get under the cap would be re-dispatched
 * immediately after its own compaction returned, and again, forever —
 * the loop cannot verify a session shrank anything, so the only
 * available bound is on how often it may ask. With it the bound is at
 * most one compaction per completed task. The residual is worth
 * naming rather than hiding: a compaction that genuinely cannot get
 * under the cap will be asked again on the next task, once per task.
 * That is visible in the operator log and bounded by the task rate,
 * where the unguarded version is neither.
 *
 * The hard cap is in BYTES and is derived from a limit spelled in
 * CHARACTERS. `plan.ts` injects this file into plan generation and
 * truncates it at {@link PROGRESS_INJECTION_CAP_CHARS} characters,
 * oldest findings first — so a file over that size is one whose
 * earliest findings no future plan will ever see. UTF-8 gives at
 * least one byte per character, so a file at or under N BYTES holds
 * at most N characters: enforcing the same number in bytes can only
 * fire EARLY, never late, and the injection's own truncation
 * therefore never has to act. The direction is what matters, not the
 * margin, which is thin — measured on this repo's own file, 124,984
 * bytes against 124,674 characters, a ratio of 1.0025.
 *
 * The soft cap is `.claude/skills/progress-hygiene/SKILL.md`'s own
 * `~8k characters` figure, read as bytes for the same reason. The
 * cadence is derived from what a task actually appends: the live file
 * measured 181 findings across 124,984 bytes, a median of 665 and a
 * mean of 690 bytes each, and one finding per task is the ordinary
 * shape. Ten tasks is therefore about 6.9 kB — under the soft cap in
 * the ordinary case, which leaves the hard cap doing what it is for,
 * catching the run whose tasks append more than the average.
 *
 * Two containment properties, both structural. Nothing here opens
 * `progress.txt` — a size and a count are the whole input, so no
 * finding's TEXT can reach a log line or a store through this
 * module. And `progress.txt` is gitignored, so a compaction changes
 * no tracked file: `commitFinishedTask` reaches `nothing-to-commit`
 * for it by the ordinary route, and a compaction leaves neither a
 * commit nor a tracker line behind.
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';

/** The loop's scratch memory, at the repo root and gitignored. */
export const PROGRESS_FILE_NAME = 'progress.txt';

/**
 * Characters `plan.ts` truncates the INJECTED findings at.
 *
 * A literal copied out of another file, which nothing but a drift
 * guard ties to its source. The colocated test reads `plan.ts` for
 * its `PROGRESS_CAP_CHARS` and holds this against it, so a change
 * there reds here rather than silently leaving the loop enforcing a
 * cap the injection no longer has.
 */
export const PROGRESS_INJECTION_CAP_CHARS = 16_000;

/**
 * The cap the loop enforces itself, in bytes.
 *
 * Equal to {@link PROGRESS_INJECTION_CAP_CHARS} on purpose: bytes are
 * never fewer than characters, so a file inside this cap is inside
 * the injection's too and the truncation never acts.
 */
export const PROGRESS_HARD_CAP_BYTES = 16_000;

/**
 * The size below which a compaction is never worth a session.
 *
 * `progress-hygiene`'s own `~8k characters`, read as bytes. Between
 * this and the hard cap the cadence decides; below it nothing does.
 */
export const PROGRESS_SOFT_CAP_BYTES = 8_000;

/** Tasks between rolling compactions, once past the soft cap. */
export const PROGRESS_CADENCE_TASKS = 10;

/**
 * Tasks that must have completed since the last compaction.
 *
 * One. The whole of what it buys is that a compaction cannot be
 * dispatched twice for the same appended finding, which is what
 * bounds a file the model cannot shrink.
 */
export const MIN_TASKS_SINCE_COMPACTION = 1;

/** The three numbers a decision is taken against. */
export interface CompactionThresholds {
  /** At or over this many bytes, a compaction is due at once. */
  hardCapBytes: number;
  /** Under this many bytes, a compaction is never due. */
  softCapBytes: number;
  /** Tasks between compactions while between the two caps. */
  cadenceTasks: number;
}

/** What the loop runs on when a caller overrides nothing. */
export const DEFAULT_COMPACTION_THRESHOLDS: CompactionThresholds = {
  hardCapBytes: PROGRESS_HARD_CAP_BYTES,
  softCapBytes: PROGRESS_SOFT_CAP_BYTES,
  cadenceTasks: PROGRESS_CADENCE_TASKS,
};

/** Why a compaction is, or is not, due. */
export type CompactionReason =
  /** At or over the hard cap. Due. */
  | 'hard-cap'
  /** Past the soft cap and the cadence has come round. Due. */
  | 'cadence'
  /** No task has appended anything since the last compaction. */
  | 'no-tasks-since'
  /** Too little in the file to be worth a session. */
  | 'under-soft-cap'
  /** Past the soft cap, but the cadence has not come round. */
  | 'within-cadence'
  /** A size or a count this module cannot read as a number. */
  | 'unreadable-state';

/** The two reasons that answer due. */
export const DUE_REASONS = ['hard-cap', 'cadence'] as const;

/** What the loop knows about the file between two tasks. */
export interface ProgressState {
  /** Size of `progress.txt` on disk, in bytes. */
  sizeBytes: number;
  /** Tasks completed since the last compaction ran. */
  tasksSinceCompaction: number;
}

/** One decision, carrying what it was taken on. */
export interface CompactionDecision {
  /** True when the loop should run a compaction session now. */
  due: boolean;
  /** The rule that decided it, due or not. */
  reason: CompactionReason;
  /** The size as read, so an operator line quotes it. */
  sizeBytes: number;
  /** The counter as read. */
  tasksSinceCompaction: number;
  /** Thresholds after any override was merged in. */
  thresholds: CompactionThresholds;
}

/** Where `progress.txt` lives under a repo root. */
export function progressFilePath(repoRoot: string): string {
  return join(repoRoot, PROGRESS_FILE_NAME);
}

/**
 * Size of a file in bytes, or 0 when there is none.
 *
 * A missing file is the FIRST-RUN case and answers 0 rather than
 * throwing — no file and an empty one mean the same thing to every
 * caller here. Only absence is absorbed: a permission or IO failure
 * still throws, so a file nobody can read cannot pass for a small
 * one and suppress every compaction the run would have needed.
 */
export function readProgressSizeBytes(filePath: string): number {
  const stats = statSync(filePath, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isFile()) return 0;
  return stats.size;
}

/** True for a size or a count this module can decide on. */
function isUsableCount(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Decides whether a compaction is due.
 *
 * Total over its inputs and free of side effects: no clock, no disk,
 * nothing thrown. A state this module cannot read as two
 * non-negative finite numbers answers `unreadable-state` and NOT
 * due, which is today's behaviour exactly — the file is still
 * compacted after the last task, as it always was. A broken reading
 * that dispatched a session instead would spend one per task.
 */
export function isCompactionDue(
  state: ProgressState,
  overrides: Partial<CompactionThresholds> = {},
): CompactionDecision {
  const thresholds = { ...DEFAULT_COMPACTION_THRESHOLDS, ...overrides };
  const { sizeBytes, tasksSinceCompaction } = state;

  const decide = (
    due: boolean,
    reason: CompactionReason,
  ): CompactionDecision => ({
    due,
    reason,
    sizeBytes,
    tasksSinceCompaction,
    thresholds,
  });

  if (!isUsableCount(sizeBytes) || !isUsableCount(tasksSinceCompaction)) {
    return decide(false, 'unreadable-state');
  }
  if (tasksSinceCompaction < MIN_TASKS_SINCE_COMPACTION) {
    return decide(false, 'no-tasks-since');
  }
  if (sizeBytes >= thresholds.hardCapBytes) return decide(true, 'hard-cap');
  if (sizeBytes < thresholds.softCapBytes) {
    return decide(false, 'under-soft-cap');
  }
  if (tasksSinceCompaction >= thresholds.cadenceTasks) {
    return decide(true, 'cadence');
  }
  return decide(false, 'within-cadence');
}
