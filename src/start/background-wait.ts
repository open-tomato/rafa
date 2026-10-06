/**
 * Whether a session's final message ends its turn on a command it left
 * running in the background.
 *
 * A task session is one `claude -p` turn. A session that starts a command
 * in the background and ends its turn to wait for it never sees the
 * command finish: the turn is over, so no `rafa:report` block follows and
 * nothing is committed. `start/commit.ts` holds such a task on a missing
 * report; {@link readBackgroundWait} lets that hold name the wait rather
 * than a bare "no report".
 *
 * ## What counts as a wait
 *
 * A line of the message outside every fence that says, case aside, one of:
 *
 *   - `running in the background`, `runs in the background` or
 *     `run in the background` (`in background` too);
 *   - `wait for the notification`, `waiting on the notification`, and
 *     the same with `a`, `its` or `the completion`;
 *   - `run_in_background`, the Bash tool's parameter.
 *
 * "background" as a word in prose, as in "the background of this bug",
 * is no wait, and nor is a command that "ran in the background" and
 * finished: the past tense says the session saw it end.
 *
 * ## What is never read
 *
 * A message holding a `rafa:report` block, readable or not, answers no
 * wait: a session that wrote its block did not end its turn to wait. Nor
 * does an empty message. A fenced line is a quote (a log, a code sample)
 * rather than what the session said it was doing, so it answers nothing.
 */
import { parseReport } from '../report/parse.js';

/** The longest stretch of the waiting line a hold quotes. */
const WAIT_LINE_CAP = 200;

/** A line opening or closing a fence. */
const FENCE_LINE = /^\s*(?:```|~~~)/;

/** Each phrase that names a command left running in the background. */
const WAIT_PHRASES: readonly RegExp[] = [
  /\b(?:running|runs|run)\s+in\s+(?:the\s+)?background\b/i,
  /\bwait(?:ing)?\s+(?:for|on)\s+(?:the|a|its)\s+(?:completion\s+)?notification\b/i,
  /\brun_in_background\b/,
];

/** The lines of `output` that sit outside every fence, in order. */
function unfencedLines(output: string): readonly string[] {
  const lines: string[] = [];
  let fenced = false;
  for (const line of output.split('\n')) {
    if (FENCE_LINE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) lines.push(line);
  }
  return lines;
}

/** The trimmed line, cut to {@link WAIT_LINE_CAP} characters. */
function capped(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > WAIT_LINE_CAP
    ? `${trimmed.slice(0, WAIT_LINE_CAP - 1)}…`
    : trimmed;
}

/**
 * The line of a session's final message naming a command it left running
 * in the background, trimmed and capped, or `null` when it names none.
 *
 * The first matching line is answered, since the session names the
 * command where it says it started it. `null` for an empty output, for
 * one holding a `rafa:report` block, and for one whose only mention of
 * a background is prose or fenced; see the module note.
 */
export function readBackgroundWait(output: string): string | null {
  if (output.trim().length === 0) return null;
  const reading = parseReport(output);
  if (reading.present || reading.reason !== 'no-block') return null;
  const waiting = unfencedLines(output)
    .find((line) => WAIT_PHRASES.some((phrase) => phrase.test(line)));
  return waiting === undefined
    ? null
    : capped(waiting);
}
