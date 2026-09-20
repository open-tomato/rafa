/**
 * The issue body a suite plants when it needs `rafa plan create` to get
 * PAST the readiness gate rather than be refused by it.
 *
 * `src/board/plan-spec.ts` refuses an issue whose body carries a gap
 * (`requireCompleteSpec` in `src/board/readiness.ts`) before a byte of
 * it is snapshotted, so a case about the roadmap walk, the snapshot, the
 * planner session or the roadmap tick has to plant a body the check
 * finds nothing wrong with. That body is the same six sections every
 * time and says nothing any of those cases reads, which is exactly why
 * it lives here and not in three copies: a heading added to
 * `TEMPLATE_HEADINGS` is one edit, not three, and a suite that forgot
 * one would fail on a refusal about the template rather than on its own
 * subject.
 *
 * This is NOT a fixture for the gate's own cases. `src/board/readiness.test.ts`
 * and `src/tests/readiness-gate-integration.test.ts` each build their
 * bodies section by section, because what they measure is which gap a
 * broken section answers, and a body they cannot break one heading of
 * is no use to them.
 */
import { LIST_HEADINGS, TEMPLATE_HEADINGS } from '../board/readiness.js';

/** What a section holds when the caller asks for nothing in particular. */
const FILLER = 'Written so the readiness gate finds no gap here.';

/** What a list section holds: one item, which is what the two of them are checked for. */
const ITEM = '- one item, so the plan has something to be written from';

/**
 * A body titled `title` carrying every heading of
 * {@link TEMPLATE_HEADINGS}, in the template's order, each with content
 * and each of {@link LIST_HEADINGS} with a list item: no gap, no
 * placeholder, and nothing a refusal can name.
 *
 * `detail` is the one line under the first heading, so two callers that
 * need bodies which DIFFER — a snapshot compared against the issue it
 * came from, say — can each name their own without either going thin.
 */
export function completeSpecBody(title: string, detail: string = FILLER): string {
  const sections = TEMPLATE_HEADINGS.map((heading, position) => {
    const prose = position === 0
      ? detail
      : FILLER;
    const content = LIST_HEADINGS.includes(heading)
      ? ITEM
      : prose;
    return `## ${heading}\n\n${content}\n`;
  });

  return [`# ${title}\n`, ...sections].join('\n');
}
