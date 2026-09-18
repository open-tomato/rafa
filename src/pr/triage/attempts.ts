/**
 * The attempt guard `rafa pr triage --resolve` runs behind: the counter
 * raised before each run, and the two readings that stop the command.
 *
 * A resolve run edits a pull request, pushes and waits for CI. Nothing
 * about that loop ends on its own: a plan that cannot fix the failure
 * produces the same red pull request every time, and the run after it
 * starts from the same place. So the spec gives the loop two ways out
 * and no third (`.specs/rafa-20-pr-commands.md`): `attempts` in the
 * triage block, raised before each run and stopped at `--max-attempts`,
 * and a run that ends with the SAME class and the SAME failing step as
 * the run before it. Both live here, and nothing else does — this
 * module spawns nothing, reads no clock, writes no comment and knows
 * nothing about worktrees. It answers readings; the command acts on
 * them, removes the worktree, updates the comment and exits 3.
 *
 * ## Why the counter is raised BEFORE the run
 *
 * `attempts` is stored in the triage comment, which is the only place a
 * later run can read it from. A counter raised after a run is lost
 * whenever the run does not come back — a crash, a machine that slept
 * through the CI wait, an operator's `^C` — and the next run would read
 * the same count as the last and start over for ever, which is exactly
 * the state the guard exists to prevent. Raised first, a run that never
 * reports still costs its attempt.
 *
 * The arithmetic that follows is what makes `--max-attempts=2` mean two
 * runs: a stored 0 raises to 1 and runs, a stored 1 raises to 2 and
 * runs, and a stored 2 does not run at all.
 * {@link readAttemptStart} compares the SPENT count against the cap
 * before raising it, so the stop fires on the third invitation rather
 * than the second.
 *
 * ## The stored count is untrusted
 *
 * `attempts` comes back out of a YAML block in a comment a human can
 * edit and an older rafa may never have written
 * (`./comment.ts`). {@link spentAttempts} therefore takes anything and
 * answers a count: null and undefined are 0, and so is a negative or
 * fractional number, floored up to 0 and down to a whole number. A
 * caller that passed a hand-edited `attempts: -5` straight through
 * would hand the pull request five extra runs.
 *
 * ## What "the same failing step" compares, and what it does not
 *
 * The repeat reading is a pair: the class (`./classes.ts`) and the
 * failing step the log named (`./evidence.ts`). The class alone is too
 * coarse — a `ci-lint` that moved from one step to another IS progress,
 * and stopping on it would refuse a run that is working. The step alone
 * is too coarse the other way, because a step name is only as specific
 * as the workflow's author made it.
 *
 * {@link stepKey} is the normalisation: the step's name trimmed, with
 * internal whitespace runs collapsed to one space, because the same
 * step reaches this module once from a provider's step column and once
 * from a `##[group]Run ` marker holding the step's command, and a
 * command that was re-indented in the workflow file is not a different
 * failure. The SOURCE is deliberately not compared: a run whose log
 * named the step in one reading and a run whose log named it in the
 * other are the same failure if the text agrees, and holding them apart
 * would hand a stuck pull request another attempt.
 *
 * Two runs that named NO step are read as the same step, and therefore
 * as a repeat when the class also agrees. That is the conservative
 * direction on purpose: a pair of runs that both ended `ci-other` with
 * nothing to point at is the case the guard has least to learn from,
 * and stopping leaves the operator the follow-up prompt, while
 * continuing spends a full run to learn nothing.
 *
 * ## What the caller is trusted to do
 *
 * {@link readAttemptRepeat} is asked about a run that ended RED. It
 * does not check that the class is a failure, because a resolve run
 * that ended `green` has already finished the command and never reaches
 * a guard. Asked about two green runs it would answer `repeat`, which
 * is a reading no caller has a way to produce.
 *
 * The cap itself is the command's: `--max-attempts` is parsed and
 * defaulted in `src/commands/pr/triage.ts`, whose `DEFAULT_MAX_ATTEMPTS`
 * is the one spelling of 2. This module takes the cap already read and
 * refuses a value that is not a positive whole number, rather than
 * clamping it: a cap of 0 would mean a `--resolve` that never runs
 * anything and reported a stop as though work had been tried.
 */
import type { TriageAssessment } from './classify.js';
import type { FailedStep } from './evidence.js';

/**
 * Why a `--resolve` loop stopped. Exactly one of these is the answer;
 * a loop that ran out of neither reason is still going.
 */
export type AttemptStop = 'cap' | 'repeat';

/**
 * Every stop, in the order a run meets them: the cap is read before a
 * run, the repeat after one. Frozen, because a caller that pushed onto
 * it would change what every later reader accepts.
 */
export const ATTEMPT_STOPS: readonly AttemptStop[] = Object.freeze([
  'cap',
  'repeat',
] as const);

/** Whether a value is one of {@link ATTEMPT_STOPS}. */
export function isAttemptStop(value: unknown): value is AttemptStop {
  return typeof value === 'string'
    && (ATTEMPT_STOPS as readonly string[]).includes(value);
}

/**
 * What one resolve run ended as, which is the pair the repeat reading
 * compares.
 *
 * Spelled as a `Pick` of {@link TriageAssessment} rather than its own
 * interface, so the assessment a fresh triage produced is passed
 * straight in and a rename on the classifier reaches this reading
 * through the compiler.
 */
export type AttemptOutcome = Pick<TriageAssessment, 'triageClass' | 'step'>;

/** What {@link readAttemptStart} is asked before a run. */
export interface AttemptStartInput {
  /** `attempts` as the stored block carried it; anything at all, see the module note. */
  readonly stored: unknown;
  /** The cap, already read from `--max-attempts`. A positive whole number. */
  readonly maxAttempts: number;
}

/** What {@link readAttemptRepeat} is asked about a run that ended red. */
export interface AttemptRepeatInput {
  /** What the run before this one ended as, or null when there was none. */
  readonly previous: AttemptOutcome | null;
  /** What the run that just finished ended as. */
  readonly outcome: AttemptOutcome;
  /** The count the run was made under, as {@link readAttemptStart} raised it. */
  readonly attempts: number;
  /** The cap the count is reported against. A positive whole number. */
  readonly maxAttempts: number;
}

/** What one attempt reading concluded. */
export interface AttemptReading {
  /** Why the loop stops, or null when it continues. */
  readonly stop: AttemptStop | null;
  /** Whether the loop stops. `stop !== null`, kept so a caller reads one field. */
  readonly stopped: boolean;
  /**
   * The attempt count as it stands after this reading: raised by
   * {@link readAttemptStart} for a run that goes ahead, and the spent
   * count unchanged when the cap stopped it.
   */
  readonly attempts: number;
  /** The cap this was read against, carried so a report names both numbers. */
  readonly maxAttempts: number;
  /** One lower-case sentence naming the reading, for the comment and the console. */
  readonly reason: string;
}

/** What every refusal from this module opens with. */
const PREFIX = 'pr triage attempts';

/** Whitespace runs, which {@link stepKey} collapses to one space. */
const WHITESPACE = /\s+/g;

/** What {@link stepKey} answers for a run whose log named no step. */
export const NO_STEP_KEY = '';

/** The cap, refused rather than clamped when it is not a count of runs. */
function readCap(maxAttempts: number): number {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError(
      `${PREFIX}: refused a cap of ${JSON.stringify(maxAttempts)},`
        + ' expected a positive whole number',
    );
  }
  return maxAttempts;
}

/**
 * How many resolve runs have been spent, out of whatever the stored
 * block carried: null, undefined, a negative number, a fraction and a
 * value of another type all read as 0. See the module note.
 */
export function spentAttempts(stored: unknown): number {
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return 0;
  if (stored < 1) return 0;
  return Math.floor(stored);
}

/**
 * The comparison key of a failing step: its name trimmed with internal
 * whitespace collapsed, or {@link NO_STEP_KEY} when no step was named.
 *
 * Exported so a test drives the normalisation directly, and so a caller
 * reporting what two runs agreed on prints the same text the comparison
 * used.
 */
export function stepKey(step: FailedStep | undefined): string {
  if (step === undefined) return NO_STEP_KEY;
  return step.name.replace(WHITESPACE, ' ').trim();
}

/**
 * Whether two runs ended the same way: the same class AND the same
 * failing step under {@link stepKey}. A null `previous` — the first run
 * of a loop — is never the same as anything.
 */
export function isSameAttemptOutcome(
  previous: AttemptOutcome | null,
  outcome: AttemptOutcome,
): boolean {
  if (previous === null) return false;
  if (previous.triageClass !== outcome.triageClass) return false;
  return stepKey(previous.step) === stepKey(outcome.step);
}

/** How a reason names the step two runs agreed on, or that there was none. */
function describeStep(step: FailedStep | undefined): string {
  const key = stepKey(step);
  return key === NO_STEP_KEY
    ? 'with no step named'
    : `at \`${key}\``;
}

/**
 * The reading taken BEFORE a resolve run: the counter raised, or the
 * cap reached.
 *
 * At or over the cap the count is answered unchanged, because no run
 * was made and raising it would report an attempt nothing spent.
 */
export function readAttemptStart(input: AttemptStartInput): AttemptReading {
  const maxAttempts = readCap(input.maxAttempts);
  const spent = spentAttempts(input.stored);
  if (spent >= maxAttempts) {
    return {
      stop: 'cap',
      stopped: true,
      attempts: spent,
      maxAttempts,
      reason: `${spent} of ${maxAttempts} resolve attempts spent`,
    };
  }
  const attempts = spent + 1;
  return {
    stop: null,
    stopped: false,
    attempts,
    maxAttempts,
    reason: `resolve attempt ${attempts} of ${maxAttempts}`,
  };
}

/**
 * The reading taken AFTER a resolve run that ended red: the same class
 * at the same failing step as the run before it, or progress.
 *
 * The count is carried through untouched. It was raised before the run
 * and stored then; a reading here never spends another one.
 */
export function readAttemptRepeat(input: AttemptRepeatInput): AttemptReading {
  const maxAttempts = readCap(input.maxAttempts);
  const attempts = spentAttempts(input.attempts);
  const { outcome, previous } = input;
  if (isSameAttemptOutcome(previous, outcome)) {
    return {
      stop: 'repeat',
      stopped: true,
      attempts,
      maxAttempts,
      reason: `attempt ${attempts} ended as \`${outcome.triageClass}\``
        + ` ${describeStep(outcome.step)}, the same reading as the run before it`,
    };
  }
  const against = previous === null
    ? 'no earlier run to compare against'
    : `the run before it ended as \`${previous.triageClass}\` ${describeStep(previous.step)}`;
  return {
    stop: null,
    stopped: false,
    attempts,
    maxAttempts,
    reason: `attempt ${attempts} ended as \`${outcome.triageClass}\``
      + ` ${describeStep(outcome.step)}, ${against}`,
  };
}
