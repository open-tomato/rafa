/**
 * The task prompt's `## Failures this run inherited` section: the
 * run-start suite failures (`suite/baseline.ts`), each named by its test
 * file and case, under the sentence telling the session it need not
 * prove them pre-existing.
 *
 *     ## Failures this run inherited
 *     These tests were already failing when this run started. They need no proof that they predate your task: ...
 *     - `src/foo.test.ts`: foo > adds
 *     - ...and 3 more.
 *
 * `start/triage.ts` already answers a reported bug matching one of these
 * as `inherited` and files nothing for it; this section spares the
 * session the `git stash` or clean worktree of `main` it would otherwise
 * spend showing that the red was there before it.
 *
 * ## Nothing inherited
 *
 * An empty list renders as the empty string, which `buildTaskPrompt`
 * (`start/dispatch.ts`) leaves out, so a run that starts green hands
 * every task the prompt it got before.
 *
 * ## A long list
 *
 * At most {@link INHERITED_LIST_CAP} failures are listed, in the
 * baseline's order; the rest are counted in one closing
 * `- ...and <n> more.` line, so a suite that starts deep in the red does
 * not crowd the plan out of the prompt.
 *
 * ## A failure's line
 *
 * `` - `<file>`: <case> ``, each field's whitespace runs collapsed to one
 * space. A case name is read from a JUnit file, and collapsed it cannot
 * open a prompt line of its own, the `<!-- ralph:plan=... -->` stamp
 * `planStubFromPrompt` reads among them. The message is never shown: the
 * session matches on file and case, as the section says.
 */
import type { SuiteFailure } from '../suite/run.js';

/** The heading of the inherited section. */
export const INHERITED_HEADING = '## Failures this run inherited';

/** The sentence under the heading: what these are, and that they need no proof. */
export const INHERITED_SENTENCE = 'These tests were already failing when this run started. '
  + 'They need no proof that they predate your task: do not run `git stash` or check out a clean worktree of `main` to show it. '
  + 'A bug you report for one of them, by its file and case, is recognised as inherited and files nothing.';

/** The most failures the section lists before counting the rest. */
export const INHERITED_LIST_CAP = 20;

/** `text` with each whitespace run, line breaks included, made one space. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The list line naming `failure` by file and case. */
function failureLine(failure: SuiteFailure): string {
  return `- \`${oneLine(failure.file)}\`: ${oneLine(failure.name)}`;
}

/**
 * The section naming `failures`, or the empty string for none. See the
 * module note.
 */
export function renderInheritedSection(failures: readonly SuiteFailure[]): string {
  if (failures.length === 0) return '';
  const listed = failures.slice(0, INHERITED_LIST_CAP).map(failureLine);
  const rest = failures.length - listed.length;
  const more = rest > 0
    ? [`- ...and ${rest} more.`]
    : [];
  return [INHERITED_HEADING, INHERITED_SENTENCE, ...listed, ...more].join('\n');
}
