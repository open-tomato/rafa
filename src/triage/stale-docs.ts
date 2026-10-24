/**
 * The `docs` channel: what triage makes of a report's `stale_docs`
 * entries, which is one answered row each and nothing on any tracker.
 *
 * A stale documentation line is no bug. A session that sees a page which
 * no longer matches the code names it under `stale_docs`
 * (`report/parse.ts`), and {@link triageStaleDocs} answers each entry the
 * way `triageReport` answers a machine-scoped bug, on a channel with no
 * tracker at all:
 *
 *   - neither tracker is asked anything, the public one or the private
 *     one: no `find`, no `create`, no `comment`. The function is handed
 *     no tracker, so there is none it could call;
 *   - no reference is stored, and none is read. Nothing was filed, so
 *     there is no issue a recurrence could be answered with, and an
 *     entry has no recurrence key;
 *   - its action is `skipped`, its channel `docs`, and its problem is one
 *     line naming the entry's place in the report, then where the stale
 *     line is and what no longer matches.
 *
 * The entry is not lost. In the loop, the report is stored before it is
 * triaged (`start.ts`), and storing it writes every `stale_docs` entry
 * to the store's `stale_docs` table as a `sighting` row
 * (`report/record.ts`, `effort/store/stale-docs.ts`). Nothing here reads
 * that write, so a row answered here says the entry reached no tracker,
 * and says nothing of whether its row was stored.
 *
 * ## The entries it reads
 *
 * {@link triageStaleDocs} takes the list as `parseReport` answered it,
 * and an entry's index is its place in THAT list. The parser leaves out
 * an entry with no usable `what`, so an entry written after such a one
 * is numbered one lower here than it was written. The parser's own
 * issues name an entry by where it was written, so the two numbers can
 * differ for one entry. Every entry it is given is answered, none is
 * read for a machine fault or a `security` flag, and none is compared
 * with anything: an entry has no flag, and a page naming a toolchain is
 * still a page.
 *
 * ## The problem line
 *
 * `stale_docs[<index>] is stale documentation at <where>: <what>`, and
 * `stale_docs[<index>] is stale documentation: <what>` for an entry whose
 * `where` is null or blank. The text is redacted first, by the function
 * the caller hands in, and cut to one line after: every run of white
 * space, a line break among them, becomes one space. Redaction comes
 * first because a secret is matched byte for byte, so one holding a line
 * break would no longer match a text already joined.
 */
import type { BugTriage } from './triage.js';
import type { ReportStaleDoc } from '@open-tomato/rafa/report/parse';

import { hasText } from '@open-tomato/rafa/triage/bug-key';

/** `text` on one line: each run of white space one space, none at either end. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * What one entry says, for the operator to see why nothing was filed:
 * that it is stale documentation, where when the entry names a place,
 * and what no longer matches. As the entry spelled it, neither redacted
 * nor cut to a line.
 */
export function staleDocSentence(entry: Pick<ReportStaleDoc, 'what' | 'where'>): string {
  return hasText(entry.where)
    ? `stale documentation at ${entry.where}: ${entry.what}`
    : `stale documentation: ${entry.what}`;
}

/**
 * Answers each `stale_docs` entry of a report on the `docs` channel: one
 * row per entry, in the list's order, each `skipped` with no reference
 * and a one-line problem redacted by `redact`. Calls no tracker and
 * reads no store; see the module note.
 */
export function triageStaleDocs(
  staleDocs: readonly ReportStaleDoc[],
  redact: (text: string) => string,
): BugTriage[] {
  return staleDocs.map((entry, index) => ({
    index,
    channel: 'docs',
    action: 'skipped',
    ref: null,
    foundBy: null,
    stored: null,
    problem: oneLine(redact(`stale_docs[${index}] is ${staleDocSentence(entry)}`)),
  }));
}
