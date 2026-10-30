/**
 * What `rafa roadmap --check` and `rafa issue list --roadmap --check`
 * weigh: every `type:epic` issue on the board listing, its stored state
 * against its computed one (`board/epics.ts`), so CI can run the command
 * and fail on an epic left open with its work done, or closed with its
 * work not done (`.rafa/specs/rafa-244-epics-group-issues-features.md`).
 *
 * ## What is weighed
 *
 * The epics are `readEpics`' whole answer, which `readRoadmapEpicRows`
 * carries as `epics`: every `type:epic` issue on the one listing, not
 * only those the Roadmap names and not only the horizon shown, so
 * `--all` changes nothing here. An epic DISAGREES when `readEpics` wrote
 * it a disagreement line; this module respells none of them, so the line
 * a failed check names is the line the table prints under the epic's
 * row.
 *
 * ## The answer
 *
 * {@link epicCheckFailure} answers null when the check passes — no epic
 * disagrees, no epic on the board included — and otherwise the message
 * the command ends with, exit code {@link EPIC_CHECK_EXIT}:
 *
 * ```text
 * ❌ 1 epic's stored state disagrees with its computed one:
 *   done, but epic #10 is still open
 * ```
 *
 * one line per disagreeing epic, in ascending number.
 *
 * A listing that FAILED fails the check too, with its reason: nothing
 * was compared, and a CI gate that passes on a board it could not read
 * would read as agreement. An `unknown` epic disagrees with nothing
 * (`disagreementOf`), so without this ending a failed listing would pass.
 */
import type { Epics } from '../../board/epics.js';

/** The exit code a failed check ends with. */
export const EPIC_CHECK_EXIT = 1;

/** The message head for `count` disagreeing epics. */
function checkHead(count: number): string {
  return count === 1
    ? '❌ 1 epic\'s stored state disagrees with its computed one:'
    : `❌ ${String(count)} epics' stored states disagree with their computed ones:`;
}

/** The message a failed check ends with, or null when it passes; see the module note. */
export function epicCheckFailure(epics: Epics): string | null {
  if (epics.unknown !== null) return `❌ Could not check the epics: ${epics.unknown}`;
  const lines = epics.epics.flatMap((epic) => epic.disagreement === null
    ? []
    : [`  ${epic.disagreement}`]);
  if (lines.length === 0) return null;
  return [checkHead(lines.length), ...lines].join('\n');
}
