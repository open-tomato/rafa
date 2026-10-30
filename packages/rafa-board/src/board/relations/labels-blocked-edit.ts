/**
 * The `Blocked by:` line, edited: the body an issue carries once one
 * blocker is added to its line or taken off it, for the `labels`
 * relationships adapter's two blocker writes (`./labels-writes.ts`).
 *
 * `../blocked.ts` READS the line and is left as it is: which line is the
 * field (the first outside a fence), what it names and in what order are
 * all its answers, taken here through `readBlockedBy`. This module only
 * rewrites the one line that answer points at, so a line the reader
 * would not find is never edited, and every other byte of the body is
 * kept.
 *
 * Nothing here spawns, reads the board or throws for a body: each edit
 * is a pure function over the body text, and answers the body unchanged
 * when there is nothing to do, which is how a caller tells a write it
 * need not send.
 *
 * ## Adding
 *
 * A blocker the line already names, as a local `#<n>` or a foreign
 * `owner/repo#<n>` (the repository compared without case, as GitHub
 * compares it), is left alone. Otherwise its token is appended to the
 * line after one space, whatever else the line holds, so a line reading
 * `Blocked by: the API work` becomes `Blocked by: the API work #24`. A
 * body with no line gains one, `Blocked by: #24`, after a blank line
 * below the text, or as the whole body when it is empty; the body's own
 * line break (`\r\n` when it carries one) is the one used.
 *
 * ## Removing
 *
 * A blocker the line does not name leaves the body unchanged. Otherwise
 * the line is written again as its own opening — indent, bullet,
 * emphasis and the colon, as the author dressed them — followed by every
 * token it still names, local ids first and then foreign tokens, each in
 * line order, one space apart: the prose between tokens is not kept,
 * since which words belonged to the removed token cannot be read. A line
 * left naming nothing is removed whole, and {@link BlockerRemoval.emptied}
 * says so, which is when the adapter also takes `spec:blocked` off.
 */
import type { RelatedIssue } from './port.js';

import { BLOCKED_BY_FIELD, readBlockedBy } from '../blocked.js';

/** What a body's lines are split on; `readBlockedBy`'s own rule, a `\r` kept on its line. */
const LINE_FEED = '\n';

/** A carriage return closing a line split on {@link LINE_FEED}. */
const TRAILING_RETURN = /\r$/u;

/** Every line break closing a body. */
const TRAILING_BREAKS = /(?:\r?\n)+$/u;

/** The field's opening up to its colon, and any emphasis closing after it. */
const FIELD_OPENING = /^([^:]*:[*_]{0,2})/u;

/** `blocker` as a `Blocked by:` line names it: `#<n>`, or `owner/repo#<n>` for another repository. */
export function blockerToken(blocker: RelatedIssue): string {
  return blocker.repository === null
    ? `#${String(blocker.number)}`
    : `${blocker.repository}#${String(blocker.number)}`;
}

/** True when the read line names `blocker`. */
function names(local: readonly number[], foreign: readonly string[], blocker: RelatedIssue): boolean {
  if (blocker.repository === null) return local.includes(blocker.number);
  const token = blockerToken(blocker).toLowerCase();
  return foreign.some((named) => named.toLowerCase() === token);
}

/** The break `body` uses: `\r\n` when it carries one, else `\n`. */
function lineBreakOf(body: string): string {
  return body.includes('\r\n')
    ? '\r\n'
    : LINE_FEED;
}

/** `lines[index]` replaced by `text`, keeping the carriage return it closed with. */
function replaceLine(lines: readonly string[], index: number, text: string): string {
  const old = lines[index] ?? '';
  const closing = TRAILING_RETURN.test(old)
    ? '\r'
    : '';
  return [...lines.slice(0, index), `${text}${closing}`, ...lines.slice(index + 1)].join(LINE_FEED);
}

/**
 * `body` with `blocker` added to issue `issue`'s `Blocked by:` line, or
 * a line naming it added when there is none; `body` itself when the line
 * names it already. The module note holds where the token goes.
 */
export function addBlockerToBody(issue: number, body: string, blocker: RelatedIssue): string {
  const read = readBlockedBy(issue, body);
  const token = blockerToken(blocker);
  if (read.line === null) {
    const text = body.replace(TRAILING_BREAKS, '');
    const lineBreak = lineBreakOf(body);
    const field = `${BLOCKED_BY_FIELD}: ${token}${lineBreak}`;
    return text.trim() === ''
      ? field
      : `${text}${lineBreak}${lineBreak}${field}`;
  }
  if (names(read.blockers, read.foreign, blocker)) return body;

  const lines = body.split(LINE_FEED);
  const index = read.line - 1;
  const text = (lines[index] ?? '').replace(TRAILING_RETURN, '').trimEnd();
  return replaceLine(lines, index, `${text} ${token}`);
}

/** What {@link removeBlockerFromBody} answers. */
export interface BlockerRemoval {
  /** The body with the blocker taken off; the body handed in when the line did not name it. */
  readonly body: string;
  /** True when the line named nothing else and was removed whole. */
  readonly emptied: boolean;
}

/**
 * `body` with `blocker` taken off issue `issue`'s `Blocked by:` line,
 * the line removed whole when it named nothing else. The module note
 * holds how the line is written again.
 */
export function removeBlockerFromBody(issue: number, body: string, blocker: RelatedIssue): BlockerRemoval {
  const read = readBlockedBy(issue, body);
  if (read.line === null || !names(read.blockers, read.foreign, blocker)) return { body, emptied: false };

  const token = blockerToken(blocker).toLowerCase();
  const kept = [
    ...read.blockers.filter((id) => blocker.repository !== null || id !== blocker.number).map((id) => `#${String(id)}`),
    ...read.foreign.filter((named) => named.toLowerCase() !== token),
  ];
  const lines = body.split(LINE_FEED);
  const index = read.line - 1;
  if (kept.length === 0) {
    return { body: [...lines.slice(0, index), ...lines.slice(index + 1)].join(LINE_FEED), emptied: true };
  }

  const line = (lines[index] ?? '').replace(TRAILING_RETURN, '');
  const opening = FIELD_OPENING.exec(line)?.[1] ?? `${BLOCKED_BY_FIELD}:`;
  return { body: replaceLine(lines, index, `${opening} ${kept.join(' ')}`), emptied: false };
}
