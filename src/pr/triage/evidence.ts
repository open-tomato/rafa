/**
 * The evidence a triage quotes: which STEP a CI job died in, and the
 * tail of what that job wrote.
 *
 * `rafa pr triage` classifies a red pull request from the failing step
 * name (`./classes.ts` — the step is what tells `ci-install` from
 * `ci-lint` from `ci-types` from `ci-test`), and it shows an operator,
 * and pastes into a follow-up prompt, the last lines of the log. Both
 * readings come out of one capture, `gh run view <id> --log-failed`,
 * which the port answers as a single string (`PullRequests.failedLog`,
 * `../types.ts`). Everything here is pure over that string: no command
 * is sent, so a case drives the reader over captured text and measures
 * the reader rather than a fake `gh`.
 *
 * ## The shape, as measured
 *
 * `gh run view <id> --log-failed` writes one line per log line,
 * `<job>\t<step>\t<timestamp> <text>`. Read on gh 2.100.0 under macOS,
 * 2026-09-18, against two real failed runs of `cli/cli` — 34978884017
 * (5413 lines, one job, `Dependabot`) and 34857793347 (651 lines, one
 * job, `detection`):
 *
 *   - **The step column is `UNKNOWN STEP` on every line of both**, all
 *     5413 and all 651, which is the same reading
 *     `../gh-fake-shapes.ts` recorded against a third run. So the
 *     failing step name is NOT something `gh` hands over here; it has
 *     to be inferred, and {@link GROUP_STEP_PREFIX} is what it is
 *     inferred from.
 *   - Every line of 34857793347 split into exactly three tab columns,
 *     and a message never carried a tab of its own. A line with fewer
 *     than two tabs is still kept, whole, by
 *     {@link parseFailedLogLine} — a line that is not in the shape is
 *     evidence too, and dropping it would hide whatever made `gh`
 *     depart from the shape.
 *   - **31 of those 651 lines carried no timestamp at all**, being the
 *     continuation lines of a multi-line message. So the timestamp is
 *     stripped where it is there and never required.
 *   - **The first line of a job's log opens with a BOM** (U+FEFF)
 *     before its timestamp — line 1 of 34978884017.
 *   - **Colour arrives as the two LITERAL characters `^` and `[`, not
 *     as ESC.** `xxd` of line 397 of 34857793347 reads
 *     `5e 5b 5b 33 36 3b 31 6d` for what `cat -v` shows as
 *     `^[[36;1m`. {@link stripText} takes that form and the real ESC
 *     one both, because the caret form is what was measured and the
 *     ESC one is what the sequence is.
 *
 * Both captures carried ONE job, so nothing here is a reading about how
 * a run with several failing jobs is laid out. That is why
 * {@link FailedLogEvidence.jobs} is answered: a caller can see that a
 * tail capped at {@link FAILED_LOG_TAIL_LINES} covers the last of
 * several jobs, rather than being told a single job's name that was
 * never the whole story.
 *
 * ## Why the FIRST error decides the step
 *
 * The runner opens a group per step, `##[group]Run <command>`, and the
 * group stays in effect until the next step's head — the step's output
 * and its `##[error]` line both come after the matching `##[endgroup]`.
 * So the step in effect at an error line is the last group head at or
 * above it.
 *
 * A job can hold more than one error. In 34857793347 the first is
 * `##[error]Process completed with exit code 22.` at line 415, under
 * the group opened at line 396,
 * `Run bash "${RUNNER_TEMP}/gh-aw/actions/install_awf_binary.sh"
 * v0.28.7 --rootless`, which had failed six `curl: (22)` attempts; the
 * second is exit 127 at line 516, under the step AFTER it, which ran a
 * binary the first step never installed. The second error is the first
 * one's fallout. That is the measured reason
 * {@link readFailedStep} answers the first error's step and not the
 * last: a triage that classified that run on its last error would have
 * called a failed download a failed invocation.
 *
 * The step COLUMN still wins wherever it names something, so a `gh`
 * that starts filling it in, or another provider that always does,
 * overrides the inference without a change here.
 * {@link FailedStep.source} records which of the two answered, so a
 * report can say where the name came from rather than implying the
 * runner said it.
 */
import { describeValue } from '../../config-sections.js';

/**
 * How many lines of the tail the evidence carries, counted from the
 * END: the failure and what led to it are the last thing a job writes,
 * and the two runs measured for the module note are 651 and 5413 lines
 * long, neither of which belongs in a pull request comment.
 */
export const FAILED_LOG_TAIL_LINES = 40;

/**
 * What the step column reads when `gh` has no step name, which on
 * 2.100.0 is every line of every run read; see the module note.
 * {@link parseFailedLogLine} answers `undefined` for it, so no caller
 * can classify a pull request on the placeholder.
 */
export const UNKNOWN_STEP = 'UNKNOWN STEP';

/**
 * What the runner opens a step's group with. The text after it is the
 * step's command, which is what a `ci-*` class is read from.
 */
export const GROUP_STEP_PREFIX = '##[group]Run ';

/** What the runner opens an error line with. */
export const ERROR_PREFIX = '##[error]';

/** The column separator of the `--log-failed` shape. */
const COLUMN = '\t';

/** The byte order mark a job's first line opens with; see the module note. */
const BOM = '\ufeff';

/**
 * The per-line timestamp, as measured: an ISO instant with a long
 * fractional part, followed by one space. Absent from a continuation
 * line, so the strip is optional and never anchors anything.
 */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z /;

/**
 * An SGR colour sequence in either form: the literal `^[` the capture
 * carried, and a real ESC. See the module note for the bytes.
 *
 * Assembled rather than written as a regex literal because
 * `no-control-regex` objects to an ESC inside one whatever the spelling,
 * and the two forms belong in one pattern: a caller strips colour once.
 */
const COLOUR = new RegExp(`(?:${String.fromCharCode(0x1B)}|\\^\\[)\\[[0-9;]*m`, 'g');

/** Where a step name was read from; see the module note. */
export type FailedStepSource = 'step-column' | 'group-marker';

/** A step name, and the reading that answered it. */
export interface FailedStep {
  /**
   * The name. From `step-column` it is whatever the provider called the
   * step; from `group-marker` it is the step's COMMAND, the text after
   * {@link GROUP_STEP_PREFIX}, which is what the runner wrote.
   */
  readonly name: string;
  /** Which reading this came from. */
  readonly source: FailedStepSource;
}

/** One line of `--log-failed`, split into its columns. */
export interface FailedLogLine {
  /** The job column, or `undefined` when the line is not in the shape. */
  readonly job: string | undefined;
  /**
   * The step column, or `undefined` when it is empty, is
   * {@link UNKNOWN_STEP}, or the line is not in the shape.
   */
  readonly step: string | undefined;
  /**
   * The message: the third column with its BOM, its timestamp and its
   * colour sequences removed, or the whole line when there are no
   * columns to split.
   */
  readonly text: string;
}

/** Everything one `--log-failed` capture was read for. */
export interface FailedLogEvidence {
  /**
   * The distinct job names, in the order they first appear. Empty for a
   * log with no lines in the shape, including the empty string the port
   * answers for a log GitHub has dropped.
   */
  readonly jobs: readonly string[];
  /** The failing step, or `undefined` when nothing named one. */
  readonly step: FailedStep | undefined;
  /**
   * The tail: the last {@link FAILED_LOG_TAIL_LINES} messages at most,
   * in the log's own order, each stripped as
   * {@link FailedLogLine.text} is.
   */
  readonly lines: readonly string[];
  /**
   * How many lines were dropped off the FRONT to fit the cap, so a
   * caller can say what it is not showing.
   */
  readonly omitted: number;
  /** How many lines the whole capture held. */
  readonly total: number;
}

/** What {@link readFailedLog} takes beside the capture. */
export interface ReadFailedLogOptions {
  /**
   * The cap, {@link FAILED_LOG_TAIL_LINES} when unset. A value that is
   * not a positive whole number is refused rather than clamped: a cap
   * of zero would answer evidence with no evidence in it.
   */
  readonly maxLines?: number;
}

/** What every refusal from this module opens with. */
const PREFIX = 'pr triage evidence';

/** A column's value, or `undefined` when it is empty. */
function named(value: string): string | undefined {
  return value === ''
    ? undefined
    : value;
}

/** A step column's value, with {@link UNKNOWN_STEP} read as no name at all. */
function stepColumn(value: string): string | undefined {
  return value === UNKNOWN_STEP
    ? undefined
    : named(value);
}

/** A message with its BOM, its timestamp and its colour sequences removed. */
function stripText(text: string): string {
  const withoutBom = text.startsWith(BOM)
    ? text.slice(BOM.length)
    : text;
  return withoutBom.replace(TIMESTAMP, '').replace(COLOUR, '');
}

/** The step's command when `text` opens a step's group, else `undefined`. */
function groupStep(text: string): string | undefined {
  if (!text.startsWith(GROUP_STEP_PREFIX)) return undefined;
  return named(text.slice(GROUP_STEP_PREFIX.length).trim());
}

/**
 * Splits one `--log-failed` line into its columns.
 *
 * The split is on the FIRST two tabs only, so a message carrying a tab
 * of its own stays whole. A line with fewer than two tabs is not in the
 * shape: it keeps its whole text and names no job and no step.
 */
export function parseFailedLogLine(line: string): FailedLogLine {
  const firstTab = line.indexOf(COLUMN);
  const secondTab = firstTab === -1
    ? -1
    : line.indexOf(COLUMN, firstTab + 1);
  if (secondTab === -1) {
    return { job: undefined, step: undefined, text: stripText(line) };
  }
  return {
    job: named(line.slice(0, firstTab)),
    step: stepColumn(line.slice(firstTab + 1, secondTab)),
    text: stripText(line.slice(secondTab + 1)),
  };
}

/**
 * Splits a whole capture into lines.
 *
 * Trailing empty lines are dropped — the capture ends with a newline,
 * and an empty last line would otherwise eat one of the 40 the tail has
 * to spend. Empty lines INSIDE the log are kept, because a blank line
 * between two messages is how a runner separates them.
 */
export function parseFailedLog(text: string): readonly FailedLogLine[] {
  const raw = text.split('\n');
  let end = raw.length;
  while (end > 0 && raw[end - 1] === '') end -= 1;
  return raw.slice(0, end).map((line) => parseFailedLogLine(line));
}

/**
 * The failing step: the step in effect at the FIRST error line, by the
 * step column where there is one and by the group head otherwise.
 *
 * With no error line at all — a job killed by a timeout or a cancelled
 * run writes none — the fallback is the first named step column, and
 * failing that the LAST group head, which is the step that was still
 * running when the log stopped. `undefined` means nothing in the
 * capture named a step, which a caller must treat as an unknown step
 * rather than as a class.
 */
export function readFailedStep(lines: readonly FailedLogLine[]): FailedStep | undefined {
  let group: string | undefined;
  for (const line of lines) {
    const head = groupStep(line.text);
    if (head !== undefined) group = head;
    if (!line.text.startsWith(ERROR_PREFIX)) continue;
    if (line.step !== undefined) return { name: line.step, source: 'step-column' };
    if (group !== undefined) return { name: group, source: 'group-marker' };
  }
  const column = lines.find((line) => line.step !== undefined)?.step;
  if (column !== undefined) return { name: column, source: 'step-column' };
  return group === undefined
    ? undefined
    : { name: group, source: 'group-marker' };
}

/** The distinct job names, in the order they first appear. */
export function readJobs(lines: readonly FailedLogLine[]): readonly string[] {
  const jobs: string[] = [];
  for (const line of lines) {
    if (line.job !== undefined && !jobs.includes(line.job)) jobs.push(line.job);
  }
  return jobs;
}

/** The cap to use, or a refusal naming what was asked for. */
function readCap(value: number | undefined): number {
  if (value === undefined) return FAILED_LOG_TAIL_LINES;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(
      `${PREFIX}: readFailedLog refused a line cap ${describeValue(value)},`
        + ' expected a positive whole number',
    );
  }
  return value;
}

/**
 * Reads one `gh run view <id> --log-failed` capture: the jobs it
 * covers, the failing step, and the tail capped at
 * {@link ReadFailedLogOptions.maxLines}.
 *
 * The empty string the port answers for a log GitHub has dropped is an
 * ordinary reading here, not an error: no jobs, no step, no lines.
 */
export function readFailedLog(
  text: string,
  options: ReadFailedLogOptions = {},
): FailedLogEvidence {
  const cap = readCap(options.maxLines);
  const lines = parseFailedLog(text);
  const kept = lines.slice(Math.max(0, lines.length - cap));
  return {
    jobs: readJobs(lines),
    step: readFailedStep(lines),
    lines: kept.map((line) => line.text),
    omitted: lines.length - kept.length,
    total: lines.length,
  };
}
