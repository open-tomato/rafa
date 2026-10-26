/**
 * A failed acceptance check whose criterion names only documentation:
 * the `docs` channel of `rafa epic close` (`./close.ts`), which takes it
 * off the bug route.
 *
 * ## Which check
 *
 * {@link isDocsOnlyCriterion}: `namesOnlyDocs` (`triage/doc-only.ts`)
 * over the criterion's text, so a criterion naming at least one path,
 * every one of them a page (`context/triage.md`, `README`, a file under
 * `docs/`). A criterion naming a source file beside a page, or no path at
 * all, is not one, and is filed as a bug as before.
 *
 * ## What is done with it
 *
 * {@link routeDocsOnlyFailure}, in place of the bug report:
 *
 *   1. One `unsettled` row through `writeStaleDocs`
 *      (`effort/store/stale-docs.ts`), under the check session's id, with
 *      no plan stub, since an epic close runs under no plan, the task line
 *      `rafa epic close <n>` and the outcome `failed`, as the bug report's
 *      dispatch would have been.
 *   2. One line through `activeServices().addStaleDocLine`, core's
 *      service registry, which the root `src/service-registry.ts` fills
 *      with pr's function, on the release's stale-docs issue, on the
 *      tracker the close resolved for its bugs. A tracker that cannot
 *      list and edit answers `kept`, and the line is printed then, since
 *      the close has no "after the last task" to keep it for. While no
 *      set is registered the call refuses, naming `addStaleDocLine` and
 *      the root, and the refusal is a `warn` line like a failed tracker
 *      call's.
 *
 * The entry names no `where`: a criterion is no file and line. Its `what`
 * is the epic, the criterion's number and its text on one line, the text
 * a bug's `what` would have held. It is redacted of the run's named
 * secrets and local paths first, as the issue is public; the row holds
 * the same redacted text, so the row and the line agree.
 *
 * Nothing here throws: a store that refused and a tracker call that
 * failed are each a `warn` line, and the close is refused all the same,
 * since the criterion does not hold.
 */
import type { EpicCriterion } from '../../epic/verify-plan.js';
import type { StaleDocLineResult, StaleDocsTracker } from '@open-tomato/rafa/core/services';
import type { IssueRef } from '@open-tomato/rafa/ports';
import type { FindingsWriterSeams } from '@open-tomato/rafa/store/findings';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { activeServices } from '@open-tomato/rafa/core/services';
import { writeStaleDocs } from '@open-tomato/rafa/store/stale-docs';
import { namesOnlyDocs } from '@open-tomato/rafa/triage/doc-only';
import { staleDocLineText } from '@open-tomato/rafa/triage/stale-doc-line';

/** True when `criterion` names only documentation; see the module note. */
export function isDocsOnlyCriterion(criterion: EpicCriterion): boolean {
  return namesOnlyDocs(criterion.text);
}

/** One failed check of a criterion naming only documentation. */
export interface DocsOnlyFailure {
  readonly repoRoot: string;
  readonly epic: number;
  readonly criterion: EpicCriterion;
  /** The check session's id, the row's `session_id`. */
  readonly sessionId: string;
  /** The tracker the close resolved, or null when it resolved none. */
  readonly tracker: StaleDocsTracker | null;
  /** Reads the version the stale-docs issue is titled for. */
  readonly version: () => string;
  /** Redacts the run's secrets and local paths from a line. */
  readonly redact: (text: string) => string;
  readonly seams?: FindingsWriterSeams;
}

/** One line the close writes, and whether it is a warning. */
export interface DocsOnlyLine {
  readonly text: string;
  readonly warn: boolean;
}

/** The entry's `what`: the epic, the criterion's number and its text, on one line. */
export function docsOnlyWhat(epic: number, criterion: EpicCriterion): string {
  const text = criterion.text.replace(/\s+/gu, ' ').trim();
  return `Epic #${String(epic)} acceptance criterion ${String(criterion.number)} fails against main: ${text}`;
}

/** How a line names an issue: its URL, or its kind and id. */
function refName(ref: IssueRef): string {
  return ref.url ?? `${ref.kind} issue ${ref.externalId}`;
}

/** The line the result of adding the criterion's line is told with. */
export function docsOnlyLine(criterion: EpicCriterion, result: StaleDocLineResult, text: string): DocsOnlyLine {
  const which = `Criterion ${String(criterion.number)}: names only documentation, so no bug is filed;`;
  switch (result.action) {
    case 'created':
      return { text: `${which} opened ${refName(result.ref)}, ${result.title}, with the line.`, warn: false };
    case 'appended':
      return { text: `${which} added the line to ${refName(result.ref)}, ${result.title}.`, warn: false };
    case 'held':
      return { text: `${which} ${refName(result.ref)}, ${result.title}, already holds the line.`, warn: false };
    case 'kept':
      return { text: `${which} not added to ${result.title} (${result.reason}): ${text}`, warn: true };
    case 'failed':
      return { text: `${which} not added to ${result.title}: ${result.problem}`, warn: true };
  }
}

/** Stores the row and adds the line; see the module note. Never throws. */
export async function routeDocsOnlyFailure(failure: DocsOnlyFailure): Promise<readonly DocsOnlyLine[]> {
  const { criterion, epic } = failure;
  const what = failure.redact(docsOnlyWhat(epic, criterion));
  const lines: DocsOnlyLine[] = [];
  try {
    const stored = writeStaleDocs(failure.repoRoot, {
      dispatch: { sessionId: failure.sessionId, planStub: null, taskLine: `rafa epic close ${String(epic)}` },
      outcome: 'failed',
      kind: 'unsettled',
      staleDocs: [{ where: null, what, extras: [] }],
    }, failure.seams);
    for (const rejection of stored.rejected) {
      lines.push({ text: `Criterion ${String(criterion.number)}: the stale-docs row was not stored: ${rejection.text}`, warn: true });
    }
  } catch (error) {
    lines.push({ text: `Criterion ${String(criterion.number)}: the stale-docs row was not stored: ${failure.redact(messageOf(error))}`, warn: true });
  }
  try {
    const entry = { where: null, what };
    const result = await activeServices().addStaleDocLine({ tracker: failure.tracker, version: failure.version(), entry });
    lines.push(docsOnlyLine(criterion, result, staleDocLineText(entry)));
  } catch (error) {
    lines.push({ text: `Criterion ${String(criterion.number)}: not added to the stale-docs issue: ${failure.redact(messageOf(error))}`, warn: true });
  }
  return lines;
}
